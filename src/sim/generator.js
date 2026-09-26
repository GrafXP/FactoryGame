// Coal generators burn fuel into power for their network (see power.js).
//
// A generator has a `fuel` slot ({ item, n } or null) and `burn`, the joules left
// in the fuel it lit last. It only burns what the network draws, so an idle one
// keeps its coal. status says what it's doing: "working", "idle" (nothing on its
// network needs power), "no-fuel" or "unconnected" (no pole near it).
import { BUILDINGS } from "./buildings.js";
import { FUEL_ENERGY } from "./recipes.js";
import { count, take, give } from "./inventory.js";
import { consumed } from "./stats.js";

const { power: POWER, stack: STACK, feed: FEED } = BUILDINGS.generator;

export const generatorState = () => ({ fuel: null, burn: 0, status: "no-fuel" });

// How many more of `item` fit, filling the slot up to `limit`.
function room(g, item, limit) {
  if (!Object.hasOwn(FUEL_ENERGY, item) || (g.fuel && g.fuel.item !== item)) return 0;
  return Math.max(0, limit - (g.fuel?.n || 0));
}

// Belts, miners and inserters top the fuel up to FEED; the player can fill a stack.
export const generatorCanTake = (g, item) => room(g, item, FEED) > 0;
export const generatorRoom = (g, item) => room(g, item, STACK);

export function generatorAdd(g, item, n = 1) {
  if (g.fuel) g.fuel.n += n;
  else g.fuel = { item, n };
}

// Moves as much of `item` as fits, up to `max`, from inventory `inv` into the
// generator. Returns how many moved.
export function fuelGenerator(g, inv, item, max = Infinity) {
  const n = Math.min(count(inv, item), generatorRoom(g, item), max);
  if (n > 0) {
    take(inv, { [item]: n });
    generatorAdd(g, item, n);
  }
  return n;
}

// Moves the fuel slot, up to `max` of it, into inventory `inv` and returns what
// moved. What's already burning stays.
export function emptyGenerator(g, inv, max = Infinity) {
  const n = g.fuel ? Math.min(g.fuel.n, max) : 0;
  if (n <= 0) return {};
  const moved = { [g.fuel.item]: n };
  if ((g.fuel.n -= n) === 0) g.fuel = null;
  give(inv, moved);
  return moved;
}

// The joules it could make this tick: its full power while it has fuel.
export function generatorAvailable(g) {
  if (g.fuel) return POWER;
  return Math.min(POWER, g.burn);
}

// Burns `joules` (no more than generatorAvailable), lighting more fuel as needed,
// which counts as used in `stats`.
export function burnGenerator(g, joules, stats) {
  while (g.burn < joules) {
    g.burn += FUEL_ENERGY[g.fuel.item];
    consumed(stats, g.fuel.item);
    if (--g.fuel.n === 0) g.fuel = null;
  }
  g.burn -= joules;
  g.status = joules > 0 ? "working" : g.burn || g.fuel ? "idle" : "no-fuel";
}
