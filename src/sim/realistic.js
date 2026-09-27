// A small, complete works: west-side mines and smelters, central fabrication,
// an eastern circuit line and dispatch HUB, a science wing to the south-east, and
// a coal power yard to the north. Everything is supplied by real mining; only the
// generators get startup fuel.
import { createWorld, place, canPlace } from "./world.js";
import { BUILDINGS } from "./buildings.js";
import { ORE } from "./map.js";
import { chunkOf, tileIndex, chartArea } from "./chunks.js";
import { give } from "./inventory.js";
import { setRecipe } from "./assembler.js";
import { generatorAdd } from "./generator.js";
import { setInserterFilter } from "./inserter.js";
import { queueResearch } from "./tech.js";
import { MILESTONES } from "./progress.js";

export function realisticWorld() {
  // Its last milestone, the circuit goal, is still to do, but it's built as if it
  // were done, labs and all (see the end). The three packs, sorting inserters and
  // lasers are researched so every chain can be demonstrated.
  const world = createWorld({ seed: 42, kit: {}, enemies: false, milestones: MILESTONES.length, research: ["green-science", "logistics-2", "military-science", "laser-turrets"] });
  const terrain = (x, y, ore = ORE.NONE, amount = 0) => {
    const c = chunkOf(world, x, y);
    const i = tileIndex(x, y);
    c.ore[i] = ore;
    c.amount[i] = amount;
    c.changed = true;
    c.version++;
  };
  // Grade only the industrial site, retaining the surrounding generated world.
  for (let y = -24; y <= 34; y++) for (let x = -40; x <= 34; x++) terrain(x, y);
  const patch = (cx, cy, ore, rx = 4, ry = 3) => {
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
      if ((x / rx) ** 2 + (y / ry) ** 2 <= 1) terrain(cx + x, cy + y, ore, 12000);
    }
  };
  const build = (type, x, y, rot = 0, opts) => {
    give(world.inventory, BUILDINGS[type].cost);
    const e = place(world, type, x, y, rot, opts);
    if (!e) throw new Error(`Realistic factory: ${type} at ${x}, ${y}: ${canPlace(world, type, x, y, rot, opts)}`);
    return e;
  };
  const horizontal = (x0, x1, y, rot = 1) => {
    for (let x = x0; x <= x1; x++) build("belt", x, y, rot);
  };
  const vertical = (x, y0, y1, rot = 2) => {
    for (let y = y0; y <= y1; y++) build("belt", x, y, rot);
  };

  // Power yard: each generator has its own coal mine, so a stopped production
  // line cannot starve the power supply. Six generators cover the laser as well.
  for (const x of [-30, -20, -10, 0, 10, 20]) {
    patch(x + 4, -17, ORE.COAL);
    generatorAdd(build("generator", x, -18), "coal", 10);
    build("miner", x + 3, -18, 3);
  }
  patch(-23, -10, ORE.COAL);
  build("miner", -23, -10, 2);
  for (let y = -8; y <= 29; y++) {
    build([3, 15, 27].includes(y) ? "splitter" : "belt", -22, y, 2);
  }
  build("chest", -22, 30);

  // Separate ore lines, shared coal service, and product conveyors crossing
  // underneath that service. Bricks and surplus plates go into real storage. The
  // fuel inserters are sorting ones set to coal, so nothing else goes in with it.
  for (const [y, ore] of [[0, ORE.IRON], [12, ORE.COPPER], [24, ORE.STONE]]) {
    patch(-34, y + 1, ore);
    build("miner", -34, y, 1);
    horizontal(-32, -29, y);
    build("furnace", -28, y);
    horizontal(-28, -23, y + 3, 3);
    setInserterFilter(build("sorting-inserter", -28, y + 2, 0), "coal");
    build("inserter", -26, y, 1);
    build("belt", -25, y, 1);
    build("underground", -24, y, 1);
    build("underground", -20, y, 1, { end: "out" });
    horizontal(-19, -18, y);
  }
  build("splitter", -17, 0, 1);
  const copper = build("sorter", -17, 12, 1);
  copper.filters = ["copper-plate", "overflow", "overflow"];
  horizontal(-17, -7, 24);
  build("splitter", -6, 24, 1);
  build("belt", -5, 24, 1);
  build("chest", -4, 24);
  // Copper the cable line has no room for goes south, then east to the science wing.
  vertical(-17, 13, 17);
  horizontal(-17, 6, 18);

  // Iron feeds gears and the circuit line. Copper feeds cable, which travels
  // directly to circuit assembly; no prefilled ingredient chests are needed.
  for (const [y, recipe] of [[0, "iron-gear"], [12, "copper-cable"]]) {
    horizontal(-16, -12, y);
    build("inserter", -11, y, 1);
    setRecipe(build("assembler", -10, y), recipe, world.inventory);
    build("inserter", -7, y, 1);
  }
  horizontal(-6, -5, 0);
  build("chest", -4, 0);
  vertical(-17, -5, -1, 0);
  horizontal(-17, 10, -6);
  vertical(11, -6, 7);
  const iron = build("sorter", 11, 8, 2);
  iron.filters = ["iron-plate", "overflow", "overflow"];
  build("chest", 12, 8);
  vertical(11, 9, 10);
  build("long-inserter", 11, 11, 2); // drops two tiles on, into the assembler's middle row
  horizontal(-6, -1, 12);
  // Split cable between the circuit line and spares for building power poles.
  build("splitter", 0, 12, 1);
  build("chest", 0, 13);
  horizontal(1, 8, 12);
  build("inserter", 9, 12, 1);
  setRecipe(build("assembler", 10, 12), "electronic-circuit", world.inventory);
  build("inserter", 13, 12, 1);
  horizontal(14, 20, 12);
  const dispatch = build("sorter", 21, 12, 1);
  dispatch.filters = ["electronic-circuit", "overflow", "overflow"];
  horizontal(22, 25, 12);
  build("hub", 26, 11);
  vertical(21, 13, 25); // circuits the HUB doesn't want, past the science wing
  build("chest", 21, 26);
  build("radar", 26, 3);

  // Ammunition is another real iron consumer. Stock the defense post first,
  // then keep spare magazines in a chest; the peaceful example can be inspected.
  vertical(-17, 1, 5);
  horizontal(-17, -12, 6);
  build("inserter", -11, 6, 1);
  setRecipe(build("assembler", -10, 6), "firearm-magazine", world.inventory);
  build("inserter", -7, 6, 1);
  horizontal(-6, -5, 6);
  build("splitter", -4, 6, 1); // half the magazines north, to the armoury, while it has room
  horizontal(-3, 8, 6);
  build("underground", 9, 6, 1);
  build("underground", 13, 6, 1, { end: "out" });
  horizontal(14, 23, 6);
  const ammo = build("sorter", 24, 6, 1);
  ammo.filters = ["firearm-magazine", "overflow", "overflow"];
  build("chest", 24, 7);
  build("belt", 25, 6, 1);
  build("turret", 26, 6);
  build("laser-turret", 28, 6);
  for (let x = 24; x <= 29; x++) build("wall", x, 1);

  // The armoury: piercing magazines from half the magazines on the ammunition belt,
  // gears from the gear store and copper the circuit line has no room for, which
  // leaves the copper sorter north, under the iron line and along to it.
  build("belt", -17, 11, 1);
  vertical(-16, 8, 11, 0);
  build("underground", -16, 7, 0);
  build("underground", -16, 5, 0, { end: "out" });
  horizontal(-16, -6, 4);
  setRecipe(build("assembler", -5, 2), "piercing-magazine", world.inventory);
  build("inserter", -4, 1, 2);
  build("belt", -4, 5, 0);
  build("inserter", -2, 3, 1);
  build("splitter", -1, 3, 1);
  build("chest", -1, 4);

  // Half the piercing magazines and bricks feed military science; the other
  // halves stay in storage. The new line crosses the existing belts underground.
  build("belt", 0, 3, 1);
  vertical(1, 3, 4);
  build("underground", 1, 5, 2);
  build("underground", 1, 8, 2, { end: "out" });
  vertical(1, 9, 10);
  build("underground", 1, 11, 2);
  build("underground", 1, 15, 2, { end: "out" });
  build("belt", 1, 16, 2);
  build("underground", 1, 17, 2);
  build("underground", 1, 19, 2, { end: "out" });
  vertical(1, 20, 21);
  build("inserter", 1, 22, 2);
  setRecipe(build("assembler", 0, 23), "military-pack", world.inventory);
  build("belt", -6, 25, 2);
  horizontal(-6, -3, 26);
  build("belt", -2, 26, 0);
  build("belt", -2, 25, 0);
  build("inserter", -1, 25, 1);
  build("inserter", 3, 24, 1);
  vertical(4, 24, 26);
  horizontal(4, 9, 27);

  // The science wing. A gear assembler between a red pack and a green pack
  // assembler feeds both; iron comes along the top from a smelter of its own (a
  // miner on iron and one on coal feeding a furnace), under the circuit belt,
  // copper down the west side and circuits down the east. The packs go along a
  // belt past two labs, the second fed from the first, into a chest.
  for (const [x0, y0, ore] of [[27, 21, ORE.IRON], [25, 23, ORE.COAL]]) {
    for (let y = y0; y < y0 + 2; y++) for (let x = x0; x < x0 + 2; x++) terrain(x, y, ore, 12000);
  }
  build("furnace", 25, 21);
  build("miner", 27, 21, 3);
  build("miner", 25, 23, 0);
  build("inserter", 24, 21, 3);
  build("belt", 23, 21, 3);
  build("underground", 22, 21, 3);
  build("underground", 20, 21, 3, { end: "out" });
  horizontal(14, 19, 21, 3);
  build("chest", 13, 21);
  vertical(7, 18, 25);
  build("chest", 7, 26);
  setRecipe(build("assembler", 9, 23), "red-pack", world.inventory);
  setRecipe(build("assembler", 13, 23), "iron-gear", world.inventory);
  setRecipe(build("assembler", 17, 23), "green-pack", world.inventory);
  build("inserter", 14, 22, 2);
  build("inserter", 18, 22, 2);
  build("inserter", 8, 24, 1);
  build("inserter", 12, 24, 3);
  build("inserter", 16, 24, 1);
  build("inserter", 20, 24, 3);
  build("inserter", 10, 26, 2);
  build("inserter", 18, 26, 2);
  horizontal(10, 20, 27);
  build("chest", 21, 27);
  build("inserter", 19, 28, 2);
  build("lab", 18, 29);
  build("inserter", 17, 30, 3);
  build("lab", 14, 29);
  for (const id of ["weapon-damage-1", "shooting-speed-1", "stronger-walls", "weapon-damage-2", "shooting-speed-2"]) queueResearch(world, id);

  // Poles follow service corridors beside the machines and the power yard.
  // The intermediate poles tie the smelters, fabrication and radar together.
  const poles = [];
  for (let x = -33; x <= 27; x += 6) poles.push([x, -15]);
  for (const y of [-3, 9]) for (let x = -31; x <= 29; x += 6) poles.push([x === 11 ? 12 : x, y]);
  for (const x of [-31, -13, 5, 29]) poles.push([x, 3]);
  poles.push([-31, -9], [-25, -9], [-31, 15], [-25, 16], [-31, 21], [-25, 21], [-31, 27], [-2, 1]);
  poles.push([16, 15], [16, 22], [11, 21], [17, 28], [22, 24], [12, 26], [28, 24]); // the science wing
  poles.push([9, -9], [5, 15], [5, 21], [0, 21], [0, 27]); // military science
  for (const [x, y] of poles) build("pole", x, y);
  world.inventory.items = {};
  give(world.inventory, { "iron-plate": 200, "copper-plate": 100, "iron-gear": 50, "copper-cable": 100, "electronic-circuit": 30, stone: 100, coal: 50 });
  chartArea(world, -2, -1, 1, 1);
  world.progress.milestone = MILESTONES.length - 1;
  // Real storage is deliberately retained, including after the HUB goal is met.
  return { world, sinks: [] };
}
