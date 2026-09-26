import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, canFit, entityAt, TICK_RATE } from "../src/sim/world.js";
import { BUILDINGS, footprint } from "../src/sim/buildings.js";
import { getChunk, forgetChunks, isNestAt, chart, CHUNK } from "../src/sim/chunks.js";
import { NEST, SAFE, WATER, nestsNear } from "../src/sim/map.js";
import { kindAt } from "../src/sim/chunks.js";
import { serialize, deserialize } from "../src/sim/save.js";
import { emit } from "../src/sim/pollution.js";
import { turretAdd, stepTurret, AMMO } from "../src/sim/turret.js";
import { healthOf } from "../src/sim/health.js";
import { MILESTONES, recipeUnlocked, recipeMilestone } from "../src/sim/progress.js";
import { RECIPES } from "../src/sim/recipes.js";
import {
  addUnit,
  baseKey,
  baseNestsOf,
  baseInfo,
  baseNear,
  chartedBases,
  hitNest,
  nestChunk,
  siteFree,
  setEnemies,
  tierOf,
  EXPANSION,
  GUARDS,
  NEST_HEALTH,
  UNITS,
  TILE,
  BRUTE,
  SPITTER,
  MITE,
} from "../src/sim/enemies.js";
import { ALL } from "./helpers.js";

const SEED = 3;
const KIT = { "iron-plate": 5000, "iron-gear": 1000, "copper-plate": 1000, "stone-brick": 5000, stone: 1000, "firearm-magazine": 200 };
const setup = (enemies = true) => createWorld({ seed: SEED, milestones: ALL, kit: { ...KIT }, enemies });
const run = (world, ticks) => {
  for (let i = 0; i < ticks; i++) step(world);
};
const MINUTE = 60 * TICK_RATE;

// The nest nearest the start, with its chunk made.
function nearestNest(world) {
  const n = nestsNear(world.seed, -600, -600, 600, 600).reduce((a, b) => (Math.hypot(a.x, a.y) <= Math.hypot(b.x, b.y) ? a : b));
  getChunk(world, Math.floor(n.x / CHUNK), Math.floor(n.y / CHUNK));
  return world.nests.get(n.id);
}

// Four turrets `d` tiles from nest n towards the start, each loaded with 10 magazines.
function creep(world, n, d = 14) {
  const len = Math.hypot(n.x, n.y);
  const x = Math.round(n.x - (n.x / len) * d);
  const y = Math.round(n.y - (n.y / len) * d);
  const turrets = [];
  for (const [dx, dy] of [[0, 0], [3, 0], [0, 3], [3, 3]]) {
    let t = null;
    for (let r = 0; r < 6 && !t; r++) t = place(world, "turret", x + dx + r, y + dy, 0);
    assert.ok(t, "room for a turret");
    turretAdd(t, "firearm-magazine", 10);
    turrets.push(t);
  }
  return turrets;
}

// Whether any building's footprint comes within `r` tiles of nest n's.
function buildingWithin(world, n, r) {
  return [...world.entities.values()].some((e) => {
    const { w, h } = footprint(e.type, e.rot);
    return e.x < n.x + NEST + r && e.x + w > n.x - r && e.y < n.y + NEST + r && e.y + h > n.y - r;
  });
}

