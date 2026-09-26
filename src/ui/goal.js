import { BUILDINGS } from "../sim/buildings.js";
import { ITEMS } from "../sim/items.js";
import { MILESTONES, currentMilestone } from "../sim/progress.js";
import { TECHS } from "../sim/tech.js";
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

// The goal card: build the HUB, then each milestone's deliveries so far, then,
// once they're all done, the research under way. Tapping it calls `open(hub)`
// (the HUB, or null if there isn't one), or `research()` once it shows research.
export function createGoal(el, { open, research }) {
  let world = null;
  let shownKey = "";
  const tap = () => (currentMilestone(world) ? open(findHub(world)) : research());
  el.addEventListener("click", () => world && tap());
  el.addEventListener("keydown", (e) => {
    if (world && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      tap();
    }
  });

  return {
    sync(w) {
      world = w;
      const hub = findHub(world);
      const { milestone, delivered } = world.progress;
      const r = world.research;
      const m = currentMilestone(world);
      const key = m ? `${!!hub} ${milestone} ${JSON.stringify(delivered)}` : `research ${r.current} ${r.progress[r.current] || 0}`;
      if (key === shownKey) return;
      shownKey = key;
      if (!m) {
        const t = r.current && TECHS[r.current];
        el.innerHTML = t
          ? `${icon("research")}<b>${t.name}</b><span class="chips"><span class="chip">${r.progress[r.current] || 0}/${t.units}</span></span>`
          : `${icon("research")}<b>Research</b><span>Pick what the labs work on next.</span>`;
        el.setAttribute("aria-label", "Research: open the Research panel");
        return;
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
      <p>That was the last milestone: ${m.name}. It unlocked <b>${unlocksText(m)}</b>, and research takes over from here.</p>
      <p class="meta">Build a lab, feed it red science packs, and pick what to research with the flask at the top.</p>`;
  }
  return `<h2>Milestone reached: ${m.name}</h2>
    <p>Unlocked: <b>${unlocksText(m)}</b>.${m.unlocks.buildings.length ? " New buildings are under Build." : ""}</p>
    <p class="meta">Next: ${next.name}. ${next.about}</p>`;
}
