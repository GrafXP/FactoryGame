import { ITEMS } from "../sim/items.js";

// Small icons: SVG markup for the DOM, and the item shapes as path data that the
// 3D view also draws (render/recipe-icons.js).
//
// Items are drawn in their own colour (the --item-* CSS variables) in the shape
// they have on a belt (ITEMS[id].shape), so iron ore and iron plates read apart at
// a glance. Each shape is a list of faces, [kind, path]: kind "" is the plain
// colour, "lit" a top face drawn lighter, "shade" a side drawn darker and "dark" a
// dark detail. Paths are on a 24×24 grid and filled even-odd, so a gear has a hole.

// A gear centred on (12, 12): `teeth` teeth between radius r (root) and R (tips),
// with a hole of radius h.
function gearPath(teeth, r, R, h) {
  const pts = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    for (const [da, rad] of [
      [-0.3, r],
      [-0.18, R],
      [0.18, R],
      [0.3, r],
    ]) {
      pts.push(`${(12 + Math.cos(a + da * step * 1.6) * rad).toFixed(2)} ${(12 + Math.sin(a + da * step * 1.6) * rad).toFixed(2)}`);
    }
  }
  return `M${pts.join("L")}ZM${12 + h} 12a${h} ${h} 0 1 0 ${-2 * h} 0a${h} ${h} 0 1 0 ${2 * h} 0Z`;
}

export const ITEM_FACES = {
  rock: [
    ["", "M4.5 15.5 7 8l6-3.5 6.5 4 1 7.5-4.5 4h-7z"],
    ["lit", "M7 8l6-3.5 6.5 4-6 2.5z"],
  ],
  plate: [
    ["lit", "M2.5 14 8.5 8h13l-6 6z"],
    ["shade", "M2.5 14h13v3.5h-13zM15.5 14l6-6v3.5l-6 6z"],
  ],
  brick: [
    ["lit", "M3 10.5 7.5 6.5h13.5l-4.5 4z"],
    ["shade", "M3 10.5h13.5V18H3zM16.5 10.5l4.5-4V14l-4.5 4z"],
  ],
  gear: [["", gearPath(8, 6.6, 9.4, 2.6)]],
  // A spool of wire standing on end.
  cable: [
    ["shade", "M4.5 8v8a7.5 3 0 0 0 15 0V8"],
    ["dark", "M4.5 11.2a7.5 3 0 0 0 15 0v1.6a7.5 3 0 0 1-15 0z"],
    ["lit", "M4.5 8a7.5 3 0 1 0 15 0a7.5 3 0 1 0-15 0z"],
  ],
  // A green board with a chip on it.
  circuit: [
    ["lit", "M2.5 13 8.5 7h13l-6 6z"],
    ["shade", "M2.5 13h13v2.8h-13zM15.5 13l6-6v2.8l-6 6z"],
    ["dark", "M8.2 11.2l2.4-2.4h4.8l-2.4 2.4z"],
  ],
};

export const facesOf = (id) => ITEM_FACES[ITEMS[id]?.shape || "rock"];

export const itemIcon = (id) =>
  `<svg class="item-icon" viewBox="0 0 24 24" style="--c: var(--item-${id})" aria-hidden="true">${facesOf(id)
    .map(([kind, d]) => `<path${kind ? ` class="${kind}"` : ""} fill-rule="evenodd" d="${d}"/>`)
    .join("")}</svg>`;

// Line icons for buildings and buttons, drawn in the current text colour.
const PATHS = {
  belt: "M3 7h18v10H3zM8 12h7M12 9l3 3-3 3",
  miner: "M5 10h14v10H5zM9 10V5h6v5M12 14v3",
  chest: "M4 10h16v9H4zM4 10l2-4h12l2 4M10 14h4",
  furnace: "M4 20V9h16v11zM14 9V4h4v5M9 20v-4a3 3 0 0 1 6 0v4",
  inserter: "M7 20h10M12 20v-5M12 15l-5-6M7 9l5-4M10 4l3 2",
  assembler: "M3 8h18v12H3zM12 11.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5M12 9.5v2M12 16.5v2M8 8V4h8v4",
  generator: "M3 9h18v11H3zM6 9V4h3v5M13.5 11l-3 4.5h3.5l-3 3",
  pole: "M12 21V4M6 6h12M7 6v2M17 6v2M9 21h6",
  remove: "M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13",
  rotate: "M19 12a7 7 0 1 1-2-4.9M19 4v4h-4",
  build: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7",
  back: "M15 5l-7 7 7 7",
  pause: "M9 5v14M15 5v14",
  close: "M6 6l12 12M18 6 6 18",
};

export const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
