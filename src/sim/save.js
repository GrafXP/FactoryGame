// Turning a world into save data and back. The data is plain objects plus typed
// arrays, which IndexedDB stores as they are (see ../storage.js).
//
// Only real state is saved. Anything worked out from it is rebuilt on load: the
// buildings on each tile, the belt and power networks, the version counters the view
// watches. Of the map, only the chunks that have been dug into are saved, since the
// rest come back from the seed, and which chunks are charted. Hand-mining isn't
// saved either, since it only lasts while a finger is down. The hand-crafting queue
// is, since a craft under way has taken its ingredients, and so is progress
// towards the HUB's milestones.
//
// SAVE_VERSION goes up whenever the format changes. Add a step to MIGRATIONS that
// turns a save of the old version into the next one, so old saves keep loading.
import { createWorld, addEntity, canFit, initialState } from "./world.js";
import { CHUNK, LIMIT, chunkKey, keyChunk, newChunk } from "./chunks.js";
import { WATER } from "./map.js";
import { SCAN, SCAN_ORDER } from "./radar.js";
import { BUILDINGS, DIRS } from "./buildings.js";
import { ITEMS } from "./items.js";
import { BELT_LEN, isConveyor, isSplitter } from "./transport.js";
import { REACH } from "./underground.js";
import { SMELTING, FUEL, FUEL_ENERGY, RECIPES } from "./recipes.js";
import { SWING } from "./inserter.js";
import { usesPower } from "./power.js";
import { MILESTONES } from "./progress.js";

export const SAVE_FORMAT = "factory-save";
export const SAVE_VERSION = 7;

// What a save from before power gets, so its stopped machines can be started
// again: the parts for a coal generator and ten poles, and coal to burn.
const POWER_GIFT = (() => {
  const gift = { coal: 20 };
  const add = (cost, times) => {
    for (const [id, n] of Object.entries(cost)) gift[id] = (gift[id] || 0) + n * times;
  };
  add(BUILDINGS.generator.cost, 1);
  add(BUILDINGS.pole.cost, 10);
  return gift;
})();

// version → function turning a save of that version into one of version + 1.
export const MIGRATIONS = {
  // 2 added furnaces and inserters, and building costs moved to plates. A version 1
  // save has neither building, so it loads as it is. (Removing a building built at
  // the old ore price refunds today's price.)
  1: (data) => data,
  // 3 added assemblers, gears, cables and circuits, and the hand-crafting queue;
  // miners and inserters now cost gears (and refund today's price).
  2: (data) => ({ ...data, craft: { queue: [], progress: 0, busy: false } }),
  // 4 added power: miners, inserters and assemblers store energy, and there are
  // generators and poles. The machines start with none, so they stop until the
  // player builds power; the inventory gets the parts for it (POWER_GIFT).
  3: (data) => {
    const inventory = { ...data.inventory };
    for (const [id, n] of Object.entries(POWER_GIFT)) inventory[id] = (inventory[id] || 0) + n;
    const entities = data.entities.map((e) => (usesPower(e.type) ? { ...e, energy: 0 } : e));
    return { ...data, inventory, entities };
  },
  // 5 added the HUB and its milestones, which lock buildings until they're reached.
  // A save from before was built without them, so it gets everything unlocked and
  // only the last milestone, the goal, still to do.
  4: (data) => ({ ...data, progress: { milestone: MILESTONES.length - 1, delivered: {} } }),
  // 6 added underground belts, splitters and sorters. A version 5 save has none,
  // so it loads as it is.
  5: (data) => data,
  // 7 made the map endless, in chunks, with the start at (0, 0) and a map view that
  // shows only charted land. A version 6 map was `size` × `size` with the start in
  // its middle: it's kept as it was, moved so its middle is at (0, 0), and all of it
  // is charted. The land round it is new.
  6: ({ size, map, entities, ...data }) => {
    const half = Math.floor(size / 2);
    const chunks = [];
    const charted = [];
    for (let cy = Math.floor(-half / CHUNK); cy * CHUNK < size - half; cy++) {
      for (let cx = Math.floor(-half / CHUNK); cx * CHUNK < size - half; cx++) {
        const ore = new Uint8Array(CHUNK * CHUNK);
        const amount = new Uint32Array(CHUNK * CHUNK);
        for (let i = 0; i < CHUNK * CHUNK; i++) {
          const x = cx * CHUNK + (i % CHUNK) + half;
          const y = cy * CHUNK + Math.floor(i / CHUNK) + half;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          ore[i] = map.ore[y * size + x];
          amount[i] = map.amount[y * size + x];
        }
        chunks.push({ cx, cy, ore, amount });
        charted.push(cx, cy);
      }
    }
    return {
      ...data,
      map: { chunks },
      charted: Int32Array.from(charted),
      entities: entities.map((e) => ({ ...e, x: e.x - half, y: e.y - half })),
    };
  },
};

