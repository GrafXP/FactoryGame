import { BUILDINGS } from "../sim/buildings.js";
import { ITEMS } from "../sim/items.js";
import { MILESTONES, currentMilestone } from "../sim/progress.js";
import { itemIcon, icon } from "./icons.js";
import { lower } from "./format.js";

// What the player is working towards, always in view: the goal card under the
// resource bar, and the banner that says a milestone has been reached.

// "Miner, Belt and hand-crafting circuits" for what milestone m unlocks.
export function unlocksText(m) {
  const names = [
    ...m.unlocks.buildings.map((t) => BUILDINGS[t].name),
    ...m.unlocks.recipes.map((id) => `hand-crafting ${lower(id, 2)}`),
  ];
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] || "";
}

// The HUB, if one is built. Looked up again only when the buildings change.
let hubCache = { world: null, version: -1, hub: null };
export function findHub(world) {
  if (hubCache.world !== world || hubCache.version !== world.version) {
    let hub = null;
    for (const e of world.entities.values()) if (e.type === "hub") hub = e;
    hubCache = { world, version: world.version, hub };
  }
  return hubCache.hub;
}

// The goal card: build the HUB, then each milestone's deliveries so far, then the
// end. Tapping it calls `open(hub)` (the HUB, or null if there isn't one).
export function createGoal(el, { open }) {
  let world = null;
  let shownKey = "";
  el.addEventListener("click", () => world && open(findHub(world)));
  el.addEventListener("keydown", (e) => {
    if (world && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      open(findHub(world));
    }
  });

  return {
    sync(w) {
      world = w;
      const hub = findHub(world);
      const { milestone, delivered } = world.progress;
      const key = `${!!hub} ${milestone} ${JSON.stringify(delivered)}`;
      if (key === shownKey) return;
      shownKey = key;
      const m = currentMilestone(world);
      if (!m) {
        el.innerHTML = `${icon("hub")}<b>Every milestone reached</b><span>You've automated circuits.</span>`;
      } else if (!hub) {
        el.innerHTML = `${icon("hub")}<b>Goal: build the HUB</b><span>Build → Base. Milestones are delivered there.</span>`;
      } else {
        const needs = Object.entries(m.needs)
          .map(([id, n]) => {
            const d = delivered[id] || 0;
            return `<span class="chip" data-done="${d >= n}" title="${ITEMS[id].name}">${itemIcon(id)}${d}/${n}</span>`;
          })
          .join("");
        el.innerHTML = `${icon("hub")}<b>${milestone + 1}. ${m.name}</b><span class="chips">${needs}</span>`;
      }
      el.setAttribute("aria-label", hub ? "Goal: open the HUB" : "Goal: build the HUB");
    },
  };
}

// The banner for a reached milestone (index i), with what it unlocked and what's next.
export function milestoneBanner(i) {
  const m = MILESTONES[i];
  const next = MILESTONES[i + 1];
  if (!next) {
    return `<h2>You've automated circuits!</h2>
      <p>That was the last milestone: ${m.name}. The factory is yours to grow.</p>`;
  }
  return `<h2>Milestone reached: ${m.name}</h2>
    <p>Unlocked: <b>${unlocksText(m)}</b>.${m.unlocks.buildings.length ? " New buildings are under Build." : ""}</p>
    <p class="meta">Next: ${next.name}. ${next.about}</p>`;
}
