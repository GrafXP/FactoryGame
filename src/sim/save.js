// Turning a world into save data and back. The data is plain objects plus the map's
// typed arrays, which IndexedDB stores as they are (see ../storage.js).
//
// Only real state is saved. Anything worked out from it is rebuilt on load: the tile
// grid, the belt and power networks, the version counters the view watches. Hand-mining isn't
// saved either, since it only lasts while a finger is down. The hand-crafting queue
// is, since a craft under way has taken its ingredients, and so is progress
// towards the HUB's milestones.
//
// SAVE_VERSION goes up whenever the format changes. Add a step to MIGRATIONS that
// turns a save of the old version into the next one, so old saves keep loading.
import { createWorld, addEntity, canFit, initialState } from "./world.js";
import { BUILDINGS } from "./buildings.js";
import { ITEMS } from "./items.js";
import { BELT_LEN } from "./transport.js";
import { SMELTING, FUEL, FUEL_ENERGY, RECIPES } from "./recipes.js";
import { SWING } from "./inserter.js";
import { usesPower } from "./power.js";
import { MILESTONES } from "./progress.js";

export const SAVE_FORMAT = "factory-save";
export const SAVE_VERSION = 5;

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
    size: world.size,
    tick: world.tick,
    nextId: world.nextId,
    map: { ore: world.map.ore.slice(), amount: world.map.amount.slice() },
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
  if (e.type === "belt") out.items = e.items.map(({ item, pos }) => ({ item, pos }));
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
  const { seed, size, tick, nextId, map, inventory, entities, craft, progress } = data;
  check(Number.isInteger(size) && size > 0, "bad map size");
  check(Number.isInteger(tick) && tick >= 0, "bad clock");
  check(map?.ore instanceof Uint8Array && map.ore.length === size * size, "bad ore map");
  check(map?.amount instanceof Uint32Array && map.amount.length === size * size, "bad ore amounts");
  check(Array.isArray(entities), "no buildings list");

  const world = createWorld({
    seed,
    size,
    kit: checkItems(inventory, "inventory"),
    map: { size, ore: map.ore.slice(), amount: map.amount.slice() },
  });
  world.tick = tick;
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
    if (s.type === "belt") e.items = checkBeltItems(s.items, where);
    if (s.type === "furnace") Object.assign(e, checkFurnace(s, where));
    if (s.type === "assembler") Object.assign(e, checkAssembler(s, where));
    if (s.type === "inserter") {
      check(s.hand === null || Object.hasOwn(ITEMS, s.hand), `${where}: unknown item`);
      check(Number.isInteger(s.swing) && s.swing >= 0 && s.swing <= SWING, `${where}: bad swing`);
      Object.assign(e, { hand: s.hand, swing: s.swing, status: String(s.status) });
    }
    if (s.type === "generator") Object.assign(e, checkGenerator(s, where));
    if (usesPower(s.type)) {
      const draw = BUILDINGS[s.type].draw;
      check(Number.isInteger(s.energy) && s.energy >= 0 && s.energy <= 2 * draw, `${where}: bad energy`);
      e.energy = s.energy;
    }
    addEntity(world, e);
    maxId = Math.max(maxId, s.id);
  }
  world.nextId = Math.max(nextId | 0, maxId + 1);
  return world;
}

function check(ok, why) {
  if (!ok) throw new SaveError(`The save is damaged (${why}).`);
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

// A belt's items, front first, each on the belt.
function checkBeltItems(items, where) {
  check(Array.isArray(items), `${where}: bad belt items`);
  let prev = Infinity;
  return items.map(({ item, pos } = {}) => {
    check(Object.hasOwn(ITEMS, item), `${where}: unknown item "${item}"`);
    check(Number.isInteger(pos) && pos >= 0 && pos <= BELT_LEN && pos <= prev, `${where}: item off the belt`);
    prev = pos;
    return { item, pos };
  });
}
