import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, removeAt, refundOf } from "../src/sim/world.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { canTake, put } from "../src/sim/transport.js";
import { setRecipe } from "../src/sim/assembler.js";
import { labAdd, fillLab, emptyLab } from "../src/sim/lab.js";
import { TECHS, queueResearch, cancelResearch, canResearch, upgradesOf } from "../src/sim/tech.js";
import { AMMO, turretAdd, stepTurret } from "../src/sim/turret.js";
import { addUnit, TILE, UNITS, BRUTE, NEST_HEALTH } from "../src/sim/enemies.js";
import { nestsNear } from "../src/sim/map.js";
import { maxHealth } from "../src/sim/health.js";
import { lockedWhy, recipeUnlocked } from "../src/sim/progress.js";
import { perMinute, USED, MADE } from "../src/sim/stats.js";
import { count, total } from "../src/sim/inventory.js";
import { serialize, deserialize, SaveError } from "../src/sim/save.js";
import { charge, ALL, clearArea } from "./helpers.js";

const KIT = { "iron-plate": 2000, "copper-plate": 1000, "iron-gear": 1000, "electronic-circuit": 1000, stone: 500, "red-pack": 200, "green-pack": 200 };
const setup = (research = []) => createWorld({ milestones: ALL, research, seed: 3, kit: { ...KIT }, enemies: false });
const run = (world, ticks, power = true) => {
  for (let i = 0; i < ticks; i++) {
    if (power) charge(world);
    step(world);
  }
};
const unitTicks = (id) => TECHS[id].time;

test("a red pack line feeding three labs researches Weapon damage 1 on its own, and turrets hit harder afterwards", () => {
  const world = setup();
  const area = clearArea(world, 20, 12);
  const x = area.x;
  const y = area.y + 6;
  // Two red pack assemblers, each fed from a chest of copper and gears, feed the
  // first lab (one makes a pack every 5 s, and a lab uses one every 10 s); it passes
  // packs on to the second, and that to the third.
  const line = (cx, cy, dir, ax, ay) => {
    const chest = place(world, "chest", cx, cy, dir);
    Object.assign(chest.inventory.items, { "copper-plate": 40, "iron-gear": 40 });
    const [dx, dy] = [[0, -1], [1, 0], [0, 1], [-1, 0]][dir];
    place(world, "inserter", cx + dx, cy + dy, dir);
    setRecipe(place(world, "assembler", ax, ay, dir), "red-pack", world.inventory);
    place(world, "inserter", cx + 5 * dx, cy + 5 * dy, dir);
  };
  line(x, y + 1, 1, x + 2, y);
  line(x + 7, y - 6, 2, x + 6, y - 4);
  const labs = [place(world, "lab", x + 6, y, 1)];
  place(world, "inserter", x + 9, y + 1, 1);
  labs.push(place(world, "lab", x + 10, y, 1));
  place(world, "inserter", x + 13, y + 1, 1);
  labs.push(place(world, "lab", x + 14, y, 1));
  assert.deepEqual(queueResearch(world, "weapon-damage-1"), ["weapon-damage-1"]);
  assert.equal(world.research.current, "weapon-damage-1");

  const worked = new Set();
  let t = 0;
  while (!world.research.done.has("weapon-damage-1") && t < 60 * 60 * 10) {
    run(world, 1);
    t++;
    for (const l of labs) if (l.unit) worked.add(l);
  }
  assert.ok(world.research.done.has("weapon-damage-1"), `done in ${t / 60} s`);
  assert.equal(worked.size, 3, "every lab did some of it");
  assert.equal(world.research.current, null);
  assert.deepEqual(world.research.progress, {});
  run(world, 1); // the labs stepped before the last unit was done find out now
  assert.ok(labs.every((l) => l.status === "no-research"));
  assert.equal(world.upgrades.damage["firearm-magazine"], Math.round(AMMO["firearm-magazine"].damage * 1.2));

  // A turret with the upgrade takes a brute down faster than one without.
  const shots = (w) => {
    const turret = place(w, "turret", x, y + 8, 0);
    turretAdd(turret, "firearm-magazine");
    const en = w.enemies;
    const nest = nestsNear(w.seed, -600, -600, 600, 600)[0];
    const g = { id: en.nextId++, nest: nest.id, kind: "defend", target: turret.id, goal: { x: turret.x, y: turret.y, w: 2, h: 2 }, path: null, mode: "go", units: [], hit: -1 };
    en.groups.set(g.id, g);
    en.nests.set(nest.id, { points: 0, home: [], next: -1, group: g.id, hp: NEST_HEALTH, hit: -600 });
    const u = { id: en.nextId++, group: g.id, kind: BRUTE, x: (x + 5.5) * TILE, y: (y + 9.5) * TILE, ox: 0, oy: 0, hp: 500, cool: 0, step: 0, target: 0, dx: 0, dy: 0, key: 0 };
    addUnit(w, u);
    g.units.push(u.id);
    for (let i = 0; i < 180; i++) {
      w.tick++;
      stepTurret(w, turret);
    }
    return 500 - u.hp;
  };
  const armour = UNITS[BRUTE].armor;
  assert.equal(shots(world), 10 * (world.upgrades.damage["firearm-magazine"] - armour));
  assert.equal(shots(setup()), 10 * (AMMO["firearm-magazine"].damage - armour));
});

