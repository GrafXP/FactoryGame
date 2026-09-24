// Tile lookups shared by the sim modules.

export const inMap = (world, x, y) =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < world.size && y < world.size;

// The building covering tile (x, y), or null.
export function entityAt(world, x, y) {
  if (!inMap(world, x, y)) return null;
  return world.entities.get(world.grid[y * world.size + x]) || null;
}
