import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, canFit, entityAt, TICK_RATE } from "../src/sim/world.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { getChunk, forgetChunks, kindAt, isNestAt, CHUNK } from "../src/sim/chunks.js";
import { NEST, SAFE, WATER, nestsNear } from "../src/sim/map.js";
import { setRecipe } from "../src/sim/assembler.js";
import { serialize, deserialize } from "../src/sim/save.js";
import { emit } from "../src/sim/pollution.js";
import { damage, healthOf, rebuild, ruinAt, REPAIR_AFTER } from "../src/sim/health.js";
import {
  findPath,
  setEnemies,
  destroyNest,
  nestChunk,
  groupSize,
  unitsNear,
  GUARDS,
  NEST_ABSORB,
  HOME_CAP,
  ATTACK_REACH,
} from "../src/sim/enemies.js";
import { ALL, findTile } from "./helpers.js";

const SEED = 3;
const KIT = { "iron-plate": 5000, "iron-gear": 1000, "electronic-circuit": 1000, "copper-cable": 1000, stone: 2000, coal: 1000 };
const setup = (enemies = true) => createWorld({ milestones: ALL, seed: SEED, kit: { ...KIT }, enemies });
const run = (world, ticks) => {
  for (let i = 0; i < ticks; i++) step(world);
};
const MINUTE = 60 * TICK_RATE;

// The nest nearest the start, with its chunk made.
function nearestNest(world) {
  const all = nestsNear(world.seed, -600, -600, 600, 600);
  const n = all.reduce((a, b) => (Math.hypot(a.x, a.y) <= Math.hypot(b.x, b.y) ? a : b));
  getChunk(world, Math.floor(n.x / CHUNK), Math.floor(n.y / CHUNK));
  return world.nests.get(n.id);
}

// Top-left of a spot for a `type` building from `near` to `r` tiles of (x, y), east,
// west, south or north, on open ground.
function spotNear(world, type, x, y, r = 30, near = 6) {
  for (let d = near; d < r; d++) {
    for (const [dx, dy] of [
      [d, 0],
      [-d, 0],
      [0, d],
      [0, -d],
    ]) {
      if (!canFit(world, type, x + dx, y + dy, 0) && kindAt(world, x + dx, y + dy) === 0) return { x: x + dx, y: y + dy };
    }
  }
  throw new Error("no spot");
}

// A world with enemies on, a lone miner near the nearest nest (`near` tiles or more
// from it) and that nest given enough pollution to send a group.
function attack(enemies = true, near = 6) {
  const world = setup(enemies);
  const n = nearestNest(world);
  const at = spotNear(world, "miner", n.x, n.y, near + 30, near);
  const miner = place(world, "miner", at.x, at.y, 0);
  emit(world, nestChunk(world, n), 60 * NEST_ABSORB); // half a minute of what it can take in
  return { world, n, miner };
}

test("nests are never near the start, on water or on each other, and come back the same", () => {
  const world = setup();
  const all = nestsNear(SEED, -1500, -1500, 1500, 1500);
  assert.ok(all.length > 50);
  const taken = new Set();
  for (const n of all) {
    assert.ok(Math.hypot(n.x + NEST / 2, n.y + NEST / 2) >= SAFE, "outside the safe zone");
    for (let y = n.y; y < n.y + NEST; y++) {
      for (let x = n.x; x < n.x + NEST; x++) {
        assert.ok(!taken.has(`${x},${y}`), "nests don't overlap");
        taken.add(`${x},${y}`);
        assert.notEqual(kindAt(world, x, y), WATER);
        assert.ok(isNestAt(world, x, y));
      }
    }
  }
  assert.deepEqual(nestsNear(SEED, -1500, -1500, 1500, 1500), all, "the same every time");
  const n = all[0];
  assert.equal(canFit(world, "chest", n.x + 1, n.y + 1, 0), "A nest is in the way");
  forgetChunks(world, 0, 0, 0, 0);
  assert.ok(isNestAt(world, n.x, n.y), "a forgotten chunk comes back with its nests");
});

test("a destroyed nest is gone for good, and evolution goes up", () => {
  const world = setup();
  const n = nearestNest(world);
  const before = world.enemies.evolution;
  destroyNest(world, n.id);
  assert.ok(world.enemies.evolution > before);
  assert.ok(!isNestAt(world, n.x, n.y));
  assert.equal(canFit(world, "chest", n.x, n.y, 0), null, "its land can be built on");
  forgetChunks(world, 0, 0, 0, 0);
  assert.ok(!isNestAt(world, n.x, n.y), "it isn't made again");
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.ok(!isNestAt(loaded, n.x, n.y), "nor after loading");
});

test("a nest takes in the pollution that reaches it and hatches units, but in peaceful mode never attacks", () => {
  const { world, n } = attack(false);
  run(world, 2 * MINUTE);
  const s = world.enemies.nests.get(n.id);
  assert.ok(s.home.length > GUARDS + groupSize(0), `it hatched ${s.home.length}`);
  assert.ok(s.home.length <= HOME_CAP);
  assert.equal(world.enemies.groups.size, 0);
  assert.equal(world.enemies.units.size, 0, "units at home aren't simulated");
  assert.ok(world.enemies.evolution > 0);
});

