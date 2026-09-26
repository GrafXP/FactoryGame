import * as THREE from "three";
import { isInserter, swingOf } from "../sim/inserter.js";
import { BUILDINGS, footprint } from "../sim/buildings.js";
import { RECIPES } from "../sim/recipes.js";
import { gearGeometry } from "./shapes.js";
import { powerNetwork } from "../sim/power.js";

// What a network's generators could make, averaged, for scaling the flywheels.
const netCapacity = (net) => Math.max(1, net?.avg.capacity || 0);

// The moving parts of the machines in view, redrawn every frame: inserter arms swinging
// between their pickup and drop sides with the item they carry, the fire in a
// working furnace's or generator's mouth, the cog on an assembler, which turns
// once per craft, a generator's flywheel, a radar's dish, which turns while it
// scans, and the ring round a lab's dome, which turns while it researches. The
// still parts are in buildings.js.
const ARM = 0.42; // pivot to hand
const ARM_Y = 0.44;
const HELD_Y = ARM_Y - 0.13;
const FLYWHEEL = new THREE.Vector3(1.38, 0.65, 0); // from a generator's centre, facing north
const FLYWHEEL_SPEED = 0.25; // radians a tick at full load
const DISH_SPEED = 0.03; // radians a tick while a radar scans
const RING_SPEED = 0.05; // radians a tick while a lab researches
// Each kind of inserter's arm, in its own colour (see buildings.js); they share the hand.
const ARMS = { inserter: "arm", "long-inserter": "longArm", "sorting-inserter": "sortArm" };

const armGeometry = () => new THREE.BoxGeometry(0.07, 0.06, ARM).translate(0, ARM_Y, ARM / 2);

