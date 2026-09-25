// Building types. Sizes are for rotation 0; odd rotations swap w and h.
// Costs are paid from the player's inventory and refunded in full on removal.
// Furnaces are made of stone, so a player with no plates can always smelt some;
// gears and circuits can always be hand-crafted from plates.
// A miner digs one item every `period` ticks; a chest holds up to `capacity` items.
// A furnace's slots hold up to `stack` each, but belts, miners and inserters only
// top them up to `feed` (see furnace.js). An inserter takes `swing` ticks to swing
// across, and as long to swing back. An assembler's slots hold up to `stack` of
// each ingredient; machines fill them to two crafts' worth (see assembler.js).
//
// Power (see power.js) is in joules per tick; 60 J/tick is 1 kW. Machines with a
// `draw` run on electricity and use that much for each tick they work. A generator
// makes up to `power` from the fuel in its slot, which fills like a furnace's. A
// pole joins every pole within `reach` tiles and powers buildings within `area`
// tiles of it.
export const BUILDINGS = {
  belt: { name: "Belt", w: 1, h: 1, cost: { "iron-plate": 1 } },
  // Each end of an underground belt is built on its own: the exit goes up to
  // `reach` tiles ahead of the entrance (see underground.js).
  underground: { name: "Underground belt", w: 1, h: 1, cost: { "iron-plate": 4, "iron-gear": 1 }, reach: 5 },
  splitter: { name: "Splitter", w: 1, h: 1, cost: { "iron-plate": 5, "iron-gear": 2, "electronic-circuit": 1 } },
  sorter: { name: "Sorter", w: 1, h: 1, cost: { "iron-plate": 5, "iron-gear": 2, "electronic-circuit": 3 } },
  miner: { name: "Miner", w: 2, h: 2, cost: { "iron-gear": 3, "iron-plate": 3, stone: 6 }, period: 60, draw: 1500 },
  chest: { name: "Chest", w: 1, h: 1, cost: { "iron-plate": 4 }, capacity: 50 },
  furnace: { name: "Furnace", w: 2, h: 2, cost: { stone: 10 }, stack: 50, feed: 5 },
  inserter: {
    name: "Inserter",
    w: 1,
    h: 1,
    cost: { "iron-plate": 1, "iron-gear": 1, "electronic-circuit": 1 },
    swing: 24,
    draw: 250,
  },
  assembler: {
    name: "Assembler",
    w: 3,
    h: 3,
    cost: { "iron-plate": 9, "iron-gear": 5, "electronic-circuit": 3 },
    stack: 50,
    draw: 1250,
  },
  generator: {
    name: "Coal generator",
    w: 3,
    h: 2,
    cost: { "iron-plate": 8, "iron-gear": 4, stone: 10 },
    power: 10000,
    stack: 50,
    feed: 5,
  },
  // Where milestones are delivered (see progress.js). There's only ever one.
  hub: { name: "HUB", w: 4, h: 4, cost: { "iron-plate": 10, stone: 10 } },
  pole: { name: "Power pole", w: 1, h: 1, cost: { "iron-plate": 1, "copper-cable": 2 }, reach: 7, area: 3 },
};

// Power in J/tick → kW, for showing.
export const kW = (perTick) => Math.round((perTick * 60) / 1000);

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

// The tile just in front of a miner's chute, where its ore goes. Facing north the
// chute sits over the left column (the model in render/buildings.js matches), and
// it turns with the miner like everything else.
export function outputTile(entity) {
  const { w, h } = footprint(entity.type, entity.rot);
  let dx = -0.5; // offset from the footprint's centre, facing north
  let dy = -BUILDINGS[entity.type].h / 2 - 0.5;
  for (let r = 0; r < entity.rot; r++) [dx, dy] = [-dy, dx]; // a quarter turn clockwise
  return { x: Math.floor(entity.x + w / 2 + dx), y: Math.floor(entity.y + h / 2 + dy) };
}
