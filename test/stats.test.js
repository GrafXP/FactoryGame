import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, startMining, stopMining, deliverToHub, deliverAllToHub, TICK_RATE } from "../src/sim/world.js";
import { put } from "../src/sim/transport.js";
import { fillFrom } from "../src/sim/furnace.js";
import { setRecipe, fillAssembler } from "../src/sim/assembler.js";
import { fuelGenerator } from "../src/sim/generator.js";
import { queueCraft, cancelCraft, handTime } from "../src/sim/crafting.js";
import { stillNeeded } from "../src/sim/progress.js";
import { ORE } from "../src/sim/map.js";
import { ITEMS } from "../src/sim/items.js";
import { serialize, deserialize } from "../src/sim/save.js";
import { MADE, USED, BUCKETS, POWER, produced, perMinute, history, covered, itemsSeen, activityOf } from "../src/sim/stats.js";
import { charge, ALL, clearArea, oreBlock } from "./helpers.js";

const MINUTE = 60 * TICK_RATE;
const [ONE_MIN, TEN_MIN, HOUR] = [0, 1, 2];
const KIT = { "iron-plate": 5000, "iron-gear": 1000, "electronic-circuit": 1000, "copper-cable": 1000, stone: 1000, coal: 1000, "iron-ore": 1000 };
const setup = (milestones = ALL) => createWorld({ milestones, seed: 3, kit: { ...KIT } });
const run = (world, ticks) => {
  for (let i = 0; i < ticks; i++) {
    charge(world);
    step(world);
  }
};
// What went into the rings over window w: the sum of its buckets.
const total = (world, item, w, kind) => history(world, item, w, kind).reduce((a, v) => a + (v || 0), 0);

// Furnaces side by side on clear ground, each given 50 iron ore and 10 coal by hand.
const furnaces = (n) => {
  const world = setup();
  const { x, y } = clearArea(world, 2 * n + 2, 4);
  const list = [];
  for (let i = 0; i < n; i++) {
    const f = place(world, "furnace", x + 2 * i, y, 0);
    fillFrom(f, world.inventory, "iron-ore", 50);
    fillFrom(f, world.inventory, "coal", 10);
    list.push(f);
  }
  return { world, list };
};

test("a furnace's plates count as made, and the ore and coal it smelts with as used", () => {
  const { world } = furnaces(1);
  run(world, MINUTE / 2); // a plate a second, and a coal every 8 s
  assert.equal(total(world, "iron-plate", ONE_MIN, MADE), 30);
  assert.equal(total(world, "iron-ore", ONE_MIN, USED), 30);
  assert.equal(total(world, "coal", ONE_MIN, USED), 4);
  assert.equal(total(world, "iron-plate", ONE_MIN, USED), 0);
  assert.equal(perMinute(world, "iron-plate", ONE_MIN, MADE), 60, "over the half minute there's been, not a whole one");
  assert.deepEqual(itemsSeen(world, ONE_MIN, Object.keys(ITEMS)), ["iron-ore", "coal", "iron-plate"]);
});

test("a second furnace doubles plate production", () => {
  const one = furnaces(1).world;
  const two = furnaces(2).world;
  run(one, MINUTE / 2);
  run(two, MINUTE / 2);
  assert.equal(perMinute(two, "iron-plate", ONE_MIN, MADE), 2 * perMinute(one, "iron-plate", ONE_MIN, MADE));
});

test("nothing is counted before the first second is up, and the history starts empty", () => {
  const { world } = furnaces(1);
  run(world, TICK_RATE - 1);
  assert.equal(perMinute(world, "iron-plate", ONE_MIN, MADE), null);
  assert.equal(covered(world, ONE_MIN), 0);
  run(world, 1);
  assert.equal(covered(world, ONE_MIN), 1);
  const h = history(world, "iron-plate", ONE_MIN, MADE);
  assert.equal(h.length, BUCKETS);
  assert.deepEqual(h.slice(-2), [null, 1], "the newest bucket is last");
});

