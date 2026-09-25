// Radars chart the map (chunks.js): each scans the chunks round it one at a time,
// nearest first, out to `range` chunks away, taking `scan` ticks of work (and power)
// for each. Chunks that are already charted, by the player looking at them or by
// another radar, are skipped straight away. Once everything in range is charted
// it's done, and uses no more power.
//
// `next` is how far it has got through SCAN_ORDER and `progress` how far into the
// scan of that chunk. status is "working", "no-power" or "done".
import { BUILDINGS } from "./buildings.js";
import { CHUNK } from "./map.js";
import { isCharted, chart } from "./chunks.js";
import { usePower } from "./power.js";

export const { range: RANGE, scan: SCAN } = BUILDINGS.radar;

// The chunks a radar scans, as [dx, dy] from its own: nearest first, and at each
// distance round clockwise from north, so its picture of the map grows in rings.
export const SCAN_ORDER = (() => {
  const list = [];
  for (let dy = -RANGE; dy <= RANGE; dy++) {
    for (let dx = -RANGE; dx <= RANGE; dx++) if (dx * dx + dy * dy <= RANGE * RANGE) list.push([dx, dy]);
  }
  const angle = ([dx, dy]) => (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2);
  return list.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2) || angle(a) - angle(b));
})();

export const radarState = () => ({ next: 0, progress: 0, status: "working" });

// The chunk a radar stands in (its top-left tile's).
const home = (r) => ({ cx: Math.floor(r.x / CHUNK), cy: Math.floor(r.y / CHUNK) });

// The chunk it's scanning, { cx, cy }, or null once it's done.
export function radarTarget(r) {
  const at = SCAN_ORDER[r.next];
  if (!at) return null;
  const { cx, cy } = home(r);
  return { cx: cx + at[0], cy: cy + at[1] };
}

// How many of the chunks in its range are charted, out of how many.
export function radarCoverage(world, r) {
  const { cx, cy } = home(r);
  let charted = 0;
  for (const [dx, dy] of SCAN_ORDER) if (isCharted(world, cx + dx, cy + dy)) charted++;
  return { charted, total: SCAN_ORDER.length };
}

export function stepRadar(world, r) {
  let target = radarTarget(r);
  while (target && isCharted(world, target.cx, target.cy)) {
    r.next++;
    r.progress = 0;
    target = radarTarget(r);
  }
  if (!target) {
    r.status = "done";
    return;
  }
  if (!usePower(world, r)) return;
  r.status = "working";
  if (++r.progress < SCAN) return;
  chart(world, target.cx, target.cy);
  r.next++;
  r.progress = 0;
}
