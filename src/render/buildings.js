import * as THREE from "three";
import { footprint } from "../sim/buildings.js";

// Each building is a few instanced parts. Geometry is modelled facing north (-z)
// around the footprint's centre; `color` is a palette key. A placement can pick a
// variant with `model` (belt corners are "belt-left" and "belt-right").
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

  // A corner belt: a quarter ring round the corner between its input and output
  // edges. Fed from the left (west), that's the north-west corner; from the right,
  // the north-east. Shape coordinates are (x, -z), so rotateX lays it flat.
  const corner = (side) => {
    const s = side === "left" ? 1 : -1;
    const cx = -0.5 * s;
    const ring = new THREE.Shape();
    const [a0, a1] = side === "left" ? [0, -Math.PI / 2] : [Math.PI, Math.PI * 1.5];
    ring.absarc(cx, 0.5, 0.95, a0, a1, side === "left");
    ring.absarc(cx, 0.5, 0.05, a1, a0, side !== "left");
    return new THREE.ExtrudeGeometry(ring, { depth: 0.08, bevelEnabled: false, curveSegments: 12 }).rotateX(-Math.PI / 2);
  };
  // The arrow on a corner sits on the curve, turned halfway between in and out.
  const cornerArrow = (side) => {
    const s = side === "left" ? 1 : -1;
    return new THREE.ShapeGeometry(chevron)
      .rotateX(-Math.PI / 2)
      .rotateY((-Math.PI / 4) * s)
      .translate(-0.5 * s + 0.5 * Math.SQRT1_2 * s, 0.09, -0.5 + 0.5 * Math.SQRT1_2);
  };

  function splitterParts(hub) {
    const small = (turn, x, z) =>
      new THREE.ShapeGeometry(chevron).scale(0.55, 0.55, 1).rotateX(-Math.PI / 2).rotateY(turn).translate(x, 0.09, z);
    return [
      { geometry: box(0.96, 0.08, 0.96, 0, 0.04, 0), color: "belt" },
      { geometry: small(0, 0, -0.3), color: "beltArrow" },
      { geometry: small(Math.PI / 2, -0.3, 0), color: "beltArrow" },
      { geometry: small(-Math.PI / 2, 0.3, 0), color: "beltArrow" },
      { geometry: new THREE.CylinderGeometry(0.17, 0.2, 0.06, 8).translate(0, 0.11, 0), color: hub },
    ];
  }

  const wall = mask => {
    const parts = [
      { geometry: box(0.7, 0.9, 0.7, 0, 0.45, 0), color: "furnace" },
      { geometry: box(0.8, 0.15, 0.8, 0, 0.98, 0), color: "furnaceTop" },
    ];
    for (let r = 0; r < 4; r++) if (mask & (1 << r)) {
      parts.push({ geometry: box(0.6, 0.8, 0.5, 0, 0.4, -0.25).rotateY(-r * Math.PI / 2), color: "furnace" });
    }
    return parts;
  };
  return {
    wall: wall(0),
    ...Object.fromEntries(Array.from({ length: 16 }, (_, mask) => [`wall-${mask}`, wall(mask)])),
    turret: [
      { geometry: box(1.8, 0.25, 1.8, 0, 0.125, 0), color: "generatorBase" },
      { geometry: new THREE.CylinderGeometry(0.55, 0.7, 0.55, 12).translate(0, 0.5, 0), color: "miner" },
      // Moving gun and flash are drawn in machines.js.
    ],
    belt: [
      { geometry: box(0.9, 0.08, 1, 0, 0.04, 0), color: "belt" },
      { geometry: arrow, color: "beltArrow" },
    ],
    "belt-left": [
      { geometry: corner("left"), color: "belt" },
      { geometry: cornerArrow("left"), color: "beltArrow" },
    ],
    "belt-right": [
      { geometry: corner("right"), color: "belt" },
      { geometry: cornerArrow("right"), color: "beltArrow" },
    ],
    // An underground entrance: a hood over its front half, where items go down. The
    // exit is the same with the hood over its back half, where they come up.
    "underground-in": [
      { geometry: box(0.9, 0.08, 1, 0, 0.04, 0), color: "belt" },
      { geometry: arrow.clone().translate(0, 0, 0.26), color: "beltArrow" },
      { geometry: box(0.98, 0.5, 0.5, 0, 0.25, -0.25), color: "underground" },
      { geometry: box(0.98, 0.07, 0.5, 0, 0.535, -0.25), color: "beltArrow" },
      { geometry: box(0.7, 0.32, 0.02, 0, 0.2, 0.005), color: "furnaceMouth" },
    ],
    "underground-out": [
      { geometry: box(0.9, 0.08, 1, 0, 0.04, 0), color: "belt" },
      { geometry: arrow.clone().translate(0, 0, -0.3), color: "beltArrow" },
      { geometry: box(0.98, 0.5, 0.5, 0, 0.25, 0.25), color: "underground" },
      { geometry: box(0.98, 0.07, 0.5, 0, 0.535, 0.25), color: "beltArrow" },
      { geometry: box(0.7, 0.32, 0.02, 0, 0.2, -0.005), color: "furnaceMouth" },
    ],
    // A square of belt with an arrow to each way out and a hub in the middle, where
    // items pick their way; sorters have a blue hub and show their filters
    // (render/recipe-icons.js).
    splitter: splitterParts("splitter"),
    sorter: splitterParts("sorter"),
    miner: [
      { geometry: box(1.7, 0.7, 1.7, 0, 0.35, 0), color: "miner" },
      { geometry: new THREE.CylinderGeometry(0.35, 0.45, 0.35, 8).translate(0, 0.87, 0.15), color: "minerTop" },
      // Output chute on the facing side, over the column whose front tile gets the ore
      // (see outputTile in sim/buildings.js).
      { geometry: box(0.55, 0.3, 0.3, -0.5, 0.2, -0.95), color: "minerTop" },
    ],
    chest: [
      { geometry: box(0.76, 0.56, 0.76, 0, 0.28, 0), color: "chest" },
      { geometry: box(0.8, 0.08, 0.8, 0, 0.42, 0), color: "chestBand" },
    ],
    // A squat stone oven with a chimney. Which way a furnace faces doesn't matter,
    // so its mouth, where the fire shows while it works (render/machines.js), is on
    // the south side: the side the camera sees when it's placed unturned.
    furnace: [
      { geometry: box(1.8, 0.9, 1.8, 0, 0.45, 0), color: "furnace" },
      { geometry: box(0.5, 0.55, 0.5, 0.45, 1.17, -0.45), color: "furnaceTop" },
      { geometry: box(0.8, 0.5, 0.06, 0, 0.27, 0.9), color: "furnaceMouth" },
    ],
    // A boxy machine; the cog on top turns while it works (render/machines.js), and
    // an icon over it shows its recipe (render/recipe-icons.js).
    assembler: [
      { geometry: box(2.9, 0.2, 2.9, 0, 0.1, 0), color: "assemblerBase" },
      { geometry: box(2.6, 1.0, 2.6, 0, 0.7, 0), color: "assembler" },
      { geometry: box(1.7, 0.08, 1.7, 0, 1.24, 0), color: "assemblerBase" },
      { geometry: new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8).translate(0, 1.35, 0), color: "assemblerBase" },
    ],
    // A firebox with a chimney at the west end and a boiler drum at the east; the
    // flywheel on the drum's end spins and the firebox glows while it works
    // (render/machines.js).
    generator: [
      { geometry: box(2.9, 0.15, 1.9, 0, 0.075, 0), color: "generatorBase" },
      { geometry: box(1.1, 1.0, 1.7, -0.85, 0.55, 0), color: "generator" },
      { geometry: new THREE.CylinderGeometry(0.5, 0.5, 1.5, 14).rotateZ(Math.PI / 2).translate(0.55, 0.65, 0), color: "generatorTop" },
      { geometry: new THREE.CylinderGeometry(0.13, 0.16, 0.9, 8).translate(-1.05, 1.45, -0.45), color: "generatorBase" },
      { geometry: box(0.6, 0.4, 0.06, -0.85, 0.35, 0.86), color: "furnaceMouth" },
    ],
    // A platform with a hall, a mast with a beacon on the back corner, and the
    // terminal where deliveries go on the front.
    hub: [
      { geometry: box(3.9, 0.15, 3.9, 0, 0.075, 0), color: "hubBase" },
      { geometry: box(2.7, 1.1, 2.3, -0.35, 0.7, -0.45), color: "hub" },
      { geometry: box(2.9, 0.12, 2.5, -0.35, 1.31, -0.45), color: "hubTrim" },
      { geometry: new THREE.CylinderGeometry(0.12, 0.16, 2.6, 8).translate(1.35, 1.3, -1.35), color: "hubBase" },
      { geometry: box(0.34, 0.3, 0.34, 1.35, 2.7, -1.35), color: "hubTrim" },
      { geometry: box(0.9, 0.85, 0.4, 0.9, 0.57, 1.3), color: "hub" },
      { geometry: box(0.7, 0.35, 0.06, 0.9, 0.75, 1.52), color: "hubTrim" },
    ],
    // A post with a crossbar; wires run from the middle of the crossbar
    // (POLE_TOP, render/wires.js).
    pole: [
      { geometry: new THREE.CylinderGeometry(0.05, 0.07, 1.6, 6).translate(0, 0.8, 0), color: "pole" },
      { geometry: box(0.62, 0.06, 0.07, 0, 1.5, 0), color: "pole" },
      { geometry: box(0.08, 0.1, 0.08, -0.25, 1.58, 0), color: "poleTop" },
      { geometry: box(0.08, 0.1, 0.08, 0.25, 1.58, 0), color: "poleTop" },
    ],
    // A plinth and a mast; the dish on top turns while it scans (render/machines.js).
    radar: [
      { geometry: box(1.8, 0.2, 1.8, 0, 0.1, 0), color: "hubBase" },
      { geometry: box(0.9, 0.6, 0.9, 0, 0.5, 0), color: "radar" },
      { geometry: new THREE.CylinderGeometry(0.08, 0.1, 0.6, 8).translate(0, 1.1, 0), color: "radarDish" },
    ],
    // The base and the pivot; the arm swings in render/machines.js. The arrow on the
    // base points the way items go.
    inserter: [
      { geometry: box(0.62, 0.1, 0.62, 0, 0.05, 0), color: "inserter" },
      { geometry: new THREE.ShapeGeometry(chevron).scale(0.55, 0.55, 1).rotateX(-Math.PI / 2).translate(0, 0.105, -0.14), color: "inserterArm" },
      { geometry: new THREE.CylinderGeometry(0.06, 0.08, 0.4, 8).translate(0, 0.26, 0), color: "inserterArm" },
    ],
  };
}

