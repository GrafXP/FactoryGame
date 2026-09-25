import { footprint } from "../sim/buildings.js";
import { CHUNK, chunkKey } from "../sim/chunks.js";

// Which buildings are on screen, so the layers that draw them (buildings, belt
// items, moving parts, icons) only cost what's in view however big the factory is.
//
// Buildings are kept by the chunk their top-left tile is in, worked out again when
// the layout changes (world.version). Each frame the view asks for the ones
// overlapping the tiles on screen; the rectangle is widened to whole STEPs of tiles,
// so the list, and the buildings drawn from it, only change every few tiles of
// panning.
const STEP = 8;
const BIGGEST = 4; // tiles: a building with its top-left this far out of view can still reach into it

export function createVisible() {
  let indexed = -1;
  const byChunk = new Map(); // chunk key → buildings with their top-left tile in it
  let key = "";
  let list = [];

  const index = (world) => {
    byChunk.clear();
    for (const e of world.entities.values()) {
      const k = chunkKey(Math.floor(e.x / CHUNK), Math.floor(e.y / CHUNK));
      let at = byChunk.get(k);
      if (!at) byChunk.set(k, (at = []));
      at.push(e);
    }
    indexed = world.version;
  };

  return {
    // The buildings overlapping tiles x0..x1, y0..y1 (ground coordinates, not
    // whole tiles), and whether that list is new since the last call.
    update(world, { x0, y0, x1, y1 }) {
      const ax = Math.floor(x0 / STEP) * STEP;
      const ay = Math.floor(y0 / STEP) * STEP;
      const bx = Math.ceil(x1 / STEP) * STEP;
      const by = Math.ceil(y1 / STEP) * STEP;
      const next = `${world.version} ${ax} ${ay} ${bx} ${by}`;
      if (next === key) return { list, changed: false };
      key = next;
      if (indexed !== world.version) index(world);
      list = [];
      for (let cy = Math.floor((ay - BIGGEST) / CHUNK); cy <= Math.floor(by / CHUNK); cy++) {
        for (let cx = Math.floor((ax - BIGGEST) / CHUNK); cx <= Math.floor(bx / CHUNK); cx++) {
          const at = byChunk.get(chunkKey(cx, cy));
          if (!at) continue;
          for (const e of at) {
            if (e.x >= bx || e.y >= by) continue;
            const { w, h } = footprint(e.type, e.rot);
            if (e.x + w > ax && e.y + h > ay) list.push(e);
          }
        }
      }
      return { list, changed: true };
    },
  };
}
