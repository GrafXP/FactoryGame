// Simulation state. Pure data + logic: no three.js, no DOM, so it can be saved,
// loaded and run headless.
import { ORE, ORE_NAMES, WATER, isOre } from "./map.js";
import { BUILDINGS, footprint, outputTile } from "./buildings.js";
import { ORE_ITEM, START_KIT, describe } from "./items.js";
import { createInventory, add, give, missing, take, move, moveAll, total } from "./inventory.js";
import { inMap, entityAt } from "./grid.js";
import { chunkOf, tileIndex, setIdAt, chartArea } from "./chunks.js";
import { radarState, stepRadar } from "./radar.js";
import { stepBelts, takesItems, canTake, put, splitterState, ANY_FILTERS } from "./transport.js";
import { undergroundState, undergroundWhy, pairUp, unpair, buried } from "./underground.js";
import { furnaceState, furnaceContents, stepFurnace } from "./furnace.js";
import { inserterState, inserterEnds, stepInserter } from "./inserter.js";
import { assemblerState, assemblerContents, stepAssembler } from "./assembler.js";
import { craftState, stepCraft } from "./crafting.js";
import { generatorState } from "./generator.js";
import { stepPower, usePower, usesPower } from "./power.js";
import { progressState, lockedWhy } from "./progress.js";

export { entityAt };

export const TICK_RATE = 60;
export const MINE_TICKS = 30; // hand-mining yields one item every half second
// A new game starts with the chunks this many each way of the start (0, 0) charted.
export const START_CHARTED = 2;

// A new world, on the endless map for `seed` (chunks.js). The land round the start
// is charted, unless `charted` is false (a save brings its own). `milestones`
// starts it with that many milestones done (progress.js), e.g. all of them for tests
// that build anything.
export function createWorld({ seed = 1, kit = START_KIT, milestones = 0, charted = true } = {}) {
  const world = {
    tick: 0,
    seed,
    chunks: new Map(), // chunk key → chunk: the land and what's built on it (chunks.js)
    charted: new Set(), // keys of the chunks the map view shows
    chartVersion: 0, // bumped when a chunk is charted
    mapVersion: 0, // bumped when an ore tile runs out, so the view repaints the ground
    entities: new Map(), // id → { id, type, x, y, rot, ...state }; x, y is the top-left tile
    nextId: 1,
    version: 0, // bumped whenever entities change, so the view knows to redraw them
    beltVersion: 0, // bumped when a building the belt network is made of changes (see changed())
    powerVersion: 0, // likewise for the power network
    inventory: createInventory(kit), // the player's
    mining: null, // { x, y, item, progress } while the player is hand-mining a tile
    craft: craftState(), // the player's hand-crafting queue (crafting.js)
    progress: progressState(milestones), // milestones done and deliveries (progress.js)
  };
  if (charted) chartArea(world, -START_CHARTED, -START_CHARTED, START_CHARTED - 1, START_CHARTED - 1);
  return world;
}

export function step(world) {
  world.tick++;
  stepMining(world);
  stepCraft(world);
  stepPower(world);
  for (const m of machines(world)) {
    const e = m.e;
    if (e.type === "miner") stepMiner(world, e, m);
    else if (e.type === "furnace") stepFurnace(e);
    else if (e.type === "assembler") stepAssembler(world, e);
    else if (e.type === "inserter") stepInserter(world, e, m.from, m.to);
    else if (e.type === "radar") stepRadar(world, e);
  }
  stepBelts(world);
}

// The buildings that do something each tick, in the order they were built (the
// order step() has always gone in, so a loaded world runs like the saved one), with
// what each one needs of its neighbours: the building on a miner's output tile and
// the tiles under it, as [chunk, index, ...]; an inserter's source and target.
// Belts move in stepBelts, and chests and poles do nothing on their own. Worked out
// from the layout and cached until it changes (world.version), like the belt
// network; it isn't saved.
const STEPPED = new Set(["miner", "furnace", "assembler", "inserter", "radar"]);
function machines(world) {
  if (world.machines?.version === world.version) return world.machines.list;
  const list = [];
  for (const e of world.entities.values()) {
    if (!STEPPED.has(e.type)) continue;
    const m = { e, from: null, to: null, ground: null };
    if (e.type === "miner") {
      const out = outputTile(e);
      m.to = entityAt(world, out.x, out.y);
      m.ground = [];
      const { w, h } = footprint(e.type, e.rot);
      for (let y = e.y; y < e.y + h; y++) for (let x = e.x; x < e.x + w; x++) m.ground.push(chunkOf(world, x, y), tileIndex(x, y));
    } else if (e.type === "inserter") {
      const { from, to } = inserterEnds(e);
      m.from = entityAt(world, from.x, from.y);
      m.to = entityAt(world, to.x, to.y);
    }
    list.push(m);
  }
  world.machines = { version: world.version, list };
  return list;
}

