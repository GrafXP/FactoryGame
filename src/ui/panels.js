import { BUILDINGS, kW } from "../sim/buildings.js";
import { ITEMS, describe, itemName } from "../sim/items.js";
import { count, total } from "../sim/inventory.js";
import { takeAll, oreLeftUnder, chestRoom, takeFromChest, putInChest, deliverToHub, deliverAllToHub } from "../sim/world.js";
import { SMELTING, FUEL, FUEL_ENERGY, RECIPES } from "../sim/recipes.js";
import { fillFrom, emptySlot, furnaceRoom } from "../sim/furnace.js";
import { setRecipe, fillAssembler, emptyAssembler, assemblerRoom } from "../sim/assembler.js";
import { fuelGenerator, emptyGenerator, generatorRoom } from "../sim/generator.js";
import { powerNetwork, satisfaction } from "../sim/power.js";
import { MILESTONES, currentMilestone, recipeUnlocked, stillNeeded } from "../sim/progress.js";
import { unlocksText } from "./goal.js";
import { beltNetwork, setFilter } from "../sim/transport.js";
import { REACH, buried } from "../sim/underground.js";
import { RANGE, SCAN, radarTarget, radarCoverage } from "../sim/radar.js";
import { CHUNK } from "../sim/map.js";
import { TICK_RATE } from "../sim/world.js";
import { itemIcon, icon } from "./icons.js";
import { activityLine, pollutionLine } from "./stats.js";
import { maxHealth, REPAIR_AFTER } from "../sim/health.js";
import { emission } from "../sim/pollution.js";
import { lower } from "./format.js";

// The panel for the building tapped with no tool: what it holds and what it's
// doing, with buttons to move items in and out. How many each of those moves is
// picked at the top of the panel (AMOUNTS) and shown on the button. Redrawn when what it shows changes
// (its key); progress bars and the power readouts ([data-live] parts, which have
// no buttons) move every tick.
const MINER_STATUS = {
  working: (m) => `Mining ${lower(m.item)}`,
  "no-resource": () => "Stopped: no ore under it. Miners have to sit on an ore patch.",
  "no-output": () => "Stopped: nothing in front of the chute takes the ore. Put a belt, chest or furnace there.",
  "no-power": () => "Stopped: no power.",
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
  "no-power": () => "Stopped: no power.",
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
  "no-power": () => "Stopped: no power.",
  full: () => "Stopped: the output is full. Take what it made, or put an inserter there to take it out.",
};

const GENERATOR_STATUS = {
  working: () => "Burning coal to make power",
  idle: () => "Idle: nothing on its network needs power right now, so it keeps its coal.",
  "no-fuel": () => "Stopped: no coal. Give it some, or feed it with an inserter or a miner on coal.",
  unconnected: () => `Not connected: put a power pole within ${BUILDINGS.pole.area} tiles of it.`,
};

const AREA = BUILDINGS.pole.area;
const percent = (x) => `${Math.floor(x * 100 + 0.5)}%`;

// What's wrong with a network's power, or null if its machines get all they ask for.
function shortfall(net) {
  if (!net.generators.length) return "its network has no generator";
  if (!net.capacity) {
    return `its network's generator${net.generators.length > 1 ? "s have" : " has"} no coal`;
  }
  const s = satisfaction(net);
  if (s >= 0.95) return null;
  return `its machines ask for ${kW(net.avg.demand)} kW and the generators make ${kW(net.avg.supplied)} kW`;
}

// A powered machine's line about its power.
function powerLine(e, world) {
  const net = powerNetwork(world).netOf.get(e);
  const use = `${kW(BUILDINGS[e.type].draw)} kW`;
  const line = (ok, text) => `<p class="meta power" data-ok="${ok}">${text}</p>`;
  if (!net) return line(false, `No power: there's no power pole within ${AREA} tiles. It uses ${use} while it works.`);
  const why = shortfall(net);
  if (!why) return line(true, `Powered. It uses ${use} while it works.`);
  const s = satisfaction(net);
  return s > 0.02 ? line(false, `Slowed to ${percent(s)}: ${why}.`) : line(false, `No power: ${why}.`);
}

