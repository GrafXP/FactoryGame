// Electricity: networks of power poles carrying what coal generators make to the
// miners, inserters and assemblers near them.
//
// Energy is in joules and power in joules per tick (60 J/tick = 1 kW), all whole
// numbers so the sim stays exact.
//
// Poles join every pole within REACH tiles (centre to centre); the wires drawn are
// the fewest that join them, shortest first. Joined poles make one network. A pole
// powers every building with a tile within AREA tiles of it; a building near poles
// of two networks is on the one whose pole was built first.
//
// Each machine has a small store of energy, `energy`, up to two ticks' worth of its
// draw. Every tick its network tops the stores up by at most one tick's draw each,
// from what the generators can make; when they can't make it all, every machine
// gets the same share of what it asked for. A machine spends its draw for each tick
// it works (usePower) and waits when its store is short, so with 60% of the power
// the network needs, every machine on it works 60% of the time. Idle machines have
// full stores and ask for nothing, so they cost nothing, and the generators burn
// only what was handed out.
import { BUILDINGS, footprint } from "./buildings.js";
import { entityAt } from "./grid.js";
import { generatorAvailable, burnGenerator } from "./generator.js";

const { reach: REACH, area: AREA } = BUILDINGS.pole;
const SMOOTHING = 0.05; // for the averages the panels show, about a second

const drawOf = (e) => BUILDINGS[e.type].draw;
export const usesPower = (type) => !!BUILDINGS[type]?.draw;
const ON_NETWORK = new Set(Object.keys(BUILDINGS).filter((type) => usesPower(type) || type === "generator"));

// The poles within wire reach of tile (x, y), nearest first (not counting one on
// the tile itself). Build mode uses it to show the wires a new pole would get.
export function polesInReach(world, x, y) {
  const found = [];
  for (let dy = -REACH; dy <= REACH; dy++) {
    for (let dx = -REACH; dx <= REACH; dx++) {
      const d = dx * dx + dy * dy;
      if (!d || d > REACH * REACH) continue;
      const e = entityAt(world, x + dx, y + dy);
      if (e?.type === "pole") found.push({ pole: e, d });
    }
  }
  return found.sort((a, b) => a.d - b.d || a.pole.id - b.pole.id).map((f) => f.pole);
}

// The tiles a pole at (x, y) powers: { x, y, w, h }.
export const poleArea = (x, y) => ({ x: x - AREA, y: y - AREA, w: 2 * AREA + 1, h: 2 * AREA + 1 });

// How the poles connect, worked out from the layout and cached until it changes
// (world.powerVersion, which goes up when a pole or anything on a network is built
// or removed), like the belt network. It isn't saved.
//   nets:  [{ poles, generators, consumers, ... }], one per group of joined poles,
//          with this tick's `demand`, `capacity` (what its generators could make)
//          and `supplied`, and `avg`, smoothed copies of those for the panels.
//          `draws` has each consumer's draw.
//   netOf: building → its network; buildings near no pole aren't in it.
//   loose: the generators near no pole.
//   wires: [[pole, pole]] to draw.
export function powerNetwork(world) {
  if (world.powerNet?.version === world.powerVersion) return world.powerNet;
  const poles = [];
  const users = []; // the buildings that go on a network (in the order they were built)
  for (const e of world.entities.values()) {
    if (e.type === "pole") poles.push(e);
    else if (ON_NETWORK.has(e.type)) users.push(e);
  }

  // Poles are found by sorting them into squares as big as the wire reach.
  const squares = new Map();
  const NONE = [];
  // A square's key: a small whole number anywhere on the map, which Maps look up fastest.
  const square = (x, y) => (Math.floor(x / REACH) + 0x4000) * 0x8000 + (Math.floor(y / REACH) + 0x4000);
  const polesNear = (x, y) => squares.get(square(x, y)) || NONE;
  poles.forEach((p, i) => {
    const k = square(p.x, p.y);
    if (!squares.has(k)) squares.set(k, []);
    squares.get(k).push(i);
  });

  // Every pair of poles within reach: in the squares round each one.
  const links = [];
  poles.forEach((p, i) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const j of polesNear(p.x + dx * REACH, p.y + dy * REACH)) {
          const q = poles[j];
          const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
          if (j > i && d <= REACH * REACH) links.push({ p, q, i, j, d });
        }
      }
    }
  });

  // Shortest links first, joining groups that aren't joined yet (Kruskal).
  links.sort((a, b) => a.d - b.d || a.i - b.i || a.j - b.j);
  const parent = poles.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const wires = [];
  for (const { p, q, i, j } of links) {
    const a = find(i);
    const b = find(j);
    if (a === b) continue;
    parent[b] = a;
    wires.push([p, q]);
  }

  // A network keeps the averages of the one its poles were on, so the panels don't
  // start from nothing every time something is built.
  const old = world.powerNet;
  const nets = [];
  const byRoot = new Map();
  const netOf = new Map();
  for (const [i, p] of poles.entries()) {
    const root = find(i);
    let net = byRoot.get(root);
    if (!net) {
      net = { poles: [], generators: [], consumers: [], draws: [], demand: 0, capacity: 0, supplied: 0, avg: null };
      byRoot.set(root, net);
      nets.push(net);
    }
    net.avg ||= old?.netOf.get(p)?.avg && { ...old.netOf.get(p).avg };
    net.poles.push(p);
    netOf.set(p, net);
  }
  for (const net of nets) net.avg ||= { demand: 0, capacity: 0, supplied: 0 };

  // Each building goes on the network of the first pole built whose area reaches
  // it. The networks list them as they'd be found going through the poles in that
  // order, each pole's area row by row: by pole, then by the first tile of theirs in
  // its area.
  const found = [];
  const loose = [];
  for (const e of users) {
    const { w, h } = footprint(e.type, e.rot);
    let best = -1;
    for (let sy = Math.floor((e.y - AREA) / REACH); sy <= Math.floor((e.y + h - 1 + AREA) / REACH); sy++) {
      for (let sx = Math.floor((e.x - AREA) / REACH); sx <= Math.floor((e.x + w - 1 + AREA) / REACH); sx++) {
        for (const j of polesNear(sx * REACH, sy * REACH)) {
          const p = poles[j];
          if (best >= 0 && j > best) continue;
          if (p.x + AREA >= e.x && p.x - AREA < e.x + w && p.y + AREA >= e.y && p.y - AREA < e.y + h) best = j;
        }
      }
    }
    if (best < 0) {
      if (e.type === "generator") loose.push(e);
      continue;
    }
    const p = poles[best];
    found.push({ e, pole: best, y: Math.max(e.y, p.y - AREA), x: Math.max(e.x, p.x - AREA) });
  }
  found.sort((a, b) => a.pole - b.pole || a.y - b.y || a.x - b.x);
  for (const { e, pole } of found) {
    const net = netOf.get(poles[pole]);
    netOf.set(e, net);
    if (e.type === "generator") net.generators.push(e);
    else {
      net.consumers.push(e);
      net.draws.push(drawOf(e));
    }
  }

  world.powerNet = { version: world.powerVersion, nets, netOf, loose, wires };
  return world.powerNet;
}

