import "./style.css";
import { createGame } from "./game.js";
import { TICK_RATE, MINE_TICKS } from "./sim/world.js";
import { parseSeed } from "./sim/rng.js";
import { BUILDINGS } from "./sim/buildings.js";
import { ITEMS, describe, itemName } from "./sim/items.js";
import { count, affordable, total } from "./sim/inventory.js";
import { takeAll, oreLeftUnder } from "./sim/world.js";
import { SMELTING, FUEL } from "./sim/recipes.js";
import { fillFrom, emptySlot, furnaceRoom } from "./sim/furnace.js";
import { serialize, deserialize } from "./sim/save.js";
import { readSave, writeSave } from "./storage.js";
import { getTheme, getThemePref, setThemePref, onThemeChange } from "./theme.js";
import { fullscreenSupported, isFullscreen, toggleFullscreen, onFullscreenChange } from "./fullscreen.js";

const view = document.getElementById("view");
let cleanup = null;

const routes = {
  "/": home,
  "/play": play,
  "/help": help,
};

function navigate(path) {
  if (path !== location.pathname) history.pushState(null, "", path);
  render();
}

function render() {
  cleanup?.();
  cleanup = null;
  const page = routes[location.pathname] || notFound;
  document.body.classList.toggle("playing", page === play);
  view.innerHTML = "";
  cleanup = page(view) || null;
  for (const a of document.querySelectorAll("#nav a")) {
    a.classList.toggle("active", a.getAttribute("href") === location.pathname);
  }
}

document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-link]");
  if (!link) return;
  e.preventDefault();
  navigate(link.getAttribute("href"));
});
window.addEventListener("popstate", render);

function html(el, markup) {
  el.innerHTML = markup;
  return (sel) => el.querySelector(sel);
}

// Keeps every fullscreen button's label in sync, whichever page it's on.
function bindFullscreenButton(btn) {
  if (!fullscreenSupported) {
    btn.hidden = true;
    return () => {};
  }
  const sync = () => {
    const on = isFullscreen();
    btn.dataset.on = on;
    btn.setAttribute("aria-label", on ? "Exit fullscreen" : "Go fullscreen");
    if (!btn.classList.contains("icon-btn")) btn.textContent = on ? "Exit fullscreen" : "Go fullscreen";
  };
  btn.addEventListener("click", toggleFullscreen);
  sync();
  return onFullscreenChange(sync);
}

const THEME_PICKER = `<div class="segmented" id="theme" role="group" aria-label="Theme">
  <button data-pref="auto">Auto</button><button data-pref="light">☀ Light</button><button data-pref="dark">☾ Dark</button>
</div>`;

// Auto / Light / Dark picker; the choice is saved and shared by every page.
function bindThemePicker(group) {
  const sync = () => {
    const pref = getThemePref();
    for (const b of group.querySelectorAll("[data-pref]")) b.setAttribute("aria-pressed", b.dataset.pref === pref);
  };
  group.addEventListener("click", (e) => {
    const pref = e.target.closest("[data-pref]")?.dataset.pref;
    if (pref) setThemePref(pref);
  });
  sync();
  return onThemeChange(sync);
}

