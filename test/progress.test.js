import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, removeAt, canPlace } from "../src/sim/world.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { RECIPES, SMELTING } from "../src/sim/recipes.js";
import { fillFrom, emptySlot } from "../src/sim/furnace.js";
import { canTake, put } from "../src/sim/transport.js";
import { queueCraft } from "../src/sim/crafting.js";
import { count } from "../src/sim/inventory.js";
import {
  MILESTONES,
  START,
  buildingMilestone,
  recipeMilestone,
  buildingUnlocked,
  recipeUnlocked,
  currentMilestone,
  allDone,
  stillNeeded,
  deliverFrom,
  deliverAll,
} from "../src/sim/progress.js";
import { serialize, deserialize } from "../src/sim/save.js";
import { charge } from "./helpers.js";

const run = (world, ticks) => {
  for (let i = 0; i < ticks; i++) {
    charge(world);
    step(world);
  }
};
// Finds a clear square of bare ground, n tiles across.
const clearArea = (world, n) => {
  for (let y = 4; y < world.size - n - 4; y += 2) {
    for (let x = 4; x < world.size - n - 4; x += 2) {
      let clear = true;
      for (let j = 0; j < n && clear; j++) for (let i = 0; i < n && clear; i++) if (world.map.ore[(y + j) * world.size + x + i]) clear = false;
      if (clear) return { x, y };
    }
  }
  throw new Error("no clear area");
};
// Enough of everything to deliver any milestone and build anything.
const RICH = Object.fromEntries(Object.keys(RECIPES).concat(["iron-plate", "copper-plate", "stone", "stone-brick", "coal"]).map((id) => [id, 5000]));
const fresh = () => createWorld({ seed: 3, kit: { ...RICH } });

test("every building and recipe is unlocked at the start or by exactly one milestone", () => {
  for (const type in BUILDINGS) {
    const by = MILESTONES.filter((m) => m.unlocks.buildings.includes(type)).length + START.buildings.includes(type);
    assert.equal(by, 1, type);
  }
  for (const id in RECIPES) {
    const by = MILESTONES.filter((m) => m.unlocks.recipes.includes(id)).length + START.recipes.includes(id);
    assert.equal(by, 1, id);
  }
  assert.ok(START.buildings.includes("hub"), "the HUB can always be built");
  const last = MILESTONES.at(-1);
  assert.equal(last.unlocks.buildings.length + last.unlocks.recipes.length, 0, "the last milestone is the goal");
});

test("a new game can only build the basics, and says what unlocks the rest", () => {
  const world = fresh();
  const { x, y } = clearArea(world, 6);
  for (const type of START.buildings) assert.ok(buildingUnlocked(world, type), type);
  assert.equal(buildingUnlocked(world, "miner"), false);
  assert.match(canPlace(world, "miner", x, y, 0), /^Locked: reach milestone 1, Power and mining/);
  assert.equal(place(world, "miner", x, y, 0), null);
  assert.ok(place(world, "furnace", x, y, 0));
});

test("there's only ever one HUB", () => {
  const world = fresh();
  const { x, y } = clearArea(world, 10);
  const hub = place(world, "hub", x, y, 0);
  assert.ok(hub);
  assert.equal(canPlace(world, "hub", x + 5, y, 0), "There's already a HUB");
  removeAt(world, x, y);
  assert.ok(place(world, "hub", x + 5, y, 0), "it can be built again elsewhere");
});

test("delivering a milestone's items by hand unlocks what it promises, and moves on to the next", () => {
  const world = fresh();
  const first = MILESTONES[0];
  const [item, n] = Object.entries(first.needs)[0];
  const before = count(world.inventory, item);
  assert.equal(deliverFrom(world.progress, world.inventory, item), n);
  assert.equal(count(world.inventory, item), before - n);
  assert.equal(stillNeeded(world.progress, item), 0);
  assert.equal(deliverFrom(world.progress, world.inventory, item), 0, "no more than it needs");
  assert.equal(currentMilestone(world), first, "not done until it has everything");

  assert.deepEqual(deliverAll(world.progress, world.inventory), Object.fromEntries(Object.entries(first.needs).slice(1)));
  assert.equal(currentMilestone(world), MILESTONES[1]);
  assert.deepEqual(world.progress.delivered, {});
  for (const type of first.unlocks.buildings) assert.ok(buildingUnlocked(world, type), type);
  assert.equal(buildingUnlocked(world, "inserter"), false);
});