// A save that can't be loaded. The message is written for the player.
export class SaveError extends Error {
  name = "SaveError";
}

export function serialize(world) {
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    seed: world.seed,
    tick: world.tick,
    nextId: world.nextId,
    // The chunks that have been dug into, and which chunks are charted, both in key order.
    map: {
      chunks: [...world.chunks.entries()]
        .filter(([, c]) => c.changed)
        .sort(([a], [b]) => a - b)
        .map(([, c]) => ({ cx: c.cx, cy: c.cy, ore: c.ore.slice(), amount: c.amount.slice() })),
    },
    charted: Int32Array.from([...world.charted].sort((a, b) => a - b).flatMap((k) => [keyChunk(k).cx, keyChunk(k).cy])),
    inventory: { ...world.inventory.items },
    craft: {
      queue: world.craft.queue.map(({ recipe, n }) => ({ recipe, n })),
      progress: world.craft.progress,
      busy: world.craft.busy,
    },
    progress: { milestone: world.progress.milestone, delivered: { ...world.progress.delivered } },
    // In the order they were built: the sim steps them in that order, so keeping it
    // makes a loaded world carry on exactly as the saved one would have.
    entities: [...world.entities.values()].map(saveEntity),
  };
}

function saveEntity(e) {
  const out = { id: e.id, type: e.type, x: e.x, y: e.y, rot: e.rot };
  if (e.type === "miner") Object.assign(out, { progress: e.progress, status: e.status, item: e.item });
  if (e.type === "chest") out.items = { ...e.inventory.items };
  if (isConveyor(e)) out.items = e.items.map(({ item, pos, exit }) => (exit === undefined ? { item, pos } : { item, pos, exit }));
  if (e.type === "underground") Object.assign(out, { end: e.end, pair: e.pair });
  if (isSplitter(e)) Object.assign(out, { turn: e.turn, status: e.status });
  if (e.type === "sorter") out.filters = [...e.filters];
  if (e.type === "furnace") {
    const slot = (s) => s && { item: s.item, n: s.n };
    Object.assign(out, { input: slot(e.input), fuel: slot(e.fuel), output: slot(e.output) });
    Object.assign(out, { smelting: e.smelting, progress: e.progress, burn: e.burn, status: e.status });
  }
  if (e.type === "inserter") Object.assign(out, { hand: e.hand, swing: e.swing, status: e.status });
  if (e.type === "assembler") {
    Object.assign(out, { recipe: e.recipe, inputs: { ...e.inputs }, output: e.output && { item: e.output.item, n: e.output.n } });
    Object.assign(out, { progress: e.progress, crafting: e.crafting, status: e.status });
  }
  if (e.type === "generator") Object.assign(out, { fuel: e.fuel && { item: e.fuel.item, n: e.fuel.n }, burn: e.burn, status: e.status });
  if (e.type === "radar") Object.assign(out, { next: e.next, progress: e.progress, status: e.status });
  if (usesPower(e.type)) out.energy = e.energy;
  return out;
}

// Builds a world from save data, migrating it first if it's from an older version.
// Throws a SaveError saying what's wrong if it can't. The options are for tests.
export function deserialize(data, { migrations = MIGRATIONS, version = SAVE_VERSION } = {}) {
  data = migrate(data, migrations, version);
  try {
    return load(data);
  } catch (err) {
    if (err instanceof SaveError) throw err;
    throw new SaveError(`The save is damaged (${err.message}).`);
  }
}

