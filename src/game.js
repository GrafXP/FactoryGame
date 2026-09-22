import { createWorld, step, tileAt, TICK_RATE } from "./sim/world.js";
import { createView } from "./render/view.js";
import { createControls } from "./render/controls.js";
import { createBuilder } from "./build.js";

const TICK_MS = 1000 / TICK_RATE;
const MAX_TICKS_PER_FRAME = 10; // after a long stall, drop time instead of freezing to catch up
const STATS_MS = 500; // how often FPS/UPS are reported

// Owns the world and the view and runs the sim at a fixed tick rate,
// independent of the display's frame rate.
export function createGame(
  container,
  { theme = "dark", seed, onTick, onStats, onInspect, onTileHover, onBuildChange, onMessage } = {},
) {
  const world = createWorld({ seed });
  const view = createView(container, world, { theme });
  const builder = createBuilder(world, view, { onChange: onBuildChange, onMessage, onInspect });

  const disposeControls = createControls(view.canvas, view.cam, {
    onPoint(p) {
      builder.point(p);
      onTileHover?.(p && tileAt(world, Math.floor(p.x), Math.floor(p.y)));
    },
    onTap: builder.tap,
    canPaint: builder.canPaint,
    onPaint: { start: builder.paintStart, move: builder.paintMove, end: builder.paintEnd, cancel: builder.paintCancel },
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
    builder,
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
