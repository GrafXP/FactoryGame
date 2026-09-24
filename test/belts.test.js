import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, removeAt, refundOf } from "../src/sim/world.js";
import { BUILDINGS, outputTile } from "../src/sim/buildings.js";
import { beltNetwork, canTake, put, BELT_LEN, BELT_SPEED, ITEM_GAP } from "../src/sim/transport.js";
import { count, total } from "../src/sim/inventory.js";
import { ORE } from "../src/sim/map.js";
import { TICK_RATE } from "../src/sim/world.js";

const TILE_TICKS = BELT_LEN / BELT_SPEED; // ticks for an item to cross one tile
const MAX_RATE = (TICK_RATE * BELT_SPEED) / ITEM_GAP; // items/s a belt carries at most

// A big kit and an empty area: the tests build at x, y >= 40 on seed 3's bare ground.
const setup = () => createWorld({ seed: 3, kit: { "iron-plate": 5000, "copper-plate": 100, stone: 100 } });
const run = (world, ticks, each) => {
  for (let i = 0; i < ticks; i++) {
    each?.();
    step(world);
  }
};
// Lays belts along a path of [x, y, rot].
const lay = (world, path) => path.map(([x, y, rot]) => place(world, "belt", x, y, rot));
// Keeps a belt topped up with iron ore, like an endless miner.
const feed = (world, belt) => () => canTake(belt, "iron-ore") && put(belt, "iron-ore");
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

test("an item rides a straight belt into a chest", () => {
  const world = setup();
  const { x, y } = clearArea(world, 8);
  const belts = lay(world, [0, 1, 2, 3].map((i) => [x + i, y, 1]));
  const chest = place(world, "chest", x + 4, y, 0);
  put(belts[0], "iron-ore"); // dropped on the middle of the first belt
  run(world, TILE_TICKS * 3);
  assert.equal(total(chest.inventory), 0, "still on its way");
  run(world, TILE_TICKS);
  assert.equal(count(chest.inventory, "iron-ore"), 1);
  assert.ok(belts.every((b) => b.items.length === 0));
});

test("items go round corners, and corners are drawn as corners", () => {
  const world = setup();
  const { x, y } = clearArea(world, 8);
  // East along the top, down (south) the side, then west: two right turns.
  const belts = lay(world, [
    [x, y, 1], [x + 1, y, 1], [x + 2, y, 2], [x + 2, y + 1, 2], [x + 2, y + 2, 3], [x + 1, y + 2, 3],
  ]);
  const chest = place(world, "chest", x, y + 2, 0);
  const { shape } = beltNetwork(world);
  assert.deepEqual(belts.map((b) => shape.get(b)), ["straight", "straight", "right", "straight", "right", "straight"]);
  put(belts[0], "iron-ore");
  run(world, TILE_TICKS * 7);
  assert.equal(count(chest.inventory, "iron-ore"), 1);
});

test("with nowhere to go, items bunch up at the end without overlapping", () => {
  const world = setup();
  const { x, y } = clearArea(world, 8);
  const belts = lay(world, [0, 1, 2].map((i) => [x + i, y, 1]));
  run(world, TICK_RATE * 10, feed(world, belts[0]));
  const all = belts.flatMap((b, i) => b.items.map((it) => i * BELT_LEN + it.pos)).sort((a, b) => b - a);
  assert.equal(all[0], 2 * BELT_LEN + BELT_LEN, "the front item waits at the last belt's edge");
  for (let i = 1; i < all.length; i++) assert.equal(all[i - 1] - all[i], ITEM_GAP, "packed exactly a gap apart");
  // The first belt only fills from its middle (that's where items are dropped).
  assert.equal(all.length, (2 * BELT_LEN) / ITEM_GAP + (BELT_LEN / 2) / ITEM_GAP + 1);
});

