import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, removeAt, TICK_RATE } from "../src/sim/world.js";
import { fillFrom } from "../src/sim/furnace.js";
import { fuelGenerator } from "../src/sim/generator.js";
import { setRecipe, fillAssembler } from "../src/sim/assembler.js";
import { getChunk, forgetChunks } from "../src/sim/chunks.js";
import { CHUNK, WATER } from "../src/sim/map.js";
import { ITEMS } from "../src/sim/items.js";
import { serialize, deserialize } from "../src/sim/save.js";
import { MADE, USED, POLLUTION, history, itemsSeen } from "../src/sim/stats.js";
import { UNIT, GROUND, LAKE, emit, absorption, homeChunk, generatorEmits, pollutionTotal } from "../src/sim/pollution.js";
import { charge, ALL, clearArea, findTile } from "./helpers.js";

const MINUTE = 60 * TICK_RATE;
const KIT = { "iron-plate": 5000, "iron-gear": 1000, "electronic-circuit": 1000, "copper-cable": 1000, stone: 1000, coal: 1000, "iron-ore": 1000 };
const setup = () => createWorld({ milestones: ALL, seed: 3, kit: { ...KIT } });
const run = (world, ticks) => {
  for (let i = 0; i < ticks; i++) {
    charge(world);
    step(world);
  }
};
const sum = (list) => list.reduce((a, v) => a + (v || 0), 0);

// Gives off `perMinute` units a minute into chunk (0, 0) for `seconds`, a second's
// worth at the start of each, as a factory there would.
const source = (world, perMinute, seconds) => {
  const c = getChunk(world, 0, 0);
  for (let s = 0; s < seconds; s++) {
    if (perMinute) emit(world, c, (perMinute * UNIT) / 60);
    for (let i = 0; i < TICK_RATE; i++) step(world);
  }
};

test("a working furnace gives off pollution into its chunk, and an idle one gives off none", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6, 2);
  const busy = place(world, "furnace", x, y, 0);
  fillFrom(busy, world.inventory, "iron-ore", 50);
  fillFrom(busy, world.inventory, "coal", 10);
  const idle = place(world, "furnace", x + 4, y, 0);
  fillFrom(idle, world.inventory, "coal", 10);
  run(world, TICK_RATE / 2);
  const c = homeChunk(world, busy);
  assert.equal(c.pollution, 30 * 6, "6 units a minute is 6 for each tick it works");
  assert.ok(world.polluted.has(c));
  assert.equal(homeChunk(world, idle), c, "both in the same chunk, so all of it is the busy one's");
});

test("a coal generator gives off its pollution as it lights each coal, and an idle one none", () => {
  const world = setup();
  const { x, y } = clearArea(world, 10);
  const gen = place(world, "generator", x, y, 0);
  fuelGenerator(gen, world.inventory, "coal", 5);
  place(world, "pole", x + 3, y + 2, 0);
  for (let i = 0; i < 2 * TICK_RATE; i++) step(world);
  assert.equal(pollutionTotal(world), 0, "nothing on its network draws power");

  const a = place(world, "assembler", x + 4, y + 3, 0);
  setRecipe(a, "iron-gear", world.inventory);
  fillAssembler(a, world.inventory, "iron-plate");
  for (let i = 0; i < 30; i++) step(world);
  assert.equal(generatorEmits("coal"), 30 * 400, "30 units a minute, for the 400 ticks a coal lasts at full power");
  assert.equal(world.stats.now.made[POLLUTION], generatorEmits("coal") + 30 * 2, "one coal lit, and the assembler's 2 a minute");
});

test("pollution spreads to the chunks round it and levels off where the ground takes in what reaches it", () => {
  const world = setup();
  source(world, 400, 60);
  const oneMin = pollutionTotal(world);
  const spread = world.polluted.size;
  assert.ok(spread > 1, "it has reached the neighbours");
  source(world, 400, 4 * 60);
  const fiveMin = pollutionTotal(world);
  assert.ok(fiveMin > oneMin * 1.1, `the cloud grows for a few minutes (${oneMin} → ${fiveMin})`);
  assert.ok(world.polluted.size > spread);
  source(world, 400, 10 * 60);
  const fifteen = pollutionTotal(world);
  source(world, 400, 5 * 60);
  assert.ok(Math.abs(pollutionTotal(world) - fifteen) < fifteen * 0.01, "then stops growing");
  const size = world.polluted.size;
  assert.ok(size < 100, `and stays within a few chunks (${size})`);
});

