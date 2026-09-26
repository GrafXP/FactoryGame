import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, removeAt, canPlace, startMining, stopMining, tileAt, MINE_TICKS } from "../src/sim/world.js";
import { createInventory, count, add, affordable, missing, take, give } from "../src/sim/inventory.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { START_KIT, describe } from "../src/sim/items.js";
import { ORE, WATER } from "../src/sim/map.js";
import { LIMIT, chunkOf, tileIndex, amountAt } from "../src/sim/chunks.js";
import { charge, ALL, findKind } from "./helpers.js";

const run = (world, ticks) => {
  for (let i = 0; i < ticks; i++) {
    charge(world);
    step(world);
  }
};

const findOre = findKind;

test("inventory counts, pays and refunds costs", () => {
  const inv = createInventory({ stone: 5 });
  add(inv, "iron-ore", 3);
  assert.equal(count(inv, "iron-ore"), 3);
  assert.equal(count(inv, "coal"), 0);
  const cost = { "iron-ore": 1, stone: 2 };
  assert.equal(affordable(inv, cost), 2);
  assert.equal(missing(inv, cost, 2), null);
  assert.deepEqual(missing(inv, cost, 4), { "iron-ore": 1, stone: 3 });

  const v = inv.version;
  assert.ok(take(inv, cost));
  assert.ok(inv.version > v);
  assert.deepEqual(inv.items, { stone: 3, "iron-ore": 2 });
  assert.equal(take(inv, { coal: 1 }), false);
  assert.deepEqual(inv.items, { stone: 3, "iron-ore": 2 }, "a failed take takes nothing");
  take(inv, { stone: 3 });
  assert.equal("stone" in inv.items, false, "empty stacks are dropped");
  give(inv, cost);
  assert.deepEqual(inv.items, { "iron-ore": 3, stone: 2 });
});

test("describe lists items in words", () => {
  assert.equal(describe({ "iron-ore": 8, stone: 6 }), "8 iron ore, 6 stone");
  assert.equal(describe({ "iron-plate": 2, "copper-plate": 1 }), "2 iron plates, 1 copper plate");
});

test("the starter kit builds machinery, while walls require smelted bricks", () => {
  const world = createWorld({ milestones: ALL, seed: 1 });
  assert.deepEqual(world.inventory.items, START_KIT);
  for (const type in BUILDINGS) {
    assert.equal(affordable(world.inventory, BUILDINGS[type].cost) >= 1, type !== "wall", type);
  }
});

test("placing pays the cost, and removing refunds it", () => {
  const world = createWorld({ milestones: ALL, seed: 1 });
  const before = { ...world.inventory.items };
  place(world, "miner", 10, 10, 0);
  for (const id in BUILDINGS.miner.cost) assert.equal(count(world.inventory, id), before[id] - BUILDINGS.miner.cost[id]);
  removeAt(world, 10, 10);
  assert.deepEqual(world.inventory.items, before);
});

test("you can't place what you can't pay for, and are told what's missing", () => {
  const world = createWorld({ milestones: ALL, seed: 1, kit: { "iron-plate": 5 } });
  assert.equal(canPlace(world, "miner", 10, 10, 0), "Missing 3 iron gears, 6 stone");
  assert.equal(place(world, "miner", 10, 10, 0), null);
  assert.equal(count(world.inventory, "iron-plate"), 5, "a refused placement costs nothing");
  assert.ok(place(world, "chest", 10, 10, 0));
  assert.equal(canPlace(world, "chest", 11, 10, 0), "Missing 3 iron plates");
  // A blocked tile is reported before the cost.
  assert.equal(canPlace(world, "chest", 10, 10, 0), "Something is in the way");
});

test("hand-mining an ore tile yields its item at a steady rate", () => {
  const world = createWorld({ milestones: ALL, seed: 5, kit: {} });
  const t = findOre(world, ORE.IRON);
  const amount = amountAt(world, t.x, t.y);
  assert.equal(startMining(world, t.x, t.y), null);
  run(world, MINE_TICKS - 1);
  assert.equal(count(world.inventory, "iron-ore"), 0);
  run(world, 1);
  assert.equal(count(world.inventory, "iron-ore"), 1);
  run(world, MINE_TICKS * 4);
  assert.equal(count(world.inventory, "iron-ore"), 5);
  assert.equal(amountAt(world, t.x, t.y), amount - 5, "mining uses up the tile");

  // Asking to mine the same tile again keeps the progress.
  run(world, 10);
  startMining(world, t.x, t.y);
  assert.equal(world.mining.progress, 10);

  stopMining(world);
  run(world, MINE_TICKS * 3);
  assert.equal(count(world.inventory, "iron-ore"), 5, "nothing more after stopping");
});

test("each ore gives its own item", () => {
  const world = createWorld({ milestones: ALL, seed: 5, kit: {} });
  for (const [ore, item] of [[ORE.COPPER, "copper-ore"], [ORE.COAL, "coal"], [ORE.STONE, "stone"]]) {
    const t = findOre(world, ore);
    startMining(world, t.x, t.y);
    run(world, MINE_TICKS);
    assert.equal(count(world.inventory, item), 1, item);
  }
});

test("only bare ore tiles can be mined", () => {
  const world = createWorld({ milestones: ALL, seed: 5 });
  const empty = findKind(world, ORE.NONE);
  assert.equal(startMining(world, empty.x, empty.y), "Nothing to mine here");
  const water = findKind(world, WATER, 200);
  assert.equal(startMining(world, water.x, water.y), "Nothing to mine here");
  assert.equal(startMining(world, LIMIT, 0), "Off the map");
  const t = findOre(world, ORE.IRON);
  place(world, "chest", t.x, t.y, 0);
  assert.equal(startMining(world, t.x, t.y), "There's a building in the way");
  assert.equal(world.mining, null);
});

test("a tile mined empty turns to ground and mining stops", () => {
  const world = createWorld({ milestones: ALL, seed: 5, kit: {} });
  const t = findOre(world, ORE.STONE);
  chunkOf(world, t.x, t.y).amount[tileIndex(t.x, t.y)] = 2;
  const v = world.mapVersion;
  startMining(world, t.x, t.y);
  run(world, MINE_TICKS * 5);
  assert.equal(count(world.inventory, "stone"), 2);
  assert.equal(tileAt(world, t.x, t.y).ore, ORE.NONE);
  assert.equal(amountAt(world, t.x, t.y), 0);
  assert.ok(world.mapVersion > v);
  assert.equal(world.mining, null);
});
