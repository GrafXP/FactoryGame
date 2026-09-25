import * as THREE from "three";
import { powerNetwork, polesInReach, poleArea } from "../sim/power.js";

// Power on the map: the wires between poles, always, and while placing or looking
// at something electric, the ground the poles power (tinted) with the area and
// wires a pole about to be built would get.
export const POLE_TOP = 1.5; // where wires meet a pole, above its tile's centre
const SAG = 0.18; // how far a wire droops in the middle, per 7 tiles of span
const SEGMENTS = 8;
const AREA_ALPHA = 60; // built poles' areas
const GHOST_ALPHA = 130; // the new pole's area

// The points of a drooping wire from pole a to pole b, as line segment pairs.
function wirePoints(a, b, out) {
  const ax = a.x + 0.5;
  const az = a.y + 0.5;
  const bx = b.x + 0.5;
  const bz = b.y + 0.5;
  const droop = (SAG * Math.hypot(bx - ax, bz - az)) / 7;
  const at = (t) => [ax + (bx - ax) * t, POLE_TOP - droop * 4 * t * (1 - t), az + (bz - az) * t];
  for (let i = 0; i < SEGMENTS; i++) out.push(...at(i / SEGMENTS), ...at((i + 1) / SEGMENTS));
}

export function createPowerLayer(parent, size) {
  const wires = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
  wires.frustumCulled = false;
  parent.add(wires);
  const ghostWires = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
  ghostWires.frustumCulled = false;
  parent.add(ghostWires);

  // One texel per tile, like the ground, laid just above it.
  const pixels = new Uint8Array(size * size * 4);
  const tex = new THREE.DataTexture(pixels, size, size);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  const areas = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  areas.rotation.x = -Math.PI / 2;
  areas.position.set(size / 2, 0.015, size / 2);
  areas.renderOrder = 1;
  areas.visible = false;
  parent.add(areas);

  let color = new THREE.Color();
  let wiredVersion = -1;
  let overlay = null; // { pole: { x, y } | null } while shown
  let paintedKey = "";

  const setLines = (lines, pairs) => {
    const pts = [];
    for (const [a, b] of pairs) wirePoints(a, b, pts);
    lines.geometry.dispose();
    lines.geometry = new THREE.BufferGeometry();
    lines.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  };

  // Tints the tiles the built poles power, and the new pole's area more strongly.
  const paintAreas = (world) => {
    pixels.fill(0);
    const hex = color.getHex(); // sRGB
    const [r, g, b] = [hex >> 16, (hex >> 8) & 255, hex & 255];
    const mark = (area, alpha) => {
      for (let y = Math.max(0, area.y); y < Math.min(size, area.y + area.h); y++) {
        for (let x = Math.max(0, area.x); x < Math.min(size, area.x + area.w); x++) {
          // Texture rows run bottom-up in v, which is north-to-south on the rotated plane.
          const t = ((size - 1 - y) * size + x) * 4;
          pixels[t] = r;
          pixels[t + 1] = g;
          pixels[t + 2] = b;
          pixels[t + 3] = Math.max(pixels[t + 3], alpha);
        }
      }
    };
    for (const e of world.entities.values()) if (e.type === "pole") mark(poleArea(e.x, e.y), AREA_ALPHA);
    if (overlay.pole) mark(poleArea(overlay.pole.x, overlay.pole.y), GHOST_ALPHA);
    tex.needsUpdate = true;
  };

  return {
    update(world) {
      if (wiredVersion !== world.version) {
        wiredVersion = world.version;
        setLines(wires, powerNetwork(world).wires);
      }
      areas.visible = ghostWires.visible = !!overlay;
      if (!overlay) return;
      const key = `${world.version} ${overlay.pole?.x} ${overlay.pole?.y}`;
      if (key === paintedKey) return;
      paintedKey = key;
      paintAreas(world);
      const p = overlay.pole;
      setLines(ghostWires, p ? polesInReach(world, p.x, p.y).map((q) => [p, q]) : []);
    },
    // null hides the areas; { pole } shows them, with a new pole's at tile `pole`.
    set(next) {
      overlay = next; // repainted in update, if the pole moved or the layout changed
    },
    setTheme(palette) {
      wires.material.color.set(palette.wire);
      ghostWires.material.color.set(palette.accent);
      color = new THREE.Color(palette.powerArea);
      paintedKey = "";
    },
    dispose() {
      wires.geometry.dispose();
      ghostWires.geometry.dispose();
      tex.dispose();
    },
  };
}