test("turrets clear a base, its defenders come out, and its land stays clear to build on", () => {
  const world = setup();
  const n = nearestNest(world);
  const key = baseKey(n.id);
  const base = baseNestsOf(world, key);
  assert.ok(base.length >= 2);
  const evolution = world.enemies.evolution;
  const turrets = creep(world, n);
  let defended = false;
  for (let t = 0; t < MINUTE && baseNestsOf(world, key).length; t++) {
    step(world);
    defended ||= [...world.enemies.groups.values()].some((g) => g.kind === "defend");
  }
  assert.equal(baseNestsOf(world, key).length, 0, "the base is cleared");
  assert.ok(defended, "its guards came out");
  assert.ok(turrets.every((t) => world.entities.has(t.id)));
  assert.ok(turrets.reduce((k, t) => k + t.kills, 0) >= base.length, "kills count the nests");
  assert.ok(world.enemies.evolution > evolution);
  const kinds = world.alerts.map((a) => a.kind);
  assert.equal(kinds.filter((k) => k === "nest").length, base.length - 1);
  assert.equal(kinds.at(-1), "cleared");
  run(world, 10 * TICK_RATE);
  assert.equal(world.enemies.units.size, 0, "no defenders are left");
  // The land is free, and stays so: forgetting the chunks and loading a save
  // bring no nest back, and none can be founded so near the turrets.
  const free = (w) => base.every((m) => !isNestAt(w, m.x, m.y) && canFit(w, "chest", m.x + 1, m.y + 1, 0) === null);
  assert.ok(free(world));
  forgetChunks(world, 0, 0, 0, 0);
  assert.ok(free(world));
  assert.ok(free(deserialize(structuredClone(serialize(world)))));
  for (const m of base) assert.equal(siteFree(world, m.x, m.y), false);
  assert.ok(place(world, "chest", base[0].x + 1, base[0].y + 1, 0), "can be built on");
});

test("a save made while clearing a base carries on tick for tick", () => {
  const world = setup();
  const n = nearestNest(world);
  creep(world, n);
  run(world, 3 * TICK_RATE + 11);
  assert.ok(world.enemies.units.size > 0 || world.enemies.nests.get(n.id)?.hp < NEST_HEALTH, "the fight is on");
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(serialize(loaded), serialize(world));
  for (let i = 0; i < 3; i++) {
    run(world, 5 * TICK_RATE);
    run(loaded, 5 * TICK_RATE);
    assert.deepEqual(serialize(loaded), serialize(world));
  }
});

test("a nest mends once it hasn't been hit for a while", () => {
  const world = setup(false);
  const n = nearestNest(world);
  const [t] = creep(world, n, 40); // out of range: only the hits below count
  hitNest(world, n.id, 100, t);
  assert.equal(world.enemies.nests.get(n.id).hp, NEST_HEALTH - 100);
  run(world, 9 * TICK_RATE);
  assert.equal(world.enemies.nests.get(n.id).hp, NEST_HEALTH - 100, "not while it's being fought over");
  run(world, 2 * MINUTE);
  assert.equal(world.enemies.nests.get(n.id).hp, NEST_HEALTH);
});

test("in peaceful mode a base only fights back once attacked, and turrets only shoot its defenders", () => {
  const world = setup(false);
  const n = nearestNest(world);
  // The base has soaked up pollution and has units at home, and a turret in range.
  emit(world, nestChunk(world, n), 60 * 2 * 3600);
  run(world, MINUTE);
  const key = baseKey(n.id);
  assert.ok(baseInfo(world, key).units > GUARDS * baseNestsOf(world, key).length);
  assert.equal(world.enemies.groups.size, 0, "no attacks");
  const turrets = creep(world, n);
  let defenders = 0;
  for (let t = 0; t < 2 * MINUTE && baseNestsOf(world, key).length; t++) {
    step(world);
    for (const g of world.enemies.groups.values()) {
      assert.equal(g.kind, "defend");
      defenders = Math.max(defenders, g.units.length);
    }
  }
  assert.ok(defenders > 0, "defenders came out");
  assert.ok(turrets.reduce((k, t) => k + t.kills, 0) > baseNestsOf(world, key).length, "and were shot");
  // An attack group isn't shot in peaceful mode.
  setEnemies(world, false);
  const t = turrets.find((x) => world.entities.has(x.id));
  const en = world.enemies;
  const g = { id: en.nextId++, nest: n.id, kind: "attack", target: t.id, goal: { x: t.x, y: t.y, w: 2, h: 2 }, path: null, mode: "plan", units: [], hit: -1 };
  en.groups.set(g.id, g);
  const u = { id: en.nextId++, group: g.id, kind: MITE, x: (t.x + 5) * TILE, y: t.y * TILE, ox: 0, oy: 0, hp: 15, cool: 0, step: 0, target: 0, dx: 0, dy: 0, key: 0 };
  addUnit(world, u);
  g.units.push(u.id);
  world.tick++;
  stepTurret(world, t);
  assert.equal(u.hp, 15);
  g.kind = "defend";
  for (let i = 0; i < 20; i++) {
    world.tick++;
    stepTurret(world, t);
  }
  assert.ok(u.hp < 15 || !en.units.has(u.id), "a defender is");
});

