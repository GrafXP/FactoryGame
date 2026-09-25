// Coal generators burn fuel into power for their network (see power.js).
//
// A generator has a `fuel` slot ({ item, n } or null) and `burn`, the joules left
// in the fuel it lit last. It only burns what the network draws, so an idle one
// keeps its coal. status says what it's doing: "working", "idle" (nothing on its
// network needs power), "no-fuel" or "unconnected" (no pole near it).
import { BUILDINGS } from "./buildings.js";
import { FUEL_ENERGY } from "./recipes.js";
import { count, take, give } from "./inventory.js";

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

// Moves as much of `item` as fits from inventory `inv` into the generator. Returns
// how many moved.
export function fuelGenerator(g, inv, item) {
  const n = Math.min(count(inv, item), generatorRoom(g, item));
  if (n) {
    take(inv, { [item]: n });
    generatorAdd(g, item, n);
  }
  return n;
}

// Moves the fuel slot into inventory `inv` and returns what moved. What's already
// burning stays.
export function emptyGenerator(g, inv) {
  if (!g.fuel) return {};
  const moved = { [g.fuel.item]: g.fuel.n };
  g.fuel = null;
  give(inv, moved);
  return moved;
}

// The joules it could make this tick: its full power while it has fuel.
export function generatorAvailable(g) {
  if (g.fuel) return POWER;
  return Math.min(POWER, g.burn);
}

// Burns `joules` (no more than generatorAvailable), lighting more fuel as needed.
export function burnGenerator(g, joules) {
  while (g.burn < joules) {
    g.burn += FUEL_ENERGY[g.fuel.item];
    if (--g.fuel.n === 0) g.fuel = null;
  }
  g.burn -= joules;
  g.status = joules > 0 ? "working" : g.burn || g.fuel ? "idle" : "no-fuel";
}
