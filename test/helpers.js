// Shared test helpers. (Node's runner loads every file under test/, so this one
// runs too, with no tests in it.)
import { BUILDINGS } from "../src/sim/buildings.js";

// Fills every machine's store of energy, as if it were on a network with power to
// spare. Tests about what machines do call it before every tick, so they don't
// have to build generators and poles; power.test.js covers the real thing.
export function charge(world) {
  for (const e of world.entities.values()) if (BUILDINGS[e.type].draw) e.energy = 2 * BUILDINGS[e.type].draw;
}
