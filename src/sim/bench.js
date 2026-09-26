// The benchmark factory (?bench=big in the browser, `npm run bench` headless): a
// big, busy factory built straight into a world, for measuring how long a tick and
// a frame take.
//
// It's a grid of identical modules on ground cleared of the seed's ore and water.
// Each module is a smelting column and a gear line: seven miners on ore painted
// under them (six iron, one coal) fill a belt that runs past six furnaces, whose
// inserters take ore and coal off it and put plates on a second belt; that one runs
// past six gear assemblers, which put gears on a third. The belts end in chests,
// which drain() empties after every tick, as a player would, so nothing ever backs
// up and the factory works flat out for as long as it runs. Three coal generators
// power a module, each fed straight from a miner on coal.
//
// Belt loops under the modules carry the rest of the items, like a main bus that's
// always moving: packed tight (ITEM_GAP apart) but for one empty tile each, which
// is all a loop needs to keep running at full speed.
//
// The big one is the plan's performance target: 48 modules make 3,120 buildings,
// and with the loops about 6,000 belts carry 15,000 items once they've filled
// (after about 40 s).
import { realisticWorld } from "./realistic.js";
import { createWorld, place, canPlace } from "./world.js";
import { BUILDINGS } from "./buildings.js";
import { ORE, CHUNK } from "./map.js";
import { getChunk, tileIndex, chunkOf } from "./chunks.js";
import { give } from "./inventory.js";
import { setRecipe } from "./assembler.js";
import { generatorAdd } from "./generator.js";
import { BELT_LEN, ITEM_GAP } from "./transport.js";
import { MILESTONES } from "./progress.js";

// The sizes: modules across and down, and how many items go on the loops.
export const BENCHES = {
  realistic: { factory: realisticWorld },
  big: { across: 8, down: 6, loopItems: 10000 },
  small: { across: 2, down: 1, loopItems: 400 },
};

const MODULE_W = 21;
const MODULE_H = 38;
const RICH = 1_000_000; // ore painted under the miners, enough never to run out
const FURNACES = 6;
const ASSEMBLERS = 6;
const LOOP = { w: MODULE_W - 2, h: 10, gap: 2 }; // each belt loop, and the space between them
const LOOP_ITEMS = ["iron-ore", "copper-plate", "iron-gear", "coal", "electronic-circuit", "stone", "iron-plate", "copper-cable"];
const PER_TILE = BELT_LEN / ITEM_GAP;

// How many items a loop carries: its tiles but one, full.
const loopCapacity = () => (2 * (LOOP.w + LOOP.h) - 5) * PER_TILE;

// Builds benchmark `name` (a key of BENCHES) and returns { world, sinks }: pass
// `sinks` to drain() after every step.
export function benchWorld(name = "big") {
  const size = BENCHES[name];
  if (!size) throw new Error(`No benchmark called "${name}"`);
  if (size.factory) return size.factory();
  const world = createWorld({ seed: 1, kit: {}, milestones: MILESTONES.length });
  const sinks = [];

  // Everything is built at the grid's top-left (x0, y0), with the loops under the
  // modules, on bare ground.
  const loopRows = Math.ceil(size.loopItems / loopCapacity() / size.across);
  const w = size.across * MODULE_W;
  const h = size.down * MODULE_H + loopRows * (LOOP.h + LOOP.gap);
  const x0 = -Math.floor(w / 2);
  const y0 = -Math.floor(h / 2);
  clear(world, x0 - 2, y0 - 2, x0 + w + 2, y0 + h + 2);

  const build = (type, x, y, rot = 0, opts) => {
    give(world.inventory, BUILDINGS[type].cost);
    const e = place(world, type, x, y, rot, opts);
    if (!e) throw new Error(`Bench: can't build a ${type} at ${x}, ${y}: ${canPlace(world, type, x, y, rot, opts)}`);
    return e;
  };

  for (let j = 0; j < size.down; j++) {
    for (let i = 0; i < size.across; i++) buildModule(world, build, sinks, x0 + i * MODULE_W, y0 + j * MODULE_H);
  }

  // The loops, filled until there are loopItems on them.
  let left = size.loopItems;
  let k = 0;
  for (let j = 0; left > 0; j++) {
    for (let i = 0; i < size.across && left > 0; i++) {
      const lx = x0 + i * MODULE_W;
      const ly = y0 + size.down * MODULE_H + j * (LOOP.h + LOOP.gap);
      left -= buildLoop(build, lx, ly, left, k++);
    }
  }
  return { world, sinks };
}

// Empties the chests at the ends of the belts.
export function drain(sinks) {
  for (const chest of sinks) chest.inventory.items = {};
}

// How much there is: buildings (and how many are belts) and items on belts.
export function benchCounts(world) {
  let buildings = 0;
  let belts = 0;
  let items = 0;
  for (const e of world.entities.values()) {
    buildings++;
    if (e.type === "belt") belts++;
    if (e.items) items += e.items.length;
  }
  return { buildings, belts, items };
}

