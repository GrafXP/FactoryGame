import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, removeAt, canPlace, startMining, stopMining, tileAt, MINE_TICKS } from "../src/sim/world.js";
import { createInventory, count, add, affordable, missing, take, give } from "../src/sim/inventory.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { START_KIT, describe } from "../src/sim/items.js";
import { ORE } from "../src/sim/map.js";
import { charge, ALL } from "./helpers.js";

const run = (world, ticks) => {
  for (let i = 0; i < ticks; i++) {
    charge(world);
    step(world);
  }
};

// First tile holding `ore`, as { x, y, i }.
const findOre = (world, ore) => {
  const i = world.map.ore.findIndex((o) => o === ore);
  return { x: i % world.size, y: Math.floor(i / world.size), i };
};

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

test("a new game starts with the kit, and every building is affordable from it", () => {
  const world = createWorld({ milestones: ALL, seed: 1 });
  assert.deepEqual(world.inventory.items, START_KIT);
  for (const type in BUILDINGS) assert.ok(affordable(world.inventory, BUILDINGS[type].cost) >= 1, type);
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
  const amount = world.map.amount[t.i];
  assert.equal(startMining(world, t.x, t.y), null);
  run(world, MINE_TICKS - 1);
  assert.equal(count(world.inventory, "iron-ore"), 0);
  run(world, 1);
  assert.equal(count(world.inventory, "iron-ore"), 1);
  run(world, MINE_TICKS * 4);
  assert.equal(count(world.inventory, "iron-ore"), 5);
  assert.equal(world.map.amount[t.i], amount - 5, "mining uses up the tile");

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
  const empty = world.map.ore.findIndex((o) => o === ORE.NONE);
  assert.equal(startMining(world, empty % world.size, Math.floor(empty / world.size)), "Nothing to mine here");
  assert.equal(startMining(world, -1, 0), "Off the map");
  const t = findOre(world, ORE.IRON);
  place(world, "chest", t.x, t.y, 0);
  assert.equal(startMining(world, t.x, t.y), "There's a building in the way");
  assert.equal(world.mining, null);
});

test("a tile mined empty turns to ground and mining stops", () => {
  const world = createWorld({ milestones: ALL, seed: 5, kit: {} });
  const t = findOre(world, ORE.STONE);
  world.map.amount[t.i] = 2;
  const v = world.mapVersion;
  startMining(world, t.x, t.y);
  run(world, MINE_TICKS * 5);
  assert.equal(count(world.inventory, "stone"), 2);
  assert.equal(tileAt(world, t.x, t.y).ore, ORE.NONE);
  assert.equal(world.map.amount[t.i], 0);
  assert.ok(world.mapVersion > v);
  assert.equal(world.mining, null);
});
