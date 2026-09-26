import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, place, step, removeAt } from "../src/sim/world.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { AMMO, turretCanTake, turretAdd, loadTurret, emptyTurret, stepTurret } from "../src/sim/turret.js";
import { addUnit, hitUnit, unitsNear, TILE, UNITS, MITE, BRUTE, setEnemies } from "../src/sim/enemies.js";
import { nestsNear } from "../src/sim/map.js";
import { serialize, deserialize } from "../src/sim/save.js";
import { healthOf } from "../src/sim/health.js";
import { put, canTake } from "../src/sim/transport.js";
import { count, give } from "../src/sim/inventory.js";
import { setRecipe } from "../src/sim/assembler.js";
import { queueCraft } from "../src/sim/crafting.js";
import { buildingUnlocked, recipeUnlocked } from "../src/sim/progress.js";
import { charge, ALL } from "./helpers.js";

const setup = () => createWorld({ seed: 42, milestones: ALL, kit: { stone: 100, "iron-plate": 3000, "copper-plate": 300, "iron-gear": 300, "electronic-circuit": 300, "stone-brick": 1000, "firearm-magazine": 100 } });
const run = (world, n, power = false) => { for (let i = 0; i < n; i++) { if (power) charge(world); step(world); } };
// A deterministic incoming group, using real unit and spatial-index state.
function attack(world, target, { x = 12, y = 1, n = 5, kind = MITE, hp = UNITS[kind].hp } = {}) {
  const en = world.enemies;
  const nest = nestsNear(world.seed, -600, -600, 600, 600)[0];
  const g = { id: en.nextId++, nest: nest.id, target: target.id, goal: { x: target.x, y: target.y, w: 2, h: 2 }, path: Int32Array.from(Array.from({length: x - target.x}, (_, i) => [x - i, y]).flat()), mode: "go", units: [], hit: -1 };
  en.groups.set(g.id, g);
  en.nests.set(nest.id, { points: 0, home: [], next: -1, group: g.id });
  for (let i = 0; i < n; i++) {
    const u = { id: en.nextId++, group: g.id, kind, x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, ox: 0, oy: 0, hp, cool: 0, step: 0, target: 0, dx: 0, dy: 0, key: 0 };
    addUnit(world, u); g.units.push(u.id);
  }
  return g;
}

test("defense unlocks with logistics; new worlds default to enemies on", () => {
  const world = createWorld();
  assert.equal(world.enemies.on, true);
  for (const type of ["turret", "wall"]) assert.equal(buildingUnlocked(world, type), false);
  world.progress.milestone = 2;
  for (const type of ["turret", "wall"]) assert.equal(buildingUnlocked(world, type), true);
  assert.equal(recipeUnlocked(world, "firearm-magazine"), true);
});

test("magazines can be hand-crafted and assembled from four iron plates", () => {
  const world = setup();
  const before = count(world.inventory, "firearm-magazine");
  queueCraft(world, "firearm-magazine");
  run(world, 61);
  assert.equal(count(world.inventory, "firearm-magazine"), before + 1);
  const a = place(world, "assembler", 0, 0);
  setRecipe(a, "firearm-magazine", world.inventory);
  for (let i = 0; i < 4; i++) put(a, "iron-plate");
  run(world, 121, true);
  assert.deepEqual(a.output, { item: "firearm-magazine", n: 1 });
});

test("turrets accept five magazines automatically and ten by hand; dismantling refunds unopened ammo", () => {
  const world = setup();
  const t = place(world, "turret", 0, 0);
  assert.equal(canTake(t, "iron-plate"), false);
  for (let i = 0; i < 5; i++) { assert.ok(turretCanTake(t, "firearm-magazine")); put(t, "firearm-magazine"); }
  assert.equal(turretCanTake(t, "firearm-magazine"), false);
  assert.equal(loadTurret(t, world.inventory, "firearm-magazine"), 5);
  assert.equal(loadTurret(t, world.inventory, "firearm-magazine"), 0);
  assert.deepEqual(emptyTurret(t, world.inventory, 3), { "firearm-magazine": 3 });
  const before = count(world.inventory, "firearm-magazine");
  removeAt(world, 0, 0);
  assert.equal(count(world.inventory, "firearm-magazine"), before + 7);
  assert.equal(t.ammo, null);
});

test("each magazine fires exactly ten shots; armour reduces damage to at least one", () => {
  const world = setup();
  const t = place(world, "turret", 0, 0);
  turretAdd(t, "firearm-magazine");
  attack(world, t, { kind: BRUTE, n: 1, hp: 500 });
  const [u] = world.enemies.units.values();
  // Hold the enemy in place to isolate rate, magazine use and armour.
  for (let i = 0; i < 180; i++) { world.tick++; stepTurret(world, t); }
  assert.equal(u.hp, 500 - 10 * (AMMO["firearm-magazine"].damage - UNITS[BRUTE].armor));
  assert.equal(t.shots, 0);
  assert.equal(t.ammo, null);
  assert.equal(t.status, "no-ammo");
  assert.equal(t.damage, 20);
  assert.equal(hitUnit(world, u, 1, t).damage, 1);
  assert.equal(world.alerts.filter(a => a.kind === "no-ammo").length, 1);
});

