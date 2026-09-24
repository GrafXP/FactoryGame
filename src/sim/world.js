// Simulation state. Pure data + logic: no three.js, no DOM, so it can be saved,
// loaded and run headless.
import { generateMap, ORE, ORE_NAMES } from "./map.js";
import { BUILDINGS, footprint, outputTile } from "./buildings.js";
import { ORE_ITEM, START_KIT, describe } from "./items.js";
import { createInventory, add, give, missing, take, moveAll } from "./inventory.js";
import { inMap, entityAt } from "./grid.js";
import { stepBelts, takesItems, canTake, put } from "./transport.js";

export { entityAt };

export const TICK_RATE = 60;
export const MAP_SIZE = 128;
export const MINE_TICKS = 30; // hand-mining yields one item every half second

export function createWorld({ seed = 1, size = MAP_SIZE, kit = START_KIT } = {}) {
  return {
    tick: 0,
    seed,
    size,
    map: generateMap(seed, size),
    mapVersion: 0, // bumped when an ore tile runs out, so the view repaints the ground
    entities: new Map(), // id → { id, type, x, y, rot, ...state }; x, y is the top-left tile
    grid: new Int32Array(size * size), // entity id on each tile, 0 = empty
    nextId: 1,
    version: 0, // bumped whenever entities change, so the view knows to redraw them
    inventory: createInventory(kit), // the player's
    mining: null, // { x, y, item, progress } while the player is hand-mining a tile
  };
}

export function step(world) {
  world.tick++;
  stepMining(world);
  for (const e of world.entities.values()) if (e.type === "miner") stepMiner(world, e);
  stepBelts(world);
}

// What's on tile (x, y), or null outside the map.
export function tileAt(world, x, y) {
  if (!inMap(world, x, y)) return null;
  const { size, ore, amount } = world.map;
  const i = y * size + x;
  return { x, y, ore: ore[i], oreName: ORE_NAMES[ore[i]], amount: amount[i], entity: entityAt(world, x, y) };
}

// Why a building's footprint doesn't fit at (x, y), or null if it does.
export function canFit(world, type, x, y, rot) {
  if (!BUILDINGS[type]) return "Unknown building";
  const { w, h } = footprint(type, rot);
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (!inMap(world, tx, ty)) return "Off the map";
      if (world.grid[ty * world.size + tx]) return "Something is in the way";
    }
  }
  return null;
}

// Why a building can't be placed at (x, y): it doesn't fit or the player can't pay for it.
export function canPlace(world, type, x, y, rot) {
  const why = canFit(world, type, x, y, rot);
  if (why) return why;
  const short = missing(world.inventory, BUILDINGS[type].cost);
  return short ? `Missing ${describe(short)}` : null;
}

// Places a building, paying its cost, and returns it. Returns null if it can't be placed.
export function place(world, type, x, y, rot = 0) {
  if (canPlace(world, type, x, y, rot)) return null;
  take(world.inventory, BUILDINGS[type].cost);
  const entity = { id: world.nextId++, type, x, y, rot: rot & 3, ...initialState(type) };
  world.entities.set(entity.id, entity);
  fill(world, entity, entity.id);
  world.version++;
  return entity;
}

// Removes whatever building covers (x, y) and returns it, or null if there was none.
// Its cost and anything stored in it go back to the player (see refundOf).
export function removeAt(world, x, y) {
  const entity = entityAt(world, x, y);
  if (!entity) return null;
  world.entities.delete(entity.id);
  fill(world, entity, 0);
  give(world.inventory, refundOf(entity));
  if (entity.inventory) entity.inventory.items = {};
  if (entity.items) entity.items = [];
  world.version++;
  return entity;
}

// What removing a building gives back: its cost plus whatever it holds or carries.
export function refundOf(entity) {
  const items = { ...BUILDINGS[entity.type].cost };
  for (const id in entity.inventory?.items) items[id] = (items[id] || 0) + entity.inventory.items[id];
  for (const it of entity.items || []) items[it.item] = (items[it.item] || 0) + 1;
  return items;
}

