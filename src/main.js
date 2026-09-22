import "./style.css";
import { createGame } from "./game.js";
import { TICK_RATE } from "./sim/world.js";
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

function play(el) {
  const $ = html(
    el,
    `<div class="game" id="game">
      <div class="hud">
        <a href="/" data-link class="icon-btn" aria-label="Back">
          <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>
        </a>
        <div class="score"><b id="clock">0:00</b><span id="status">Running</span></div>
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
      <div class="overlay" id="overlay" hidden></div>
    </div>`,
  );

  // Game clock in the HUD: ticks → m:ss.
  let shownSeconds = -1;
  const game = createGame($("#game"), {
    theme: getTheme(),
    onTick: (world) => {
      const s = Math.floor(world.tick / TICK_RATE);
      if (s === shownSeconds) return;
      shownSeconds = s;
      $("#clock").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    },
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
    if (k === "p" || k === "escape") game.running ? pause() : resume();
    else if (k === "f") toggleFullscreen();
    else if (k === "t") setThemePref(getTheme() === "dark" ? "light" : "dark");
    else return;
    e.preventDefault();
  };
  window.addEventListener("keydown", onKey);

  const onHidden = () => document.hidden && pause();
  document.addEventListener("visibilitychange", onHidden);

  return () => {
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
      <dt>Keyboard</dt><dd>P / Esc pause, F fullscreen, T light/dark.</dd>
    </dl>
    <p class="hint">More controls arrive as the game grows. See PLAN.md.</p>
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