test("piercing magazines kill brutes clearly faster than firearm magazines", () => {
  const ticksToKill = (item) => {
    const world = setup();
    const t = place(world, "turret", 0, 0, 0);
    turretAdd(t, item, 10);
    const en = world.enemies;
    const n = nestsNear(world.seed, -600, -600, 600, 600)[0];
    const g = { id: en.nextId++, nest: n.id, kind: "attack", target: t.id, goal: { x: 0, y: 0, w: 2, h: 2 }, path: null, mode: "plan", units: [], hit: -1 };
    en.groups.set(g.id, g);
    const u = { id: en.nextId++, group: g.id, kind: BRUTE, x: 8 * TILE, y: TILE, ox: 0, oy: 0, hp: UNITS[BRUTE].hp, cool: 0, step: 0, target: 0, dx: 0, dy: 0, key: 0 };
    addUnit(world, u);
    g.units.push(u.id);
    // Hold the brute still: only the turret moves.
    let ticks = 0;
    while (en.units.has(u.id)) {
      world.tick++;
      ticks++;
      stepTurret(world, t);
    }
    return ticks;
  };
  const firearm = ticksToKill("firearm-magazine");
  const piercing = ticksToKill("piercing-magazine");
  assert.ok(piercing * 3 < firearm, `piercing ${piercing} ticks, firearm ${firearm}`);
  assert.ok(AMMO["piercing-magazine"].damage > AMMO["firearm-magazine"].damage);
});

test("milestone 4, Defense, asks for magazines and bricks and unlocks piercing magazines; circuit production is 5", () => {
  const defense = MILESTONES[3];
  assert.equal(defense.name, "Defense");
  assert.ok(defense.needs["firearm-magazine"] > 0 && defense.needs["stone-brick"] > 0);
  assert.deepEqual(defense.unlocks.recipes, ["piercing-magazine"]);
  assert.equal(recipeMilestone("piercing-magazine"), 3);
  assert.equal(MILESTONES[4].name, "Circuit production");
  assert.deepEqual(RECIPES["piercing-magazine"].in, { "firearm-magazine": 1, "copper-plate": 2, "iron-gear": 1 });
  const world = createWorld({ seed: SEED, milestones: 3 });
  assert.equal(recipeUnlocked(world, "piercing-magazine"), false);
  world.progress.milestone = 4;
  assert.equal(recipeUnlocked(world, "piercing-magazine"), true);
});

// A save as format 11 wrote it: no nest health, founded nests, group kinds or turret nests.
function asVersion11(data) {
  const { founded, expandAt, ...enemies } = data.enemies;
  return {
    ...data,
    version: 11,
    entities: data.entities.map(({ nest, ...e }) => e),
    enemies: {
      ...enemies,
      nests: enemies.nests.map(({ hp, hit, ...s }) => s),
      groups: enemies.groups.map(({ kind, ...g }) => g),
      search: enemies.search && (({ solid, ...s }) => s)(enemies.search),
    },
  };
}

test("a version 11 save keeps its place in the milestones, with Defense done if it was past it", () => {
  const world = setup();
  world.progress.milestone = 3; // circuit production, as it was
  world.progress.delivered = { "electronic-circuit": 40 };
  const loaded = deserialize(structuredClone(asVersion11(serialize(world))));
  assert.equal(loaded.progress.milestone, 4);
  assert.equal(MILESTONES[loaded.progress.milestone].name, "Circuit production");
  assert.deepEqual(loaded.progress.delivered, { "electronic-circuit": 40 });
  assert.equal(recipeUnlocked(loaded, "piercing-magazine"), true);
  world.progress.milestone = 2;
  world.progress.delivered = {};
  assert.equal(deserialize(structuredClone(asVersion11(serialize(world)))).progress.milestone, 2);
});

