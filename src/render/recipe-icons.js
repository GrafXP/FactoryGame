import * as THREE from "three";
import { footprint } from "../sim/buildings.js";
import { facesOf } from "../ui/icons.js";

// An icon of what each assembler makes, on the front-left corner of its roof (clear
// of the turning cog), so a line of machines can be read at a glance, and small
// ones by each way out of a sorter showing its filter (an item, or » for overflow;
// nothing for "any"). Items are drawn from the same shapes as their icons in the UI
// (ui/icons.js), in their colour for the current theme, on a dark disc.
const SIZE = 64;
const Y = 1.55;
const INSET = 0.6; // from the footprint's west and south edges
const FILTER_Y = 0.42;
const FILTER_OUT = 0.34; // from a sorter's centre towards each way out
const FILTER_SIZE = 0.36;
// Each way out of a sorter facing north, [front, left, right], as (x, y) offsets.
const FILTER_AT = [
  [0, -1],
  [-1, 0],
  [1, 0],
];

function disc() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const g = canvas.getContext("2d");
  g.fillStyle = "rgba(15, 17, 22, 0.75)";
  g.beginPath();
  g.arc(SIZE / 2, SIZE / 2, SIZE / 2 - 1, 0, Math.PI * 2);
  g.fill();
  return { canvas, g };
}

function texture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A sorter's overflow way: a white ».
function drawOverflow() {
  const { canvas, g } = disc();
  g.fillStyle = "#ffffff";
  g.font = "bold 44px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("»", SIZE / 2, SIZE / 2 + 2);
  return texture(canvas);
}

function drawItem(faces, hex) {
  const { canvas, g } = disc();
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
  return texture(canvas);
}

export function createRecipeIcons(parent) {
  let colors = {}; // item id → hex
  const materials = new Map(); // item id → SpriteMaterial, drawn on first use
  const pool = [];

  const material = (item) => {
    let mat = materials.get(item);
    if (!mat) {
      const map = item === "overflow" ? drawOverflow() : drawItem(facesOf(item), colors[item] ?? 0xffffff);
      mat = new THREE.SpriteMaterial({ map, depthTest: false, depthWrite: false });
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
      const show = (item, x, y, z, size) => {
        let sprite = pool[n];
        if (!sprite) {
          sprite = pool[n] = new THREE.Sprite();
          sprite.renderOrder = 3;
          parent.add(sprite);
        }
        sprite.material = material(item);
        sprite.scale.set(size, size, 1);
        sprite.position.set(x, y, z);
        sprite.visible = true;
        n++;
      };
      for (const e of entities) {
        if (e.type === "assembler" && e.recipe) {
          const { h } = footprint(e.type, e.rot);
          show(e.recipe, e.x + INSET, Y, e.y + h - INSET, 0.85);
        } else if (e.type === "sorter") {
          e.filters.forEach((f, i) => {
            if (f === "any") return;
            let [dx, dy] = FILTER_AT[i];
            for (let r = 0; r < e.rot; r++) [dx, dy] = [-dy, dx]; // a quarter turn clockwise
            show(f, e.x + 0.5 + dx * FILTER_OUT, FILTER_Y, e.y + 0.5 + dy * FILTER_OUT, FILTER_SIZE);
          });
        }
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
