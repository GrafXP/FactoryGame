import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, entityAt } from "../src/sim/world.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { put, BELT_LEN } from "../src/sim/transport.js";
import { buried } from "../src/sim/underground.js";
import { count, total } from "../src/sim/inventory.js";
import { entitiesIn, layoutOf, rotateLayout, layoutCost, planLayout, buildLayout, layoutFits, removeEntities } from "../src/sim/layout.js";
import { LIMIT } from "../src/sim/chunks.js";
import { charge, ALL, clearArea } from "./helpers.js";

const KIT = { "iron-plate": 5000, "iron-gear": 1000, "electronic-circuit": 1000, stone: 1000, "copper-cable": 100 };
const setup = (kit = KIT) => createWorld({ milestones: ALL, seed: 3, kit: { ...kit } });
const run = (world, ticks) => {
  for (let i = 0; i < ticks; i++) {
    charge(world);
    step(world);
  }
};
const types = (list) => list.map((e) => e.type);

// Two rows of chest → inserter → furnace → inserter → chest, facing east, one
// above the other: 6 tiles wide, 4 tall.
const furnaceColumn = (world, X, Y) => {
  for (const y of [Y, Y + 2]) {
    place(world, "chest", X, y, 0);
    place(world, "inserter", X + 1, y, 1);
    place(world, "furnace", X + 2, y, 0);
    place(world, "inserter", X + 4, y, 1);
    place(world, "chest", X + 5, y, 0);
  }
};
const stock = (chest) => Object.assign(chest.inventory.items, { "iron-ore": 20, coal: 5 });

test("copying a furnace column with its inserters and pasting it next to the first builds a working copy", () => {
  const world = setup();
  const { x: X, y: Y } = clearArea(world, 14, 5);
  furnaceColumn(world, X, Y);
  const layout = layoutOf(entitiesIn(world, { x: X, y: Y, w: 6, h: 4 }));
  assert.deepEqual([layout.w, layout.h], [6, 4]);
  assert.equal(layout.parts.length, 10);

  const r = buildLayout(world, layout, X + 7, Y);
  assert.equal(r.built.length, 10);
  assert.deepEqual(types(r.built), types(layout.parts));
  for (const y of [Y, Y + 2]) stock(entityAt(world, X + 7, y));
  run(world, 60 * 15);
  for (const y of [Y, Y + 2]) {
    const out = entityAt(world, X + 12, y);
    assert.equal(out.type, "chest");
    assert.ok(count(out.inventory, "iron-plate") >= 5, `${count(out.inventory, "iron-plate")} plates at row ${y - Y}`);
  }
  assert.equal(total(entityAt(world, X + 5, Y).inventory), 0, "the first column was never fed");
});

test("a paste pays for each building and leaves out what it holds", () => {
  const world = setup();
  const { x, y } = clearArea(world, 10);
  const chest = place(world, "chest", x, y, 0);
  chest.inventory.items["iron-ore"] = 30;
  const before = count(world.inventory, "iron-plate");
  const r = buildLayout(world, layoutOf([chest]), x + 3, y);
  assert.equal(total(r.built[0].inventory), 0);
  assert.equal(count(world.inventory, "iron-plate"), before - BUILDINGS.chest.cost["iron-plate"]);
});

test("recipes, sorter filters and underground pairs come along", () => {
  const world = setup();
  const { x, y } = clearArea(world, 12);
  const asm = place(world, "assembler", x, y, 0);
  asm.recipe = "iron-gear";
  const sorter = place(world, "sorter", x + 3, y, 1);
  sorter.filters = ["iron-ore", "overflow", "any"];
  const entrance = place(world, "underground", x, y + 4, 1);
  place(world, "belt", x + 1, y + 4, 0); // under the tunnel
  const exit = place(world, "underground", x + 3, y + 4, 1, { end: "out" });
  assert.equal(entrance.pair, exit.id);

  const r = buildLayout(world, layoutOf(entitiesIn(world, { x, y, w: 4, h: 5 })), x + 5, y);
  assert.equal(r.built.length, 5);
  const [a, s, i, , o] = r.built;
  assert.equal(a.recipe, "iron-gear");
  assert.equal(a.status, "no-input");
  assert.deepEqual(s.filters, ["iron-ore", "overflow", "any"]);
  assert.notEqual(s.filters, sorter.filters, "a copy, not the same array");
  assert.deepEqual([i.end, o.end], ["in", "out"]);
  assert.equal(i.pair, o.id);
  assert.equal(o.pair, i.id);
});

