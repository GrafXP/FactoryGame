import { createWorld, step, tileAt, TICK_RATE } from "./sim/world.js";
import { baseNear } from "./sim/enemies.js";
import { createView, DEFAULT_ZOOM } from "./render/view.js";
import { chartArea, forgetChunks } from "./sim/chunks.js";
import { createControls } from "./render/controls.js";
import { createBuilder } from "./build.js";
import { footprint } from "./sim/buildings.js";

const TICK_MS = 1000 / TICK_RATE;
const MAX_TICKS_PER_FRAME = 10; // at 1×: after a long stall, drop time instead of freezing to catch up
const FAST_BUDGET_MS = 10; // how long the ticks a speed above 1× adds may take in a frame
const STATS_MS = 500; // how often FPS/UPS and the timings are reported
const FORGET_MS = 10000; // how often land far from the camera is let go of
const KEEP_CHUNKS = 256; // below this many chunks, nothing is let go of

// The game speeds the player can pick: how many times TICK_RATE the sim runs at.
export const SPEEDS = [0.5, 1, 2, 4, 8];

// Owns the world and the view and runs the sim at a fixed tick rate times `speed`
// (one of SPEEDS), independent of the display's frame rate. Plays `world` (a loaded save) if given,
// otherwise a new world from `seed` (with `enemies` on, or peaceful), starting over
// its HUB if it has one.
// `afterStep(world)` runs after every tick (the benchmark empties its chests).
// onStats gets the frame and tick rates, how long a tick and drawing a frame took
// on average, in ms, and the draw calls in the last frame.
//
// What the player looks at on the playfield gets charted, as the land round a
// Factorio character does, so the map view shows it. The map view is for looking:
// a tap on an enemy base's ring calls onBase(key) with the base's key (enemies.js),
// a tap anywhere else zooms in there, and nothing is built from it. onMapMode(on) is
// told when it goes in and out of the map view (and once at the start).
export function createGame(
  container,
  { theme = "dark", world = null, seed, enemies = true, speed = 1, afterStep, onTick, onStats, onInspect, onTileHover, onBuildChange, onMessage, onMapMode, onBase } = {},
) {
  world ||= createWorld({ seed, enemies });
  const view = createView(container, world, { theme });
  const builder = createBuilder(world, view, { onChange: onBuildChange, onMessage, onInspect });
  const centerOn = (e, zoom) => {
    const { w, h } = footprint(e.type, e.rot);
    view.cam.zoomTo(e.x + w / 2, e.y + h / 2, zoom);
  };
  const hub = [...world.entities.values()].find((e) => e.type === "hub");
  if (hub) centerOn(hub, DEFAULT_ZOOM);

  let chartedView = "";
  let toldMap = false;
  let wasMap = null;
  const chartView = () => {
    if (view.mapMode !== wasMap) onMapMode?.((wasMap = view.mapMode));
    if (view.mapMode) {
      if (!toldMap) onMessage?.("The map: only land you've seen or a radar has scanned shows. Tap it to zoom in there, or tap an enemy base's ring to see it.");
      toldMap = true;
      return;
    }
    const r = view.visibleChunks();
    const key = r && `${r.cx0} ${r.cy0} ${r.cx1} ${r.cy1}`;
    if (!r || key === chartedView) return;
    chartedView = key;
    chartArea(world, r.cx0, r.cy0, r.cx1, r.cy1);
  };

  const disposeControls = createControls(view.canvas, view.cam, {
    onPoint(p) {
      builder.point(view.mapMode ? null : p);
      onTileHover?.(p && tileAt(world, Math.floor(p.x), Math.floor(p.y)));
    },
    onTap(p, pointerType) {
      if (!view.mapMode) return builder.tap(p, pointerType);
      const base = baseNear(world, p.x, p.y, Math.max(12, view.cam.zoom / 16));
      if (base !== null) onBase?.(base);
      else view.cam.zoomTo(p.x, p.y, DEFAULT_ZOOM);
    },
    canPaint: (p) => !view.mapMode && builder.canPaint(p),
    onPaint: { start: builder.paintStart, move: builder.paintMove, end: builder.paintEnd, cancel: builder.paintCancel },
  });

  let running = true;
  let last = performance.now();
  let acc = 0;
  let raf = 0;
  let frames = 0;
  let ticks = 0;
  let simMs = 0;
  let drawMs = 0;
  let statsFrom = last;
  let forgotAt = last;

  const frame = (now) => {
    raf = requestAnimationFrame(frame);
    if (running) {
      const dt = now - last;
      acc += dt * speed;
      let n = 0;
      const from = performance.now();
      while (acc >= TICK_MS && n < MAX_TICKS_PER_FRAME * Math.max(1, speed)) {
        // Once it's kept up with real time, a faster speed only gets its share of the
        // frame, so one the computer can't keep up with runs as fast as it can and
        // still draws smoothly.
        if (n * TICK_MS >= dt && performance.now() - from > FAST_BUDGET_MS) break;
        step(world);
        afterStep?.(world);
        acc -= TICK_MS;
        n++;
      }
      if (n) simMs += performance.now() - from;
      if (acc >= TICK_MS) acc = 0;
      ticks += n;
      if (n) onTick?.(world);
    }
    last = now;
    chartView();
    if (now - forgotAt > FORGET_MS && world.chunks.size > KEEP_CHUNKS) {
      forgotAt = now;
      const r = view.visibleChunks();
      if (r) forgetChunks(world, r.cx0 - 2, r.cy0 - 2, r.cx1 + 2, r.cy1 + 2);
    }
    const drawFrom = performance.now();
    view.render();
    drawMs += performance.now() - drawFrom;

    frames++;
    if (now - statsFrom >= STATS_MS) {
      const secs = (now - statsFrom) / 1000;
      const tickMs = ticks ? simMs / ticks : 0;
      onStats?.({ fps: frames / secs, ups: ticks / secs, tickMs, frameMs: drawMs / frames, drawCalls: view.drawCalls });
      frames = ticks = 0;
      simMs = drawMs = 0;
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
    get speed() {
      return speed;
    },
    setSpeed(s) {
      speed = s;
    },
    setTheme: view.setTheme,
    // Whether the map view shows pollution.
    setPollutionOverlay: view.setPollutionOverlay,
    // Moves the camera to look at ground point (x, y), out of the map view if need be.
    lookAt(x, y) {
      view.cam.zoomTo(x, y, view.mapMode ? DEFAULT_ZOOM : view.cam.zoom);
    },
    // Moves the camera to look at building e (out of the map view, if need be) and
    // shows its panel.
    focus(e) {
      centerOn(e, view.mapMode ? DEFAULT_ZOOM : view.cam.zoom);
      builder.inspect(e);
    },
    dispose() {
      cancelAnimationFrame(raf);
      disposeControls();
      view.dispose();
    },
  };
}
