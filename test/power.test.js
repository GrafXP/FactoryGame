import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step, place, removeAt, refundOf } from "../src/sim/world.js";
import { BUILDINGS } from "../src/sim/buildings.js";
import { canTake, put } from "../src/sim/transport.js";
import { setRecipe, fillAssembler } from "../src/sim/assembler.js";
import { fuelGenerator } from "../src/sim/generator.js";
import { powerNetwork, polesInReach, satisfaction } from "../src/sim/power.js";
import { RECIPES, FUEL_ENERGY } from "../src/sim/recipes.js";
import { add, count } from "../src/sim/inventory.js";
import { serialize, deserialize } from "../src/sim/save.js";
import { ALL, clearArea } from "./helpers.js";

const GEAR = RECIPES["iron-gear"];
const DRAW = BUILDINGS.assembler.draw;
const COAL = FUEL_ENERGY.coal;
const { feed: FEED, stack: STACK } = BUILDINGS.generator;

const setup = () =>
  createWorld({
    milestones: ALL,
    seed: 3,
    kit: { "iron-plate": 5000, "copper-cable": 1000, "iron-gear": 1000, "electronic-circuit": 1000, stone: 1000, coal: 1000 },
  });
const run = (world, ticks) => {
  for (let i = 0; i < ticks; i++) step(world);
};
const gearMaker = (world, x, y) => {
  const a = place(world, "assembler", x, y, 0);
  setRecipe(a, "iron-gear", world.inventory);
  fillAssembler(a, world.inventory, "iron-plate");
  return a;
};

// A generator (3×2) and a gear assembler (3×3) with one pole between them:
//
//   GGG
//   GGG
//      P
//       AAA
//       AAA
//       AAA
const small = (coal = 1) => {
  const world = setup();
  const { x, y } = clearArea(world, 10);
  const gen = place(world, "generator", x, y, 0);
  const pole = place(world, "pole", x + 3, y + 2, 0);
  const a = gearMaker(world, x + 4, y + 3);
  if (coal) gen.fuel = { item: "coal", n: coal };
  return { world, x, y, gen, pole, a };
};

// 16 gear assemblers in a 4×4 grid, a pole in each gap between four of them, and
// a generator under the grid on a pole of its own: they ask for twice what one
// generator makes.
const grid = () => {
  const world = setup();
  const { x, y } = clearArea(world, 22);
  const assemblers = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) assemblers.push(gearMaker(world, x + 4 * i, y + 4 * j));
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) place(world, "pole", x + 3 + 4 * i, y + 3 + 4 * j, 0);
  place(world, "pole", x + 3, y + 15, 0);
  const gen = place(world, "generator", x, y + 16, 0);
  fuelGenerator(gen, world.inventory, "coal");
  return { world, x, y, assemblers, gen };
};

test("a machine near no pole has no power: it says so and doesn't run", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6);
  const a = gearMaker(world, x, y);
  run(world, GEAR.time * 2);
  assert.equal(a.status, "no-power");
  assert.equal(a.output, null);
  assert.equal(a.progress, 0);
});

test("an inserter without power picks nothing up", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6);
  const from = place(world, "chest", x, y, 1);
  put(from, "iron-plate");
  const ins = place(world, "inserter", x + 1, y, 1);
  place(world, "chest", x + 2, y, 1);
  run(world, 100);
  assert.equal(ins.status, "no-power");
  assert.equal(ins.hand, null);
  assert.equal(count(from.inventory, "iron-plate"), 1);
});

test("generator → pole → assembler makes gears, burning coal for exactly what it draws", () => {
  const { world, gen, a } = small(1);
  const net = powerNetwork(world).netOf.get(a);
  assert.ok(net, "the assembler is on the pole's network");
  assert.equal(powerNetwork(world).netOf.get(gen), net, "and so is the generator");
  run(world, GEAR.time * 3);
  assert.deepEqual(a.output, { item: "iron-gear", n: 3 });
  assert.equal(a.status, "working");
  assert.equal(gen.status, "working");
  assert.equal(gen.fuel, null, "the coal was lit");
  assert.equal(gen.burn, COAL - DRAW * GEAR.time * 3);
  assert.equal(satisfaction(net), 1);
});

test("a generator runs out of coal and its machines stop with no power", () => {
  const { world, gen, a } = small(1);
  const ticks = COAL / DRAW; // one coal runs one assembler this long
  run(world, ticks / 2);
  fillAssembler(a, world.inventory, "iron-plate"); // a stack of plates lasts 25 gears
  run(world, ticks / 2 + 10);
  assert.equal(gen.status, "no-fuel");
  assert.equal(a.status, "no-power");
  const made = a.output.n;
  assert.equal(made, Math.floor(ticks / GEAR.time));
  run(world, GEAR.time * 3);
  assert.equal(a.output.n, made, "nothing more is made");

  add(world.inventory, "coal", 1);
  fuelGenerator(gen, world.inventory, "coal");
  run(world, GEAR.time * 2);
  assert.equal(a.status, "working");
  assert.ok(a.output.n > made, "and it starts again with coal");
});