test("a lab says when it's short of a pack, has no power or has nothing to research", () => {
  const world = setup(["green-science"]);
  const { x, y } = clearArea(world, 5);
  const lab = place(world, "lab", x, y, 0);
  run(world, 2);
  assert.equal(lab.status, "no-research");
  queueResearch(world, "logistics-2");
  labAdd(lab, "red-pack", 2);
  run(world, 2);
  assert.equal(lab.status, "no-input", "it takes green packs too");
  labAdd(lab, "green-pack", 1);
  lab.energy = 0; // what it stored from the ticks before
  run(world, 5, false);
  assert.equal(lab.status, "no-power");
  assert.equal(lab.progress, 0);
  run(world, 5);
  assert.equal(lab.status, "working");
  assert.equal(lab.unit, "logistics-2");
  assert.deepEqual(lab.packs, { "red-pack": 1 }, "one of each for the unit");
});

test("labs don't start more units than are left, and the last one finishes the technology", () => {
  const world = setup();
  const { x, y } = clearArea(world, 13, 5);
  const labs = [0, 4, 8].map((dx) => place(world, "lab", x + dx, y, 0));
  for (const l of labs) fillLab(l, world.inventory, "red-pack", 10);
  queueResearch(world, "green-science"); // 10 units
  assert.equal(recipeUnlocked(world, "green-pack"), false);
  run(world, unitTicks("green-science") * 3 + 3);
  assert.equal(world.research.progress["green-science"], 9);
  assert.deepEqual(labs.map((l) => l.status), ["working", "idle", "idle"], "one unit left, for the first lab ready");
  run(world, unitTicks("green-science"));
  assert.ok(world.research.done.has("green-science"));
  assert.ok(recipeUnlocked(world, "green-pack"));
  assert.equal(labs.reduce((n, l) => n + l.packs["red-pack"], 0), 30 - 10, "one pack a unit");
  // The packs count as used.
  run(world, 60);
  assert.ok(perMinute(world, "red-pack", 0, USED) > 0);
});

test("queueing a technology queues what it needs first, and stopping one drops what needs it", () => {
  const world = setup();
  assert.equal(canResearch(world, "weapon-damage-2"), false);
  assert.deepEqual(queueResearch(world, "weapon-damage-2"), ["weapon-damage-1", "green-science", "weapon-damage-2"]);
  assert.equal(world.research.current, "weapon-damage-1");
  assert.deepEqual(world.research.queue, ["green-science", "weapon-damage-2"]);
  queueResearch(world, "stronger-walls");
  assert.deepEqual(queueResearch(world, "weapon-damage-2"), [], "already queued");
  cancelResearch(world, "green-science");
  assert.deepEqual(world.research.queue, ["stronger-walls"], "weapon damage 2 needs green science");
  world.research.progress["weapon-damage-1"] = 7;
  cancelResearch(world, "weapon-damage-1");
  assert.equal(world.research.current, "stronger-walls");
  assert.equal(world.research.progress["weapon-damage-1"], 7, "units done are kept");
  cancelResearch(world, "stronger-walls");
  assert.equal(world.research.current, null);
});

test("a lab gives back the packs of a unit when the research changes, and when it's removed", () => {
  const world = setup(["green-science"]);
  const { x, y } = clearArea(world, 5);
  const lab = place(world, "lab", x, y, 0);
  fillLab(lab, world.inventory, "red-pack", 2);
  fillLab(lab, world.inventory, "green-pack", 2);
  queueResearch(world, "logistics-2");
  run(world, 30);
  assert.equal(lab.unit, "logistics-2");
  assert.deepEqual(lab.packs, { "red-pack": 1, "green-pack": 1 });
  queueResearch(world, "weapon-damage-1");
  cancelResearch(world, "logistics-2");
  run(world, 1);
  assert.equal(lab.unit, "weapon-damage-1", "straight on to the next");
  assert.deepEqual(lab.packs, { "red-pack": 1, "green-pack": 2 }, "the old unit's packs came back, one red went on the new");
  const refund = refundOf(lab);
  assert.equal(refund["red-pack"], 2, "a unit under way comes back too");
  assert.equal(refund["green-pack"], 2);
  const before = count(world.inventory, "red-pack");
  removeAt(world, x, y);
  assert.equal(count(world.inventory, "red-pack"), before + 2);
  assert.equal(world.research.progress["weapon-damage-1"] || 0, 0, "the unit wasn't done");
});

