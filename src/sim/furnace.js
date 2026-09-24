// Furnaces smelt ore into plates, burning fuel while they work.
//
// A furnace has three slots, each { item, n } or null: `input` (ore), `fuel` and
// `output`. It works out what to make from whatever ore is in the input (see
// SMELTING). `smelting` is the ore it has taken for the plate it's making, and
// `burn` the ticks left on the fuel it lit last. status says what it's doing:
// "working", "no-input" (nothing to smelt), "no-fuel" (something to smelt but
// nothing to burn) or "full" (no room in the output for the next plate).
import { BUILDINGS } from "./buildings.js";
import { SMELTING, FUEL } from "./recipes.js";
import { count, take, give } from "./inventory.js";

const { stack: STACK, feed: FEED } = BUILDINGS.furnace;

export const furnaceState = () => ({
  input: null,
  fuel: null,
  output: null,
  smelting: null,
  progress: 0,
  burn: 0,
  status: "no-input",
});

// The slot `item` goes into, or null if a furnace has no use for it.
export const slotFor = (item) => (Object.hasOwn(FUEL, item) ? "fuel" : Object.hasOwn(SMELTING, item) ? "input" : null);

// How many more of `item` fit, filling its slot up to `limit`.
function room(f, item, limit) {
  const slot = slotFor(item);
  const s = slot && f[slot];
  if (!slot || (s && s.item !== item)) return 0;
  return Math.max(0, limit - (s?.n || 0));
}

// Belts, miners and inserters only top a furnace up to FEED of each, so one furnace
// doesn't hoard the ore the next one along is waiting for.
export const furnaceCanTake = (f, item) => room(f, item, FEED) > 0;

export function furnaceAdd(f, item, n = 1) {
  const slot = slotFor(item);
  if (f[slot]) f[slot].n += n;
  else f[slot] = { item, n };
}

const takeFrom = (f, slot, n = 1) => {
  if ((f[slot].n -= n) === 0) f[slot] = null;
};

// Takes one item from the output for an inserter, if `accepts` wants it.
export function furnaceTakeOne(f, accepts) {
  const out = f.output;
  if (!out || !accepts(out.item)) return null;
  takeFrom(f, "output");
  return out.item;
}

// How many of `item` the player could still put in: slots fill up to a full stack.
export const furnaceRoom = (f, item) => room(f, item, STACK);

// Moves as much of `item` as fits from inventory `inv` into the furnace. Returns
// how many moved.
export function fillFrom(f, inv, item) {
  const n = Math.min(count(inv, item), furnaceRoom(f, item));
  if (n) {
    take(inv, { [item]: n });
    furnaceAdd(f, item, n);
  }
  return n;
}

// Moves everything in `slot` ("input", "fuel" or "output") into inventory `inv`
// and returns what moved. The player takes plates out this way, and ore or coal
// back, e.g. a lone stone that's waiting for a second one.
export function emptySlot(f, slot, inv) {
  const s = f[slot];
  if (!s) return {};
  const moved = { [s.item]: s.n };
  f[slot] = null;
  give(inv, moved);
  return moved;
}

// Everything a furnace holds, including the ore it's part way through smelting.
export function furnaceContents(f) {
  const items = {};
  const add = (id, n) => (items[id] = (items[id] || 0) + n);
  for (const s of [f.input, f.fuel, f.output]) if (s) add(s.item, s.n);
  if (f.smelting) add(f.smelting, SMELTING[f.smelting].need);
  return items;
}

export function stepFurnace(f) {
  if (!f.smelting && !start(f)) return;
  if (!f.burn) {
    if (!f.fuel) {
      f.status = "no-fuel";
      return;
    }
    f.burn = FUEL[f.fuel.item];
    takeFrom(f, "fuel");
  }
  f.burn--;
  f.status = "working";
  const r = SMELTING[f.smelting];
  if (++f.progress < r.time) return;
  // start() made sure the output has room.
  if (f.output) f.output.n++;
  else f.output = { item: r.out, n: 1 };
  f.smelting = null;
  f.progress = 0;
  start(f); // straight on to the next one, so a plate takes exactly r.time ticks
}

// Takes the ore for the next plate from the input, if there's enough of it, room
// for the plate and something to burn. Otherwise says why not and returns false.
function start(f) {
  const r = f.input && SMELTING[f.input.item];
  if (!r || f.input.n < r.need) f.status = "no-input";
  else if (f.output && (f.output.item !== r.out || f.output.n >= STACK)) f.status = "full";
  else if (!f.burn && !f.fuel) f.status = "no-fuel";
  else {
    f.smelting = f.input.item;
    takeFrom(f, "input", r.need);
    return true;
  }
  return false;
}
