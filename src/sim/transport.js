// Belts and the other conveyors, and handing items from one building to the next.
//
// Conveyors are belts, underground belts (underground.js), splitters and sorters.
// Each carries `items` along one lane. A tile is BELT_LEN steps long; items sit at
// whole-number positions along it (0 where items come in, the conveyor's length at
// its front edge), front item first, at least ITEM_GAP apart, and move BELT_SPEED
// steps a tick. Whole numbers keep the sim exact and saves stable. With these
// numbers a belt runs at 1.875 tiles/s and carries at most 7.5 items/s, which is
// also what a merge is capped at.
//
// A paired underground entrance is one long conveyor running under to its exit:
// as many tiles long as the exit is ahead of it. Items further along than its own
// tile are underground.
//
// A splitter's items pick a way out as they reach its middle: front, left and right
// in turn, skipping a way with nothing attached or no room. A sorter is a splitter
// with a filter on each way out (`filters`, front, left, right): "any", an item, or
// "overflow". An item goes to the ways set to it if there are any, else to those
// set to "any"; if those are full, or there are none, it goes to an overflow way.
// With nowhere to go it waits at the middle, holding up everything behind it.
// status says how the last item fared: "working", "waiting" (its ways out are full)
// or "no-exit" (none will take it).
import { BUILDINGS, DIRS } from "./buildings.js";
import { entityAt } from "./grid.js";
import { ITEMS } from "./items.js";
import { add, count, take, total } from "./inventory.js";
import { furnaceCanTake, furnaceAdd, furnaceTakeOne } from "./furnace.js";
import { assemblerCanTake, assemblerAdd, assemblerTakeOne } from "./assembler.js";
import { generatorCanTake, generatorAdd } from "./generator.js";
import { stillNeeded, deliver } from "./progress.js";

export const BELT_LEN = 32;
export const BELT_SPEED = 1;
export const ITEM_GAP = 8;
export const MID = BELT_LEN / 2;

const CONVEYORS = new Set(["belt", "underground", "splitter", "sorter"]);
export const isConveyor = (e) => CONVEYORS.has(e.type);
export const isSplitter = (e) => e.type === "splitter" || e.type === "sorter";
// The ways out of a splitter, in the order it takes turns: front, left, right, as
// quarter turns clockwise from the way it faces.
export const SPLIT_TURNS = [0, 3, 1];
export const ANY_FILTERS = ["any", "any", "any"];

export const splitterState = () => ({ items: [], turn: 0, status: "working" });

// Sets sorter s's filter on way out i (0 front, 1 left, 2 right) to "any",
// "overflow" or an item. Items that have already picked a way keep it.
export function setFilter(s, i, filter) {
  s.filters[i] = filter;
}

// Whether building e ever takes items from a neighbour.
export const takesItems = (e) =>
  isConveyor(e) || e.type === "furnace" || e.type === "assembler" || e.type === "generator" || e.type === "hub" || !!e.inventory;

// Whether building e can take `item` right now. Conveyors take items onto the
// middle of their tile (where a miner's chute drops them); chests store them until they're full;
// furnaces take ore and fuel into their slots (see furnace.js), assemblers their
// recipe's ingredients (assembler.js), generators fuel (generator.js), and the HUB
// what its milestone still needs (progress.js).
export function canTake(e, item) {
  if (e.type === "hub") return stillNeeded(e.progress, item) > 0;
  if (isConveyor(e)) return roomAt(e, MID);
  if (e.type === "furnace") return furnaceCanTake(e, item);
  if (e.type === "assembler") return assemblerCanTake(e, item);
  if (e.type === "generator") return generatorCanTake(e, item);
  return !!e.inventory && total(e.inventory) < BUILDINGS[e.type].capacity;
}

// Gives e an item. Check canTake first.
export function put(e, item) {
  if (isConveyor(e)) insertAt(e, item, MID);
  else if (e.type === "furnace") furnaceAdd(e, item);
  else if (e.type === "assembler") assemblerAdd(e, item);
  else if (e.type === "generator") generatorAdd(e, item);
  else if (e.type === "hub") deliver(e.progress, item);
  else add(e.inventory, item);
}

