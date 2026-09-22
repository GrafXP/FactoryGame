// Simulation state. Pure data + logic: no three.js, no DOM, so it can be saved,
// loaded and run headless.
import { generateMap, ORE_NAMES } from "./map.js";
import { BUILDINGS, footprint } from "./buildings.js";

export const TICK_RATE = 60;
export const MAP_SIZE = 128;

export function createWorld({ seed = 1, size = MAP_SIZE } = {}) {
  return {
    tick: 0,
    seed,
    size,
    map: generateMap(seed, size),
    entities: new Map(), // id → { id, type, x, y, rot }; x, y is the top-left tile
    grid: new Int32Array(size * size), // entity id on each tile, 0 = empty
    nextId: 1,
    version: 0, // bumped whenever entities change, so the view knows to redraw them
  };
}

export function step(world) {
  world.tick++;
}

const inMap = (world, x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < world.size && y < world.size;

// What's on tile (x, y), or null outside the map.
export function tileAt(world, x, y) {
  if (!inMap(world, x, y)) return null;
  const { size, ore, amount } = world.map;
  const i = y * size + x;
  return { x, y, ore: ore[i], oreName: ORE_NAMES[ore[i]], amount: amount[i], entity: entityAt(world, x, y) };
}

export function entityAt(world, x, y) {
  if (!inMap(world, x, y)) return null;
  return world.entities.get(world.grid[y * world.size + x]) || null;
}

// Why a building can't go at (x, y), or null if it can.
export function canPlace(world, type, x, y, rot) {
  if (!BUILDINGS[type]) return "Unknown building";
  const { w, h } = footprint(type, rot);
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (!inMap(world, tx, ty)) return "Off the map";
      if (world.grid[ty * world.size + tx]) return "Something is in the way";
    }
  }
  return null;
}

// Places a building and returns it, or returns null if it doesn't fit.
export function place(world, type, x, y, rot = 0) {
  if (canPlace(world, type, x, y, rot)) return null;
  const entity = { id: world.nextId++, type, x, y, rot: rot & 3 };
  world.entities.set(entity.id, entity);
  fill(world, entity, entity.id);
  world.version++;
  return entity;
}

// Removes whatever building covers (x, y) and returns it, or null if there was none.
export function removeAt(world, x, y) {
  const entity = entityAt(world, x, y);
  if (!entity) return null;
  world.entities.delete(entity.id);
  fill(world, entity, 0);
  world.version++;
  return entity;
}

function fill(world, entity, id) {
  const { w, h } = footprint(entity.type, entity.rot);
  for (let ty = entity.y; ty < entity.y + h; ty++) {
    for (let tx = entity.x; tx < entity.x + w; tx++) world.grid[ty * world.size + tx] = id;
  }
}
