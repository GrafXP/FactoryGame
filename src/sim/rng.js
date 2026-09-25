// Seeded randomness. Everything the sim generates must come from here, never
// Math.random(), so a seed always gives the same world.

// "42" → 42; any other string is hashed (FNV-1a) to a 32-bit seed.
export function parseSeed(value) {
  const s = String(value).trim();
  if (/^\d{1,9}$/.test(s)) return Number(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// mulberry32: small, fast, good enough for procedural generation. Returns floats in [0, 1).
export function createRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stateless hash of an integer lattice point → [0, 1).
export function hash2(x, y, seed) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

// 2D value noise in [-1, 1].
export function valueNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return (top + (bottom - top) * ty) * 2 - 1;
}

// Three octaves of value noise, roughly in [-1, 1].
export function fbm(x, y, seed) {
  return (valueNoise(x, y, seed) * 4 + valueNoise(x * 2, y * 2, seed + 1) * 2 + valueNoise(x * 4, y * 4, seed + 2)) / 7;
}
