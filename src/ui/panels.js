import { BUILDINGS } from "../sim/buildings.js";
import { ITEMS, describe, itemName } from "../sim/items.js";
import { count, total } from "../sim/inventory.js";
import { takeAll, oreLeftUnder } from "../sim/world.js";
import { SMELTING, FUEL, RECIPES } from "../sim/recipes.js";
import { fillFrom, emptySlot, furnaceRoom } from "../sim/furnace.js";
import { setRecipe, fillAssembler, emptyAssembler, assemblerRoom } from "../sim/assembler.js";
import { TICK_RATE } from "../sim/world.js";
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
  "no-output": () => "Stopped: nothing in front takes items. It drops into belts, chests, furnaces and assemblers.",
};
const ASSEMBLER_STATUS = {
  "no-recipe": () => "Idle: pick what it makes.",
  working: (a) => `Making ${lower(a.recipe, 2)}`,
  "no-input": (a) => {
    const short = Object.entries(RECIPES[a.recipe].in)
      .filter(([id, n]) => (a.inputs[id] || 0) < n)
      .map(([id]) => lower(id, 2));
    return `Waiting for ${short.join(" and ")}.`;
  },
  full: () => "Stopped: the output is full. Take what it made, or put an inserter there to take it out.",
};

// "2 iron plates → 1 iron gear, every 2 s"
const recipeText = (id) => {
  const r = RECIPES[id];
  return `${describe(r.in)} → ${describe({ [id]: r.n })}, every ${+(r.time / TICK_RATE).toFixed(2)} s`;
};

// Buttons that add each of `ids` from the inventory, as much as fits (`room`).
const addButtons = (ids, inv, room) =>
  ids
    .map((id) => [id, Math.min(count(inv, id), room(id))])
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `<button data-action="fill" data-item="${id}">${itemIcon(id)}Add ${n} ${lower(id, n)}</button>`)
    .join("");

const heading = (title) => `<h3>${title}<button class="close" data-action="close" aria-label="Close">${icon("close")}</button></h3>`;

// A machine's slot, with a button to take back what's in it (`take` holds the
// attribute saying which slot or item; the output has its own big button instead).
const slotRow = (label, s, take) =>
  `<li><em>${label}</em>${
    s
      ? `${itemIcon(s.item)}<span>${itemName(s.item, s.n)}</span><b>${s.n}</b>` +
        (take ? `<button class="take" data-action="empty" ${take} aria-label="Take back ${lower(s.item, s.n)}">Take</button>` : "")
      : `<span class="empty">Empty</span>`
  }</li>`;

const takeOutput = (out) =>
  `<button class="wide" data-action="empty" data-slot="output"${out ? "" : " disabled"}>${out ? `Take ${out.n} ${lower(out.item, out.n)}` : "Nothing made yet"}</button>`;

