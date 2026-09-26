// Inserters move one item at a time from the building behind them to the one in
// front (the way they face). They only pick up what the building in front can take
// right now, so nothing ever gets stuck in the hand for long. A long inserter
// drops two tiles in front instead of one, over whatever is in between, and a
// sorting inserter only moves the item it's set to (`filter`), and nothing until
// it's set.
//
// `swing` is where the arm is: 0 over the pickup side, swingOf(type) over the drop
// side. `hand` is the item it holds, or null. Each tick the arm moves uses power,
// and it won't pick anything up without power to move it. status is "working",
// "idle" (nothing to pick up), "waiting" (holding an item the target has no room
// for yet), "no-power", "no-output" (nothing in front takes items) or "no-filter"
// (a sorting inserter that hasn't been set).
import { BUILDINGS, DIRS } from "./buildings.js";
import { ITEMS } from "./items.js";
import { takesItems, canTake, put, takeOne } from "./transport.js";
import { hasPower, usePower } from "./power.js";

export const SWING = BUILDINGS.inserter.swing;

export const INSERTERS = new Set(["inserter", "long-inserter", "sorting-inserter"]);
export const isInserter = (e) => INSERTERS.has(e.type);

// How many ticks an inserter of `type` takes to swing across.
export const swingOf = (type) => BUILDINGS[type].swing;

export const inserterState = (type) => ({ hand: null, swing: 0, status: "idle", ...(type === "sorting-inserter" && { filter: null }) });

// The tiles an inserter takes from (behind it) and drops onto (in front, or two
// tiles in front for a long inserter).
export function inserterEnds(e) {
  const [dx, dy] = DIRS[e.rot];
  const reach = BUILDINGS[e.type].reach || 1;
  return { from: { x: e.x - dx, y: e.y - dy }, to: { x: e.x + dx * reach, y: e.y + dy * reach } };
}

// Sets sorting inserter e to move only `item`. What's in its hand stays there and
// is dropped as usual.
export function setInserterFilter(e, item) {
  if (!Object.hasOwn(ITEMS, item)) throw new Error(`Unknown item "${item}"`);
  e.filter = item;
}

// `source` and `target` are the buildings behind and in front of it, or null.
export function stepInserter(world, ins, source, target) {
  const hasTarget = !!target && takesItems(target);

  if (ins.hand) {
    if (ins.swing < swingOf(ins.type)) {
      if (!usePower(world, ins)) return;
      ins.swing++;
      ins.status = "working";
    } else if (!hasTarget) {
      ins.status = "no-output";
    } else if (!canTake(target, ins.hand)) {
      ins.status = "waiting";
    } else {
      put(target, ins.hand);
      ins.hand = null;
      ins.status = "working";
    }
    return;
  }
  if (ins.swing > 0) {
    if (!usePower(world, ins)) return;
    ins.swing--;
    ins.status = "working";
    return;
  }
  if (!hasTarget) {
    ins.status = "no-output";
    return;
  }
  if (ins.filter === null) {
    ins.status = "no-filter";
    return;
  }
  if (!hasPower(world, ins)) return;
  const item = source && takeOne(source, target, ins.filter);
  ins.hand = item || null;
  ins.status = item ? "working" : "idle";
}
