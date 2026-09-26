import { ORE } from "./map.js";

// Item types, in the order the inventory lists them. Countable items have a
// `plural`; ore, coal and stone read the same for any amount. `shape` is how the
// item is drawn, on belts and in icons: a rock unless it says otherwise.
export const ITEMS = {
  "firearm-magazine": { name: "Firearm magazine", plural: "Firearm magazines", shape: "magazine" },
  "iron-ore": { name: "Iron ore" },
  "copper-ore": { name: "Copper ore" },
  coal: { name: "Coal" },
  stone: { name: "Stone" },
  "iron-plate": { name: "Iron plate", plural: "Iron plates", shape: "plate" },
  "copper-plate": { name: "Copper plate", plural: "Copper plates", shape: "plate" },
  "stone-brick": { name: "Stone brick", plural: "Stone bricks", shape: "brick" },
  "iron-gear": { name: "Iron gear", plural: "Iron gears", shape: "gear" },
  "copper-cable": { name: "Copper cable", plural: "Copper cables", shape: "cable" },
  "electronic-circuit": { name: "Circuit", plural: "Circuits", shape: "circuit" },
};

// The item you get from mining each kind of ore tile.
export const ORE_ITEM = {
  [ORE.IRON]: "iron-ore",
  [ORE.COPPER]: "copper-ore",
  [ORE.COAL]: "coal",
  [ORE.STONE]: "stone",
};

// What a new game starts with: enough for a couple of miners, a coal generator and
// a few poles to power them, a furnace fed by inserters, a chest and some belts,
// plus coal for the furnace and the generator. Anything more (an assembler, say)
// means hand-crafting gears and circuits from the plates.
export const START_KIT = {
  "iron-plate": 50,
  "copper-plate": 10,
  "copper-cable": 10,
  "iron-gear": 14,
  "electronic-circuit": 4,
  stone: 40,
  coal: 20,
};

// { "iron-plate": 8, stone: 6 } → "8 iron plates, 6 stone"
export function describe(items) {
  return Object.entries(items)
    .map(([id, n]) => `${n} ${itemName(id, n).toLowerCase()}`)
    .join(", ");
}

// An item's name for `n` of it: "Iron plate", "Iron plates", "Coal".
export const itemName = (id, n = 1) => (n !== 1 && ITEMS[id].plural) || ITEMS[id].name;