function migrate(data, migrations, current) {
  if (!data || typeof data !== "object" || data.format !== SAVE_FORMAT) throw new SaveError("This isn't a Factory save.");
  if (!Number.isInteger(data.version) || data.version < 1) throw new SaveError("The save is damaged (it has no version).");
  if (data.version > current) {
    throw new SaveError(
      `This save was made by a newer version of the game (save format ${data.version}, this game reads up to ${current}). Reload the page to update the game.`,
    );
  }
  while (data.version < current) {
    const step = migrations[data.version];
    if (!step) {
      throw new SaveError(
        `This save is from an old version of the game (save format ${data.version}) that this version can't convert.`,
      );
    }
    data = { ...step(data), version: data.version + 1 };
  }
  return data;
}

function load(data) {
  const { seed, tick, nextId, map, charted, inventory, entities, craft, progress } = data;
  check(Number.isInteger(tick) && tick >= 0, "bad clock");
  check(Array.isArray(map?.chunks), "bad map");
  check(charted instanceof Int32Array && charted.length % 2 === 0, "bad charted map");
  check(Array.isArray(entities), "no buildings list");

  const world = createWorld({ seed, kit: checkItems(inventory, "inventory"), charted: false });
  world.tick = tick;
  for (const c of map.chunks) {
    const key = checkChunkAt(c?.cx, c?.cy);
    check(!world.chunks.has(key), "a map chunk twice");
    check(c.ore instanceof Uint8Array && c.ore.length === CHUNK * CHUNK && c.ore.every((k) => k <= WATER), "bad ore map");
    check(c.amount instanceof Uint32Array && c.amount.length === CHUNK * CHUNK, "bad ore amounts");
    world.chunks.set(key, newChunk(c.cx, c.cy, { ore: c.ore.slice(), amount: c.amount.slice() }, true));
  }
  for (let i = 0; i < charted.length; i += 2) world.charted.add(checkChunkAt(charted[i], charted[i + 1]));
  Object.assign(world.craft, checkCraft(craft));
  Object.assign(world.progress, checkProgress(progress)); // before the HUB is added, which refers to it

  let maxId = 0;
  for (const s of entities) {
    const where = `building ${s?.id}`;
    check(Number.isInteger(s?.id) && s.id > 0 && !world.entities.has(s.id), `${where}: bad id`);
    check(Object.hasOwn(BUILDINGS, s.type), `${where}: unknown type "${s.type}"`);
    check(Number.isInteger(s.rot) && s.rot >= 0 && s.rot < 4, `${where}: bad rotation`);
    check(!canFit(world, s.type, s.x, s.y, s.rot), `${where}: overlaps or is off the map`);
    const e = { id: s.id, type: s.type, x: s.x, y: s.y, rot: s.rot, ...initialState(s.type) };
    if (s.type === "miner") {
      check(Number.isInteger(s.progress) && s.progress >= 0, `${where}: bad progress`);
      check(s.item === null || Object.hasOwn(ITEMS, s.item), `${where}: unknown item`);
      Object.assign(e, { progress: s.progress, status: String(s.status), item: s.item });
    }
    if (s.type === "chest") Object.assign(e.inventory.items, checkItems(s.items, where));
    if (isConveyor(s)) e.items = checkBeltItems(s.items, where, isSplitter(s));
    if (s.type === "underground") {
      check(s.end === "in" || s.end === "out", `${where}: bad end`);
      check(s.pair === null || Number.isInteger(s.pair), `${where}: bad pair`);
      Object.assign(e, { end: s.end, pair: s.pair });
    }
    if (isSplitter(s)) {
      check(Number.isInteger(s.turn) && s.turn >= 0 && s.turn < 3, `${where}: bad turn`);
      Object.assign(e, { turn: s.turn, status: String(s.status) });
    }
    if (s.type === "sorter") {
      const ok = (f) => f === "any" || f === "overflow" || Object.hasOwn(ITEMS, f);
      check(Array.isArray(s.filters) && s.filters.length === 3 && s.filters.every(ok), `${where}: bad filters`);
      e.filters = [...s.filters];
    }
    if (s.type === "furnace") Object.assign(e, checkFurnace(s, where));
    if (s.type === "assembler") Object.assign(e, checkAssembler(s, where));
    if (s.type === "inserter") {
      check(s.hand === null || Object.hasOwn(ITEMS, s.hand), `${where}: unknown item`);
      check(Number.isInteger(s.swing) && s.swing >= 0 && s.swing <= SWING, `${where}: bad swing`);
      Object.assign(e, { hand: s.hand, swing: s.swing, status: String(s.status) });
    }
    if (s.type === "generator") Object.assign(e, checkGenerator(s, where));
    if (s.type === "radar") {
      check(Number.isInteger(s.next) && s.next >= 0 && s.next <= SCAN_ORDER.length, `${where}: bad scan`);
      check(Number.isInteger(s.progress) && s.progress >= 0 && s.progress < SCAN, `${where}: bad scan`);
      Object.assign(e, { next: s.next, progress: s.progress, status: String(s.status) });
    }
    if (usesPower(s.type)) {
      const draw = BUILDINGS[s.type].draw;
      check(Number.isInteger(s.energy) && s.energy >= 0 && s.energy <= 2 * draw, `${where}: bad energy`);
      e.energy = s.energy;
    }
    addEntity(world, e);
    maxId = Math.max(maxId, s.id);
  }
  world.nextId = Math.max(nextId | 0, maxId + 1);
  checkConveyors(world);
  return world;
}