test("with nothing giving it off, the cloud fades away", () => {
  const world = setup();
  source(world, 400, 5 * 60);
  assert.ok(world.polluted.size > 5);
  source(world, 0, 10 * 60);
  assert.equal(pollutionTotal(world), 0);
  assert.equal(world.polluted.size, 0);
});

test("everything given off is either still in the air or taken in by the ground", () => {
  const world = setup();
  source(world, 777, 3 * 60);
  const made = sum(history(world, POLLUTION, 1, MADE)); // the last 10 minutes, so all of it
  const used = sum(history(world, POLLUTION, 1, USED));
  assert.equal(made, 777 * 3 * UNIT, "counted as made in the statistics");
  assert.ok(used > 0);
  assert.equal(made - used, pollutionTotal(world) * UNIT);
});

test("water takes in more than dry ground", () => {
  const world = setup();
  const lake = findTile(world, (x, y) => getChunk(world, Math.floor(x / CHUNK), Math.floor(y / CHUNK)).ore.every((k) => k === WATER), 400);
  const wet = getChunk(world, Math.floor(lake.x / CHUNK), Math.floor(lake.y / CHUNK));
  assert.equal(absorption(wet), CHUNK * CHUNK * LAKE);
  const dry = getChunk(world, 0, 0);
  assert.ok(dry.ore.every((k) => k !== WATER));
  assert.equal(absorption(dry), CHUNK * CHUNK * GROUND);
  assert.ok(LAKE > GROUND);
});

test("pollution isn't an item in the production statistics", () => {
  const world = setup();
  source(world, 100, 10);
  assert.ok(!itemsSeen(world, 0, Object.keys(ITEMS)).includes(POLLUTION));
  assert.ok(world.stats.series[POLLUTION] instanceof Float64Array);
});

test("polluted land isn't let go of, and clean land is", () => {
  const world = setup();
  source(world, 400, 60);
  const n = world.polluted.size;
  forgetChunks(world, 1000, 1000, 1000, 1000);
  assert.equal([...world.chunks.values()].filter((c) => c.pollution).length, n);
  for (const c of world.polluted) assert.equal(getChunk(world, c.cx, c.cy), c);
});

test("pollution survives a save and load, and carries on the same", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6, 2);
  for (let i = 0; i < 2; i++) {
    const f = place(world, "furnace", x + 2 * i, y, 0);
    fillFrom(f, world.inventory, "iron-ore", 50);
    fillFrom(f, world.inventory, "coal", 10);
  }
  source(world, 600, 90);
  run(world, MINUTE / 2 + 20); // part way through a second
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(serialize(loaded).pollution, serialize(world).pollution);
  run(world, 2 * MINUTE);
  run(loaded, 2 * MINUTE);
  assert.deepEqual(serialize(loaded).pollution, serialize(world).pollution);
  assert.deepEqual(serialize(loaded).stats, serialize(world).stats);
});

test("a save from before pollution loads with clean air", () => {
  const world = setup();
  const { pollution, ...v8 } = { ...serialize(world), version: 8 };
  const loaded = deserialize(structuredClone(v8));
  assert.equal(loaded.polluted.size, 0);
});

test("a removed machine stops giving off pollution", () => {
  const world = setup();
  const { x, y } = clearArea(world, 2, 2);
  const f = place(world, "furnace", x, y, 0);
  fillFrom(f, world.inventory, "iron-ore", 50);
  fillFrom(f, world.inventory, "coal", 10);
  run(world, 10);
  const c = homeChunk(world, f);
  const before = c.pollution;
  removeAt(world, x, y);
  run(world, TICK_RATE - 11); // up to the end of the second, before it spreads
  assert.equal(c.pollution, before);
});
