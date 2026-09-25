import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, entityAt } from "../src/sim/world.js";
import { createBuilder } from "../src/build.js";
import { ALL } from "./helpers.js";

// A builder wired to a fake view that records the ghosts it's asked to draw.
const setup = () => {
  const world = createWorld({ milestones: ALL, seed: 1 });
  const out = { ghosts: [], messages: [], power: null, marks: null };
  const view = { setGhosts: (g) => (out.ghosts = g), setHighlight() {}, setPowerOverlay: (p) => (out.power = p), setMarks: (m) => (out.marks = m) };
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
  assert.equal(out.messages.at(-1), "Got back 4 iron plates");
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

test("placing something electric shows where the poles reach, and a new pole's own area", () => {
  const { builder, out } = setup();
  builder.setTool("pole");
  builder.point(at(20, 12));
  assert.deepEqual(out.power, { pole: { x: 20, y: 12 } });
  builder.setTool("assembler");
  assert.deepEqual(out.power, { pole: null });
  builder.setTool("chest");
  assert.equal(out.power, null, "a chest doesn't need power");
});

test("after an underground entrance, the tiles for its exit light up and a tap on one builds it", () => {
  const { world, builder, out } = setup();
  builder.setTool("underground");
  builder.rotate(); // east
  builder.tap(at(20, 12), "touch");
  builder.tap(at(20, 12), "touch");
  const entrance = entityAt(world, 20, 12);
  assert.equal(entrance?.end, "in");
  assert.deepEqual(out.marks.map((m) => m.x), [21, 22, 23, 24, 25]);
  assert.ok(out.marks.every((m) => m.y === 12));
  builder.tap(at(24, 12), "touch"); // one tap on a lit tile
  const exit = entityAt(world, 24, 12);
  assert.equal(exit?.end, "out");
  assert.equal(exit.pair, entrance.id);
  assert.deepEqual(out.marks, [], "and it's back to placing entrances");
});

test("tapping off the lit tiles goes back to placing entrances", () => {
  const { world, builder, out } = setup();
  builder.setTool("underground");
  builder.tap(at(20, 12), "mouse");
  assert.equal(out.marks.length, 5);
  builder.tap(at(30, 30), "mouse");
  assert.equal(entityAt(world, 30, 30)?.end, "in", "a new entrance");
  assert.equal(entityAt(world, 20, 12).pair, null);
});

test("tapping an entrance without an exit lights up its exit tiles again", () => {
  const { world, builder, out } = setup();
  builder.setTool("underground");
  builder.tap(at(20, 12), "mouse");
  builder.tap(at(30, 30), "mouse"); // another entrance; the first is left without an exit
  builder.tap(at(20, 12), "mouse");
  assert.deepEqual(out.marks.map((m) => [m.x, m.y]), [[20, 11], [20, 10], [20, 9], [20, 8], [20, 7]]);
  builder.tap(at(20, 9), "mouse");
  assert.equal(entityAt(world, 20, 9).pair, entityAt(world, 20, 12).id);
});
