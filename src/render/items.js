import * as THREE from "three";

// Draws loose items (on belts, in inserter hands) as instanced meshes, one per
// shape: ore is a rough rock, plates are flat, bricks are blocks. Each shape sits
// with its bottom at the same height, so they all rest on a belt the same way.
const SHAPE_OF = { "iron-plate": "plate", "copper-plate": "plate", "stone-brick": "brick" };

// y is where the item's centre would be for a rock; flatter shapes are moved down.
function makeShapes() {
  return {
    rock: new THREE.DodecahedronGeometry(0.13, 0),
    plate: new THREE.BoxGeometry(0.26, 0.05, 0.2).translate(0, -0.065, 0),
    brick: new THREE.BoxGeometry(0.24, 0.1, 0.13).translate(0, -0.04, 0),
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
    slot.mesh.frustumCulled = false;
    parent.add(slot.mesh);
  };
  for (const s of slots) ensure(s, 0);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);

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
    add(item, x, y, z, angle, spin = 0) {
      const s = byShape[SHAPE_OF[item] || "rock"];
      q.setFromAxisAngle(up, s.shape === "rock" ? angle + spin : angle);
      s.mesh.setMatrixAt(s.n, m.compose(pos.set(x, y, z), q, one));
      s.mesh.setColorAt(s.n, colors[item] || fallback);
      s.n++;
    },
    end() {
      for (const s of slots) {
        s.mesh.count = s.n;
        s.mesh.instanceMatrix.needsUpdate = true;
        if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
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