// What's on tile (x, y), or null off the map: its ore (ORE.NONE for plain ground
// or water), whether it's water, its name, how much ore is left and its building.
export function tileAt(world, x, y) {
  if (!inMap(x, y)) return null;
  const c = chunkOf(world, x, y);
  const i = tileIndex(x, y);
  const kind = c.ore[i];
  return {
    x,
    y,
    ore: isOre(kind) ? kind : ORE.NONE,
    water: kind === WATER,
    oreName: ORE_NAMES[kind],
    amount: c.amount[i],
    entity: entityAt(world, x, y),
  };
}

// Why a building's footprint doesn't fit at (x, y), or null if it does.
export function canFit(world, type, x, y, rot) {
  if (!BUILDINGS[type]) return "Unknown building";
  if (type === "hub" && [...world.entities.values()].some((e) => e.type === "hub")) return "There's already a HUB";
  const { w, h } = footprint(type, rot);
  for (let ty = y; ty < y + h; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      if (!inMap(tx, ty)) return "Off the map";
      const c = chunkOf(world, tx, ty);
      const i = tileIndex(tx, ty);
      if (c.ore[i] === WATER) return "Can't build on water";
      if (c.ids[i]) return "Something is in the way";
    }
  }
  return null;
}

// Why a building can't be placed at (x, y): it's locked, it doesn't fit, it's an
// underground exit with no entrance, or the player can't pay for it. `opts` are
// for initialState, e.g. { end: "out" } for an underground exit.
export function canPlace(world, type, x, y, rot, opts = {}) {
  const why =
    lockedWhy(world, type) ||
    canFit(world, type, x, y, rot) ||
    (type === "underground" && undergroundWhy(world, x, y, rot & 3, opts.end || "in"));
  if (why) return why;
  const short = missing(world.inventory, BUILDINGS[type].cost);
  return short ? `Missing ${describe(short)}` : null;
}

// Places a building, paying its cost, and returns it. Returns null if it can't be placed.
export function place(world, type, x, y, rot = 0, opts = {}) {
  if (canPlace(world, type, x, y, rot, opts)) return null;
  take(world.inventory, BUILDINGS[type].cost);
  const e = addEntity(world, { id: world.nextId++, type, x, y, rot: rot & 3, ...initialState(type, opts) });
  if (type === "underground") pairUp(world, e);
  return e;
}

// Puts a finished entity into the world without paying for it. Loading a save uses
// this too; the caller has checked that it fits.
export function addEntity(world, entity) {
  if (entity.type === "hub") entity.progress = world.progress; // where deliveries go
  world.entities.set(entity.id, entity);
  fill(world, entity, entity.id);
  changed(world, entity);
  return entity;
}

// Notes that building e has been built or removed: world.version goes up, and so do
// the counters of the networks worked out from it, so building a belt doesn't work
// out the power network again, nor building a pole the belt network. Belts connect
// to conveyors and whatever takes items (transport.js); power to poles, generators
// and whatever uses power (power.js).
function changed(world, e) {
  world.version++;
  if (takesItems(e)) world.beltVersion++;
  if (e.type === "pole" || e.type === "generator" || usesPower(e.type)) world.powerVersion++;
}

// Removes whatever building covers (x, y) and returns it, or null if there was none.
// Its cost and anything stored in it go back to the player (see refundOf).
export function removeAt(world, x, y) {
  const entity = entityAt(world, x, y);
  if (!entity) return null;
  const under = entity.type === "underground" ? unpair(world, entity) : [];
  world.entities.delete(entity.id);
  fill(world, entity, 0);
  changed(world, entity);
  give(world.inventory, refundOf(entity));
  for (const it of under) give(world.inventory, { [it.item]: 1 });
  // Emptied, so a panel still showing it can't hand out its contents twice.
  if (entity.inventory) entity.inventory.items = {};
  if (entity.items) entity.items = [];
  if (entity.type === "furnace") Object.assign(entity, furnaceState());
  if (entity.type === "assembler") Object.assign(entity, assemblerState());
  if (entity.type === "generator") entity.fuel = null;
  if (entity.hand) entity.hand = null;
  return entity;
}

// What removing a building gives back: its cost plus whatever it holds or carries.
// Given the world, that includes what's underground behind an underground exit.
export function refundOf(entity, world = null) {
  const items = { ...BUILDINGS[entity.type].cost };
  const add = (id, n = 1) => (items[id] = (items[id] || 0) + n);
  for (const id in entity.inventory?.items) add(id, entity.inventory.items[id]);
  for (const it of entity.items || []) add(it.item);
  if (entity.type === "furnace") for (const [id, n] of Object.entries(furnaceContents(entity))) add(id, n);
  if (entity.type === "assembler") for (const [id, n] of Object.entries(assemblerContents(entity))) add(id, n);
  if (entity.type === "generator" && entity.fuel) add(entity.fuel.item, entity.fuel.n);
  if (entity.hand) add(entity.hand);
  const entrance = world && entity.type === "underground" && entity.end === "out" && world.entities.get(entity.pair);
  if (entrance) for (const it of buried(entrance)) add(it.item);
  return items;
}