// Takes one item that `accepts(item)` says yes to out of building e, for an inserter,
// and returns it (or null). Conveyors give up their frontmost such item on their
// own tile (not one that's underground), chests any,
// furnaces and assemblers only what they've made, generators and the HUB nothing.
export function takeOne(e, accepts) {
  if (isConveyor(e)) {
    const i = e.items.findIndex((it) => it.pos <= BELT_LEN && accepts(it.item));
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

// How the conveyors connect, worked out from the layout and cached until it changes
// (world.version). It's derived, so it isn't part of the saved state.
//   next:  where each conveyor but a splitter hands its items, as { to, mode }:
//          "belt" enters the next conveyor at its start, "side" drops onto its
//          middle (a side-load), "put" hands the item to a chest or other building.
//          Missing if nothing in front takes items.
//   exits: each splitter's ways out, [front, left, right], each like `next` or null.
//   len:   each conveyor's length.
//   shape: for belts, "straight", or "left"/"right" for a corner fed only from that side.
//   order: conveyors downstream first, so each moves after the ones it feeds and a
//          packed line moves as one instead of opening gaps.
export function beltNetwork(world) {
  if (world.beltNet?.version === world.version) return world.beltNet;
  const conveyors = [];
  for (const e of world.entities.values()) if (isConveyor(e)) conveyors.push(e);

  const len = new Map();
  for (const c of conveyors) {
    const exit = c.type === "underground" && c.end === "in" && world.entities.get(c.pair);
    len.set(c, exit ? (Math.abs(exit.x - c.x) + Math.abs(exit.y - c.y)) * BELT_LEN : BELT_LEN);
  }

  // Where an item leaving conveyor c going `dir` ends up. Items only enter a
  // conveyor from behind (the start of its lane) or, for belts and underground
  // ends, from the side; conveyors facing each other head-on don't connect.
  const inputs = new Map(); // belt → which sides feed it
  const link = (c, dir) => {
    if (c.type === "underground" && c.end === "in") {
      const exit = world.entities.get(c.pair);
      return exit ? { to: exit, mode: "belt" } : null;
    }
    const [dx, dy] = DIRS[dir];
    const f = entityAt(world, c.x + dx, c.y + dy);
    if (!f) return null;
    if (!isConveyor(f)) return takesItems(f) ? { to: f, mode: "put" } : null;
    if (f.rot === (dir + 2) % 4) return null;
    const turn = (dir - f.rot + 4) % 4; // 0 from behind, 1 from its left, 3 from its right
    if (f.type === "belt") {
      const side = turn === 0 ? "back" : turn === 1 ? "left" : "right";
      if (!inputs.has(f)) inputs.set(f, []);
      inputs.get(f).push(side);
      return { to: f, side };
    }
    if (turn === 0) return isSplitter(f) || f.end === "in" ? { to: f, mode: "belt" } : null;
    return f.type === "underground" ? { to: f, mode: "side" } : null;
  };
  const raw = new Map(); // conveyor → [links], one for most, three for a splitter
  for (const c of conveyors) raw.set(c, isSplitter(c) ? SPLIT_TURNS.map((t) => link(c, (c.rot + t) % 4)) : [link(c, c.rot)]);

  const shape = new Map();
  for (const c of conveyors) {
    if (c.type !== "belt") continue;
    const ins = inputs.get(c) || [];
    shape.set(c, ins.length === 1 && ins[0] !== "back" ? ins[0] : "straight");
  }
  // Into a straight belt's side is a side-load; into a corner, the way round it.
  const resolve = (l) => l && (l.mode ? l : { to: l.to, mode: l.side === "back" || shape.get(l.to) !== "straight" ? "belt" : "side" });
  const next = new Map();
  const exits = new Map();
  for (const [c, links] of raw) {
    if (isSplitter(c)) exits.set(c, links.map(resolve));
    else if (links[0]) next.set(c, resolve(links[0]));
  }

  // Downstream first: a depth-first walk that adds each conveyor after everything
  // it feeds. Loops work too; one join in a loop may open a gap.
  const kids = new Map();
  for (const [c, links] of raw) kids.set(c, links.filter((l) => l && isConveyor(l.to)).map((l) => l.to));
  const order = [];
  const seen = new Set();
  for (const c of conveyors) {
    if (seen.has(c)) continue;
    seen.add(c);
    const stack = [[c, 0]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const under = kids.get(top[0]);
      if (top[1] < under.length) {
        const k = under[top[1]++];
        if (!seen.has(k)) {
          seen.add(k);
          stack.push([k, 0]);
        }
      } else {
        order.push(top[0]);
        stack.pop();
      }
    }
  }

  world.beltNet = { version: world.version, next, exits, len, shape, order };
  return world.beltNet;
}

export function stepBelts(world) {
  const net = beltNetwork(world);
  for (const c of net.order) moveBelt(c, net);
}

// Whether `item` could go out along link l, behind `pending` items already on
// their way there.
function hasRoom(l, item, pending) {
  if (l.mode === "belt") {
    const rear = l.to.items.at(-1);
    return !rear || rear.pos >= ITEM_GAP * (pending + 1);
  }
  return l.mode === "side" ? !pending && roomAt(l.to, MID) : canTake(l.to, item);
}

// Picks the way out of splitter s for item `it` (an index into its exits), taking
// turns, or returns null if it has nowhere to go yet. Sets s.status.
function chooseExit(s, it, exits) {
  const item = it.item;
  const pending = [0, 0, 0];
  for (const other of s.items) if (other !== it && other.exit !== undefined) pending[other.exit]++;
  const filters = s.filters || ANY_FILTERS;
  const ways = (want) => [0, 1, 2].filter((i) => exits[i] && filters[i] === want);
  const own = ways(item);
  const wanted = own.length ? own : ways("any");
  const overflow = ways("overflow");
  for (const tier of [wanted, overflow]) {
    for (let k = 0; k < 3; k++) {
      const i = (s.turn + k) % 3;
      if (!tier.includes(i) || !hasRoom(exits[i], item, pending[i])) continue;
      s.turn = (i + 1) % 3;
      s.status = "working";
      return i;
    }
  }
  s.status = wanted.length || overflow.length ? "waiting" : "no-exit";
  return null;
}

function moveBelt(b, net) {
  const items = b.items;
  if (!items.length) {
    if (b.status && b.status !== "working") b.status = "working"; // an empty splitter isn't stuck
    return;
  }
  const len = net.len.get(b);
  const exits = isSplitter(b) && net.exits.get(b);
  // A way out that's gone since an item picked it: it picks again.
  if (exits) for (const it of items) if (it.exit !== undefined && !exits[it.exit]) delete it.exit;
  const out = exits ? items[0].exit !== undefined && exits[items[0].exit] : net.next.get(b);

  // The front item may run onto the next conveyor as far as that one's last item
  // allows; anything else waits at this one's front edge until it can be handed over.
  const first = items[0];
  const was = first.pos;
  let limit = len;
  if (out?.mode === "belt") {
    const rear = out.to.items.at(-1);
    limit = len + (rear ? rear.pos - ITEM_GAP : BELT_SPEED);
  }
  for (const it of items) {
    let to = Math.min(it.pos + BELT_SPEED, limit);
    if (exits && it.exit === undefined && to >= MID) {
      const i = chooseExit(b, it, exits);
      if (i === null) to = Math.min(to, MID);
      else it.exit = i;
    }
    it.pos = Math.max(it.pos, to);
    limit = it.pos - ITEM_GAP;
  }

  // A splitter's item held up because its way out filled before it got there picks
  // again, and goes on next tick.
  if (exits && first.exit !== undefined && first.pos === was && was > MID) {
    const i = chooseExit(b, first, exits);
    if (i !== null) first.exit = i;
    return;
  }
  if (first.pos < len || !out) return;
  if (out.mode === "belt") {
    items.shift();
    first.pos -= len;
    if (first.exit !== undefined) delete first.exit;
    out.to.items.push(first); // behind everything already on it, by the limit above
  } else if (out.mode === "side" ? roomAt(out.to, MID) : canTake(out.to, first.item)) {
    items.shift();
    if (out.mode === "side") insertAt(out.to, first.item, MID);
    else put(out.to, first.item);
  }
}
