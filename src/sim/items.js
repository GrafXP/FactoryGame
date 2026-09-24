import { ORE } from "./map.js";

// Item types, in the order the inventory lists them.
export const ITEMS = {
  "iron-ore": { name: "Iron ore" },
  "copper-ore": { name: "Copper ore" },
  coal: { name: "Coal" },
  stone: { name: "Stone" },
};

// The item you get from mining each kind of ore tile.
export const ORE_ITEM = {
  [ORE.IRON]: "iron-ore",
  [ORE.COPPER]: "copper-ore",
  [ORE.COAL]: "coal",
  [ORE.STONE]: "stone",
};

// What a new game starts with: enough for a couple of miners, chests and some belts.
export const START_KIT = { "iron-ore": 50, "copper-ore": 10, stone: 20 };

// { "iron-ore": 8, stone: 6 } → "8 iron ore, 6 stone"
export function describe(items) {
  return Object.entries(items)
    .map(([id, n]) => `${n} ${ITEMS[id].name.toLowerCase()}`)
    .join(", ");
}