test("going through every milestone unlocks everything and ends the game's goals", () => {
  const world = fresh();
  for (const m of MILESTONES) {
    assert.equal(currentMilestone(world), m);
    deliverAll(world.progress, world.inventory);
  }
  assert.ok(allDone(world));
  assert.equal(currentMilestone(world), null);
  for (const type in BUILDINGS) assert.ok(buildingUnlocked(world, type), type);
  for (const id in RECIPES) assert.ok(recipeUnlocked(world, id), id);
  assert.equal(stillNeeded(world.progress, "electronic-circuit"), 0);
});

test("a belt delivers to the HUB only what the milestone still needs", () => {
  const world = createWorld({ seed: 3, kit: { ...RICH }, milestones: 1 }); // belts unlocked
  const { x, y } = clearArea(world, 10);
  const hub = place(world, "hub", x + 2, y, 0);
  const belt = place(world, "belt", x + 1, y + 1, 1);
  const needs = MILESTONES[1].needs;
  assert.equal(canTake(hub, "iron-plate"), true);
  assert.equal(canTake(hub, "coal"), false, "not needed");
  put(belt, "coal");
  run(world, 60);
  assert.equal(belt.items.length, 1, "the coal waits at the belt's end");
  belt.items = [];
  for (let i = 0; i < needs["iron-plate"] + 5; i++) {
    run(world, 8);
    if (canTake(belt, "iron-plate")) put(belt, "iron-plate");
  }
  run(world, 120);
  assert.equal(world.progress.delivered["iron-plate"], needs["iron-plate"]);
  assert.ok(belt.items.length > 0, "the rest wait on the belt");
});

test("finishing a milestone with the HUB fed by a belt unlocks it", () => {
  const world = createWorld({ seed: 3, kit: { ...RICH }, milestones: MILESTONES.length - 1 });
  const { x, y } = clearArea(world, 10);
  const hub = place(world, "hub", x + 2, y, 0);
  const belt = place(world, "belt", x + 1, y + 1, 1);
  const need = MILESTONES.at(-1).needs["electronic-circuit"];
  for (let i = 0; i < need * 20 && !allDone(world); i++) {
    if (canTake(belt, "electronic-circuit")) put(belt, "electronic-circuit");
    run(world, 1);
  }
  assert.ok(allDone(world));
  assert.equal(canTake(hub, "electronic-circuit"), false, "and then it takes nothing");
});

test("locked recipes can't be hand-crafted, even as a part", () => {
  const world = fresh();
  assert.equal(recipeMilestone("electronic-circuit"), 1);
  assert.equal(recipeUnlocked(world, "electronic-circuit"), false);
  const plan = queueCraft(world, "electronic-circuit", 1);
  assert.ok(plan.missing);
  assert.deepEqual(world.craft.queue, []);
  assert.equal(queueCraft(world, "iron-gear", 1).missing, null, "gears can");
});

test("milestone progress survives a save and load", () => {
  const world = fresh();
  deliverAll(world.progress, world.inventory);
  deliverFrom(world.progress, world.inventory, "iron-gear");
  const { x, y } = clearArea(world, 6);
  const hub = place(world, "hub", x, y, 0);
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(loaded.progress, world.progress);
  const h = [...loaded.entities.values()].find((e) => e.id === hub.id);
  assert.equal(h.progress, loaded.progress, "the loaded HUB delivers to the loaded world");
  assert.ok(canTake(h, "iron-plate"));
});

test("a save from before milestones gets every building and only the goal left", () => {
  const world = createWorld({ seed: 3, milestones: MILESTONES.length });
  const { progress, ...v4 } = { ...serialize(world), version: 4 };
  const loaded = deserialize(structuredClone(v4));
  assert.equal(currentMilestone(loaded), MILESTONES.at(-1));
  for (const type in BUILDINGS) assert.ok(buildingUnlocked(loaded, type), type);
  assert.equal(buildingMilestone("hub"), -1);
});

test("a new game's kit builds the HUB and a furnace, and with bricks smelted from it reaches milestone 1", () => {
  const world = createWorld({ seed: 3 });
  const { x, y } = clearArea(world, 10);
  assert.ok(place(world, "hub", x, y, 0), "the kit pays for the HUB");
  const furnace = place(world, "furnace", x + 5, y, 0);
  assert.ok(furnace, "and a furnace");
  const stone = 2 * MILESTONES[0].needs["stone-brick"];
  assert.equal(fillFrom(furnace, world.inventory, "stone"), stone, "with the stone for the bricks left over");
  fillFrom(furnace, world.inventory, "coal");
  run(world, SMELTING.stone.time * (stone / 2) + 10);
  emptySlot(furnace, "output", world.inventory);
  deliverAll(world.progress, world.inventory);
  assert.equal(world.progress.milestone, 1);
});
