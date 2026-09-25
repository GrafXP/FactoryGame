import * as THREE from "three";
import { footprint } from "../sim/buildings.js";
import { facesOf } from "../ui/icons.js";

// An icon of what each assembler makes, on the front-left corner of its roof (clear
// of the turning cog), so a line of machines can be read at a glance, and small
// ones by each way out of a sorter showing its filter (an item, or » for overflow;
// nothing for "any"). Items are drawn from the same shapes as their icons in the UI
// (ui/icons.js), in their colour for the current theme, on a dark disc, and painted
// into the icon atlas (billboards.js) on first use.
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

// A dark disc on the 64-unit icon grid.
function disc(g) {
  g.fillStyle = "rgba(15, 17, 22, 0.75)";
  g.beginPath();
  g.arc(32, 32, 31, 0, Math.PI * 2);
  g.fill();
}

// A sorter's overflow way: a white ».
function paintOverflow(g) {
  disc(g);
  g.fillStyle = "#ffffff";
  g.font = "bold 44px system-ui, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("»", 32, 34);
}

function paintItem(g, faces, hex) {
  disc(g);
  const base = new THREE.Color(hex);
  const tint = { "": base, lit: base.clone().lerp(new THREE.Color(0xffffff), 0.28), shade: base.clone().multiplyScalar(0.68) };
  tint.dark = base.clone().multiplyScalar(0.3);
  // The 24-unit icon grid, inset a little from the disc's edge.
  g.translate(64 * 0.14, 64 * 0.14);
  g.scale((64 * 0.72) / 24, (64 * 0.72) / 24);
  g.lineWidth = 1.1;
  g.lineJoin = "round";
  g.strokeStyle = "rgba(255, 255, 255, 0.35)";
  for (const [kind, d] of faces) {
    const path = new Path2D(d);
    g.fillStyle = `#${tint[kind].getHexString()}`;
    g.fill(path, "evenodd");
    g.stroke(path);
  }
}

export function createRecipeIcons() {
  let colors = {}; // item id → hex
  const painters = new Map(); // item id (or "overflow") → [atlas key, paint(g)]

  const painter = (item) => {
    let p = painters.get(item);
    if (!p) {
      const paint = item === "overflow" ? paintOverflow : (g) => paintItem(g, facesOf(item), colors[item] ?? 0xffffff);
      painters.set(item, (p = [`item:${item}`, paint]));
    }
    return p;
  };

  return {
    // Adds the icons for the buildings in `list` to `icons` (billboards.js).
    update(list, icons) {
      const show = (item, x, y, z, size) => {
        const [key, paint] = painter(item);
        icons.add(icons.cell(key, paint), x, y, z, size);
      };
      for (const e of list) {
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
    },
    // itemColors: item id → hex colour. The atlas is cleared at the same time
    // (billboards.clear), so the icons are painted again in the new colours.
    setTheme(itemColors) {
      colors = itemColors;
      painters.clear();
    },
  };
}