test("turrets retain a living target, retarget after a kill, and clean up dead units and groups", () => {
  const world = setup();
  const t = place(world, "turret", 0, 0);
  turretAdd(t, "firearm-magazine", 2);
  const g = attack(world, t, { n: 2 });
  const ids = [...g.units];
  step(world);
  assert.equal(t.target, ids[0]);
  run(world, 24);
  assert.equal(world.enemies.units.has(ids[0]), false);
  run(world, 36);
  assert.equal(t.kills, 2);
  assert.equal(world.enemies.units.size, 0);
  assert.equal(world.enemies.byChunk.size, 0);
  assert.equal(world.enemies.groups.size, 0);
  assert.equal(world.enemies.nests.get(g.nest).group, 0);
  assert.deepEqual(unitsNear(world, 1, 1, 18), []);
});

test("turrets respect range and peaceful mode, and warn only when empty near enemies", () => {
  const world = setup();
  const t = place(world, "turret", 0, 0);
  run(world, 1);
  assert.equal(world.alerts.length, 0);
  attack(world, t, { x: 25, n: 1 });
  stepTurret(world, t);
  assert.equal(world.alerts.length, 0);
  turretAdd(t, "firearm-magazine");
  stepTurret(world, t);
  assert.equal(t.shots, 0);
  setEnemies(world, false);
  const [u] = world.enemies.units.values();
  const hp = u.hp;
  run(world, 10);
  assert.equal(u.hp, hp);
  assert.equal(t.shots, 0);
});

test("two inserter-fed turrets hold an early attack without losses", () => {
  const world = setup();
  const turrets = [place(world, "turret", 0, 0), place(world, "turret", 0, 4)];
  for (const t of turrets) {
    const c = place(world, "chest", -2, t.y);
    give(c.inventory, { "firearm-magazine": 10 });
    place(world, "inserter", -1, t.y, 1);
  }
  run(world, 100, true);
  attack(world, turrets[0], { n: 8 });
  run(world, 600, true);
  assert.equal(world.enemies.units.size, 0);
  assert.equal(turrets.reduce((n, t) => n + t.kills, 0), 8);
  assert.equal(world.ruins.length, 0);
  assert.equal(world.damaged.size, 0);
});

test("a belt supplies magazines continuously through an inserter during sustained combat", () => {
  const world = setup();
  const t = place(world, "turret", 0, 0);
  const belt = place(world, "belt", -2, 0, 0);
  place(world, "inserter", -1, 0, 1);
  attack(world, t, { n: 1, hp: 5000, x: 15 });
  for (let i = 0; i < 600; i++) {
    if (canTake(belt, "firearm-magazine")) put(belt, "firearm-magazine");
    charge(world); step(world);
  }
  assert.ok(t.damage > 10 * AMMO["firearm-magazine"].damage);
  assert.ok(t.ammo || t.shots);
  assert.ok(world.entities.has(t.id));
});

test("an attacked enemy redirects to the turret and walls take melee damage before the gun", () => {
  const world = setup();
  const t = place(world, "turret", 0, 0);
  const target = place(world, "miner", -5, 0);
  const wall = place(world, "wall", 2, 1);
  turretAdd(t, "firearm-magazine");
  const g = attack(world, target, { n: 1, hp: 500, kind: BRUTE, x: 3 });
  step(world);
  assert.equal(g.target, t.id);
  run(world, 100);
  assert.ok(healthOf(world, wall) < BUILDINGS.wall.health);
  assert.equal(healthOf(world, t), BUILDINGS.turret.health);
  setEnemies(world, false);
  // Remove the retreating group so the repair interval has no further hits.
  for (const u of [...world.enemies.units.values()]) hitUnit(world, u, 10000, t);
  run(world, 3600);
  assert.equal(healthOf(world, wall), BUILDINGS.wall.health);
});

test("a save during turret retaliation resumes tick for tick, including loaded shots and kills", () => {
  const world = setup();
  const t = place(world, "turret", 0, 0);
  turretAdd(t, "firearm-magazine", 10);
  const target = place(world, "miner", -5, 0);
  attack(world, target, { n: 5, hp: 100 });
  run(world, 17);
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(serialize(loaded), serialize(world));
  run(world, 600); run(loaded, 600);
  assert.deepEqual(serialize(loaded), serialize(world));
  assert.ok(t.kills > 0);
});

test("version 10 saves keep peaceful mode and turret saves validate ammo", () => {
  const world = setup(); world.enemies.on = false;
  const old = serialize(world); old.version = 10;
  assert.equal(deserialize(old).enemies.on, false);
  const t = place(world, "turret", 0, 0);
  turretAdd(t, "firearm-magazine");
  const data = serialize(world); data.entities[0].ammo.n = 11;
  assert.throws(() => deserialize(data), /bad ammo/);
});
