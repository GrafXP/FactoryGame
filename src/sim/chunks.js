// The map is endless: tiles are any whole (x, y), grouped in CHUNK × CHUNK chunks
// that are generated from the seed (map.js) the first time anything looks at them,
// so only land that's been seen costs anything. A chunk holds what each tile is
// (`ore`: ground, an ore or water), how much ore is left on it (`amount`) and the
// id of the building on it (`ids`, 0 for none), all indexed by tileIndex.
//
// `changed` marks a chunk that has been dug into: only those go in the save, since
// the rest come back from the seed. `built` counts its tiles with a building on
// them. `version` goes up whenever one of its tiles changes (ore running out, a
// building going up or coming down), so the view knows to repaint it. Chunks just as
// the seed made them, with nothing built and no pollution (pollution.js), can be
// let go of (forgetChunks) and made again when they're next needed.
//
// world.charted holds the chunks the map view shows (their keys, see chunkKey):
// the ones the player has looked at, and the ones radars have scanned (radar.js).
// Everything else is fog on the map view; the playfield always shows everything.
import { CHUNK, generateChunk } from "./map.js";

export { CHUNK };
const SHIFT = Math.log2(CHUNK);
const MASK = CHUNK - 1;

// Tiles this far from the start are off the map, which keeps chunk keys whole and
// positions precise enough to draw.
export const LIMIT = 1 << 16;

export const inMap = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x > -LIMIT && x < LIMIT && y > -LIMIT && y < LIMIT;

// A chunk's key, one number for its (cx, cy), and back.
export const chunkKey = (cx, cy) => (cx + 0x8000) * 0x10000 + (cy + 0x8000);
export const keyChunk = (key) => ({ cx: Math.floor(key / 0x10000) - 0x8000, cy: (key % 0x10000) - 0x8000 });

// Where tile (x, y) is in its chunk's arrays.
export const tileIndex = (x, y) => ((y & MASK) << SHIFT) | (x & MASK);

export const newChunk = (cx, cy, { ore, amount }, changed = false) => ({
  cx,
  cy,
  ore,
  amount,
  ids: new Int32Array(CHUNK * CHUNK),
  changed,
  built: 0,
  version: 0,
  pollution: 0, // see pollution.js
  absorb: -1,
  out: 0,
});

// Chunk (cx, cy), generated if it hasn't been yet.
export function getChunk(world, cx, cy) {
  const key = chunkKey(cx, cy);
  let c = world.chunks.get(key);
  if (!c) world.chunks.set(key, (c = newChunk(cx, cy, generateChunk(world.seed, cx, cy))));
  return c;
}

// The chunk tile (x, y) is in. The last one asked for is kept at hand, since the
// sim mostly looks at a few tiles near each other at a time.
export function chunkOf(world, x, y) {
  const cx = x >> SHIFT;
  const cy = y >> SHIFT;
  const last = world.lastChunk;
  if (last && last.cx === cx && last.cy === cy) return last;
  return (world.lastChunk = getChunk(world, cx, cy));
}

export const kindAt = (world, x, y) => chunkOf(world, x, y).ore[tileIndex(x, y)];
export const amountAt = (world, x, y) => chunkOf(world, x, y).amount[tileIndex(x, y)];
export const idAt = (world, x, y) => chunkOf(world, x, y).ids[tileIndex(x, y)];

export function setIdAt(world, x, y, id) {
  const c = chunkOf(world, x, y);
  const i = tileIndex(x, y);
  c.built += (id ? 1 : 0) - (c.ids[i] ? 1 : 0);
  c.ids[i] = id;
  c.version++;
}

// Lets go of the chunks outside (cx0, cy0)–(cx1, cy1) that are just as the seed
// made them, with nothing built on them and no pollution in them, so exploring far
// doesn't fill memory.
// Returns how many went.
export function forgetChunks(world, cx0, cy0, cx1, cy1) {
  let n = 0;
  for (const [key, c] of world.chunks) {
    if (c.changed || c.built || c.pollution || (c.cx >= cx0 && c.cx <= cx1 && c.cy >= cy0 && c.cy <= cy1)) continue;
    world.chunks.delete(key);
    n++;
  }
  world.lastChunk = null;
  return n;
}

export const isCharted = (world, cx, cy) => world.charted.has(chunkKey(cx, cy));

// Charts chunk (cx, cy). Returns whether it's new to the map.
export function chart(world, cx, cy) {
  const key = chunkKey(cx, cy);
  if (world.charted.has(key)) return false;
  world.charted.add(key);
  world.chartVersion++;
  return true;
}

// Charts every chunk from (cx0, cy0) to (cx1, cy1), both included.
export function chartArea(world, cx0, cy0, cx1, cy1) {
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) chart(world, cx, cy);
}
