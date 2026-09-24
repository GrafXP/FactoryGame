// Assemblers make one recipe (see RECIPES), set by the player.
//
// `inputs` holds the ingredients it has been given ({ item: count }), `output`
// what it has made ({ item, n } or null). A craft takes its ingredients when it
// starts (`crafting` is then true) and makes the item `time` ticks later. status
// says what it's doing: "no-recipe", "working", "no-input" (short of an
// ingredient) or "full" (no room in the output for the next craft).
import { BUILDINGS } from "./buildings.js";
import { RECIPES } from "./recipes.js";
import { count, take, give } from "./inventory.js";

const { stack: STACK } = BUILDINGS.assembler;

export const assemblerState = () => ({
  recipe: null,
  inputs: {},
  output: null,
  progress: 0,
  crafting: false,
  status: "no-recipe",
});

// How many more of `item` fit, up to `limit` for each ingredient.
function room(a, item, limit) {
  const r = RECIPES[a.recipe];
  if (!r || !Object.hasOwn(r.in, item)) return 0;
  return Math.max(0, limit(r.in[item]) - (a.inputs[item] || 0));
}

// Belts, miners and inserters fill each ingredient to two crafts' worth, so an
// assembler doesn't hoard what the next one along needs; the player can fill a stack.
export const assemblerCanTake = (a, item) => room(a, item, (need) => need * 2) > 0;
export const assemblerRoom = (a, item) => room(a, item, () => STACK);

export function assemblerAdd(a, item, n = 1) {
  a.inputs[item] = (a.inputs[item] || 0) + n;
}

// Takes one item from the output for an inserter, if `accepts` wants it.
export function assemblerTakeOne(a, accepts) {
  const out = a.output;
  if (!out || !accepts(out.item)) return null;
  if (--out.n === 0) a.output = null;
  return out.item;
}

// Everything an assembler holds, including the ingredients of the craft under way.
export function assemblerContents(a) {
  const items = { ...a.inputs };
  const add = (id, n) => (items[id] = (items[id] || 0) + n);
  if (a.output) add(a.output.item, a.output.n);
  if (a.crafting) for (const [id, n] of Object.entries(RECIPES[a.recipe].in)) add(id, n);
  return items;
}

// Sets the recipe. Whatever the assembler holds goes back into inventory `inv`,
// and is returned; the craft under way is called off.
export function setRecipe(a, recipe, inv) {
  const back = assemblerContents(a);
  give(inv, back);
  Object.assign(a, assemblerState(), { recipe, status: recipe ? "no-input" : "no-recipe" });
  return back;
}

// Moves as much of `item` as fits from inventory `inv` into the assembler.
// Returns how many moved.
export function fillAssembler(a, inv, item) {
  const n = Math.min(count(inv, item), assemblerRoom(a, item));
  if (n) {
    take(inv, { [item]: n });
    assemblerAdd(a, item, n);
  }
  return n;
}

// Moves one ingredient's stock, or the output (item null), into `inv`. Returns what moved.
export function emptyAssembler(a, inv, item = null) {
  let moved = {};
  if (item === null) {
    if (a.output) moved = { [a.output.item]: a.output.n };
    a.output = null;
  } else if (a.inputs[item]) {
    moved = { [item]: a.inputs[item] };
    delete a.inputs[item];
  }
  give(inv, moved);
  return moved;
}

export function stepAssembler(a) {
  if (!a.crafting && !start(a)) return;
  a.status = "working";
  const r = RECIPES[a.recipe];
  if (++a.progress < r.time) return;
  // start() made sure the output has room.
  if (a.output) a.output.n += r.n;
  else a.output = { item: a.recipe, n: r.n };
  a.crafting = false;
  a.progress = 0;
  start(a); // straight on to the next, so a craft takes exactly r.time ticks
}

// Takes the ingredients for the next craft, if they're all there and the output
// has room. Otherwise says why not and returns false.
function start(a) {
  const r = RECIPES[a.recipe];
  if (!r) a.status = "no-recipe";
  else if (a.output && a.output.n + r.n > STACK) a.status = "full";
  else if (Object.entries(r.in).some(([id, n]) => (a.inputs[id] || 0) < n)) a.status = "no-input";
  else {
    for (const [id, n] of Object.entries(r.in)) if ((a.inputs[id] -= n) === 0) delete a.inputs[id];
    a.crafting = true;
    return true;
  }
  return false;
}
