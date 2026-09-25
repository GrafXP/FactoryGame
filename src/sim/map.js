import { createRng, fbm, hash2 } from "./rng.js";

// What a tile is: plain ground, one of the ores, or water. Stored per tile as a
// byte (see chunks.js). Water isn't an ore: nothing can be built on it or mined.
export const ORE = { NONE: 0, IRON: 1, COPPER: 2, COAL: 3, STONE: 4 };
export const WATER = 5;
export const ORE_NAMES = ["Ground", "Iron ore", "Copper ore", "Coal", "Stone", "Water"];
export const isOre = (kind) => kind > ORE.NONE && kind < WATER;

// The map is generated a chunk at a time (CHUNK × CHUNK tiles), as it's needed, and
// the same seed always gives the same map whatever order the chunks come in: every
// chunk works out the ore patches and lakes near it from the seed alone.
export const CHUNK = 32;

// Ore patches. A new game has one of each ore on a ring round the start (0, 0),
// START_RING tiles out and well apart. Further out, the map is split into CELL ×
// CELL squares that each hold at most one patch, kept CELL_MARGIN inside its square
// so patches never run into each other; none come closer to the start than
// START_CLEAR. They get bigger and richer the further out they are.
const START_R = { [ORE.IRON]: 7, [ORE.COPPER]: 6.5, [ORE.COAL]: 6, [ORE.STONE]: 5.5 };
const START_RING = [30, 40]; // how far out the starting patches are, from and to
const START_RICH = 600;
const CELL = 96;
const CELL_MARGIN = 26;
const CELL_CHANCE = 0.75; // how many of the squares have a patch
const START_CLEAR = 90;
const MAX_R = 16; // a patch's radius before the wobble of its edge, at most
const WOBBLE = 0.35; // how far a patch's edge wanders in and out
const FAR = 800; // patches are at their biggest and richest from this far out
const EXTRA_WEIGHTS = [
  [ORE.IRON, 0.35],
  [ORE.COPPER, 0.3],
  [ORE.COAL, 0.2],
  [ORE.STONE, 0.15],
];

// Lakes: water wherever low-frequency noise is high enough, fading in beyond
// LAKE_CLEAR so the start stays dry, plus one lake a little way from the start
// (START_LAKE) so there's always water within reach.
const LAKE_SCALE = 0.012;
const LAKE_LEVEL = 0.34;
const LAKE_CLEAR = 70;
const LAKE_FADE = 80;
const START_LAKE = { ring: [85, 100], r: 11 };

// The starting patches and lake for a seed, worked out once.
const starts = new Map();
function startFeatures(seed) {
  let s = starts.get(seed);
  if (s) return s;
  const rng = createRng(seed);
  const base = rng() * Math.PI * 2;
  const patches = [ORE.IRON, ORE.COPPER, ORE.COAL, ORE.STONE].map((ore, i) => {
    const angle = base + (i * Math.PI) / 2 + (rng() - 0.5) * 0.6;
    const dist = START_RING[0] + rng() * (START_RING[1] - START_RING[0]);
    return { ore, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, r: START_R[ore], rich: START_RICH, noise: seed + i * 101 };
  });
  // The lake lies between two of the patches, well beyond them.
  const angle = base + Math.PI / 4 + Math.floor(rng() * 4) * (Math.PI / 2);
  const dist = START_LAKE.ring[0] + rng() * (START_LAKE.ring[1] - START_LAKE.ring[0]);
  const lake = { ore: WATER, x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, r: START_LAKE.r, noise: seed + 555 };
  s = { patches, lake };
  starts.set(seed, s);
  return s;
}