export function createMachineParts(parent) {
  // Modelled pointing south (+z) from the pivot: that's the pickup side of a
  // north-facing inserter, where the arm rests.
  const kinds = {
    gun: { geometry: new THREE.BoxGeometry(0.75, 0.4, 0.75).translate(0, 0.98, 0), color: "minerTop" },
    barrel: { geometry: new THREE.BoxGeometry(0.15, 0.15, 1.15).translate(0, 1.05, -0.7), color: "generatorBase" },
    flash: { geometry: new THREE.SphereGeometry(0.18, 6, 4).translate(0, 1.05, -1.35), color: null },
    arm: { geometry: armGeometry(), color: "inserterArm" },
    longArm: { geometry: armGeometry(), color: "longInserterArm" },
    sortArm: { geometry: armGeometry(), color: "sortingInserterArm" },
    hand: { geometry: new THREE.BoxGeometry(0.2, 0.05, 0.08).translate(0, ARM_Y - 0.04, ARM), color: "inserter" },
    // Just in front of a furnace's mouth (see buildings.js). It stands on the
    // ground, so the flicker's stretch makes it leap upwards.
    fire: { geometry: new THREE.BoxGeometry(0.6, 0.34, 0.03).translate(0, 0.19, 0.95), color: null },
    cog: { geometry: gearGeometry(10, 0.5, 0.66, 0.16, 0.12).translate(0, 1.28, 0), color: "assemblerCog" },
    // In front of a generator's firebox mouth (see buildings.js).
    genFire: { geometry: new THREE.BoxGeometry(0.5, 0.32, 0.03).translate(-0.85, 0.2, 0.9), color: null },
    // Turning about its axle, which runs east-west when the generator faces north.
    flywheel: { geometry: gearGeometry(8, 0.38, 0.48, 0.1, 0.1).translate(0, -0.05, 0).rotateZ(Math.PI / 2), color: "generatorWheel" },
    // A shallow bowl tipped back on top of the mast, looking out to one side.
    dish: {
      geometry: new THREE.CylinderGeometry(0.7, 0.12, 0.22, 16, 1, true).rotateX(-Math.PI / 3).translate(0, 1.5, 0.05),
      color: "radarDish",
      side: THREE.DoubleSide,
    },
    // Tilted, so it can be seen turning.
    ring: { geometry: new THREE.TorusGeometry(1.1, 0.05, 6, 32).rotateX(Math.PI / 2).rotateZ(0.3).translate(0, 1.05, 0), color: "labRing" },
  };
  for (const k of Object.values(kinds)) {
    k.material = k.color
      ? new THREE.MeshStandardMaterial({ roughness: 0.7, side: k.side ?? THREE.FrontSide })
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
  const axle = new THREE.Vector3(1, 0, 0);
  const spin = new THREE.Quaternion();
  const turned = new THREE.Quaternion();
  const offset = new THREE.Vector3();
  const wheels = new Map(); // generator → { angle, tick }: its flywheel, run on by the load since `tick`
  const dishes = new Map(); // radar → its dish's angle
  const rings = new Map(); // lab → its ring's angle

  return {
    // `items` is the item layer, for what the inserters hold, and `list` the
    // buildings in view (visible.js).
    update(world, items, list) {
      const arms = { arm: 0, longArm: 0, sortArm: 0 };
      let furnaces = 0;
      let assemblers = 0;
      let generators = 0;
      let radars = 0;
      let labs = 0;
      const turrets = list.filter(e => e.type === "turret");
      for (const k of [kinds.gun, kinds.barrel, kinds.flash]) ensure(k, turrets.length);
      for (const e of list) {
        if (isInserter(e)) arms[ARMS[e.type]]++;
        else if (e.type === "furnace") furnaces++;
        else if (e.type === "assembler") assemblers++;
        else if (e.type === "generator") generators++;
        else if (e.type === "radar") radars++;
        else if (e.type === "lab") labs++;
      }
      ensure(kinds.ring, labs);
      ensure(kinds.dish, radars);
      for (const k in arms) ensure(kinds[k], arms[k]);
      ensure(kinds.hand, arms.arm + arms.longArm + arms.sortArm);
      for (const k in arms) arms[k] = 0;
      ensure(kinds.fire, furnaces);
      ensure(kinds.cog, assemblers);
      ensure(kinds.genFire, generators);
      ensure(kinds.flywheel, generators);

      let a = 0;
      let f = 0;
      let c = 0;
      let g = 0;
      let gf = 0;
      let d = 0;
      let rg = 0;
      let guns = 0;
      let flashes = 0;
      const net = powerNetwork(world);
      for (const e of list) {
        if (e.type === "turret") {
          q.setFromAxisAngle(up, -e.aim);
          m.compose(pos.set(e.x + 1, 0, e.y + 1), q, one);
          kinds.gun.mesh.setMatrixAt(guns, m);
          kinds.barrel.mesh.setMatrixAt(guns++, m);
          if (e.fired >= 0 && world.tick - e.fired < 4) kinds.flash.mesh.setMatrixAt(flashes++, m);
        } else if (isInserter(e)) {
          // Round through the inserter's right-hand side, from pickup to drop. A
          // long inserter's arm stretches as it goes, to reach two tiles out.
          const t = e.swing / swingOf(e.type);
          const angle = t * Math.PI - (e.rot * Math.PI) / 2;
          const len = ARM + ((BUILDINGS[e.type].reach || 1) - 1) * t;
          const dx = Math.sin(angle);
          const dz = Math.cos(angle);
          q.setFromAxisAngle(up, angle);
          pos.set(e.x + 0.5, 0, e.y + 0.5);
          const arm = ARMS[e.type];
          kinds[arm].mesh.setMatrixAt(arms[arm]++, m.compose(pos, q, scale.set(1, 1, len / ARM)));
          kinds.hand.mesh.setMatrixAt(a++, m.compose(offset.set(pos.x + dx * (len - ARM), 0, pos.z + dz * (len - ARM)), q, one));
          if (e.hand) items.add(e.hand, pos.x + dx * len, HELD_Y, pos.z + dz * len, angle);
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
        } else if (e.type === "generator") {
          // The flywheel spins with the load on its network, so it stands still
          // while the game is paused.
          const load = e.status === "working" ? (net.netOf.get(e)?.avg.supplied || 0) / netCapacity(net.netOf.get(e)) : 0;
          let wheel = wheels.get(e);
          if (!wheel) wheels.set(e, (wheel = { angle: 0, tick: world.tick }));
          wheel.angle = (wheel.angle + load * FLYWHEEL_SPEED * (world.tick - wheel.tick)) % (Math.PI * 2);
          wheel.tick = world.tick;
          const angle = wheel.angle;
          const { w, h } = footprint(e.type, e.rot);
          q.setFromAxisAngle(up, (-e.rot * Math.PI) / 2);
          pos.set(e.x + w / 2, 0, e.y + h / 2);
          offset.copy(FLYWHEEL).applyQuaternion(q).add(pos);
          spin.setFromAxisAngle(axle, angle);
          kinds.flywheel.mesh.setMatrixAt(g++, m.compose(offset, turned.copy(q).multiply(spin), one));
          if (e.status === "working") {
            const flicker = 0.75 + 0.25 * Math.sin(world.tick * 0.35 + e.id * 1.7);
            kinds.genFire.mesh.setMatrixAt(gf++, m.compose(pos, q, scale.set(1, flicker, 1)));
          }
        } else if (e.type === "radar") {
          // It turns while it scans, and stops where it is otherwise.
          let dish = dishes.get(e);
          if (!dish) dishes.set(e, (dish = { angle: e.id, tick: world.tick }));
          if (e.status === "working") dish.angle = (dish.angle + DISH_SPEED * (world.tick - dish.tick)) % (Math.PI * 2);
          dish.tick = world.tick;
          const { w, h } = footprint(e.type, e.rot);
          q.setFromAxisAngle(up, -dish.angle);
          kinds.dish.mesh.setMatrixAt(d++, m.compose(pos.set(e.x + w / 2, 0, e.y + h / 2), q, one));
        } else if (e.type === "lab") {
          let ring = rings.get(e);
          if (!ring) rings.set(e, (ring = { angle: e.id, tick: world.tick }));
          if (e.status === "working") ring.angle = (ring.angle + RING_SPEED * (world.tick - ring.tick)) % (Math.PI * 2);
          ring.tick = world.tick;
          q.setFromAxisAngle(up, ring.angle);
          kinds.ring.mesh.setMatrixAt(rg++, m.compose(pos.set(e.x + 1.5, 0, e.y + 1.5), q, one));
        }
      }
      for (const gen of wheels.keys()) if (!world.entities.has(gen.id)) wheels.delete(gen);
      for (const r of dishes.keys()) if (!world.entities.has(r.id)) dishes.delete(r);
      for (const l of rings.keys()) if (!world.entities.has(l.id)) rings.delete(l);
      for (const [k, n] of [
        [kinds.gun, guns],
        [kinds.barrel, guns],
        [kinds.flash, flashes],
        [kinds.arm, arms.arm],
        [kinds.longArm, arms.longArm],
        [kinds.sortArm, arms.sortArm],
        [kinds.hand, a],
        [kinds.fire, f],
        [kinds.cog, c],
        [kinds.genFire, gf],
        [kinds.flywheel, g],
        [kinds.dish, d],
        [kinds.ring, rg],
      ]) {
        k.mesh.count = n;
        k.mesh.visible = n > 0; // three binds a mesh's shaders even to draw nothing
        if (!n) continue;
        k.mesh.instanceMatrix.addUpdateRange(0, n * 16);
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
