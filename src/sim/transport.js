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

// Takes one item that building `target` can take right now out of building e, for
// an inserter, and returns it (or null). Conveyors give up their frontmost such
// item on their own tile (not one that's underground), chests any, furnaces and
// assemblers only what they've made, generators and the HUB nothing.
export function takeOne(e, target) {
  if (isConveyor(e)) {
    const items = e.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].pos <= BELT_LEN && canTake(target, items[i].item)) return items.splice(i, 1)[0].item;
    }
    return null;
  }
  if (e.type === "furnace" || e.type === "assembler") {
    if (!e.output || !canTake(target, e.output.item)) return null;
    return e.type === "furnace" ? furnaceTakeOne(e) : assemblerTakeOne(e);
  }
  if (!e.inventory) return null;
  for (const id in ITEMS) {
    if (count(e.inventory, id) && canTake(target, id)) {
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
// (world.beltVersion, which goes up when a conveyor or something that takes items
// is built or removed). It's derived, so it isn't part of the saved state.
//   next:  where each conveyor but a splitter hands its items, as { to, mode }:
//          "belt" enters the next conveyor at its start, "side" drops onto its
//          middle (a side-load), "put" hands the item to a chest or other building.
//          Missing if nothing in front takes items.
//   exits: each splitter's ways out, [front, left, right], each like `next` or null.
//   len:   each conveyor's length.
//   shape: for belts, "straight", or "left"/"right" for a corner fed only from that side.
//   order: conveyors downstream first, so each moves after the ones it feeds and a
//          packed line moves as one instead of opening gaps.
//   steps: `order` with what stepBelts needs of each, { b, len, next, exits }, so
//          it doesn't look them up every tick.
// `next` and `len` are only made when they're first asked for; the sim uses `steps`.
export function beltNetwork(world) {
  if (world.beltNet?.version === world.beltVersion) return world.beltNet;
  // Worked out again for every change to a big factory, so it's all flat arrays by
  // each conveyor's place in `conveyors`.
  const conveyors = [];
  let top = 0;
  for (const e of world.entities.values()) {
    if (!isConveyor(e)) continue;
    conveyors.push(e);
    top = Math.max(top, e.id);
  }
  const n = conveyors.length;
  const at = new Int32Array(top + 1); // conveyor id → its place + 1
  for (let i = 0; i < n; i++) at[conveyors[i].id] = i + 1;
  const place = (c) => at[c.id] - 1;

  // Where an item leaving conveyor c going `dir` ends up. Items only enter a
  // conveyor from behind (the start of its lane) or, for belts and underground
  // ends, from the side; conveyors facing each other head-on don't connect.
  const inputs = new Uint8Array(n); // how many sides feed each belt
  const firstInput = new Array(n); // and which side the first one found is
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
      if (!inputs[place(f)]++) firstInput[place(f)] = side;
      return { to: f, side };
    }
    if (turn === 0) return isSplitter(f) || f.end === "in" ? { to: f, mode: "belt" } : null;
    return f.type === "underground" ? { to: f, mode: "side" } : null;
  };
  // Each conveyor's links: one for most, three for a splitter, at raw[3 * i + k].
  const lens = new Array(n);
  const split = new Uint8Array(n);
  const raw = new Array(3 * n).fill(null);
  for (let i = 0; i < n; i++) {
    const c = conveyors[i];
    const exit = c.type === "underground" && c.end === "in" && world.entities.get(c.pair);
    lens[i] = exit ? (Math.abs(exit.x - c.x) + Math.abs(exit.y - c.y)) * BELT_LEN : BELT_LEN;
    split[i] = isSplitter(c) ? 1 : 0;
  }
  for (let i = 0; i < n; i++) {
    const c = conveyors[i];
    if (!split[i]) raw[3 * i] = link(c, c.rot);
    else for (let k = 0; k < 3; k++) raw[3 * i + k] = link(c, (c.rot + SPLIT_TURNS[k]) % 4);
  }

  const shapes = new Array(n);
  const shape = new Map();
  for (let i = 0; i < n; i++) {
    if (conveyors[i].type !== "belt") continue;
    shapes[i] = inputs[i] === 1 && firstInput[i] !== "back" ? firstInput[i] : "straight";
    shape.set(conveyors[i], shapes[i]);
  }
  // Into a straight belt's side is a side-load; into a corner, the way round it.
  const resolve = (l) => l && (l.mode ? l : { to: l.to, mode: l.side === "back" || shapes[place(l.to)] !== "straight" ? "belt" : "side" });
  const nexts = new Array(n).fill(null);
  const outs = new Array(n).fill(null);
  const exits = new Map();
  for (let i = 0; i < n; i++) {
    if (split[i]) exits.set(conveyors[i], (outs[i] = [resolve(raw[3 * i]), resolve(raw[3 * i + 1]), resolve(raw[3 * i + 2])]));
    else if (raw[3 * i]) nexts[i] = resolve(raw[3 * i]);
  }

  // Downstream first: a depth-first walk that adds each conveyor after everything
  // it feeds (the conveyors its links go to, in order). Loops work too; one join in
  // a loop may open a gap.
  const order = [];
  const steps = [];
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n); // conveyors under way
  const tried = new Uint8Array(n); // how many of each one's links have been followed
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    seen[s] = 1;
    stack[0] = s;
    tried[0] = 0;
    let depth = 1;
    while (depth) {
      const i = stack[depth - 1];
      if (tried[depth - 1] < (split[i] ? 3 : 1)) {
        const l = raw[3 * i + tried[depth - 1]++];
        if (!l || !isConveyor(l.to)) continue;
        const k = place(l.to);
        if (seen[k]) continue;
        seen[k] = 1;
        stack[depth] = k;
        tried[depth] = 0;
        depth++;
      } else {
        order.push(conveyors[i]);
        steps.push({ b: conveyors[i], len: lens[i], next: nexts[i], exits: outs[i] });
        depth--;
      }
    }
  }

  let next = null;
  let len = null;
  world.beltNet = {
    version: world.beltVersion,
    exits,
    shape,
    order,
    steps,
    get next() {
      return (next ||= new Map(steps.filter((s) => s.next).map((s) => [s.b, s.next])));
    },
    get len() {
      return (len ||= new Map(steps.map((s) => [s.b, s.len])));
    },
  };
  return world.beltNet;
}

