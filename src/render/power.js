import * as THREE from "three";
import { powerNetwork, polesInReach, poleArea } from "../sim/power.js";

// Power on the map: the wires between poles, always, and while placing or looking
// at something electric, the ground the poles power (tinted) with the area and
// wires a pole about to be built would get. The tint covers a WINDOW × WINDOW
// square round the camera, which moves along with it a chunk at a time.
export const POLE_TOP = 1.5; // where wires meet a pole, above its tile's centre
const SAG = 0.18; // how far a wire droops in the middle, per 7 tiles of span
const SEGMENTS = 8;
const AREA_ALPHA = 60; // built poles' areas
const GHOST_ALPHA = 130; // the new pole's area
const WINDOW = 192;
const STEP = 32;

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

export function createPowerLayer(parent) {
  const wires = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
  wires.frustumCulled = false;
  parent.add(wires);
  const ghostWires = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
  ghostWires.frustumCulled = false;
  parent.add(ghostWires);

  // One texel per tile, like the ground, laid just above it; its top-left tile is
  // (ox, oy).
  const pixels = new Uint8Array(WINDOW * WINDOW * 4);
  const tex = new THREE.DataTexture(pixels, WINDOW, WINDOW);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  const areas = new THREE.Mesh(
    new THREE.PlaneGeometry(WINDOW, WINDOW),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  areas.rotation.x = -Math.PI / 2;
  areas.renderOrder = 1;
  let ox = 0;
  let oy = 0;
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
      for (let y = Math.max(oy, area.y); y < Math.min(oy + WINDOW, area.y + area.h); y++) {
        for (let x = Math.max(ox, area.x); x < Math.min(ox + WINDOW, area.x + area.w); x++) {
          // Texture rows run bottom-up in v, which is north-to-south on the rotated plane.
          const t = ((WINDOW - 1 - (y - oy)) * WINDOW + (x - ox)) * 4;
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
    // `center` is the ground point the camera looks at.
    update(world, center) {
      if (wiredVersion !== world.powerVersion) {
        wiredVersion = world.powerVersion;
        setLines(wires, powerNetwork(world).wires);
      }
      areas.visible = ghostWires.visible = !!overlay;
      if (!overlay) return;
      ox = Math.floor(center.x / STEP) * STEP - WINDOW / 2;
      oy = Math.floor(center.y / STEP) * STEP - WINDOW / 2;
      areas.position.set(ox + WINDOW / 2, 0.015, oy + WINDOW / 2);
      const key = `${world.powerVersion} ${overlay.pole?.x} ${overlay.pole?.y} ${ox} ${oy}`;
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
