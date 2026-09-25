import * as THREE from "three";
import { ITEMS } from "../sim/items.js";
import { gearGeometry } from "./shapes.js";

// Draws loose items (on belts, in inserter hands) as instanced meshes, one per
// shape (ITEMS[id].shape): ore is a rough rock, plates are flat, bricks are
// blocks, gears are gears, cable is a coil and circuits are boards. Each shape
// sits with its bottom at the same height, so they all rest on a belt the same way.

// y is where the item's centre would be for a rock; the others are moved down so
// their bottoms are where a rock's is (0.09 below).
function makeShapes() {
  return {
    rock: new THREE.DodecahedronGeometry(0.13, 0),
    plate: new THREE.BoxGeometry(0.26, 0.05, 0.2).translate(0, -0.065, 0),
    brick: new THREE.BoxGeometry(0.24, 0.1, 0.13).translate(0, -0.04, 0),
    gear: gearGeometry(8, 0.09, 0.13, 0.035, 0.05).translate(0, -0.09, 0),
    cable: new THREE.TorusGeometry(0.075, 0.03, 6, 12).rotateX(Math.PI / 2).translate(0, -0.06, 0),
    circuit: new THREE.BoxGeometry(0.24, 0.035, 0.18).translate(0, -0.0725, 0),
  };
}

export function createItemLayer(parent) {
  const material = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.8 });
  const slots = Object.entries(makeShapes()).map(([shape, geometry]) => ({ shape, geometry, mesh: null, n: 0 }));
  const byShape = Object.fromEntries(slots.map((s) => [s.shape, s]));
  let colors = {}; // item id → THREE.Color
  const fallback = new THREE.Color(0xffffff);

  // Instanced meshes can't grow, so swap in a bigger one when needed.
  const ensure = (slot, n) => {
    if (slot.mesh && slot.mesh.instanceMatrix.count >= n) return;
    let cap = 256;
    while (cap < n) cap *= 2;
    if (slot.mesh) {
      parent.remove(slot.mesh);
      slot.mesh.dispose();
    }
    slot.mesh = new THREE.InstancedMesh(slot.geometry, material, cap);
    slot.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    slot.mesh.frustumCulled = false;
    parent.add(slot.mesh);
  };
  for (const s of slots) ensure(s, 0);

  return {
    // Starts a frame that will draw at most n items.
    begin(n) {
      for (const s of slots) {
        ensure(s, n);
        s.n = 0;
      }
    },
    // One item centred at (x, y, z), turned `angle` radians about the vertical.
    // Rocks get `spin` on top, so a row of ore doesn't look like one repeated rock.
    // There are thousands a frame, so the matrix and colour go straight into the
    // buffers.
    add(item, x, y, z, angle, spin = 0) {
      const s = byShape[ITEMS[item]?.shape || "rock"];
      const a = s.shape === "rock" ? angle + spin : angle;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const e = s.mesh.instanceMatrix.array;
      const o = s.n * 16;
      // Column by column: the turn about y (as Matrix4.makeRotationY), then the move.
      e[o] = cos;
      e[o + 1] = 0;
      e[o + 2] = -sin;
      e[o + 3] = 0;
      e[o + 4] = 0;
      e[o + 5] = 1;
      e[o + 6] = 0;
      e[o + 7] = 0;
      e[o + 8] = sin;
      e[o + 9] = 0;
      e[o + 10] = cos;
      e[o + 11] = 0;
      e[o + 12] = x;
      e[o + 13] = y;
      e[o + 14] = z;
      e[o + 15] = 1;
      const color = colors[item] || fallback;
      const rgb = s.mesh.instanceColor.array;
      rgb[s.n * 3] = color.r;
      rgb[s.n * 3 + 1] = color.g;
      rgb[s.n * 3 + 2] = color.b;
      s.n++;
    },
    // Ends the frame, sending the GPU only the part of each buffer that's in use.
    end() {
      for (const s of slots) {
        s.mesh.count = s.n;
        s.mesh.visible = s.n > 0; // three binds a mesh's shaders even to draw nothing
        if (!s.n) continue;
        s.mesh.instanceMatrix.addUpdateRange(0, s.n * 16);
        s.mesh.instanceMatrix.needsUpdate = true;
        s.mesh.instanceColor.addUpdateRange(0, s.n * 3);
        s.mesh.instanceColor.needsUpdate = true;
      }
    },
    // itemColors: item id → hex colour.
    setTheme(itemColors) {
      colors = {};
      for (const id in itemColors) colors[id] = new THREE.Color(itemColors[id]);
    },
    dispose() {
      for (const s of slots) {
        s.mesh.dispose();
        s.geometry.dispose();
      }
      material.dispose();
    },
  };
}
