import * as THREE from "three";
import { SWING } from "../sim/inserter.js";
import { footprint } from "../sim/buildings.js";
import { RECIPES } from "../sim/recipes.js";
import { gearGeometry } from "./shapes.js";

// The moving parts of machines, redrawn every frame: inserter arms swinging
// between their pickup and drop sides with the item they carry, the fire in a
// working furnace's mouth, and the cog on an assembler, which turns once per
// craft. The still parts are in buildings.js.
const ARM = 0.42; // pivot to hand
const ARM_Y = 0.44;
const HELD_Y = ARM_Y - 0.13;

export function createMachineParts(parent) {
  // Modelled pointing south (+z) from the pivot: that's the pickup side of a
  // north-facing inserter, where the arm rests.
  const kinds = {
    arm: { geometry: new THREE.BoxGeometry(0.07, 0.06, ARM).translate(0, ARM_Y, ARM / 2), color: "inserterArm" },
    hand: { geometry: new THREE.BoxGeometry(0.2, 0.05, 0.08).translate(0, ARM_Y - 0.04, ARM), color: "inserter" },
    // Just in front of a furnace's mouth (see buildings.js). It stands on the
    // ground, so the flicker's stretch makes it leap upwards.
    fire: { geometry: new THREE.BoxGeometry(0.6, 0.34, 0.03).translate(0, 0.19, 0.95), color: null },
    cog: { geometry: gearGeometry(10, 0.5, 0.66, 0.16, 0.12).translate(0, 1.28, 0), color: "assemblerCog" },
  };
  for (const k of Object.values(kinds)) {
    k.material = k.color
      ? new THREE.MeshStandardMaterial({ roughness: 0.7 })
      : new THREE.MeshBasicMaterial({ color: 0xff8a1f }); // unlit, so it glows
    k.mesh = null;
  }

  // Instanced meshes can't grow, so swap in a bigger one when needed.
  const ensure = (k, n) => {
    if (k.mesh && k.mesh.instanceMatrix.count >= n) return;
    let cap = 64;
    while (cap < n) cap *= 2;
    if (k.mesh) {
      parent.remove(k.mesh);
      k.mesh.dispose();
    }
    k.mesh = new THREE.InstancedMesh(k.geometry, k.material, cap);
    k.mesh.frustumCulled = false;
    parent.add(k.mesh);
  };

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  return {
    // `items` is the item layer, for what the inserters hold.
    update(world, items) {
      let inserters = 0;
      let furnaces = 0;
      let assemblers = 0;
      for (const e of world.entities.values()) {
        if (e.type === "inserter") inserters++;
        else if (e.type === "furnace") furnaces++;
        else if (e.type === "assembler") assemblers++;
      }
      ensure(kinds.arm, inserters);
      ensure(kinds.hand, inserters);
      ensure(kinds.fire, furnaces);
      ensure(kinds.cog, assemblers);

      let a = 0;
      let f = 0;
      let c = 0;
      for (const e of world.entities.values()) {
        if (e.type === "inserter") {
          // Round through the inserter's right-hand side, from pickup to drop.
          const angle = (e.swing / SWING) * Math.PI - (e.rot * Math.PI) / 2;
          m.compose(pos.set(e.x + 0.5, 0, e.y + 0.5), q.setFromAxisAngle(up, angle), one);
          kinds.arm.mesh.setMatrixAt(a, m);
          kinds.hand.mesh.setMatrixAt(a, m);
          a++;
          if (e.hand) items.add(e.hand, e.x + 0.5 + Math.sin(angle) * ARM, HELD_Y, e.y + 0.5 + Math.cos(angle) * ARM, angle);
        } else if (e.type === "furnace" && e.status === "working") {
          const { w, h } = footprint(e.type, e.rot);
          const flicker = 0.75 + 0.25 * Math.sin(world.tick * 0.35 + e.id * 1.7);
          q.setFromAxisAngle(up, (-e.rot * Math.PI) / 2);
          kinds.fire.mesh.setMatrixAt(f++, m.compose(pos.set(e.x + w / 2, 0, e.y + h / 2), q, scale.set(1, flicker, 1)));
        } else if (e.type === "assembler") {
          const { w, h } = footprint(e.type, e.rot);
          const turn = e.crafting ? (e.progress / RECIPES[e.recipe].time) * Math.PI * 2 : 0;
          q.setFromAxisAngle(up, -turn);
          kinds.cog.mesh.setMatrixAt(c++, m.compose(pos.set(e.x + w / 2, 0, e.y + h / 2), q, one));
        }
      }
      for (const [k, n] of [
        [kinds.arm, a],
        [kinds.hand, a],
        [kinds.fire, f],
        [kinds.cog, c],
      ]) {
        k.mesh.count = n;
        k.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    setTheme(palette) {
      for (const k of Object.values(kinds)) if (k.color) k.material.color.set(palette[k.color]);
    },
    dispose() {
      for (const k of Object.values(kinds)) {
        k.mesh?.dispose();
        k.geometry.dispose();
        k.material.dispose();
      }
    },
  };
}
