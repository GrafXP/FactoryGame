import { createWorld, step, TICK_RATE } from "./sim/world.js";
import { createView } from "./render/view.js";

const TICK_MS = 1000 / TICK_RATE;
const MAX_TICKS_PER_FRAME = 10; // after a long stall, drop time instead of freezing to catch up

// Owns the world and the view and runs the sim at a fixed tick rate,
// independent of the display's frame rate.
export function createGame(container, { theme = "dark", onTick } = {}) {
  const world = createWorld();
  const view = createView(container, world, { theme });

  let running = true;
  let last = performance.now();
  let acc = 0;
  let raf = 0;

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (running) {
      acc += now - last;
      let n = 0;
      while (acc >= TICK_MS && n < MAX_TICKS_PER_FRAME) {
        step(world);
        acc -= TICK_MS;
        n++;
      }
      if (n === MAX_TICKS_PER_FRAME) acc = 0;
      if (n) onTick?.(world);
    }
    last = now;
    view.render();
  };
  raf = requestAnimationFrame(frame);

  return {
    world,
    canvas: view.canvas,
    get running() {
      return running;
    },
    pause() {
      running = false;
    },
    resume() {
      running = true;
    },
    setTheme: view.setTheme,
    dispose() {
      cancelAnimationFrame(raf);
      view.dispose();
    },
  };
}
