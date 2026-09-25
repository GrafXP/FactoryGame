// Belts, and handing items from one building to the next.
//
// A belt tile is BELT_LEN steps long. Its items sit at whole-number positions along
// it (0 where items come in, BELT_LEN at its front edge), front item first, at least
// ITEM_GAP apart, and move BELT_SPEED steps a tick. Whole numbers keep the sim exact
// and saves stable. With these numbers a belt runs at 1.875 tiles/s and carries at
// most 7.5 items/s, which is also what a merge is capped at.
import { BUILDINGS, DIRS } from "./buildings.js";
import { entityAt } from "./grid.js";
import { ITEMS } from "./items.js";
import { add, count, take, total } from "./inventory.js";
import { furnaceCanTake, furnaceAdd, furnaceTakeOne } from "./furnace.js";
import { assemblerCanTake, assemblerAdd, assemblerTakeOne } from "./assembler.js";
import { generatorCanTake, generatorAdd } from "./generator.js";

export const BELT_LEN = 32;
export const BELT_SPEED = 1;
export const ITEM_GAP = 8;
const MID = BELT_LEN / 2;

// Whether building e ever takes items from a neighbour.
export const takesItems = (e) =>
  e.type === "belt" || e.type === "furnace" || e.type === "assembler" || e.type === "generator" || !!e.inventory;

// Whether building e can take `item` right now. Belts take items onto their middle
// (where a miner's chute drops them); chests store them until they're full;
// furnaces take ore and fuel into their slots (see furnace.js), assemblers their
// recipe's ingredients (assembler.js) and generators fuel (generator.js).
export function canTake(e, item) {
  if (e.type === "belt") return roomAt(e, MID);
  if (e.type === "furnace") return furnaceCanTake(e, item);
  if (e.type === "assembler") return assemblerCanTake(e, item);
  if (e.type === "generator") return generatorCanTake(e, item);
  return !!e.inventory && total(e.inventory) < BUILDINGS[e.type].capacity;
}

// Gives e an item. Check canTake first.
export function put(e, item) {
  if (e.type === "belt") insertAt(e, item, MID);
  else if (e.type === "furnace") furnaceAdd(e, item);
  else if (e.type === "assembler") assemblerAdd(e, item);
  else if (e.type === "generator") generatorAdd(e, item);
  else add(e.inventory, item);
}

// Takes one item that `accepts(item)` says yes to out of building e, for an inserter,
// and returns it (or null). Belts give up their frontmost such item, chests any,
// furnaces and assemblers only what they've made, generators nothing.
export function takeOne(e, accepts) {
  if (e.type === "belt") {
    const i = e.items.findIndex((it) => accepts(it.item));
    return i < 0 ? null : e.items.splice(i, 1)[0].item;
  }
  if (e.type === "furnace") return furnaceTakeOne(e, accepts);
  if (e.type === "assembler") return assemblerTakeOne(e, accepts);
  if (!e.inventory) return null;
  for (const id in ITEMS) {
    if (count(e.inventory, id) && accepts(id)) {
      take(e.inventory, { [id]: 1 });
      return id;
    }
  }
  return null;
}

const roomAt = (belt, pos) => belt.items.every((it) => Math.abs(it.pos - pos) >= ITEM_GAP);

function insertAt(belt, item, pos) {
  let i = 0;
  while (i < belt.items.length && belt.items[i].pos > pos) i++;
  belt.items.splice(i, 0, { item, pos });
}

// How the belts connect, worked out from the layout and cached until it changes
// (world.version). It's derived, so it isn't part of the saved state.
//   next:  what each belt feeds, as { to, mode }: "belt" enters the next belt at its
//          start, "side" drops onto its middle (a side-load), "put" hands the item to
//          a chest or other building. Missing if nothing in front takes items.
//   shape: "straight", or "left"/"right" for a corner fed only from that side.
//   order: belts downstream first, so a belt moves after the one it feeds and a
//          packed line moves as one instead of opening gaps.
export function beltNetwork(world) {
  if (world.beltNet?.version === world.version) return world.beltNet;
  const belts = [];
  for (const e of world.entities.values()) if (e.type === "belt") belts.push(e);

  const inputs = new Map(belts.map((b) => [b, []])); // which sides feed each belt
  const feeds = new Map(); // belt → { to, side } or { to, mode: "put" }
  for (const b of belts) {
    const [dx, dy] = DIRS[b.rot];
    const f = entityAt(world, b.x + dx, b.y + dy);
    if (f?.type === "belt") {
      if (f.rot === (b.rot + 2) % 4) continue; // head-on: neither passes to the other
      const turn = (b.rot - f.rot + 4) % 4; // 0 from behind, 1 from its left, 3 from its right
      const side = turn === 0 ? "back" : turn === 1 ? "left" : "right";
      inputs.get(f).push(side);
      feeds.set(b, { to: f, side });
    } else if (f && takesItems(f)) {
      feeds.set(b, { to: f, mode: "put" });
    }
  }

  const shape = new Map();
  for (const b of belts) {
    const ins = inputs.get(b);
    shape.set(b, ins.length === 1 && ins[0] !== "back" ? ins[0] : "straight");
  }
  const next = new Map();
  for (const [b, f] of feeds) {
    if (f.mode) next.set(b, f);
    else next.set(b, { to: f.to, mode: f.side === "back" || shape.get(f.to) !== "straight" ? "belt" : "side" });
  }

  // Follow each belt downstream until reaching one already placed in the order, then
  // add that stretch front to back. Loops work too; one join in a loop may open a gap.
  const order = [];
  const seen = new Set();
  for (const b of belts) {
    const path = [];
    for (let c = b; c?.type === "belt" && !seen.has(c); c = next.get(c)?.to) {
      seen.add(c);
      path.push(c);
    }
    for (let i = path.length - 1; i >= 0; i--) order.push(path[i]);
  }

  world.beltNet = { version: world.version, next, shape, order };
  return world.beltNet;
}

export function stepBelts(world) {
  const { order, next } = beltNetwork(world);
  for (const b of order) moveBelt(b, next.get(b));
}

function moveBelt(b, out) {
  const items = b.items;
  if (!items.length) return;
  // The front item may run onto the next belt as far as that belt's last item allows;
  // anything else waits at this belt's front edge until it can be handed over.
  let limit = BELT_LEN;
  if (out?.mode === "belt") {
    const rear = out.to.items.at(-1);
    limit = BELT_LEN + (rear ? rear.pos - ITEM_GAP : BELT_SPEED);
  }
  for (const it of items) {
    it.pos = Math.max(it.pos, Math.min(it.pos + BELT_SPEED, limit));
    limit = it.pos - ITEM_GAP;
  }

  const first = items[0];
  if (first.pos < BELT_LEN || !out) return;
  if (out.mode === "belt") {
    items.shift();
    first.pos -= BELT_LEN;
    out.to.items.push(first); // behind everything already on it, by the limit above
  } else if (out.mode === "side" ? roomAt(out.to, MID) : canTake(out.to, first.item)) {
    items.shift();
    if (out.mode === "side") insertAt(out.to, first.item, MID);
    else put(out.to, first.item);
  }
}
