// What machines make.

// Furnace recipes, by the ore that goes in: `need` of it smelts into one `out`
// after `time` ticks of burning fuel. A plate a second keeps up with one miner.
export const SMELTING = {
  "iron-ore": { need: 1, out: "iron-plate", time: 60 },
  "copper-ore": { need: 1, out: "copper-plate", time: 60 },
  stone: { need: 2, out: "stone-brick", time: 120 },
};

// Fuels, and how many ticks one of them keeps a furnace burning (coal: 8 plates).
export const FUEL = {
  coal: 480,
};

// The energy in each fuel, in joules, for generators: a coal runs one at its full
// 600 kW for 400 ticks (see BUILDINGS.generator and power.js).
export const FUEL_ENERGY = {
  coal: 4_000_000,
};

// Assembler recipes, by the item they make (which is also the recipe's id): the
// ingredients `in` become `n` of the item after `time` ticks. The times let one
// inserter per ingredient keep up (an inserter moves 1.2 items/s), so a copper
// cable assembler feeds a circuit assembler through one inserter. The player can
// hand-craft all of them, HAND_SPEED times as fast.
export const RECIPES = {
  "firearm-magazine": { in: { "iron-plate": 4 }, n: 1, time: 120 },
  "iron-gear": { in: { "iron-plate": 2 }, n: 1, time: 120 },
  "copper-cable": { in: { "copper-plate": 1 }, n: 2, time: 60 },
  "electronic-circuit": { in: { "iron-plate": 1, "copper-cable": 3 }, n: 1, time: 150 },
};

export const HAND_SPEED = 2;
