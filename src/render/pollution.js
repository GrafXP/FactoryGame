import * as THREE from "three";
import { CHUNK } from "../sim/map.js";
import { isCharted } from "../sim/chunks.js";
import { UNIT } from "../sim/pollution.js";

// The map view's pollution overlay: a red tint over polluted chunks, stronger the
// more there is. It's one plane over the polluted chunks with a texel per chunk,
// smoothed between them so the cloud reads as a cloud. Uncharted chunks stay fog.
// Repainted only when the pollution has spread (once a second) or the charted land
// changes, and not drawn at all while it's off.
const FAINT = 1; // units in a chunk that just show
const FULL = 2000; // units in a chunk drawn at full strength
const ALPHA = 0.7; // how strong full strength is

// How strongly `units` of pollution tint its chunk, 0 to 1. On a log scale, so both
// a lone furnace's haze and a big factory's smog read.
const strength = (units) => (units < FAINT ? 0 : Math.min(1, Math.log(units / FAINT + 1) / Math.log(FULL / FAINT + 1)));

export function createPollutionLayer(parent) {
  const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material);
  mesh.renderOrder = 1;
  mesh.visible = false;
  parent.add(mesh);
  let tex = null;
  let pixels = null;
  let drawnKey = "";
  let color = [255, 0, 0];

  // A texture for w × h chunks, made again when that changes.
  const ensure = (w, h) => {
    if (tex && tex.image.width === w && tex.image.height === h) return;
    tex?.dispose();
    pixels = new Uint8Array(w * h * 4);
    tex = new THREE.DataTexture(pixels, w, h);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    material.map = tex;
    material.needsUpdate = true;
  };

  const paint = (world) => {
    let cx0 = Infinity;
    let cy0 = Infinity;
    let cx1 = -Infinity;
    let cy1 = -Infinity;
    for (const c of world.polluted) {
      cx0 = Math.min(cx0, c.cx);
      cy0 = Math.min(cy0, c.cy);
      cx1 = Math.max(cx1, c.cx);
      cy1 = Math.max(cy1, c.cy);
    }
    if (cx0 > cx1) {
      mesh.visible = false;
      return;
    }
    // A clear chunk all round, so the edge fades out instead of stopping.
    cx0--;
    cy0--;
    cx1++;
    cy1++;
    const w = cx1 - cx0 + 1;
    const h = cy1 - cy0 + 1;
    ensure(w, h);
    // Every texel is the tint, clear ones too, so smoothing only fades it out.
    const [r, g, b] = color;
    for (let t = 0; t < pixels.length; t += 4) {
      pixels[t] = r;
      pixels[t + 1] = g;
      pixels[t + 2] = b;
      pixels[t + 3] = 0;
    }
    for (const c of world.polluted) {
      if (!isCharted(world, c.cx, c.cy)) continue;
      // Texture rows run bottom-up in v, which is north-to-south (-z) on the plane.
      pixels[((h - 1 - (c.cy - cy0)) * w + (c.cx - cx0)) * 4 + 3] = Math.round(255 * ALPHA * strength(c.pollution / UNIT));
    }
    tex.needsUpdate = true;
    mesh.scale.set(w * CHUNK, 1, h * CHUNK);
    mesh.position.set(((cx0 + cx1 + 1) * CHUNK) / 2, 0.05, ((cy0 + cy1 + 1) * CHUNK) / 2);
    mesh.visible = true;
  };

  return {
    // Shows the overlay for `world` if `on`, else hides it.
    update(world, on) {
      if (!on) {
        mesh.visible = false;
        drawnKey = "";
        return;
      }
      const key = `${world.pollutionVersion} ${world.chartVersion} ${color}`;
      if (key === drawnKey) return;
      drawnKey = key;
      paint(world);
    },
    setTheme(hex) {
      color = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
    },
    dispose() {
      tex?.dispose();
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
