// Building types. Sizes are for rotation 0; odd rotations swap w and h.
export const BUILDINGS = {
  belt: { name: "Belt", w: 1, h: 1 },
  miner: { name: "Miner", w: 2, h: 2 },
  chest: { name: "Chest", w: 1, h: 1 },
};

// Rotation r faces DIRS[r]: 0 north (-y), 1 east, 2 south, 3 west.
export const DIRS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function footprint(type, rot) {
  const { w, h } = BUILDINGS[type];
  return rot % 2 ? { w: h, h: w } : { w, h };
}

// Tiles for a straight belt line dragged from (sx, sy) towards (ex, ey). The line
// follows whichever axis moved further and its belts face the way you dragged;
// a drag that hasn't left the start tile is one belt facing `rot`.
export function beltLine(sx, sy, ex, ey, rot) {
  const dx = ex - sx;
  const dy = ey - sy;
  if (!dx && !dy) return [{ x: sx, y: sy, rot }];
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const len = horizontal ? Math.abs(dx) : Math.abs(dy);
  const dir = horizontal ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
  const [stepX, stepY] = DIRS[dir];
  const tiles = [];
  for (let i = 0; i <= len; i++) tiles.push({ x: sx + stepX * i, y: sy + stepY * i, rot: dir });
  return tiles;
}
