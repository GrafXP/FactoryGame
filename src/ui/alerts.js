import { BUILDINGS } from "../sim/buildings.js";
import { layoutCost } from "../sim/layout.js";
import { describe } from "../sim/items.js";
import { missing } from "../sim/inventory.js";
import { TICK_RATE } from "../sim/world.js";
import { REPAIR_AFTER } from "../sim/health.js";
import { icon } from "./icons.js";

// Alerts: attacks and losses (world.alerts, raised by the sim). The alert button
// next to the clock shows how many things need looking at, the ruins plus the
// attack groups still fighting, and tapping it goes to the latest alert and opens
// the panel: the recent alerts, newest first, each a button that goes there, and
// Rebuild all for the ruins. New alerts also show as toasts, "under attack" at most
// once every TOAST_EVERY.
const TOAST_EVERY = 10 * TICK_RATE;
const SHOWN = 8;

const ago = (world, tick) => {
  const s = Math.max(0, Math.round((world.tick - tick) / TICK_RATE));
  return s < 60 ? `${s} s ago` : `${Math.floor(s / 60)} min ago`;
};
const TEXT = { attacked: "under attack", destroyed: "destroyed", "no-ammo": "out of ammunition" };

// The attack groups that have hit something lately.
export const fighting = (world) => [...world.enemies.groups.values()].filter((g) => g.hit >= 0 && world.tick - g.hit < REPAIR_AFTER);

export function createAlerts({ button, count, panel }, { go, rebuildAll, toast }) {
  let world = null;
  let seen = 0; // alerts raised so far that have been toasted
  let toastedAttack = -Infinity;
  let shownKey = "";

  const latest = () => world.alerts[world.alerts.length - 1];

  const sync = (w) => {
    world = w;
    // Toasts for the new alerts: every loss, and attacks now and then.
    const fresh = world.alertCount - seen;
    if (fresh > 0) {
      const list = world.alerts.slice(-Math.min(fresh, world.alerts.length));
      seen = world.alertCount;
      const lost = list.filter((a) => a.kind === "destroyed");
      if (lost.length === 1) toast(`${BUILDINGS[lost[0].type].name} destroyed`);
      else if (lost.length > 1) toast(`${lost.length} buildings destroyed`);
      else if (list.some(a => a.kind === "no-ammo")) toast("Gun turret out of ammunition near enemies");
      else if (list.some((a) => a.kind === "attacked") && world.tick - toastedAttack >= TOAST_EVERY) {
        toastedAttack = world.tick;
        const a = list.find((x) => x.kind === "attacked");
        toast(`${BUILDINGS[a.type].name} under attack`);
      }
    }
    const empty = [...world.entities.values()].filter(e => e.type === "turret" && e.status === "no-ammo" && world.enemies.units.has(e.target)).length;
    const n = world.ruins.length + fighting(world).length + empty;
    button.hidden = n === 0 && panel.hidden;
    count.textContent = n > 99 ? "99+" : String(n);
    count.hidden = n === 0;
    if (!panel.hidden) render();
  };

  const render = () => {
    const key = `${world.alertCount} ${world.ruins.length} ${Math.floor(world.tick / TICK_RATE)} ${world.inventory.version}`;
    if (key === shownKey) return;
    shownKey = key;
    const rows = world.alerts
      .slice(-SHOWN)
      .reverse()
      .map((a, i) => {
        const at = world.alerts.length - 1 - i;
        return `<li><button class="alert-row" data-action="go" data-i="${at}" data-kind="${a.kind}">${icon(a.type)}<span><b>${BUILDINGS[a.type].name} ${TEXT[a.kind]}</b><small>${ago(world, a.tick)}</small></span></button></li>`;
      })
      .join("");
    const ruins = world.ruins.length;
    const cost = ruins ? layoutCost({ parts: world.ruins }) : null;
    const short = cost && missing(world.inventory, cost);
    panel.innerHTML = `<h3>Alerts<button class="close" data-action="close" aria-label="Close">${icon("close")}</button></h3>
      ${rows ? `<ul class="alerts">${rows}</ul>` : `<p class="meta">Nothing lately.</p>`}
      ${
        ruins
          ? `<button class="wide" data-action="rebuild">Rebuild all (${ruins})</button>
             <p class="meta">Costs ${describe(cost)}${short ? `. Missing ${describe(short)}, so some stay ruins` : ""}. Tapping a ruin rebuilds just that one.</p>`
          : ""
      }`;
  };

  const open = (show = panel.hidden) => {
    panel.hidden = !show;
    shownKey = "";
    if (show && world) render();
    button.setAttribute("aria-expanded", show);
  };

  button.addEventListener("click", () => {
    if (!world) return;
    const a = latest();
    if (a && panel.hidden) go(a.x, a.y);
    open();
  });
  panel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    const action = btn?.dataset.action;
    if (action === "close") return open(false);
    if (!world) return;
    if (action === "go") {
      const a = world.alerts[Number(btn.dataset.i)];
      if (a) go(a.x, a.y);
    }
    if (action === "rebuild") {
      rebuildAll();
      shownKey = "";
      render();
    }
  });

  return { sync, open };
}
