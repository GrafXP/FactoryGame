import { BUILDINGS } from "../sim/buildings.js";
import { describe, itemName } from "../sim/items.js";
import { count, total } from "../sim/inventory.js";
import { takeAll, oreLeftUnder } from "../sim/world.js";
import { SMELTING, FUEL } from "../sim/recipes.js";
import { fillFrom, emptySlot, furnaceRoom } from "../sim/furnace.js";
import { itemIcon, icon } from "./icons.js";
import { lower, itemRows } from "./format.js";

// The panel for the building tapped with no tool: what it holds and what it's
// doing, with buttons to move items in and out. Redrawn when what it shows changes
// (its key); progress bars move every tick.
const MINER_STATUS = {
  working: (m) => `Mining ${lower(m.item)}`,
  "no-resource": () => "Stopped: no ore under it. Miners have to sit on an ore patch.",
  "no-output": () => "Stopped: nothing in front of the chute takes the ore. Put a belt, chest or furnace there.",
  full: () => "Stopped: no room in front for the ore. Empty the chest or clear the belt.",
};
const FURNACE_STATUS = {
  working: (f) => `Smelting ${lower(f.smelting)} into ${lower(SMELTING[f.smelting].out, 2)}`,
  "no-input": (f) => {
    if (!f.input) return "Idle: nothing to smelt. It takes iron ore, copper ore or stone.";
    const { need, out } = SMELTING[f.input.item];
    return `Waiting: it takes ${need} ${lower(f.input.item, need)} to make ${lower(out)}. Add more, or take it back.`;
  },
  "no-fuel": () => "Stopped: no fuel. Give it coal.",
  full: () => "Stopped: the output is full. Take what it made, or put an inserter there to take it out.",
};
const INSERTER_STATUS = {
  working: (e) => (e.hand ? `Moving ${lower(e.hand)}` : "Swinging back"),
  idle: () => "Waiting for something the building in front can use.",
  waiting: (e) => `Holding ${lower(e.hand)} until there's room in front.`,
  "no-output": () => "Stopped: nothing in front takes items. It drops into belts, chests and furnaces.",
};

const heading = (title) => `<h3>${title}<button class="close" data-action="close" aria-label="Close">${icon("close")}</button></h3>`;

// A furnace slot, with a button to take back what's in it (the output has its own big one).
const slotRow = (label, s, slot) =>
  `<li><em>${label}</em>${
    s
      ? `${itemIcon(s.item)}<span>${itemName(s.item, s.n)}</span><b>${s.n}</b>` +
        (slot ? `<button class="take" data-action="empty" data-slot="${slot}" aria-label="Take back ${lower(s.item, s.n)}">Take</button>` : "")
      : `<span class="empty">Empty</span>`
  }</li>`;

// Each panel: the key its markup depends on, the markup, and the progress bar's fill.
const PANELS = {
  chest: {
    key: (c) => c.inventory.version,
    html: (c) => {
      const n = total(c.inventory);
      return `${heading("Chest")}
        <p class="meta">${n} / ${BUILDINGS.chest.capacity} items</p>
        <ul class="items">${itemRows(c.inventory) || `<li class="empty">Empty</li>`}</ul>
        <button class="wide" data-action="take"${n ? "" : " disabled"}>Take all</button>`;
    },
  },
  miner: {
    key: (m, world) => `${m.status} ${m.item} ${oreLeftUnder(world, m)}`,
    html: (m, world) => `${heading("Miner")}
      <p class="status" data-status="${m.status}">${MINER_STATUS[m.status](m)}</p>
      <p class="meta">Ore left under it: ${oreLeftUnder(world, m)}</p>
      <span class="bar"><i></i></span>`,
    progress: (m) => m.progress / BUILDINGS.miner.period,
  },
  // The player can add ore and fuel from the inventory, take them back, and take what it made.
  furnace: {
    key: (f, world) => `${f.status} ${JSON.stringify([f.input, f.fuel, f.output, f.smelting])} ${world.inventory.version}`,
    html: (f, world) => {
      const inv = world.inventory;
      const adds = [...Object.keys(FUEL), ...Object.keys(SMELTING)]
        .map((id) => [id, Math.min(count(inv, id), furnaceRoom(f, id))])
        .filter(([, n]) => n > 0)
        .map(([id, n]) => `<button data-action="fill" data-item="${id}">${itemIcon(id)}Add ${n} ${lower(id, n)}</button>`);
      const out = f.output;
      return `${heading("Furnace")}
        <p class="status" data-status="${f.status}">${FURNACE_STATUS[f.status](f)}</p>
        <span class="bar"><i></i></span>
        <ul class="items slots">${slotRow("Ore", f.input, "input")}${slotRow("Fuel", f.fuel, "fuel")}${slotRow("Made", out)}</ul>
        ${adds.length ? `<div class="actions">${adds.join("")}</div>` : ""}
        <button class="wide" data-action="empty" data-slot="output"${out ? "" : " disabled"}>${out ? `Take ${out.n} ${lower(out.item, out.n)}` : "Nothing made yet"}</button>`;
    },
    progress: (f) => (f.smelting ? f.progress / SMELTING[f.smelting].time : 0),
  },
  inserter: {
    key: (e) => `${e.status} ${e.hand}`,
    html: (e) => `${heading("Inserter")}
      <p class="status" data-status="${e.status}">${INSERTER_STATUS[e.status](e)}</p>
      <p class="meta">It takes from the building behind it and drops into the one in front (the arrow points that way), one item at a time and only what that building can use.</p>`,
  },
};

// `close` is called when the panel should go (its ✕, or the building is gone);
// `changed` after items moved between the building and the player.
export function createEntityPanel(el, { close, changed, toast }) {
  let shown = null;
  let shownKey = "";
  let world = null;

  const sync = (w) => {
    world = w;
    if (!shown) return;
    if (!world.entities.has(shown.id)) return close();
    const panel = PANELS[shown.type];
    const key = `${shown.type} ${panel.key(shown, world)}`;
    if (key !== shownKey) {
      shownKey = key;
      el.innerHTML = panel.html(shown, world);
    }
    if (panel.progress) el.querySelector(".bar i").style.width = `${panel.progress(shown) * 100}%`;
  };

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    const action = btn?.dataset.action;
    if (action === "close") return close();
    if (!shown || !world) return;
    let moved = null;
    if (action === "take" && shown.inventory) moved = takeAll(world, shown);
    else if (action === "empty") moved = emptySlot(shown, btn.dataset.slot, world.inventory);
    else if (action === "fill") {
      const n = fillFrom(shown, world.inventory, btn.dataset.item);
      if (n) toast(`Added ${describe({ [btn.dataset.item]: n })}`);
    } else return;
    if (moved && Object.keys(moved).length) toast(`Took ${describe(moved)}`);
    sync(world);
    changed();
  });

  return {
    // Shows entity e's panel, or hides it for null or a building without one.
    show(e, w) {
      shown = e && PANELS[e.type] ? e : null;
      shownKey = "";
      el.hidden = !shown;
      if (shown) sync(w);
    },
    sync,
  };
}
