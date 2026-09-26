// Progression: the HUB and its milestones, Satisfactory-style.
//
// A new game can only build what START unlocks. Each milestone asks for a batch of
// items delivered to the HUB, by hand from its panel or by belts and inserters, and
// unlocks buildings and hand-crafting recipes once it has them all. Milestones come
// one at a time, in order; the last, automating circuits, unlocks labs and red
// science packs, and research (tech.js) unlocks everything after that. Every
// building and recipe is unlocked from the start, by one milestone or by one
// technology.
//
// world.progress is { milestone, delivered }: how many milestones are done, and
// what has been delivered to the one under way ({ item: count }). It belongs to the
// world rather than to the HUB, so taking the HUB down and building it elsewhere
// loses nothing. The HUB holds a reference to it (see addEntity) so that belts and
// inserters, which only see the building in front of them, can deliver to it.
import { count, take } from "./inventory.js";
import { TECHS, unlockingTech, researched } from "./tech.js";

export const START = { buildings: ["hub", "furnace", "chest"], recipes: ["iron-gear", "copper-cable"] };

export const MILESTONES = [
  {
    name: "Power and mining",
    about: "Smelt plates and bricks in a furnace, from ore you mine by hand.",
    needs: { "iron-plate": 20, "stone-brick": 10 },
    unlocks: { buildings: ["miner", "belt", "generator", "pole", "inserter"], recipes: [] },
  },
  {
    name: "Logistics and defense",
    about: "Let miners and furnaces do the work: miners need power from a generator and poles.",
    needs: { "iron-plate": 100, "copper-plate": 50, "iron-gear": 20 },
    unlocks: { buildings: ["underground", "splitter", "long-inserter", "radar", "turret", "wall"], recipes: ["electronic-circuit", "firearm-magazine"] },
  },
  {
    name: "Assembly",
    about: "Circuits are an iron plate and 3 copper cables; craft them by hand for now.",
    needs: { "electronic-circuit": 20, "iron-gear": 50, "stone-brick": 30 },
    unlocks: { buildings: ["assembler", "sorter"], recipes: [] },
  },
  {
    name: "Defense",
    about: "Make magazines in an assembler and bricks for walls, to hold a line against the nests, then push into them.",
    needs: { "firearm-magazine": 50, "stone-brick": 100 },
    unlocks: { buildings: [], recipes: ["piercing-magazine"] },
  },
  {
    name: "Circuit production",
    about: "Build a line of assemblers that makes circuits on its own, and belt them to the HUB.",
    needs: { "electronic-circuit": 150 },
    unlocks: { buildings: ["lab"], recipes: ["red-pack"] },
  },
];

export const progressState = (milestone = 0) => ({ milestone, delivered: {} });

// The milestone under way, or null once they're all done.
export const currentMilestone = (world) => MILESTONES[world.progress.milestone] || null;
export const allDone = (world) => world.progress.milestone >= MILESTONES.length;

// The milestone that unlocks a building or recipe: an index into MILESTONES, -1
// if it's there from the start, or null if a technology unlocks it (or nothing).
const unlockedBy = (kind, id) => {
  if (START[kind].includes(id)) return -1;
  const i = MILESTONES.findIndex((m) => m.unlocks[kind].includes(id));
  return i < 0 ? null : i;
};
export const buildingMilestone = (type) => unlockedBy("buildings", type);
export const recipeMilestone = (id) => unlockedBy("recipes", id);
export const buildingTech = (type) => unlockingTech("buildings", type);
export const recipeTech = (id) => unlockingTech("recipes", id);

const unlocked = (world, milestone, tech) =>
  milestone === null ? tech !== null && researched(world, tech) : milestone < world.progress.milestone;
export const buildingUnlocked = (world, type) => unlocked(world, buildingMilestone(type), buildingTech(type));
export const recipeUnlocked = (world, id) => unlocked(world, recipeMilestone(id), recipeTech(id));

// What unlocks building `type`, for the player: "milestone 3 at the HUB:
// Assembly", "research: Logistics 2", or null if it's there from the start.
export function unlockText(type) {
  const i = buildingMilestone(type);
  if (i !== null) return i < 0 ? null : `milestone ${i + 1} at the HUB: ${MILESTONES[i].name}`;
  const t = buildingTech(type);
  return t && `research: ${TECHS[t].name}`;
}

// Why `type` can't be built yet, or null if it can.
export function lockedWhy(world, type) {
  if (buildingUnlocked(world, type)) return null;
  const i = buildingMilestone(type);
  if (i !== null) return `Locked: reach milestone ${i + 1}, ${MILESTONES[i].name}, at the HUB`;
  const t = buildingTech(type);
  return t ? `Locked: research ${TECHS[t].name} in a lab` : "Can't be built";
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

// Delivers as much of `item` as is needed, up to `max`, from inventory `inv`.
// Returns how many.
export function deliverFrom(progress, inv, item, max = Infinity) {
  const n = Math.min(count(inv, item), stillNeeded(progress, item), max);
  if (n > 0) {
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
