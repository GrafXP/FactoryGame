// Simulation state. Pure data + logic: no three.js, no DOM, so it can be saved,
// loaded and run headless.
import { generateMap, ORE_NAMES } from "./map.js";

export const TICK_RATE = 60;
export const MAP_SIZE = 128;

export function createWorld({ seed = 1, size = MAP_SIZE } = {}) {
  return {
    tick: 0,
    seed,
    size,
    map: generateMap(seed, size),
  };
}

export function step(world) {
  world.tick++;
}

// What's on tile (x, y), or null outside the map.
export function tileAt(world, x, y) {
  const { size, ore, amount } = world.map;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size || y >= size) return null;
  const i = y * size + x;
  return { x, y, ore: ore[i], oreName: ORE_NAMES[ore[i]], amount: amount[i] };
}
