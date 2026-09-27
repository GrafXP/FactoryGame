import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, place, step, removeAt, refundOf } from "../src/sim/world.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { ITEMS } from "../src/sim/items.js";
import { RECIPES } from "../src/sim/recipes.js";
import { TECHS, PACKS, queueResearch, upgradesOf } from "../src/sim/tech.js";
import { buildingUnlocked, recipeUnlocked } from "../src/sim/progress.js";
import { queueCraft, handTime } from "../src/sim/crafting.js";
import { setRecipe } from "../src/sim/assembler.js";
import { canTake, put } from "../src/sim/transport.js";
import { stepLab } from "../src/sim/lab.js";
import { stepTurret, turretAdd, turretRange } from "../src/sim/turret.js";
import { stepPower, powerNetwork } from "../src/sim/power.js";
import { addUnit, TILE, BRUTE, MITE, SPITTER, UNITS, NEST_HEALTH, FOUNDED } from "../src/sim/enemies.js";
import { chunkOf, markNest } from "../src/sim/chunks.js";
import { nestsNear } from "../src/sim/map.js";
import { serialize, deserialize } from "../src/sim/save.js";
import { KILLS, MADE, USED, perMinute, history } from "../src/sim/stats.js";
import { maxHealth } from "../src/sim/health.js";
import { ALL, charge, clearArea } from "./helpers.js";

const LASERS = ["green-science", "military-science", "laser-turrets"];
const setup = (research = LASERS) => createWorld({ seed: 42, milestones: ALL, research, kit: Object.fromEntries(Object.keys(ITEMS).map(id => [id, 5000])) });
const run = (w, ticks, powered = false) => {
  for (let i = 0; i < ticks; i++) { if (powered) charge(w); step(w); }
};

// A real group and spatial index, with a straight route towards the turret.
// Some tests step only power and turrets to measure shots at a stationary target.
function attack(w, t, { distance = 12, n = 1, kind = BRUTE, hp = 10000, groupKind = "attack" } = {}) {
  const en = w.enemies;
  const nest = nestsNear(w.seed, -600, -600, 600, 600)[0];
  const x = t.x + 1 + distance;
  const y = t.y + 1;
  const g = { id: en.nextId++, nest: nest.id, kind: groupKind, target: t.id, goal: { x: t.x, y: t.y, w: 2, h: 2 }, path: Int32Array.from(Array.from({ length: distance + 1 }, (_, i) => [x - i, y]).flat()), mode: "go", units: [], hit: -1 };
  en.groups.set(g.id, g);
  en.nests.set(nest.id, { points: 0, home: [], next: -1, group: g.id, hp: NEST_HEALTH, hit: -600 });
  for (let i = 0; i < n; i++) {
    const u = { id: en.nextId++, group: g.id, kind, x: x * TILE, y: y * TILE, ox: 0, oy: 0, hp, cool: 0, step: 0, target: 0, dx: 0, dy: 0, key: 0 };
    addUnit(w, u); g.units.push(u.id);
  }
  return g;
}

function poweredLaser(generators = 2) {
  const w = setup();
  const { x, y } = clearArea(w, 16, 10);
  const t = place(w, "laser-turret", x + 4, y + 3);
  const pole = place(w, "pole", x + 3, y + 2);
  const gens = [];
  for (let i = 0; i < generators; i++) {
    const g = place(w, "generator", x, y + i * 4);
    g.fuel = { item: "coal", n: 50 }; gens.push(g);
  }
  return { w, t, gens, pole };
}

test("military packs unlock through research and turn one piercing magazine plus two walls' bricks into two packs", () => {
  assert.equal(recipeUnlocked(setup([]), "military-pack"), false);
  assert.equal(buildingUnlocked(setup(["green-science", "military-science"]), "laser-turret"), false);
  const w = setup();
  const before = w.inventory.items["military-pack"];
  queueCraft(w, "military-pack");
  run(w, handTime("military-pack") + 1);
  assert.equal(w.inventory.items["military-pack"], before + 2);
  const a = place(w, "assembler", 0, 0);
  setRecipe(a, "military-pack", w.inventory);
  put(a, "piercing-magazine");
  for (let i = 0; i < 2 * BUILDINGS.wall.cost["stone-brick"]; i++) put(a, "stone-brick");
  run(w, RECIPES["military-pack"].time + 1, true);
  assert.deepEqual(a.output, { item: "military-pack", n: 2 });
  assert.ok(perMinute(w, "military-pack", 0, MADE) > 0);
  assert.ok(perMinute(w, "piercing-magazine", 0, USED) > 0);
});

