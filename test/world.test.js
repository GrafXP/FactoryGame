import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, step } from "../src/sim/world.js";

test("step advances the tick", () => {
  const world = createWorld();
  for (let i = 0; i < 120; i++) step(world);
  assert.equal(world.tick, 120);
});
