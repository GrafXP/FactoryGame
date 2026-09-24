// Inserters move one item at a time from the building behind them to the one in
// front (the way they face). They only pick up what the building in front can take
// right now, so nothing ever gets stuck in the hand for long.
//
// `swing` is where the arm is: 0 over the pickup side, SWING over the drop side.
// `hand` is the item it holds, or null. status is "working", "idle" (nothing to
// pick up), "waiting" (holding an item the target has no room for yet) or
// "no-output" (nothing in front takes items).
import { BUILDINGS, DIRS } from "./buildings.js";
import { entityAt } from "./grid.js";
import { takesItems, canTake, put, takeOne } from "./transport.js";

export const SWING = BUILDINGS.inserter.swing;

export const inserterState = () => ({ hand: null, swing: 0, status: "idle" });

// The tiles an inserter takes from (behind it) and drops onto (in front).
export function inserterEnds(e) {
  const [dx, dy] = DIRS[e.rot];
  return { from: { x: e.x - dx, y: e.y - dy }, to: { x: e.x + dx, y: e.y + dy } };
}

export function stepInserter(world, ins) {
  const { from, to } = inserterEnds(ins);
  const target = entityAt(world, to.x, to.y);
  const hasTarget = !!target && takesItems(target);

  if (ins.hand) {
    if (ins.swing < SWING) {
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
    ins.swing--;
    ins.status = "working";
    return;
  }
  if (!hasTarget) {
    ins.status = "no-output";
    return;
  }
  const source = entityAt(world, from.x, from.y);
  const item = source && takeOne(source, (id) => canTake(target, id));
  ins.hand = item || null;
  ins.status = item ? "working" : "idle";
}
