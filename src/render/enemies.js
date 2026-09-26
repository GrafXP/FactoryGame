import * as THREE from "three";
import { footprint } from "../sim/buildings.js";
import { CHUNK, chunkKey } from "../sim/chunks.js";
import { NEST } from "../sim/map.js";
import { TILE, UNITS } from "../sim/enemies.js";
import { maxHealth } from "../sim/health.js";

// The enemies on the playfield, as instanced meshes: the nests in the chunks on
// screen, and the units on screen, turned the way they last moved and bobbing as
// they walk. Health bars over damaged buildings are icons (billboards.js). The map
// view has markers instead (createMapMarkers). Parts are modelled facing north (-z),
// like the buildings; `color` is a palette key.
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const blob = (r, sx, sy, sz, x, y, z) => new THREE.SphereGeometry(r, 10, 7).scale(sx, sy, sz).translate(x, y, z);

// A ring of `n` spikes round a nest's dome, all in one geometry.
function spikes(n) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    const cone = new THREE.ConeGeometry(0.16, 0.9, 5)
      .rotateZ(0.5)
      .rotateY(-a)
      .translate(Math.cos(a) * 1.05, 0.35, Math.sin(a) * 1.05);
    parts.push(cone.toNonIndexed());
  }
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const size = parts[0].attributes[name].itemSize;
    const arr = new Float32Array(parts.reduce((s, p) => s + p.attributes[name].array.length, 0));
    let at = 0;
    for (const p of parts) {
      arr.set(p.attributes[name].array, at);
      at += p.attributes[name].array.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  for (const p of parts) p.dispose();
  return out;
}

const MODELS = {
  // A low dome over a dark hole, ringed with spikes.
  nest: [
    { geometry: blob(1.35, 1, 0.45, 1, 0, 0, 0), color: "nest" },
    { geometry: new THREE.CylinderGeometry(0.34, 0.42, 0.14, 10).translate(0, 0.56, 0), color: "nestHole" },
    { geometry: spikes(6), color: "nestSpike" },
  ],
  // Mites: small and low, a body and a head.
  mite: [
    { geometry: blob(0.2, 1, 0.6, 1.3, 0, 0.14, 0.04), color: "mite" },
    { geometry: blob(0.11, 1, 0.8, 1, 0, 0.14, -0.26), color: "mite" },
  ],
  // Brutes: big, with a grey shell on their back.
  brute: [
    { geometry: blob(0.36, 1, 0.65, 1.25, 0, 0.26, 0.05), color: "brute" },
    { geometry: blob(0.33, 1.05, 0.45, 1.05, 0, 0.42, 0.1), color: "bruteArmor" },
    { geometry: blob(0.17, 1, 0.8, 1, 0, 0.24, -0.45), color: "brute" },
  ],
  // Spitters: a sac standing up behind a small body.
  spitter: [
    { geometry: blob(0.18, 1, 0.6, 1.2, 0, 0.14, 0), color: "spitter" },
    { geometry: blob(0.15, 1, 1.5, 1, 0, 0.36, 0.14), color: "spitterSac" },
    { geometry: blob(0.1, 1, 0.8, 1, 0, 0.16, -0.24), color: "spitter" },
  ],
};
const KINDS = UNITS.map((u) => u.id);

