// Hand-crafting: the player's queue of RECIPES to make from their inventory.
//
// world.craft is { queue: [{ recipe, n }], progress, busy }. The craft at the head
// takes its ingredients when it starts (busy is then true) and puts what it makes
// in the inventory, HAND_SPEED times as fast as an assembler would. Asking for
// something whose ingredients are missing crafts them first, if they can be made
// from what the inventory holds. A craft whose ingredients are gone by the time it
// starts (the player spent them) is dropped; `dropped` counts those and
// `lastDropped` says what it was, so the UI can tell the player. Neither is saved.
// Only recipes the player has unlocked (progress.js) can be crafted; the planning
// functions take `can(recipe)` saying which those are.
import { RECIPES, HAND_SPEED } from "./recipes.js";
import { add, take, give } from "./inventory.js";
import { recipeUnlocked } from "./progress.js";

export const craftState = () => ({ queue: [], progress: 0, busy: false, dropped: 0, lastDropped: null });

// Ticks one hand-craft of `recipe` takes.
export const handTime = (recipe) => Math.ceil(RECIPES[recipe].time / HAND_SPEED);

// Plans with a copy of inventory `inv`: get(id, n) uses what's there and crafts
// the rest, make(recipe, times) crafts outright. Steps come ingredients first.
// `missing` is what can be neither found nor made ({ id: count }), or null.
function planner(inv, can) {
  const have = { ...inv.items };
  const steps = [];
  let missing = null;
  const get = (id, n) => {
    const use = Math.min(have[id] || 0, n);
    have[id] = (have[id] || 0) - use;
    if (n === use) return;
    const r = can(id) && RECIPES[id];
    if (!r) {
      (missing ||= {})[id] = (missing[id] || 0) + n - use;
      return;
    }
    make(id, Math.ceil((n - use) / r.n));
    have[id] -= n - use; // make() added what it crafted
  };
  const make = (recipe, times) => {
    const r = RECIPES[recipe];
    if (!can(recipe)) {
      (missing ||= {})[recipe] = (missing[recipe] || 0) + times * r.n;
      return;
    }
    for (const [id, k] of Object.entries(r.in)) get(id, k * times);
    const last = steps.at(-1);
    if (last?.recipe === recipe) last.n += times;
    else steps.push({ recipe, n: times });
    have[recipe] = (have[recipe] || 0) + times * r.n;
  };
  return { get, make, result: () => ({ steps, missing }) };
}

// How to hand-craft `recipe` `times` times from inventory `inv`: { steps, missing }.
export function planCraft(inv, recipe, times = 1, can = () => true) {
  const p = planner(inv, can);
  p.make(recipe, times);
  return p.result();
}

// How to get `items` ({ id: count }, e.g. a building's cost) from inventory `inv`,
// crafting what isn't there: { steps, missing }. No steps if it's all there.
export function planItems(inv, items, can = () => true) {
  const p = planner(inv, can);
  for (const [id, n] of Object.entries(items)) p.get(id, n);
  return p.result();
}

// How many times `recipe` could be hand-crafted from inventory `inv`, up to `max`.
export function craftable(inv, recipe, max = 99, can = () => true) {
  let n = 0;
  while (n < max && !planCraft(inv, recipe, n + 1, can).missing) n++;
  return n;
}

// Adds a plan's steps to the queue, or nothing if something is missing. Returns the plan.
function enqueue(world, plan) {
  if (plan.missing) return plan;
  const q = world.craft.queue;
  for (const s of plan.steps) {
    const last = q.at(-1);
    // Merging into the head would change a craft that's under way, so only merge behind it.
    if (last?.recipe === s.recipe && (q.length > 1 || !world.craft.busy)) last.n += s.n;
    else q.push({ ...s });
  }
  return plan;
}

// Which recipes the player can hand-craft in `world`.
export const canCraft = (world) => (recipe) => recipeUnlocked(world, recipe);

// Queues `recipe` `times` times, with whatever has to be crafted first. Returns the plan.
export const queueCraft = (world, recipe, times = 1) =>
  enqueue(world, planCraft(world.inventory, recipe, times, canCraft(world)));

// Queues crafting whatever of `items` the inventory lacks. Returns the plan.
export const queueItems = (world, items) => enqueue(world, planItems(world.inventory, items, canCraft(world)));

// Calls off queue entry i. A craft under way gives its ingredients back.
export function cancelCraft(world, i) {
  const c = world.craft;
  if (!c.queue[i]) return;
  if (i === 0 && c.busy) {
    give(world.inventory, RECIPES[c.queue[0].recipe].in);
    c.busy = false;
    c.progress = 0;
  }
  c.queue.splice(i, 1);
}

export function stepCraft(world) {
  const c = world.craft;
  const head = c.queue[0];
  if (!head) return;
  const r = RECIPES[head.recipe];
  if (!c.busy) {
    if (!take(world.inventory, r.in)) {
      c.queue.shift();
      c.dropped++;
      c.lastDropped = head.recipe;
      return;
    }
    c.busy = true;
    c.progress = 0;
  }
  if (++c.progress < handTime(head.recipe)) return;
  add(world.inventory, head.recipe, r.n);
  c.busy = false;
  c.progress = 0;
  if (--head.n === 0) c.queue.shift();
}