// Each panel: the key its markup depends on, the markup, and the progress bar's fill.
// `view` is the panel's own state: `picking` while choosing an assembler's recipe.
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
      const adds = addButtons([...Object.keys(FUEL), ...Object.keys(SMELTING)], world.inventory, (id) => furnaceRoom(f, id));
      return `${heading("Furnace")}
        <p class="status" data-status="${f.status}">${FURNACE_STATUS[f.status](f)}</p>
        <span class="bar"><i></i></span>
        <ul class="items slots">${slotRow("Ore", f.input, `data-slot="input"`)}${slotRow("Fuel", f.fuel, `data-slot="fuel"`)}${slotRow("Made", f.output)}</ul>
        ${adds ? `<div class="actions">${adds}</div>` : ""}
        ${takeOutput(f.output)}`;
    },
    progress: (f) => (f.smelting ? f.progress / SMELTING[f.smelting].time : 0),
  },
  // Without a recipe (or when changing it) the panel is a recipe picker. Then it
  // works like a furnace's: add ingredients, take them back, take what it made.
  assembler: {
    key: (a, world, view) =>
      `${view.picking} ${a.status} ${a.recipe} ${JSON.stringify([a.inputs, a.output])} ${world.inventory.version}`,
    html: (a, world, view) => {
      if (!a.recipe || view.picking) {
        const choices = Object.keys(RECIPES)
          .map(
            (id) => `<button class="recipe-pick" data-action="recipe" data-recipe="${id}" aria-pressed="${id === a.recipe}">
              ${itemIcon(id)}<span><b>${ITEMS[id].name}</b><small>${recipeText(id)}</small></span></button>`,
          )
          .join("");
        return `${heading("Assembler")}
          <p>${a.recipe ? "Pick what it makes instead. What it holds comes back to you." : "Pick what it makes:"}</p>
          <div class="recipe-picks">${choices}</div>
          ${a.recipe ? `<button class="wide secondary" data-action="keep">Keep making ${lower(a.recipe, 2)}</button>` : ""}`;
      }
      const r = RECIPES[a.recipe];
      const ins = Object.keys(r.in)
        .map((id) => slotRow("In", a.inputs[id] ? { item: id, n: a.inputs[id] } : null, `data-item="${id}"`))
        .join("");
      const adds = addButtons(Object.keys(r.in), world.inventory, (id) => assemblerRoom(a, id));
      return `${heading("Assembler")}
        <p class="status" data-status="${a.status}">${ASSEMBLER_STATUS[a.status](a)}</p>
        <span class="bar"><i></i></span>
        <div class="makes">${itemIcon(a.recipe)}<span>${recipeText(a.recipe)}</span><button class="take" data-action="pick">Change</button></div>
        <ul class="items slots">${ins}${slotRow("Made", a.output)}</ul>
        ${adds ? `<div class="actions">${adds}</div>` : ""}
        ${takeOutput(a.output)}`;
    },
    progress: (a) => (a.crafting ? a.progress / RECIPES[a.recipe].time : 0),
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
  const view = { picking: false };

  const sync = (w) => {
    world = w;
    if (!shown) return;
    if (!world.entities.has(shown.id)) return close();
    const panel = PANELS[shown.type];
    const key = `${shown.type} ${panel.key(shown, world, view)}`;
    if (key !== shownKey) {
      shownKey = key;
      el.innerHTML = panel.html(shown, world, view);
    }
    const bar = el.querySelector(".bar i");
    if (panel.progress && bar) bar.style.width = `${panel.progress(shown) * 100}%`;
  };

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    const action = btn?.dataset.action;
    if (action === "close") return close();
    if (!shown || !world) return;
    const inv = world.inventory;
    const asm = shown.type === "assembler";
    let moved = null;
    if (action === "take" && shown.inventory) moved = takeAll(world, shown);
    else if (action === "empty") {
      moved = asm ? emptyAssembler(shown, inv, btn.dataset.item ?? null) : emptySlot(shown, btn.dataset.slot, inv);
    } else if (action === "fill") {
      const item = btn.dataset.item;
      const n = asm ? fillAssembler(shown, inv, item) : fillFrom(shown, inv, item);
      if (n) toast(`Added ${describe({ [item]: n })}`);
    } else if (action === "recipe") {
      view.picking = false;
      if (btn.dataset.recipe !== shown.recipe) {
        const back = setRecipe(shown, btn.dataset.recipe, inv);
        if (Object.keys(back).length) toast(`Got back ${describe(back)}`);
      }
    } else if (action === "pick" || action === "keep") view.picking = action === "pick";
    else return;
    if (moved && Object.keys(moved).length) toast(`Took ${describe(moved)}`);
    sync(world);
    changed();
  });

  return {
    // Shows entity e's panel, or hides it for null or a building without one.
    show(e, w) {
      shown = e && PANELS[e.type] ? e : null;
      shownKey = "";
      view.picking = false;
      el.hidden = !shown;
      if (shown) sync(w);
    },
    sync,
  };
}