function home(el) {
  const $ = html(
    el,
    `<h1>Factory</h1>
    <p>Mine, smelt, build and automate. A factory game running in the browser.</p>
    <div class="cards">
      <a class="card" id="continue" href="/play" data-link hidden><b>Continue</b><span id="save-info"></span></a>
      <button class="card" id="new-game"><b>New game</b><span>A fresh map and a starter kit</span></button>
      <div class="card confirm" id="confirm" hidden>
        <b>Start a new game?</b>
        <span>Your saved factory will be replaced. This can't be undone.</span>
        <div class="row"><button class="danger" id="confirm-yes">Start new game</button><button id="confirm-no">Cancel</button></div>
      </div>
      <a class="card" href="/help" data-link><b>Help</b><span>Controls and tips</span></a>
    </div>
    <p class="hint" id="save-note" hidden></p>
    <h2>Theme</h2>
    ${THEME_PICKER}
    <p class="hint">Light mode is easier to see outdoors in bright sun.</p>
    <button id="fs" class="wide"></button>
    <p class="hint">Tip: <i>Add to Home screen</i> launches the game fullscreen every time.</p>`,
  );
  const unbindTheme = bindThemePicker($("#theme"));
  const unbindFs = bindFullscreenButton($("#fs"));

  // Continue shows once we know there's a save; with one, New game asks first.
  let hasSave = false;
  let gone = false;
  readSave().then(
    (record) => {
      if (gone || !record) return;
      hasSave = true;
      $("#continue").hidden = false;
      $("#save-info").textContent = `Played ${clock(record.tick)} · ${plural(record.buildings, "building")} · saved ${ago(record.savedAt)}`;
    },
    (err) => {
      if (gone) return;
      $("#save-note").hidden = false;
      $("#save-note").textContent = `Saving isn't available here (${err.message}), so a game won't be kept after you close it.`;
    },
  );
  const askNew = (on) => {
    $("#confirm").hidden = !on;
    $("#new-game").hidden = on;
  };
  $("#new-game").addEventListener("click", () => (hasSave ? askNew(true) : navigate("/play?new")));
  $("#confirm-no").addEventListener("click", () => askNew(false));
  $("#confirm-yes").addEventListener("click", () => navigate("/play?new"));

  return () => {
    gone = true;
    unbindTheme();
    unbindFs();
  };
}

// Ticks → "m:ss", or "h:mm:ss" past an hour.
function clock(ticks) {
  const s = Math.floor(ticks / TICK_RATE);
  const mmss = `${Math.floor(s / 60) % 60}:${String(s % 60).padStart(2, "0")}`;
  return s < 3600 ? mmss : `${Math.floor(s / 3600)}:${mmss.padStart(5, "0")}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// A past timestamp → "just now", "5 min ago", "3 h ago", "2 days ago".
function ago(time) {
  const min = Math.floor((Date.now() - time) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} h ago`;
  return `${plural(Math.floor(min / (60 * 24)), "day")} ago`;
}

const AUTOSAVE_MS = 30000;

// /play continues the saved game, or starts one if there's none. /play?new starts a
// new game (home asks first), and ?seed=… picks its map; /play?seed=… with a save
// asks which to play. Once a game is running the address goes back to plain /play,
// so reloading continues it.
function play(el) {
  const params = new URLSearchParams(location.search);
  const seedParam = params.get("seed");
  const $ = html(el, `<div class="game"><div class="overlay" id="loader"><p>Loading…</p></div></div>`);
  let stop = null;
  let gone = false;

  const start = (opts) => {
    history.replaceState(null, "", "/play");
    stop = playWorld(el, opts);
  };
  const startNew = () =>
    start({ seed: seedParam ? parseSeed(seedParam) : 1 + Math.floor(Math.random() * 999999), isNew: true });
  const load = (record) => {
    try {
      start({ world: deserialize(record.data) });
    } catch (err) {
      console.warn(err);
      ask("Couldn't load your game", `${err.message} Starting a new game replaces the save.`, [
        ["Start a new game", startNew],
        ["Back", () => navigate("/")],
      ]);
    }
  };
  // Replaces the loader with a question and a button for each answer.
  const ask = (title, text, answers) => {
    const box = $("#loader");
    box.innerHTML = `<h2></h2><p></p>${answers.map((_, i) => `<button class="big${i ? " secondary" : ""}" data-i="${i}"></button>`).join("")}`;
    box.querySelector("h2").textContent = title;
    box.querySelector("p").textContent = text;
    answers.forEach(([label, action], i) => {
      const btn = box.querySelector(`[data-i="${i}"]`);
      btn.textContent = label;
      btn.addEventListener("click", action);
    });
  };

  readSave()
    .catch(() => null) // no storage: play anyway, and the first save says it failed
    .then((record) => {
      if (gone) return;
      if (params.has("new") || !record) startNew();
      else if (seedParam) {
        ask("Start a new game?", `Seed ${seedParam} makes a new map, and your saved factory will be replaced.`, [
          ["Start new game", startNew],
          ["Continue saved game", () => load(record)],
        ]);
      } else load(record);
    });

  return () => {
    gone = true;
    stop?.();
  };
}