test("a version 11 save during an attack loads with its groups attacking and its nests whole", () => {
  const world = setup();
  const n = nearestNest(world);
  const len = Math.hypot(n.x, n.y);
  const miner = place(world, "miner", Math.round(n.x - (n.x / len) * 10), Math.round(n.y - (n.y / len) * 10), 0);
  assert.ok(miner);
  emit(world, nestChunk(world, n), 60 * 2 * 3600);
  while (!world.enemies.groups.size) step(world);
  const loaded = deserialize(structuredClone(asVersion11(serialize(world))));
  assert.ok([...loaded.enemies.groups.values()].every((g) => g.kind === "attack"));
  assert.ok([...loaded.enemies.nests.values()].every((s) => s.hp === NEST_HEALTH));
  assert.equal(loaded.enemies.founded.size, 0);
  assert.equal(loaded.enemies.expandAt, world.tick + EXPANSION.every);
  run(loaded, MINUTE);
});

// A world where the nearest nest has soaked up pollution for a while, with a line
// of chests 40 tiles from it towards the start. Returns it, the nest and a step
// that keeps the nest fed.
function spreading(enemies) {
  const world = setup(enemies);
  const n = nearestNest(world);
  const len = Math.hypot(n.x, n.y);
  const cx = Math.round(n.x - (n.x / len) * 40);
  const cy = Math.round(n.y - (n.y / len) * 40);
  for (let i = -5; i <= 5; i++) place(world, "chest", cx + i, cy, 0);
  const second = (s) => {
    if (s % 10 === 0) emit(world, nestChunk(world, n), 30 * 3600);
    run(world, TICK_RATE);
  };
  return { world, n, second };
}

test("left alone for an hour, bases spread, but never into the safe zone or near buildings", () => {
  const { world, second } = spreading(false);
  let groups = 0;
  for (let s = 0; s < 3600; s++) {
    second(s);
    for (const g of world.enemies.groups.values()) if (g.kind === "expand") groups++;
  }
  const founded = [...world.enemies.founded.values()];
  assert.ok(founded.length >= 3, `${founded.length} nests founded`);
  assert.ok(groups > 0, "groups walked there");
  for (const n of founded) {
    assert.ok(Math.hypot(n.x + NEST / 2, n.y + NEST / 2) >= SAFE, "outside the safe zone");
    assert.ok(!buildingWithin(world, n, EXPANSION.clear), "away from the factory");
    for (let y = n.y; y < n.y + NEST; y++) {
      for (let x = n.x; x < n.x + NEST; x++) {
        assert.ok(isNestAt(world, x, y));
        assert.notEqual(kindAt(world, x, y), WATER);
      }
    }
    assert.equal(baseNestsOf(world, baseKey(n.id)).length, 1, "a base of its own");
    assert.ok(world.enemies.nests.get(n.id).home.length >= EXPANSION.units, "its founders live there");
  }
  assert.equal(world.ruins.length, 0);
  // Founded nests are kept: forgetting their chunks and loading a save bring them back.
  forgetChunks(world, 0, 0, 0, 0);
  const loaded = deserialize(structuredClone(serialize(world)));
  for (const n of founded) {
    assert.ok(isNestAt(world, n.x, n.y));
    assert.ok(isNestAt(loaded, n.x, n.y));
    assert.equal(canFit(loaded, "chest", n.x, n.y, 0), "A nest is in the way");
  }
  // A founded nest destroyed as its defenders set out stays gone, and a save made
  // then loads with them still out.
  const [n] = founded;
  const t = place(world, "turret", n.x + 8, n.y, 0);
  assert.ok(t);
  hitNest(world, n.id, NEST_HEALTH, t);
  assert.ok(!isNestAt(world, n.x, n.y));
  assert.ok([...world.enemies.groups.values()].some((g) => g.nest === n.id && g.kind === "defend"));
  forgetChunks(world, 0, 0, 0, 0);
  const again = deserialize(structuredClone(serialize(world)));
  assert.ok(!isNestAt(world, n.x, n.y) && !isNestAt(again, n.x, n.y));
  assert.deepEqual(serialize(again), serialize(world));
  run(again, 10 * TICK_RATE);
});

