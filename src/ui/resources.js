import { ITEMS } from "../sim/items.js";
import { count } from "../sim/inventory.js";
import { itemIcon } from "./icons.js";
import { short, itemRows } from "./format.js";

// The resource bar under the top bar: an icon and a count for every item the
// player carries, in item order. A count that goes up or down flashes. Tapping the
// bar opens the inventory panel, which has the full names.
export function createResources(bar, panel) {
  let shown = -1;
  let last = null; // counts at the last redraw, to see which changed

  return {
    sync(inv) {
      if (inv.version === shown) return;
      shown = inv.version;
      const ids = Object.keys(ITEMS).filter((id) => count(inv, id) > 0);
      bar.innerHTML = ids.length
        ? ids
            .map((id) => {
              const n = count(inv, id);
              const was = last ? last[id] || 0 : n;
              const flash = n > was ? ` data-flash="up"` : n < was ? ` data-flash="down"` : "";
              return `<span class="res" title="${ITEMS[id].name}"${flash}>${itemIcon(id)}<b>${short(n)}</b></span>`;
            })
            .join("")
        : `<span class="res-empty">Nothing yet. Hold on an ore patch to mine it.</span>`;
      last = { ...inv.items };
      panel.querySelector("ul").innerHTML = itemRows(inv) || `<li class="empty">Empty. Hold on an ore patch to mine it.</li>`;
    },
  };
}
