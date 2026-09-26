import { BUILDINGS } from "../sim/buildings.js";
import { TICK_RATE } from "../sim/world.js";
import { TECHS, tierOf, canResearch, queueResearch, cancelResearch } from "../sim/tech.js";
import { buildingUnlocked } from "../sim/progress.js";
import { itemIcon, icon } from "./icons.js";
import { lower } from "./format.js";

// The Research panel: the technology under way with its progress, the queue, and
// every technology not done yet, by tier (the packs they take), with what each
// costs and does. Available ones can be researched, or queued behind the one under
// way; later ones are queued along with what they need first. Done ones are listed
// at the bottom. Labs do the work (sim/lab.js).

const BONUS = {
  damage: (n) => `Gun turrets do ${n}% more damage`,
  rate: (n) => `Gun turrets shoot ${n}% faster`,
  walls: (n) => `Walls get ${n}% more health`,
};

// What technology `id` does, as a list of lines.
export function effectsOf(id) {
  const t = TECHS[id];
  return [
    ...t.unlocks.buildings.map((b) => `Unlocks the ${BUILDINGS[b].name.toLowerCase()}`),
    ...t.unlocks.recipes.map((r) => `Unlocks ${lower(r, 2)}`),
    ...Object.entries(t.bonus).map(([k, n]) => BONUS[k](n)),
  ];
}

// "30 × [red] · 10 s each": units, the packs each takes (one of each), and how
// long a lab works on one.
function costOf(id) {
  const t = TECHS[id];
  const packs = t.packs.map((p) => `<span class="chip" title="1 ${lower(p, 1)} a unit">${itemIcon(p)}</span>`).join("");
  return `<span class="tech-cost" title="${t.units} units, each taking one of each pack and ${+(t.time / TICK_RATE).toFixed(1)} s in a lab">${t.units} × ${packs} · ${+(t.time / TICK_RATE).toFixed(1)} s each</span>`;
}

const TIERS = ["", "Red packs", "Red and green packs"];

export function createResearchPanel(el, { close, toast }) {
  let shownKey = "";
  let world = null;

  const card = (id, action) => {
    const t = TECHS[id];
    const needs = t.needs.filter((n) => !world.research.done.has(n));
    return `<li class="tech">
        <b>${t.name}</b>
        <span class="tech-does">${effectsOf(id).join(". ")}.</span>
        ${costOf(id)}
        ${needs.length ? `<small>Needs ${needs.map((n) => TECHS[n].name).join(" and ")} first.</small>` : ""}
        ${action}
      </li>`;
  };

  const html = () => {
    const r = world.research;
    const labs = [...world.entities.values()].filter((e) => e.type === "lab").length;
    const intro = labs
      ? `<p class="meta">${labs} lab${labs === 1 ? "" : "s"} working on what's under way.</p>`
      : buildingUnlocked(world, "lab")
        ? `<p class="meta">Labs do the research: build one (Build → Base) and feed it science packs.</p>`
        : `<p class="meta">Research starts with the last milestone at the HUB, which unlocks labs and red science packs.</p>`;
    let now = `<p class="meta">Nothing is being researched. Pick something below.</p>`;
    if (r.current) {
      const t = TECHS[r.current];
      const done = r.progress[r.current] || 0;
      now = `<ul class="techs"><li class="tech now">
          <b>${t.name}</b><span class="tech-units">${done} / ${t.units}</span>
          <span class="bar"><i style="width: ${(done / t.units) * 100}%"></i></span>
          <span class="tech-does">${effectsOf(r.current).join(". ")}.</span>
          ${costOf(r.current)}
          <button class="take" data-action="cancel" data-tech="${r.current}">Stop</button>
        </li></ul>`;
    }
    const queue = r.queue.length
      ? `<h4>Next</h4><ol class="tech-queue">${r.queue
          .map((id) => `<li><span>${TECHS[id].name}</span><button class="take" data-action="cancel" data-tech="${id}" aria-label="Take ${TECHS[id].name} off the queue">${icon("close")}</button></li>`)
          .join("")}</ol>`
      : "";
    const left = Object.keys(TECHS).filter((id) => !r.done.has(id) && id !== r.current && !r.queue.includes(id));
    const verb = r.current ? "Queue" : "Research";
    const tiers = [1, 2]
      .map((tier) => {
        const ids = left.filter((id) => tierOf(id) === tier);
        if (!ids.length) return "";
        const cards = ids
          .map((id) => card(id, `<button class="take" data-action="queue" data-tech="${id}">${canResearch(world, id) ? verb : `${verb} with what it needs`}</button>`))
          .join("");
        return `<h4>${TIERS[tier]}</h4><ul class="techs">${cards}</ul>`;
      })
      .join("");
    const done = [...r.done].map((id) => `<span class="chip">${TECHS[id].name}</span>`).join("");
    return `<h3>Research<button class="close" data-action="close" aria-label="Close">${icon("close")}</button></h3>
      ${intro}
      <h4>Under way</h4>${now}
      ${queue}
      ${tiers}
      ${done ? `<h4>Done</h4><div class="chips done">${done}</div>` : ""}`;
  };

  const sync = (w) => {
    world = w;
    if (el.hidden) return;
    const r = world.research;
    const key = `${[...r.done].join()} ${r.current} ${r.progress[r.current] || 0} ${r.queue.join()} ${world.version} ${world.progress.milestone}`;
    if (key === shownKey) return;
    shownKey = key;
    el.innerHTML = html();
  };

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    const action = btn?.dataset.action;
    if (action === "close") return close();
    if (!world || !btn?.dataset.tech) return;
    const id = btn.dataset.tech;
    if (action === "queue") {
      const was = world.research.current;
      const added = queueResearch(world, id);
      if (world.research.current !== was) toast(`Researching ${TECHS[world.research.current].name}`);
      else if (added.length) toast(`Queued ${added.map((t) => TECHS[t].name).join(", ")}`);
    } else if (action === "cancel") cancelResearch(world, id);
    shownKey = "";
    sync(world);
  });

  return {
    sync,
    get open() {
      return !el.hidden;
    },
    // Shows or hides it; returns whether it's showing.
    toggle(show = el.hidden) {
      el.hidden = !show;
      shownKey = "";
      if (show && world) sync(world);
      return show;
    },
  };
}
