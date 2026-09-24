import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, entityAt } from "../src/sim/world.js";
import { createBuilder } from "../src/build.js";

// A builder wired to a fake view that records the ghosts it's asked to draw.
const setup = () => {
  const world = createWorld({ seed: 1 });
  const out = { ghosts: [], messages: [] };
  const view = { setGhosts: (g) => (out.ghosts = g), setHighlight() {} };
  const builder = createBuilder(world, view, { onMessage: (m) => out.messages.push(m) });
  return { world, builder, out };
};
const at = (x, y) => ({ x: x + 0.5, y: y + 0.5 });

test("a mouse click builds straight away", () => {
  const { world, builder } = setup();
  builder.setTool("chest");
  builder.point(at(10, 10));
  builder.tap(at(10, 10), "mouse");
  assert.equal(entityAt(world, 10, 10)?.type, "chest");
});

test("touch: the first tap leaves a ghost, a tap on the ghost builds it", () => {
  const { world, builder, out } = setup();
  builder.setTool("chest");
  builder.tap(at(10, 10), "touch");
  assert.equal(world.entities.size, 0);
  assert.deepEqual(out.ghosts.map((g) => [g.type, g.x, g.y, g.ok]), [["chest", 10, 10, true]], "the ghost stays after the finger lifts");
  assert.equal(out.messages.at(-1), "Tap the ghost again to build");

  builder.tap(at(10, 10), "touch");
  assert.equal(entityAt(world, 10, 10)?.type, "chest");
  assert.deepEqual(out.ghosts, [], "the ghost goes once it's built");
});

test("touch: tapping off the ghost moves it, and rotating turns it", () => {
  const { world, builder, out } = setup();
  builder.setTool("miner");
  builder.tap(at(10, 10), "touch");
  builder.tap(at(20, 20), "touch");
  assert.equal(world.entities.size, 0);
  assert.equal(out.messages.length, 1, "the hint is only shown once");
  const [ghost] = out.ghosts;
  builder.rotate();
  assert.equal(out.ghosts[0].rot, 1);

  // Any tile of the 2×2 ghost builds it, exactly where the ghost was shown.
  builder.tap(at(ghost.x + 1, ghost.y + 1), "touch");
  const miner = entityAt(world, ghost.x, ghost.y);
  assert.equal(miner?.type, "miner");
  assert.equal(miner.rot, 1);
});

test("touch: a ghost that can't be built says why and stays", () => {
  const { world, builder, out } = setup();
  builder.setTool("chest");
  builder.tap(at(10, 10), "mouse");
  builder.tap(at(10, 10), "touch");
  builder.tap(at(10, 10), "touch");
  assert.equal(world.entities.size, 1);
  assert.equal(out.messages.at(-1), "Can't build here: something is in the way");
  assert.equal(out.ghosts.length, 1);
});

test("picking another tool clears a waiting ghost", () => {
  const { builder, out } = setup();
  builder.setTool("chest");
  builder.tap(at(10, 10), "touch");
  builder.setTool("belt");
  assert.deepEqual(out.ghosts, []);
});

test("a mouse click removes straight away", () => {
  const { world, builder, out } = setup();
  builder.setTool("chest");
  builder.tap(at(10, 10), "mouse");
  builder.setTool("remove");
  builder.tap(at(10, 10), "mouse");
  assert.equal(world.entities.size, 0);
  assert.equal(out.messages.at(-1), "Got back 4 iron ore");
});

test("touch: the first tap marks a building, a second tap on it removes it", () => {
  const { world, builder, out } = setup();
  builder.setTool("chest");
  builder.tap(at(10, 10), "mouse");
  builder.tap(at(12, 10), "mouse");
  builder.setTool("remove");

  builder.tap(at(10, 10), "touch");
  assert.equal(world.entities.size, 2, "the first tap only marks it");
  assert.equal(out.messages.at(-1), "Tap it again to remove it");

  // Tapping another building moves the mark instead of removing anything.
  builder.tap(at(12, 10), "touch");
  assert.equal(world.entities.size, 2);
  builder.tap(at(12, 10), "touch");
  assert.equal(entityAt(world, 12, 10), null);
  assert.ok(entityAt(world, 10, 10));

  // Tapping empty ground clears the mark, so the next tap marks again.
  builder.tap(at(10, 10), "touch");
  builder.tap(at(30, 30), "touch");
  assert.equal(out.messages.at(-1), "Nothing to remove here");
  builder.tap(at(10, 10), "touch");
  assert.ok(entityAt(world, 10, 10), "marked again, not removed");
});