// Empties a chest into the player's inventory and returns what was taken.
export function takeAll(world, chest) {
  return moveAll(chest.inventory, world.inventory);
}

// State a new building starts with. Miners track their dig and why they're stopped,
// chests hold items, belts carry them (see transport.js).
function initialState(type) {
  if (type === "miner") return { progress: 0, status: "working", item: null };
  if (type === "chest") return { inventory: createInventory() };
  if (type === "belt") return { items: [] };
  return {};
}

// A miner digs the ore under its footprint into whatever is on its output tile.
// status says what it's doing: "working", "no-resource" (no ore left under it),
// "no-output" (nothing in front takes items) or "full" (it has dug an item and the
// thing in front has no room for it yet). It waits with the finished item rather
// than dropping it, so a stopped miner loses nothing. `item` is what it's digging.
function stepMiner(world, m) {
  const i = oreUnder(world, m);
  if (i < 0) {
    m.status = "no-resource";
    m.progress = 0;
    m.item = null;
    return;
  }
  const item = (m.item = ORE_ITEM[world.map.ore[i]]);
  const out = outputTile(m);
  const target = entityAt(world, out.x, out.y);
  if (!target || !takesItems(target)) {
    m.status = "no-output";
    return;
  }
  const period = BUILDINGS.miner.period;
  if (m.progress < period) m.progress++;
  if (m.progress < period) {
    m.status = "working";
  } else if (!canTake(target, item)) {
    m.status = "full";
  } else {
    m.status = "working";
    m.progress = 0;
    dig(world, i);
    put(target, item);
  }
}

// Index of the first ore tile under a building, or -1 if there's none.
function oreUnder(world, e) {
  const { w, h } = footprint(e.type, e.rot);
  for (let y = e.y; y < e.y + h; y++) {
    for (let x = e.x; x < e.x + w; x++) if (world.map.ore[y * world.size + x]) return y * world.size + x;
  }
  return -1;
}

// Ore left under a building, e.g. to show on a miner's panel.
export function oreLeftUnder(world, e) {
  const { w, h } = footprint(e.type, e.rot);
  let n = 0;
  for (let y = e.y; y < e.y + h; y++) for (let x = e.x; x < e.x + w; x++) n += world.map.amount[y * world.size + x];
  return n;
}

// Takes one unit of ore from tile i. A tile that runs out turns to plain ground.
function dig(world, i) {
  const { ore, amount } = world.map;
  if (--amount[i] === 0) {
    ore[i] = ORE.NONE;
    world.mapVersion++;
  }
}

// Starts (or keeps) hand-mining tile (x, y). Returns why it can't, or null.
export function startMining(world, x, y) {
  const tile = tileAt(world, x, y);
  if (!tile) return "Off the map";
  if (tile.entity) return "There's a building in the way";
  if (!tile.ore) return "Nothing to mine here";
  const m = world.mining;
  if (!m || m.x !== x || m.y !== y) world.mining = { x, y, item: ORE_ITEM[tile.ore], progress: 0 };
  return null;
}

export function stopMining(world) {
  world.mining = null;
}

// Every MINE_TICKS the mined tile gives up one item. An empty tile turns to plain ground.
function stepMining(world) {
  const m = world.mining;
  if (!m || ++m.progress < MINE_TICKS) return;
  m.progress = 0;
  const i = m.y * world.size + m.x;
  const { ore } = world.map;
  if (!ore[i] || world.grid[i]) {
    world.mining = null; // the tile changed under us
    return;
  }
  add(world.inventory, m.item);
  dig(world, i);
  if (!ore[i]) world.mining = null;
}

function fill(world, entity, id) {
  const { w, h } = footprint(entity.type, entity.rot);
  for (let ty = entity.y; ty < entity.y + h; ty++) {
    for (let tx = entity.x; tx < entity.x + w; tx++) world.grid[ty * world.size + tx] = id;
  }
}