// Empties a chest into the player's inventory and returns what was taken.
export function takeAll(world, chest) {
  return moveAll(chest.inventory, world.inventory);
}

// How many more items a chest holds.
export const chestRoom = (chest) => BUILDINGS.chest.capacity - total(chest.inventory);

// Takes up to `max` of `item` out of a chest into the player's inventory, or puts
// up to `max` of it in from the inventory, as far as the chest has room. Each
// returns how many moved.
export const takeFromChest = (world, chest, item, max = Infinity) => move(chest.inventory, world.inventory, item, max);
export const putInChest = (world, chest, item, max = Infinity) =>
  move(world.inventory, chest.inventory, item, Math.min(max, chestRoom(chest)));

// State a new building starts with. Miners track their dig and why they're stopped,
// chests hold items, conveyors carry them (see transport.js and underground.js);
// furnaces, inserters, assemblers and generators are in their own files. Machines
// that run on power start with an empty store of energy (see power.js). `opts`
// says which end an underground belt is ({ end: "in" | "out" }).
export function initialState(type, opts = {}) {
  const power = usesPower(type) ? { energy: 0 } : {};
  if (type === "miner") return { progress: 0, status: "working", item: null, ...power };
  if (type === "chest") return { inventory: createInventory() };
  if (type === "belt") return { items: [] };
  if (type === "underground") return undergroundState(opts.end);
  if (type === "splitter") return splitterState();
  if (type === "sorter") return { ...splitterState(), filters: [...ANY_FILTERS] };
  if (type === "furnace") return furnaceState();
  if (type === "inserter") return { ...inserterState(), ...power };
  if (type === "assembler") return { ...assemblerState(), ...power };
  if (type === "generator") return generatorState();
  if (type === "radar") return { ...radarState(), ...power };
  return {};
}

// A miner digs the ore under its footprint into whatever is on its output tile,
// using power while it digs. status says what it's doing: "working", "no-resource"
// (no ore left under it), "no-output" (nothing in front takes items), "no-power" or
// "full" (it has dug an item and the thing in front has no room for it yet). It
// waits with the finished item rather than dropping it, so a stopped miner loses
// nothing. `item` is what it's digging. `at` is its entry in machines(): what's on
// its output tile, and the ground under it.
function stepMiner(world, m, at) {
  const { ground, to: target } = at;
  let c = null;
  let i = 0;
  for (let k = 0; k < ground.length; k += 2) {
    if (!isOre(ground[k].ore[ground[k + 1]])) continue;
    c = ground[k];
    i = ground[k + 1];
    break;
  }
  if (!c) {
    m.status = "no-resource";
    m.progress = 0;
    m.item = null;
    return;
  }
  const item = (m.item = ORE_ITEM[c.ore[i]]);
  if (!target || !takesItems(target)) {
    m.status = "no-output";
    return;
  }
  const period = BUILDINGS.miner.period;
  if (m.progress < period) {
    if (!usePower(world, m)) return;
    m.progress++;
  }
  if (m.progress < period) {
    m.status = "working";
  } else if (!canTake(target, item)) {
    m.status = "full";
  } else {
    m.status = "working";
    m.progress = 0;
    dig(world, c, i);
    put(target, item);
  }
}

// Ore left under a building, e.g. to show on a miner's panel.
export function oreLeftUnder(world, e) {
  const { w, h } = footprint(e.type, e.rot);
  let n = 0;
  for (let y = e.y; y < e.y + h; y++) for (let x = e.x; x < e.x + w; x++) n += chunkOf(world, x, y).amount[tileIndex(x, y)];
  return n;
}

// Takes one unit of ore from tile i of chunk c. A tile that runs out turns to
// plain ground.
function dig(world, c, i) {
  c.changed = true;
  if (--c.amount[i] === 0) {
    c.ore[i] = ORE.NONE;
    c.version++;
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
  const c = chunkOf(world, m.x, m.y);
  const i = tileIndex(m.x, m.y);
  if (!isOre(c.ore[i]) || c.ids[i]) {
    world.mining = null; // the tile changed under us
    return;
  }
  add(world.inventory, m.item);
  dig(world, c, i);
  if (!c.ore[i]) world.mining = null;
}

function fill(world, entity, id) {
  const { w, h } = footprint(entity.type, entity.rot);
  for (let ty = entity.y; ty < entity.y + h; ty++) {
    for (let tx = entity.x; tx < entity.x + w; tx++) setIdAt(world, tx, ty, id);
  }
}
