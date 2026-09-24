import * as THREE from "three";
import { footprint } from "../sim/buildings.js";

// Icons floating over machines that are stopped, so a glance shows what needs help.
// Drawn once onto small canvases; sprites always face the camera.
const ICONS = {
  // No ore left under a miner: a rock, crossed out.
  "no-resource": (g) => {
    g.fillStyle = "#8a8f99";
    g.beginPath();
    g.moveTo(20, 44);
    g.lineTo(24, 26);
    g.lineTo(36, 20);
    g.lineTo(46, 30);
    g.lineTo(44, 44);
    g.closePath();
    g.fill();
    g.strokeStyle = "#e0282e";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(32, 32, 24, 0, Math.PI * 2);
    g.moveTo(15, 15);
    g.lineTo(49, 49);
    g.stroke();
  },
  // Output blocked (nothing to take the items, or it's full): an amber no-entry sign.
  blocked: (g) => {
    g.fillStyle = "#f2a900";
    g.beginPath();
    g.arc(32, 32, 26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ffffff";
    g.fillRect(16, 27, 32, 10);
  },
  // A furnace with nothing to burn: a flame, crossed out.
  "no-fuel": (g) => {
    g.fillStyle = "#ff8a1f";
    g.beginPath();
    g.moveTo(32, 12);
    g.bezierCurveTo(44, 24, 46, 32, 44, 40);
    g.bezierCurveTo(42, 50, 22, 50, 20, 40);
    g.bezierCurveTo(19, 33, 24, 28, 26, 22);
    g.bezierCurveTo(29, 28, 30, 30, 33, 31);
    g.bezierCurveTo(34, 24, 33, 18, 32, 12);
    g.fill();
    g.strokeStyle = "#e0282e";
    g.lineWidth = 6;
    g.beginPath();
    g.arc(32, 32, 24, 0, Math.PI * 2);
    g.moveTo(15, 15);
    g.lineTo(49, 49);
    g.stroke();
  },
};
// Which icon each machine status shows. Statuses not listed (e.g. "working", or an
// inserter "waiting" for room, which is normal) show none.
const ICON_FOR = { "no-resource": "no-resource", "no-output": "blocked", full: "blocked", "no-fuel": "no-fuel" };

function iconTexture(draw) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const g = canvas.getContext("2d");
  // A dark disc behind the icon keeps it readable on any ground, in both themes.
  g.fillStyle = "rgba(15, 17, 22, 0.75)";
  g.beginPath();
  g.arc(32, 32, 31, 0, Math.PI * 2);
  g.fill();
  draw(g);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createStatusIcons(parent) {
  const materials = {};
  for (const name in ICONS) {
    materials[name] = new THREE.SpriteMaterial({ map: iconTexture(ICONS[name]), depthTest: false, depthWrite: false });
  }
  const pool = []; // sprites are reused frame to frame; there are rarely many

  return {
    // Shows an icon over every entity whose status needs one.
    update(entities) {
      let n = 0;
      for (const e of entities) {
        const icon = ICON_FOR[e.status];
        if (!icon) continue;
        let sprite = pool[n];
        if (!sprite) {
          sprite = pool[n] = new THREE.Sprite();
          sprite.scale.set(0.9, 0.9, 1);
          sprite.renderOrder = 3;
          parent.add(sprite);
        }
        const { w, h } = footprint(e.type, e.rot);
        sprite.material = materials[icon];
        sprite.position.set(e.x + w / 2, 1.6, e.y + h / 2);
        sprite.visible = true;
        n++;
      }
      for (let i = n; i < pool.length; i++) pool[i].visible = false;
    },
    dispose() {
      for (const m of Object.values(materials)) {
        m.map.dispose();
        m.dispose();
      }
    },
  };
}
