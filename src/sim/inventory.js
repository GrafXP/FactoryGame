// A bag of items: counts by item id. The player has one; chests will too.
// `version` is bumped on every change so the UI knows when to redraw.

export function createInventory(items = {}) {
  return { items: { ...items }, version: 0 };
}

export const count = (inv, id) => inv.items[id] || 0;

export function add(inv, id, n = 1) {
  inv.items[id] = count(inv, id) + n;
  inv.version++;
}

// How many times `cost` ({ id: n }) can be paid from the inventory.
export function affordable(inv, cost) {
  let times = Infinity;
  for (const id in cost) times = Math.min(times, Math.floor(count(inv, id) / cost[id]));
  return times;
}

// The items still needed to pay `cost` `times` times, or null if there are enough.
export function missing(inv, cost, times = 1) {
  let short = null;
  for (const id in cost) {
    const n = cost[id] * times - count(inv, id);
    if (n > 0) (short ||= {})[id] = n;
  }
  return short;
}

// Takes `cost` out of the inventory. Takes nothing and returns false if it's short.
export function take(inv, cost) {
  if (missing(inv, cost)) return false;
  for (const id in cost) {
    inv.items[id] -= cost[id];
    if (!inv.items[id]) delete inv.items[id];
  }
  inv.version++;
  return true;
}

export function give(inv, items) {
  for (const id in items) inv.items[id] = count(inv, id) + items[id];
  inv.version++;
}

export function total(inv) {
  let n = 0;
  for (const id in inv.items) n += inv.items[id];
  return n;
}

// Moves up to `max` of `item` from one inventory into another. Returns how many moved.
export function move(from, to, item, max = Infinity) {
  const n = Math.min(count(from, item), max);
  if (n <= 0) return 0;
  take(from, { [item]: n });
  add(to, item, n);
  return n;
}

// Moves everything from one inventory into another and returns what moved.
export function moveAll(from, to) {
  const moved = from.items;
  from.items = {};
  from.version++;
  give(to, moved);
  return moved;
}
