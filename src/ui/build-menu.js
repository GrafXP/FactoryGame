import { BUILDINGS } from "../sim/buildings.js";
import { affordable } from "../sim/inventory.js";
import { describe } from "../sim/items.js";
import { planItems } from "../sim/crafting.js";
import { CATEGORIES, ABOUT } from "./catalog.js";
import { icon } from "./icons.js";
import { costChips } from "./format.js";

// The build controls. It drives the builder (build.js) and follows it through
// syncTool, and shows costs from the inventory passed to sync.
//  - The bottom bar: Build (opens the sheet), quick slots holding recently picked
//    buildings, and Remove. A building picked from the sheet that isn't in a slot
//    takes over the slot used longest ago, so the others stay where they are.
//  - The build sheet: a tab per category, a card per building with what it's for,
//    its cost and how many you can afford.
//  - The tool bar, just above the bottom bar while a tool is picked: what it is,
//    its cost, Rotate and Done. When you can't afford the building but could
//    hand-craft the parts it's missing, a Craft button calls `craft(cost)`.
const QUICK_SLOTS = 4;
const QUICK_KEY = "factory:quick";
const DEFAULT_QUICK = ["belt", "inserter", "miner", "furnace"];

// The quick slots from last time, topped up with the defaults.
function loadQuick() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(QUICK_KEY)) || [];
  } catch {}
  const list = [];
  for (const t of [...(Array.isArray(saved) ? saved : []), ...DEFAULT_QUICK]) {
    if (Object.hasOwn(BUILDINGS, t) && !list.includes(t) && list.length < QUICK_SLOTS) list.push(t);
  }
  return list;
}

const countBadge = (n) => (n > 99 ? "99+" : String(n));

export function createBuildMenu({ bar, info, sheet }, builder, { craft }) {
  let tool = null;
  let inv = { items: {} };
  let tab = 0;
  const quick = loadQuick();
  // When each quick slot was last picked; the rightmost default goes first.
  let clock = 0;
  const used = new Map(quick.map((t, i) => [t, -i]));

  // Replaces markup only when it changed, so a tap isn't lost to a redraw.
  const drawn = new WeakMap();
  const put = (el, html) => {
    if (drawn.get(el) === html) return;
    drawn.set(el, html);
    el.innerHTML = html;
  };

  const remember = (t) => {
    used.set(t, ++clock);
    if (quick.includes(t)) return;
    let oldest = 0;
    for (let i = 1; i < quick.length; i++) if ((used.get(quick[i]) ?? -Infinity) < (used.get(quick[oldest]) ?? -Infinity)) oldest = i;
    quick[oldest] = t;
    try {
      localStorage.setItem(QUICK_KEY, JSON.stringify(quick));
    } catch {}
  };

  const renderBar = () => {
    const slot = (t) => {
      const b = BUILDINGS[t];
      const n = affordable(inv, b.cost);
      return `<button class="tool" data-tool="${t}" aria-pressed="${t === tool}" title="${b.name}: ${describe(b.cost)}">
        ${icon(t)}<span>${b.name}</span><b class="badge" data-zero="${!n}">${countBadge(n)}</b></button>`;
    };
    put(
      bar,
      `<button class="tool" data-action="sheet" aria-expanded="${!sheet.hidden}" title="All buildings (B)">${icon("build")}<span>Build</span></button>
      <div class="quick">${quick.map(slot).join("")}</div>
      <button class="tool danger" data-tool="remove" aria-pressed="${tool === "remove"}" title="Remove (X)">${icon("remove")}<span>Remove</span></button>`,
    );
  };

  const renderInfo = () => {
    info.hidden = !tool;
    if (tool === "remove") {
      put(
        info,
        `${icon("remove")}<div class="ti-main"><div class="ti-text"><b>Remove</b><small>Tap a building to take it down. You get back what it cost.</small></div></div>
        <button class="done" data-action="done">Done</button>`,
      );
    } else if (tool) {
      const b = BUILDINGS[tool];
      const n = affordable(inv, b.cost);
      const craftable = !n && !planItems(inv, b.cost).missing;
      put(
        info,
        `${icon(tool)}<div class="ti-main">
          <div class="ti-text"><b>${b.name}</b><small data-zero="${!n}">${n ? `can build ${countBadge(n)}` : "can't afford one"}</small></div>
          <div class="chips">${costChips(b.cost, inv, { compact: true })}</div>
        </div>
        ${craftable ? `<button class="ti-craft" data-action="craft" title="Hand-craft the missing parts">Craft</button>` : ""}
        <button class="ti-btn" data-action="rotate" aria-label="Rotate (R)">${icon("rotate")}</button>
        <button class="done" data-action="done">Done</button>`,
      );
    }
  };

  const card = (t) => {
    const b = BUILDINGS[t];
    const n = affordable(inv, b.cost);
    return `<button class="bcard" data-pick="${t}" aria-pressed="${t === tool}">
      <span class="bcard-top">${icon(t)}<b>${b.name}</b><span class="badge" data-zero="${!n}">${countBadge(n)}</span></span>
      <span class="bcard-about">${ABOUT[t]}</span>
      <span class="chips">${costChips(b.cost, inv)}</span>
    </button>`;
  };

  const renderSheet = () => {
    if (sheet.hidden) return;
    put(
      sheet,
      `<div class="sheet-backdrop" data-action="close"></div>
      <div class="sheet-panel" role="dialog" aria-label="Build">
        <div class="sheet-head">
          <div class="tabs" role="tablist">${CATEGORIES.map(
            (c, i) => `<button role="tab" data-tab="${i}" aria-selected="${i === tab}">${c.name}</button>`,
          ).join("")}</div>
          <button class="sheet-close" data-action="close" aria-label="Close">${icon("close")}</button>
        </div>
        <div class="cards">${CATEGORIES[tab].buildings.map(card).join("")}</div>
      </div>`,
    );
  };

  const render = () => {
    renderBar();
    renderInfo();
    renderSheet();
  };

  const open = () => {
    // Start on the picked building's category.
    const at = CATEGORIES.findIndex((c) => c.buildings.includes(tool));
    if (at >= 0) tab = at;
    sheet.hidden = false;
    render();
  };
  const close = () => {
    if (sheet.hidden) return;
    sheet.hidden = true;
    render();
  };

  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.action === "sheet") return sheet.hidden ? open() : close();
    close();
    builder.setTool(btn.dataset.tool); // the active one again puts it away
  });
  info.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "rotate") builder.rotate();
    if (action === "done") builder.setTool(null);
    if (action === "craft" && BUILDINGS[tool]) craft(BUILDINGS[tool].cost);
  });
  sheet.addEventListener("click", (e) => {
    const el = e.target.closest("[data-action], [data-tab], [data-pick]");
    if (!el) return;
    if (el.dataset.action === "close") close();
    else if (el.dataset.tab) {
      tab = Number(el.dataset.tab);
      renderSheet();
    } else if (el.dataset.pick) {
      const pick = el.dataset.pick;
      close();
      if (builder.tool !== pick) builder.setTool(pick);
    }
  });

  render();

  return {
    get isOpen() {
      return !sheet.hidden;
    },
    open,
    close,
    toggle: () => (sheet.hidden ? open() : close()),
    // Follows the builder's tool.
    syncTool(state) {
      tool = state.tool;
      if (BUILDINGS[tool]) remember(tool);
      render();
    },
    // Costs and badges for the player's inventory.
    sync(inventory) {
      inv = inventory;
      render();
    },
  };
}
