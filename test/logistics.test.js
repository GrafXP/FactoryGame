import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, removeAt, canPlace, refundOf } from "../src/sim/world.js";
import { beltNetwork, canTake, put, BELT_LEN, MID } from "../src/sim/transport.js";
import { REACH, buried } from "../src/sim/underground.js";
import { count, total } from "../src/sim/inventory.js";
import { serialize, deserialize, SaveError } from "../src/sim/save.js";
import { ALL } from "./helpers.js";

const KIT = { "iron-plate": 5000, "iron-gear": 1000, "electronic-circuit": 1000, stone: 100 };
const setup = () => createWorld({ milestones: ALL, seed: 3, kit: { ...KIT } });
const run = (world, ticks, each) => {
  for (let i = 0; i < ticks; i++) {
    each?.(i);
    step(world);
  }
};
// Finds a clear square of bare ground, n tiles across, so tests don't hit ore.
const clearArea = (world, n) => {
  for (let y = 4; y < world.size - n - 4; y += 2) {
    for (let x = 4; x < world.size - n - 4; x += 2) {
      let clear = true;
      for (let j = 0; j < n && clear; j++) for (let i = 0; i < n && clear; i++) if (world.map.ore[(y + j) * world.size + x + i]) clear = false;
      if (clear) return { x, y };
    }
  }
  throw new Error("no clear area");
};
const items = (chest) => Object.keys(chest.inventory.items).sort();

// An east-going line through an underground pair, crossed by a south-going line
// that runs over the tunnel:
//
//          ↓
//   → [in] ↓ [out] → chest
//          ↓
//        chest
const crossing = () => {
  const world = setup();
  const { x, y } = clearArea(world, 14);
  const X = x + 2;
  const Y = y + 4;
  const feedEast = place(world, "belt", X - 1, Y, 1);
  const entrance = place(world, "underground", X, Y, 1);
  const exit = place(world, "underground", X + 4, Y, 1, { end: "out" });
  place(world, "belt", X + 5, Y, 1);
  const east = place(world, "chest", X + 6, Y, 0);
  const feedSouth = place(world, "belt", X + 2, Y - 2, 2);
  for (let j = -1; j <= 2; j++) place(world, "belt", X + 2, Y + j, 2);
  const south = place(world, "chest", X + 2, Y + 3, 0);
  const feed = (t) => {
    if (t % 10 === 0 && canTake(feedEast, "iron-ore")) put(feedEast, "iron-ore");
    if (t % 10 === 5 && canTake(feedSouth, "copper-ore")) put(feedSouth, "copper-ore");
  };
  return { world, X, Y, entrance, exit, east, south, feed };
};

test("a belt line crosses another through an underground pair, and neither leaks into the other", () => {
  const { world, entrance, exit, east, south, feed } = crossing();
  assert.equal(entrance.pair, exit.id);
  assert.equal(exit.pair, entrance.id);
  assert.equal(beltNetwork(world).len.get(entrance), 4 * BELT_LEN, "the entrance runs under to its exit");
  run(world, 60 * 20, feed);
  assert.deepEqual(items(east), ["iron-ore"]);
  assert.deepEqual(items(south), ["copper-ore"]);
  assert.ok(count(east.inventory, "iron-ore") >= 25, `${count(east.inventory, "iron-ore")} iron`);
  assert.ok(count(south.inventory, "copper-ore") >= 25, `${count(south.inventory, "copper-ore")} copper`);
});

test("items go under at belt speed", () => {
  const { world, entrance, east } = crossing();
  put(entrance, "iron-ore"); // on the middle of the entrance's tile
  // Half the entrance's tile, 3 tiles under, the exit, a belt: 5.5 tiles to the chest.
  run(world, BELT_LEN * 5.5 - 1);
  assert.equal(total(east.inventory), 0);
  run(world, 2);
  assert.equal(total(east.inventory), 1);
});