test("a group out to found a nest goes home if a building goes up near the spot, and saves on the way", () => {
  const { world, second } = spreading(true);
  let s = 0;
  const expanding = () => [...world.enemies.groups.values()].find((g) => g.kind === "expand" && g.path);
  while (!expanding()) {
    second(s++);
    assert.ok(s < 3600, "a group set out");
  }
  const g = expanding();
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(serialize(loaded), serialize(world));
  run(world, 5 * TICK_RATE);
  run(loaded, 5 * TICK_RATE);
  assert.deepEqual(serialize(loaded), serialize(world));
  // A chest goes up near the spot before they get there.
  assert.ok(world.enemies.groups.has(g.id) && g.mode === "go", "still on the way");
  const { x, y } = g.goal;
  assert.ok(place(world, "chest", x + NEST + 5, y, 0) || place(world, "chest", x - 6, y, 0));
  const founded = world.enemies.founded.size;
  run(world, MINUTE);
  assert.equal(world.enemies.founded.size, founded, "no nest there");
  assert.ok(!world.enemies.groups.has(g.id), "they went home"); // nothing here can kill them
  assert.equal(world.ruins.length, 0);
});

test("spitters spit at a wall in their way from as far as they reach", () => {
  const world = setup();
  const t = place(world, "turret", 0, 0, 0); // no ammo: nothing shoots back
  const walls = [];
  for (let y = -3; y <= 4; y++) walls.push(place(world, "wall", 6, y, 0));
  const en = world.enemies;
  const n = nestsNear(world.seed, -600, -600, 600, 600)[0];
  const path = [];
  for (let x = 30; x >= 2; x--) path.push(x, 1);
  const g = { id: en.nextId++, nest: n.id, kind: "attack", target: t.id, goal: { x: 0, y: 0, w: 2, h: 2 }, path: Int32Array.from(path), mode: "go", units: [], hit: -1 };
  en.groups.set(g.id, g);
  en.nests.set(n.id, { points: 0, home: [], next: -1, group: g.id, hp: NEST_HEALTH, hit: -600 });
  const add = (kind) => {
    const u = { id: en.nextId++, group: g.id, kind, x: 30.5 * TILE, y: 1.5 * TILE, ox: 0, oy: 0, hp: 10000, cool: 0, step: 0, target: 0, dx: 0, dy: 0, key: 0 };
    addUnit(world, u);
    g.units.push(u.id);
    return u;
  };
  const spitter = add(SPITTER);
  run(world, 20 * TICK_RATE);
  const wall = entityAt(world, 6, 1);
  assert.ok(healthOf(world, wall) < BUILDINGS.wall.health, "the wall was hit");
  assert.equal(spitter.target, wall.id);
  assert.ok(spitter.x / TILE - 7 > 10, `it stays back, ${(spitter.x / TILE - 7).toFixed(1)} tiles off`);
  assert.equal(healthOf(world, t), BUILDINGS.turret.health, "and hits the wall, not the turret behind it");
});

test("bases show on the map once charted, by strength, and a tap near one finds it", () => {
  const world = setup(false);
  const n = nearestNest(world);
  const key = baseKey(n.id);
  assert.ok(!chartedBases(world).some((b) => b.key === key), "not before it's charted");
  assert.equal(baseNear(world, n.x, n.y, 10), null);
  for (const m of baseNestsOf(world, key)) chart(world, Math.floor(m.x / CHUNK), Math.floor(m.y / CHUNK));
  const b = chartedBases(world).find((x) => x.key === key);
  const nests = baseNestsOf(world, key).length;
  assert.deepEqual([b.nests, b.units], [nests, GUARDS * nests], "sleeping nests count their guards");
  assert.equal(baseNear(world, b.x + 3, b.y - 2, 10), key);
  let info = baseInfo(world, key);
  assert.equal(info.tier, tierOf(GUARDS * nests));
  assert.deepEqual(info.nests.map((x) => x.hp), Array(nests).fill(NEST_HEALTH));
  // Fed, it grows stronger.
  emit(world, nestChunk(world, n), 120 * 2 * 3600);
  run(world, 2 * MINUTE);
  info = baseInfo(world, key);
  assert.ok(info.units > GUARDS * nests);
  assert.ok(info.tier >= 1);
  assert.equal(info.kinds.reduce((a, c) => a + c, 0), info.units);
  assert.equal(chartedBases(world).find((x) => x.key === key).units, info.units);
});
