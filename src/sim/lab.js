// Labs do research (tech.js) with science packs. Belts and inserters keep up to
// FEED of each pack in a lab, and the player can fill it up to STACK. A lab takes
// any pack, whether the research under way needs it or not; one it doesn't need
// just waits there. An inserter can take packs out of a lab only into another lab,
// so labs can be fed one from the next.
//
// Every lab works on the research under way. For each unit a lab takes one of each
// pack the technology needs (`unit` is then the technology), works on it for the
// technology's `time` ticks, each using power, and adds it to the research. The
// packs count as used once the unit is done. Labs never start more units than are
// left, so the last few go to the first labs ready. When the research under way
// changes, a lab puts the packs of the unit it was on back and starts on the new one.
//
// status is "working", "no-input" (short of a pack the research needs), "no-power",
// "no-research" (nothing under way) or "idle" (the units left are all being done).
import { BUILDINGS } from "./buildings.js";
import { count, take, give } from "./inventory.js";
import { usePower } from "./power.js";
import { consumed } from "./stats.js";
import { TECHS, PACKS, finishUnit } from "./tech.js";

const { stack: STACK, feed: FEED } = BUILDINGS.lab;

export const labState = () => ({ packs: {}, unit: null, progress: 0, status: "no-research" });

const room = (l, item, limit) => (PACKS.includes(item) ? Math.max(0, limit - (l.packs[item] || 0)) : 0);
export const labCanTake = (l, item) => room(l, item, FEED) > 0;
export const labRoom = (l, item) => room(l, item, STACK);

export function labAdd(l, item, n = 1) {
  l.packs[item] = (l.packs[item] || 0) + n;
}

function takePacks(l, item, n = 1) {
  if (!(l.packs[item] -= n)) delete l.packs[item];
}

// Takes one pack out of lab l that `ok(pack)` says yes to, for an inserter into
// another lab, and returns it (or null).
export function labTakeOne(l, ok) {
  for (const p of PACKS) {
    if (l.packs[p] && ok(p)) {
      takePacks(l, p);
      return p;
    }
  }
  return null;
}

// Moves up to `max` of pack `item` from inventory `inv` into lab l, as far as it
// has room, or back out of it. Each returns how many (emptyLab: { item: n }).
export function fillLab(l, inv, item, max = Infinity) {
  const n = Math.min(count(inv, item), labRoom(l, item), max);
  if (n > 0) {
    take(inv, { [item]: n });
    labAdd(l, item, n);
  }
  return n;
}
export function emptyLab(l, inv, item, max = Infinity) {
  const n = Math.min(l.packs[item] || 0, max);
  if (!n) return {};
  takePacks(l, item, n);
  give(inv, { [item]: n });
  return { [item]: n };
}

// Everything a lab holds, including the packs of the unit under way.
export function labContents(l) {
  const items = { ...l.packs };
  if (l.unit) for (const p of TECHS[l.unit].packs) items[p] = (items[p] || 0) + 1;
  return items;
}

// The labs, in the order they were built, looked up again only when the buildings
// change. Not saved.
function labsOf(world) {
  if (world.labs?.version !== world.version) {
    world.labs = { version: world.version, list: [...world.entities.values()].filter((e) => e.type === "lab") };
  }
  return world.labs.list;
}

// How many labs are on a unit of the research under way.
function busy(world) {
  let n = 0;
  for (const l of labsOf(world)) if (l.unit && l.unit === world.research.current) n++;
  return n;
}

export function stepLab(world, l) {
  if (l.unit && l.unit !== world.research.current) {
    for (const p of TECHS[l.unit].packs) labAdd(l, p);
    l.unit = null;
    l.progress = 0;
  }
  if (!l.unit && !start(world, l)) return;
  if (!usePower(world, l)) return;
  l.status = "working";
  const tech = TECHS[l.unit];
  if (++l.progress < tech.time) return;
  for (const p of tech.packs) consumed(world.stats, p); // only now, since a unit called off gives them back
  l.unit = null;
  l.progress = 0;
  finishUnit(world);
  start(world, l); // straight on to the next, so a unit takes exactly its time
}

// Takes the packs for a unit of the research under way, if there's a unit left to
// do and the lab has them. Otherwise says why not and returns false.
function start(world, l) {
  const r = world.research;
  const tech = r.current && TECHS[r.current];
  if (!tech) l.status = "no-research";
  else if ((r.progress[r.current] || 0) + busy(world) >= tech.units) l.status = "idle";
  else if (tech.packs.some((p) => !l.packs[p])) l.status = "no-input";
  else {
    for (const p of tech.packs) takePacks(l, p);
    l.unit = r.current;
    return true;
  }
  return false;
}
