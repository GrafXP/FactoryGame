// Research: the technology tree, what's been researched and what's under way.
//
// Each technology in TECHS has the technologies it needs first (`needs`), how many
// `units` of research it takes, the science packs each unit uses (`packs`, one of
// each), how many ticks a lab works on a unit (`time`), and what it does: it
// unlocks buildings and recipes, as a milestone does (progress.js), or changes
// numbers (`bonus`, additive percentages, except range in tiles). Its tier is how
// many kinds of pack it takes.
//
// world.research is { done, current, progress, queue }: the technologies done (a
// Set), the one every lab works on (or null), the units done of each one started,
// and what comes after the current one, in order. What a technology needs is
// always done, current or earlier in the queue, so the next one can always start.
// Labs do the work (lab.js).
//
// world.upgrades holds the numbers the bonuses make: each magazine's damage a shot,
// the ticks between a turret's shots, and walls' health. They're worked out when
// research finishes (and when a world is made or loaded), not on every shot.
import { BUILDINGS } from "./buildings.js";
import { AMMO } from "./turret.js";

// The science packs, in the order labs and panels list them.
export const PACKS = ["red-pack", "green-pack", "military-pack"];

const RED = ["red-pack"];
const RED_GREEN = ["red-pack", "green-pack"];
const MILITARY = [...RED_GREEN, "military-pack"];

export const TECHS = {
  "green-science": { name: "Green science", needs: [], packs: RED, units: 10, time: 300, unlocks: { recipes: ["green-pack"] } },
  "weapon-damage-1": { name: "Weapon damage 1", needs: [], packs: RED, units: 30, time: 600, bonus: { damage: 20 } },
  "shooting-speed-1": { name: "Shooting speed 1", needs: [], packs: RED, units: 30, time: 600, bonus: { rate: 20 } },
  "stronger-walls": { name: "Stronger walls", needs: [], packs: RED, units: 20, time: 600, bonus: { walls: 50 } },
  "weapon-damage-2": { name: "Weapon damage 2", needs: ["weapon-damage-1", "green-science"], packs: RED_GREEN, units: 40, time: 900, bonus: { damage: 30 } },
  "shooting-speed-2": { name: "Shooting speed 2", needs: ["shooting-speed-1", "green-science"], packs: RED_GREEN, units: 40, time: 900, bonus: { rate: 30 } },
  "logistics-2": { name: "Logistics 2", needs: ["green-science"], packs: RED_GREEN, units: 40, time: 900, unlocks: { buildings: ["sorting-inserter"] } },
  "military-science": { name: "Military science", needs: ["green-science"], packs: RED_GREEN, units: 30, time: 600, unlocks: { recipes: ["military-pack"] } },
  "laser-turrets": { name: "Laser turrets", needs: ["military-science"], packs: MILITARY, units: 50, time: 900, unlocks: { buildings: ["laser-turret"] } },
  "weapon-damage-3": { name: "Weapon damage 3", needs: ["weapon-damage-2", "military-science"], packs: MILITARY, units: 60, time: 900, bonus: { damage: 40 } },
  "weapon-damage-4": { name: "Weapon damage 4", needs: ["weapon-damage-3"], packs: MILITARY, units: 100, time: 1200, bonus: { damage: 50 } },
  "shooting-speed-3": { name: "Shooting speed 3", needs: ["shooting-speed-2", "military-science"], packs: MILITARY, units: 60, time: 900, bonus: { rate: 40 } },
  "shooting-speed-4": { name: "Shooting speed 4", needs: ["shooting-speed-3"], packs: MILITARY, units: 100, time: 1200, bonus: { rate: 50 } },
  "laser-damage-1": { name: "Laser damage 1", needs: ["laser-turrets"], packs: MILITARY, units: 50, time: 900, bonus: { laserDamage: 30 } },
  "laser-damage-2": { name: "Laser damage 2", needs: ["laser-damage-1"], packs: MILITARY, units: 100, time: 1200, bonus: { laserDamage: 50 } },
  "laser-speed-1": { name: "Laser shooting speed 1", needs: ["laser-turrets"], packs: MILITARY, units: 50, time: 900, bonus: { laserRate: 30 } },
  "laser-speed-2": { name: "Laser shooting speed 2", needs: ["laser-speed-1"], packs: MILITARY, units: 100, time: 1200, bonus: { laserRate: 50 } },
  "stronger-walls-2": { name: "Stronger walls 2", needs: ["stronger-walls", "military-science"], packs: MILITARY, units: 60, time: 900, bonus: { walls: 100 } },
  "turret-range": { name: "Turret range", needs: ["laser-turrets"], packs: MILITARY, units: 100, time: 1200, bonus: { range: 2 } },
};
for (const t of Object.values(TECHS)) {
  t.unlocks = { buildings: [], recipes: [], ...t.unlocks };
  t.bonus ||= {};
}