// A network's generators and machines, what they make and use, and how well it keeps up.
function networkSummary(net) {
  if (!net) return `<p class="meta power" data-ok="false">Not on a network.</p>`;
  const out = net.generators.filter((g) => g.status === "no-fuel").length;
  const why = shortfall(net);
  const s = satisfaction(net);
  const verdict = !why
    ? "Every machine on it gets all the power it needs."
    : s > 0.02
      ? `Every machine on it runs at ${percent(s)} speed: ${why}. Build another generator, or keep them in coal.`
      : `Its machines have no power: ${why}.`;
  return `<ul class="items slots">
      <li><em>Make</em><span>${net.generators.length} generator${net.generators.length === 1 ? "" : "s"}${out ? ` (${out} without coal)` : ""}</span><b>${kW(net.avg.supplied)} / ${kW(net.avg.capacity)} kW</b></li>
      <li><em>Use</em><span>${net.consumers.length} machine${net.consumers.length === 1 ? "" : "s"} · ${net.poles.length} pole${net.poles.length === 1 ? "" : "s"}</span><b>${kW(net.avg.demand)} kW</b></li>
    </ul>
    <span class="bar"><i style="width: ${Math.min(100, s * 100)}%"></i></span>
    <p class="meta power" data-ok="${!why}">${verdict}</p>`;
}

const RADAR_STATUS = {
  working: (r) => {
    const t = radarTarget(r);
    return `Scanning the land round ${t.cx * CHUNK + CHUNK / 2}, ${t.cy * CHUNK + CHUNK / 2}`;
  },
  "no-power": () => "Stopped: no power.",
  done: () => `Done: everything within ${RANGE * CHUNK} tiles is on the map.`,
};

// A sorter's ways out, in the order its panel lists them, and what each filter means.
const WAYS = [
  [1, "Left"],
  [0, "Front"],
  [2, "Right"],
];
const filterText = (f) =>
  f === "any" ? "<span>Any item</span>" : f === "overflow" ? "<span>Overflow</span>" : `${itemIcon(f)}<span>${ITEMS[f].name}</span>`;
const SORTER_STATUS = {
  working: () => "Sorting",
  waiting: (s) => `Waiting: the ways out that take ${lower(s.items[0]?.item || "iron-ore", 2)} are full.`,
  "no-exit": (s) => `Stuck: no way out takes ${lower(s.items[0]?.item || "iron-ore", 2)}. Set one to it, to Any, or to Overflow.`,
};
const sorterStatus = (s) => (s.status !== "working" && s.items[0] && s.items[0].exit === undefined ? s.status : "working");

// Distance between an underground end and its partner.
const span = (e, p) => Math.abs(p.x - e.x) + Math.abs(p.y - e.y);

// "2 iron plates → 1 iron gear, every 2 s"
const recipeText = (id) => {
  const r = RECIPES[id];
  return `${describe(r.in)} → ${describe({ [id]: r.n })}, every ${+(r.time / TICK_RATE).toFixed(2)} s`;
};

// How many a button moves: one, ten, half of what's there (rounded up) or all of
// it, as far as there's room. Remembered for the next panel and the next game.
const AMOUNTS = [
  ["1", "1"],
  ["10", "10"],
  ["half", "Half"],
  ["all", "All"],
];
const AMOUNT_KEY = "factory:amount";
let amount = "all";
const loadAmount = () => {
  try {
    const saved = localStorage.getItem(AMOUNT_KEY);
    if (AMOUNTS.some(([k]) => k === saved)) amount = saved;
  } catch {}
};
const setAmount = (k) => {
  amount = k;
  try {
    localStorage.setItem(AMOUNT_KEY, k);
  } catch {}
};
// How many of `have` to move with the amount picked.
const pick = (have) => Math.min(have, amount === "1" ? 1 : amount === "10" ? 10 : amount === "half" ? Math.ceil(have / 2) : have);

const amountBar = () =>
  `<div class="segmented amount" role="group" aria-label="How many each button moves">${AMOUNTS.map(
    ([k, label]) => `<button data-action="amount" data-value="${k}" aria-pressed="${k === amount}">${label}</button>`,
  ).join("")}</div>`;

// Buttons that add each of `ids` from the inventory: the amount picked of what the
// player has, as far as it fits (`room`).
const addButtons = (ids, inv, room, verb = "Add") =>
  ids
    .map((id) => [id, Math.min(room(id), pick(count(inv, id)))])
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `<button data-action="fill" data-item="${id}" data-n="${n}">${itemIcon(id)}${verb} ${n} ${lower(id, n)}</button>`)
    .join("");

// A Take button for `have` of `item`, taking the amount picked; `attrs` say where from.
const takeButton = (item, have, attrs) => {
  const n = pick(have);
  return `<button class="take" data-action="empty" ${attrs} data-n="${n}" aria-label="Take ${n} ${lower(item, n)}">Take ${n}</button>`;
};