// Makes every tile from (x0, y0) to (x1, y1) plain ground.
function clear(world, x0, y0, x1, y1) {
  for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
    for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
      const c = getChunk(world, cx, cy);
      c.ore.fill(ORE.NONE);
      c.amount.fill(0);
      c.changed = true;
      c.version++;
    }
  }
}

// Puts ore under a 2×2 building at (x, y).
function paint(world, x, y, ore) {
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const c = chunkOf(world, x + dx, y + dy);
      const i = tileIndex(x + dx, y + dy);
      c.ore[i] = ore;
      c.amount[i] = RICH;
      c.version++;
    }
  }
}

// One module with its top-left at (ox, oy). Tiles are given relative to it; the
// columns are 0 the ore belt, 1 its inserters, 2–3 furnaces, 4 their inserters,
// 5 the plate belt, 6 inserters, 7–9 assemblers, 10 inserters, 11 the gear belt,
// and 14–18 the generators and the miners feeding them.
function buildModule(world, build, sinks, ox, oy) {
  const at = (type, x, y, rot, opts) => build(type, ox + x, oy + y, rot, opts);
  const S = 2; // facing south
  const E = 1;
  const W = 3;

  // Miners facing south along the top, dropping onto a belt running west, which
  // turns south down the ore column.
  for (let i = 0; i < 7; i++) {
    const ore = i === 6 ? ORE.COAL : ORE.IRON;
    paint(world, ox + 2 * i, oy, ore);
    at("miner", 2 * i, 0, S);
  }
  for (let x = 1; x <= 13; x++) at("belt", x, 2, W);
  for (let y = 2; y <= 14; y++) at("belt", 0, y, S);
  sinks.push(at("chest", 0, 15));

  // Furnaces, fed ore and coal from the left and putting plates out on the right.
  for (let i = 0; i < FURNACES; i++) {
    const y = 3 + 2 * i;
    at("inserter", 1, y, E);
    at("furnace", 2, y);
    at("inserter", 4, y, E);
  }
  const assemblyTop = 3 + 2 * FURNACES + 1;
  const bottom = assemblyTop + 3 * ASSEMBLERS;
  for (let y = 3; y <= bottom; y++) at("belt", 5, y, S);
  sinks.push(at("chest", 5, bottom + 1));

  // Gear assemblers, taking plates from the left and putting gears out on the right.
  for (let j = 0; j < ASSEMBLERS; j++) {
    const y = assemblyTop + 3 * j;
    at("inserter", 6, y, E);
    setRecipe(at("assembler", 7, y), "iron-gear", world.inventory);
    at("inserter", 10, y, E);
  }
  for (let y = assemblyTop; y <= bottom; y++) at("belt", 11, y, S);
  sinks.push(at("chest", 11, bottom + 1));

  // Generators, each fed coal by a miner facing west into it, started with a stack.
  for (let k = 0; k < 3; k++) {
    const y = 6 + 4 * k;
    generatorAdd(at("generator", 14, y), "coal", BUILDINGS.generator.stack);
    paint(world, ox + 17, oy + y, ORE.COAL);
    at("miner", 17, y, W);
  }

  // Poles: down the furnace column, along the miners, down the assemblers and by
  // the generators, all one network.
  const poles = [[1, 4], [1, 10], [7, 3], [13, 3], [1, 16], [16, 9], [16, 13]];
  for (let j = 0; j < ASSEMBLERS; j += 2) poles.push([6, assemblyTop + 3 * j + 1], [10, assemblyTop + 3 * j + 1]);
  for (const [x, y] of poles) at("pole", x, y);
}

// A clockwise loop of belts with its top-left at (x, y), carrying up to `max`
// items, and at most loopCapacity(). Returns how many it carries.
function buildLoop(build, x, y, max, k) {
  const tiles = [];
  for (let i = 0; i < LOOP.w - 1; i++) tiles.push([x + i, y, 1]);
  for (let i = 0; i < LOOP.h - 1; i++) tiles.push([x + LOOP.w - 1, y + i, 2]);
  for (let i = 0; i < LOOP.w - 1; i++) tiles.push([x + LOOP.w - 1 - i, y + LOOP.h - 1, 3]);
  for (let i = 0; i < LOOP.h - 1; i++) tiles.push([x, y + LOOP.h - 1 - i, 0]);
  let n = 0;
  tiles.forEach(([tx, ty, rot], t) => {
    const belt = build("belt", tx, ty, rot);
    if (t === 0) return; // the gap
    for (let j = 0; j < PER_TILE && n < max; j++) {
      belt.items.push({ item: LOOP_ITEMS[(k + n) % LOOP_ITEMS.length], pos: BELT_LEN - 2 - j * ITEM_GAP }); // front first
      n++;
    }
  });
  return n;
}