export function stepBelts(world) {
  const { steps } = beltNetwork(world);
  for (let i = 0; i < steps.length; i++) moveBelt(steps[i]);
}

// Whether `item` could go out along link l, behind `pending` items already on
// their way there.
function hasRoom(l, item, pending) {
  if (l.mode === "belt") {
    const rear = l.to.items[l.to.items.length - 1];
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

// Moves conveyor s.b's items along (s is its entry in the network's steps).
function moveBelt(s) {
  const { b, len, exits } = s;
  const items = b.items;
  const n = items.length;
  if (!n) {
    if (b.status && b.status !== "working") b.status = "working"; // an empty splitter isn't stuck
    return;
  }
  // A way out that's gone since an item picked it: it picks again.
  if (exits) for (const it of items) if (it.exit !== undefined && !exits[it.exit]) delete it.exit;
  const out = exits ? items[0].exit !== undefined && exits[items[0].exit] : s.next;

  // The front item may run onto the next conveyor as far as that one's last item
  // allows; anything else waits at this one's front edge until it can be handed over.
  const first = items[0];
  const was = first.pos;
  let limit = len;
  if (out && out.mode === "belt") {
    const ahead = out.to.items;
    limit = len + (ahead.length ? ahead[ahead.length - 1].pos - ITEM_GAP : BELT_SPEED);
  }
  for (let k = 0; k < n; k++) {
    const it = items[k];
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