test("the entire tree can be researched with packs unlocked before they are needed", () => {
  const w = setup([]);
  const l = place(w, "lab", 0, 0);
  for (const id of Object.keys(TECHS).reverse()) queueResearch(w, id);
  const expected = Object.fromEntries(PACKS.map(p => [p, Object.values(TECHS).filter(t => t.packs.includes(p)).reduce((n, t) => n + t.units, 0)]));
  const budget = Object.values(TECHS).reduce((n, t) => n + t.units * t.time, 0);
  for (let i = 0; i <= budget && w.research.current; i++) {
    const tech = TECHS[w.research.current];
    assert.ok(tech.needs.every(id => w.research.done.has(id)));
    for (const p of tech.packs) {
      assert.ok(recipeUnlocked(w, p), `${p} can be made before ${tech.name}`);
      if (canTake(l, p)) put(l, p);
    }
    w.tick++; charge(w); stepLab(w, l);
  }
  assert.equal(w.research.current, null);
  assert.equal(w.research.done.size, Object.keys(TECHS).length);
  for (const p of PACKS) assert.equal(w.stats.now.used[p], expected[p]);
  for (const type in BUILDINGS) assert.ok(buildingUnlocked(w, type), type);
  for (const recipe in RECIPES) assert.ok(recipeUnlocked(w, recipe), recipe);
  assert.equal(maxHealth(w, "wall"), 2500);
  assert.equal(turretRange(w, { type: "turret" }), 20);
  assert.equal(turretRange(w, { type: "laser-turret" }), 22);
  assert.equal(w.upgrades.damage["piercing-magazine"], 19);
  assert.equal(w.upgrades.rate, 5);
  assert.equal(w.upgrades.laserDamage, 13);
  assert.equal(w.upgrades.laserRate, 7);
});

test("military research waits for grey packs, which inserters can pass from lab to lab", () => {
  const w = setup(["green-science", "military-science"]);
  const first = place(w, "lab", 0, 0);
  const second = place(w, "lab", 4, 0);
  place(w, "inserter", 3, 1, 1);
  queueResearch(w, "laser-turrets");
  for (const l of [first, second]) for (let i = 0; i < 2; i++) { put(l, "red-pack"); put(l, "green-pack"); }
  run(w, 60, true);
  assert.equal(first.status, "no-input");
  assert.equal(first.progress, 0);
  put(first, "military-pack"); put(first, "military-pack");
  run(w, 60, true);
  assert.equal(first.unit, "laser-turrets");
  assert.equal(second.unit, "laser-turrets");
});

test("lasers ignore armour without ammo, stop without power, and consume only a trickle on standby", () => {
  const { w, t, gens, pole } = poweredLaser();
  assert.equal(canTake(t, "firearm-magazine"), false);
  assert.deepEqual(refundOf(t), BUILDINGS["laser-turret"].cost);
  run(w, 120);
  assert.equal(t.status, "idle");
  const before = gens.reduce((n, g) => n + g.burn, 0);
  run(w, 60);
  assert.equal(before - gens.reduce((n, g) => n + g.burn, 0), 60 * BUILDINGS[t.type].drain);
  attack(w, t);
  const [u] = w.enemies.units.values();
  const hp = u.hp;
  w.tick++; stepPower(w); stepTurret(w, t);
  assert.equal(hp - u.hp, BUILDINGS[t.type].damage);
  assert.equal(t.beam, 12);
  removeAt(w, pole.x, pole.y);
  for (let i = 0; i < 30; i++) { w.tick++; stepPower(w); stepTurret(w, t); }
  const dealt = t.damage;
  for (let i = 0; i < 60; i++) { w.tick++; stepPower(w); stepTurret(w, t); }
  assert.equal(t.status, "no-power");
  assert.equal(t.damage, dealt);
  assert.equal(w.stats.now.used["firearm-magazine"], undefined);
});

test("a laser on one generator shoots at two thirds the rate of one with enough power", () => {
  const damage = [];
  for (const generators of [1, 2]) {
    const { w, t } = poweredLaser(generators);
    attack(w, t);
    for (let i = 0; i < 1200; i++) { w.tick++; stepPower(w); stepTurret(w, t); }
    damage.push(t.damage);
    const net = powerNetwork(w).netOf.get(t);
    assert.equal(net.capacity < net.demand, generators === 1);
  }
  assert.ok(Math.abs(damage[0] / damage[1] - 2 / 3) < 0.02, String(damage));
});

test("range research reaches previously unreachable units for both turret types", () => {
  for (const type of ["turret", "laser-turret"]) {
    const w = setup();
    const t = place(w, type, 0, 0);
    if (type === "turret") turretAdd(t, "piercing-magazine");
    attack(w, t, { distance: BUILDINGS[type].range + 1 });
    charge(w); stepTurret(w, t);
    assert.equal(t.damage, 0);
    w.research.done.add("turret-range"); w.upgrades = upgradesOf(w.research.done);
    charge(w); stepTurret(w, t);
    assert.ok(t.damage > 0);
  }
});

test("lasers respect peaceful mode and still shoot defenders", () => {
  const w = setup(); w.enemies.on = false;
  const t = place(w, "laser-turret", 0, 0);
  const g = attack(w, t);
  charge(w); stepTurret(w, t);
  assert.equal(t.damage, 0);
  g.kind = "defend";
  charge(w); stepTurret(w, t);
  assert.ok(t.damage > 0);
});

