// Layouts: a group of buildings lifted off the map to be pasted somewhere else,
// turned, or put back (undo).
//
// A layout is { x, y, w, h, parts }: the box its buildings cover, where that box
// was, and a part per building with its type, facing, place (relative to the box's
// top-left) and id, plus its settings: which end an underground belt is, an
// assembler's recipe, a sorter's filters. What the buildings held isn't part of it.
// Parts are in the order the buildings were built, which is the order the sim steps
// them in.
//
// Pasting builds the parts that fit, in order, for as long as the player can pay;
// underground exits come last, so their entrances are there to pair with.
import { BUILDINGS, DIRS, footprint } from "./buildings.js";
import { canFit, place, removeAt, refundOf } from "./world.js";
import { WATER } from "./map.js";
import { inMap, chunkOf, tileIndex, idAt } from "./chunks.js";
import { missing } from "./inventory.js";
import { partnerFor, REACH } from "./underground.js";
import { setRecipe } from "./assembler.js";
import { lockedWhy, recipeUnlocked } from "./progress.js";

// The buildings with a tile in rect { x, y, w, h }, in the order they were built.
export function entitiesIn(world, { x, y, w, h }) {
  const ids = new Set();
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      const id = inMap(tx, ty) && idAt(world, tx, ty);
      if (id) ids.add(id);
    }
  }
  if (!ids.size) return [];
  return [...world.entities.values()].filter((e) => ids.has(e.id));
}

// The layout of a list of buildings, or null for none.
export function layoutOf(entities) {
  if (!entities.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const e of entities) {
    const { w, h } = footprint(e.type, e.rot);
    x0 = Math.min(x0, e.x);
    y0 = Math.min(y0, e.y);
    x1 = Math.max(x1, e.x + w);
    y1 = Math.max(y1, e.y + h);
  }
  const parts = entities.map((e) => {
    const p = { id: e.id, type: e.type, x: e.x - x0, y: e.y - y0, rot: e.rot };
    if (e.type === "underground") p.end = e.end;
    if (e.type === "assembler" && e.recipe) p.recipe = e.recipe;
    if (e.type === "sorter") p.filters = [...e.filters];
    return p;
  });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, parts };
}

// The layout turned a quarter clockwise. Its box stays centred where it was (as
// near as whole tiles allow), so turning it four times puts it back.
export function rotateLayout(layout) {
  const { x, y, w, h } = layout;
  const parts = layout.parts.map((p) => {
    const f = footprint(p.type, p.rot);
    return { ...p, x: h - (p.y + f.h), y: p.x, rot: (p.rot + 1) % 4 };
  });
  return { x: x + Math.trunc((w - h) / 2), y: y + Math.trunc((h - w) / 2), w: h, h: w, parts };
}

// What every building of a layout costs together.
export function layoutCost(layout) {
  const cost = {};
  for (const p of layout.parts) addTo(cost, BUILDINGS[p.type].cost);
  return cost;
}

// The order a layout's parts are built in: underground exits after everything else.
const buildOrder = (layout) => [
  ...layout.parts.filter((p) => p.end !== "out"),
  ...layout.parts.filter((p) => p.end === "out"),
];

// Each part of `layout` placed with the box's top-left at (x, y), in the order
// they'd be built, with why it can't be built there, or why: null if it can.
// Reasons: "locked", "blocked" (it doesn't fit, or it's an underground exit with no
// entrance to pair with) and "unpaid" (the inventory runs out before it's paid for).
export function planLayout(world, layout, x, y) {
  const budget = { ...world.inventory.items };
  const plan = [];
  for (const p of buildOrder(layout)) {
    const at = { ...p, x: x + p.x, y: y + p.y };
    let why = null;
    if (lockedWhy(world, p.type)) why = "locked";
    else if (canFit(world, p.type, at.x, at.y, p.rot) || (p.end === "out" && !hasEntrance(world, plan, at))) why = "blocked";
    else if (!pay(budget, BUILDINGS[p.type].cost)) why = "unpaid";
    plan.push({ ...at, why });
  }
  return plan;
}

// Builds what it can of `layout` with the box's top-left at (x, y), paying for
// each building, and gives them their settings. Returns what was built, `ids`
// (each part's id → the id of the building made from it), how many parts were
// skipped and why (blocked, locked, unpaid), and `short`: the items still missing
// to pay for the unpaid ones, or null.
export function buildLayout(world, layout, x, y) {
  const built = [];
  const ids = new Map();
  const skipped = { blocked: 0, locked: 0, unpaid: 0 };
  const unpaid = {};
  const plan = planLayout(world, layout, x, y);
  for (const p of plan) {
    const e = !p.why && place(world, p.type, p.x, p.y, p.rot, p.end ? { end: p.end } : {});
    if (e) {
      if (p.recipe && recipeUnlocked(world, p.recipe)) setRecipe(e, p.recipe, world.inventory);
      if (p.filters) e.filters = [...p.filters];
      built.push(e);
      ids.set(p.id, e.id);
    } else {
      skipped[p.why || "blocked"]++;
      if (p.why === "unpaid") addTo(unpaid, BUILDINGS[p.type].cost);
    }
  }
  return { built, ids, total: plan.length, ...skipped, short: skipped.unpaid ? missing(world.inventory, unpaid) : null };
}

// Why `layout` can't go with its box's top-left at (x, y), counting the buildings
// in `ignore` (a Set of ids) as already gone, or null if it fits.
export function layoutFits(world, layout, x, y, ignore = new Set()) {
  for (const p of layout.parts) {
    const { w, h } = footprint(p.type, p.rot);
    for (let ty = y + p.y; ty < y + p.y + h; ty++) {
      for (let tx = x + p.x; tx < x + p.x + w; tx++) {
        if (!inMap(tx, ty)) return "Off the map";
        const c = chunkOf(world, tx, ty);
        const id = c.ids[tileIndex(tx, ty)];
        if (c.ore[tileIndex(tx, ty)] === WATER) return "Can't build on water";
        if (id && !ignore.has(id)) return "Something is in the way";
      }
    }
  }
  return null;
}

// Removes buildings, giving back what they cost and everything they held (see
// removeAt), and returns what came back. Ones already gone are skipped.
export function removeEntities(world, list) {
  const back = {};
  for (const e of list) {
    if (world.entities.get(e.id) !== e) continue;
    addTo(back, refundOf(e, world));
    removeAt(world, e.x, e.y);
  }
  return back;
}

// Whether a planned underground exit `e` has an entrance to pair with: an unpaired
// one in the world, or one planned before it, behind it in reach and facing its way.
function hasEntrance(world, plan, e) {
  if (partnerFor(world, e.x, e.y, e.rot, "out")) return true;
  const [dx, dy] = DIRS[e.rot];
  return plan.some((q) => {
    if (q.why || q.type !== "underground" || q.end !== "in" || q.rot !== e.rot) return false;
    const d = Math.abs(e.x - q.x) + Math.abs(e.y - q.y);
    return d >= 1 && d <= REACH && q.x === e.x - dx * d && q.y === e.y - dy * d;
  });
}

// Takes `cost` out of `budget` ({ id: n }) if it's all there.
function pay(budget, cost) {
  for (const id in cost) if ((budget[id] || 0) < cost[id]) return false;
  for (const id in cost) budget[id] -= cost[id];
  return true;
}

function addTo(total, items) {
  for (const id in items) total[id] = (total[id] || 0) + items[id];
}