// Instanced meshes for one model, refilled every frame.
function instanced(parent, parts) {
  const slots = parts.map((part) => ({ part, material: new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), mesh: null }));
  let n = 0;
  const ensure = (slot, cap) => {
    if (slot.mesh && slot.mesh.instanceMatrix.count >= cap) return;
    let size = 32;
    while (size < cap) size *= 2;
    if (slot.mesh) {
      parent.remove(slot.mesh);
      slot.mesh.dispose();
    }
    slot.mesh = new THREE.InstancedMesh(slot.part.geometry, slot.material, size);
    slot.mesh.frustumCulled = false;
    parent.add(slot.mesh);
  };
  return {
    begin(cap) {
      n = 0;
      for (const slot of slots) ensure(slot, cap);
    },
    add(matrix) {
      for (const slot of slots) slot.mesh.setMatrixAt(n, matrix);
      n++;
    },
    end() {
      for (const slot of slots) {
        slot.mesh.count = n;
        slot.mesh.visible = n > 0;
        if (!n) continue;
        slot.mesh.instanceMatrix.addUpdateRange(0, n * 16);
        slot.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    setTheme(palette) {
      for (const slot of slots) slot.material.color.set(palette[slot.part.color]);
    },
    dispose() {
      for (const slot of slots) {
        slot.part.geometry.dispose();
        slot.material.dispose();
        slot.mesh?.dispose();
      }
    },
  };
}

export function createEnemyLayer(parent) {
  const nests = instanced(parent, MODELS.nest);
  const units = KINDS.map((k) => instanced(parent, MODELS[k]));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  let nestKey = "";

  // The nests in chunks (cx0, cy0)–(cx1, cy1) that have been made, each once.
  const drawNests = (world, { cx0, cy0, cx1, cy1 }) => {
    const key = `${cx0} ${cy0} ${cx1} ${cy1} ${world.mapVersion} ${world.chunks.size}`;
    if (key === nestKey) return;
    nestKey = key;
    const seen = new Set();
    const list = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = world.chunks.get(chunkKey(cx, cy));
        if (!c) continue;
        for (const n of c.nests) {
          if (seen.has(n.id)) continue;
          seen.add(n.id);
          list.push(n);
        }
      }
    }
    nests.begin(list.length);
    for (const n of list) {
      q.setFromAxisAngle(up, (n.id % 7) * 0.9);
      nests.add(m.compose(pos.set(n.x + NEST / 2, 0, n.y + NEST / 2), q, one));
    }
    nests.end();
  };

  // The units within ground rect { x0, y0, x1, y1 } (tiles), with a margin.
  const drawUnits = (world, r) => {
    const byKind = KINDS.map(() => []);
    for (const u of world.enemies.units.values()) {
      const x = u.x / TILE;
      const y = u.y / TILE;
      if (x < r.x0 - 2 || x > r.x1 + 2 || y < r.y0 - 2 || y > r.y1 + 2) continue;
      byKind[u.kind].push(u);
    }
    const t = world.tick;
    byKind.forEach((list, k) => {
      units[k].begin(list.length);
      for (const u of list) {
        const moving = u.dx || u.dy;
        const bob = moving && !u.target ? Math.abs(Math.sin(t * 0.45 + u.id)) * 0.05 : 0;
        q.setFromAxisAngle(up, Math.atan2(-u.dx, -u.dy));
        units[k].add(m.compose(pos.set(u.x / TILE, bob, u.y / TILE), q, one));
      }
      units[k].end();
    });
  };

  return {
    // Draws the nests in the chunks in `range` and the units in ground rect `onGround`.
    update(world, range, onGround) {
      if (range) drawNests(world, range);
      if (onGround) drawUnits(world, onGround);
    },
    setTheme(palette) {
      nests.setTheme(palette);
      for (const u of units) u.setTheme(palette);
    },
    dispose() {
      nests.dispose();
      for (const u of units) u.dispose();
    },
  };
}

// Health bars: an icon under each damaged building in `list` (just south of it,
// which is below it on screen), a bar of HP_STEPS steps, green, then amber, then
// red as it goes down.
const HP_STEPS = 12;
const bar = (k) => (g) => {
  g.fillStyle = "rgba(15, 17, 22, 0.8)";
  g.fillRect(2, 24, 60, 14);
  g.fillStyle = k / HP_STEPS > 0.6 ? "#4fd67a" : k / HP_STEPS > 0.3 ? "#f2a900" : "#ff4a3d";
  g.fillRect(5, 27, (54 * k) / HP_STEPS, 8);
};
export function drawHealthBars(world, list, icons) {
  if (!world.damaged.size) return;
  for (const e of list) {
    const d = world.damaged.get(e.id);
    if (!d) continue;
    const k = Math.max(1, Math.round((d.hp / maxHealth(e.type)) * HP_STEPS));
    const { w, h } = footprint(e.type, e.rot);
    icons.add(icons.cell(`hp:${k}`, bar(k)), e.x + w / 2, 0.1, e.y + h + 0.3, Math.max(0.9, Math.min(w, 2)));
  }
}

// The map view's markers: ruins as red squares, and attack groups as orange
// diamonds where their first unit is. Big enough to see far out.
const MIN_MARK = 6;
export function createMapMarkers(parent) {
  const geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
  let mesh = null;
  const ensure = (n) => {
    if (mesh && mesh.instanceMatrix.count >= n) return;
    let cap = 32;
    while (cap < n) cap *= 2;
    if (mesh) {
      parent.remove(mesh);
      mesh.dispose();
    }
    mesh = new THREE.InstancedMesh(geometry, material, cap);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    parent.add(mesh);
  };
  ensure(0);
  let colors = null;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const diamond = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const c = new THREE.Color();
  return {
    update(world, on) {
      if (!on || !colors) {
        mesh.visible = false;
        return;
      }
      const groups = [...world.enemies.groups.values()];
      ensure(world.ruins.length + groups.length);
      let n = 0;
      for (const r of world.ruins) {
        const { w, h } = footprint(r.type, r.rot);
        const s = Math.max(MIN_MARK, w, h);
        mesh.setMatrixAt(n, m.compose(pos.set(r.x + w / 2, 0.1, r.y + h / 2), q, scale.set(s, 1, s)));
        mesh.setColorAt(n++, c.set(colors.bad));
      }
      for (const g of groups) {
        const u = world.enemies.units.get(g.units[0]);
        mesh.setMatrixAt(n, m.compose(pos.set(u.x / TILE, 0.12, u.y / TILE), diamond, scale.set(8, 1, 8)));
        mesh.setColorAt(n++, c.set(colors.attack));
      }
      mesh.count = n;
      mesh.visible = n > 0;
      if (!n) return;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    },
    setTheme(palette) {
      colors = palette;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
    },
  };
}
