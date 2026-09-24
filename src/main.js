import "./style.css";
import { createGame } from "./game.js";
import { TICK_RATE, MINE_TICKS } from "./sim/world.js";
import { parseSeed } from "./sim/rng.js";
import { BUILDINGS } from "./sim/buildings.js";
import { count } from "./sim/inventory.js";
import { serialize, deserialize } from "./sim/save.js";
import { readSave, writeSave } from "./storage.js";
import { getTheme, getThemePref, setThemePref, onThemeChange } from "./theme.js";
import { fullscreenSupported, isFullscreen, toggleFullscreen, onFullscreenChange } from "./fullscreen.js";
import { icon } from "./ui/icons.js";
import { lower } from "./ui/format.js";
import { BUILDING_KEYS } from "./ui/catalog.js";
import { createBuildMenu } from "./ui/build-menu.js";
import { createResources } from "./ui/resources.js";
import { createEntityPanel } from "./ui/panels.js";
import { createCrafting } from "./ui/crafting.js";
import { queueItems } from "./sim/crafting.js";
import { RECIPES } from "./sim/recipes.js";
import { describe } from "./sim/items.js";

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

const TOOL_KEYS = { ...BUILDING_KEYS, x: "remove", q: null };
const DEBUG_KEY = "factory:debug";

