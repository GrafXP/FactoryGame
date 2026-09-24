import { ITEMS, itemName } from "../sim/items.js";
import { count } from "../sim/inventory.js";
import { itemIcon } from "./icons.js";

// Shared bits of markup for items and costs.

export const lower = (id, n) => itemName(id, n).toLowerCase();

// 950 → "950", 12345 → "12.3k": short enough for the resource bar.
export const short = (n) => (n < 10000 ? String(n) : n < 100000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`);

// A chip per item of a cost, marked short when the inventory can't pay it.
// Full chips say "8 iron plates" (and "have 2" when short); compact ones just the
// icon and the number, or "have/need" when short.
export function costChips(cost, inv, { compact = false } = {}) {
  return Object.entries(cost)
    .map(([id, n]) => {
      const have = count(inv, id);
      const isShort = have < n;
      const text = compact
        ? isShort
          ? `${have}/${n}`
          : `${n}`
        : `${n} ${lower(id, n)}${isShort ? ` <small>have ${have}</small>` : ""}`;
      return `<span class="chip" data-short="${isShort}" title="${n} ${lower(id, n)}">${itemIcon(id)}${text}</span>`;
    })
    .join("");
}

// A list row for each item an inventory holds, in the usual item order.
export const itemRows = (inv) =>
  Object.keys(ITEMS)
    .filter((id) => count(inv, id) > 0)
    .map((id) => `<li>${itemIcon(id)}<span>${ITEMS[id].name}</span><b>${count(inv, id)}</b></li>`)
    .join("");
