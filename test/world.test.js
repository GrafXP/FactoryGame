import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, tileAt } from "../src/sim/world.js";
import { ORE } from "../src/sim/map.js";
import { parseSeed } from "../src/sim/rng.js";
import { ALL } from "./helpers.js";

test("step advances the tick", () => {
  const world = createWorld();
  for (let i = 0; i < 120; i++) step(world);
  assert.equal(world.tick, 120);
});

test("the same seed gives the same map", () => {
  const a = createWorld({ milestones: ALL, seed: 42 });
  const b = createWorld({ milestones: ALL, seed: 42 });
  assert.deepEqual(a.map.ore, b.map.ore);
  assert.deepEqual(a.map.amount, b.map.amount);
});

test("different seeds give different maps", () => {
  const a = createWorld({ milestones: ALL, seed: 42 });
  const b = createWorld({ milestones: ALL, seed: 43 });
  assert.notDeepEqual(a.map.ore, b.map.ore);
});

test("every ore has a patch near the centre, for many seeds", () => {
  for (let seed = 0; seed < 50; seed++) {
    const world = createWorld({ milestones: ALL, seed });
    const mid = world.size / 2;
    const found = new Set();
    for (let y = mid - 22; y < mid + 22; y++) {
      for (let x = mid - 22; x < mid + 22; x++) found.add(tileAt(world, x, y).ore);
    }
    for (const ore of [ORE.IRON, ORE.COPPER, ORE.COAL, ORE.STONE]) {
      assert.ok(found.has(ore), `seed ${seed} is missing ore ${ore} near the centre`);
    }
  }
});

test("ore tiles hold resources and empty tiles don't", () => {
  const { map } = createWorld({ milestones: ALL, seed: 7 });
  for (let i = 0; i < map.ore.length; i++) {
    if (map.ore[i]) assert.ok(map.amount[i] > 0);
    else assert.equal(map.amount[i], 0);
  }
});

test("tileAt reports the resource and rejects tiles off the map", () => {
  const world = createWorld({ milestones: ALL, seed: 3 });
  assert.equal(tileAt(world, -1, 0), null);
  assert.equal(tileAt(world, 0, world.size), null);
  assert.equal(tileAt(world, 1.5, 2), null);
  const i = world.map.ore.findIndex((o) => o === ORE.IRON);
  const tile = tileAt(world, i % world.size, Math.floor(i / world.size));
  assert.equal(tile.oreName, "Iron ore");
  assert.ok(tile.amount > 0);
});

test("parseSeed keeps numbers and hashes text", () => {
  assert.equal(parseSeed("42"), 42);
  assert.equal(parseSeed("factory"), parseSeed("factory"));
  assert.notEqual(parseSeed("factory"), parseSeed("factorz"));
});