test("with enemies on, a nest sends a group that destroys a lone miner and leaves a ruin", () => {
  const { world, n, miner } = attack();
  let sent = null;
  for (let t = 0; t < 2 * MINUTE && world.entities.has(miner.id); t++) {
    step(world);
    sent ||= [...world.enemies.groups.values()][0];
  }
  assert.ok(sent, "a group went out");
  assert.equal(Math.floor(sent.nest / 8), Math.floor(n.id / 8), "from the nest's base");
  assert.ok(!world.entities.has(miner.id), "the miner was destroyed");
  const ruin = ruinAt(world, miner.x, miner.y);
  assert.deepEqual({ type: ruin.type, x: ruin.x, y: ruin.y, rot: ruin.rot }, { type: "miner", x: miner.x, y: miner.y, rot: 0 });
  assert.deepEqual(
    world.alerts.map((a) => a.kind),
    ["attacked", "destroyed"],
  );
  // With nothing else near, the group goes home and its units rejoin the nest.
  run(world, MINUTE);
  assert.equal(world.enemies.groups.size, 0);
  assert.equal(world.enemies.units.size, 0);
  assert.ok(world.enemies.nests.get(n.id).home.length >= GUARDS + groupSize(0));
});

test("a group sent out is kept to its target's range", () => {
  const world = setup();
  const n = nearestNest(world);
  // A miner far out of reach isn't attacked.
  const d = Math.hypot(n.x, n.y);
  const far = spotNear(world, "miner", Math.round(n.x - (n.x / d) * (ATTACK_REACH + 20)), Math.round(n.y - (n.y / d) * (ATTACK_REACH + 20)));
  assert.ok(place(world, "miner", far.x, far.y, 0));
  emit(world, nestChunk(world, n), 60 * NEST_ABSORB);
  run(world, 2 * MINUTE);
  assert.equal(world.enemies.groups.size, 0);
});

test("turning the enemies off sends groups home", () => {
  const { world, n } = attack();
  while (!world.enemies.units.size) step(world);
  run(world, 3 * TICK_RATE);
  setEnemies(world, false);
  run(world, MINUTE);
  assert.equal(world.enemies.units.size, 0);
  assert.equal(world.enemies.groups.size, 0);
  assert.ok(world.enemies.nests.get(n.id).home.length >= GUARDS + groupSize(0));
});

test("a save made during an attack carries on tick for tick", () => {
  const { world } = attack();
  while (!world.enemies.units.size) step(world);
  run(world, 2 * TICK_RATE + 17);
  const loaded = deserialize(structuredClone(serialize(world)));
  const same = (a, b) => {
    const pick = (w) => {
      const s = serialize(w);
      return { enemies: s.enemies, damaged: s.damaged, ruins: s.ruins, entities: s.entities, pollution: s.pollution };
    };
    assert.deepEqual(pick(a), pick(b));
  };
  same(loaded, world);
  for (let i = 0; i < 4; i++) {
    run(world, 15 * TICK_RATE);
    run(loaded, 15 * TICK_RATE);
    same(loaded, world);
  }
  assert.ok(world.ruins.length > 0, "the attack got somewhere");
});

test("a long path search is spread over ticks, and a save made during one carries on the same", () => {
  const { world, miner } = attack(true, 30);
  // Two rings of chests round the miner, so the search has a lot to look at before
  // it goes through them.
  for (const r of [2, 3]) {
    for (let d = -r; d <= r + 1; d++) {
      for (const [x, y] of [
        [miner.x + d, miner.y - r],
        [miner.x + d, miner.y + 1 + r],
        [miner.x - r, miner.y + d],
        [miner.x + 1 + r, miner.y + d],
      ]) {
        if (!canFit(world, "chest", x, y, 0)) place(world, "chest", x, y, 0);
      }
    }
  }
  let ticks = 0;
  while (!world.enemies.search) {
    step(world);
    assert.ok(++ticks < 2 * MINUTE, "a search started");
  }
  step(world);
  assert.ok(world.enemies.search, "still going a tick later");
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(serialize(loaded).enemies, serialize(world).enemies);
  while (world.enemies.search) {
    step(world);
    step(loaded);
  }
  assert.equal(loaded.enemies.search, null, "the loaded one finishes on the same tick");
  run(world, 20 * TICK_RATE);
  run(loaded, 20 * TICK_RATE);
  const pick = (w) => {
    const d = serialize(w);
    return { enemies: d.enemies, ruins: d.ruins, damaged: d.damaged };
  };
  assert.deepEqual(pick(loaded), pick(world));
  assert.ok([...world.enemies.groups.values()].some((g) => g.path), "the group got its path");
});

