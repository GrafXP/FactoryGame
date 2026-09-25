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
  builder.setTool("miner");
  // Tapped on free ground next to the chest, the 2×2 ghost covers it.
  const p = { x: 11.2, y: 11.2 };
  builder.tap(p, "touch");
  assert.deepEqual(out.ghosts.map((g) => [g.x, g.y, g.ok]), [[10, 10, false]]);
  builder.tap(p, "touch");
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

// Select, copy, paste, remove, rotate, pick and undo. `drag` is a mouse drag from
// tile a to tile b, which with the Select tool draws a box.
const drag = (builder, a, b) => {
  builder.paintStart(at(a.x, a.y));
  builder.paintMove(at(b.x, b.y));
  builder.paintEnd();
};
const chestsAt = (world, y) => [...world.entities.values()].filter((e) => e.type === "chest" && e.y === y).map((e) => e.x);

test("tapping a building with a building picked picks one like it, facing the same way", () => {
  const { world, builder, out } = setup();
  builder.setTool("belt");
  builder.rotate();
  builder.rotate(); // south
  builder.paintStart(at(10, 10));
  builder.paintEnd();
  builder.setTool("chest");
  builder.tap(at(10, 10), "touch");
  assert.equal(builder.tool, "belt");
  assert.equal(out.ghosts.length, 0, "nothing waiting to be built");
  assert.equal(world.entities.size, 1);
  assert.equal(out.messages.at(-1), "Tapping a building picks one like it, facing the same way");
  builder.tap(at(12, 12), "mouse");
  assert.equal(entityAt(world, 12, 12)?.rot, 2, "the picked belt's facing");
  // A mouse picks with Q.
  builder.setTool("chest");
  builder.point(at(10, 10));
  assert.equal(builder.pickHovered(), true);
  assert.equal(builder.tool, "belt");
  builder.point(at(30, 30));
  assert.equal(builder.pickHovered(), false);
});

test("select a box, copy it and paste it with two taps", () => {
  const { world, out } = setup();
  const changes = [];
  const view = { setGhosts: (g) => (out.ghosts = g), setHighlight() {}, setPowerOverlay() {}, setMarks: (m) => (out.marks = m) };
  const builder = createBuilder(world, view, { onMessage: (m) => out.messages.push(m), onChange: (s) => changes.push(s) });
  builder.setTool("chest");
  for (const x of [10, 11, 12]) builder.tap(at(x, 10), "mouse");
  builder.setTool("select");
  drag(builder, { x: 9, y: 9 }, { x: 11, y: 11 });
  assert.equal(changes.at(-1).selected, 2, "the box covers two of the three");
  assert.deepEqual(out.marks.map((m) => m.x), [10, 11]);
  builder.copy();
  assert.equal(builder.tool, "paste");
  assert.deepEqual(changes.at(-1).clipboard, { count: 2, cost: { "iron-plate": 8 } });
  builder.tap(at(20, 20), "touch");
  assert.deepEqual(out.ghosts.map((g) => [g.type, g.x, g.y, g.ok]), [["chest", 20, 20, true], ["chest", 21, 20, true]]);
  assert.equal(world.entities.size, 3, "the first tap only shows the ghost");
  builder.tap(at(21, 20), "touch");
  assert.deepEqual(chestsAt(world, 20), [20, 21]);
  assert.equal(out.messages.at(-1), "Pasted 2 buildings");
  assert.equal(builder.tool, "paste", "still pasting, to paste again");
  assert.equal(changes.at(-1).canUndo, true);
});

test("a paste that's partly blocked builds the parts that fit and says what was skipped", () => {
  const { world, builder, out } = setup();
  builder.setTool("chest");
  for (const x of [10, 11, 12]) builder.tap(at(x, 10), "mouse");
  builder.tap(at(21, 20), "mouse"); // in the way
  builder.setTool("select");
  drag(builder, { x: 10, y: 10 }, { x: 12, y: 10 });
  builder.copy();
  builder.point(at(21, 20));
  assert.deepEqual(out.ghosts.map((g) => g.ok), [true, false, true]);
  builder.tap(at(21, 20), "mouse");
  assert.deepEqual(chestsAt(world, 20), [21, 20, 22]);
  assert.equal(out.messages.at(-1), "Pasted 2 of 3 buildings: 1 in the way");
  builder.tap(at(21, 20), "mouse");
  assert.equal(out.messages.at(-1), "Can't paste here: 3 in the way");
});

