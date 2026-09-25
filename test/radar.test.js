import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place } from "../src/sim/world.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { CHUNK } from "../src/sim/map.js";
import { isCharted, chart } from "../src/sim/chunks.js";
import { SCAN, SCAN_ORDER, RANGE, radarTarget, radarCoverage } from "../src/sim/radar.js";
import { serialize, deserialize } from "../src/sim/save.js";
import { charge, ALL, clearArea } from "./helpers.js";

const run = (world, ticks, power = true) => {
  for (let i = 0; i < ticks; i++) {
    if (power) charge(world);
    step(world);
  }
};
// A world with nothing charted and a radar in it.
const setup = () => {
  const world = createWorld({ milestones: ALL, seed: 3, charted: false });
  const { x, y } = clearArea(world, 2);
  const radar = place(world, "radar", x, y, 0);
  return { world, radar, cx: Math.floor(x / CHUNK), cy: Math.floor(y / CHUNK) };
};

test("the scan goes out in rings, nearest first, as far as the radar's range", () => {
  assert.deepEqual(SCAN_ORDER[0], [0, 0]);
  assert.deepEqual(SCAN_ORDER.slice(1, 5), [[0, -1], [1, 0], [0, 1], [-1, 0]], "then north, east, south, west");
  const far = SCAN_ORDER.at(-1);
  assert.ok(Math.hypot(...far) <= RANGE && Math.hypot(...far) > RANGE - 1);
  const d2 = ([dx, dy]) => dx * dx + dy * dy;
  for (let i = 1; i < SCAN_ORDER.length; i++) assert.ok(d2(SCAN_ORDER[i]) >= d2(SCAN_ORDER[i - 1]));
});

test("a powered radar charts the chunks round it one at a time", () => {
  const { world, radar, cx, cy } = setup();
  run(world, SCAN - 1);
  assert.equal(world.charted.size, 0);
  run(world, 1);
  assert.ok(isCharted(world, cx, cy), "its own chunk first");
  run(world, SCAN * 8);
  assert.equal(world.charted.size, 9);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) assert.ok(isCharted(world, cx + dx, cy + dy));
  assert.deepEqual(radarCoverage(world, radar), { charted: 9, total: SCAN_ORDER.length });
  assert.equal(radar.status, "working");
});

test("a radar without power scans nothing", () => {
  const { world, radar } = setup();
  run(world, SCAN * 2, false);
  assert.equal(world.charted.size, 0);
  assert.equal(radar.status, "no-power");
});

test("a radar skips what's charted already, and once its range is charted it's done and uses no power", () => {
  const { world, radar, cx, cy } = setup();
  for (const [dx, dy] of SCAN_ORDER.slice(0, -1)) chart(world, cx + dx, cy + dy);
  const [lx, ly] = SCAN_ORDER.at(-1);
  run(world, 1);
  assert.deepEqual(radarTarget(radar), { cx: cx + lx, cy: cy + ly }, "straight on to the only chunk left");
  run(world, SCAN);
  assert.ok(isCharted(world, cx + lx, cy + ly));
  assert.equal(radar.status, "done");
  assert.equal(radarTarget(radar), null);
  const full = 2 * BUILDINGS.radar.draw;
  radar.energy = full;
  run(world, 60, false);
  assert.equal(radar.energy, full, "a finished radar draws nothing");
});

test("a radar's scan carries on after a save", () => {
  const { world, radar } = setup();
  run(world, SCAN * 3 + 50);
  const loaded = deserialize(structuredClone(serialize(world)));
  const again = loaded.entities.get(radar.id);
  assert.deepEqual([again.next, again.progress, again.status], [radar.next, radar.progress, radar.status]);
  run(world, SCAN * 2);
  run(loaded, SCAN * 2);
  assert.deepEqual(serialize(loaded), serialize(world));
});
