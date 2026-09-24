import "./style.css";
import { createGame } from "./game.js";
import { TICK_RATE, MINE_TICKS } from "./sim/world.js";
import { parseSeed } from "./sim/rng.js";
import { BUILDINGS } from "./sim/buildings.js";
import { ITEMS, describe } from "./sim/items.js";
import { count, affordable, total } from "./sim/inventory.js";
import { takeAll, oreLeftUnder } from "./sim/world.js";
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
      <a class="card" href="/play" data-link><b>Play</b><span>Open the factory</span></a>
      <a class="card" href="/help" data-link><b>Help</b><span>Controls and tips</span></a>
    </div>
    <h2>Theme</h2>
    ${THEME_PICKER}
    <p class="hint">Light mode is easier to see outdoors in bright sun.</p>
    <button id="fs" class="wide"></button>
    <p class="hint">Tip: <i>Add to Home screen</i> launches the game fullscreen every time.</p>`,
  );
  const unbindTheme = bindThemePicker($("#theme"));
  const unbindFs = bindFullscreenButton($("#fs"));
  return () => {
    unbindTheme();
    unbindFs();
  };
}

const TOOL_KEYS = { 1: "belt", 2: "miner", 3: "chest", x: "remove", q: null };

const itemSwatch = (id) => `<i class="swatch" style="background: var(--item-${id})"></i>`;

function play(el) {
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
        <button class="tool danger" data-tool="remove" aria-pressed="false">
          <svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/></svg><span>Remove</span>
        </button>
        <button class="tool" id="rotate" disabled>
          <svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2-4.9M19 4v4h-4"/></svg><span>Rotate</span>
        </button>
      </div>
      <div class="toast" id="toast" hidden></div>
      <div class="mining" id="mining" hidden><span id="mining-label"></span><span class="bar"><i id="mining-bar"></i></span></div>
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

  // ?seed=42 (or any text) picks the map; without it every visit gets a new one.
  const seedParam = new URLSearchParams(location.search).get("seed");
  const seed = seedParam ? parseSeed(seedParam) : 1 + Math.floor(Math.random() * 999999);
  $("#dbg-seed").textContent = `seed ${seedParam ?? seed}`;

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

  // Toolbar mirrors the builder: the active tool is pressed, rotate only works for buildings.
  const syncTools = ({ tool }) => {
    for (const b of $("#toolbar").querySelectorAll("[data-tool]")) b.setAttribute("aria-pressed", b.dataset.tool === tool);
    $("#rotate").disabled = !BUILDINGS[tool];
  };

  // Inventory panel, toolbar badges (how many of each building you can afford) and
  // the mining readout. Redrawn only when the inventory changes.
  let shownInventory = -1;
  const syncInventory = (world) => {
    const inv = world.inventory;
    if (inv.version === shownInventory) return;
    shownInventory = inv.version;
    const rows = Object.keys(ITEMS)
      .filter((id) => count(inv, id) > 0)
      .map((id) => `<li>${itemSwatch(id)}<span>${ITEMS[id].name}</span><b>${count(inv, id)}</b></li>`);
    $("#inv-items").innerHTML = rows.join("") || `<li class="empty">Empty. Hold on an ore patch to mine it.</li>`;
    for (const badge of $("#toolbar").querySelectorAll("[data-badge]")) {
      const n = affordable(inv, BUILDINGS[badge.dataset.badge].cost);
      badge.textContent = n > 99 ? "99+" : n;
      badge.dataset.zero = n === 0;
    }
  };
  $("#inv-costs").innerHTML = Object.values(BUILDINGS)
    .map((b) => `<li><span>${b.name}</span><span class="cost">${describe(b.cost)}</span></li>`)
    .join("");

  const syncMining = (world) => {
    const m = world.mining;
    $("#mining").hidden = !m;
    if (!m) return;
    $("#mining-label").textContent = `Mining ${ITEMS[m.item].name.toLowerCase()} · ${count(world.inventory, m.item)}`;
    $("#mining-bar").style.width = `${(m.progress / MINE_TICKS) * 100}%`;
  };

  // Panel for the building tapped with no tool: a chest's contents, a miner's status.
  // Redrawn when what it shows changes; a miner's progress bar moves every tick.
  const entityPanel = $("#entity");
  let shown = null;
  let shownKey = "";
  const MINER_STATUS = {
    working: (m) => `Mining ${ITEMS[m.item].name.toLowerCase()}`,
    "no-resource": () => "Stopped: no ore under it. Miners have to sit on an ore patch.",
    "no-output": () => "Stopped: nothing in front of the chute takes the ore. Put a belt or chest there.",
    full: () => "Stopped: no room in front for the ore. Empty the chest or clear the belt.",
  };
  const closeButton = `<button class="close" data-action="close" aria-label="Close">✕</button>`;
  const syncEntity = (world) => {
    if (!shown) return;
    if (!world.entities.has(shown.id)) return game.builder.closeInspect();
    if (shown.type === "chest") {
      const inv = shown.inventory;
      const key = `chest ${inv.version}`;
      if (key === shownKey) return;
      shownKey = key;
      const n = total(inv);
      const rows = Object.keys(ITEMS)
        .filter((id) => count(inv, id) > 0)
        .map((id) => `<li>${itemSwatch(id)}<span>${ITEMS[id].name}</span><b>${count(inv, id)}</b></li>`);
      entityPanel.innerHTML = `<h3>Chest ${closeButton}</h3>
        <p class="meta">${n} / ${BUILDINGS.chest.capacity} items</p>
        <ul class="items">${rows.join("") || `<li class="empty">Empty</li>`}</ul>
        <button class="wide" data-action="take"${n ? "" : " disabled"}>Take all</button>`;
    } else {
      const key = `miner ${shown.status} ${shown.item} ${oreLeftUnder(world, shown)}`;
      if (key !== shownKey) {
        shownKey = key;
        entityPanel.innerHTML = `<h3>Miner ${closeButton}</h3>
          <p class="status" data-status="${shown.status}">${MINER_STATUS[shown.status](shown)}</p>
          <p class="meta">Ore left under it: ${oreLeftUnder(world, shown)}</p>
          <span class="bar"><i id="entity-bar"></i></span>`;
      }
      $("#entity-bar").style.width = `${(shown.progress / BUILDINGS.miner.period) * 100}%`;
    }
  };
  const showEntity = (e) => {
    shown = e?.type === "chest" || e?.type === "miner" ? e : null;
    shownKey = "";
    entityPanel.hidden = !shown;
    if (shown) syncEntity(game.world);
  };
  entityPanel.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "close") game.builder.closeInspect();
    if (action === "take" && shown?.inventory) {
      const moved = takeAll(game.world, shown);
      if (Object.keys(moved).length) toast(`Took ${describe(moved)}`);
      syncEntity(game.world);
      syncInventory(game.world);
    }
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
      $("#clock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    },
  });

  syncInventory(game.world);

  $("#toolbar").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.id === "rotate") game.builder.rotate();
    else game.builder.setTool(btn.dataset.tool);
  });

  const overlay = $("#overlay");
  const pause = () => {
    if (!game.running) return;
    game.pause();
    $("#status").textContent = "Paused";
    overlay.innerHTML = `<h2>Paused</h2><button class="big" data-action="resume">Resume</button>`;
    overlay.hidden = false;
  };
  const resume = () => {
    overlay.hidden = true;
    $("#status").textContent = "Running";
    game.resume();
  };
  overlay.addEventListener("click", (e) => {
    if (e.target.closest("[data-action]")?.dataset.action === "resume") resume();
  });
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

  const onHidden = () => document.hidden && pause();
  document.addEventListener("visibilitychange", onHidden);

  return () => {
    clearTimeout(toastTimer);
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
      <dt>Keys</dt><dd>1 belt, 2 miner, 3 chest, X remove, R rotate, Q or Esc put the tool away.</dd>
    </dl>
    <h2>Items</h2>
    <dl>
      <dt>Mining</dt><dd>With no tool picked, press and hold on an ore patch (mouse: hold the left button still). Keep holding to keep mining, and slide to the next tile when one runs out.</dd>
      <dt>Costs</dt><dd>Buildings cost items. The number on each toolbar button is how many you can afford. Removing a building gives everything back.</dd>
      <dt>Machines</dt><dd>A miner on ore digs one item a second and drops it out of its chute (the yellow block on its front). Put a belt or a chest there to catch it. A crossed-out rock means there's no ore under it; an amber sign means its output is blocked. Tap a chest or miner (no tool picked) to see inside; a chest's Take all moves everything into your inventory.</dd>
      <dt>Belts</dt><dd>Belts carry items the way their arrows point, round corners, and into a chest at the end. A belt that runs into the side of another adds its items to that line; a line only carries so much, and the rest waits. Removing a belt gives you what was on it.</dd>
      <dt>Inventory</dt><dd>The bag button (or I) shows what you carry and what each building costs. You start with a small kit.</dd>
    </dl>
    <h2>The map</h2>
    <p class="hint">Ore patches: iron is blue, copper orange, coal black and stone pale sand. There's one of each near the start.
    Add <code>?seed=42</code> (any number or word) to the /play address to get the same map every time.</p>
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