test("range research invalidates cached nest misses; both turrets count defenders and the nest exactly once", () => {
  for (const type of ["turret", "laser-turret"]) {
    const w = setup(); w.enemies.on = false;
    const t = place(w, type, 0, 0);
    if (type === "turret") turretAdd(t, "piercing-magazine", 10);
    // A founded nest just outside the old range, kept in the real chunk index.
    const nest = { id: FOUNDED + w.enemies.nextId++, x: BUILDINGS[type].range + 2, y: 0 };
    w.enemies.founded.set(nest.id, nest); w.nests.set(nest.id, nest);
    markNest(chunkOf(w, nest.x, nest.y), nest);
    charge(w); stepTurret(w, t);
    assert.equal(t.damage, 0);
    assert.equal(t.looked, w.mapVersion);
    w.research.done.add("turret-range"); w.upgrades = upgradesOf(w.research.done);
    charge(w); stepTurret(w, t);
    assert.equal(t.nest, nest.id);
    assert.ok(w.enemies.units.size > 0, "guards fight back in peaceful mode");
    run(w, 2000, true);
    assert.ok(w.enemies.dead.has(nest.id));
    assert.equal(t.kills, 4);
    assert.equal(history(w, KILLS, 0, MADE).reduce((n, v) => n + (v || 0), w.stats.now.made[KILLS] || 0), 4);
  }
});

test("laser combat, energy, upgrades and kill history resume tick for tick; version 14 research is preserved", () => {
  const { w, t } = poweredLaser(1);
  attack(w, t, { n: 6, hp: UNITS[MITE].hp, kind: MITE });
  run(w, 43);
  assert.ok(t.damage > 0);
  const loaded = deserialize(structuredClone(serialize(w)));
  assert.deepEqual(serialize(loaded), serialize(w));
  run(w, 1200); run(loaded, 1200);
  assert.deepEqual(serialize(loaded), serialize(w));
  assert.equal(t.kills, 6);
  assert.ok(perMinute(w, KILLS, 0, MADE) > 0);
  const old = serialize(setup(["green-science", "weapon-damage-1"])); old.version = 14;
  assert.deepEqual(deserialize(old).research.done, new Set(old.research.done));
  assert.equal(deserialize(old).stats.series[KILLS], undefined);
  for (const [key, value] of [["energy", -1], ["cool", 100], ["beam", Infinity], ["status", "no-ammo"]]) {
    const bad = serialize(w);
    bad.entities.find(e => e.id === t.id)[key] = value;
    assert.throws(() => deserialize(bad), /bad laser|bad energy/);
  }
});

// A wall and four guns or lasers, supplied by six dedicated coal generators.
function defense(type, research, evolution, kinds) {
  const w = setup(research);
  w.enemies.evolution = evolution;
  const turrets = [];
  const build = (type, x, y) => {
    const e = place(w, type, x, y);
    assert.ok(e, `${type} fits at ${x}, ${y}`);
    return e;
  };
  for (const y of [0, 4, 8, 12]) {
    const t = build(type, 0, y); turrets.push(t);
    if (type === "turret") turretAdd(t, "piercing-magazine", 10);
  }
  for (let y = -1; y <= 15; y++) build("wall", 3, y);
  if (type === "laser-turret") for (const y of [0, 4, 8, 12, 16, 20]) {
    build("generator", -6, y).fuel = { item: "coal", n: 50 };
    build("pole", -2, y + 2);
  }
  run(w, 120);
  const g = attack(w, turrets[0], { distance: 16, n: kinds.length });
  g.units.forEach((id, i) => {
    const u = w.enemies.units.get(id);
    u.kind = kinds[i]; u.hp = Math.round(UNITS[u.kind].hp * (1 + 2 * evolution));
  });
  run(w, 3600);
  return { w, turrets };
}

test("a generator-fed laser line holds a mixed attack at mid evolution", () => {
  const kinds = [BRUTE, BRUTE, BRUTE, SPITTER, SPITTER, SPITTER, SPITTER, MITE, MITE, MITE, MITE, MITE];
  const { w, turrets } = defense("laser-turret", LASERS, 0.5, kinds);
  assert.equal(w.enemies.units.size, 0);
  assert.equal(w.ruins.length, 0);
  assert.equal(turrets.reduce((n, t) => n + t.kills, 0), kinds.length);
});

test("high evolution threatens unupgraded guns while researched lasers and walls hold", () => {
  const kinds = [BRUTE, BRUTE, BRUTE, BRUTE, BRUTE, BRUTE, BRUTE, BRUTE, SPITTER, SPITTER, SPITTER, SPITTER, MITE, MITE, MITE, MITE, MITE, MITE];
  const guns = defense("turret", [], 0.9, kinds);
  const lasers = defense("laser-turret", Object.keys(TECHS), 0.9, kinds);
  assert.ok(guns.w.ruins.length > 0, "unupgraded guns lose buildings");
  assert.equal(lasers.w.enemies.units.size, 0);
  assert.equal(lasers.w.ruins.length, 0);
});