const TOOL_KEYS = { 1: "belt", 2: "miner", 3: "chest", 4: "furnace", 5: "inserter", x: "remove", q: null };

const itemSwatch = (id) => `<i class="swatch" style="background: var(--item-${id})"></i>`;
const lower = (id, n) => itemName(id, n).toLowerCase();
// A chip per item of a cost, marked short (with how many you have) when the inventory can't pay it.
const costChips = (cost, inv) =>
  Object.entries(cost)
    .map(([id, n]) => {
      const have = count(inv, id);
      const short = have < n;
      return `<span class="chip" data-short="${short}">${itemSwatch(id)}${n} ${lower(id, n)}${short ? ` <small>have ${have}</small>` : ""}</span>`;
    })
    .join("");
// A list row for each item an inventory holds, in the usual item order.
const itemRows = (inv) =>
  Object.keys(ITEMS)
    .filter((id) => count(inv, id) > 0)
    .map((id) => `<li>${itemSwatch(id)}<span>${ITEMS[id].name}</span><b>${count(inv, id)}</b></li>`)
    .join("");

// The game page itself, playing a loaded `world` or a new one from `seed`.
function playWorld(el, { world, seed, isNew = false }) {
  const $ = html(
    el,
    `<div class="game" id="game">
      <div class="hud">
        <a href="/" data-link class="icon-btn" aria-label="Back">
          <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>
        </a>
        <div class="score"><b id="clock">0:00</b><span id="status">Running</span></div>
        <button class="icon-btn" id="inv-toggle" aria-label="Inventory" aria-expanded="false">
          <svg viewBox="0 0 24 24"><path d="M5 8h14l-1.2 12H6.2zM9 8V6.5a3 3 0 0 1 6 0V8"/></svg>
        </button>
        <button class="icon-btn" id="theme-toggle">
          <svg viewBox="0 0 24 24" class="theme-light"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          <svg viewBox="0 0 24 24" class="theme-dark"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>
        </button>
        <button class="icon-btn" id="pause" aria-label="Pause">
          <svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>
        </button>
        <button class="icon-btn" id="fs">
          <svg viewBox="0 0 24 24" class="fs-enter"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>
          <svg viewBox="0 0 24 24" class="fs-exit"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>
        </button>
      </div>
      <div class="toolbar" id="toolbar">
        <button class="tool" data-tool="belt" aria-pressed="false">
          <svg viewBox="0 0 24 24"><path d="M3 7h18v10H3zM8 12h7M12 9l3 3-3 3"/></svg><span>Belt</span><b class="badge" data-badge="belt"></b>
        </button>
        <button class="tool" data-tool="miner" aria-pressed="false">
          <svg viewBox="0 0 24 24"><path d="M5 10h14v10H5zM9 10V5h6v5M12 14v3"/></svg><span>Miner</span><b class="badge" data-badge="miner"></b>
        </button>
        <button class="tool" data-tool="chest" aria-pressed="false">
          <svg viewBox="0 0 24 24"><path d="M4 10h16v9H4zM4 10l2-4h12l2 4M10 14h4"/></svg><span>Chest</span><b class="badge" data-badge="chest"></b>
        </button>
        <button class="tool" data-tool="furnace" aria-pressed="false">
          <svg viewBox="0 0 24 24"><path d="M4 20V9h16v11zM14 9V4h4v5M9 20v-4a3 3 0 0 1 6 0v4"/></svg><span>Furnace</span><b class="badge" data-badge="furnace"></b>
        </button>
        <button class="tool" data-tool="inserter" aria-pressed="false">
          <svg viewBox="0 0 24 24"><path d="M7 20h10M12 20v-5M12 15l-5-6M7 9l5-4M10 4l3 2"/></svg><span>Inserter</span><b class="badge" data-badge="inserter"></b>
        </button>
        <button class="tool danger" data-tool="remove" aria-pressed="false">
          <svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg><span>Remove</span>
        </button>
        <button class="tool" id="rotate" disabled>
          <svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2-4.9M19 4v4h-4"/></svg><span>Rotate</span>
        </button>
      </div>
      <div class="bottom-stack">
        <div class="toast" id="toast" hidden></div>
        <div class="mining" id="mining" hidden><span id="mining-label"></span><span class="bar"><i id="mining-bar"></i></span></div>
        <div class="cost-strip" id="cost-strip" hidden></div>
      </div>
      <div class="side">
        <div class="panel" id="entity" hidden></div>
        <div class="panel" id="inventory" hidden>
          <h3>Inventory</h3>
          <ul class="items" id="inv-items"></ul>
          <h3>Costs</h3>
          <ul class="items costs" id="inv-costs"></ul>
        </div>
      </div>
      <div class="debug" id="debug">
        <div id="dbg-perf">– fps · – ups</div>
        <div id="dbg-seed"></div>
        <div id="dbg-tile">Tap a tile</div>
      </div>
      <div class="overlay" id="overlay" hidden></div>
    </div>`,
  );

  // Debug overlay: the hovered tile (mouse) wins over the tapped one while it's there.
  let tapped = null;
  let hovered = null;
  const showTile = () => {
    const t = hovered || tapped;
    $("#dbg-tile").textContent = !t
      ? "Tap a tile"
      : `${t.x}, ${t.y} · ${t.oreName}${t.amount ? ` ×${t.amount}` : ""}${t.entity ? ` · ${BUILDINGS[t.entity.type].name}` : ""}`;
  };

  let toastTimer = 0;
  const toast = (text) => {
    const el = $("#toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 1800);
  };

  // The picked building's cost, just above the toolbar: each item it takes, in red
  // with what you have when you're short, and how many you can build.
  let tool = null;
  const syncCost = (inv) => {
    const b = BUILDINGS[tool];
    $("#cost-strip").hidden = !b;
    if (!b) return;
    const n = affordable(inv, b.cost);
    const can = n ? `you can build ${n > 99 ? "99+" : n}` : "you can't build one yet";
    $("#cost-strip").innerHTML = `<div><b>${b.name}</b> costs${tool === "belt" ? " (each)" : ""} · <span class="can" data-zero="${!n}">${can}</span></div>
      <div class="chips">${costChips(b.cost, inv)}</div>`;
  };

  // Toolbar mirrors the builder: the active tool is pressed, rotate only works for buildings.
  const syncTools = (state) => {
    tool = state.tool;
    for (const b of $("#toolbar").querySelectorAll("[data-tool]")) b.setAttribute("aria-pressed", b.dataset.tool === tool);
    $("#rotate").disabled = !BUILDINGS[tool];
    syncCost(game.world.inventory);
  };
  for (const btn of $("#toolbar").querySelectorAll("[data-tool]")) {
    const b = BUILDINGS[btn.dataset.tool];
    if (b) btn.title = `${b.name}: ${describe(b.cost)}`;
  }

  // Inventory panel, costs, toolbar badges (how many of each building you can
  // afford) and the cost strip. Redrawn only when the inventory changes.
  let shownInventory = -1;
  const syncInventory = (world) => {
    const inv = world.inventory;
    if (inv.version === shownInventory) return;
    shownInventory = inv.version;
    $("#inv-items").innerHTML = itemRows(inv) || `<li class="empty">Empty. Hold on an ore patch to mine it.</li>`;
    $("#inv-costs").innerHTML = Object.values(BUILDINGS)
      .map((b) => `<li><span>${b.name}</span><span class="chips">${costChips(b.cost, inv)}</span></li>`)
      .join("");
    for (const badge of $("#toolbar").querySelectorAll("[data-badge]")) {
      const n = affordable(inv, BUILDINGS[badge.dataset.badge].cost);
      badge.textContent = n > 99 ? "99+" : n;
      badge.dataset.zero = n === 0;
    }
    syncCost(inv);
  };

  const syncMining = (world) => {
    const m = world.mining;
    $("#mining").hidden = !m;
    if (!m) return;
    $("#mining-label").textContent = `Mining ${lower(m.item)} · ${count(world.inventory, m.item)}`;
    $("#mining-bar").style.width = `${(m.progress / MINE_TICKS) * 100}%`;
  };

  // Panel for the building tapped with no tool: what it holds and what it's doing.
  // Redrawn when what it shows changes (its key); progress bars move every tick.
  const entityPanel = $("#entity");
  let shown = null;
  let shownKey = "";
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
  const closeButton = `<button class="close" data-action="close" aria-label="Close">✕</button>`;
  // A furnace slot, with a button to take back what's in it (the output has its own big one).
  const slotRow = (label, s, slot) =>
    `<li><em>${label}</em>${
      s
        ? `${itemSwatch(s.item)}<span>${itemName(s.item, s.n)}</span><b>${s.n}</b>` +
          (slot ? `<button class="take" data-action="empty" data-slot="${slot}" aria-label="Take back ${lower(s.item, s.n)}">Take</button>` : "")
        : `<span class="empty">Empty</span>`
    }</li>`;
  const bar = (fraction) => ($("#entity-bar").style.width = `${fraction * 100}%`);

  // Each panel: the key its markup depends on, the markup, and what moves every tick.
  const PANELS = {
    chest: {
      key: (c) => c.inventory.version,
      html: (c) => {
        const n = total(c.inventory);
        return `<h3>Chest ${closeButton}</h3>
          <p class="meta">${n} / ${BUILDINGS.chest.capacity} items</p>
          <ul class="items">${itemRows(c.inventory) || `<li class="empty">Empty</li>`}</ul>
          <button class="wide" data-action="take"${n ? "" : " disabled"}>Take all</button>`;
      },
    },
    miner: {
      key: (m, world) => `${m.status} ${m.item} ${oreLeftUnder(world, m)}`,
      html: (m, world) => `<h3>Miner ${closeButton}</h3>
        <p class="status" data-status="${m.status}">${MINER_STATUS[m.status](m)}</p>
        <p class="meta">Ore left under it: ${oreLeftUnder(world, m)}</p>
        <span class="bar"><i id="entity-bar"></i></span>`,
      tick: (m) => bar(m.progress / BUILDINGS.miner.period),
    },
    // The player can add ore and fuel from the inventory, take them back, and take what it made.
    furnace: {
      key: (f, world) => `${f.status} ${JSON.stringify([f.input, f.fuel, f.output, f.smelting])} ${world.inventory.version}`,
      html: (f, world) => {
        const inv = world.inventory;
        const adds = [...Object.keys(FUEL), ...Object.keys(SMELTING)]
          .map((id) => [id, Math.min(count(inv, id), furnaceRoom(f, id))])
          .filter(([, n]) => n > 0)
          .map(([id, n]) => `<button data-action="fill" data-item="${id}">Add ${n} ${lower(id, n)}</button>`);
        const out = f.output;
        return `<h3>Furnace ${closeButton}</h3>
          <p class="status" data-status="${f.status}">${FURNACE_STATUS[f.status](f)}</p>
          <span class="bar"><i id="entity-bar"></i></span>
          <ul class="items slots">${slotRow("Ore", f.input, "input")}${slotRow("Fuel", f.fuel, "fuel")}${slotRow("Made", out)}</ul>
          ${adds.length ? `<div class="actions">${adds.join("")}</div>` : ""}
          <button class="wide" data-action="empty" data-slot="output"${out ? "" : " disabled"}>${out ? `Take ${out.n} ${lower(out.item, out.n)}` : "Nothing made yet"}</button>`;
      },
      tick: (f) => bar(f.smelting ? f.progress / SMELTING[f.smelting].time : 0),
    },
    inserter: {
      key: (e) => `${e.status} ${e.hand}`,
      html: (e) => `<h3>Inserter ${closeButton}</h3>
        <p class="status" data-status="${e.status}">${INSERTER_STATUS[e.status](e)}</p>
        <p class="meta">It takes from the building behind it and drops into the one in front (the arrow points that way), one item at a time and only what that building can use.</p>`,
    },
  };

  const syncEntity = (world) => {
    if (!shown) return;
    if (!world.entities.has(shown.id)) return game.builder.closeInspect();
    const panel = PANELS[shown.type];
    const key = `${shown.type} ${panel.key(shown, world)}`;
    if (key !== shownKey) {
      shownKey = key;
      entityPanel.innerHTML = panel.html(shown, world);
    }
    panel.tick?.(shown);
  };
  const showEntity = (e) => {
    shown = e && PANELS[e.type] ? e : null;
    shownKey = "";
    entityPanel.hidden = !shown;
    if (shown) syncEntity(game.world);
  };
  entityPanel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    const action = btn?.dataset.action;
    const world = game.world;
    if (action === "close") return game.builder.closeInspect();
    if (!shown) return;
    if (action === "take" && shown.inventory) {
      const moved = takeAll(world, shown);
      if (Object.keys(moved).length) toast(`Took ${describe(moved)}`);
    } else if (action === "empty") {
      const moved = emptySlot(shown, btn.dataset.slot, world.inventory);
      if (Object.keys(moved).length) toast(`Took ${describe(moved)}`);
    } else if (action === "fill") {
      const n = fillFrom(shown, world.inventory, btn.dataset.item);
      if (n) toast(`Added ${describe({ [btn.dataset.item]: n })}`);
    } else return;
    syncEntity(world);
    syncInventory(world);
  });

  const invPanel = $("#inventory");
  const toggleInventory = () => {
    invPanel.hidden = !invPanel.hidden;
    $("#inv-toggle").setAttribute("aria-expanded", !invPanel.hidden);
  };
  $("#inv-toggle").addEventListener("click", toggleInventory);

  // Game clock in the HUD: ticks → m:ss.
  let shownSeconds = -1;
  const game = createGame($("#game"), {
    theme: getTheme(),
    world,
    seed,
    onStats: ({ fps, ups }) => {
      $("#dbg-perf").textContent = `${Math.round(fps)} fps · ${Math.round(ups)} ups`;
    },
    onInspect: (t) => {
      tapped = t;
      showTile();
      showEntity(t?.entity);
    },
    onBuildChange: syncTools,
    onMessage: toast,
    onTileHover: (t) => {
      hovered = t;
      showTile();
    },
    onTick: (world) => {
      syncInventory(world);
      syncMining(world);
      syncEntity(world);
      const s = Math.floor(world.tick / TICK_RATE);
      if (s === shownSeconds) return;
      shownSeconds = s;
      $("#clock").textContent = clock(world.tick);
    },
  });

  syncInventory(game.world);
  $("#dbg-seed").textContent = `seed ${game.world.seed}`;

  $("#toolbar").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.id === "rotate") game.builder.rotate();
    else game.builder.setTool(btn.dataset.tool);
  });

  // The line under the clock: Running or Paused, or briefly "Saved".
  let statusTimer = 0;
  const showStatus = (flash) => {
    clearTimeout(statusTimer);
    $("#status").textContent = flash || (game.running ? "Running" : "Paused");
    if (flash) statusTimer = setTimeout(() => showStatus(), 1500);
  };

  const overlay = $("#overlay");
  const pause = () => {
    if (!game.running) return;
    game.pause();
    showStatus();
    overlay.innerHTML = `<h2>Paused</h2>
      <button class="big" data-action="resume">Resume</button>
      <button class="big secondary" data-action="quit">Save and quit</button>`;
    overlay.hidden = false;
  };
  const resume = () => {
    overlay.hidden = true;
    game.resume();
    showStatus();
  };
  overlay.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "resume") resume();
    if (action === "quit") navigate("/"); // leaving the page saves
  });

  // Autosave every AUTOSAVE_MS, when the app is hidden or the page closes, and on
  // leaving /play. Skipped when nothing has changed since the last save. A new game
  // is saved straight away, since it replaces the old save. A write can finish after
  // the page has gone, and then there's nothing left to tell.
  let savedKey = "";
  let saveFailed = false;
  let left = false;
  const save = () => {
    const w = game.world;
    const key = `${w.tick} ${w.version} ${w.inventory.version}`;
    if (key === savedKey) return;
    writeSave(serialize(w)).then(
      () => {
        savedKey = key;
        saveFailed = false;
        if (!left) showStatus("Saved");
      },
      (err) => {
        if (!saveFailed && !left) toast(`Couldn't save the game: ${err?.message || err}`);
        saveFailed = true;
      },
    );
  };
  if (isNew) save();
  const autosave = setInterval(save, AUTOSAVE_MS);
  window.addEventListener("pagehide", save);
  $("#pause").addEventListener("click", pause);
  const unbindFs = bindFullscreenButton($("#fs"));

  // HUD toggle flips between light and dark and saves it like the picker does.
  const themeBtn = $("#theme-toggle");
  const syncTheme = (theme) => {
    themeBtn.dataset.theme = theme;
    themeBtn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    game.setTheme(theme);
  };
  themeBtn.addEventListener("click", () => setThemePref(getTheme() === "dark" ? "light" : "dark"));
  syncTheme(getTheme());
  const unbindTheme = onThemeChange(syncTheme);

  const onKey = (e) => {
    const k = e.key.toLowerCase();
    if (k === "escape" && game.builder.tool && game.running) game.builder.setTool(null);
    else if (k === "p" || k === "escape") game.running ? pause() : resume();
    else if (!game.running) return;
    else if (TOOL_KEYS[k] !== undefined) game.builder.setTool(TOOL_KEYS[k]);
    else if (k === "r") BUILDINGS[game.builder.tool] && game.builder.rotate();
    else if (k === "i") toggleInventory();
    else if (k === "f") toggleFullscreen();
    else if (k === "t") setThemePref(getTheme() === "dark" ? "light" : "dark");
    else if (k === "`") $("#debug").hidden = !$("#debug").hidden;
    else return;
    e.preventDefault();
  };
  window.addEventListener("keydown", onKey);

  const onHidden = () => {
    if (!document.hidden) return;
    pause();
    save();
  };
  document.addEventListener("visibilitychange", onHidden);

  return () => {
    save();
    left = true;
    clearInterval(autosave);
    clearTimeout(toastTimer);
    clearTimeout(statusTimer);
    window.removeEventListener("pagehide", save);
    window.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onHidden);
    unbindFs();
    unbindTheme();
    game.dispose();
  };
}

