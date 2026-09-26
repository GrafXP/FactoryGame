// A small, complete works: west-side mines and smelters, central fabrication,
// an eastern circuit line and dispatch HUB, and a coal power yard to the north.
// Everything is supplied by real mining; only the generators get startup fuel.
import { createWorld, place, canPlace } from "./world.js";
import { BUILDINGS } from "./buildings.js";
import { ORE } from "./map.js";
import { chunkOf, tileIndex, chartArea } from "./chunks.js";
import { give } from "./inventory.js";
import { setRecipe } from "./assembler.js";
import { generatorAdd } from "./generator.js";
import { MILESTONES } from "./progress.js";

export function realisticWorld() {
  const world = createWorld({ seed: 42, kit: {}, milestones: MILESTONES.length - 1 });
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
  // line cannot starve the power supply. Four generators leave expansion room.
  for (const x of [-30, -20, -10, 0]) {
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
  // underneath that service. Bricks and surplus plates go into real storage.
  for (const [y, ore] of [[0, ORE.IRON], [12, ORE.COPPER], [24, ORE.STONE]]) {
    patch(-34, y + 1, ore);
    build("miner", -34, y, 1);
    horizontal(-32, -29, y);
    build("furnace", -28, y);
    horizontal(-28, -23, y + 3, 3);
    build("inserter", -28, y + 2, 0);
    build("inserter", -26, y, 1);
    build("belt", -25, y, 1);
    build("underground", -24, y, 1);
    build("underground", -20, y, 1, { end: "out" });
    horizontal(-19, -18, y);
  }
  build("splitter", -17, 0, 1);
  const copper = build("sorter", -17, 12, 1);
  copper.filters = ["copper-plate", "overflow", "overflow"];
  horizontal(-17, -5, 24);
  build("chest", -4, 24);
  vertical(-17, 13, 16);
  build("chest", -17, 17);

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
  build("inserter", 11, 11, 2);
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
  vertical(21, 13, 16);
  build("chest", 21, 17);
  build("radar", 26, 3);

  // Poles follow service corridors beside the machines and the power yard.
  // The intermediate poles tie the smelters, fabrication and radar together.
  const poles = [];
  for (let x = -33; x <= 9; x += 6) poles.push([x, -15]);
  for (const y of [-3, 9]) for (let x = -31; x <= 29; x += 6) poles.push([x === 11 ? 12 : x, y]);
  for (const x of [-31, -13, 5, 29]) poles.push([x, 3]);
  poles.push([-31, -9], [-25, -9], [-31, 15], [-25, 16], [-31, 21], [-25, 21], [-31, 27]);
  for (const [x, y] of poles) build("pole", x, y);
  world.inventory.items = {};
  give(world.inventory, { "iron-plate": 200, "copper-plate": 100, "iron-gear": 50, "copper-cable": 100, "electronic-circuit": 30, stone: 100, coal: 50 });
  chartArea(world, -2, -1, 1, 1);
  // Real storage is deliberately retained, including after the HUB goal is met.
  return { world, sinks: [] };
}
