import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, removeAt, takeAll, refundOf, oreLeftUnder, entityAt } from "../src/sim/world.js";
import { BUILDINGS, outputTile } from "../src/sim/buildings.js";
import { add, count, total } from "../src/sim/inventory.js";
import { ORE } from "../src/sim/map.js";
import { chunkOf, tileIndex } from "../src/sim/chunks.js";
import { charge, ALL, oreBlock } from "./helpers.js";

const PERIOD = BUILDINGS.miner.period;
const CAPACITY = BUILDINGS.chest.capacity;
const RICH = { "iron-plate": 1000, "copper-plate": 1000, "iron-gear": 1000, "electronic-circuit": 1000, stone: 1000 };

const run = (world, ticks) => {
  for (let i = 0; i < ticks; i++) {
    charge(world);
    step(world);
  }
};


// A world with a north-facing miner on iron and a chest at its output.
const setup = () => {
  const world = createWorld({ milestones: ALL, seed: 5, kit: RICH });
  const { x, y } = oreBlock(world, ORE.IRON);
  const miner = place(world, "miner", x, y, 0);
  const out = outputTile(miner);
  const chest = place(world, "chest", out.x, out.y, 0);
  return { world, miner, chest };
};

test("a miner's output tile is in front of its chute and turns with it", () => {
  const m = (rot) => outputTile({ type: "miner", x: 10, y: 10, rot });
  assert.deepEqual(m(0), { x: 10, y: 9 });
  assert.deepEqual(m(1), { x: 12, y: 10 });
  assert.deepEqual(m(2), { x: 11, y: 12 });
  assert.deepEqual(m(3), { x: 9, y: 11 });
});

test("a miner on ore with a chest in front fills the chest over time", () => {
  const { world, miner, chest } = setup();
  const ore = oreLeftUnder(world, miner);
  run(world, PERIOD - 1);
  assert.equal(total(chest.inventory), 0);
  run(world, 1);
  assert.equal(count(chest.inventory, "iron-ore"), 1);
  run(world, PERIOD * 9);
  assert.equal(count(chest.inventory, "iron-ore"), 10);
  assert.equal(miner.status, "working");
  assert.equal(oreLeftUnder(world, miner), ore - 10, "the ore comes out of the ground");
});

test("a miner not on ore says so and does nothing", () => {
  const world = createWorld({ milestones: ALL, seed: 5, kit: RICH });
  const { x, y } = oreBlock(world, ORE.NONE);
  const miner = place(world, "miner", x, y, 0);
  const out = outputTile(miner);
  const chest = place(world, "chest", out.x, out.y, 0);
  run(world, PERIOD * 3);
  assert.equal(miner.status, "no-resource");
  assert.equal(total(chest.inventory), 0);
});

test("a miner with nothing in front waits, and starts once a chest is placed", () => {
  const { world, miner, chest } = setup();
  removeAt(world, chest.x, chest.y);
  run(world, PERIOD * 3);
  assert.equal(miner.status, "no-output");
  const again = place(world, "chest", chest.x, chest.y, 0);
  run(world, PERIOD);
  assert.equal(count(again.inventory, "iron-ore"), 1);
});

test("a miner stops when the chest is full and carries on when it's emptied", () => {
  const { world, miner, chest } = setup();
  add(chest.inventory, "iron-ore", CAPACITY - 3); // a chest holds more than an ore patch
  run(world, PERIOD * 8);
  assert.equal(total(chest.inventory), CAPACITY);
  assert.equal(miner.status, "full");

  const before = count(world.inventory, "iron-ore");
  const taken = takeAll(world, chest);
  assert.deepEqual(taken, { "iron-ore": CAPACITY });
  assert.equal(count(world.inventory, "iron-ore"), before + CAPACITY, "taking moves items into the inventory");
  assert.equal(total(chest.inventory), 0);

  run(world, PERIOD);
  assert.equal(miner.status, "working");
  assert.equal(total(chest.inventory), 1);
});

test("removing a chest gives back its cost and its contents", () => {
  const { world, chest } = setup();
  run(world, PERIOD * 5);
  assert.deepEqual(refundOf(chest), { "iron-plate": 4, "iron-ore": 5 });
  const before = count(world.inventory, "iron-ore");
  removeAt(world, chest.x, chest.y);
  assert.equal(count(world.inventory, "iron-ore"), before + 5);
  assert.equal(entityAt(world, chest.x, chest.y), null);
});

test("a miner that mines out its ore stops", () => {
  const { world, miner, chest } = setup();
  for (let y = miner.y; y < miner.y + 2; y++) for (let x = miner.x; x < miner.x + 2; x++) chunkOf(world, x, y).amount[tileIndex(x, y)] = 1;
  const v = world.mapVersion;
  run(world, PERIOD * 6);
  assert.equal(total(chest.inventory), 4);
  assert.equal(miner.status, "no-resource");
  assert.ok(world.mapVersion > v, "the mined-out tiles are repainted");
});