// Every panel starts with its title and, under it, the building's health while
// it's damaged (a [data-live] part, see healthLine).
const heading = (title) =>
  `<h3>${title}<button class="close" data-action="close" aria-label="Close">${icon("close")}</button></h3><div data-live="health"></div>`;

// A damaged building's health, and whether it's mending.
function healthLine(e, world) {
  const d = world.damaged.get(e.id);
  if (!d) return "";
  const max = maxHealth(e.type);
  const mending = world.tick - d.hit >= REPAIR_AFTER;
  return `<p class="meta hp">Health ${d.hp} / ${max}${mending ? ", repairing itself" : `: under attack. It repairs itself ${REPAIR_AFTER / TICK_RATE} s after the last hit`}</p>`;
}

// A machine's slot, with a button to take back what's in it (`take` holds the
// attribute saying which slot or item; the output has its own big button instead).
const slotRow = (label, s, take) =>
  `<li><em>${label}</em>${
    s ? `${itemIcon(s.item)}<span>${itemName(s.item, s.n)}</span><b>${s.n}</b>` + (take ? takeButton(s.item, s.n, take) : "") : `<span class="empty">Empty</span>`
  }</li>`;

const takeOutput = (out) => {
  if (!out) return `<button class="wide" data-action="empty" data-slot="output" disabled>Nothing made yet</button>`;
  const n = pick(out.n);
  return `<button class="wide" data-action="empty" data-slot="output" data-n="${n}">Take ${n} ${lower(out.item, n)}</button>`;
};