test("labs take packs from belts and inserters, two of each, and only pass them on to another lab", () => {
  const world = setup();
  const { x, y } = clearArea(world, 12, 5);
  const lab = place(world, "lab", x, y, 0);
  assert.equal(canTake(lab, "iron-plate"), false);
  put(lab, "red-pack");
  put(lab, "red-pack");
  assert.equal(canTake(lab, "red-pack"), false);
  assert.ok(canTake(lab, "green-pack"), "whether the research needs it or not");
  assert.equal(fillLab(lab, world.inventory, "red-pack"), BUILDINGS.lab.stack - 2, "by hand, up to a stack");
  assert.deepEqual(emptyLab(lab, world.inventory, "red-pack", 3), { "red-pack": 3 });
  const chest = place(world, "chest", x + 4, y + 1, 1);
  place(world, "inserter", x + 3, y + 1, 1);
  run(world, 120);
  assert.equal(total(chest.inventory), 0, "a chest gets nothing out of a lab");
  removeAt(world, x + 4, y + 1);
  const next = place(world, "lab", x + 4, y, 0);
  run(world, 120);
  assert.deepEqual(next.packs, { "red-pack": 2 }, "another lab does");
});

test("research's numbers: stronger walls, faster shooting, and the right lock text", () => {
  const world = setup();
  assert.equal(maxHealth(world, "wall"), BUILDINGS.wall.health);
  const up = upgradesOf(new Set(["weapon-damage-1", "shooting-speed-1", "stronger-walls", "green-science", "weapon-damage-2", "shooting-speed-2"]));
  assert.deepEqual(up.bonus, { damage: 50, rate: 50, walls: 50 });
  assert.equal(up.health.wall, 1500);
  assert.equal(up.rate, 8, "12 ticks between shots at +50%");
  assert.deepEqual(up.damage, { "firearm-magazine": 9, "piercing-magazine": 12 });
  assert.equal(lockedWhy(world, "sorting-inserter"), "Locked: research Logistics 2 in a lab");
  assert.match(lockedWhy(createWorld({ milestones: ALL - 1 }), "lab"), /^Locked: reach milestone 5, Circuit production/);
});

test("research survives a save and load mid-unit, and carries on tick for tick; older saves have none", () => {
  const world = setup(["green-science"]);
  const { x, y } = clearArea(world, 9, 5);
  const labs = [place(world, "lab", x, y, 0), place(world, "lab", x + 4, y, 0)];
  for (const l of labs) {
    fillLab(l, world.inventory, "red-pack", 10);
    fillLab(l, world.inventory, "green-pack", 10);
  }
  queueResearch(world, "stronger-walls"); // 20 units: all the red packs
  queueResearch(world, "logistics-2");
  run(world, unitTicks("stronger-walls") * 3 + 17);
  assert.ok(labs[0].unit && labs[0].progress > 0, "mid-unit");
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(serialize(loaded), serialize(world));
  assert.deepEqual([...loaded.research.done], [...world.research.done]);
  run(world, 20000);
  run(loaded, 20000);
  assert.deepEqual(serialize(loaded), serialize(world));
  assert.ok(loaded.research.done.has("stronger-walls"));
  assert.equal(loaded.research.current, "logistics-2");
  assert.deepEqual(loaded.upgrades, world.upgrades);
  assert.equal(maxHealth(loaded, "wall"), 1500);

  const v13 = { ...serialize(createWorld({ milestones: ALL, seed: 3 })), version: 13 };
  delete v13.research;
  const old = deserialize(structuredClone(v13));
  assert.deepEqual([...old.research.done], []);
  assert.equal(old.research.current, null);

  const bad = serialize(world);
  bad.research.queue = ["logistics-2", "logistics-2"];
  assert.throws(() => deserialize(structuredClone(bad)), SaveError);
  const skipped = serialize(setup());
  skipped.research.current = "weapon-damage-2"; // needs weapon damage 1 first
  assert.throws(() => deserialize(structuredClone(skipped)), SaveError);
});

test("science packs are made in assemblers from what the plan says", () => {
  const world = setup(["green-science"]);
  const { x, y } = clearArea(world, 5);
  const a = place(world, "assembler", x, y, 0);
  setRecipe(a, "green-pack", world.inventory);
  for (const [id, n] of Object.entries({ "iron-plate": 2, "iron-gear": 1, "electronic-circuit": 1 })) for (let i = 0; i < n; i++) put(a, id);
  run(world, 361);
  assert.deepEqual(a.output, { item: "green-pack", n: 1 });
  assert.ok(perMinute(world, "green-pack", 0, MADE) !== 0);
});