test("an exit built before its entrance still pastes, after it", () => {
  const world = setup();
  const { x, y } = clearArea(world, 12);
  const first = place(world, "underground", x, y, 1);
  const exit = place(world, "underground", x + 4, y, 1, { end: "out" });
  removeEntities(world, [first]);
  const entrance = place(world, "underground", x + 1, y, 1); // built after its exit
  assert.equal(entrance.pair, exit.id);
  const layout = layoutOf([exit, entrance]);
  assert.deepEqual(layout.parts.map((p) => p.end), ["out", "in"]);
  const r = buildLayout(world, layout, x, y + 2);
  assert.deepEqual(r.built.map((e) => e.end), ["in", "out"]);
  assert.equal(r.built[0].pair, r.built[1].id);
});

test("a paste that's partly blocked builds the parts that fit and counts the rest", () => {
  const world = setup();
  const { x, y } = clearArea(world, 12);
  const line = [0, 1, 2, 3].map((i) => place(world, "belt", x + i, y, 1));
  const layout = layoutOf(line);
  place(world, "chest", x + 1, y + 2, 0); // in the way of the second belt
  const r = buildLayout(world, layout, x, y + 2);
  assert.equal(r.built.length, 3);
  assert.deepEqual([r.total, r.blocked, r.locked, r.unpaid, r.short], [4, 1, 0, 0, null]);
  assert.deepEqual(r.built.map((b) => b.x - x), [0, 2, 3]);
});

test("a paste builds as much as the inventory pays for, in order, and says what's missing", () => {
  const world = setup({ "iron-plate": 6 });
  const { x, y } = clearArea(world, 12);
  world.inventory.items["iron-plate"] = 100;
  const line = [0, 1, 2, 3, 4].map((i) => place(world, "belt", x + i, y, 1));
  world.inventory.items["iron-plate"] = 3;
  const plan = planLayout(world, layoutOf(line), x, y + 2);
  assert.deepEqual(plan.map((p) => p.why), [null, null, null, "unpaid", "unpaid"]);
  const r = buildLayout(world, layoutOf(line), x, y + 2);
  assert.equal(r.built.length, 3);
  assert.equal(r.unpaid, 2);
  assert.deepEqual(r.short, { "iron-plate": 2 });
  assert.equal(count(world.inventory, "iron-plate"), 0);
});

test("locked buildings, a second HUB and an exit without an entrance are planned as skipped", () => {
  const world = setup();
  const { x, y } = clearArea(world, 14);
  place(world, "hub", x, y, 0);
  const lone = { x: 0, y: 0, w: 1, h: 1, parts: [{ id: 99, type: "underground", end: "out", x: 0, y: 0, rot: 1 }] };
  assert.equal(planLayout(world, lone, x + 6, y)[0].why, "blocked", "an exit has to have an entrance");
  const hub = layoutOf([entityAt(world, x, y)]);
  assert.equal(planLayout(world, hub, x + 6, y)[0].why, "blocked", "only one HUB");
  const fresh = createWorld({ seed: 3, kit: { ...KIT } });
  const asm = { x: 0, y: 0, w: 3, h: 3, parts: [{ id: 1, type: "assembler", x: 0, y: 0, rot: 0 }] };
  assert.equal(planLayout(fresh, asm, x, y)[0].why, "locked");
});