test("the 10-minute and hour windows add up the seconds, and each window forgets what's older", () => {
  const world = setup();
  let on = true;
  const tick = () => {
    if (on && world.tick % TICK_RATE === 0) produced(world.stats, "iron-ore"); // an ore a second, as a miner digs
    step(world);
  };
  for (let i = 0; i < 61 * MINUTE; i++) tick();
  assert.equal(perMinute(world, "iron-ore", ONE_MIN, MADE), 60);
  assert.equal(perMinute(world, "iron-ore", TEN_MIN, MADE), 60);
  assert.equal(perMinute(world, "iron-ore", HOUR, MADE), 60);
  assert.equal(total(world, "iron-ore", TEN_MIN, MADE), 600);
  assert.equal(total(world, "iron-ore", HOUR, MADE), 3600, "the hour's ring has the last 60 minutes, not 61");
  assert.equal(covered(world, HOUR), BUCKETS);

  // Stopped: the last minute empties, the longer windows still remember.
  on = false;
  for (let i = 0; i < MINUTE; i++) tick();
  assert.equal(perMinute(world, "iron-ore", ONE_MIN, MADE), 0);
  assert.equal(total(world, "iron-ore", TEN_MIN, MADE), 540);
  assert.deepEqual(itemsSeen(world, ONE_MIN, ["iron-ore"]), []);
  assert.deepEqual(itemsSeen(world, TEN_MIN, ["iron-ore"]), ["iron-ore"]);
});

test("hand-mining counts as made", () => {
  const world = setup();
  const { x, y } = oreBlock(world, ORE.COPPER);
  assert.equal(startMining(world, x, y), null);
  run(world, TICK_RATE * 5);
  stopMining(world);
  assert.equal(total(world, "copper-ore", ONE_MIN, MADE), 10);
});

test("a hand-craft counts when it's done, and one called off counts nothing", () => {
  const world = setup();
  queueCraft(world, "iron-gear", 1);
  run(world, 10);
  cancelCraft(world, 0);
  run(world, TICK_RATE - 10);
  assert.equal(total(world, "iron-plate", ONE_MIN, USED), 0, "called off: the plates came back");
  queueCraft(world, "iron-gear", 2);
  run(world, 2 * handTime("iron-gear") + TICK_RATE);
  assert.equal(total(world, "iron-gear", ONE_MIN, MADE), 2);
  assert.equal(total(world, "iron-plate", ONE_MIN, USED), 4);
});

test("an assembler's items count as made, and its ingredients as used once a craft is done", () => {
  const world = setup();
  const { x, y } = clearArea(world, 4);
  const a = place(world, "assembler", x, y, 0);
  setRecipe(a, "iron-gear", world.inventory);
  fillAssembler(a, world.inventory, "iron-plate", 10);
  run(world, MINUTE / 2); // a gear every 2 s
  assert.equal(total(world, "iron-gear", ONE_MIN, MADE), 5, "10 plates make 5");
  assert.equal(total(world, "iron-plate", ONE_MIN, USED), 10);
});

test("what the HUB is given counts as used, by belt or by hand", () => {
  const world = setup(0);
  const { x, y } = clearArea(world, 5);
  const hub = place(world, "hub", x, y, 0);
  put(hub, "iron-plate");
  assert.equal(deliverToHub(world, "iron-plate", 4), 4);
  const rest = stillNeeded(world.progress, "iron-plate");
  assert.deepEqual(deliverAllToHub(world), { "iron-plate": rest }, "the kit has no bricks");
  run(world, TICK_RATE);
  assert.equal(total(world, "iron-plate", ONE_MIN, USED), 5 + rest);
});

test("a generator's coal counts as used", () => {
  const world = setup();
  const { x, y } = clearArea(world, 10);
  const gen = place(world, "generator", x, y, 0);
  place(world, "pole", x + 3, y + 2, 0);
  const a = place(world, "assembler", x + 4, y + 3, 0);
  setRecipe(a, "iron-gear", world.inventory);
  fillAssembler(a, world.inventory, "iron-plate");
  fuelGenerator(gen, world.inventory, "coal", 5);
  for (let i = 0; i < MINUTE; i++) step(world);
  assert.ok(total(world, "coal", ONE_MIN, USED) > 0);
});

test("statistics survive a save and load, and carry on the same", () => {
  const { world } = furnaces(2);
  run(world, MINUTE / 2 + 20); // part way through a second
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(serialize(loaded).stats, serialize(world).stats);
  run(world, MINUTE);
  run(loaded, MINUTE);
  assert.deepEqual(serialize(loaded).stats, serialize(world).stats);
  assert.equal(perMinute(loaded, "iron-plate", TEN_MIN, MADE), perMinute(world, "iron-plate", TEN_MIN, MADE));
});

test("a save from before statistics starts counting when it's loaded", () => {
  const { world } = furnaces(1);
  run(world, MINUTE / 2);
  const { stats, ...v7 } = { ...serialize(world), version: 7 };
  const loaded = deserialize(structuredClone(v7));
  assert.equal(loaded.stats.since, world.tick);
  assert.equal(perMinute(loaded, "iron-plate", ONE_MIN, MADE), null);
  run(loaded, 10 * TICK_RATE);
  assert.equal(covered(loaded, ONE_MIN), 10);
  assert.equal(perMinute(loaded, "iron-plate", ONE_MIN, MADE), 60, "over the 10 s since it was loaded");
});