test("remove all gives back everything selected, and undo builds it again with its settings", () => {
  const { world, builder, out } = setup();
  Object.assign(world.inventory.items, { "iron-plate": 100, "iron-gear": 50, "electronic-circuit": 50 });
  builder.setTool("sorter");
  builder.tap(at(10, 10), "mouse");
  entityAt(world, 10, 10).filters = ["overflow", "iron-plate", "any"];
  builder.setTool("chest");
  builder.tap(at(11, 10), "mouse");
  entityAt(world, 11, 10).inventory.items.coal = 5;
  const plates = world.inventory.items["iron-plate"];
  const coal = world.inventory.items.coal;
  builder.setTool("select");
  drag(builder, { x: 10, y: 10 }, { x: 11, y: 10 });
  builder.removeSelected();
  assert.equal(world.entities.size, 0);
  assert.equal(world.inventory.items["iron-plate"], plates + 5 + 4);
  assert.equal(world.inventory.items.coal, coal + 5);
  assert.match(out.messages.at(-1), /^Removed 2 buildings\. Got back .*5 coal/);

  builder.undo();
  assert.equal(out.messages.at(-1), "Undone: rebuilt 2 buildings");
  assert.deepEqual(entityAt(world, 10, 10)?.filters, ["overflow", "iron-plate", "any"]);
  assert.equal(entityAt(world, 11, 10)?.type, "chest");
  assert.equal(world.inventory.items["iron-plate"], plates, "paid for again");
});

test("undo takes back builds, removals and pastes in turn", () => {
  const { world, builder, out } = setup();
  const plates = world.inventory.items["iron-plate"];
  builder.setTool("chest");
  builder.tap(at(10, 10), "mouse");
  builder.setTool("remove");
  builder.tap(at(10, 10), "mouse");
  builder.undo(); // the removal: the chest is back, as a new building
  assert.equal(entityAt(world, 10, 10)?.type, "chest");
  builder.undo(); // the build, which follows the chest to its new id
  assert.equal(entityAt(world, 10, 10), null);
  assert.equal(out.messages.at(-1), "Undone. Got back 4 iron plates");
  assert.equal(world.inventory.items["iron-plate"], plates);
  builder.undo();
  assert.equal(out.messages.at(-1), "Nothing to undo");

  builder.setTool("belt");
  drag(builder, { x: 10, y: 12 }, { x: 14, y: 12 });
  assert.equal(world.entities.size, 5);
  builder.undo();
  assert.equal(world.entities.size, 0, "a belt line comes up in one go");
});

test("cut picks the selection up to put down somewhere else", () => {
  const { world, builder, out } = setup();
  builder.setTool("chest");
  for (const x of [10, 11]) builder.tap(at(x, 10), "mouse");
  builder.setTool("select");
  drag(builder, { x: 10, y: 10 }, { x: 11, y: 10 });
  builder.cut();
  assert.equal(world.entities.size, 0);
  assert.equal(builder.tool, "paste");
  assert.equal(out.messages.at(-1), "Cut 2 buildings. Paste to put them down again");
  builder.tap(at(21, 20), "mouse");
  assert.deepEqual(chestsAt(world, 20), [21, 22]);
  builder.undo(); // the paste
  builder.undo(); // the cut
  assert.deepEqual(chestsAt(world, 10), [10, 11]);
  assert.deepEqual(chestsAt(world, 20), []);
});

test("rotate turns the selection where it stands, and turns the ghost while pasting", () => {
  const { world, builder, out } = setup();
  const byPlace = (list) => list.map((e) => [e.x, e.y, e.rot]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const where = () => byPlace([...world.entities.values()]);
  builder.setTool("belt");
  drag(builder, { x: 10, y: 10 }, { x: 12, y: 10 }); // three belts facing east
  entityAt(world, 11, 10).items.push({ item: "coal", pos: 16 });
  const coal = world.inventory.items.coal;
  builder.setTool("select");
  drag(builder, { x: 10, y: 10 }, { x: 12, y: 10 });
  builder.rotate();
  assert.deepEqual(where(), [[11, 9, 2], [11, 10, 2], [11, 11, 2]]);
  assert.equal(world.inventory.items.coal, coal + 1, "what was on the belts went to the inventory");
  assert.equal(out.messages.at(-1), "Rotated. What they held went to your inventory: 1 coal");
  builder.rotate();
  builder.rotate();
  builder.rotate();
  assert.deepEqual(where(), [[10, 10, 1], [11, 10, 1], [12, 10, 1]], "four turns put it back");
  builder.undo();
  assert.deepEqual(where(), [[11, 9, 0], [11, 10, 0], [11, 11, 0]]);

  // Something beside it in the way of turning.
  builder.setTool("chest");
  builder.tap(at(12, 10), "mouse");
  builder.setTool("select");
  drag(builder, { x: 11, y: 9 }, { x: 11, y: 11 });
  builder.rotate();
  assert.equal(out.messages.at(-1), "Can't rotate it here: something is in the way");

  builder.copy();
  builder.point(at(30, 30));
  assert.deepEqual(byPlace(out.ghosts), [[30, 29, 0], [30, 30, 0], [30, 31, 0]]);
  builder.rotate();
  assert.deepEqual(byPlace(out.ghosts), [[29, 30, 1], [30, 30, 1], [31, 30, 1]]);
});

test("the tools say what to do when there's nothing selected or copied", () => {
  const { builder, out } = setup();
  builder.setTool("paste");
  assert.equal(builder.tool, null);
  assert.equal(out.messages.at(-1), "Nothing to paste yet: select some buildings and copy them");
  builder.setTool("select");
  builder.copy();
  assert.equal(out.messages.at(-1), "Select some buildings to copy first");
  builder.tap(at(40, 40), "touch");
  assert.equal(out.messages.at(-1), "Press and hold, then drag a box over buildings to select them");
});