function help(el) {
  const $ = html(
    el,
    `<h1>Help</h1>
    <h2>Controls</h2>
    <dl>
      <dt>Touch</dt><dd>Drag to move the map, pinch to zoom, tap a tile to inspect it.</dd>
      <dt>Mouse</dt><dd>Drag to move the map, scroll to zoom, click a tile to inspect it.</dd>
      <dt>Keyboard</dt><dd>Arrows / WASD move, + / − zoom, P / Esc pause, F fullscreen, T light/dark, \` debug overlay.</dd>
    </dl>
    <h2>Building</h2>
    <dl>
      <dt>Place</dt><dd>Pick a building in the toolbar. Touch: tap the map to put the ghost there, then tap the ghost to build it (tap elsewhere to move it). Mouse: the ghost follows the cursor, click to build. The ghost is green where it fits and red where it doesn't. Tap the tool again to put it away.</dd>
      <dt>Rotate</dt><dd>The Rotate button or R turns the next building.</dd>
      <dt>Belt lines</dt><dd>Touch: press and hold, then drag. Mouse: drag with the left button. The belts face the way you drag.</dd>
      <dt>Remove</dt><dd>Pick Remove. Touch: tap a building to mark it, then tap it again to remove it. Mouse: click a building. You get its full cost back.</dd>
      <dt>Moving around</dt><dd>A quick drag always moves the map, even with a tool picked. With a mouse, drag with the right button while laying belts.</dd>
      <dt>Keys</dt><dd>1 belt, 2 miner, 3 chest, 4 furnace, 5 inserter, X remove, R rotate, Q or Esc put the tool away.</dd>
    </dl>
    <h2>Items</h2>
    <dl>
      <dt>Mining</dt><dd>With no tool picked, press and hold on an ore patch (mouse: hold the left button still). Keep holding to keep mining, and slide to the next tile when one runs out.</dd>
      <dt>Costs</dt><dd>Buildings cost plates and stone. The number on each toolbar button is how many you can afford. Removing a building gives everything back.</dd>
      <dt>Machines</dt><dd>A miner on ore digs one item a second and drops it out of its chute (the yellow block on its front). Put a belt, chest or furnace there to catch it. A crossed-out rock means there's no ore under it; an amber sign means its output is blocked. Tap a building (no tool picked) to see inside; a chest's Take all moves everything into your inventory.</dd>
      <dt>Belts</dt><dd>Belts carry items the way their arrows point, round corners, and into a chest or furnace at the end. A belt that runs into the side of another adds its items to that line; a line only carries so much, and the rest waits. Removing a belt gives you what was on it.</dd>
      <dt>Furnaces</dt><dd>A furnace smelts iron ore into iron plates, copper ore into copper plates and stone into bricks (two stone each), about one a second, burning coal as it goes (one coal smelts 8). A crossed-out flame means it has something to smelt but no coal. Tap it (no tool picked) to add ore and coal from your inventory and take what it made. Belts, miners and inserters feed it too, but only a few at a time. Furnaces cost stone, so you can always build one and smelt your first plates by hand.</dd>
      <dt>Inserters</dt><dd>An inserter swings items from the building behind it into the one in front, the way its arrow points: off a belt into a furnace, out of a furnace onto a belt, chest to chest. It only picks up what the building in front can use, so one inserter can feed a furnace both ore and coal off a mixed belt. It only takes finished plates out of a furnace.</dd>
      <dt>Inventory</dt><dd>The bag button (or I) shows what you carry and what each building costs. You start with a small kit.</dd>
    </dl>
    <h2>Saving</h2>
    <dl>
      <dt>Autosave</dt><dd>The game saves itself every 30 seconds, when you switch apps and when you close the page. <i>Saved</i> flashes under the clock when it does. Pause → Save and quit goes back to the menu.</dd>
      <dt>Continue</dt><dd>The home page's Continue carries on where you left off. New game starts a fresh map and replaces the save, so it asks first. There's one save per browser.</dd>
    </dl>
    <h2>The map</h2>
    <p class="hint">Ore patches: iron is blue, copper orange, coal black and stone pale sand. There's one of each near the start.
    Add <code>?seed=42</code> (any number or word) to the /play address to start a new game on that map; the same seed always gives the same map.</p>
    <h2>Fullscreen</h2>
    <p class="hint" id="fs-note"></p>
    <button id="fs" class="wide"></button>
    <h2>Theme</h2>
    ${THEME_PICKER}`,
  );
  $("#fs-note").textContent = fullscreenSupported
    ? "Use the ⛶ button in the game, or the one below."
    : "This browser doesn't support the Fullscreen API (e.g. Safari on iPhone). Add the game to your Home screen instead.";
  const unbindTheme = bindThemePicker($("#theme"));
  const unbindFs = bindFullscreenButton($("#fs"));
  return () => {
    unbindTheme();
    unbindFs();
  };
}

function notFound(el) {
  html(el, `<h1>Not found</h1><p><a href="/" data-link>Go home</a></p>`);
}

render();
