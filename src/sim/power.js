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
import { BUILDINGS } from "./buildings.js";
import { entityAt } from "./grid.js";
import { generatorAvailable, burnGenerator } from "./generator.js";

const { reach: REACH, area: AREA } = BUILDINGS.pole;
const SMOOTHING = 0.05; // for the averages the panels show, about a second

const drawOf = (e) => BUILDINGS[e.type].draw;
export const usesPower = (type) => !!BUILDINGS[type]?.draw;
const onNetwork = (e) => usesPower(e.type) || e.type === "generator";

// What a machine asks its network for this tick: enough to fill its store, at most
// one tick's draw.
const request = (e) => Math.max(0, Math.min(drawOf(e), 2 * drawOf(e) - e.energy));

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
// (world.version), like the belt network. It isn't saved.
//   nets:  [{ poles, generators, consumers, ... }], one per group of joined poles,
//          with this tick's `demand`, `capacity` (what its generators could make)
//          and `supplied`, and `avg`, smoothed copies of those for the panels.
//   netOf: building → its network; buildings near no pole aren't in it.
//   wires: [[pole, pole]] to draw.
export function powerNetwork(world) {
  if (world.powerNet?.version === world.version) return world.powerNet;
  const poles = [];
  for (const e of world.entities.values()) if (e.type === "pole") poles.push(e);
  const index = new Map(poles.map((p, i) => [p, i]));

  // Shortest links first, joining groups that aren't joined yet (Kruskal).
  const links = [];
  for (const p of poles) {
    for (const q of polesInReach(world, p.x, p.y)) {
      if (index.get(q) > index.get(p)) links.push({ p, q, d: (p.x - q.x) ** 2 + (p.y - q.y) ** 2 });
    }
  }
  links.sort((a, b) => a.d - b.d || index.get(a.p) - index.get(b.p) || index.get(a.q) - index.get(b.q));
  const parent = poles.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const wires = [];
  for (const { p, q } of links) {
    const a = find(index.get(p));
    const b = find(index.get(q));
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
  for (const p of poles) {
    const root = find(index.get(p));
    let net = byRoot.get(root);
    if (!net) {
      net = { poles: [], generators: [], consumers: [], demand: 0, capacity: 0, supplied: 0, avg: null };
      byRoot.set(root, net);
      nets.push(net);
    }
    net.avg ||= old?.netOf.get(p)?.avg && { ...old.netOf.get(p).avg };
    net.poles.push(p);
    netOf.set(p, net);
  }
  for (const net of nets) net.avg ||= { demand: 0, capacity: 0, supplied: 0 };

  // What each pole powers, in the order the poles were built.
  for (const p of poles) {
    const net = netOf.get(p);
    const a = poleArea(p.x, p.y);
    for (let y = a.y; y < a.y + a.h; y++) {
      for (let x = a.x; x < a.x + a.w; x++) {
        const e = entityAt(world, x, y);
        if (!e || netOf.has(e) || !onNetwork(e)) continue;
        netOf.set(e, net);
        (e.type === "generator" ? net.generators : net.consumers).push(e);
      }
    }
  }

  world.powerNet = { version: world.version, nets, netOf, wires };
  return world.powerNet;
}

// Hands out this tick's power, before the machines step.
export function stepPower(world) {
  const { nets, netOf } = powerNetwork(world);
  for (const net of nets) {
    let demand = 0;
    for (const c of net.consumers) demand += request(c);
    let capacity = 0;
    for (const g of net.generators) capacity += generatorAvailable(g);
    const supply = Math.min(demand, capacity);

    let given = 0;
    if (supply) {
      for (const c of net.consumers) {
        const r = request(c);
        const n = supply === demand ? r : Math.floor((r * supply) / demand);
        c.energy += n;
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
      burnGenerator(g, shares[i] + extra);
    });

    net.demand = demand;
    net.capacity = capacity;
    net.supplied = given;
    for (const k of ["demand", "capacity", "supplied"]) net.avg[k] += (net[k] - net.avg[k]) * SMOOTHING;
  }
  // A generator near no pole has nothing to power.
  for (const e of world.entities.values()) {
    if (e.type === "generator" && !netOf.has(e)) e.status = e.burn || e.fuel ? "unconnected" : "no-fuel";
  }
}

// Whether machine e has the energy to work this tick, without spending it. When it
// hasn't, its status says "no-power" if its network made nothing for it (or it's
// near no pole); with only some power it's still "working", just slower.
export function hasPower(world, e) {
  if (e.energy >= drawOf(e)) return true;
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
