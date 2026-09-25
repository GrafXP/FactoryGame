// Underground belts: an entrance and an exit facing the same way, with up to
// reach - 1 tiles of anything between them. Items go into the entrance and come out
// of the exit at belt speed (see transport.js, where a paired entrance is one long
// conveyor).
//
// Each end is built on its own, with `end` "in" or "out", and they pair as they're
// built: a new end pairs with the nearest unpaired end of the other kind in line
// with it (an exit looks back for its entrance, an entrance ahead for its exit), and
// each keeps the other's id in `pair`. An exit can only be built with an entrance
// to pair with. Removing either end unpairs the other and gives back whatever was
// underground.
import { BUILDINGS, DIRS } from "./buildings.js";
import { entityAt } from "./grid.js";
import { BELT_LEN } from "./transport.js";

export const REACH = BUILDINGS.underground.reach;

export const undergroundState = (end = "in") => ({ items: [], end, pair: null });

// The unpaired end a new `end` at (x, y) facing `rot` would pair with, or null.
export function partnerFor(world, x, y, rot, end) {
  const [dx, dy] = DIRS[rot];
  const way = end === "out" ? -1 : 1;
  for (let d = 1; d <= REACH; d++) {
    const e = entityAt(world, x + way * dx * d, y + way * dy * d);
    if (e?.type === "underground" && e.rot === rot && e.end !== end && !e.pair) return e;
  }
  return null;
}

// Why an end can't go at (x, y), apart from fitting and cost, or null if it can.
export function undergroundWhy(world, x, y, rot, end) {
  if (end === "out" && !partnerFor(world, x, y, rot, end)) {
    return `An exit needs an entrance up to ${REACH} tiles behind it, facing the same way`;
  }
  return null;
}

// Pairs a newly built end with its partner, if there is one.
export function pairUp(world, e) {
  const p = partnerFor(world, e.x, e.y, e.rot, e.end);
  if (!p) return;
  e.pair = p.id;
  p.pair = e.id;
  world.version++;
  world.beltVersion++; // the entrance now runs under to the exit
}

// The tiles ahead of an unpaired entrance where its exit can go (free ones only),
// nearest first.
export function exitSpots(world, entrance, fits) {
  const [dx, dy] = DIRS[entrance.rot];
  const spots = [];
  for (let d = 1; d <= REACH; d++) {
    const x = entrance.x + dx * d;
    const y = entrance.y + dy * d;
    if (fits(x, y)) spots.push({ x, y });
  }
  return spots;
}

// The items under the ground between a paired entrance and its exit.
export const buried = (entrance) => entrance.items.filter((it) => it.pos > BELT_LEN);

// Unpairs end e, which is being removed, from its partner. Removing an exit takes
// the items underground off its entrance, and returns them.
export function unpair(world, e) {
  const p = e.pair && world.entities.get(e.pair);
  e.pair = null;
  if (!p) return [];
  p.pair = null;
  if (e.end !== "out") return [];
  const under = buried(p);
  p.items = p.items.filter((it) => it.pos <= BELT_LEN);
  return under;
}
