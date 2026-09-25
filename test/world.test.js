import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, tileAt, place, entityAt, START_CHARTED } from "../src/sim/world.js";
import { ORE, WATER, CHUNK, generateChunk } from "../src/sim/map.js";
import { LIMIT, kindAt, amountAt, getChunk, isCharted, forgetChunks } from "../src/sim/chunks.js";
import { parseSeed } from "../src/sim/rng.js";
import { ALL, findKind } from "./helpers.js";

// What each tile is over a square of the map, as one string.
const picture = (world, x0, y0, n) => {
  let s = "";
  for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) s += kindAt(world, x, y);
  return s;
};

test("step advances the tick", () => {
  const world = createWorld();
  for (let i = 0; i < 120; i++) step(world);
  assert.equal(world.tick, 120);
});

test("the same seed gives the same map, whatever order it's explored in", () => {
  const a = createWorld({ seed: 42 });
  const b = createWorld({ seed: 42 });
  getChunk(b, 7, -3); // b sees a far chunk first
  assert.equal(picture(a, -100, -100, 200), picture(b, -100, -100, 200));
  assert.deepEqual(getChunk(a, 7, -3).amount, getChunk(b, 7, -3).amount);
  assert.deepEqual(generateChunk(42, -9, 4).ore, generateChunk(42, -9, 4).ore);
});

test("different seeds give different maps", () => {
  assert.notEqual(picture(createWorld({ seed: 42 }), -64, -64, 128), picture(createWorld({ seed: 43 }), -64, -64, 128));
});

test("the map goes on for ever, and is only made where something looks", () => {
  const world = createWorld({ seed: 3 });
  assert.equal(world.chunks.size, 0, "nothing is generated up front");
  const far = tileAt(world, 20000, -35000);
  assert.ok(far);
  assert.equal(world.chunks.size, 1);
});

test("every ore has a patch near the start, and the four are well apart, for many seeds", () => {
  for (let seed = 0; seed < 50; seed++) {
    const world = createWorld({ seed });
    const tiles = { [ORE.IRON]: [], [ORE.COPPER]: [], [ORE.COAL]: [], [ORE.STONE]: [] };
    for (let y = -50; y < 50; y++) for (let x = -50; x < 50; x++) tiles[kindAt(world, x, y)]?.push([x, y]);
    for (const ore of [ORE.IRON, ORE.COPPER, ORE.COAL, ORE.STONE]) {
      assert.ok(tiles[ore].length > 50, `seed ${seed} is missing ore ${ore} near the start`);
      for (const [x, y] of tiles[ore]) assert.ok(Math.hypot(x, y) > 15, `seed ${seed}: ore ${ore} right at the start`);
    }
    for (const a of [ORE.IRON, ORE.COPPER, ORE.COAL]) {
      for (const b of [ORE.COPPER, ORE.COAL, ORE.STONE].filter((k) => k > a)) {
        const gap = Math.min(...tiles[a].flatMap(([ax, ay]) => tiles[b].map(([bx, by]) => Math.hypot(ax - bx, ay - by))));
        assert.ok(gap >= 15, `seed ${seed}: ores ${a} and ${b} are ${gap.toFixed(1)} tiles apart`);
      }
    }
  }
});

test("the start stays dry, with a lake a short way off, for many seeds", () => {
  for (let seed = 0; seed < 20; seed++) {
    const world = createWorld({ seed });
    let nearest = Infinity;
    for (let y = -120; y < 120; y++) for (let x = -120; x < 120; x++) if (kindAt(world, x, y) === WATER) nearest = Math.min(nearest, Math.hypot(x, y));
    assert.ok(nearest >= 70 && nearest <= 110, `seed ${seed}: nearest water ${nearest.toFixed(0)} tiles out`);
  }
});

test("ore tiles hold resources and other tiles don't", () => {
  const world = createWorld({ seed: 7 });
  for (let y = -200; y < 200; y++) {
    for (let x = -200; x < 200; x++) {
      const kind = kindAt(world, x, y);
      if (kind > ORE.NONE && kind < WATER) assert.ok(amountAt(world, x, y) > 0);
      else assert.equal(amountAt(world, x, y), 0);
    }
  }
});

test("ore further out comes in bigger, richer patches", () => {
  const world = createWorld({ seed: 11 });
  const richest = (x0, y0, n) => {
    let most = 0;
    for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) most = Math.max(most, amountAt(world, x, y));
    return most;
  };
  assert.ok(richest(-1200, -1200, 400) > 2 * richest(-60, -60, 120));
});

test("a new game has the land round the start charted, and no more", () => {
  const world = createWorld({ seed: 3 });
  assert.equal(world.charted.size, (2 * START_CHARTED) ** 2);
  assert.ok(isCharted(world, 0, 0) && isCharted(world, -START_CHARTED, -START_CHARTED));
  assert.ok(!isCharted(world, START_CHARTED, 0));
  assert.equal(createWorld({ seed: 3, charted: false }).charted.size, 0);
});

test("tileAt reports the resource, and water, and rejects tiles off the map", () => {
  const world = createWorld({ milestones: ALL, seed: 3 });
  assert.equal(tileAt(world, LIMIT, 0), null);
  assert.equal(tileAt(world, 0, -LIMIT), null);
  assert.equal(tileAt(world, 1.5, 2), null);
  const iron = findKind(world, ORE.IRON);
  const tile = tileAt(world, iron.x, iron.y);
  assert.equal(tile.oreName, "Iron ore");
  assert.equal(tile.ore, ORE.IRON);
  assert.ok(tile.amount > 0);
  const lake = findKind(world, WATER, 200);
  const water = tileAt(world, lake.x, lake.y);
  assert.deepEqual([water.ore, water.water, water.oreName], [ORE.NONE, true, "Water"]);
  assert.equal(CHUNK, 32);
});

test("parseSeed keeps numbers and hashes text", () => {
  assert.equal(parseSeed("42"), 42);
  assert.equal(parseSeed("factory"), parseSeed("factory"));
  assert.notEqual(parseSeed("factory"), parseSeed("factorz"));
});

test("land far away with nothing on it can be let go of, and comes back the same", () => {
  const world = createWorld({ milestones: ALL, seed: 3 });
  const before = picture(world, 300, 300, 64);
  const built = place(world, "chest", 600, 600, 0);
  getChunk(world, 40, 40).changed = true; // as if dug into
  const kept = world.chunks.size;
  assert.ok(forgetChunks(world, -1, -1, 0, 0) > 0);
  assert.equal(world.chunks.size, 2, "only the one with a building and the dug one stay");
  assert.equal(entityAt(world, 600, 600), built);
  assert.equal(picture(world, 300, 300, 64), before);
  assert.ok(kept > 2);
});
