import { createWorld, step, tileAt, TICK_RATE } from "./sim/world.js";
import { createView } from "./render/view.js";
import { createControls } from "./render/controls.js";

const TICK_MS = 1000 / TICK_RATE;
const MAX_TICKS_PER_FRAME = 10; // after a long stall, drop time instead of freezing to catch up
const STATS_MS = 500; // how often FPS/UPS are reported

// Owns the world and the view and runs the sim at a fixed tick rate,
// independent of the display's frame rate.
export function createGame(container, { theme = "dark", seed, onTick, onStats, onTileTap, onTileHover } = {}) {
  const world = createWorld({ seed });
  const view = createView(container, world, { theme });

  let selected = null;
  const disposeControls = createControls(view.canvas, view.cam, {
    onTap(t) {
      selected = t && tileAt(world, t.x, t.y);
      view.setSelected(selected);
      onTileTap?.(selected);
    },
    onHover: (t) => onTileHover?.(t && tileAt(world, t.x, t.y)),
  });

  let running = true;
  let last = performance.now();
  let acc = 0;
  let raf = 0;
  let frames = 0;
  let ticks = 0;
  let statsFrom = last;

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
      ticks += n;
      if (n) onTick?.(world);
    }
    last = now;
    view.render();

    frames++;
    if (now - statsFrom >= STATS_MS) {
      const secs = (now - statsFrom) / 1000;
      onStats?.({ fps: frames / secs, ups: ticks / secs });
      frames = ticks = 0;
      statsFrom = now;
    }
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
      disposeControls();
      view.dispose();
    },
  };
}
