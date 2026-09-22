// Simulation state. Pure data + logic: no three.js, no DOM, so it can be saved,
// loaded and run headless.
export const TICK_RATE = 60;
export const MAP_SIZE = 64;

export function createWorld() {
  return {
    tick: 0,
    size: MAP_SIZE,
  };
}

export function step(world) {
  world.tick++;
}
