import * as THREE from "three";
import { footprint } from "../sim/buildings.js";

// Each building is a few instanced parts. Geometry is modelled facing north (-z)
// around the footprint's centre; `color` is a palette key.
function makeParts() {
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

  const chevron = new THREE.Shape();
  chevron.moveTo(-0.28, -0.12);
  chevron.lineTo(0, 0.16);
  chevron.lineTo(0.28, -0.12);
  chevron.lineTo(0.28, -0.28);
  chevron.lineTo(0, 0);
  chevron.lineTo(-0.28, -0.28);
  const arrow = new THREE.ShapeGeometry(chevron).rotateX(-Math.PI / 2).translate(0, 0.09, 0.04);

  return {
    belt: [
      { geometry: box(0.9, 0.08, 1, 0, 0.04, 0), color: "belt" },
      { geometry: arrow, color: "beltArrow" },
    ],
    miner: [
      { geometry: box(1.7, 0.7, 1.7, 0, 0.35, 0), color: "miner" },
      { geometry: new THREE.CylinderGeometry(0.35, 0.45, 0.35, 8).translate(0, 0.87, 0.15), color: "minerTop" },
      // Output chute on the facing side, so the direction is obvious.
      { geometry: box(0.55, 0.3, 0.3, 0, 0.2, -0.95), color: "minerTop" },
    ],
    chest: [
      { geometry: box(0.76, 0.56, 0.76, 0, 0.28, 0), color: "chest" },
      { geometry: box(0.8, 0.08, 0.8, 0, 0.42, 0), color: "chestBand" },
    ],
  };
}

// A set of instanced meshes drawing a list of placements { type, x, y, rot }.
// A ghost layer is see-through and colours each placement by its `ok` flag.
export function createBuildingLayer(parent, { ghost = false } = {}) {
  const group = new THREE.Group();
  parent.add(group);
  const parts = makeParts();
  let colors = {};
  let last = [];

  const slots = [];
  for (const type in parts) {
    for (const part of parts[type]) {
      const material = ghost
        ? new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.55, depthWrite: false })
        : new THREE.MeshStandardMaterial({ roughness: 0.8, side: part.color === "beltArrow" ? THREE.DoubleSide : THREE.FrontSide });
      slots.push({ type, part, material, mesh: null });
    }
  }

  // Instanced meshes can't grow, so swap in a bigger one when needed.
  const ensure = (slot, n) => {
    if (slot.mesh && slot.mesh.instanceMatrix.count >= n) return;
    let cap = 64;
    while (cap < n) cap *= 2;
    if (slot.mesh) {
      group.remove(slot.mesh);
      slot.mesh.dispose();
    }
    slot.mesh = new THREE.InstancedMesh(slot.part.geometry, slot.material, cap);
    slot.mesh.frustumCulled = false;
    if (ghost) slot.mesh.renderOrder = 1;
    group.add(slot.mesh);
  };

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const c = new THREE.Color();

  const set = (placements) => {
    last = placements;
    const byType = {};
    for (const p of placements) (byType[p.type] ||= []).push(p);
    for (const slot of slots) {
      const list = byType[slot.type] || [];
      ensure(slot, list.length);
      list.forEach((p, i) => {
        const { w, h } = footprint(p.type, p.rot);
        pos.set(p.x + w / 2, ghost ? 0.02 : 0, p.y + h / 2);
        q.setFromAxisAngle(up, (-p.rot * Math.PI) / 2);
        slot.mesh.setMatrixAt(i, m.compose(pos, q, one));
        if (ghost) slot.mesh.setColorAt(i, c.set(p.ok ? colors.ok : colors.bad));
      });
      slot.mesh.count = list.length;
      slot.mesh.instanceMatrix.needsUpdate = true;
      if (slot.mesh.instanceColor) slot.mesh.instanceColor.needsUpdate = true;
    }
  };

  return {
    set,
    setTheme(palette) {
      colors = palette;
      if (!ghost) for (const slot of slots) slot.material.color.set(palette[slot.part.color]);
      set(last);
    },
  };
}
