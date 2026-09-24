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
