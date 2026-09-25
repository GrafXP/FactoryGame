import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, removeAt, refundOf } from "../src/sim/world.js";
import { BUILDINGS, outputTile } from "../src/sim/buildings.js";
import { canTake, put } from "../src/sim/transport.js";
import { furnaceAdd, fillFrom, emptySlot } from "../src/sim/furnace.js";
import { SWING } from "../src/sim/inserter.js";
import { SMELTING, FUEL } from "../src/sim/recipes.js";
import { count, total } from "../src/sim/inventory.js";
import { ORE } from "../src/sim/map.js";
import { serialize, deserialize } from "../src/sim/save.js";
import { charge } from "./helpers.js";

const { stack: STACK, feed: FEED } = BUILDINGS.furnace;
const PLATE_TICKS = SMELTING["iron-ore"].time;

const setup = () =>
  createWorld({ seed: 3, kit: { "iron-plate": 1000, "copper-plate": 1000, "iron-gear": 1000, "electronic-circuit": 1000, stone: 1000, coal: 100, "iron-ore": 100 } });
const run = (world, ticks, each) => {
  for (let i = 0; i < ticks; i++) {
    each?.(i);
    charge(world);
    step(world);
  }
};
// Finds a clear square of bare ground, n tiles across, so tests don't hit ore.
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

// Ore belt → inserter → furnace → inserter → belt → chest, all facing east.
// Iron ore arrives once a second, with a lump of coal every 8 ores.
const smelter = () => {
  const world = setup();
  const { x, y } = clearArea(world, 10);
  const oreBelts = [place(world, "belt", x, y, 1), place(world, "belt", x + 1, y, 1)];
  const loader = place(world, "inserter", x + 2, y, 1);
  const furnace = place(world, "furnace", x + 3, y, 1);
  const unloader = place(world, "inserter", x + 5, y, 1);
  const outBelts = [place(world, "belt", x + 6, y, 1), place(world, "belt", x + 7, y, 1)];
  const chest = place(world, "chest", x + 8, y, 1);
  const feed = (t) => {
    const b = oreBelts[0];
    if (t % 60 === 0 && canTake(b, "iron-ore")) put(b, "iron-ore");
    if (t % 480 === 30 && canTake(b, "coal")) put(b, "coal");
  };
  return { world, x, y, oreBelts, loader, furnace, unloader, outBelts, chest, feed };
};

test("ore belt → inserter → furnace → inserter → belt → chest ends with plates in the chest", () => {
  const { world, furnace, chest, feed } = smelter();
  run(world, 60 * 45, feed);
  assert.ok(count(chest.inventory, "iron-plate") >= 35, `got ${count(chest.inventory, "iron-plate")} plates`);
  assert.equal(total(chest.inventory), count(chest.inventory, "iron-plate"), "only plates reach the chest");
  assert.ok(furnace.input === null || furnace.input.n <= FEED, "the furnace isn't stuffed with ore");
});

test("a furnace without fuel stops and says so, and starts once it gets coal", () => {
  const world = setup();
  const { x, y } = clearArea(world, 4);
  const f = place(world, "furnace", x, y, 0);
  assert.equal(fillFrom(f, world.inventory, "iron-ore"), 50, "the player can fill a whole stack");
  run(world, PLATE_TICKS * 3);
  assert.equal(f.status, "no-fuel");
  assert.equal(f.output, null);
  assert.equal(f.input.n, 50, "no ore is used up while it waits");

  put(f, "coal");
  run(world, PLATE_TICKS);
  assert.equal(f.status, "working");
  assert.deepEqual(f.output, { item: "iron-plate", n: 1 });
  run(world, FUEL.coal - PLATE_TICKS + 1);
  assert.equal(f.output.n, FUEL.coal / PLATE_TICKS, "one coal smelts 8 plates");
  assert.equal(f.status, "no-fuel");
});

test("an idle furnace with nothing to smelt isn't out of fuel", () => {
  const world = setup();
  const { x, y } = clearArea(world, 4);
  const f = place(world, "furnace", x, y, 0);
  run(world, 10);
  assert.equal(f.status, "no-input");
});

test("stone needs two per brick and takes longer", () => {
  const world = setup();
  const { x, y } = clearArea(world, 4);
  const f = place(world, "furnace", x, y, 0);
  furnaceAdd(f, "stone", 5);
  furnaceAdd(f, "coal", 2);
  run(world, SMELTING.stone.time * 3);
  assert.deepEqual(f.output, { item: "stone-brick", n: 2 });
  assert.deepEqual(f.input, { item: "stone", n: 1 }, "the odd stone waits for another");
  assert.equal(f.smelting, null);
  assert.equal(f.status, "no-input");
});