export const tierOf = (id) => TECHS[id].packs.length;

// The technology that unlocks a building (kind "buildings") or recipe ("recipes"),
// or null if none does.
export const unlockingTech = (kind, id) => Object.keys(TECHS).find((t) => TECHS[t].unlocks[kind].includes(id)) ?? null;

export const researchState = (done = []) => ({ done: new Set(done), current: null, progress: {}, queue: [] });

export const researched = (world, id) => world.research.done.has(id);

// Whether technology `id` could be researched now: it isn't done, and what it
// needs is.
export const canResearch = (world, id) => !researched(world, id) && TECHS[id].needs.every((n) => researched(world, n));

// Puts technology `id` in the queue, after whatever it needs that isn't done or
// queued yet. With nothing under way, the first of them starts. Returns what was
// added, in order.
export function queueResearch(world, id) {
  const r = world.research;
  const added = [];
  const visit = (t) => {
    if (r.done.has(t) || r.current === t || r.queue.includes(t) || added.includes(t)) return;
    for (const n of TECHS[t].needs) visit(n);
    added.push(t);
  };
  visit(id);
  r.queue.push(...added);
  if (!r.current) r.current = r.queue.shift() ?? null;
  return added;
}

// Takes technology `id` off the queue, or stops it if it's under way, along with
// everything queued that needs it. Units done are kept for later. The next in the
// queue starts, if it was under way.
export function cancelResearch(world, id) {
  const r = world.research;
  const gone = new Set([id]);
  r.queue = r.queue.filter((t) => {
    if (t === id || TECHS[t].needs.some((n) => gone.has(n))) {
      gone.add(t);
      return false;
    }
    return true;
  });
  if (r.current === id) r.current = r.queue.shift() ?? null;
}

// A lab has finished a unit of the research under way. The last one finishes the
// technology, and the next in the queue starts.
export function finishUnit(world) {
  const r = world.research;
  const id = r.current;
  const n = (r.progress[id] || 0) + 1;
  if (n < TECHS[id].units) {
    r.progress[id] = n;
    return;
  }
  delete r.progress[id];
  r.done.add(id);
  r.current = r.queue.shift() ?? null;
  world.upgrades = upgradesOf(r.done);
}

// The numbers the bonuses of technologies `done` make (see world.upgrades), with
// `bonus`, the percentages they add up to.
export function upgradesOf(done) {
  const bonus = { damage: 0, rate: 0, walls: 0, laserDamage: 0, laserRate: 0, range: 0 };
  for (const id of done) for (const [k, n] of Object.entries(TECHS[id].bonus)) bonus[k] += n;
  const more = (n, pct) => Math.round((n * (100 + pct)) / 100);
  return {
    bonus,
    damage: Object.fromEntries(Object.entries(AMMO).map(([id, a]) => [id, more(a.damage, bonus.damage)])),
    rate: Math.max(1, Math.round((BUILDINGS.turret.rate * 100) / (100 + bonus.rate))),
    laserDamage: more(BUILDINGS["laser-turret"].damage, bonus.laserDamage),
    laserRate: Math.max(1, Math.round((BUILDINGS["laser-turret"].rate * 100) / (100 + bonus.laserRate))),
    health: { wall: more(BUILDINGS.wall.health, bonus.walls) },
  };
}