// Each panel: the key its markup depends on, the markup, and the progress bar's fill.
// `view` is the panel's own state: `picking` while choosing an assembler's recipe,
// `exit` (0 front, 1 left, 2 right) while choosing a sorter's filter.
const PANELS = {
  // What it holds, each with a Take button, and buttons to put in what the player carries.
  chest: {
    key: (c, world) => `${c.inventory.version} ${world.inventory.version}`,
    html: (c, world) => {
      const n = total(c.inventory);
      const rows = Object.keys(ITEMS)
        .filter((id) => count(c.inventory, id) > 0)
        .map((id) => {
          const k = count(c.inventory, id);
          return `<li>${itemIcon(id)}<span>${itemName(id, k)}</span><b>${k}</b>${takeButton(id, k, `data-item="${id}"`)}</li>`;
        })
        .join("");
      const adds = addButtons(Object.keys(ITEMS), world.inventory, () => chestRoom(c));
      return `${heading("Chest")}
        <p class="meta">${n} / ${BUILDINGS.chest.capacity} items</p>
        ${amountBar()}
        <ul class="items slots">${rows || `<li class="empty">Empty</li>`}</ul>
        ${adds ? `<div class="actions">${adds}</div>` : ""}
        <button class="wide" data-action="take"${n ? "" : " disabled"}>Take all</button>`;
    },
  },
  miner: {
    key: (m, world) => `${m.status} ${m.item} ${oreLeftUnder(world, m)}`,
    html: (m, world) => `${heading("Miner")}
      <p class="status" data-status="${m.status}">${MINER_STATUS[m.status](m)}</p>
      <p class="meta">Ore left under it: ${oreLeftUnder(world, m)}</p>
      <span class="bar"><i></i></span>
      <div data-live="power"></div>
      <div data-live="activity"></div>`,
    progress: (m) => m.progress / BUILDINGS.miner.period,
    live: (m, world) => ({ power: powerLine(m, world), activity: activityLine(world, m) + pollutionLine(world, m) }),
  },
  // The player can add ore and fuel from the inventory, take them back, and take what it made.
  furnace: {
    key: (f, world) => `${f.status} ${JSON.stringify([f.input, f.fuel, f.output, f.smelting])} ${world.inventory.version}`,
    html: (f, world) => {
      const adds = addButtons([...Object.keys(FUEL), ...Object.keys(SMELTING)], world.inventory, (id) => furnaceRoom(f, id));
      return `${heading("Furnace")}
        <p class="status" data-status="${f.status}">${FURNACE_STATUS[f.status](f)}</p>
        <span class="bar"><i></i></span>
        <div data-live="activity"></div>
        ${amountBar()}
        <ul class="items slots">${slotRow("Ore", f.input, `data-slot="input"`)}${slotRow("Fuel", f.fuel, `data-slot="fuel"`)}${slotRow("Made", f.output)}</ul>
        ${adds ? `<div class="actions">${adds}</div>` : ""}
        ${takeOutput(f.output)}`;
    },
    progress: (f) => (f.smelting ? f.progress / SMELTING[f.smelting].time : 0),
    live: (f, world) => ({ activity: activityLine(world, f) + pollutionLine(world, f) }),
  },
  // Without a recipe (or when changing it) the panel is a recipe picker. Then it
  // works like a furnace's: add ingredients, take them back, take what it made.
  assembler: {
    key: (a, world, view) =>
      `${view.picking} ${a.status} ${a.recipe} ${JSON.stringify([a.inputs, a.output])} ${world.inventory.version}`,
    html: (a, world, view) => {
      if (!a.recipe || view.picking) {
        const choices = Object.keys(RECIPES)
          .filter((id) => recipeUnlocked(world, id))
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
        <div data-live="power"></div>
        <div data-live="activity"></div>
        <div class="makes">${itemIcon(a.recipe)}<span>${recipeText(a.recipe)}</span><button class="take" data-action="pick">Change</button></div>
        ${amountBar()}
        <ul class="items slots">${ins}${slotRow("Made", a.output)}</ul>
        ${adds ? `<div class="actions">${adds}</div>` : ""}
        ${takeOutput(a.output)}`;
    },
    progress: (a) => (a.crafting ? a.progress / RECIPES[a.recipe].time : 0),
    live: (a, world) => ({ power: powerLine(a, world), activity: activityLine(world, a) + pollutionLine(world, a) }),
  },
  inserter: {
    key: (e) => `${e.status} ${e.hand}`,
    html: (e) => `${heading("Inserter")}
      <p class="status" data-status="${e.status}">${INSERTER_STATUS[e.status](e)}</p>
      <div data-live="power"></div>
      <p class="meta">It takes from the building behind it and drops into the one in front (the arrow points that way), one item at a time and only what that building can use.</p>`,
    live: (e, world) => ({ power: powerLine(e, world) }),
  },
  // Fuel in and out like a furnace's, and the network it powers.
  generator: {
    key: (g, world) => `${g.status} ${JSON.stringify(g.fuel)} ${world.inventory.version}`,
    html: (g, world) => {
      const adds = addButtons(Object.keys(FUEL_ENERGY), world.inventory, (id) => generatorRoom(g, id));
      const secs = +(FUEL_ENERGY.coal / BUILDINGS.generator.power / TICK_RATE).toFixed(1);
      return `${heading("Coal generator")}
        <p class="status" data-status="${g.status}">${GENERATOR_STATUS[g.status](g)}</p>
        ${amountBar()}
        <ul class="items slots">${slotRow("Fuel", g.fuel, `data-slot="fuel"`)}</ul>
        ${adds ? `<div class="actions">${adds}</div>` : ""}
        <p class="meta">Makes up to ${kW(BUILDINGS.generator.power)} kW, and only burns what's used: a coal lasts ${secs} s at full power.</p>
        <p class="meta">Pollution: ${emission("generator")} a minute at full power, given off as it lights each coal.</p>
        <h3>Its network</h3>
        <div data-live="net"></div>`;
    },
    live: (g, world) => ({ net: networkSummary(powerNetwork(world).netOf.get(g)) }),
  },
  underground: {
    key: (e, world) => `${e.end} ${e.pair} ${e.end === "in" ? buried(e).length : 0}`,
    html: (e, world) => {
      const p = e.pair && world.entities.get(e.pair);
      let text;
      if (e.end === "in") {
        text = p
          ? `Takes items under to its exit, ${span(e, p)} tiles ahead. ${buried(e).length} underground now.`
          : `No exit yet. Pick Underground belt and tap this entrance, then tap one of the lit tiles ahead of it (up to ${REACH}).`;
      } else {
        text = p
          ? `Brings items up from its entrance, ${span(e, p)} tiles behind.`
          : `Its entrance is gone. An entrance built up to ${REACH} tiles behind it, facing the same way, pairs with it.`;
      }
      return `${heading(e.end === "in" ? "Underground entrance" : "Underground exit")}
        <p class="status" data-status="${p ? "working" : "no-output"}">${text}</p>
        <p class="meta">Removing either end gives back what's underground.</p>`;
    },
  },
  splitter: {
    key: () => "",
    html: () => `${heading("Splitter")}
      <p class="meta">Sends items out front, left and right in turn. A way out with nothing on it, or no room, is skipped, so with two belts on it, it splits half and half.</p>`,
  },
  // Each way out's filter, with a picker for it: any item, one kind, or overflow.
  sorter: {
    key: (s, world, view) => {
      const exits = beltNetwork(world).exits.get(s) || [];
      return `${view.exit} ${s.filters.join()} ${sorterStatus(s)} ${s.items[0]?.item} ${exits.map((l) => !!l).join()}`;
    },
    html: (s, world, view) => {
      if (view.exit !== null) {
        const name = WAYS.find(([i]) => i === view.exit)[1].toLowerCase();
        const opts = ["any", "overflow", ...Object.keys(ITEMS)]
          .map((f) => `<button class="recipe-pick" data-action="filter" data-value="${f}" aria-pressed="${s.filters[view.exit] === f}">${filterText(f)}</button>`)
          .join("");
        return `${heading("Sorter")}
          <p>What goes out the ${name}? Overflow takes what no other way wants, or has room for.</p>
          <div class="recipe-picks filters">${opts}</div>
          <button class="wide secondary" data-action="filter-keep">Keep it as it is</button>`;
      }
      const exits = beltNetwork(world).exits.get(s) || [];
      const rows = WAYS.map(
        ([i, label]) => `<li><em>${label}</em>${filterText(s.filters[i])}${exits[i] ? "" : `<small>nothing there</small>`}
          <button class="take" data-action="filter-pick" data-exit="${i}">Set</button></li>`,
      ).join("");
      const st = sorterStatus(s);
      return `${heading("Sorter")}
        <p class="status" data-status="${st}">${SORTER_STATUS[st](s)}</p>
        <ul class="items slots">${rows}</ul>
        <p class="meta">An item goes out the ways set to it, or if there are none, those set to Any; if they're full, it takes the overflow.</p>`;
    },
  },
  // The milestone under way: what it needs and what's been delivered, buttons to
  // deliver from the inventory, what it unlocks, and the milestones in order.
  hub: {
    key: (h, world) => `${world.progress.milestone} ${JSON.stringify(world.progress.delivered)} ${world.inventory.version}`,
    html: (h, world) => {
      const { milestone, delivered } = world.progress;
      const m = currentMilestone(world);
      const list = MILESTONES.map(
        (x, i) => `<li data-state="${i < milestone ? "done" : i === milestone ? "now" : "later"}">${i < milestone ? "✓" : i + 1}. ${x.name}</li>`,
      ).join("");
      if (!m) {
        return `${heading("HUB")}
          <p class="status" data-status="working">Every milestone is done: you've automated circuits.</p>
          <ol class="milestones">${list}</ol>`;
      }
      const needs = Object.entries(m.needs)
        .map(([id, n]) => {
          const d = delivered[id] || 0;
          return `<li>${itemIcon(id)}<span>${itemName(id, n)}<span class="bar"><i style="width: ${(d / n) * 100}%"></i></span></span><b>${d} / ${n}</b></li>`;
        })
        .join("");
      const adds = addButtons(Object.keys(m.needs), world.inventory, (id) => stillNeeded(world.progress, id), "Deliver");
      const unlocks = unlocksText(m);
      return `${heading("HUB")}
        <p class="meta">Milestone ${milestone + 1} of ${MILESTONES.length}</p>
        <p><b>${m.name}</b>: ${m.about}</p>
        <ul class="items needs">${needs}</ul>
        ${adds ? `${amountBar()}<div class="actions">${adds}</div><button class="wide" data-action="deliver">Deliver all I can</button>` : ""}
        <p class="meta">${unlocks ? `Unlocks ${unlocks}.` : "The last milestone."} Belts and inserters can deliver here too; it only takes what the milestone still needs.</p>
        <ol class="milestones">${list}</ol>`;
    },
  },
  // What it's scanning, how much of its range is charted, and its power.
  radar: {
    key: (r, world) => `${r.status} ${r.next} ${world.chartVersion}`,
    html: (r, world) => {
      const { charted, total } = radarCoverage(world, r);
      const secs = +(SCAN / TICK_RATE).toFixed(1);
      return `${heading("Radar")}
        <p class="status" data-status="${r.status}">${RADAR_STATUS[r.status](r)}</p>
        <span class="bar"><i></i></span>
        <div data-live="power"></div>
        <p class="meta">${charted} of the ${total} chunks in its range are on the map. It scans the nearest first, ${secs} s each at full power, out to ${RANGE * CHUNK} tiles. Zoom far out to see the map.</p>`;
    },
    progress: (r) => r.progress / SCAN,
    live: (r, world) => ({ power: powerLine(r, world) }),
  },
  pole: {
    key: () => "",
    html: () => `${heading("Power pole")}
      <div data-live="net"></div>
      <p class="meta">It powers machines within ${AREA} tiles and wires itself to poles up to ${BUILDINGS.pole.reach} tiles away; wired poles make one network. A generator has to be near a pole too.</p>`,
    live: (p, world) => ({ net: networkSummary(powerNetwork(world).netOf.get(p)) }),
  },
};

// `close` is called when the panel should go (its ✕, or the building is gone);
// `changed` after items moved between the building and the player.
export function createEntityPanel(el, { close, changed, toast }) {
  loadAmount();
  let shown = null;
  let shownKey = "";
  let world = null;
  const view = { picking: false, exit: null };
  const live = new WeakMap(); // [data-live] part → the markup it shows

  const sync = (w) => {
    world = w;
    if (!shown) return;
    if (!world.entities.has(shown.id)) return close();
    const panel = PANELS[shown.type];
    const key = `${shown.type} ${amount} ${panel.key(shown, world, view)}`;
    if (key !== shownKey) {
      shownKey = key;
      el.innerHTML = panel.html(shown, world, view);
    }
    const bar = el.querySelector(".bar i");
    if (panel.progress && bar) bar.style.width = `${panel.progress(shown) * 100}%`;
    for (const [name, html] of Object.entries({ health: healthLine(shown, world), ...panel.live?.(shown, world) })) {
      const part = el.querySelector(`[data-live="${name}"]`);
      if (part && live.get(part) !== html) {
        live.set(part, html);
        part.innerHTML = html;
      }
    }
  };

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    const action = btn?.dataset.action;
    if (action === "close") return close();
    if (!shown || !world) return;
    const inv = world.inventory;
    const asm = shown.type === "assembler";
    const gen = shown.type === "generator";
    const hub = shown.type === "hub";
    const chest = shown.type === "chest";
    const max = btn?.dataset.n ? Number(btn.dataset.n) : Infinity; // what the button said it moves
    let moved = null;
    if (action === "amount") setAmount(btn.dataset.value);
    else if (action === "take" && shown.inventory) moved = takeAll(world, shown);
    else if (action === "empty") {
      const item = btn.dataset.item;
      if (asm) moved = emptyAssembler(shown, inv, item ?? null, max);
      else if (gen) moved = emptyGenerator(shown, inv, max);
      else if (chest) moved = { [item]: takeFromChest(world, shown, item, max) };
      else moved = emptySlot(shown, btn.dataset.slot, inv, max);
    } else if (action === "fill") {
      const item = btn.dataset.item;
      let n;
      if (hub) n = deliverToHub(world, item, max);
      else if (asm) n = fillAssembler(shown, inv, item, max);
      else if (gen) n = fuelGenerator(shown, inv, item, max);
      else if (chest) n = putInChest(world, shown, item, max);
      else n = fillFrom(shown, inv, item, max);
      if (n) toast(`${hub ? "Delivered" : "Added"} ${describe({ [item]: n })}`);
    } else if (action === "deliver") {
      const moved = deliverAllToHub(world);
      if (Object.keys(moved).length) toast(`Delivered ${describe(moved)}`);
    } else if (action === "recipe") {
      view.picking = false;
      if (btn.dataset.recipe !== shown.recipe) {
        const back = setRecipe(shown, btn.dataset.recipe, inv);
        if (Object.keys(back).length) toast(`Got back ${describe(back)}`);
      }
    } else if (action === "pick" || action === "keep") view.picking = action === "pick";
    else if (action === "filter-pick") view.exit = Number(btn.dataset.exit);
    else if (action === "filter") {
      setFilter(shown, view.exit, btn.dataset.value);
      view.exit = null;
    } else if (action === "filter-keep") view.exit = null;
    else return;
    if (moved && Object.values(moved).some((n) => n > 0)) toast(`Took ${describe(moved)}`);
    sync(world);
    changed();
  });

  return {
    // Shows entity e's panel, or hides it for null or a building without one.
    show(e, w) {
      shown = e && PANELS[e.type] ? e : null;
      shownKey = "";
      view.picking = false;
      view.exit = null;
      el.hidden = !shown;
      if (shown) sync(w);
    },
    sync,
  };
}
