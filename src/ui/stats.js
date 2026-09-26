import { ITEMS } from "../sim/items.js";
import { TICK_RATE } from "../sim/world.js";
import { WINDOWS, MADE, USED, BUCKETS, covered, history, perMinute, itemsSeen, activityOf } from "../sim/stats.js";
import { itemIcon, icon } from "./icons.js";

// The Stats panel: for every item made or used over the window picked (the last
// minute, 10 minutes or hour), how many a minute, with a small graph of both over
// the window. Redrawn when a new bucket of that window is in.
const WINDOW_KEY = "factory:stats-window";

// A rate a minute, short: "0.5", "12", "1.2k".
const rate = (n) => (n === null ? "–" : n < 10 ? String(+n.toFixed(1)) : n < 10000 ? String(Math.round(n)) : `${(n / 1000).toFixed(1)}k`);

// "the last minute", or "the last 23 s" while the game is younger than the window.
const OVER = ["the last minute", "the last 10 minutes", "the last hour"];
function span(world, w) {
  const n = covered(world, w);
  if (n >= BUCKETS) return OVER[w];
  const secs = (n * WINDOWS[w].ticks) / TICK_RATE;
  return secs < 120 ? `the last ${secs} s` : `the last ${Math.round(secs / 60)} min`;
}

// Made and used over the window as two lines, oldest on the left, on a scale that
// fits the bigger of the two. Buckets from before counting started are left out.
function spark(made, used) {
  const top = Math.max(1, ...made, ...used);
  const line = (vals, cls) => {
    const pts = [];
    vals.forEach((v, i) => v !== null && pts.push([i, (19 - (v / top) * 18).toFixed(1)]));
    if (pts.length === 1) pts.push([pts[0][0] - 1, pts[0][1]]); // one bucket: a short dash
    return pts.length ? `<polyline class="${cls}" points="${pts.map((p) => p.join(",")).join(" ")}"/>` : "";
  };
  return `<svg class="spark" viewBox="0 0 ${BUCKETS - 1} 20" preserveAspectRatio="none" aria-hidden="true">${line(used, "used")}${line(made, "made")}</svg>`;
}

export function createStatsPanel(el, { close }) {
  let w = 0;
  try {
    const saved = WINDOWS.findIndex((x) => x.id === localStorage.getItem(WINDOW_KEY));
    if (saved >= 0) w = saved;
  } catch {}
  let shownKey = "";
  let world = null;

  const sync = (wd) => {
    world = wd;
    if (el.hidden) return;
    const key = `${w} ${Math.floor(world.tick / WINDOWS[w].ticks)} ${world.stats.since}`;
    if (key === shownKey) return;
    shownKey = key;
    const ids = itemsSeen(world, w, Object.keys(ITEMS));
    const rows = ids
      .map((id) => {
        const made = history(world, id, w, MADE);
        const used = history(world, id, w, USED);
        return `<li>${itemIcon(id)}<span>${ITEMS[id].name}</span><b class="made">${rate(perMinute(world, id, w, MADE))}</b><b class="used">${rate(perMinute(world, id, w, USED))}</b>${spark(made, used)}</li>`;
      })
      .join("");
    const tabs = WINDOWS.map((x, i) => `<button data-action="window" data-i="${i}" aria-pressed="${i === w}">${x.name}</button>`).join("");
    const none =
      covered(world, w) <= 0
        ? `<p class="meta">Counting has only just started.</p>`
        : `<p class="meta">Nothing made or used over ${span(world, w)}. Miners, furnaces, assemblers and your own hands make things; machines, generators and the HUB use them.</p>`;
    el.innerHTML = `<h3>Production<button class="close" data-action="close" aria-label="Close">${icon("close")}</button></h3>
      <div class="segmented amount" role="group" aria-label="Over how long">${tabs}</div>
      ${
        rows
          ? `<p class="meta">How many a minute, over ${span(world, w)}.</p>
             <ul class="items stats"><li class="head"><span></span><b class="made">Made</b><b class="used">Used</b></li>${rows}</ul>`
          : none
      }`;
  };

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (btn?.dataset.action === "close") return close();
    if (btn?.dataset.action !== "window") return;
    w = Number(btn.dataset.i);
    try {
      localStorage.setItem(WINDOW_KEY, WINDOWS[w].id);
    } catch {}
    if (world) sync(world);
  });

  return {
    sync,
    // Shows or hides it; returns whether it's showing.
    toggle(show = el.hidden) {
      el.hidden = !show;
      shownKey = "";
      if (show && world) sync(world);
      return show;
    },
  };
}

// What held a machine up, as its panel puts it.
const HELD_UP = {
  "no-input": "no input",
  "no-fuel": "no fuel",
  "no-power": "no power",
  full: "output full",
  "no-output": "nowhere to put it",
  "no-resource": "no ore",
  "no-recipe": "no recipe",
};

// A machine's panel line on how it spent the last minute: how much it worked, and
// what held it up the rest of the time, with a bar split the same way.
export function activityLine(world, e) {
  const a = activityOf(world, e);
  if (!a) return "";
  const pct = (x) => Math.round(x * 100);
  const over = a.seconds >= 59.5 ? "the last minute" : `the last ${Math.max(1, Math.round(a.seconds))} s`;
  const work = a.share.working || 0;
  const held = Object.entries(a.share)
    .filter(([s, x]) => s !== "working" && pct(x) > 0)
    .sort((p, q) => q[1] - p[1]);
  const why = held.map(([s, x]) => `${HELD_UP[s]} ${pct(x)}%`).join(", ");
  const text =
    pct(work) >= 100 || !held.length
      ? `Working all of ${over}.`
      : pct(work) === 0
        ? `Stopped all of ${over}: ${why}.`
        : `Working ${pct(work)}% of ${over}. Held up by ${why}.`;
  const bar = [["working", work], ...held].map(([s, x]) => `<i data-s="${s}" style="width: ${pct(x)}%"></i>`).join("");
  return `<span class="activity">${bar}</span><p class="meta">${text}</p>`;
}