// The game page itself, playing a loaded `world` or a new one from `seed`.
//
// Top: Back, the clock and Pause, and under them the resource bar (tap it for the
// inventory). Bottom: the build controls (ui/build-menu.js), with toasts and
// readouts stacked above them. Right: panels for the tapped building and the
// inventory. Pause holds the settings: theme, fullscreen, debug info.
function playWorld(el, { world, seed, isNew = false }) {
  const $ = html(
    el,
    `<div class="game" id="game">
      <div class="top">
        <div class="hud">
          <a href="/" data-link class="icon-btn" aria-label="Back">${icon("back")}</a>
          <div class="score"><b id="clock">0:00</b><span id="status">Running</span></div>
          <button class="icon-btn" id="pause" aria-label="Pause (P)">${icon("pause")}</button>
        </div>
        <div class="resources" id="resources" role="button" tabindex="0" aria-label="Inventory (I)" aria-expanded="false"></div>
      </div>
      <div class="buildbar" id="buildbar"></div>
      <div class="side">
        <div class="panel" id="entity" hidden></div>
        <div class="panel" id="inventory" hidden>
          <h3>Inventory<button class="close" data-action="close" aria-label="Close">${icon("close")}</button></h3>
          <ul class="items"></ul>
          <h3>Craft by hand</h3>
          <div id="craft"></div>
        </div>
      </div>
      <div class="bottom-stack">
        <div class="toast" id="toast" hidden></div>
        <div class="mining" id="mining" hidden><span id="mining-label"></span><span class="bar"><i id="mining-bar"></i></span></div>
        <div class="mining" id="crafting" hidden><span></span><span class="bar"><i></i></span></div>
        <div class="toolinfo" id="toolinfo" hidden></div>
      </div>
      <div class="debug" id="debug" hidden>
        <div id="dbg-perf">– fps · – ups</div>
        <div id="dbg-seed"></div>
        <div id="dbg-tile">Tap a tile</div>
      </div>
      <div class="sheet" id="sheet" hidden></div>
      <div class="overlay" id="overlay" hidden>
        <h2>Paused</h2>
        <button class="big" data-action="resume">Resume</button>
        <div class="settings">
          <button data-action="theme" id="theme-toggle"></button>
          <button id="fs"></button>
          <button data-action="debug" id="debug-toggle"></button>
        </div>
        <button class="big secondary" data-action="quit">Save and quit</button>
      </div>
    </div>`,
  );

  // Debug readout (off unless switched on in the pause menu, or with `): FPS/UPS,
  // the seed, and the hovered tile (mouse), else the tapped one.
  let tapped = null;
  let hovered = null;
  const showTile = () => {
    const t = hovered || tapped;
    $("#dbg-tile").textContent = !t
      ? "Tap a tile"
      : `${t.x}, ${t.y} · ${t.oreName}${t.amount ? ` ×${t.amount}` : ""}${t.entity ? ` · ${BUILDINGS[t.entity.type].name}` : ""}`;
  };
  const setDebug = (on) => {
    $("#debug").hidden = !on;
    $("#debug-toggle").textContent = on ? "Hide debug info" : "Show debug info";
    try {
      localStorage.setItem(DEBUG_KEY, on ? "1" : "0");
    } catch {}
  };
  let debugOn = false;
  try {
    debugOn = localStorage.getItem(DEBUG_KEY) === "1";
  } catch {}
  setDebug(debugOn);

  let toastTimer = 0;
  const toast = (text) => {
    const el = $("#toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 1800);
  };

  // Everything that shows the player's inventory, redrawn when it changes.
  const resources = createResources($("#resources"), $("#inventory"));
  let menu = null;
  const syncInventory = (world) => {
    resources.sync(world.inventory);
    menu?.sync(world.inventory);
  };
  const invPanel = $("#inventory");
  const toggleInventory = () => {
    invPanel.hidden = !invPanel.hidden;
    $("#resources").setAttribute("aria-expanded", !invPanel.hidden);
  };
  $("#resources").addEventListener("click", toggleInventory);
  $("#resources").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleInventory();
    }
  });
  invPanel.addEventListener("click", (e) => e.target.closest("[data-action=close]") && toggleInventory());

  const syncMining = (world) => {
    const m = world.mining;
    $("#mining").hidden = !m;
    if (!m) return;
    $("#mining-label").textContent = `Mining ${lower(m.item)} · ${count(world.inventory, m.item)}`;
    $("#mining-bar").style.width = `${(m.progress / MINE_TICKS) * 100}%`;
  };

  // The crafting readout is left out while the inventory's own queue is showing.
  const crafting = createCrafting($("#craft"), $("#crafting"), { toast, showReadout: () => $("#inventory").hidden });

  const entityPanel = createEntityPanel($("#entity"), {
    close: () => game.builder.closeInspect(),
    changed: () => syncInventory(game.world),
    toast,
  });

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
      entityPanel.show(t?.entity, game.world);
    },
    onBuildChange: (state) => menu?.syncTool(state),
    onMessage: toast,
    onTileHover: (t) => {
      hovered = t;
      showTile();
    },
    onTick: (world) => {
      syncInventory(world);
      syncMining(world);
      crafting.sync(world);
      entityPanel.sync(world);
      const s = Math.floor(world.tick / TICK_RATE);
      if (s === shownSeconds) return;
      shownSeconds = s;
      $("#clock").textContent = clock(world.tick);
    },
  });

  // The build bar's Craft button: hand-craft the parts a building is missing.
  const craftParts = (cost) => {
    const { steps, missing } = queueItems(game.world, cost);
    if (missing) toast(`Can't craft that: missing ${describe(missing)}`);
    else toast(`Crafting ${describe(Object.fromEntries(steps.map((s) => [s.recipe, s.n * RECIPES[s.recipe].n])))}`);
    crafting.sync(game.world);
  };
  menu = createBuildMenu({ bar: $("#buildbar"), info: $("#toolinfo"), sheet: $("#sheet") }, game.builder, { craft: craftParts });
  syncInventory(game.world);
  crafting.sync(game.world);
  $("#dbg-seed").textContent = `seed ${game.world.seed}`;

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
    menu.close();
    showStatus();
    overlay.hidden = false;
  };
  const resume = () => {
    overlay.hidden = true;
    game.resume();
    showStatus();
  };
  const toggleTheme = () => setThemePref(getTheme() === "dark" ? "light" : "dark");
  overlay.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "resume") resume();
    if (action === "quit") navigate("/"); // leaving the page saves
    if (action === "theme") toggleTheme();
    if (action === "debug") setDebug($("#debug").hidden);
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

  // The pause menu's theme button offers the other theme; T flips it too.
  const syncTheme = (theme) => {
    $("#theme-toggle").textContent = theme === "dark" ? "☀ Light mode" : "☾ Dark mode";
    game.setTheme(theme);
  };
  syncTheme(getTheme());
  const unbindTheme = onThemeChange(syncTheme);

  const onKey = (e) => {
    const k = e.key.toLowerCase();
    if (k === "escape" && game.running && menu.isOpen) menu.close();
    else if (k === "escape" && game.builder.tool && game.running) game.builder.setTool(null);
    else if (k === "p" || k === "escape") game.running ? pause() : resume();
    else if (!game.running) return;
    else if (TOOL_KEYS[k] !== undefined) game.builder.setTool(TOOL_KEYS[k]);
    else if (k === "b") menu.toggle();
    else if (k === "r") BUILDINGS[game.builder.tool] && game.builder.rotate();
    else if (k === "i") toggleInventory();
    else if (k === "f") toggleFullscreen();
    else if (k === "t") toggleTheme();
    else if (k === "`") setDebug($("#debug").hidden);
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
      <dt>Keyboard</dt><dd>Arrows / WASD move, + / − zoom, P / Esc pause, F fullscreen, T light/dark, \` debug info.</dd>
    </dl>
    <h2>The screen</h2>
    <dl>
      <dt>Top</dt><dd>Back to the menu, the game clock and Pause. Under them, the resource bar shows everything you carry; tap it (or press I) for the inventory with full names.</dd>
      <dt>Bottom</dt><dd>Build opens every building, sorted into tabs, with what each one does, what it costs and how many you can afford. Next to it are quick slots for the buildings you picked last, then Remove. The small number on a building is how many you can afford.</dd>
      <dt>Pause</dt><dd>Resume, light/dark mode, fullscreen, debug info (FPS and the tapped tile), and Save and quit.</dd>
    </dl>
    <h2>Building</h2>
    <dl>
      <dt>Place</dt><dd>Pick a building from Build or a quick slot. A bar above the buttons shows its cost, with anything you're short of in red. Touch: tap the map to put the ghost there, then tap the ghost to build it (tap elsewhere to move it). Mouse: the ghost follows the cursor, click to build. The ghost is green where it fits and red where it doesn't. Done (or tapping the building's slot again) puts it away.</dd>
      <dt>Rotate</dt><dd>The rotate button next to Done, or R, turns the next building.</dd>
      <dt>Belt lines</dt><dd>Touch: press and hold, then drag. Mouse: drag with the left button. The belts face the way you drag.</dd>
      <dt>Remove</dt><dd>Pick Remove. Touch: tap a building to mark it, then tap it again to remove it. Mouse: click a building. You get its full cost back.</dd>
      <dt>Moving around</dt><dd>A quick drag always moves the map, even with a tool picked. With a mouse, drag with the right button while laying belts.</dd>
      <dt>Keys</dt><dd>B build menu, 1 belt, 2 miner, 3 chest, 4 furnace, 5 inserter, 6 assembler, X remove, R rotate, Q or Esc put the tool away.</dd>
    </dl>
    <h2>Items</h2>
    <dl>
      <dt>Mining</dt><dd>With no tool picked, press and hold on an ore patch (mouse: hold the left button still). Keep holding to keep mining, and slide to the next tile when one runs out.</dd>
      <dt>Costs</dt><dd>Buildings cost plates, gears, circuits and stone. Removing a building gives everything back.</dd>
      <dt>Machines</dt><dd>A miner on ore digs one item a second and drops it out of its chute (the yellow block on its front). Put a belt, chest or furnace there to catch it. A crossed-out rock means there's no ore under it; an amber sign means its output is blocked. Tap a building (no tool picked) to see inside; a chest's Take all moves everything into your inventory.</dd>
      <dt>Belts</dt><dd>Belts carry items the way their arrows point, round corners, and into a chest or furnace at the end. A belt that runs into the side of another adds its items to that line; a line only carries so much, and the rest waits. Removing a belt gives you what was on it.</dd>
      <dt>Furnaces</dt><dd>A furnace smelts iron ore into iron plates, copper ore into copper plates and stone into bricks (two stone each), about one a second, burning coal as it goes (one coal smelts 8). A crossed-out flame means it has something to smelt but no coal. Tap it (no tool picked) to add ore and coal from your inventory and take what it made. Belts, miners and inserters feed it too, but only a few at a time. Furnaces cost stone, so you can always build one and smelt your first plates by hand.</dd>
      <dt>Inserters</dt><dd>An inserter swings items from the building behind it into the one in front, the way its arrow points: off a belt into a furnace, out of a furnace onto a belt, chest to chest. It only picks up what the building in front can use, so one inserter can feed a furnace both ore and coal off a mixed belt. It only takes finished plates out of a furnace.</dd>
      <dt>Assemblers</dt><dd>An assembler makes one thing: gears (2 iron plates each), copper cable (2 from a copper plate) or circuits (an iron plate and 3 cables). Tap it (no tool picked) to pick what it makes; the icon over it shows what that is, and a question mark means it hasn't been told. Feed it with inserters and take what it makes out with another, or add and take by hand from its panel. Changing what it makes gives you back what it holds. A line like copper plates → cable assembler → inserter → circuit assembler runs on its own.</dd>
      <dt>Crafting by hand</dt><dd>The inventory panel (tap the resource bar) has Craft by hand: +1 or +5 of gears, cable or circuits. Parts you need along the way are crafted first, so a circuit can be made straight from plates. Hands work twice as fast as an assembler, one craft at a time; the bar above the buttons shows progress, and ✕ in the queue calls a craft off and gives back its ingredients. When you pick a building you can't afford, Craft next to Done makes the parts you're missing.</dd>
      <dt>Inventory</dt><dd>The resource bar shows what you carry. Ore is drawn as a rock, plates as plates, bricks as bricks, gears as gears, cable as a spool and circuits as green boards, each in its own colour. You start with a small kit.</dd>
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
    ? "Use the button in the game's pause menu, or the one below."
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