// Underground ends are paired both ways, in line and in reach, and every item is on
// its conveyor: within a tile, or for a paired entrance, before its exit.
function checkConveyors(world) {
  for (const e of world.entities.values()) {
    if (!isConveyor(e)) continue;
    const where = `building ${e.id}`;
    let len = BELT_LEN;
    if (e.type === "underground" && e.pair !== null) {
      const p = world.entities.get(e.pair);
      check(p?.type === "underground" && p.pair === e.id && p.end !== e.end && p.rot === e.rot, `${where}: bad pair`);
      const [entrance, exit] = e.end === "in" ? [e, p] : [p, e];
      const [dx, dy] = DIRS[e.rot];
      const d = Math.abs(exit.x - entrance.x) + Math.abs(exit.y - entrance.y);
      check(d >= 1 && d <= REACH && exit.x === entrance.x + dx * d && exit.y === entrance.y + dy * d, `${where}: pair out of line`);
      if (e.end === "in") len = d * BELT_LEN;
    }
    check(e.items.every((it) => it.pos <= len), `${where}: item off the belt`);
  }
}

function check(ok, why) {
  if (!ok) throw new SaveError(`The save is damaged (${why}).`);
}

// The key of chunk (cx, cy), checking it's on the map.
function checkChunkAt(cx, cy) {
  const most = LIMIT / CHUNK;
  check(Number.isInteger(cx) && Number.isInteger(cy) && Math.abs(cx) <= most && Math.abs(cy) <= most, "bad map chunk");
  return chunkKey(cx, cy);
}

// { itemId: count } with known items and whole positive counts.
function checkItems(items, where) {
  check(items && typeof items === "object", `${where}: bad items`);
  const out = {};
  for (const [id, n] of Object.entries(items)) {
    check(Object.hasOwn(ITEMS, id), `${where}: unknown item "${id}"`);
    check(Number.isInteger(n) && n > 0, `${where}: bad count of ${id}`);
    out[id] = n;
  }
  return out;
}

// A furnace's slots hold what each slot can take; the plate it's making is a known recipe.
function checkFurnace(s, where) {
  const slot = (v, ok, name) => {
    if (v === null) return null;
    check(ok(v?.item) && Number.isInteger(v.n) && v.n > 0, `${where}: bad ${name}`);
    return { item: v.item, n: v.n };
  };
  const out = {
    input: slot(s.input, (id) => Object.hasOwn(SMELTING, id), "input"),
    fuel: slot(s.fuel, (id) => Object.hasOwn(FUEL, id), "fuel"),
    output: slot(s.output, (id) => Object.hasOwn(ITEMS, id), "output"),
  };
  check(s.smelting === null || Object.hasOwn(SMELTING, s.smelting), `${where}: bad recipe`);
  check(Number.isInteger(s.progress) && s.progress >= 0, `${where}: bad progress`);
  check(Number.isInteger(s.burn) && s.burn >= 0, `${where}: bad fuel`);
  return { ...out, smelting: s.smelting, progress: s.progress, burn: s.burn, status: String(s.status) };
}

