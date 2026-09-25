import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, place, removeAt, canPlace, entityAt, tileAt } from "../src/sim/world.js";
import { beltLine } from "../src/sim/buildings.js";
import { ALL } from "./helpers.js";

test("placing a building fills its footprint and keeps its facing", () => {
  const world = createWorld({ milestones: ALL, seed: 1 });
  const miner = place(world, "miner", 10, 10, 1);
  assert.ok(miner);
  assert.equal(miner.rot, 1);
  for (const [x, y] of [[10, 10], [11, 10], [10, 11], [11, 11]]) assert.equal(entityAt(world, x, y), miner);
  assert.equal(entityAt(world, 12, 10), null);
  assert.equal(tileAt(world, 11, 11).entity, miner);
});

test("buildings can't overlap or leave the map", () => {
  const world = createWorld({ milestones: ALL, seed: 1 });
  place(world, "miner", 10, 10, 0);
  assert.equal(canPlace(world, "belt", 11, 11, 0), "Something is in the way");
  assert.equal(place(world, "miner", 11, 9, 0), null);
  assert.equal(canPlace(world, "chest", 12, 10, 0), null);
  assert.equal(canPlace(world, "miner", world.size - 1, 0, 0), "Off the map");
  assert.equal(canPlace(world, "belt", -1, 0, 0), "Off the map");
});

test("removing frees every tile of the building", () => {
  const world = createWorld({ milestones: ALL, seed: 1 });
  const miner = place(world, "miner", 10, 10, 0);
  const v = world.version;
  assert.equal(removeAt(world, 11, 11), miner);
  assert.ok(world.version > v);
  assert.equal(world.entities.size, 0);
  assert.equal(entityAt(world, 10, 10), null);
  assert.equal(removeAt(world, 10, 10), null);
  assert.ok(place(world, "chest", 11, 11, 0));
});

test("beltLine follows the longer axis and faces the drag", () => {
  assert.deepEqual(beltLine(5, 5, 5, 5, 2), [{ x: 5, y: 5, rot: 2 }]);
  assert.deepEqual(beltLine(5, 5, 8, 6, 0).map((t) => [t.x, t.y, t.rot]), [[5, 5, 1], [6, 5, 1], [7, 5, 1], [8, 5, 1]]);
  assert.deepEqual(beltLine(5, 5, 4, 3, 0).map((t) => [t.x, t.y, t.rot]), [[5, 5, 0], [5, 4, 0], [5, 3, 0]]);
  assert.deepEqual(beltLine(5, 5, 3, 5, 0).map((t) => t.rot), [3, 3, 3]);
});
