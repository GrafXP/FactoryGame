// The build menu's contents: buildings grouped into categories, each with a line
// saying what it's for. Every building in BUILDINGS belongs to exactly one
// category (test/catalog.test.js checks), so a new building has to be put here.
export const CATEGORIES = [
  { id: "logistics", name: "Logistics", buildings: ["belt", "inserter"] },
  { id: "production", name: "Production", buildings: ["miner", "furnace", "assembler"] },
  { id: "power", name: "Power", buildings: ["generator", "pole"] },
  { id: "storage", name: "Storage", buildings: ["chest"] },
];

export const ABOUT = {
  belt: "Carries items the way it points. Drag to lay a line.",
  inserter: "Moves items from the building behind it to the one in front. Needs power.",
  miner: "Digs the ore under it, one piece a second. Needs power.",
  furnace: "Smelts ore into plates, burning coal.",
  chest: "Stores up to 50 items.",
  assembler: "Makes gears, cables or circuits from what it's given. Tap it to pick which. Needs power.",
  generator: "Burns coal to power the machines on its poles' network: 600 kW.",
  pole: "Carries power to machines within 3 tiles, and wires itself to poles up to 7 tiles away.",
};

// Number keys that pick a building, in the order they were added.
export const BUILDING_KEYS = { 1: "belt", 2: "miner", 3: "chest", 4: "furnace", 5: "inserter", 6: "assembler", 7: "pole", 8: "generator" };