test("idle machines draw nothing, so an idle generator keeps its coal", () => {
  const { world, gen, a } = small(5);
  setRecipe(a, null, world.inventory);
  run(world, 10); // the assembler's store fills up
  const burn = gen.burn;
  const coal = gen.fuel.n;
  run(world, 600);
  assert.equal(gen.status, "idle");
  assert.equal(gen.burn, burn);
  assert.equal(gen.fuel.n, coal);
});

test("removing the pole cuts the power", () => {
  const { world, pole, a, gen } = small(5);
  run(world, 30);
  assert.equal(a.status, "working");
  removeAt(world, pole.x, pole.y);
  run(world, 5);
  assert.equal(a.status, "no-power");
  assert.equal(gen.status, "unconnected");
});

test("poles within reach join into one network with as few wires as it takes", () => {
  const world = setup();
  const { x, y } = clearArea(world, 24);
  const reach = BUILDINGS.pole.reach;
  const a = place(world, "pole", x, y, 0);
  const b = place(world, "pole", x + reach, y, 0); // just in reach
  const c = place(world, "pole", x + 3, y + 3, 0); // in reach of both
  const far = place(world, "pole", x + 2 * reach + 1, y, 0); // just out of b's reach
  const net = powerNetwork(world);
  assert.equal(net.nets.length, 2);
  assert.equal(net.netOf.get(a), net.netOf.get(b));
  assert.equal(net.netOf.get(a), net.netOf.get(c));
  assert.notEqual(net.netOf.get(a), net.netOf.get(far));
  assert.equal(net.wires.length, 2, "three joined poles need two wires");
  assert.ok(!net.wires.some((w) => w.includes(a) && w.includes(b)), "the long way round isn't wired");
  assert.deepEqual(polesInReach(world, x - 2, y + 2), [a, c]);
});

test("when demand is higher than supply, every machine slows down evenly", () => {
  const { world, assemblers, gen } = grid();
  const net = powerNetwork(world).netOf.get(gen);
  assert.equal(net.consumers.length, 16);
  run(world, GEAR.time * 10);
  const made = assemblers.map((a) => a.output?.n || 0);
  assert.ok(Math.max(...made) - Math.min(...made) <= 1, `even: ${made}`);
  assert.ok(made.every((n) => n >= 4 && n <= 5), `half speed: ${made}`);
  assert.ok(Math.abs(satisfaction(net) - 0.5) < 0.02, `satisfaction ${satisfaction(net)}`);
  assert.equal(net.capacity, BUILDINGS.generator.power);
  assert.equal(net.supplied, net.capacity, "the generator gives all it can");
  assert.ok(assemblers.every((a) => a.status === "working"), "slowed machines are still working");
});

test("a second generator shares the load and brings the machines back to full speed", () => {
  const { world, x, y, assemblers, gen } = grid();
  run(world, GEAR.time * 5);
  const gen2 = place(world, "generator", x + 4, y + 16, 0);
  fuelGenerator(gen2, world.inventory, "coal");
  run(world, 30);
  const before = assemblers.map((a) => a.output?.n || 0);
  run(world, GEAR.time * 10);
  assemblers.forEach((a, i) => assert.ok(a.output.n - before[i] >= 9, `assembler ${i} made ${a.output.n - before[i]}`));
  assert.ok(Math.abs(satisfaction(powerNetwork(world).netOf.get(gen)) - 1) < 0.01);
  const burnt = (g) => (STACK - (g.fuel?.n || 0)) * COAL - g.burn;
  assert.ok(Math.abs(burnt(gen) - GEAR.time * 5 * BUILDINGS.generator.power - burnt(gen2)) < 2 * DRAW * 16, "the two share it");
});

test("a powered factory saved mid-run carries on exactly as it would have", () => {
  const { world } = grid();
  run(world, GEAR.time * 3 + 7);
  const loaded = deserialize(structuredClone(serialize(world)));
  assert.deepEqual(serialize(loaded), serialize(world));
  run(world, 900);
  run(loaded, 900);
  assert.deepEqual(serialize(loaded), serialize(world));
});

test("machines top a generator's coal up, the player fills a stack, and removing it gives the coal back", () => {
  const { world, gen } = small(0);
  for (let i = 0; i < FEED; i++) {
    assert.ok(canTake(gen, "coal"));
    put(gen, "coal");
  }
  assert.equal(canTake(gen, "coal"), false);
  assert.equal(canTake(gen, "iron-ore"), false, "only fuel goes in");
  assert.equal(fuelGenerator(gen, world.inventory, "coal"), STACK - FEED);
  const back = refundOf(gen);
  assert.equal(back.coal, STACK);
  assert.equal(back.stone, BUILDINGS.generator.cost.stone);
});

test("a save from before power loads with its machines stopped and the parts to power them", () => {
  const world = setup();
  const { x, y } = clearArea(world, 6);
  gearMaker(world, x, y);
  const data = serialize(world);
  const v3 = {
    ...data,
    version: 3,
    entities: data.entities.map(({ energy, ...e }) => e),
  };
  const loaded = deserialize(structuredClone(v3));
  const a = [...loaded.entities.values()][0];
  assert.equal(a.energy, 0);
  for (const id of ["stone", "iron-gear", "copper-cable"]) assert.ok(count(loaded.inventory, id) > count(world.inventory, id), id);
  run(loaded, 10);
  assert.equal(a.status, "no-power");
});
