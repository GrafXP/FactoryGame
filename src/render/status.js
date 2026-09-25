import { footprint } from "../sim/buildings.js";
import { powerNetwork, satisfaction, usesPower } from "../sim/power.js";

const LOW_POWER = 0.95; // a working machine on a network doing worse than this shows it

// A lightning bolt on the 64-pixel icon grid.
function bolt(g, color) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(36, 10);
  g.lineTo(20, 35);
  g.lineTo(31, 35);
  g.lineTo(27, 54);
  g.lineTo(44, 28);
  g.lineTo(33, 28);
  g.closePath();
  g.fill();
}

function crossOut(g) {
  g.strokeStyle = "#e0282e";
  g.lineWidth = 6;
  g.beginPath();
  g.arc(32, 32, 24, 0, Math.PI * 2);
  g.moveTo(15, 15);
  g.lineTo(49, 49);
  g.stroke();
}

// Icons floating over machines that are stopped or slowed, so a glance shows what
// needs help. They're painted into the icon atlas (billboards.js) on first use.
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
    crossOut(g);
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
  // An assembler that hasn't been told what to make: a question mark.
  "no-recipe": (g) => {
    g.fillStyle = "#6cb4ff";
    g.font = "bold 40px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("?", 32, 35);
  },
  // A machine without power: a lightning bolt, crossed out.
  "no-power": (g) => {
    bolt(g, "#ffd23f");
    crossOut(g);
  },
  // A machine slowed by a network short of power: an amber bolt.
  "low-power": (g) => bolt(g, "#f2a900"),
  // A generator with no pole near it: a grey bolt, crossed out.
  unconnected: (g) => {
    bolt(g, "#8a8f99");
    crossOut(g);
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
    crossOut(g);
  },
};
// Which icon each machine status shows. Statuses not listed (e.g. "working", or an
// inserter "waiting" for room, which is normal) show none.
const ICON_FOR = {
  "no-resource": "no-resource",
  "no-output": "blocked",
  full: "blocked",
  "no-fuel": "no-fuel",
  "no-recipe": "no-recipe",
  "no-power": "no-power",
  unconnected: "unconnected",
  "no-exit": "blocked", // a sorter holding an item no way out will take
};

// The icon over entity e, if it needs one.
function iconOf(e, world) {
  const icon = ICON_FOR[e.status];
  if (icon || e.status !== "working" || !usesPower(e.type)) return icon;
  const net = powerNetwork(world).netOf.get(e);
  return net && satisfaction(net) < LOW_POWER ? "low-power" : undefined;
}

// Each icon painted on its dark disc, which keeps it readable on any ground, in
// both themes, and its key in the atlas (billboards.js).
const PAINT = {};
const KEY = {};
for (const [name, draw] of Object.entries(ICONS)) {
  KEY[name] = `status:${name}`;
  PAINT[name] = (g) => {
    g.fillStyle = "rgba(15, 17, 22, 0.75)";
    g.beginPath();
    g.arc(32, 32, 31, 0, Math.PI * 2);
    g.fill();
    draw(g);
  };
}

// Adds an icon to `icons` (billboards.js) over every building in `list` whose
// status needs one.
export function drawStatusIcons(world, list, icons) {
  for (const e of list) {
    if (!e.status) continue;
    const icon = iconOf(e, world);
    if (!icon) continue;
    const { w, h } = footprint(e.type, e.rot);
    icons.add(icons.cell(KEY[icon], PAINT[icon]), e.x + w / 2, 1.6, e.y + h / 2, 0.9);
  }
}
