import * as THREE from "three";
import { beltNetwork, BELT_LEN } from "../sim/transport.js";

// Draws every item riding a belt as one instanced mesh, placed along each belt's
// path: straight from the back edge to the front, or round the corner of a curve.
const ITEM_Y = 0.17;

export function createBeltItems(parent) {
  const geometry = new THREE.DodecahedronGeometry(0.13, 0);
  const material = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.8 });
  let mesh = null;
  let colors = {}; // item id → THREE.Color

  // Instanced meshes can't grow, so swap in a bigger one when needed.
  const ensure = (n) => {
    if (mesh && mesh.instanceMatrix.count >= n) return;
    let cap = 256;
    while (cap < n) cap *= 2;
    if (mesh) {
      parent.remove(mesh);
      mesh.dispose();
    }
    mesh = new THREE.InstancedMesh(geometry, material, cap);
    mesh.frustumCulled = false;
    parent.add(mesh);
  };
  ensure(0);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const fallback = new THREE.Color(0xffffff);
  const at = { x: 0, y: 0 };

  // Where an item t of the way along a north-facing belt sits, relative to the tile's
  // centre (x east, y south). A corner fed from the left runs round the north-west
  // corner from the west edge to the north edge; from the right, the mirror image.
  const along = (shape, t) => {
    if (shape === "straight") {
      at.x = 0;
      at.y = 0.5 - t;
    } else {
      const a = (t * Math.PI) / 2;
      const s = shape === "left" ? 1 : -1;
      at.x = s * (-0.5 + 0.5 * Math.sin(a));
      at.y = -0.5 + 0.5 * Math.cos(a);
    }
  };

  return {
    update(world) {
      const { shape } = beltNetwork(world);
      let n = 0;
      for (const e of world.entities.values()) n += e.items?.length || 0;
      ensure(n);
      let i = 0;
      for (const b of world.entities.values()) {
        if (b.type !== "belt" || !b.items.length) continue;
        const kind = shape.get(b) || "straight";
        for (const it of b.items) {
          along(kind, it.pos / BELT_LEN);
          let { x, y } = at;
          for (let r = 0; r < b.rot; r++) [x, y] = [-y, x]; // a quarter turn clockwise
          // A little spin per item so a packed belt doesn't look like one repeated rock.
          q.setFromAxisAngle(pos.set(0, 1, 0), (i * 2.4) % (Math.PI * 2));
          pos.set(b.x + 0.5 + x, ITEM_Y, b.y + 0.5 + y);
          mesh.setMatrixAt(i, m.compose(pos, q, one));
          mesh.setColorAt(i, colors[it.item] || fallback);
          i++;
        }
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    // itemColors: item id → hex colour.
    setTheme(itemColors) {
      colors = {};
      for (const id in itemColors) colors[id] = new THREE.Color(itemColors[id]);
    },
    dispose() {
      mesh?.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
