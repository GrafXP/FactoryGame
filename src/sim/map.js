import { createRng, fbm } from "./rng.js";

// Resources a tile can hold. Stored per tile as a byte in map.ore.
export const ORE = { NONE: 0, IRON: 1, COPPER: 2, COAL: 3, STONE: 4 };
export const ORE_NAMES = ["Ground", "Iron ore", "Copper ore", "Coal", "Stone"];

// How often each ore gets an extra patch beyond the starting four.
const EXTRA_WEIGHTS = [
  [ORE.IRON, 0.35],
  [ORE.COPPER, 0.3],
  [ORE.COAL, 0.2],
  [ORE.STONE, 0.15],
];
// Radius of the guaranteed patch of each ore near the map centre.
const START_RADIUS = { [ORE.IRON]: 5.5, [ORE.COPPER]: 5, [ORE.COAL]: 4.5, [ORE.STONE]: 4 };
const START_AREA = 22; // extra patches stay this far from the centre

// Generates the resource layer: one guaranteed patch of each ore near the centre
// (so every game can start), then random patches further out that get bigger and
// richer the further they are from the centre. Tiles are indexed y * size + x.
export function generateMap(seed, size) {
  const rng = createRng(seed);
  const mid = size / 2;
  const patches = [];

  const fits = (p) =>
    p.x - p.r >= 2 &&
    p.y - p.r >= 2 &&
    p.x + p.r <= size - 2 &&
    p.y + p.r <= size - 2 &&
    patches.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > p.r + q.r + 3);

  const baseAngle = rng() * Math.PI * 2;
  const startOres = [ORE.IRON, ORE.COPPER, ORE.COAL, ORE.STONE];
  startOres.forEach((ore, i) => {
    // Try a spot on a ring round the centre, drifting outwards if it doesn't fit.
    for (let attempt = 0; attempt < 50; attempt++) {
      const angle = baseAngle + (i * Math.PI) / 2 + (rng() - 0.5) * 0.8;
      const dist = 11 + rng() * 4 + attempt * 0.3;
      const p = { ore, x: mid + Math.cos(angle) * dist, y: mid + Math.sin(angle) * dist, r: START_RADIUS[ore], rich: 400 };
      if (fits(p) || attempt === 49) {
        patches.push(p);
        break;
      }
    }
  });

  const extra = Math.round((size * size) / 900);
  for (let n = 0, attempts = 0; n < extra && attempts < extra * 40; attempts++) {
    const x = rng() * size;
    const y = rng() * size;
    const far = Math.hypot(x - mid, y - mid) / mid; // 0 at centre, ~1 at an edge
    if (far * mid < START_AREA) continue;
    const p = { ore: pickWeighted(rng), x, y, r: 3 + rng() * 3 + far * 3, rich: 400 + far * 1200 };
    if (!fits(p)) continue;
    patches.push(p);
    n++;
  }

  const ore = new Uint8Array(size * size);
  const amount = new Uint32Array(size * size);
  patches.forEach((p, i) => {
    const noiseSeed = seed + i * 101;
    const reach = Math.ceil(p.r * 1.4);
    for (let ty = Math.max(0, Math.floor(p.y) - reach); ty <= Math.min(size - 1, Math.floor(p.y) + reach); ty++) {
      for (let tx = Math.max(0, Math.floor(p.x) - reach); tx <= Math.min(size - 1, Math.floor(p.x) + reach); tx++) {
        const idx = ty * size + tx;
        if (ore[idx]) continue;
        // Wobble the edge with noise so patches are blobs, not circles.
        const edge = p.r * (1 + 0.35 * fbm(tx * 0.18, ty * 0.18, noiseSeed));
        const d = Math.hypot(tx + 0.5 - p.x, ty + 0.5 - p.y) / edge;
        if (d >= 1) continue;
        ore[idx] = p.ore;
        amount[idx] = Math.max(50, Math.round(p.rich * (1.25 - d)));
      }
    }
  });

  return { size, ore, amount };
}

function pickWeighted(rng) {
  let r = rng();
  for (const [ore, w] of EXTRA_WEIGHTS) {
    if ((r -= w) < 0) return ore;
  }
  return EXTRA_WEIGHTS[0][0];
}
