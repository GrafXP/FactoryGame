import { ITEMS } from "../sim/items.js";

// Small inline SVG icons, as markup strings.
//
// Items are drawn in their own colour (the --item-* CSS variables) in the shape
// they have on a belt (ITEMS[id].shape): ore is a rock, plates are plates, bricks
// are bricks, so iron ore and iron plates read apart at a glance. `lit` faces are
// the top, drawn lighter, and `shade` faces the sides, darker; the outline keeps
// dark items like coal visible on dark panels.
const ITEM_SHAPES = {
  rock: `<path d="M4.5 15.5 7 8l6-3.5 6.5 4 1 7.5-4.5 4h-7z"/><path class="lit" d="M7 8l6-3.5 6.5 4-6 2.5z"/>`,
  plate: `<path class="lit" d="M2.5 14 8.5 8h13l-6 6z"/><path class="shade" d="M2.5 14h13v3.5h-13zM15.5 14l6-6v3.5l-6 6z"/>`,
  brick: `<path class="lit" d="M3 10.5 7.5 6.5h13.5l-4.5 4z"/><path class="shade" d="M3 10.5h13.5V18H3zM16.5 10.5l4.5-4V14l-4.5 4z"/>`,
};

export const itemIcon = (id) =>
  `<svg class="item-icon" viewBox="0 0 24 24" style="--c: var(--item-${id})" aria-hidden="true">${ITEM_SHAPES[ITEMS[id]?.shape || "rock"]}</svg>`;

// Line icons for buildings and buttons, drawn in the current text colour.
const PATHS = {
  belt: "M3 7h18v10H3zM8 12h7M12 9l3 3-3 3",
  miner: "M5 10h14v10H5zM9 10V5h6v5M12 14v3",
  chest: "M4 10h16v9H4zM4 10l2-4h12l2 4M10 14h4",
  furnace: "M4 20V9h16v11zM14 9V4h4v5M9 20v-4a3 3 0 0 1 6 0v4",
  inserter: "M7 20h10M12 20v-5M12 15l-5-6M7 9l5-4M10 4l3 2",
  remove: "M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13",
  rotate: "M19 12a7 7 0 1 1-2-4.9M19 4v4h-4",
  build: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7",
  back: "M15 5l-7 7 7 7",
  pause: "M9 5v14M15 5v14",
  close: "M6 6l12 12M18 6 6 18",
};

export const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
