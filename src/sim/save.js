// Turning a world into save data and back. The data is plain objects plus the map's
// typed arrays, which IndexedDB stores as they are (see ../storage.js).
//
// Only real state is saved. Anything worked out from it is rebuilt on load: the tile
// grid, the belt network, the version counters the view watches. Hand-mining isn't
// saved either, since it only lasts while a finger is down.
//
// SAVE_VERSION goes up whenever the format changes. Add a step to MIGRATIONS that
// turns a save of the old version into the next one, so old saves keep loading.
import { createWorld, addEntity, canFit, initialState } from "./world.js";
import { BUILDINGS } from "./buildings.js";
import { ITEMS } from "./items.js";
import { BELT_LEN } from "./transport.js";
import { SMELTING, FUEL } from "./recipes.js";
import { SWING } from "./inserter.js";

export const SAVE_FORMAT = "factory-save";
export const SAVE_VERSION = 2;

// version → function turning a save of that version into one of version + 1.
export const MIGRATIONS = {
  // 2 added furnaces and inserters, and building costs moved to plates. A version 1
  // save has neither building, so it loads as it is. (Removing a building built at
  // the old ore price refunds today's price.)
  1: (data) => data,
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
  const { seed, size, tick, nextId, map, inventory, entities } = data;
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
    if (s.type === "inserter") {
      check(s.hand === null || Object.hasOwn(ITEMS, s.hand), `${where}: unknown item`);
      check(Number.isInteger(s.swing) && s.swing >= 0 && s.swing <= SWING, `${where}: bad swing`);
      Object.assign(e, { hand: s.hand, swing: s.swing, status: String(s.status) });
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
