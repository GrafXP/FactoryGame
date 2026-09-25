import * as THREE from "three";
import { CHUNK, WATER, isOre } from "../sim/map.js";
import { getChunk, chunkKey, isCharted } from "../sim/chunks.js";
import { isConveyor } from "../sim/transport.js";

// The ground, drawn a chunk at a time for the chunks round the camera: a texture
// with a texel per tile (ground, ore, water) and a rock on every ore tile, richer
// tiles getting bigger rocks. Zoomed far out it's the map view instead: the same
// textures in flat colours, with ore brighter the more is left and buildings as
// blocks, for charted chunks only. Uncharted land isn't drawn at all, so the fog is
// the background colour.
//
// Chunks are generated (sim/chunks.js) as they come into view. That doesn't change
// the world: a chunk is whatever the seed says it is, generated or not.
const ORE_TINT = 0.55; // how strongly an ore colours its ground tile
const RICH = 1500; // ore amount drawn as the biggest rock and the brightest on the map

// Cheap per-tile hash for cosmetic jitter. Render-only, so it doesn't need the sim's rng.
export const jitter = (x, y, k) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

export function createTerrain(parent) {
  const plane = new THREE.PlaneGeometry(CHUNK, CHUNK).rotateX(-Math.PI / 2);
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const rockMaterial = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 });
  const shown = new Map(); // chunk key → how it's drawn (see make)
  let colors = null;
  let theme = 0; // bumped on a theme change, so every chunk repaints
  let drawnKey = "";

  const make = (chunk) => {
    const pixels = new Uint8Array(CHUNK * CHUNK * 4);
    const tex = new THREE.DataTexture(pixels, CHUNK, CHUNK);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    const lit = new THREE.MeshStandardMaterial({ map: tex });
    const flat = new THREE.MeshBasicMaterial({ map: tex });
    const mesh = new THREE.Mesh(plane, lit);
    mesh.position.set(chunk.cx * CHUNK + CHUNK / 2, 0, chunk.cy * CHUNK + CHUNK / 2);
    parent.add(mesh);
    return { chunk, pixels, tex, lit, flat, mesh, rocks: null, painted: -1, mapMode: null, theme: -1 };
  };

  const drop = (v) => {
    parent.remove(v.mesh);
    v.tex.dispose();
    v.lit.dispose();
    v.flat.dispose();
    if (v.rocks) {
      parent.remove(v.rocks);
      v.rocks.dispose();
    }
  };

  const c = new THREE.Color();
  const tint = {};
  const setPixel = (pixels, i, color) => {
    // Texture rows run bottom-up in v, which is north-to-south (-z) on the rotated plane.
    const t = ((CHUNK - 1 - ((i / CHUNK) | 0)) * CHUNK + (i % CHUNK)) * 4;
    const hex = color.getHex(); // sRGB, clamped
    pixels[t] = hex >> 16;
    pixels[t + 1] = (hex >> 8) & 255;
    pixels[t + 2] = hex & 255;
    pixels[t + 3] = 255;
  };

  // The playfield: ground tinted by its ore, water, and a little jitter per tile.
  const paintGround = (v) => {
    const { chunk, pixels } = v;
    const x0 = chunk.cx * CHUNK;
    const y0 = chunk.cy * CHUNK;
    for (let i = 0; i < CHUNK * CHUNK; i++) {
      const kind = chunk.ore[i];
      const x = x0 + (i % CHUNK);
      const y = y0 + ((i / CHUNK) | 0);
      if (kind === WATER) c.copy(tint.water).multiplyScalar(0.97 + jitter(x, y, 0) * 0.06);
      else {
        c.copy(tint.ground);
        if (kind) c.lerp(tint.ore[kind], ORE_TINT);
        c.multiplyScalar(0.96 + jitter(x, y, 0) * 0.08);
      }
      setPixel(pixels, i, c);
    }
  };

  // The map view: flat colours, ore brighter the more is left, buildings as blocks.
  const paintMap = (v, world) => {
    const { chunk, pixels } = v;
    for (let i = 0; i < CHUNK * CHUNK; i++) {
      const kind = chunk.ore[i];
      const id = chunk.ids[i];
      if (id) c.copy(isConveyor(world.entities.get(id) || {}) ? tint.mapBelt : tint.mapBuilding);
      else if (kind === WATER) c.copy(tint.water);
      else if (kind) c.copy(tint.mapGround).lerp(tint.ore[kind], 0.55 + 0.45 * Math.min(1, chunk.amount[i] / RICH));
      else c.copy(tint.mapGround);
      setPixel(pixels, i, c);
    }
  };

  // A rock on every ore tile of the chunk, sized by what's left.
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const placeRocks = (v) => {
    const { chunk } = v;
    let n = 0;
    for (let i = 0; i < CHUNK * CHUNK; i++) if (isOre(chunk.ore[i])) n++;
    if (!v.rocks && !n) return;
    if (!v.rocks || v.rocks.instanceMatrix.count < n) {
      if (v.rocks) {
        parent.remove(v.rocks);
        v.rocks.dispose();
      }
      v.rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, Math.max(1, n));
      v.rocks.frustumCulled = false;
      parent.add(v.rocks);
    }
    let k = 0;
    for (let i = 0; i < CHUNK * CHUNK; i++) {
      const kind = chunk.ore[i];
      if (!isOre(kind)) continue;
      const x = chunk.cx * CHUNK + (i % CHUNK);
      const y = chunk.cy * CHUNK + ((i / CHUNK) | 0);
      const r = 0.16 + 0.14 * Math.min(1, chunk.amount[i] / RICH);
      p.set(x + 0.5 + (jitter(x, y, 1) - 0.5) * 0.35, r * 0.4, y + 0.5 + (jitter(x, y, 2) - 0.5) * 0.35);
      q.setFromEuler(e.set(jitter(x, y, 3) * 3, jitter(x, y, 4) * 6, 0));
      s.set(r, r * (0.7 + jitter(x, y, 5) * 0.4), r);
      v.rocks.setMatrixAt(k, m.compose(p, q, s));
      v.rocks.setColorAt(k, c.copy(tint.ore[kind]).multiplyScalar(0.9 + jitter(x, y, 6) * 0.2));
      k++;
    }
    v.rocks.count = k;
    v.rocks.visible = k > 0;
    v.rocks.instanceMatrix.needsUpdate = true;
    if (v.rocks.instanceColor) v.rocks.instanceColor.needsUpdate = true;
  };

  const paint = (v, world, mapMode) => {
    if (mapMode) paintMap(v, world);
    else {
      paintGround(v);
      placeRocks(v);
    }
    v.tex.needsUpdate = true;
    v.mesh.material = mapMode ? v.flat : v.lit;
    if (v.rocks) v.rocks.visible = !mapMode && v.rocks.count > 0;
    v.painted = v.chunk.version;
    v.mapMode = mapMode;
    v.theme = theme;
  };

  return {
    // Draws the chunks from (cx0, cy0) to (cx1, cy1), as the playfield or, with
    // mapMode, the map view, and lets go of the rest.
    update(world, { cx0, cy0, cx1, cy1 }, mapMode) {
      const key = `${cx0} ${cy0} ${cx1} ${cy1} ${mapMode} ${world.version} ${world.mapVersion} ${world.chartVersion} ${theme}`;
      if (key === drawnKey || !colors) return;
      drawnKey = key;
      const wanted = new Set();
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          if (mapMode && !isCharted(world, cx, cy)) continue;
          const k = chunkKey(cx, cy);
          wanted.add(k);
          let v = shown.get(k);
          if (!v) shown.set(k, (v = make(getChunk(world, cx, cy))));
          if (v.painted !== v.chunk.version || v.mapMode !== mapMode || v.theme !== theme) paint(v, world, mapMode);
        }
      }
      for (const [k, v] of shown) {
        if (wanted.has(k)) continue;
        drop(v);
        shown.delete(k);
      }
    },
    setTheme(palette) {
      colors = palette;
      tint.ground = new THREE.Color(palette.ground);
      tint.water = new THREE.Color(palette.water);
      tint.mapGround = new THREE.Color(palette.mapGround);
      tint.mapBuilding = new THREE.Color(palette.mapBuilding);
      tint.mapBelt = new THREE.Color(palette.mapBelt);
      tint.ore = {};
      for (const k in palette.ore) tint.ore[k] = new THREE.Color(palette.ore[k]);
      theme++;
    },
    get count() {
      return shown.size;
    },
    dispose() {
      for (const v of shown.values()) drop(v);
      shown.clear();
      plane.dispose();
      rockGeometry.dispose();
      rockMaterial.dispose();
    },
  };
}

