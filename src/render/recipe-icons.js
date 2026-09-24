import * as THREE from "three";
import { footprint } from "../sim/buildings.js";
import { facesOf } from "../ui/icons.js";

// An icon of what each assembler makes, on the front-left corner of its roof (clear
// of the turning cog), so a line of machines can be read at a glance. The item is
// drawn from the same shapes as its icon in the UI (ui/icons.js), in its colour
// for the current theme, on a dark disc.
const SIZE = 64;
const Y = 1.55;
const INSET = 0.6; // from the footprint's west and south edges

function drawItem(faces, hex) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d");
  g.fillStyle = "rgba(15, 17, 22, 0.75)";
  g.beginPath();
  g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2);
  g.fill();
  const base = new THREE.Color(hex);
  const tint = { "": base, lit: base.clone().lerp(new THREE.Color(0xffffff), 0.28), shade: base.clone().multiplyScalar(0.68) };
  tint.dark = base.clone().multiplyScalar(0.3);
  // The 24-unit icon grid, inset a little from the disc's edge.
  g.translate(SIZE * 0.14, SIZE * 0.14);
  g.scale((SIZE * 0.72) / 24, (SIZE * 0.72) / 24);
  g.lineWidth = 1.1;
  g.lineJoin = "round";
  g.strokeStyle = "rgba(255, 255, 255, 0.35)";
  for (const [kind, d] of faces) {
    const path = new Path2D(d);
    g.fillStyle = `#${tint[kind].getHexString()}`;
    g.fill(path, "evenodd");
    g.stroke(path);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createRecipeIcons(parent) {
  let colors = {}; // item id → hex
  const materials = new Map(); // item id → SpriteMaterial, drawn on first use
  const pool = [];

  const material = (item) => {
    let mat = materials.get(item);
    if (!mat) {
      mat = new THREE.SpriteMaterial({ map: drawItem(facesOf(item), colors[item] ?? 0xffffff), depthTest: false, depthWrite: false });
      materials.set(item, mat);
    }
    return mat;
  };
  const clear = () => {
    for (const mat of materials.values()) {
      mat.map.dispose();
      mat.dispose();
    }
    materials.clear();
  };

  return {
    update(entities) {
      let n = 0;
      for (const e of entities) {
        if (e.type !== "assembler" || !e.recipe) continue;
        let sprite = pool[n];
        if (!sprite) {
          sprite = pool[n] = new THREE.Sprite();
          sprite.scale.set(0.85, 0.85, 1);
          sprite.renderOrder = 3;
          parent.add(sprite);
        }
        const { h } = footprint(e.type, e.rot);
        sprite.material = material(e.recipe);
        sprite.position.set(e.x + INSET, Y, e.y + h - INSET);
        sprite.visible = true;
        n++;
      }
      for (let i = n; i < pool.length; i++) pool[i].visible = false;
    },
    // itemColors: item id → hex colour. Icons are redrawn in the new colours.
    setTheme(itemColors) {
      colors = itemColors;
      clear();
    },
    dispose: clear,
  };
}