// A generator's fuel is a fuel, and what's left burning a whole number of joules.
function checkGenerator(s, where) {
  const f = s.fuel;
  check(f === null || (Object.hasOwn(FUEL_ENERGY, f?.item) && Number.isInteger(f.n) && f.n > 0), `${where}: bad fuel`);
  check(Number.isInteger(s.burn) && s.burn >= 0, `${where}: bad fuel`);
  return { fuel: f && { item: f.item, n: f.n }, burn: s.burn, status: String(s.status) };
}

// An assembler's recipe is known (or null), and it holds only that recipe's items.
function checkAssembler(s, where) {
  const r = s.recipe === null ? null : RECIPES[s.recipe];
  check(s.recipe === null || Object.hasOwn(RECIPES, s.recipe), `${where}: unknown recipe`);
  const inputs = checkItems(s.inputs, where);
  check(Object.keys(inputs).every((id) => r && Object.hasOwn(r.in, id)), `${where}: ingredients that aren't the recipe's`);
  const out = s.output;
  check(out === null || (r && out.item === s.recipe && Number.isInteger(out.n) && out.n > 0), `${where}: bad output`);
  check(Number.isInteger(s.progress) && s.progress >= 0, `${where}: bad progress`);
  check(typeof s.crafting === "boolean" && (!s.crafting || r), `${where}: bad craft`);
  return {
    recipe: s.recipe,
    inputs,
    output: out && { item: out.item, n: out.n },
    progress: s.progress,
    crafting: s.crafting,
    status: String(s.status),
  };
}

// Milestones done, and what's been delivered to the next: only what it needs, and
// never all of it (that would have finished it).
function checkProgress(p) {
  check(Number.isInteger(p?.milestone) && p.milestone >= 0 && p.milestone <= MILESTONES.length, "bad milestone");
  const delivered = checkItems(p.delivered, "milestone");
  const needs = MILESTONES[p.milestone]?.needs || {};
  const done = Object.keys(needs).every((id) => (delivered[id] || 0) >= needs[id]);
  check(Object.entries(delivered).every(([id, n]) => n <= (needs[id] || 0)) && (!done || !Object.keys(needs).length), "bad deliveries");
  return { milestone: p.milestone, delivered };
}

// The hand-crafting queue: known recipes, whole counts.
function checkCraft(c) {
  check(c && Array.isArray(c.queue), "bad crafting queue");
  const queue = c.queue.map(({ recipe, n } = {}) => {
    check(Object.hasOwn(RECIPES, recipe) && Number.isInteger(n) && n > 0, "bad crafting queue");
    return { recipe, n };
  });
  check(Number.isInteger(c.progress) && c.progress >= 0 && typeof c.busy === "boolean", "bad crafting queue");
  check(!c.busy || queue.length, "bad crafting queue");
  return { queue, progress: c.progress, busy: c.busy };
}

// A conveyor's items, front first. A splitter's may have picked a way out
// (`exit`). How far along they can be is checked once the pairs are known
// (checkConveyors).
function checkBeltItems(items, where, split) {
  check(Array.isArray(items), `${where}: bad belt items`);
  let prev = Infinity;
  return items.map(({ item, pos, exit } = {}) => {
    check(Object.hasOwn(ITEMS, item), `${where}: unknown item "${item}"`);
    check(Number.isInteger(pos) && pos >= 0 && pos <= prev, `${where}: item off the belt`);
    prev = pos;
    if (exit === undefined) return { item, pos };
    check(split && [0, 1, 2].includes(exit), `${where}: bad way out`);
    return { item, pos, exit };
  });
}