test("removing a selection gives back everything in it, including what's on its belts", () => {
  const world = setup();
  const { x, y } = clearArea(world, 12);
  const belt = place(world, "belt", x, y, 1);
  put(belt, "iron-ore");
  const chest = place(world, "chest", x + 1, y, 0);
  chest.inventory.items.coal = 7;
  const furnace = place(world, "furnace", x + 2, y, 0);
  furnace.input = { item: "copper-ore", n: 3 };
  const entrance = place(world, "underground", x, y + 2, 1);
  place(world, "underground", x + 4, y + 2, 1, { end: "out" });
  entrance.items.push({ item: "stone", pos: BELT_LEN * 3 }, { item: "stone", pos: BELT_LEN * 2 });
  assert.equal(buried(entrance).length, 2);

  const list = entitiesIn(world, { x, y, w: 5, h: 3 });
  assert.equal(list.length, 5);
  const before = { ...world.inventory.items };
  const back = removeEntities(world, list);
  const cost = layoutCost(layoutOf(list));
  assert.deepEqual(back, { ...cost, "iron-ore": 1, coal: 7, "copper-ore": 3, stone: 2 + (cost.stone || 0) });
  for (const [id, n] of Object.entries(back)) assert.equal(count(world.inventory, id), (before[id] || 0) + n, id);
  assert.equal(world.entities.size, 0);
});

test("a selection box picks up every building with a tile in it, in build order", () => {
  const world = setup();
  const { x, y } = clearArea(world, 12);
  const miner = place(world, "miner", x, y, 0);
  const chest = place(world, "chest", x + 4, y, 0);
  const belt = place(world, "belt", x + 2, y + 1, 0);
  assert.deepEqual(entitiesIn(world, { x: x + 1, y: y + 1, w: 2, h: 1 }), [miner, belt], "a corner of the miner is enough");
  assert.deepEqual(entitiesIn(world, { x: x + 3, y: y + 2, w: 3, h: 3 }), []);
  const layout = layoutOf([chest, miner]);
  assert.deepEqual([layout.x, layout.y, layout.w, layout.h], [x, y, 5, 2]);
});

test("rotating a layout turns each building with it, and four turns give it back", () => {
  // → → ↓   a belt line turning south, 3 wide and 2 tall, with a 3×2 generator below
  //     ↓
  const world = setup();
  const { x, y } = clearArea(world, 12);
  const list = [place(world, "belt", x, y, 1), place(world, "belt", x + 1, y, 1), place(world, "belt", x + 2, y, 2), place(world, "belt", x + 2, y + 1, 2)];
  list.push(place(world, "generator", x, y + 2, 0));
  const layout = layoutOf(list);
  assert.deepEqual([layout.w, layout.h], [3, 4]);
  const turned = rotateLayout(layout);
  assert.deepEqual([turned.w, turned.h], [4, 3]);
  // Turned clockwise: the line runs south then west, down the right-hand side; the
  // generator stands on its end on the left.
  assert.deepEqual(
    turned.parts.map((p) => [p.type, p.x, p.y, p.rot]),
    [
      ["belt", 3, 0, 2],
      ["belt", 3, 1, 2],
      ["belt", 3, 2, 3],
      ["belt", 2, 2, 3],
      ["generator", 0, 0, 1],
    ],
  );
  let back = layout;
  for (let i = 0; i < 4; i++) back = rotateLayout(back);
  assert.deepEqual(back, layout);
});

test("a turned layout fits where the buildings it came from stand", () => {
  const world = setup();
  const { x, y } = clearArea(world, 12);
  const list = [0, 1, 2].map((i) => place(world, "belt", x + i, y + 1, 1));
  const blocker = place(world, "chest", x + 1, y, 0);
  const turned = rotateLayout(layoutOf(list));
  assert.deepEqual([turned.x, turned.y, turned.w, turned.h], [x + 1, y, 1, 3]);
  const ignore = new Set(list.map((e) => e.id));
  assert.equal(layoutFits(world, turned, turned.x, turned.y, ignore), "Something is in the way");
  removeEntities(world, [blocker]);
  assert.equal(layoutFits(world, turned, turned.x, turned.y, ignore), null);
  assert.equal(layoutFits(world, turned, turned.x, turned.y), "Something is in the way", "unless they're counted as gone");
  assert.equal(layoutFits(world, turned, LIMIT, 0), "Off the map");
});