// The patch in square (i, j), or null if it has none.
function cellPatch(seed, i, j) {
  const h = (k) => hash2(i, j, seed * 16 + k);
  if (Math.hypot((i + 0.5) * CELL, (j + 0.5) * CELL) < START_CLEAR || h(0) >= CELL_CHANCE) return null;
  const x = i * CELL + CELL_MARGIN + h(1) * (CELL - 2 * CELL_MARGIN);
  const y = j * CELL + CELL_MARGIN + h(2) * (CELL - 2 * CELL_MARGIN);
  const far = Math.min(1, Math.hypot(x, y) / FAR);
  return {
    ore: pickWeighted(h(3)),
    x,
    y,
    r: Math.min(MAX_R, 6 + h(4) * 4 + far * 6),
    rich: 500 + far * 2500,
    noise: Math.floor(h(5) * 0x7fffffff),
  };
}

function pickWeighted(r) {
  for (const [ore, w] of EXTRA_WEIGHTS) {
    if ((r -= w) < 0) return ore;
  }
  return EXTRA_WEIGHTS[0][0];
}

// The patches that could reach into the box from (x0, y0) to (x1, y1).
function patchesNear(seed, x0, y0, x1, y1) {
  const reach = MAX_R * (1 + WOBBLE);
  const near = (p) => p.x + reach > x0 && p.x - reach < x1 && p.y + reach > y0 && p.y - reach < y1;
  const found = startFeatures(seed).patches.filter(near);
  for (let j = Math.floor((y0 - reach) / CELL); j <= Math.floor((y1 + reach) / CELL); j++) {
    for (let i = Math.floor((x0 - reach) / CELL); i <= Math.floor((x1 + reach) / CELL); i++) {
      const p = cellPatch(seed, i, j);
      if (p && near(p)) found.push(p);
    }
  }
  return found;
}

// Whether tile (x, y) is in blob p: a circle of radius p.r with a wobbly edge.
// Returns how far in it is (0 at the middle, 1 at the edge), or -1 if it isn't.
function inBlob(p, x, y) {
  const edge = p.r * (1 + WOBBLE * fbm(x * 0.18, y * 0.18, p.noise));
  const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) / edge;
  return d < 1 ? d : -1;
}

function isLake(seed, x, y) {
  const d = Math.hypot(x, y);
  if (d < LAKE_CLEAR) return false;
  const fade = Math.min(1, (d - LAKE_CLEAR) / LAKE_FADE);
  return fbm(x * LAKE_SCALE, y * LAKE_SCALE, seed + 7777) * fade > LAKE_LEVEL;
}

// Generates chunk (cx, cy): what each tile is (`ore`) and how much ore it holds
// (`amount`), indexed (y % CHUNK) * CHUNK + (x % CHUNK). Ore patches are richest in
// the middle; everything else that isn't ore may be lake.
export function generateChunk(seed, cx, cy) {
  const x0 = cx * CHUNK;
  const y0 = cy * CHUNK;
  const ore = new Uint8Array(CHUNK * CHUNK);
  const amount = new Uint32Array(CHUNK * CHUNK);
  const reach = MAX_R * (1 + WOBBLE);
  for (const p of patchesNear(seed, x0, y0, x0 + CHUNK, y0 + CHUNK)) {
    const from = (v, o) => Math.max(0, Math.floor(v - reach) - o);
    const to = (v, o) => Math.min(CHUNK - 1, Math.ceil(v + reach) - o);
    for (let ty = from(p.y, y0); ty <= to(p.y, y0); ty++) {
      for (let tx = from(p.x, x0); tx <= to(p.x, x0); tx++) {
        const i = ty * CHUNK + tx;
        if (ore[i]) continue;
        const d = inBlob(p, x0 + tx, y0 + ty);
        if (d < 0) continue;
        ore[i] = p.ore;
        amount[i] = Math.max(50, Math.round(p.rich * (1.25 - d)));
      }
    }
  }
  const { lake } = startFeatures(seed);
  for (let ty = 0; ty < CHUNK; ty++) {
    for (let tx = 0; tx < CHUNK; tx++) {
      const i = ty * CHUNK + tx;
      if (!ore[i] && (inBlob(lake, x0 + tx, y0 + ty) >= 0 || isLake(seed, x0 + tx, y0 + ty))) ore[i] = WATER;
    }
  }
  return { ore, amount };
}
