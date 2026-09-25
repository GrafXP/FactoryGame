// Shared test helpers. (Node's runner loads every file under test/, so this one
// runs too, with no tests in it.)
import { BUILDINGS } from "../src/sim/buildings.js";
import { MILESTONES } from "../src/sim/progress.js";
import { kindAt } from "../src/sim/chunks.js";
import { ORE } from "../src/sim/map.js";

// Fills every machine's store of energy, as if it were on a network with power to
// spare. Tests about what machines do call it before every tick, so they don't
// have to build generators and poles; power.test.js covers the real thing.
export function charge(world) {
  for (const e of world.entities.values()) if (BUILDINGS[e.type].draw) e.energy = 2 * BUILDINGS[e.type].draw;
}

// Milestones done for a world where anything can be built: createWorld({ milestones: ALL }).
export const ALL = MILESTONES.length;

// How far from the start (0, 0) tests look for a spot to build.
const NEAR = 64;

// Top-left of a w×h area of plain ground (no ore or water) near the start, so tests
// don't hit ore. Looks row by row from the north-west.
export function clearArea(world, w, h = w) {
  for (let y = -NEAR; y < NEAR - h; y += 2) {
    for (let x = -NEAR; x < NEAR - w; x += 2) {
      let clear = true;
      for (let j = 0; j < h && clear; j++) for (let i = 0; i < w && clear; i++) if (kindAt(world, x + i, y + j) !== ORE.NONE) clear = false;
      if (clear) return { x, y };
    }
  }
  throw new Error("no clear area");
}

// The first tile near the start, row by row from the north-west, that `ok(x, y)`
// says yes to.
export function findTile(world, ok, near = NEAR) {
  for (let y = -near; y < near; y++) for (let x = -near; x < near; x++) if (ok(x, y)) return { x, y };
  throw new Error("no such tile");
}

// The first tile of `kind` (an ore, water or plain ground) near the start.
export const findKind = (world, kind, near = NEAR) => findTile(world, (x, y) => kindAt(world, x, y) === kind, near);

// Top-left of a 2×2 block that's all `ore`, e.g. for a miner.
export const oreBlock = (world, ore) =>
  findTile(world, (x, y) => [0, 1].every((dy) => [0, 1].every((dx) => kindAt(world, x + dx, y + dy) === ore)));
