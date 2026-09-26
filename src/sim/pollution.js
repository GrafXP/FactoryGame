// Pollution: machines give it off into their chunk while they work, and once a
// second every polluted chunk loses some to the nests in it (enemies.js) and the
// ground (more where there's water), and passes a share of the rest to its four
// neighbours. So a factory has a cloud round it that grows with it and levels off
// where the ground takes in as much as reaches it, and nests the cloud reaches
// hatch units to attack it with.
//
// Amounts are whole numbers, in 1/3600 of a unit of pollution: a machine that gives
// off `pollution` units a minute (BUILDINGS) adds that many for every tick it works,
// so the sim stays exact and a loaded save carries on the same, whatever order the
// chunks are gone through in. A chunk's amount is `pollution` (0 for none), next to
// its ore; world.polluted holds the chunks with any, the only ones stepped.
// Generators give theirs off as they light a coal (generatorEmits), since they
// burn only what their network draws.
//
// What's given off counts as made in the production statistics, and what the
// ground and nests take in as used (POLLUTION, stats.js).
import { BUILDINGS, footprint } from "./buildings.js";
import { CHUNK, WATER } from "./map.js";
import { chunkOf, getChunk } from "./chunks.js";
import { FUEL_ENERGY } from "./recipes.js";
import { produced, consumed, POLLUTION } from "./stats.js";
import { NEST_ABSORB, feedNest } from "./enemies.js";

// Units of pollution → the whole numbers the sim keeps.
export const UNIT = 3600;

// Of what's left after the ground has taken its share, each neighbour gets SPREAD
// thousandths a second, from chunks with at least SPREAD_FROM.
export const SPREAD = 10;
const SPREAD_FROM = UNIT;
// What a chunk takes in a second, per tile: plain ground (ore and buildings too)
// and water.
export const GROUND = 1;
export const LAKE = 5;

const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

// How much building type `type` gives off a minute while it works, in units.
export const emission = (type) => BUILDINGS[type].pollution || 0;

// The chunk a building gives off into: the one its middle is in.
export function homeChunk(world, e) {
  const { w, h } = footprint(e.type, e.rot);
  return chunkOf(world, e.x + (w >> 1), e.y + (h >> 1));
}

// Adds n to chunk c's pollution, counted as made.
export function emit(world, c, n) {
  if (!c.pollution) world.polluted.add(c);
  c.pollution += n;
  produced(world.stats, POLLUTION, n);
}

// What a generator gives off for each coal it lights: its pollution a minute at
// full power, for as long as the coal lasts at full power.
export const generatorEmits = (item) => Math.round((emission("generator") * FUEL_ENERGY[item]) / BUILDINGS.generator.power);

// What chunk c takes in a second, worked out once (water never changes).
export function absorption(c) {
  if (c.absorb < 0) {
    let water = 0;
    for (let i = 0; i < CHUNK * CHUNK; i++) if (c.ore[i] === WATER) water++;
    c.absorb = (CHUNK * CHUNK - water) * GROUND + water * LAKE;
  }
  return c.absorb;
}

// Once a second: every polluted chunk loses what its nests and the ground take in,
// then passes its share to its neighbours. Each chunk's share is worked out before any moves,
// so the order they're gone through in doesn't matter.
export function stepPollution(world) {
  const list = [...world.polluted];
  let absorbed = 0;
  for (const c of list) {
    if (c.nests.length) absorbed += feedNests(world, c);
    const n = Math.min(c.pollution, absorption(c));
    c.pollution -= n;
    absorbed += n;
    c.out = c.pollution >= SPREAD_FROM ? Math.floor((c.pollution * SPREAD) / 1000) : 0;
  }
  for (const c of list) {
    if (!c.out) continue;
    c.pollution -= 4 * c.out;
    for (const [dx, dy] of NEIGHBOURS) {
      const n = getChunk(world, c.cx + dx, c.cy + dy);
      if (!n.pollution) world.polluted.add(n);
      n.pollution += c.out;
    }
    c.out = 0;
  }
  for (const c of world.polluted) if (!c.pollution) world.polluted.delete(c);
  if (absorbed) consumed(world.stats, POLLUTION, absorbed);
  world.pollutionVersion++;
}

// Each nest whose middle is in chunk c takes in up to NEST_ABSORB of its
// pollution, in the order the chunk lists them. Returns how much they took.
function feedNests(world, c) {
  let taken = 0;
  for (const n of c.nests) {
    if (!c.pollution) break;
    if (Math.floor((n.x + 1) / CHUNK) !== c.cx || Math.floor((n.y + 1) / CHUNK) !== c.cy) continue;
    const take = Math.min(c.pollution, NEST_ABSORB);
    c.pollution -= take;
    taken += take;
    feedNest(world, n, take);
  }
  return taken;
}

// All the pollution in the air, in units.
export function pollutionTotal(world) {
  let n = 0;
  for (const c of world.polluted) n += c.pollution;
  return n / UNIT;
}
