import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, removeAt, refundOf } from "../src/sim/world.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { canTake, put } from "../src/sim/transport.js";
import { setRecipe, fillAssembler, emptyAssembler } from "../src/sim/assembler.js";
import { RECIPES } from "../src/sim/recipes.js";
import { add, count, total } from "../src/sim/inventory.js";
import { serialize, deserialize } from "../src/sim/save.js";
import { charge } from "./helpers.js";

const STACK = BUILDINGS.assembler.stack;
const GEAR = RECIPES["iron-gear"];

const setup = () =>
  createWorld({
    seed: 3,
    kit: { "iron-plate": 1000, "copper-plate": 1000, "iron-gear": 1000, "electronic-circuit": 1000, stone: 1000 },
  });
const run = (world, ticks) => {
  for (let i = 0; i < ticks; i++) {
    charge(world);
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
const assemblerOn = (recipe) => {
  const world = setup();
  const { x, y } = clearArea(world, 12);
  const a = place(world, "assembler", x + 2, y + 2, 0);
  if (recipe) setRecipe(a, recipe, world.inventory);
  return { world, a, x, y };
};

test("an assembler set to gears turns iron plates into gears", () => {
  const { world, a } = assemblerOn("iron-gear");
  assert.equal(a.status, "no-input");
  assert.equal(fillAssembler(a, world.inventory, "iron-plate"), STACK);
  run(world, GEAR.time * 3);
  assert.deepEqual(a.output, { item: "iron-gear", n: 3 });
  assert.equal(a.inputs["iron-plate"], STACK - 2 * 3 - 2, "the fourth gear is under way");
  assert.equal(a.status, "working");
});

test("an assembler without a recipe takes nothing and says so", () => {
  const { world, a } = assemblerOn(null);
  run(world, 5);
  assert.equal(a.status, "no-recipe");
  assert.equal(canTake(a, "iron-plate"), false);
});

test("machines fill an assembler to two crafts' worth of its own ingredients only", () => {
  const { a } = assemblerOn("electronic-circuit");
  assert.equal(canTake(a, "copper-plate"), false, "not an ingredient");
  for (let i = 0; i < 6; i++) {
    assert.ok(canTake(a, "copper-cable"));
    put(a, "copper-cable");
  }
  assert.equal(canTake(a, "copper-cable"), false);
  assert.ok(canTake(a, "iron-plate"));
});

test("a full output stops the assembler, and emptying it starts it again", () => {
  const { world, a } = assemblerOn("copper-cable");
  fillAssembler(a, world.inventory, "copper-plate");
  run(world, RECIPES["copper-cable"].time * (STACK / 2 + 3));
  assert.deepEqual(a.output, { item: "copper-cable", n: STACK });
  assert.equal(a.status, "full");
  const before = count(world.inventory, "copper-cable");
  assert.deepEqual(emptyAssembler(a, world.inventory), { "copper-cable": STACK });
  assert.equal(count(world.inventory, "copper-cable"), before + STACK);
  run(world, RECIPES["copper-cable"].time);
  assert.deepEqual(a.output, { item: "copper-cable", n: 2 });
});

test("changing the recipe gives back everything, including the craft under way", () => {
  const { world, a } = assemblerOn("iron-gear");
  fillAssembler(a, world.inventory, "iron-plate");
  run(world, GEAR.time + 10); // one gear made, the next under way
  const plates = count(world.inventory, "iron-plate");
  const gears = count(world.inventory, "iron-gear");
  const back = setRecipe(a, "copper-cable", world.inventory);
  assert.deepEqual(back, { "iron-plate": STACK - 2, "iron-gear": 1 });
  assert.equal(count(world.inventory, "iron-plate"), plates + STACK - 2);
  assert.equal(count(world.inventory, "iron-gear"), gears + 1);
  assert.deepEqual(a.inputs, {});
  assert.equal(a.output, null);
  assert.equal(a.recipe, "copper-cable");
});

test("removing an assembler gives back its cost and contents", () => {
  const { world, a } = assemblerOn("iron-gear");
  fillAssembler(a, world.inventory, "iron-plate");
  run(world, GEAR.time + 10);
  const r = refundOf(a);
  assert.equal(r["iron-plate"], BUILDINGS.assembler.cost["iron-plate"] + STACK - 2);
  assert.equal(r["iron-gear"], BUILDINGS.assembler.cost["iron-gear"] + 1);
  const before = total(world.inventory);
  removeAt(world, a.x, a.y);
  assert.equal(total(world.inventory), before + Object.values(r).reduce((s, n) => s + n, 0));
});

// Iron and copper plates in chests → cable assembler → circuit assembler → chest,
// moved by inserters only:
//
//             iron
//              ↓
//  copper → [cable] → [circuit] → chest
const circuitLine = () => {
  const world = setup();
  const { x, y } = clearArea(world, 14);
  const X = x + 3;
  const Y = y + 4;
  const copper = place(world, "chest", X - 2, Y + 1, 0);
  place(world, "inserter", X - 1, Y + 1, 1);
  const cable = place(world, "assembler", X, Y, 0);
  place(world, "inserter", X + 3, Y + 1, 1);
  const circuit = place(world, "assembler", X + 4, Y, 0);
  const iron = place(world, "chest", X + 5, Y - 2, 0);
  place(world, "inserter", X + 5, Y - 1, 2);
  place(world, "inserter", X + 7, Y + 1, 1);
  const out = place(world, "chest", X + 8, Y + 1, 0);
  setRecipe(cable, "copper-cable", world.inventory);
  setRecipe(circuit, "electronic-circuit", world.inventory);
  add(copper.inventory, "copper-plate", 50);
  add(iron.inventory, "iron-plate", 50);
  return { world, copper, iron, cable, circuit, out };
};

test("an automated circuit line runs unattended", () => {
  const { world, out, cable, circuit } = circuitLine();
  run(world, 60 * 90);
  const made = count(out.inventory, "electronic-circuit");
  // 2.5 s a circuit once the cables flow; allow for the line filling up.
  assert.ok(made >= 30, `made ${made} circuits`);
  assert.equal(total(out.inventory), made, "only circuits reach the chest");
  assert.equal(cable.status === "full" || cable.status === "working" || cable.status === "no-input", true);
  assert.ok(circuit.inputs["copper-cable"] === undefined || circuit.inputs["copper-cable"] <= 6);
});

test("a circuit line saved mid-run carries on exactly as it would have", () => {
  const { world } = circuitLine();
  run(world, 60 * 20 + 7);
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(serialize(loaded), serialize(world));
  run(world, 1200);
  run(loaded, 1200);
  assert.deepEqual(serialize(loaded), serialize(world));
});
