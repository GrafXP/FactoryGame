import { test } from "node:test";
import assert from "node:assert/strict";
import { benchWorld, drain } from "../src/sim/bench.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { RECIPES, SMELTING } from "../src/sim/recipes.js";
import { step } from "../src/sim/world.js";
import { powerNetwork } from "../src/sim/power.js";
import { serialize, deserialize } from "../src/sim/save.js";
import { MILESTONES } from "../src/sim/progress.js";

const run = (world, ticks) => { for (let i = 0; i < ticks; i++) step(world); };

test("realistic preset includes every building and recipe with connected power and tunnels", () => {
  const { world, sinks } = benchWorld("realistic");
  const entities = [...world.entities.values()];
  assert.deepEqual(new Set(entities.map(e => e.type)), new Set(Object.keys(BUILDINGS)));
  assert.deepEqual(new Set(entities.filter(e => e.type === "assembler").map(e => e.recipe)), new Set(Object.keys(RECIPES)));
  assert.deepEqual(sinks, [], "the example retains its products");
  const power = powerNetwork(world);
  assert.equal(power.nets.length, 1);
  for (const e of entities) {
    if (BUILDINGS[e.type].draw) assert.ok(power.netOf.get(e)?.generators.length, `${e.type} at ${e.x}, ${e.y} has power`);
    if (e.type === "underground") assert.equal(world.entities.get(e.pair)?.pair, e.id);
    if (e.type === "chest") assert.deepEqual(e.inventory.items, {}, "production starts from mined resources");
  }
  const capacity = power.nets[0].generators.length * BUILDINGS.generator.power;
  assert.ok(capacity >= entities.reduce((sum, e) => sum + (BUILDINGS[e.type].draw || 0), 0));
});

test("realistic factory completes circuit delivery and stores all finished products without intervention", () => {
  const { world, sinks } = benchWorld("realistic");
  run(world, 20 * 60 * 60);
  assert.equal(world.progress.milestone, MILESTONES.length);
  const stored = {};
  for (const e of world.entities.values()) if (e.type === "chest") {
    for (const [item, n] of Object.entries(e.inventory.items)) stored[item] = (stored[item] || 0) + n;
  }
  for (const item of [...Object.values(SMELTING).map(r => r.out), ...Object.keys(RECIPES), "coal"]) {
    assert.ok(stored[item] > 0, `${item} reaches storage: ${JSON.stringify(stored)}`);
  }
  drain(sinks);
  assert.ok([...world.entities.values()].some(e => e.type === "chest" && e.inventory.items["electronic-circuit"] > 0));
  assert.ok(world.polluted.size > 0);
  assert.ok([...world.entities.values()].some(e => e.type === "radar" && e.status === "working"));
});

test("realistic factory retains terrain, logistics and deterministic production through save/load", () => {
  const { world } = benchWorld("realistic");
  run(world, 1800);
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(serialize(loaded), serialize(world));
  run(world, 600);
  run(loaded, 600);
  assert.deepEqual(serialize(loaded), serialize(world));
});
