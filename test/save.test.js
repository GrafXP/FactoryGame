import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, entityAt, startMining } from "../src/sim/world.js";
import { outputTile } from "../src/sim/buildings.js";
import { count, total } from "../src/sim/inventory.js";
import { ORE, CHUNK } from "../src/sim/map.js";
import { chunkOf, tileIndex, isCharted } from "../src/sim/chunks.js";
import { serialize, deserialize, SaveError, SAVE_VERSION } from "../src/sim/save.js";
import { charge, ALL, oreBlock } from "./helpers.js";

const run = (world, ticks) => {
  for (let i = 0; i < ticks; i++) {
    charge(world);
    step(world);
  }
};
// What IndexedDB does to a save: a structured clone.
const roundTrip = (world) => deserialize(structuredClone(serialize(world)));

// The same save as it would have been before format 7: a 128×128 map with the
// start in its middle, and the buildings where they'd have been on it.
const HALF = 64;
const asVersion6 = (data, world) => {
  const size = 2 * HALF;
  const ore = new Uint8Array(size * size);
  const amount = new Uint32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = chunkOf(world, x - HALF, y - HALF);
      ore[y * size + x] = c.ore[tileIndex(x - HALF, y - HALF)];
      amount[y * size + x] = c.amount[tileIndex(x - HALF, y - HALF)];
    }
  }
  const { map, charted, ...rest } = data;
  return { ...rest, version: 6, size, map: { ore, amount }, entities: data.entities.map((e) => ({ ...e, x: e.x + HALF, y: e.y + HALF })) };
};

// A running factory: an east-facing miner on iron feeding a belt that turns a corner
// into a chest, with a second belt merging in from the side.
const factory = () => {
  const world = createWorld({ milestones: ALL, seed: 5, kit: { "iron-plate": 1000, "copper-plate": 100, "iron-gear": 1000, "electronic-circuit": 1000, stone: 100 } });
  const { x, y } = oreBlock(world, ORE.IRON);
  const miner = place(world, "miner", x, y, 1);
  const out = outputTile(miner);
  const belts = [];
  for (let i = 0; i < 4; i++) belts.push(place(world, "belt", out.x + i, out.y, 1));
  for (let j = 0; j < 3; j++) belts.push(place(world, "belt", out.x + 4, out.y + j, 2));
  const chest = place(world, "chest", out.x + 4, out.y + 3, 0);
  return { world, miner, belts, chest };
};

test("a fresh world survives a save and load unchanged", () => {
  const world = createWorld({ milestones: ALL, seed: 9 });
  const loaded = roundTrip(world);
  assert.deepEqual(serialize(loaded), serialize(world));
  assert.equal(loaded.seed, 9);
  assert.deepEqual(loaded.inventory.items, world.inventory.items);
});

test("a loaded factory carries on exactly as the saved one would have", () => {
  const { world, belts } = factory();
  run(world, 600);
  assert.ok(belts.some((b) => b.items.length), "items are mid-belt when saving");
  const loaded = roundTrip(world);
  assert.deepEqual(serialize(loaded), serialize(world));
  run(world, 1500);
  run(loaded, 1500);
  assert.deepEqual(serialize(loaded), serialize(world));
});

test("loading rebuilds the tile grid and keeps buildings, contents and mined ore", () => {
  const { world, miner, chest, belts } = factory();
  run(world, 900);
  const loaded = roundTrip(world);

  const m = entityAt(loaded, miner.x + 1, miner.y + 1);
  assert.equal(m.id, miner.id);
  assert.equal(m.type, "miner");
  assert.equal(m.rot, 1);
  assert.equal(m.progress, miner.progress);
  const c = entityAt(loaded, chest.x, chest.y);
  assert.ok(total(c.inventory) > 0);
  assert.equal(count(c.inventory, "iron-ore"), count(chest.inventory, "iron-ore"));
  assert.deepEqual(entityAt(loaded, belts[2].x, belts[2].y).items, belts[2].items);
  assert.deepEqual(chunkOf(loaded, miner.x, miner.y).amount, chunkOf(world, miner.x, miner.y).amount);
  assert.equal(loaded.tick, world.tick);

  // New buildings get fresh ids, and the saved world isn't tied to the loaded one.
  const b = place(loaded, "belt", 1, 1, 0);
  assert.equal(b.id, world.nextId);
  assert.equal(world.entities.size + 1, loaded.entities.size);
});

test("hand-mining isn't saved", () => {
  const world = createWorld({ milestones: ALL, seed: 5 });
  const { x, y } = oreBlock(world, ORE.IRON);
  assert.equal(startMining(world, x, y), null);
  assert.equal(roundTrip(world).mining, null);
});