// What each consumer asks for this tick, reused from tick to tick.
let asked = new Float64Array(64);

// Hands out this tick's power, before the machines step.
export function stepPower(world) {
  const { nets, loose } = powerNetwork(world);
  for (const net of nets) {
    const { consumers, draws } = net;
    if (asked.length < consumers.length) asked = new Float64Array(consumers.length * 2);
    let demand = 0;
    for (let i = 0; i < consumers.length; i++) {
      const d = draws[i];
      const r = Math.max(0, Math.min(d, 2 * d - consumers[i].energy));
      asked[i] = r;
      demand += r;
    }
    let capacity = 0;
    for (const g of net.generators) capacity += generatorAvailable(g);
    const supply = Math.min(demand, capacity);

    let given = 0;
    if (supply) {
      for (let i = 0; i < consumers.length; i++) {
        const r = asked[i];
        const n = supply === demand ? r : Math.floor((r * supply) / demand);
        consumers[i].energy += n;
        given += n;
      }
    }

    // Generators share the load by what each could make; the odd joules left over
    // go to the first with room.
    let left = given;
    const shares = net.generators.map((g) => {
      const n = capacity ? Math.floor((generatorAvailable(g) * given) / capacity) : 0;
      left -= n;
      return n;
    });
    net.generators.forEach((g, i) => {
      const extra = Math.min(left, generatorAvailable(g) - shares[i]);
      left -= extra;
      burnGenerator(g, shares[i] + extra, world.stats);
    });

    net.demand = demand;
    net.capacity = capacity;
    net.supplied = given;
    for (const k of ["demand", "capacity", "supplied"]) net.avg[k] += (net[k] - net.avg[k]) * SMOOTHING;
  }
  // A generator near no pole has nothing to power.
  for (const g of loose) g.status = g.burn || g.fuel ? "unconnected" : "no-fuel";
}

// Whether machine e has the energy to work this tick, without spending it. When it
// hasn't, its status says "no-power" if its network made nothing for it (or it's
// near no pole); with only some power it's still "working", just slower. Either
// way `starved` notes the tick, for its activity (stats.js).
export function hasPower(world, e) {
  if (e.energy >= drawOf(e)) return true;
  e.starved = world.tick;
  e.status = (powerNetwork(world).netOf.get(e)?.supplied || 0) > 0 ? "working" : "no-power";
  return false;
}

// Spends a tick's work of energy, if machine e has it (see hasPower).
export function usePower(world, e) {
  if (!hasPower(world, e)) return false;
  e.energy -= drawOf(e);
  return true;
}

// How well a network is keeping up, from its averages: the share of what its
// machines ask for that they get (1 when they ask for nothing).
export const satisfaction = (net) => (net.avg.demand > 0.5 ? Math.min(1, net.avg.supplied / net.avg.demand) : 1);
