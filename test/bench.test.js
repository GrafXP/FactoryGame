import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, removeAt } from "../src/sim/world.js";
import { serialize, deserialize } from "../src/sim/save.js";
import { benchWorld, benchCounts, drain } from "../src/sim/bench.js";
import { put } from "../src/sim/transport.js";
import { add, count, total } from "../src/sim/inventory.js";
import { TICK_RATE } from "../src/sim/world.js";
import { charge, ALL, clearArea } from "./helpers.js";

const run = (world, sinks, ticks) => {
  for (let i = 0; i < ticks; i++) {
    step(world);
    drain(sinks);
  }
};
const statuses = (world, type) => {
  const found = {};
  for (const e of world.entities.values()) if (e.type === type) found[e.status] = (found[e.status] || 0) + 1;
  return found;
};

test("the big benchmark is the plan's target: 3,000 buildings and 15,000 items on belts", () => {
  const { world, sinks } = benchWorld("big");
  const { buildings, belts } = benchCounts(world);
  assert.ok(buildings - belts >= 3000, `${buildings - belts} buildings besides belts`);
  run(world, sinks, 40 * TICK_RATE); // by when the belts have filled to how they run
  const { items } = benchCounts(world);
  assert.ok(items >= 14500 && items <= 15500, `${items} items on belts once it's running`);
});

test("the benchmark factory runs flat out", () => {
  const { world, sinks } = benchWorld("small");
  run(world, sinks, 90 * TICK_RATE);
  const miners = statuses(world, "miner");
  // The miners on ore run all the time; those feeding a generator are held up by it.
  assert.equal(miners.working, 14);
  assert.equal(miners.full, 6);
  const furnaces = statuses(world, "furnace");
  const assemblers = statuses(world, "assembler");
  assert.ok(furnaces.working >= 10, JSON.stringify(furnaces));
  assert.ok(assemblers.working >= 9, JSON.stringify(assemblers));
  assert.deepEqual(statuses(world, "generator"), { working: 6 });
  assert.ok(sinks.every((chest) => total(chest.inventory) === 0), "drain empties the chests at the ends");
});

test("a saved benchmark factory runs tick-for-tick like the one it was saved from", () => {
  const { world, sinks } = benchWorld("small");
  run(world, sinks, 15 * TICK_RATE);
  const loaded = deserialize(structuredClone(serialize(world)));
  const loadedSinks = sinks.map((chest) => loaded.entities.get(chest.id));
  assert.deepEqual(serialize(loaded), serialize(world));
  run(world, sinks, 30 * TICK_RATE);
  run(loaded, loadedSinks, 30 * TICK_RATE);
  assert.deepEqual(serialize(loaded), serialize(world));
});

test("there's no benchmark by another name", () => {
  assert.throws(() => benchWorld("huge"), /No benchmark/);
});

// The sim keeps what each machine needs of its neighbours until the layout
// changes; building and removing next to one has to reach it.
test("an inserter keeps up with the buildings round it as they're built and removed", () => {
  const world = createWorld({ milestones: ALL, seed: 5, kit: { "iron-plate": 100, "iron-gear": 20, "electronic-circuit": 20 } });
  const { x, y } = clearArea(world, 4);
  const from = place(world, "chest", x, y);
  const ins = place(world, "inserter", x + 1, y, 1);
  let to = place(world, "chest", x + 2, y);
  add(from.inventory, "iron-ore", 10);
  const tick = (n) => {
    for (let i = 0; i < n; i++) {
      charge(world);
      step(world);
    }
  };
  tick(4 * 48);
  assert.equal(count(to.inventory, "iron-ore"), 4);

  removeAt(world, x + 2, y);
  tick(48);
  assert.equal(ins.status, "no-output");
  to = place(world, "chest", x + 2, y);
  tick(48);
  assert.equal(count(to.inventory, "iron-ore"), 1, "it drops into the new chest");

  removeAt(world, x, y);
  const belt = place(world, "belt", x, y, 0);
  put(belt, "copper-ore");
  tick(2 * 48);
  assert.equal(count(to.inventory, "copper-ore"), 1, "it takes from the belt put in the chest's place");
});
