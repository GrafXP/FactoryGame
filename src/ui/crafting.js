import { ITEMS, describe } from "../sim/items.js";
import { RECIPES } from "../sim/recipes.js";
import { queueCraft, cancelCraft, craftable, handTime, canCraft } from "../sim/crafting.js";
import { TICK_RATE } from "../sim/world.js";
import { itemIcon, icon } from "./icons.js";
import { lower } from "./format.js";

// Hand-crafting: the Craft part of the inventory panel (a row per recipe with +1
// and +5, and the queue, where tapping ✕ calls a craft off) and a readout above
// the bottom bar while something is being made (when `showReadout()` allows).
const seconds = (ticks) => `${+(ticks / TICK_RATE).toFixed(2)} s`;

export function createCrafting(section, readout, { toast, showReadout = () => true }) {
  let world = null;
  let shownKey = "";
  let seenDropped = 0;
  section.innerHTML = `<ul class="items queue"></ul><ul class="items recipes"></ul>`;
  const [queueList, recipeList] = section.children;

  // Each list is replaced only when its markup changes, so a tap isn't lost to a
  // redraw. The recipe rows change only when what can be crafted does.
  const drawn = new WeakMap();
  const put = (el, html) => {
    if (drawn.get(el) === html) return;
    drawn.set(el, html);
    el.innerHTML = html;
  };

  const render = () => {
    const c = world.craft;
    const inv = world.inventory;
    const queue = c.queue
      .map(
        (q, i) => `<li>${itemIcon(q.recipe)}<span>${ITEMS[q.recipe].name}${i === 0 && c.busy ? `<span class="bar"><i></i></span>` : ""}</span>
          <b>×${q.n}</b><button class="take" data-cancel="${i}" aria-label="Stop crafting ${lower(q.recipe, 2)}">${icon("close")}</button></li>`,
      )
      .join("");
    const recipes = Object.entries(RECIPES)
      .filter(([id]) => canCraft(world)(id))
      .map(([id, r]) => {
        const can = craftable(inv, id, 99, canCraft(world));
        const makes = r.n > 1 ? `${r.n} from ` : "";
        return `<li class="recipe">${itemIcon(id)}
          <span><b>${ITEMS[id].name}</b><small>${makes}${describe(r.in)} · ${seconds(handTime(id))}${can ? "" : " · can't make one yet"}</small></span>
          <button data-craft="${id}" data-n="1"${can >= 1 ? "" : " disabled"}>+1</button>
          <button data-craft="${id}" data-n="5"${can >= 5 ? "" : " disabled"}>+5</button></li>`;
      })
      .join("");
    put(queueList, queue);
    queueList.hidden = !queue;
    put(recipeList, recipes);
  };

  section.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn || !world) return;
    if (btn.dataset.cancel) cancelCraft(world, Number(btn.dataset.cancel));
    else if (btn.dataset.craft) {
      const { missing } = queueCraft(world, btn.dataset.craft, Number(btn.dataset.n));
      if (missing) toast(`Can't craft that: missing ${describe(missing)}`);
    }
    sync(world);
  });

  const sync = (w) => {
    world = w;
    const c = world.craft;
    const key = `${world.inventory.version} ${c.busy} ${JSON.stringify(c.queue)} ${world.progress.milestone}`;
    if (key !== shownKey) {
      shownKey = key;
      render();
    }
    const head = c.queue[0];
    const fill = head && c.busy ? `${(c.progress / handTime(head.recipe)) * 100}%` : "0%";
    const bar = queueList.querySelector(".bar i");
    if (bar) bar.style.width = fill;

    readout.hidden = !head || !showReadout();
    if (!readout.hidden) {
      const more = c.queue.reduce((n, q) => n + q.n, 0) - 1;
      readout.querySelector("span").textContent = `Crafting ${lower(head.recipe)}${more ? ` · ${more} more after it` : ""}`;
      readout.querySelector(".bar i").style.width = fill;
    }
    if (c.dropped !== seenDropped) {
      if (c.dropped > seenDropped) toast(`Couldn't craft ${lower(c.lastDropped)}: its ingredients were used up`);
      seenDropped = c.dropped;
    }
  };

  return { sync };
}