test("an exit has to be in line with an entrance and in reach", () => {
  const world = setup();
  const { x, y } = clearArea(world, 12);
  assert.match(canPlace(world, "underground", x + 3, y, 1, { end: "out" }), /needs an entrance/);
  const entrance = place(world, "underground", x, y, 1);
  assert.match(canPlace(world, "underground", x + REACH + 1, y, 1, { end: "out" }), /needs an entrance/, "too far");
  assert.match(canPlace(world, "underground", x + 3, y, 2, { end: "out" }), /needs an entrance/, "facing another way");
  assert.match(canPlace(world, "underground", x + 3, y + 1, 1, { end: "out" }), /needs an entrance/, "not in line");
  const exit = place(world, "underground", x + REACH, y, 1, { end: "out" });
  assert.ok(exit, "at the end of its reach");
  assert.equal(exit.pair, entrance.id);
  assert.match(canPlace(world, "underground", x + 2, y, 1, { end: "out" }), /needs an entrance/, "the entrance is taken");
});

test("an entrance built behind a lone exit pairs with it", () => {
  const world = setup();
  const { x, y } = clearArea(world, 12);
  const first = place(world, "underground", x, y, 1);
  const exit = place(world, "underground", x + 3, y, 1, { end: "out" });
  removeAt(world, first.x, first.y);
  assert.equal(exit.pair, null);
  const again = place(world, "underground", x + 1, y, 1);
  assert.equal(again.pair, exit.id);
  assert.equal(exit.pair, again.id);
});

test("removing either end gives back what's underground", () => {
  const { world, entrance, exit, feed } = crossing();
  run(world, 60 * 6, feed);
  const under = buried(entrance).length;
  assert.ok(under > 0, "items are underground");
  const back = refundOf(exit, world);
  assert.equal(back["iron-ore"], exit.items.length + under);
  const before = count(world.inventory, "iron-ore");
  removeAt(world, exit.x, exit.y);
  assert.equal(count(world.inventory, "iron-ore"), before + back["iron-ore"]);
  assert.equal(entrance.pair, null);
  assert.ok(entrance.items.every((it) => it.pos <= BELT_LEN), "only what's on its own tile is left");
  run(world, 120);
  assert.ok(entrance.items.every((it) => it.pos <= BELT_LEN), "and an unpaired entrance is a dead end");
});

// A splitter facing east, fed from the west, with a belt and chest on each way out
// that `ways` lists ("front", "left", "right"). Left of east is north.
const splitterLine = (type = "splitter", ways = ["front", "left", "right"]) => {
  const world = setup();
  const { x, y } = clearArea(world, 10);
  const X = x + 3;
  const Y = y + 4;
  const feeder = place(world, "belt", X - 1, Y, 1);
  const s = place(world, type, X, Y, 1);
  const out = {};
  if (ways.includes("front")) {
    out.front = [place(world, "belt", X + 1, Y, 1), place(world, "chest", X + 2, Y, 0)];
  }
  if (ways.includes("left")) out.left = [place(world, "belt", X, Y - 1, 0), place(world, "chest", X, Y - 2, 0)];
  if (ways.includes("right")) out.right = [place(world, "belt", X, Y + 1, 2), place(world, "chest", X, Y + 2, 0)];
  return { world, feeder, s, out };
};
// Puts `list` on the feeder one at a time as there's room.
const feedList = (feeder, list) => {
  let i = 0;
  return () => {
    if (i < list.length && canTake(feeder, list[i])) put(feeder, list[i++]);
  };
};

test("a splitter feeding three belts sends a third down each", () => {
  const { world, feeder, out } = splitterLine();
  run(world, 60 * 15, feedList(feeder, Array(30).fill("iron-ore")));
  for (const way of ["front", "left", "right"]) assert.equal(total(out[way][1].inventory), 10, way);
});

test("a splitter with two belts attached splits 50/50", () => {
  const { world, feeder, out } = splitterLine("splitter", ["left", "right"]);
  run(world, 60 * 15, feedList(feeder, Array(30).fill("iron-ore")));
  assert.equal(total(out.left[1].inventory), 15);
  assert.equal(total(out.right[1].inventory), 15);
});