// A set of instanced meshes drawing a list of placements { type, x, y, rot, model? }.
// A ghost layer is see-through and colours each placement by its `ok` flag, or all
// of them in palette colour `tint` (ruins).
export function createBuildingLayer(parent, { ghost = false, tint = null } = {}) {
  const group = new THREE.Group();
  parent.add(group);
  const parts = makeParts();
  let colors = {};
  let last = [];

  const slots = [];
  for (const type in parts) {
    for (const part of parts[type]) {
      const material = ghost
        ? new THREE.MeshStandardMaterial({ transparent: true, opacity: tint ? 0.5 : 0.55, depthWrite: false })
        : new THREE.MeshStandardMaterial({ roughness: 0.8, side: part.geometry.type === "ShapeGeometry" ? THREE.DoubleSide : THREE.FrontSide });
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
    for (const p of placements) (byType[p.model || p.type] ||= []).push(p);
    for (const slot of slots) {
      const list = byType[slot.type] || [];
      ensure(slot, list.length);
      list.forEach((p, i) => {
        const { w, h } = footprint(p.type, p.rot);
        pos.set(p.x + w / 2, ghost ? 0.02 : 0, p.y + h / 2);
        q.setFromAxisAngle(up, (-p.rot * Math.PI) / 2);
        slot.mesh.setMatrixAt(i, m.compose(pos, q, one));
        if (ghost) slot.mesh.setColorAt(i, c.set(tint ? colors[tint] : p.ok ? colors.ok : colors.bad));
      });
      slot.mesh.count = list.length;
      slot.mesh.visible = list.length > 0; // three binds a mesh's shaders even to draw nothing
      if (!list.length) continue;
      slot.mesh.instanceMatrix.addUpdateRange(0, list.length * 16);
      slot.mesh.instanceMatrix.needsUpdate = true;
      if (!slot.mesh.instanceColor) continue;
      slot.mesh.instanceColor.addUpdateRange(0, list.length * 3);
      slot.mesh.instanceColor.needsUpdate = true;
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