test("removing the chest at the end backs the line up; putting it back drains it", () => {
  const world = setup();
  const { x, y } = clearArea(world, 8);
  const belts = lay(world, [0, 1, 2].map((i) => [x + i, y, 1]));
  let chest = place(world, "chest", x + 3, y, 0);
  run(world, TICK_RATE * 3, feed(world, belts[0]));
  removeAt(world, x + 3, y);
  run(world, TICK_RATE * 5, feed(world, belts[0]));
  const stuck = belts.reduce((n, b) => n + b.items.length, 0);
  run(world, TICK_RATE * 2, feed(world, belts[0]));
  assert.equal(belts.reduce((n, b) => n + b.items.length, 0), stuck, "nothing moves while blocked");
  chest = place(world, "chest", x + 3, y, 0);
  run(world, TICK_RATE * 2);
  assert.ok(total(chest.inventory) > 0);
});

test("a belt's throughput is capped, and a merge can't beat it", () => {
  const world = setup();
  const { x, y } = clearArea(world, 10);
  // A main line heading east, with a side line joining from the north at x + 3.
  const main = lay(world, [0, 1, 2, 3, 4, 5].map((i) => [x + i, y + 3, 1]));
  const side = lay(world, [0, 1, 2].map((j) => [x + 3, y + j, 2]));
  const chest = place(world, "chest", x + 6, y + 3, 0);
  const { next } = beltNetwork(world);
  assert.equal(next.get(side[2]).mode, "side", "the side line side-loads onto the main line");

  // Let it fill up, then count what reaches the chest over 10 s, emptying it as we go.
  const both = () => (feed(world, main[0])(), feed(world, side[0])());
  run(world, TICK_RATE * 5, both);
  chest.inventory.items = {};
  let got = 0;
  run(world, TICK_RATE * 10, () => {
    both();
    got += total(chest.inventory);
    chest.inventory.items = {};
  });
  const rate = got / 10;
  assert.ok(rate <= MAX_RATE, `${rate}/s is over the cap`);
  assert.ok(rate > MAX_RATE * 0.9, `${rate}/s: the merged line should run nearly full`);
  assert.ok(side[2].items.length > 0 && main[2].items.length > 0, "both inputs are backed up");
});

test("belts facing each other head-on don't pass items", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6);
  const [a, b] = lay(world, [[x, y, 1], [x + 1, y, 3]]);
  put(a, "iron-ore");
  run(world, TILE_TICKS * 3);
  assert.equal(a.items.length, 1);
  assert.equal(a.items[0].pos, BELT_LEN);
  assert.equal(b.items.length, 0);
});

test("a miner drops its ore onto a belt, which carries it to a chest", () => {
  const world = setup();
  const i = world.map.ore.findIndex((o, i) =>
    o === ORE.IRON && world.map.ore[i + 1] === ORE.IRON && world.map.ore[i + world.size] === ORE.IRON && world.map.ore[i + world.size + 1] === ORE.IRON);
  const miner = place(world, "miner", i % world.size, Math.floor(i / world.size), 0);
  const out = outputTile(miner);
  // Belt from the output tile two tiles west, into a chest.
  lay(world, [[out.x, out.y, 3], [out.x - 1, out.y, 3]]);
  const chest = place(world, "chest", out.x - 2, out.y, 0);
  run(world, BUILDINGS.miner.period * 5 + TILE_TICKS * 3);
  assert.equal(miner.status, "working");
  assert.equal(count(chest.inventory, "iron-ore"), 5);
});

test("removing a belt gives back what's on it", () => {
  const world = setup();
  const { x, y } = clearArea(world, 4);
  const [b] = lay(world, [[x, y, 1]]);
  put(b, "iron-ore");
  assert.deepEqual(refundOf(b), { "iron-plate": 1, "iron-ore": 1 });
  const before = count(world.inventory, "iron-ore");
  removeAt(world, x, y);
  assert.equal(count(world.inventory, "iron-ore"), before + 1);
});

test("a closed loop of belts keeps running", () => {
  const world = setup();
  const { x, y } = clearArea(world, 4);
  const belts = lay(world, [[x, y, 1], [x + 1, y, 2], [x + 1, y + 1, 3], [x, y + 1, 0]]);
  for (const b of belts) put(b, "iron-ore");
  run(world, TILE_TICKS * 8);
  assert.equal(belts.reduce((n, b) => n + b.items.length, 0), 4, "nothing lost or duplicated");
  const positions = belts.flatMap((b) => b.items.map((it) => it.pos));
  assert.ok(positions.every((p) => p >= 0 && p <= BELT_LEN));
});