test("a machine's activity says how much it worked, and what held it up", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6);
  const furnace = place(world, "furnace", x, y, 0);
  fillFrom(furnace, world.inventory, "iron-ore", 50);
  fillFrom(furnace, world.inventory, "coal", 10);
  const idle = place(world, "assembler", x + 2, y, 0);
  setRecipe(idle, "iron-gear", world.inventory);
  run(world, MINUTE / 2);
  assert.deepEqual(activityOf(world, furnace).share, { working: 1 });
  assert.equal(activityOf(world, furnace).seconds, 30);
  assert.deepEqual(activityOf(world, idle).share, { "no-input": 1 });

  // It covers the last minute, not all time: 20 s waiting, then 40 s working
  // through 50 plates' worth of gears.
  fillAssembler(idle, world.inventory, "iron-plate", 50);
  run(world, (MINUTE * 2) / 3);
  const a = activityOf(world, idle);
  assert.equal(a.seconds, 60);
  assert.ok(Math.abs(a.share.working - 2 / 3) < 0.01, `working ${a.share.working}`);
  assert.ok(Math.abs(a.share["no-input"] - 1 / 3) < 0.01);
});

test("machines short of power count the ticks they wait for it", () => {
  const world = setup();
  const { x, y } = clearArea(world, 22);
  const assemblers = [];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const a = place(world, "assembler", x + 4 * i, y + 4 * j, 0);
      setRecipe(a, "iron-gear", world.inventory);
      fillAssembler(a, world.inventory, "iron-plate");
      assemblers.push(a);
    }
  }
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) place(world, "pole", x + 3 + 4 * i, y + 3 + 4 * j, 0);
  place(world, "pole", x + 3, y + 15, 0);
  const gen = place(world, "generator", x, y + 16, 0);
  fuelGenerator(gen, world.inventory, "coal");
  for (let i = 0; i < MINUTE; i++) step(world); // twice what the generator makes is asked for
  const { share } = activityOf(world, assemblers[5]);
  assert.ok(Math.abs(share.working - 0.5) < 0.05, `working ${share.working}`);
  assert.ok(Math.abs(share["no-power"] - 0.5) < 0.05, `no power ${share["no-power"]}`);
});

test("power made and asked for are counted, and a network short of power asks for more than it gets", () => {
  const world = setup();
  const { x, y } = clearArea(world, 10);
  const gen = place(world, "generator", x, y, 0);
  fuelGenerator(gen, world.inventory, "coal", 5);
  place(world, "pole", x + 3, y + 2, 0);
  const a = place(world, "assembler", x + 4, y + 3, 0);
  setRecipe(a, "iron-gear", world.inventory);
  fillAssembler(a, world.inventory, "iron-plate");
  for (let i = 0; i < MINUTE; i++) step(world);
  const made = total(world, POWER, ONE_MIN, MADE);
  assert.ok(made > 0);
  assert.equal(total(world, POWER, ONE_MIN, USED), made, "with enough power, it gets all it asks for");
  assert.equal(made, 5 * 4_000_000 - gen.burn - (gen.fuel?.n || 0) * 4_000_000, "what the coal it burnt made");

  // 16 assemblers on one generator: they ask for twice what it makes.
  const short = setup();
  const { x: sx, y: sy } = clearArea(short, 22);
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const m = place(short, "assembler", sx + 4 * i, sy + 4 * j, 0);
      setRecipe(m, "iron-gear", short.inventory);
      fillAssembler(m, short.inventory, "iron-plate");
    }
  }
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) place(short, "pole", sx + 3 + 4 * i, sy + 3 + 4 * j, 0);
  place(short, "pole", sx + 3, sy + 15, 0);
  fuelGenerator(place(short, "generator", sx, sy + 16, 0), short.inventory, "coal");
  for (let i = 0; i < MINUTE; i++) step(short);
  const ratio = perMinute(short, POWER, ONE_MIN, MADE) / perMinute(short, POWER, ONE_MIN, USED);
  assert.ok(Math.abs(ratio - 0.5) < 0.05, `got ${ratio} of what was asked for`);
  const loaded = deserialize(structuredClone(serialize(short)));
  assert.deepEqual(loaded.stats.series[POWER], short.stats.series[POWER], "and it's saved");
});
