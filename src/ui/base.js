import { BUILDINGS } from "../sim/buildings.js";
import { NEST } from "../sim/map.js";
import { UNITS, NEST_HEALTH, TIER_NAMES, baseInfo } from "../sim/enemies.js";
import { TICK_RATE } from "../sim/world.js";
import { icon } from "./icons.js";

// The base panel: an enemy base's nests, each with its health and the units it has
// at home, what the base has out and doing what, and how strong it is (its ring's
// colour on the map). Opened by tapping a base on the map, or a nest on the
// playfield. Redrawn once a second, or when a nest goes. `go(x, y)` looks at the
// base; `close` is called by its ✕.
const plural = (n, word) => `${n} ${word.toLowerCase()}${n === 1 ? "" : "s"}`;
const list = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] || "");
const DOING = { attack: "attacking", defend: "defending", expand: "setting up a new nest" };

export function createBasePanel(el, { go, close }) {
  let key = null;
  let world = null;
  let shownKey = "";
  let where = null; // the middle of the base, while it has nests

  const render = () => {
    const info = baseInfo(world, key);
    const k = `${key} ${Math.floor(world.tick / TICK_RATE)} ${info.nests.length}`;
    if (k === shownKey) return;
    shownKey = k;
    const head = `<h3>Enemy base<button class="close" data-action="close" aria-label="Close">${icon("close")}</button></h3>`;
    if (!info.nests.length) {
      el.innerHTML = `${head}<p class="status">Cleared</p><p class="meta">Every nest here is destroyed, so the land is free to build on and mine.</p>
        ${where ? `<button class="wide" data-action="go">Go there</button>` : ""}`;
      return;
    }
    const xs = info.nests.map((n) => n.x);
    const ys = info.nests.map((n) => n.y);
    where = { x: (Math.min(...xs) + Math.max(...xs) + NEST) / 2, y: (Math.min(...ys) + Math.max(...ys) + NEST) / 2 };
    const rows = info.nests
      .map(
        (n, i) =>
          `<li><span>Nest ${i + 1}</span><span class="bar" title="${Math.ceil((100 * n.hp) / NEST_HEALTH)}% health"><i style="width:${(100 * n.hp) / NEST_HEALTH}%"></i></span><small>${n.home} home</small></li>`,
      )
      .join("");
    const kinds = list(info.kinds.flatMap((n, k) => (n ? [plural(n, UNITS[k].name)] : [])));
    const out = list(Object.entries(info.out).flatMap(([what, n]) => (n ? [`${n} ${DOING[what]}`] : [])));
    const evo = Math.floor(world.enemies.evolution * 100);
    el.innerHTML = `${head}
      <p class="status" data-tier="${info.tier}">${TIER_NAMES[info.tier]}: ${plural(info.units, "unit")}</p>
      <ul class="nest-list">${rows}</ul>
      <p class="meta">${kinds || "No units"}${out ? `; ${out}` : ""}. Evolution ${evo}%.</p>
      <p class="meta">Gun turrets shoot nests within ${BUILDINGS.turret.range} tiles once no units are in range. Each nest has ${NEST_HEALTH} health and mends when left alone, and the base's units come out to defend it, so build walls in front and keep the turrets loaded.</p>
      <button class="wide" data-action="go">Go there</button>`;
  };

  el.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "close") close();
    if (action === "go" && where) go(where.x, where.y);
  });

  return {
    // Shows base `key` (null hides the panel).
    show(k, w) {
      key = k;
      world = w;
      shownKey = "";
      where = null;
      el.hidden = key === null;
      if (key !== null) render();
    },
    sync(w) {
      world = w;
      if (key !== null) render();
    },
  };
}