test("a splitter skips a belt that's full", () => {
  const { world, feeder, out, s } = splitterLine();
  removeAt(world, out.left[1].x, out.left[1].y); // the left belt now leads nowhere and fills up
  run(world, 60 * 20, feedList(feeder, Array(40).fill("iron-ore")));
  const left = out.left[0].items.length;
  assert.ok(left <= 5, `${left} on the left belt`);
  assert.equal(total(out.front[1].inventory) + total(out.right[1].inventory) + left, 40, "nothing is lost or stuck");
  assert.ok(Math.abs(total(out.front[1].inventory) - total(out.right[1].inventory)) <= 1);
  assert.equal(s.items.length, 0);
});

test("a sorter set to iron ore on the left and overflow in front splits a mixed belt cleanly", () => {
  const { world, feeder, out, s } = splitterLine("sorter", ["front", "left"]);
  s.filters = ["overflow", "iron-ore", "any"]; // front, left, right
  const mixed = Array.from({ length: 30 }, (_, i) => (i % 3 ? "copper-ore" : "iron-ore"));
  run(world, 60 * 15, feedList(feeder, mixed));
  assert.deepEqual(items(out.left[1]), ["iron-ore"]);
  assert.equal(count(out.left[1].inventory, "iron-ore"), 10);
  assert.deepEqual(items(out.front[1]), ["copper-ore"]);
  assert.equal(count(out.front[1].inventory, "copper-ore"), 20);
});

test("iron goes to overflow once its own way is full", () => {
  const { world, feeder, out, s } = splitterLine("sorter", ["front", "left"]);
  s.filters = ["overflow", "iron-ore", "any"];
  removeAt(world, out.left[1].x, out.left[1].y);
  run(world, 60 * 15, feedList(feeder, Array(20).fill("iron-ore")));
  assert.ok(out.left[0].items.length <= 5);
  assert.equal(count(out.front[1].inventory, "iron-ore") + out.left[0].items.length, 20);
});

test("a sorter says when an item has nowhere to go, and holds it at the middle", () => {
  const { world, feeder, out, s } = splitterLine("sorter", ["front", "left"]);
  s.filters = ["iron-ore", "iron-ore", "any"]; // the right way would take it, but leads nowhere
  run(world, 60 * 5, feedList(feeder, ["copper-ore", "iron-ore"]));
  assert.equal(s.status, "no-exit");
  assert.deepEqual(s.items[0], { item: "copper-ore", pos: MID });
  assert.equal(total(out.front[1].inventory) + total(out.left[1].inventory), 0, "the iron behind it waits too");
  s.filters = ["iron-ore", "iron-ore", "overflow"];
  place(world, "belt", s.x, s.y + 1, 2);
  run(world, 60);
  assert.equal(s.status, "working");
  assert.equal(s.items.length, 0);
});

test("undergrounds and splitters saved mid-run carry on exactly as they would have", () => {
  const { world, feed } = crossing();
  const { x, y } = clearArea(world, 10);
  const s = place(world, "sorter", x, y, 1);
  s.filters = ["overflow", "copper-ore", "any"];
  place(world, "belt", x + 1, y, 1);
  place(world, "belt", x, y - 1, 0);
  put(s, "copper-ore");
  run(world, 60 * 5 + 7, feed);
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(serialize(loaded), serialize(world));
  run(world, 600, feed);
  // `feed` puts items on the world's belts; do the same on the loaded one's.
  const [feedEast] = [...loaded.entities.values()];
  const feedSouth = [...loaded.entities.values()].find((e) => e.type === "belt" && e.rot === 2);
  run(loaded, 600, (t) => {
    if (t % 10 === 0 && canTake(feedEast, "iron-ore")) put(feedEast, "iron-ore");
    if (t % 10 === 5 && canTake(feedSouth, "copper-ore")) put(feedSouth, "copper-ore");
  });
  assert.deepEqual(serialize(loaded), serialize(world));
});

test("a save with a broken underground pair is damaged", () => {
  const { world } = crossing();
  const good = serialize(world);
  const broken = [
    good.entities.map((e) => (e.type === "underground" && e.end === "out" ? { ...e, pair: null } : e)),
    good.entities.map((e) => (e.type === "underground" && e.end === "in" ? { ...e, items: [{ item: "iron-ore", pos: 999 }] } : e)),
  ];
  for (const entities of broken) {
    assert.throws(() => deserialize({ ...good, entities }), (err) => err instanceof SaveError && /damaged/.test(err.message));
  }
});
