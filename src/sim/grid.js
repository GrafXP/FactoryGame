// Tile lookups shared by the sim modules.
import { inMap, idAt } from "./chunks.js";

export { inMap };

// The building covering tile (x, y), or null.
export function entityAt(world, x, y) {
  if (!inMap(x, y)) return null;
  return world.entities.get(idAt(world, x, y)) || null;
}