test("a lone stone waits for a second one, and the player can take it back", () => {
  const world = setup();
  const { x, y } = clearArea(world, 4);
  const f = place(world, "furnace", x, y, 0);
  furnaceAdd(f, "stone", 1);
  furnaceAdd(f, "coal", 1);
  run(world, SMELTING.stone.time * 2);
  assert.equal(f.status, "no-input");
  assert.equal(f.output, null);
  assert.equal(canTake(f, "iron-ore"), false, "the stone blocks other ore");

  const before = count(world.inventory, "stone");
  assert.deepEqual(emptySlot(f, "input", world.inventory), { stone: 1 });
  assert.equal(count(world.inventory, "stone"), before + 1);
  assert.equal(f.input, null);
  assert.equal(fillFrom(f, world.inventory, "iron-ore"), 50, "and other ore can go in");
  run(world, PLATE_TICKS);
  assert.deepEqual(f.output, { item: "iron-plate", n: 1 });
  assert.deepEqual(emptySlot(f, "fuel", world.inventory), {}, "the coal is already burning");
});

test("a full output stops the furnace, and emptying it starts it again", () => {
  const world = setup();
  const { x, y } = clearArea(world, 4);
  const f = place(world, "furnace", x, y, 0);
  furnaceAdd(f, "iron-ore", 3);
  furnaceAdd(f, "coal", 1);
  f.output = { item: "iron-plate", n: STACK };
  run(world, PLATE_TICKS * 2);
  assert.equal(f.status, "full");
  assert.equal(f.input.n, 3);

  const before = count(world.inventory, "iron-plate");
  assert.deepEqual(emptySlot(f, "output", world.inventory), { "iron-plate": STACK });
  assert.equal(count(world.inventory, "iron-plate"), before + STACK);
  run(world, PLATE_TICKS);
  assert.deepEqual(f.output, { item: "iron-plate", n: 1 });
});

test("belts, miners and inserters only top a furnace up; ore and fuel go in their own slots", () => {
  const world = setup();
  const { x, y } = clearArea(world, 4);
  const f = place(world, "furnace", x, y, 0);
  for (let i = 0; i < FEED; i++) {
    assert.ok(canTake(f, "iron-ore"));
    put(f, "iron-ore");
  }
  assert.equal(canTake(f, "iron-ore"), false);
  assert.equal(canTake(f, "copper-ore"), false, "one kind of ore at a time");
  assert.equal(canTake(f, "coal"), true, "coal goes in the fuel slot");
  assert.equal(canTake(f, "iron-plate"), false, "plates are no use to a furnace");
  assert.deepEqual(f.input, { item: "iron-ore", n: FEED });
});

test("a miner can feed a furnace directly", () => {
  const world = setup();
  let at = null;
  for (let y = 4; y < world.size - 6 && !at; y++) {
    for (let x = 4; x < world.size - 6 && !at; x++) {
      const ore = (dx, dy) => world.map.ore[(y + dy) * world.size + x + dx];
      if ([ore(0, 0), ore(1, 0), ore(0, 1), ore(1, 1)].every((o) => o === ORE.IRON)) at = { x, y };
    }
  }
  const miner = place(world, "miner", at.x, at.y, 0);
  const out = outputTile(miner);
  const f = place(world, "furnace", out.x - 1, out.y - 1, 0);
  assert.ok(f, "the furnace fits in front of the chute");
  furnaceAdd(f, "coal", 5);
  run(world, 60 * 12);
  assert.ok(f.output.n >= 10);
  assert.equal(f.output.item, "iron-plate");
});

test("an inserter only picks up what the target can take", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6);
  const belt = place(world, "belt", x, y, 1);
  put(belt, "copper-ore");
  run(world, 20); // the copper reaches the front of the belt and waits
  put(belt, "iron-ore");
  const f = place(world, "furnace", x + 2, y, 1);
  furnaceAdd(f, "iron-ore", 1); // the furnace is on iron, so copper is no use to it
  const ins = place(world, "inserter", x + 1, y, 1);

  run(world, 1);
  assert.equal(ins.hand, "iron-ore", "it skips the copper to get the iron");
  assert.deepEqual(
    belt.items.map((it) => it.item),
    ["copper-ore"],
  );

  run(world, SWING * 2 + 10);
  assert.equal(f.input.n, 2);
  assert.equal(ins.hand, null);
  assert.equal(ins.status, "idle", "nothing left it can use");
  assert.deepEqual(
    belt.items.map((it) => it.item),
    ["copper-ore"],
  );
});

