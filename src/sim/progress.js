// Progression: the HUB and its milestones, Satisfactory-style.
//
// A new game can only build what START unlocks. Each milestone asks for a batch of
// items delivered to the HUB, by hand from its panel or by belts and inserters, and
// unlocks buildings and hand-crafting recipes once it has them all. Milestones come
// one at a time, in order; the last is the goal of the game so far, automating
// circuits, and unlocks nothing.
//
// world.progress is { milestone, delivered }: how many milestones are done, and
// what has been delivered to the one under way ({ item: count }). It belongs to the
// world rather than to the HUB, so taking the HUB down and building it elsewhere
// loses nothing. The HUB holds a reference to it (see addEntity) so that belts and
// inserters, which only see the building in front of them, can deliver to it.
import { count, take } from "./inventory.js";

export const START = { buildings: ["hub", "furnace", "chest"], recipes: ["iron-gear", "copper-cable"] };

export const MILESTONES = [
  {
    name: "Power and mining",
    about: "Smelt plates and bricks in a furnace, from ore you mine by hand.",
    needs: { "iron-plate": 20, "stone-brick": 10 },
    unlocks: { buildings: ["miner", "belt", "generator", "pole"], recipes: [] },
  },
  {
    name: "Logistics",
    about: "Let miners and furnaces do the work: miners need power from a generator and poles.",
    needs: { "iron-plate": 100, "copper-plate": 50, "iron-gear": 20 },
    unlocks: { buildings: ["inserter", "underground", "splitter"], recipes: ["electronic-circuit"] },
  },
  {
    name: "Assembly",
    about: "Circuits are an iron plate and 3 copper cables; craft them by hand for now.",
    needs: { "electronic-circuit": 20, "iron-gear": 50, "stone-brick": 30 },
    unlocks: { buildings: ["assembler", "sorter"], recipes: [] },
  },
  {
    name: "Circuit production",
    about: "Build a line of assemblers that makes circuits on its own, and belt them to the HUB.",
    needs: { "electronic-circuit": 150 },
    unlocks: { buildings: [], recipes: [] },
  },
];

export const progressState = (milestone = 0) => ({ milestone, delivered: {} });

// The milestone under way, or null once they're all done.
export const currentMilestone = (world) => MILESTONES[world.progress.milestone] || null;
export const allDone = (world) => world.progress.milestone >= MILESTONES.length;

// The milestone that unlocks a building or recipe: an index into MILESTONES, or -1
// if it's there from the start.
const unlockedBy = (kind, id) =>
  START[kind].includes(id) ? -1 : MILESTONES.findIndex((m) => m.unlocks[kind].includes(id));
export const buildingMilestone = (type) => unlockedBy("buildings", type);
export const recipeMilestone = (id) => unlockedBy("recipes", id);

export const buildingUnlocked = (world, type) => buildingMilestone(type) < world.progress.milestone;
export const recipeUnlocked = (world, id) => recipeMilestone(id) < world.progress.milestone;

// Why `type` can't be built yet, or null if it can.
export function lockedWhy(world, type) {
  if (buildingUnlocked(world, type)) return null;
  const i = buildingMilestone(type);
  return i < 0 ? "Can't be built" : `Locked: reach milestone ${i + 1}, ${MILESTONES[i].name}, at the HUB`;
}

// How many more of `item` the milestone under way needs.
export function stillNeeded(progress, item) {
  const m = MILESTONES[progress.milestone];
  if (!m || !Object.hasOwn(m.needs, item)) return 0;
  return Math.max(0, m.needs[item] - (progress.delivered[item] || 0));
}

// Delivers n of `item`, which must be needed, and finishes the milestone once it
// has everything.
export function deliver(progress, item, n = 1) {
  progress.delivered[item] = (progress.delivered[item] || 0) + n;
  const m = MILESTONES[progress.milestone];
  if (Object.keys(m.needs).every((id) => !stillNeeded(progress, id))) {
    progress.milestone++;
    progress.delivered = {};
  }
}

// Delivers as much of `item` as is needed from inventory `inv`. Returns how many.
export function deliverFrom(progress, inv, item) {
  const n = Math.min(count(inv, item), stillNeeded(progress, item));
  if (n) {
    take(inv, { [item]: n });
    deliver(progress, item, n);
  }
  return n;
}

// Delivers everything the milestone needs that inventory `inv` has. Returns what went.
export function deliverAll(progress, inv) {
  const m = MILESTONES[progress.milestone];
  const moved = {};
  if (!m) return moved;
  const at = progress.milestone;
  for (const item of Object.keys(m.needs)) {
    if (progress.milestone !== at) break; // finished: what's left stays in the inventory
    const n = deliverFrom(progress, inv, item);
    if (n) moved[item] = n;
  }
  return moved;
}
