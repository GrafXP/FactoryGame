import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, place, chestRoom, takeFromChest, putInChest } from "../src/sim/world.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { count, total } from "../src/sim/inventory.js";
import { fillFrom, emptySlot } from "../src/sim/furnace.js";
import { setRecipe, fillAssembler, emptyAssembler } from "../src/sim/assembler.js";
import { fuelGenerator, emptyGenerator } from "../src/sim/generator.js";
import { deliverFrom, stillNeeded } from "../src/sim/progress.js";
import { ALL } from "./helpers.js";

// The panels move a set amount of items (1, 10, half or all): every move takes a
// limit, and still moves no more than there is or than fits.
const KIT = { "iron-plate": 500, "iron-gear": 100, "electronic-circuit": 100, stone: 200, coal: 100, "iron-ore": 100 };
const setup = (milestones = ALL) => createWorld({ milestones, seed: 3, kit: { ...KIT } });

test("a furnace takes and gives back as many as asked", () => {
  const world = setup();
  const f = place(world, "furnace", 20, 20, 0);
  assert.equal(fillFrom(f, world.inventory, "iron-ore", 10), 10);
  assert.equal(fillFrom(f, world.inventory, "coal", 1), 1);
  assert.deepEqual([f.input.n, f.fuel.n], [10, 1]);
  assert.deepEqual(emptySlot(f, "input", world.inventory, 4), { "iron-ore": 4 });
  assert.equal(f.input.n, 6, "the rest stays");
  assert.deepEqual(emptySlot(f, "input", world.inventory, 50), { "iron-ore": 6 }, "no more than there is");
  assert.equal(f.input, null);
  assert.equal(count(world.inventory, "iron-ore"), 100);
  assert.equal(fillFrom(f, world.inventory, "iron-ore", 80), BUILDINGS.furnace.stack, "no more than fits");
});

test("an assembler's ingredients and output move a few at a time", () => {
  const world = setup();
  const a = place(world, "assembler", 20, 20, 0);
  setRecipe(a, "iron-gear", world.inventory);
  assert.equal(fillAssembler(a, world.inventory, "iron-plate", 7), 7);
  assert.deepEqual(emptyAssembler(a, world.inventory, "iron-plate", 3), { "iron-plate": 3 });
  assert.equal(a.inputs["iron-plate"], 4);
  a.output = { item: "iron-gear", n: 9 };
  assert.deepEqual(emptyAssembler(a, world.inventory, null, 5), { "iron-gear": 5 });
  assert.equal(a.output.n, 4);
  assert.deepEqual(emptyAssembler(a, world.inventory), { "iron-gear": 4 });
  assert.equal(a.output, null);
  assert.deepEqual(emptyAssembler(a, world.inventory), {}, "nothing left");
});

test("a generator's coal moves a few at a time", () => {
  const world = setup();
  const g = place(world, "generator", 20, 20, 0);
  assert.equal(fuelGenerator(g, world.inventory, "coal", 12), 12);
  assert.deepEqual(emptyGenerator(g, world.inventory, 5), { coal: 5 });
  assert.equal(g.fuel.n, 7);
  assert.deepEqual(emptyGenerator(g, world.inventory), { coal: 7 });
  assert.equal(g.fuel, null);
});

test("the HUB takes as many as asked, and no more than it needs", () => {
  const world = setup(0);
  const need = stillNeeded(world.progress, "iron-plate");
  assert.equal(deliverFrom(world.progress, world.inventory, "iron-plate", 1), 1);
  assert.equal(stillNeeded(world.progress, "iron-plate"), need - 1);
  assert.equal(deliverFrom(world.progress, world.inventory, "iron-plate", 1000), need - 1);
});

test("items go into a chest from the inventory and come out a few at a time", () => {
  const world = setup();
  const chest = place(world, "chest", 20, 20, 0);
  assert.equal(putInChest(world, chest, "iron-ore", 10), 10);
  assert.equal(putInChest(world, chest, "stone", 200), BUILDINGS.chest.capacity - 10, "as far as it has room");
  assert.equal(chestRoom(chest), 0);
  assert.equal(putInChest(world, chest, "coal", 5), 0);
  assert.equal(takeFromChest(world, chest, "iron-ore", 4), 4);
  assert.equal(count(chest.inventory, "iron-ore"), 6);
  assert.equal(takeFromChest(world, chest, "iron-ore", 99), 6);
  assert.equal(count(chest.inventory, "iron-ore"), 0);
  assert.equal(total(chest.inventory), BUILDINGS.chest.capacity - 10);
  assert.equal(count(world.inventory, "iron-ore"), 100);
});
