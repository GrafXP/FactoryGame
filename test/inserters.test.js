import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, entityAt } from "../src/sim/world.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { canTake, put } from "../src/sim/transport.js";
import { SWING, swingOf, inserterEnds, setInserterFilter } from "../src/sim/inserter.js";
import { count, total } from "../src/sim/inventory.js";
import { serialize, deserialize, SaveError } from "../src/sim/save.js";
import { layoutOf, buildLayout } from "../src/sim/layout.js";
import { ruinOf } from "../src/sim/health.js";
import { lockedWhy } from "../src/sim/progress.js";
import { charge, ALL, clearArea } from "./helpers.js";

const KIT = { "iron-plate": 1000, "copper-plate": 1000, "iron-gear": 1000, "electronic-circuit": 1000, stone: 1000 };
const setup = () => createWorld({ milestones: ALL, seed: 3, kit: { ...KIT } });
const run = (world, ticks, each) => {
  for (let i = 0; i < ticks; i++) {
    each?.(i);
    charge(world);
    step(world);
  }
};
const LONG = swingOf("long-inserter");

test("a long inserter takes from right behind it and drops two tiles in front, over a belt", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6);
  const from = place(world, "chest", x, y, 1);
  for (let i = 0; i < 5; i++) put(from, "iron-plate");
  const ins = place(world, "long-inserter", x + 1, y, 1);
  const belt = place(world, "belt", x + 2, y, 2); // running across its way, south
  const to = place(world, "chest", x + 3, y, 1);
  assert.deepEqual(inserterEnds(ins), { from: { x, y }, to: { x: x + 3, y } });

  run(world, 1);
  assert.equal(ins.hand, "iron-plate");
  run(world, LONG);
  assert.equal(ins.swing, LONG, "the arm is over the far chest");
  run(world, 1);
  assert.equal(count(to.inventory, "iron-plate"), 1);

  run(world, 5 * (2 * LONG + 2), () => assert.equal(belt.items.length, 0, "nothing lands on the belt"));
  assert.equal(count(to.inventory, "iron-plate"), 5);
  assert.equal(total(from.inventory), 0);
  assert.ok(LONG > SWING, "it's a little slower than an inserter");
});

test("a long inserter with nothing two tiles out says so, whatever is right in front", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6);
  const from = place(world, "chest", x, y, 1);
  put(from, "iron-plate");
  const ins = place(world, "long-inserter", x + 1, y, 1);
  const near = place(world, "chest", x + 2, y, 1);
  run(world, 10);
  assert.equal(ins.status, "no-output");
  assert.equal(ins.hand, null);
  assert.equal(total(near.inventory), 0);
  assert.equal(count(from.inventory, "iron-plate"), 1);
});

test("a sorting inserter moves nothing until it's set, then only the item it's set to", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6);
  const from = place(world, "chest", x, y, 1);
  for (let i = 0; i < 3; i++) put(from, "iron-plate"), put(from, "copper-plate");
  const ins = place(world, "sorting-inserter", x + 1, y, 1);
  const to = place(world, "chest", x + 2, y, 1);
  assert.equal(ins.filter, null);

  run(world, 60);
  assert.equal(ins.status, "no-filter");
  assert.equal(total(to.inventory), 0);

  setInserterFilter(ins, "copper-plate");
  run(world, 3 * (2 * SWING + 2) + 10);
  assert.deepEqual(to.inventory.items, { "copper-plate": 3 });
  assert.equal(count(from.inventory, "iron-plate"), 3, "the iron is left where it is");
  assert.equal(ins.status, "idle");
  assert.throws(() => setInserterFilter(ins, "unobtainium"));
});

test("a sorting inserter picks its item off a mixed belt and lets the rest go by", () => {
  const world = setup();
  const { x, y } = clearArea(world, 8);
  const belts = [0, 1, 2, 3, 4].map((i) => place(world, "belt", x + i, y + 2, 1));
  const end = place(world, "chest", x + 5, y + 2, 1);
  const ins = place(world, "sorting-inserter", x + 2, y + 1, 0); // off the belt, north
  const top = place(world, "chest", x + 2, y, 0);
  setInserterFilter(ins, "coal");
  const fed = { "iron-ore": 0, coal: 0 };
  run(world, 60 * 40, (t) => {
    const item = t % 60 < 30 ? "iron-ore" : "coal";
    if (t % 30 === 0 && t < 60 * 30 && canTake(belts[0], item)) {
      put(belts[0], item);
      fed[item]++;
    }
  });
  assert.ok(count(top.inventory, "coal") > 0);
  assert.equal(total(top.inventory), count(top.inventory, "coal"), "only coal goes up");
  assert.equal(count(end.inventory, "iron-ore"), fed["iron-ore"], "the ore all goes by");
  assert.equal(count(top.inventory, "coal") + count(end.inventory, "coal"), fed.coal);
});

test("a save, a paste and a ruin keep a sorting inserter's filter, and loaded inserters carry on the same", () => {
  const world = setup();
  const { x, y } = clearArea(world, 10);
  const from = place(world, "chest", x, y, 1);
  Object.assign(from.inventory.items, { "iron-plate": 40, "copper-plate": 40 });
  const sorting = place(world, "sorting-inserter", x + 1, y, 1);
  setInserterFilter(sorting, "iron-plate");
  const mid = place(world, "chest", x + 2, y, 1);
  place(world, "long-inserter", x + 3, y, 1);
  place(world, "pole", x + 4, y, 0); // reached over
  const last = place(world, "chest", x + 5, y, 1);

  run(world, 200);
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(serialize(loaded), serialize(world));
  assert.equal(entityAt(loaded, x + 1, y).filter, "iron-plate");
  run(world, 1200);
  run(loaded, 1200);
  assert.deepEqual(serialize(loaded), serialize(world));
  assert.ok(count(last.inventory, "iron-plate") > 0, "plates got over the pole");
  assert.equal(count(mid.inventory, "copper-plate") + count(last.inventory, "copper-plate"), 0);

  const layout = layoutOf([sorting]);
  assert.equal(layout.parts[0].filter, "iron-plate");
  const { built } = buildLayout(world, layout, x, y + 2);
  assert.equal(built[0].filter, "iron-plate");
  assert.equal(ruinOf(sorting, world.tick).filter, "iron-plate");

  const bad = serialize(world);
  bad.entities.find((e) => e.type === "sorting-inserter").filter = "unobtainium";
  assert.throws(() => deserialize(bad), SaveError);
  const swung = serialize(world);
  swung.entities.find((e) => e.type === "long-inserter").swing = LONG + 1;
  assert.throws(() => deserialize(swung), SaveError);
});

test("long inserters unlock with logistics, and sorting inserters with assembly", () => {
  const at = (milestones) => createWorld({ milestones, seed: 3 });
  assert.ok(lockedWhy(at(1), "long-inserter"));
  assert.equal(lockedWhy(at(2), "long-inserter"), null);
  assert.ok(lockedWhy(at(2), "sorting-inserter"));
  assert.equal(lockedWhy(at(3), "sorting-inserter"), null);
  for (const type of ["long-inserter", "sorting-inserter"]) {
    assert.ok(BUILDINGS[type].draw, `${type} runs on power`);
  }
});