test("a save from a newer version fails with a clear message", () => {
  const data = { ...serialize(createWorld({ milestones: ALL, seed: 2 })), version: SAVE_VERSION + 1 };
  assert.throws(() => deserialize(data), (err) => err instanceof SaveError && /newer version/.test(err.message));
});

test("an older save is migrated step by step", () => {
  const data = serialize(createWorld({ milestones: ALL, seed: 2 }));
  // Pretend the format is now 3: 1 → 2 renamed the inventory, 2 → 3 added some stone.
  const old = { ...data, version: 1, bag: data.inventory, inventory: undefined };
  const migrations = {
    1: ({ bag, ...rest }) => ({ ...rest, inventory: bag }),
    2: (d) => ({ ...d, inventory: { ...d.inventory, stone: (d.inventory.stone || 0) + 5 } }),
  };
  const world = deserialize(old, { migrations, version: 3 });
  assert.equal(count(world.inventory, "stone"), count(createWorld({ milestones: ALL, seed: 2 }).inventory, "stone") + 5);
});

test("only the chunks that have been dug into go in the save", () => {
  const { world, miner } = factory();
  run(world, 300);
  const data = serialize(world);
  assert.ok(world.chunks.size > 1);
  assert.deepEqual(
    data.map.chunks.map((c) => [c.cx, c.cy]),
    [[Math.floor(miner.x / CHUNK), Math.floor(miner.y / CHUNK)]],
    "just the chunk the miner is digging",
  );
  assert.equal(data.charted.length, 2 * world.charted.size);
});

test("a version 6 save keeps its map, moved so its middle is the start, and all of it charted", () => {
  const { world, miner, chest } = factory();
  run(world, 300);
  const loaded = deserialize(structuredClone(asVersion6(serialize(world), world)));
  assert.equal(loaded.charted.size, 16);
  assert.ok(isCharted(loaded, -2, -2) && isCharted(loaded, 1, 1));
  assert.equal(entityAt(loaded, miner.x, miner.y)?.id, miner.id);
  assert.equal(entityAt(loaded, chest.x, chest.y)?.type, "chest");
  for (const [x, y] of [[-64, -64], [miner.x, miner.y], [63, 63]]) {
    const [a, b] = [chunkOf(loaded, x, y), chunkOf(world, x, y)];
    assert.deepEqual([a.ore, a.amount], [b.ore, b.amount]);
    assert.ok(a.changed, "kept in the save from now on");
  }
});

test("a version 1 save (before furnaces) still loads", () => {
  const { world } = factory();
  run(world, 300);
  const v1 = { ...asVersion6(serialize(world), world), version: 1 };
  // Loading it as it was, apart from what came with power, milestones and the
  // endless map (see power.test.js and progress.test.js, and the test above).
  const withoutLater = ({ inventory, progress, entities, map, ...rest }) => ({ ...rest, entities: entities.map(({ energy, ...e }) => e) });
  assert.deepEqual(withoutLater(serialize(deserialize(structuredClone(v1)))), withoutLater(serialize(world)));
});

test("an older save with no way to migrate it fails with a clear message", () => {
  const data = serialize(createWorld({ milestones: ALL, seed: 2 }));
  assert.throws(
    () => deserialize(data, { migrations: {}, version: SAVE_VERSION + 1 }),
    (err) => err instanceof SaveError && /old version/.test(err.message),
  );
});

test("things that aren't saves, or are damaged, fail with a SaveError", () => {
  for (const junk of [null, 42, "save", {}, { format: "something-else", version: 1 }]) {
    assert.throws(() => deserialize(junk), (err) => err instanceof SaveError && /isn't a Factory save/.test(err.message));
  }
  const { world } = factory();
  run(world, 300);
  const good = serialize(world);
  const damaged = [
    { ...good, map: { chunks: [{ cx: 0, cy: 0, ore: new Uint8Array(3), amount: new Uint32Array(CHUNK * CHUNK) }] } },
    { ...good, map: { chunks: [{ cx: 0.5, cy: 0, ore: new Uint8Array(CHUNK * CHUNK), amount: new Uint32Array(CHUNK * CHUNK) }] } },
    { ...good, charted: [0, 0] },
    { ...good, entities: [...good.entities, { ...good.entities[0], id: 999 }] }, // overlaps
    { ...good, entities: [{ ...good.entities[0], type: "teleporter" }] },
    { ...good, inventory: { unobtainium: 3 } },
    { ...good, entities: good.entities.map((e) => (e.type === "belt" ? { ...e, items: [{ item: "iron-ore", pos: 99 }] } : e)) },
  ];
  for (const data of damaged) {
    assert.throws(() => deserialize(data), (err) => err instanceof SaveError && /damaged/.test(err.message));
  }
});