test("paths go round a lake", () => {
  const world = setup();
  // A water tile with dry land 12 tiles to its west and east.
  const lake = findTile(
    world,
    (x, y) => kindAt(world, x, y) === WATER && kindAt(world, x - 14, y) !== WATER && kindAt(world, x + 14, y) !== WATER && kindAt(world, x - 14, y) === 0,
    200,
  );
  let west = lake.x;
  while (kindAt(world, west - 1, lake.y) === WATER) west--;
  let east = lake.x;
  while (kindAt(world, east + 1, lake.y) === WATER) east++;
  const from = { x: west - 3, y: lake.y };
  const goal = { x: east + 3, y: lake.y, w: 1, h: 1 };
  const path = findPath(world, from, goal);
  assert.ok(path, "there's a way round");
  for (let i = 0; i < path.length; i += 2) assert.notEqual(kindAt(world, path[i], path[i + 1]), WATER);
});

test("paths go round a short wall and through a long one", () => {
  const world = setup();
  // Open ground from 2 tiles west of the start to past the goal, 32 tiles north and south.
  let area = null;
  for (let y = -120; y < 120 && !area; y += 8) {
    for (let x = -120; x < 120 && !area; x += 8) {
      let open = true;
      for (let j = -32; j <= 32 && open; j++) for (let i = -2; i <= 24 && open; i++) open = kindAt(world, x + i, y + j) === 0 && !isNestAt(world, x + i, y + j);
      if (open) area = { x, y };
    }
  }
  assert.ok(area, "an open area");
  const from = { x: area.x, y: area.y };
  const goal = { x: area.x + 20, y: area.y, w: 2, h: 2 };
  const wallAt = (half) => {
    const built = [];
    for (let j = -half; j <= half; j++) if (!entityAt(world, area.x + 10, area.y + j)) built.push(place(world, "chest", area.x + 10, area.y + j, 0));
    assert.ok(built.every(Boolean));
    return built;
  };
  const crosses = (path) => {
    for (let i = 0; i < path.length; i += 2) if (entityAt(world, path[i], path[i + 1])?.type === "chest") return true;
    return false;
  };
  wallAt(3);
  assert.ok(!crosses(findPath(world, from, goal)), "round a wall of 7");
  wallAt(30);
  assert.ok(crosses(findPath(world, from, goal)), "through a wall of 61");
});

test("buildings repair themselves once they haven't been hit for 10 s", () => {
  const world = setup(false);
  const at = spotNear(world, "chest", 0, 0);
  const chest = place(world, "chest", at.x, at.y, 0);
  run(world, 5);
  damage(world, chest, 150);
  assert.equal(healthOf(world, chest), 50);
  run(world, REPAIR_AFTER - TICK_RATE);
  assert.equal(healthOf(world, chest), 50, "not while it's still being fought over");
  run(world, MINUTE);
  assert.equal(healthOf(world, chest), BUILDINGS.chest.health);
  assert.equal(world.damaged.size, 0);
  assert.equal(world.alerts[0].kind, "attacked");
});

test("rebuilding puts destroyed buildings back as they were, and pays for them", () => {
  const world = setup(false);
  const at = spotNear(world, "assembler", 0, 0);
  const a = place(world, "assembler", at.x, at.y, 1);
  setRecipe(a, "copper-cable", world.inventory);
  const s = place(world, "sorter", at.x + 3, at.y, 2);
  s.filters = ["iron-plate", "any", "overflow"];
  damage(world, a, 10_000);
  damage(world, s, 10_000);
  assert.equal(world.ruins.length, 2);
  assert.equal(entityAt(world, at.x, at.y), null);
  const before = world.inventory.items["iron-plate"];
  const r = rebuild(world);
  assert.equal(r.built.length, 2);
  assert.equal(world.ruins.length, 0);
  const a2 = entityAt(world, at.x, at.y);
  assert.deepEqual([a2.type, a2.rot, a2.recipe], ["assembler", 1, "copper-cable"]);
  assert.deepEqual(entityAt(world, at.x + 3, at.y).filters, ["iron-plate", "any", "overflow"]);
  assert.equal(world.inventory.items["iron-plate"], before - BUILDINGS.assembler.cost["iron-plate"] - BUILDINGS.sorter.cost["iron-plate"]);
});

test("building over a ruin clears it", () => {
  const world = setup(false);
  const at = spotNear(world, "chest", 0, 0);
  damage(world, place(world, "chest", at.x, at.y, 0), 10_000);
  assert.ok(ruinAt(world, at.x, at.y));
  place(world, "belt", at.x, at.y, 0);
  assert.equal(ruinAt(world, at.x, at.y), null);
});

test("units are kept by chunk for looking up who's near", () => {
  const { world } = attack();
  while (!world.enemies.units.size) step(world);
  run(world, TICK_RATE);
  const [u] = world.enemies.units.values();
  assert.ok(unitsNear(world, u.x / 256, u.y / 256, 1).includes(u));
  let n = 0;
  for (const set of world.enemies.byChunk.values()) n += set.size;
  assert.equal(n, world.enemies.units.size);
});