test("an inserter waits with nothing in hand when the target is full", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6);
  const from = place(world, "chest", x, y, 1);
  put(from, "iron-ore");
  const f = place(world, "furnace", x + 2, y, 1);
  furnaceAdd(f, "iron-ore", FEED); // full as far as machines go, and unlit so it stays full
  const ins = place(world, "inserter", x + 1, y, 1);
  run(world, SWING * 3);
  assert.equal(ins.hand, null);
  assert.equal(ins.status, "idle");
  assert.equal(count(from.inventory, "iron-ore"), 1);
});

test("an inserter swings across, drops, and swings back", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6);
  const from = place(world, "chest", x, y, 1);
  for (let i = 0; i < 3; i++) put(from, "iron-ore");
  const ins = place(world, "inserter", x + 1, y, 1);
  const to = place(world, "chest", x + 2, y, 1);

  run(world, 1);
  assert.equal(ins.hand, "iron-ore");
  assert.equal(ins.swing, 0);
  run(world, SWING);
  assert.equal(ins.swing, SWING, "the arm is over the target");
  assert.equal(total(to.inventory), 0);
  run(world, 1);
  assert.equal(total(to.inventory), 1);
  assert.equal(ins.hand, null);
  run(world, SWING);
  assert.equal(ins.swing, 0, "back over the source");
  run(world, 1);
  assert.equal(ins.hand, "iron-ore", "and picks up the next");
});

test("an inserter with nothing in front says so and picks up nothing", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6);
  const from = place(world, "chest", x, y, 1);
  put(from, "iron-ore");
  const ins = place(world, "inserter", x + 1, y, 1);
  run(world, 10);
  assert.equal(ins.status, "no-output");
  assert.equal(ins.hand, null);
});

test("an inserter takes plates out of a furnace, but never its ore or fuel", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6);
  const f = place(world, "furnace", x, y, 1);
  furnaceAdd(f, "iron-ore", 5);
  const ins = place(world, "inserter", x + 2, y, 1);
  const chest = place(world, "chest", x + 3, y, 1);
  run(world, 100);
  assert.equal(total(chest.inventory), 0, "no fuel: no plates, and the ore stays");
  furnaceAdd(f, "coal", 1);
  run(world, PLATE_TICKS * 5 + SWING * 2 + 5);
  assert.equal(count(chest.inventory, "iron-plate"), 5);
  assert.equal(total(chest.inventory), 5);
  assert.equal(ins.hand, null);
});

test("removing a furnace or inserter gives back what it holds", () => {
  const { world, furnace, loader, feed } = smelter();
  run(world, 60 * 10 + 30, feed);
  const f = refundOf(furnace);
  assert.equal(f.stone, BUILDINGS.furnace.cost.stone);
  assert.ok(f["iron-ore"] >= 1, "the ore it was smelting comes back");

  const before = count(world.inventory, "iron-plate");
  const held = furnace.output?.n || 0;
  removeAt(world, furnace.x, furnace.y);
  assert.equal(count(world.inventory, "iron-plate"), before + held);
  assert.equal(furnace.output, null, "and it's emptied");

  run(world, 70, feed);
  assert.equal(loader.status, "no-output");
  const hand = loader.hand;
  const r = refundOf(loader);
  assert.equal(r["iron-plate"], BUILDINGS.inserter.cost["iron-plate"]);
  if (hand) assert.equal(r[hand], 1);
});

test("a smelter saved mid-swing carries on exactly as it would have", () => {
  const { world, feed, loader } = smelter();
  run(world, 60 * 9 + 7, feed);
  assert.ok(loader.hand || loader.swing, "the loader is mid-swing");
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(serialize(loaded), serialize(world));
  run(world, 1500, feed);
  // `feed` puts items on the world's first belt; do the same on the loaded one.
  const first = [...loaded.entities.values()][0];
  run(loaded, 1500, (t) => {
    if (t % 60 === 0 && canTake(first, "iron-ore")) put(first, "iron-ore");
    if (t % 480 === 30 && canTake(first, "coal")) put(first, "coal");
  });
  assert.deepEqual(serialize(loaded), serialize(world));
});
