// Health: buildings take damage (enemies.js), repair themselves, and when they're
// destroyed leave a ruin to rebuild.
//
// Every building has `health` (BUILDINGS). Only the ones that have been hit are
// tracked, in world.damaged: building id → { hp, hit }, what it has left and the
// tick it was last hit. Once it hasn't been hit for REPAIR_AFTER ticks it gets
// REPAIR_SHARE percent of its health back a second, for free, and when it's whole
// again it's dropped from the list.
//
// At 0 it's destroyed (world.js): it and everything in it are gone, and a ruin
// takes its place in world.ruins, in the order they were destroyed. A ruin is the
// building's part of a layout (layout.js) at its place on the map, so it remembers
// its facing and settings, plus the tick it was destroyed. Ruins don't block
// anything: building anything over one clears it. Rebuilding pays for the buildings
// again and builds them like a paste.
import { BUILDINGS, footprint } from "./buildings.js";
import { destroy, raise } from "./world.js";
import { layoutOf, buildLayout } from "./layout.js";

export const REPAIR_AFTER = 600; // 10 s
export const REPAIR_SHARE = 2; // % of its health a second, so a wreck is whole again in under a minute

export const maxHealth = (type) => BUILDINGS[type].health;

// What building e has left.
export const healthOf = (world, e) => world.damaged.get(e.id)?.hp ?? maxHealth(e.type);

// Takes n off building e's health, destroying it at 0. The first hit after a quiet
// spell raises an "attacked" alert. Returns whether it was destroyed.
export function damage(world, e, n) {
  let d = world.damaged.get(e.id);
  if (!d) world.damaged.set(e.id, (d = { hp: maxHealth(e.type), hit: world.tick - REPAIR_AFTER }));
  if (world.tick - d.hit >= REPAIR_AFTER) raise(world, "attacked", e);
  d.hit = world.tick;
  d.hp -= n;
  if (d.hp > 0) return false;
  destroy(world, e);
  return true;
}

// Once a second: buildings that haven't been hit for a while repair a little.
export function stepRepair(world) {
  for (const [id, d] of world.damaged) {
    if (world.tick - d.hit < REPAIR_AFTER) continue;
    const max = maxHealth(world.entities.get(id).type);
    d.hp = Math.min(max, d.hp + Math.max(1, Math.floor((max * REPAIR_SHARE) / 100)));
    if (d.hp >= max) world.damaged.delete(id);
  }
}

// The ruin building e leaves, destroyed at `tick`.
export function ruinOf(e, tick) {
  const [part] = layoutOf([e]).parts;
  return { ...part, x: e.x, y: e.y, tick };
}

const overlaps = (r, x, y, w, h) => {
  const f = footprint(r.type, r.rot);
  return r.x < x + w && r.x + f.w > x && r.y < y + h && r.y + f.h > y;
};

// Forgets the ruins under a `type` building going up at (x, y).
export function clearRuins(world, type, x, y, rot) {
  if (!world.ruins.length) return;
  const { w, h } = footprint(type, rot);
  world.ruins = world.ruins.filter((r) => !overlaps(r, x, y, w, h));
}

// The newest ruin on tile (x, y), or null.
export function ruinAt(world, x, y) {
  for (let i = world.ruins.length - 1; i >= 0; i--) if (overlaps(world.ruins[i], x, y, 1, 1)) return world.ruins[i];
  return null;
}

// Forgets ruin r without rebuilding it.
export function dropRuin(world, r) {
  world.ruins = world.ruins.filter((q) => q !== r);
}

// Rebuilds the ruins in `list` (all of them by default) where they stood, paying
// for each, with their settings: what buildLayout returns. The ones rebuilt are
// gone from world.ruins; the rest stay.
export function rebuild(world, list = world.ruins) {
  return buildLayout(world, { x: 0, y: 0, w: 0, h: 0, parts: [...list] }, 0, 0);
}
