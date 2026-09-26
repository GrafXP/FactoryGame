// The build menu's contents: buildings grouped into categories, each with a line
// saying what it's for. Every building in BUILDINGS belongs to exactly one
// category (test/catalog.test.js checks), so a new building has to be put here.
export const CATEGORIES = [
  { id: "base", name: "Base", buildings: ["hub", "chest", "radar"] },
  { id: "logistics", name: "Logistics", buildings: ["belt", "underground", "splitter", "sorter", "inserter"] },
  { id: "production", name: "Production", buildings: ["miner", "furnace", "assembler"] },
  { id: "power", name: "Power", buildings: ["generator", "pole"] },
];

export const ABOUT = {
  hub: "Where you deliver items to reach milestones, which unlock new buildings. You can only have one.",
  belt: "Carries items the way it points. Drag to lay a line.",
  underground: "Takes a belt under up to 4 tiles of anything. Place the entrance, then tap a lit tile for the exit.",
  splitter: "Sends items out front, left and right in turn, skipping a way that's full or leads nowhere.",
  sorter: "A splitter you set: each way out takes any item, one kind, or the overflow. Tap it to set.",
  inserter: "Moves items from the building behind it to the one in front. Needs power.",
  miner: "Digs the ore under it, one piece a second. Needs power.",
  furnace: "Smelts ore into plates, burning coal.",
  chest: "Stores up to 5000 items.",
  assembler: "Makes gears, cables or circuits from what it's given. Tap it to pick which. Needs power.",
  generator: "Burns coal to power the machines on its poles' network: 600 kW.",
  pole: "Carries power to machines within 3 tiles, and wires itself to poles up to 7 tiles away.",
  radar: "Scans the land round it, a chunk at a time, so it shows on the map (zoom far out). Needs power.",
};

// Number keys that pick a building, in the order they were added.
export const BUILDING_KEYS = { 1: "belt", 2: "miner", 3: "chest", 4: "furnace", 5: "inserter", 6: "assembler", 7: "pole", 8: "generator", 9: "hub", 0: "radar" };
