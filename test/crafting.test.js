import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step } from "../src/sim/world.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { START_KIT } from "../src/sim/items.js";
import { count, affordable, createInventory } from "../src/sim/inventory.js";
import { queueCraft, queueItems, cancelCraft, planItems, craftable, handTime } from "../src/sim/crafting.js";
import { RECIPES } from "../src/sim/recipes.js";
import { serialize, deserialize } from "../src/sim/save.js";
import { charge, ALL } from "./helpers.js";

const run = (world, ticks) => {
  for (let i = 0; i < ticks; i++) {
    charge(world);
    step(world);
  }
};
const GEAR = handTime("iron-gear");
const CABLE = handTime("copper-cable");
const CIRCUIT = handTime("electronic-circuit");

test("hand-crafting a gear takes two plates and makes a gear", () => {
  const world = createWorld({ milestones: ALL, seed: 1, kit: { "iron-plate": 5 } });
  assert.equal(queueCraft(world, "iron-gear", 2).missing, null);
  run(world, 1);
  assert.equal(count(world.inventory, "iron-plate"), 3, "the first craft takes its plates when it starts");
  run(world, GEAR - 1);
  assert.equal(count(world.inventory, "iron-gear"), 1);
  run(world, GEAR);
  assert.equal(count(world.inventory, "iron-gear"), 2);
  assert.equal(count(world.inventory, "iron-plate"), 1);
  assert.deepEqual(world.craft.queue, []);
  assert.ok(GEAR < RECIPES["iron-gear"].time, "hands are faster than an assembler");
});

test("crafting what you can't make says what's missing and queues nothing", () => {
  const world = createWorld({ milestones: ALL, seed: 1, kit: { "iron-plate": 3 } });
  assert.deepEqual(queueCraft(world, "iron-gear", 2).missing, { "iron-plate": 1 });
  assert.deepEqual(queueCraft(world, "electronic-circuit").missing, { "copper-plate": 2 });
  assert.deepEqual(world.craft.queue, []);
});

test("a circuit from plates crafts its cables first, and the spare cable is kept", () => {
  const world = createWorld({ milestones: ALL, seed: 1, kit: { "iron-plate": 1, "copper-plate": 2 } });
  const plan = queueCraft(world, "electronic-circuit");
  assert.deepEqual(plan.steps, [
    { recipe: "copper-cable", n: 2 },
    { recipe: "electronic-circuit", n: 1 },
  ]);
  run(world, CABLE * 2 + CIRCUIT + 2);
  assert.deepEqual(world.inventory.items, { "electronic-circuit": 1, "copper-cable": 1 });
});

test("what you already have is used before crafting more", () => {
  const inv = createInventory({ "copper-cable": 5, "copper-plate": 1, "iron-plate": 2 });
  assert.deepEqual(planItems(inv, { "copper-cable": 6 }).steps, [{ recipe: "copper-cable", n: 1 }]);
  assert.equal(craftable(inv, "electronic-circuit"), 2);
});

test("cancelling the craft under way gives its ingredients back", () => {
  const world = createWorld({ milestones: ALL, seed: 1, kit: { "iron-plate": 4 } });
  queueCraft(world, "iron-gear", 2);
  run(world, 5);
  assert.equal(count(world.inventory, "iron-plate"), 2);
  cancelCraft(world, 0);
  assert.equal(count(world.inventory, "iron-plate"), 4);
  assert.deepEqual(world.craft.queue, []);
  run(world, GEAR * 3);
  assert.equal(count(world.inventory, "iron-gear"), 0);
});

test("a craft whose ingredients were spent is dropped", () => {
  const world = createWorld({ milestones: ALL, seed: 1, kit: { "iron-plate": 2 } });
  queueCraft(world, "iron-gear");
  world.inventory.items = {}; // spent before the craft could start
  run(world, 1);
  assert.deepEqual(world.craft.queue, []);
  assert.equal(world.craft.dropped, 1);
  assert.equal(world.craft.lastDropped, "iron-gear");
});

test("queueing a building's missing parts crafts just those", () => {
  const world = createWorld({ milestones: ALL, seed: 1, kit: { "iron-plate": 20, stone: 6 } });
  assert.equal(affordable(world.inventory, BUILDINGS.miner.cost), 0);
  queueItems(world, BUILDINGS.miner.cost);
  assert.deepEqual(world.craft.queue, [{ recipe: "iron-gear", n: 3 }]);
  run(world, GEAR * 3 + 2);
  assert.equal(affordable(world.inventory, BUILDINGS.miner.cost), 1);
});

test("machinery can be hand-crafted from the kit; walls need smelted bricks", () => {
  for (const type in BUILDINGS) {
    assert.deepEqual(planItems(createInventory(START_KIT), BUILDINGS[type].cost).missing, type === "wall" ? { "stone-brick": 5 } : null, type);
  }
});

test("the crafting queue is saved, including a craft under way", () => {
  const world = createWorld({ milestones: ALL, seed: 1, kit: { "iron-plate": 10, "copper-plate": 4 } });
  queueCraft(world, "electronic-circuit");
  queueCraft(world, "iron-gear", 2);
  run(world, CABLE + 3);
  assert.ok(world.craft.busy);
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(serialize(loaded), serialize(world));
  run(world, 500);
  run(loaded, 500);
  assert.deepEqual(serialize(loaded), serialize(world));
  assert.equal(count(loaded.inventory, "iron-gear"), 2);
  assert.equal(count(loaded.inventory, "electronic-circuit"), 1);
});
