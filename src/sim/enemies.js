// Enemies (plan 2B): nests out on the map that take in pollution, the attack groups
// they send at the factory, and evolution.
//
// Nests come with the land (map.js, chunks.js) and take in the pollution of the
// chunk they're in (pollution.js). One that has taken any in gets a state in
// world.enemies.nests (by nest id): `points`, the pollution it has taken in and not
// spent yet; `home`, the kinds of the units it has hatched and keeps at home, oldest
// first (it starts with GUARDS mites); `next`, the kind it hatches next (-1 while not
// picked); `group`, the id of its group while one is out (0 for none); and `hp` and
// `hit`, its health and the tick it was last hit. Units at home are only a list of
// kinds, so nests away from the factory cost nothing but that. Once a second each
// hatches what its points pay for, up to HOME_CAP units, and one that hasn't been hit
// for a while mends. With the enemies on and no group of its own out, a nest with a
// group's worth of units more than GUARDS at home sends that group at the building
// that pollutes most nearby (pickTarget), on the 10-second marks; the guards stay
// home. In peaceful mode nests only hatch, and fight back when they're attacked.
//
// Nests have health, and turrets shoot them (turret.js). When one is hit, every nest
// of its base (the nests round the middle of one map square, map.js, or one a group
// founded) sends out all it has at home to defend it: at the turret that fired. At 0
// it's destroyed (destroyNest) and its land is free.
//
// Bases spread. Every so often (EXPANSION, sooner with evolution) a nest with units
// to spare sends a few to found a new nest on empty land nearby: never in the safe
// zone round the start (SAFE) and never within EXPANSION.clear tiles of a building.
// A founded nest is kept in world.enemies.founded (by id, FOUNDED and up, so they
// never meet the ids of the nests the map makes), even once destroyed, and is like
// any other from then on.
//
// A group ({ id, nest, kind, target, goal, path, mode, units, hit }) is out to
// attack a building (`kind` "attack"), defend its base from a turret ("defend") or
// found a nest ("expand", with no target and the new nest's tiles as its goal). It
// gets one path (tiles,
// as x, y pairs in an Int32Array) from its nest to beside its target (`goal`, the
// target's footprint): A* on tiles (findPath), worked out one a tick from
// world.enemies.queue. Water and nests can't be crossed; belts, poles and
// underground belts can be walked over, and every other building is a wall to chew
// through, costed by its health, so a group goes round a short wall and through a
// long one (a group going to found a nest only goes round). Its units follow the
// path, each a little off its middle, attacking any building on the next tile and
// the target once it's in reach; spitters spit at a building in the way from as far
// as they reach. A group founding a nest does so once all its units are at the end
// of the path, if the land is still free, and goes home if it isn't. When the target is
// gone the group looks for another building near the end of its path; with none,
// it walks back along the path and its units rejoin the nest. A group that's shot
// turns on the turret, unless it's peaceful and the group isn't defending. `mode` is "plan"
// while it waits for a path, "go" and "home"; `hit` is the tick it last hit
// something; `units` are its units' ids.
//
// Units ({ id, kind, group, x, y, ox, oy, hp, cool, step, target, dx, dy }) have
// positions in 1/TILE of a tile, in whole numbers, so the sim stays exact. (ox, oy)
// is how far off the path's middle a unit walks, `step` the path tile it's heading
// for next, `target` the building it's attacking (0 for none), `cool` the ticks
// until it can attack again and (dx, dy) its last move, for drawing. They're kept in
// world.enemies.units and, for looking up who's near what, by the chunk they're in
// (byChunk: chunk key → Set of units). Random picks come from world.enemies.rand,
// saved with the rest.
//
// Evolution (0 to 1) goes up a little every second, more with the pollution nests
// take in, and most when a nest is destroyed. It decides which kinds of unit hatch
// and how tough they are.
import { BUILDINGS, footprint } from "./buildings.js";
import { NEST, SAFE, WATER, nestById, baseNests } from "./map.js";
import { CHUNK, chunkKey, chunkOf, markNest, tileIndex, inMap, isCharted, NEST_ID } from "./chunks.js";
import { entityAt } from "./grid.js";
import { isConveyor } from "./transport.js";
import { damage, healthOf, REPAIR_AFTER, REPAIR_SHARE } from "./health.js";
import { raiseAt } from "./world.js";

const TICK_RATE = 60; // ticks a second, as in world.js (which imports this file)
const POLLUTION_UNIT = 3600; // a unit of pollution in the sim's numbers, as in pollution.js
export const TILE = 256; // a unit's position is in 1/TILE of a tile

// The kinds of unit. `speed` is in 1/TILE of a tile a tick, `reach` in 1/TILE of a
// tile from the building's edge, `rate` the ticks between attacks, and `cost` the
// pollution (in units) a nest spends to hatch one. `hp` is at evolution 0; they get
// tougher as it goes up.
export const UNITS = [
  { id: "mite", name: "Mite", hp: 15, armor: 0, speed: 12, damage: 7, rate: 35, reach: 1.5 * TILE, cost: 4 },
  { id: "brute", name: "Brute", hp: 200, armor: 4, speed: 7, damage: 30, rate: 50, reach: 1.6 * TILE, cost: 20 },
  { id: "spitter", name: "Spitter", hp: 30, armor: 0, speed: 10, damage: 10, rate: 90, reach: 12 * TILE, cost: 12 },
];
export const [MITE, BRUTE, SPITTER] = [0, 1, 2];

export const GUARDS = 3; // units a nest keeps at home
export const HOME_CAP = 30; // units a nest has at most
export const NEST_ABSORB = 2 * POLLUTION_UNIT; // pollution a nest takes in a second, at most
const POINTS_CAP = 100 * POLLUTION_UNIT; // pollution a nest keeps unspent, at most
export const ATTACK_REACH = 320; // tiles from a nest to what it attacks
const RETARGET = 20; // tiles round the end of a group's path it looks for more to attack
const ATTACK_EVERY = 10 * TICK_RATE;
export const EVOLUTION = { time: 0.000004, pollution: 0.00001, nest: 0.002 }; // a second, a unit taken in, a nest destroyed
export const NEST_HEALTH = 500;
const NEST_MEND = Math.floor((NEST_HEALTH * REPAIR_SHARE) / 100); // a second, once it hasn't been hit for REPAIR_AFTER
// Founding nests: `every` ticks at evolution 0 (a little more or less, and down to
// 40% of it at evolution 1), `units` going, to a spot `near` to `far` tiles from
// their nest with no building (or ruin) within `clear` tiles and no nest within
// `gap`, found in at most `tries` random picks.
export const EXPANSION = { every: 10 * 60 * TICK_RATE, units: 5, near: 16, far: 48, clear: 30, gap: 2, tries: 12 };
export const FOUNDED = 2 ** 40; // founded nests' ids start here

// The key of the base nest `id` is in: the map square's for the nests the map makes
// (see map.js), its own for a founded nest, which is a base on its own.
export const baseKey = (id) => (id >= FOUNDED ? id : Math.floor(id / 8));

// How strong a base is by how many units it has, at home and out: TIERS[i] is the
// fewest for tier i + 1.
export const TIERS = [10, 50];
export const TIER_NAMES = ["Weak", "Medium", "Strong"];
export const tierOf = (units) => TIERS.filter((n) => units >= n).length;

// How many units a group has at evolution `evo`.
export const groupSize = (evo) => 5 + Math.floor(15 * evo);

// How likely each kind is to hatch at evolution `evo`: mites always, brutes from 0.2
// and spitters from 0.4.
const weights = (evo) => [1, Math.max(0, (evo - 0.2) * 2.5), Math.max(0, (evo - 0.4) * 2.5)];

// Belts and poles can be walked over; everything else is in the way.
export const walkable = (e) => isConveyor(e) || e.type === "pole";

export const enemyState = (seed, on = false) => ({
  on, // enemies on, or peaceful
  evolution: 0,
  rand: (seed ^ 0x5bd1e995) >>> 0,
  nextId: 1, // for units and groups
  absorbed: 0, // pollution nests have taken in since the last second, for evolution
  nests: new Map(),
  dead: new Set(), // ids of the nests that have been destroyed
  founded: new Map(), // the nests groups have founded, by id: { id, x, y }, destroyed ones too
  expandAt: EXPANSION.every, // the tick of the next try at founding a nest
  units: new Map(),
  groups: new Map(),
  queue: [], // ids of the groups waiting for a path
  search: null, // the path search under way, for the first of them
  cells: {}, // the arrays path searches work in
  byChunk: new Map(),
});

// The next random number in [0, 1), from the enemies' own seeded sequence.
function random(world) {
  const en = world.enemies;
  en.rand = (en.rand + 0x6d2b79f5) >>> 0;
  let t = en.rand;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// A new nest's state, with `home` at home.
const nestState = (home) => ({ points: 0, home, next: -1, group: 0, hp: NEST_HEALTH, hit: -REPAIR_AFTER });

// Nest `id`'s state, made if it has none yet: a nest wakes with GUARDS mites at home.
function hive(world, id) {
  let s = world.enemies.nests.get(id);
  if (!s) world.enemies.nests.set(id, (s = nestState(Array(GUARDS).fill(MITE))));
  return s;
}

// Nest `id` ({ id, x, y }), from the ones seen so far or else from the seed.
export function nestOf(world, id) {
  let n = world.nests.get(id);
  if (!n && (n = id >= FOUNDED ? world.enemies.founded.get(id) : nestById(world.seed, id))) world.nests.set(id, n);
  return n || null;
}

// The nests of base `key` that are still there.
export function baseNestsOf(world, key) {
  const en = world.enemies;
  if (key >= FOUNDED) return en.founded.has(key) && !en.dead.has(key) ? [nestOf(world, key)] : [];
  return baseNests(world.seed, key)
    .filter((n) => !en.dead.has(n.id))
    .map((n) => nestOf(world, n.id));
}

// The nest on tile (x, y), or null.
export function nestAt(world, x, y) {
  return chunkOf(world, x, y).nests.find((n) => x >= n.x && x < n.x + NEST && y >= n.y && y < n.y + NEST) || null;
}

// The nest a nest's pollution comes from: the chunk its middle is in.
export const nestChunk = (world, n) => chunkOf(world, n.x + (NEST >> 1), n.y + (NEST >> 1));

// Nest n takes in `amount` of pollution (pollution.js).
export function feedNest(world, n, amount) {
  const s = hive(world, n.id);
  s.points = Math.min(POINTS_CAP, s.points + amount);
  world.enemies.absorbed += amount;
}

// Turns the enemies on, or makes it peaceful: groups out to fight go home.
export function setEnemies(world, on) {
  world.enemies.on = on;
  if (!on) for (const g of world.enemies.groups.values()) if (g.kind !== "expand") goHome(world, g);
}

export function stepEnemies(world) {
  const en = world.enemies;
  if (en.queue.length) planNext(world);
  for (const u of en.units.values()) stepUnit(world, u);
  for (const g of en.groups.values()) stepGroup(world, g);
  if (world.tick % TICK_RATE === 0) stepSecond(world);
}

// Once a second: evolution, then every nest mends, hatches what it can and maybe
// attacks, and now and then one sets out to found another.
function stepSecond(world) {
  const en = world.enemies;
  en.evolution += (1 - en.evolution) * (EVOLUTION.time + (EVOLUTION.pollution * en.absorbed) / POLLUTION_UNIT);
  en.absorbed = 0;
  const attack = en.on && world.tick % ATTACK_EVERY === 0;
  for (const [id, s] of en.nests) {
    if (s.hp < NEST_HEALTH && world.tick - s.hit >= REPAIR_AFTER) s.hp = Math.min(NEST_HEALTH, s.hp + NEST_MEND);
    while (s.home.length < HOME_CAP) {
      if (s.next < 0) s.next = pickKind(world);
      const cost = UNITS[s.next].cost * POLLUTION_UNIT;
      if (s.points < cost) break;
      s.points -= cost;
      s.home.push(s.next);
      s.next = -1;
    }
    if (attack && !s.group && s.home.length >= GUARDS + groupSize(en.evolution)) sendGroup(world, id, s);
  }
  if (world.tick >= en.expandAt) expand(world);
}

function pickKind(world) {
  const w = weights(world.enemies.evolution);
  let r = random(world) * (w[0] + w[1] + w[2]);
  for (let k = 0; k < w.length; k++) if ((r -= w[k]) < 0) return k;
  return MITE;
}

// The building that pollutes most near nest n, going by how much its kind gives
// off over how far it is, or null if none is in reach.
function pickTarget(world, n) {
  const cx = n.x + NEST / 2;
  const cy = n.y + NEST / 2;
  let best = null;
  let score = 0;
  for (const e of world.entities.values()) {
    const p = BUILDINGS[e.type].pollution;
    if (!p) continue;
    const { w, h } = footprint(e.type, e.rot);
    const dx = e.x + w / 2 - cx;
    const dy = e.y + h / 2 - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > ATTACK_REACH) continue;
    const sc = p / (d + 32);
    if (sc > score) {
      score = sc;
      best = e;
    }
  }
  return best;
}

// The nearest building that isn't walked over within RETARGET tiles of tile (x, y),
// or null: the tiles round it in rings, nearest first, each ring from its top-left
// corner clockwise.
function nearbyTarget(world, x, y) {
  for (let d = 0; d <= RETARGET; d++) {
    const side = 2 * d || 1;
    for (let i = 0; i < 4 * side; i++) {
      const edge = Math.floor(i / side);
      const k = i % side;
      const tx = edge === 0 ? x - d + k : edge === 1 ? x + d : edge === 2 ? x + d - k : x - d;
      const ty = edge === 0 ? y - d : edge === 1 ? y - d + k : edge === 2 ? y + d : y + d - k;
      const e = entityAt(world, tx, ty);
      if (e && !walkable(e)) return e;
      if (!d) break;
    }
  }
  return null;
}

const rectOf = (e) => ({ x: e.x, y: e.y, ...footprint(e.type, e.rot) });

// Sends a group from nest `id` at the building that pollutes most near it.
function sendGroup(world, id, s) {
  const n = nestOf(world, id);
  const target = n && pickTarget(world, n);
  if (!target) return;
  launch(world, n, s, "attack", target.id, rectOf(target), s.home.splice(0, groupSize(world.enemies.evolution)));
}

// Sends out a new group of `kind` from nest n (with state s), made of units of
// `kinds`, to `goal` and at building `target` (0 for none), and queues it for a path.
function launch(world, n, s, kind, target, goal, kinds) {
  const en = world.enemies;
  const g = { id: en.nextId++, nest: n.id, kind, target, goal, path: null, mode: "plan", units: [], hit: -1 };
  en.groups.set(g.id, g);
  s.group = g.id;
  for (const k of kinds) hatch(world, g, k, n);
  en.queue.push(g.id);
  return g;
}

// Nest `id` has been hit by `attacker`: every nest of its base sends out what it has
// at home to fight it, and a nest whose defenders are already out sends the rest
// after them. A nest with a group out doing anything else keeps its units home.
function defend(world, id, attacker) {
  const en = world.enemies;
  for (const n of baseNestsOf(world, baseKey(id))) {
    const s = hive(world, n.id);
    if (!s.home.length) continue;
    const g = s.group && en.groups.get(s.group);
    if (!g) launch(world, n, s, "defend", attacker.id, rectOf(attacker), s.home.splice(0));
    else if (g.kind === "defend" && g.mode !== "home") for (const k of s.home.splice(0)) hatch(world, g, k, n);
  }
}

// A turret hits nest `id` for `amount`: its base comes out to fight, and at 0 it's
// destroyed. Returns the damage done and whether it was destroyed.
export function hitNest(world, id, amount, attacker) {
  const s = hive(world, id);
  const dealt = Math.min(s.hp, Math.max(1, amount));
  s.hp -= dealt;
  s.hit = world.tick;
  defend(world, id, attacker);
  const killed = s.hp <= 0;
  if (killed) destroyNest(world, id);
  return { damage: dealt, killed };
}

// Now and then: a nest with units to spare sends some to found a nest on free land
// near it. Picks the next time first.
function expand(world) {
  const en = world.enemies;
  en.expandAt = world.tick + Math.round(EXPANSION.every * (1 - 0.6 * en.evolution) * (0.75 + 0.5 * random(world)));
  const ready = [];
  for (const [id, s] of en.nests) if (!s.group && s.home.length >= GUARDS + EXPANSION.units) ready.push(id);
  if (!ready.length) return;
  const n = nestOf(world, ready[Math.floor(random(world) * ready.length)]);
  const s = en.nests.get(n.id);
  for (let i = 0; i < EXPANSION.tries; i++) {
    const a = random(world) * Math.PI * 2;
    const d = EXPANSION.near + random(world) * (EXPANSION.far - EXPANSION.near);
    const x = Math.round(n.x + Math.cos(a) * d);
    const y = Math.round(n.y + Math.sin(a) * d);
    if (!siteFree(world, x, y)) continue;
    launch(world, n, s, "expand", 0, { x, y, w: NEST, h: NEST }, s.home.splice(0, EXPANSION.units));
    return;
  }
}

// Whether a nest can be founded with its top-left at (x, y): outside the safe zone,
// on dry land with no nest within EXPANSION.gap, and with no building or ruin within
// EXPANSION.clear tiles.
export function siteFree(world, x, y) {
  const { gap, clear } = EXPANSION;
  if (!inMap(x - clear, y - clear) || !inMap(x + NEST + clear, y + NEST + clear)) return false;
  if (Math.hypot(x + NEST / 2, y + NEST / 2) < SAFE) return false;
  for (let ty = y - gap; ty < y + NEST + gap; ty++) {
    for (let tx = x - gap; tx < x + NEST + gap; tx++) {
      const c = chunkOf(world, tx, ty);
      const i = tileIndex(tx, ty);
      if (c.ids[i]) return false;
      if (c.ore[i] === WATER && tx >= x && tx < x + NEST && ty >= y && ty < y + NEST) return false;
    }
  }
  // Buildings only stand in chunks that have been made, and those are never let go of.
  const [x0, y0, x1, y1] = [x - clear, y - clear, x + NEST + clear, y + NEST + clear];
  for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor((y1 - 1) / CHUNK); cy++) {
    for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor((x1 - 1) / CHUNK); cx++) {
      const c = world.chunks.get(chunkKey(cx, cy));
      if (!c?.built) continue;
      for (let ty = Math.max(y0, cy * CHUNK); ty < Math.min(y1, (cy + 1) * CHUNK); ty++) {
        for (let tx = Math.max(x0, cx * CHUNK); tx < Math.min(x1, (cx + 1) * CHUNK); tx++) if (c.ids[tileIndex(tx, ty)] > 0) return false;
      }
    }
  }
  return !world.ruins.some((r) => {
    const { w, h } = footprint(r.type, r.rot);
    return r.x < x1 && r.x + w > x0 && r.y < y1 && r.y + h > y0;
  });
}

// Group g has reached the land it set out for: its units found a nest there and stay
// in it, or go home if the land isn't free any more.
function found(world, g) {
  const en = world.enemies;
  const { x, y } = g.goal;
  if (!siteFree(world, x, y)) return goHome(world, g);
  const n = { id: FOUNDED + en.nextId++, x, y };
  en.founded.set(n.id, n);
  world.nests.set(n.id, n);
  // Chunks that aren't made yet mark it when they are (chunks.js).
  for (let cy = Math.floor(y / CHUNK); cy <= Math.floor((y + NEST - 1) / CHUNK); cy++) {
    for (let cx = Math.floor(x / CHUNK); cx <= Math.floor((x + NEST - 1) / CHUNK); cx++) {
      const c = world.chunks.get(chunkKey(cx, cy));
      if (!c) continue;
      markNest(c, n);
      c.version++;
    }
  }
  world.mapVersion++;
  const s = nestState([]);
  en.nests.set(n.id, s);
  for (const id of [...g.units]) {
    const u = en.units.get(id);
    s.home.push(u.kind);
    removeUnit(world, u, g);
  }
}

// A new unit of `kind` for group g, at nest n.
function hatch(world, g, kind, n) {
  const en = world.enemies;
  const off = () => Math.floor(random(world) * 141) - 70;
  const ox = off();
  const oy = off();
  const u = {
    id: en.nextId++,
    kind,
    group: g.id,
    x: n.x * TILE + (NEST * TILE) / 2 + ox,
    y: n.y * TILE + (NEST * TILE) / 2 + oy,
    ox,
    oy,
    hp: Math.round(UNITS[kind].hp * (1 + 2 * en.evolution)),
    cool: 0,
    step: 0,
    target: 0,
    dx: 0,
    dy: 0,
    key: 0,
  };
  addUnit(world, u);
  g.units.push(u.id);
}

// Puts unit u in world.enemies.units and byChunk.
export function addUnit(world, u) {
  const en = world.enemies;
  en.units.set(u.id, u);
  u.key = chunkKey(u.x >> 13, u.y >> 13); // TILE × CHUNK = 2^13
  let at = en.byChunk.get(u.key);
  if (!at) en.byChunk.set(u.key, (at = new Set()));
  at.add(u);
}

// Moves unit u to (x, y), keeping byChunk up to date.
function moveUnit(world, u, x, y) {
  u.dx = x - u.x;
  u.dy = y - u.y;
  u.x = x;
  u.y = y;
  const key = chunkKey(x >> 13, y >> 13);
  if (key === u.key) return;
  const en = world.enemies;
  const was = en.byChunk.get(u.key);
  was.delete(u);
  if (!was.size) en.byChunk.delete(u.key);
  u.key = key;
  let at = en.byChunk.get(key);
  if (!at) en.byChunk.set(key, (at = new Set()));
  at.add(u);
}

// Takes unit u out of the world, and ends its group if it was the last.
function removeUnit(world, u, g) {
  const en = world.enemies;
  en.units.delete(u.id);
  const at = en.byChunk.get(u.key);
  at.delete(u);
  if (!at.size) en.byChunk.delete(u.key);
  g.units.splice(g.units.indexOf(u.id), 1);
  if (g.units.length) return;
  en.groups.delete(g.id);
  en.queue = en.queue.filter(id => id !== g.id);
  if (en.search?.group === g.id) en.search = null;
  const s = en.nests.get(g.nest);
  if (s && s.group === g.id) s.group = 0;
}

// A turret hit uses whole-number damage after armour, less `pierce` of it, and
// redirects the group toward the gun (one out to found a nest now attacks). Keep the
// path up to its leading unit, then extend it through the normal budgeted path
// search; walls and water still constrain retaliation. In peaceful mode only
// defenders fight back.
export function hitUnit(world, u, amount, attacker, pierce = 0) {
  const dealt = Math.min(u.hp, Math.max(1, amount - Math.max(0, UNITS[u.kind].armor - pierce)));
  u.hp -= dealt;
  const g = world.enemies.groups.get(u.group);
  const killed = u.hp <= 0;
  if (killed) removeUnit(world, u, g);
  if ((world.enemies.on || g.kind === "defend") && world.enemies.groups.has(g.id) && g.target !== attacker.id) {
    if (g.kind === "expand") g.kind = "attack";
    g.target = attacker.id;
    g.goal = rectOf(attacker);
    if (g.path) {
      const leading = Math.max(...g.units.map(id => world.enemies.units.get(id).step));
      g.path = g.path.slice(0, Math.min(g.path.length, 2 * (leading + 1)));
    }
    for (const id of g.units) world.enemies.units.get(id).target = 0;
    g.mode = "plan";
    if (world.enemies.search?.group === g.id) world.enemies.search = null;
    if (!world.enemies.queue.includes(g.id)) world.enemies.queue.push(g.id);
  }
  return { damage: dealt, killed };
}

// Unit u is back at its nest, and joins the others at home.
function rejoin(world, u, g) {
  removeUnit(world, u, g);
  if (world.enemies.dead.has(g.nest)) return;
  const s = hive(world, g.nest);
  if (s.home.length < HOME_CAP) s.home.push(u.kind);
}

function goHome(world, g) {
  g.mode = "home";
  for (const id of [...g.units]) {
    const u = world.enemies.units.get(id);
    u.target = 0;
    if (!g.path) rejoin(world, u, g); // still at the nest
  }
}

// Works on the path of the first group waiting for one, BUDGET tiles a tick: from
// its nest, or from the end of the path it has, to beside its target (or the land
// it's to found a nest on, going round buildings). A group with no way there goes
// home. world.enemies.search is the search under way, with the id of its group.
function planNext(world) {
  const en = world.enemies;
  if (!en.search) {
    const g = en.groups.get(en.queue[0]);
    if (!g || g.mode !== "plan") return void en.queue.shift();
    if (g.kind !== "expand" && !world.entities.has(g.target)) {
      en.queue.shift();
      if (g.path) g.mode = "go"; // stepGroup looks for another target
      else goHome(world, g);
      return;
    }
    let from;
    let home = null;
    if (g.path) {
      const n = g.path.length;
      from = { x: g.path[n - 2], y: g.path[n - 1] };
    } else {
      const n = nestOf(world, g.nest);
      from = { x: n.x + (NEST >> 1), y: n.y + (NEST >> 1) };
      home = { x: n.x, y: n.y, w: NEST, h: NEST };
    }
    en.search = newSearch(from, g.goal, home, en.cells, g.kind === "expand");
    if (en.search) en.search.group = g.id;
  }
  const s = en.search;
  const found = s ? runSearch(world, s, BUDGET) : null;
  if (found === undefined) return;
  en.search = null;
  const g = en.groups.get(en.queue.shift());
  if (!g || g.mode !== "plan") return;
  if (!found) return goHome(world, g);
  if (g.path) {
    const joined = new Int32Array(g.path.length + found.length - 2);
    joined.set(g.path);
    joined.set(found.subarray(2), g.path.length);
    g.path = joined;
  } else g.path = found;
  g.mode = "go";
}

// A group whose target has gone looks for another near the end of its path, and
// goes home if there's none. One out to found a nest does so once its units are all
// at the end of its path.
function stepGroup(world, g) {
  if (g.mode !== "go") return;
  if (g.kind === "expand") {
    if (g.units.every((id) => 2 * world.enemies.units.get(id).step >= g.path.length)) found(world, g);
    return;
  }
  if (world.entities.has(g.target)) return;
  const n = g.path.length;
  const next = nearbyTarget(world, g.path[n - 2], g.path[n - 1]);
  if (!next) return goHome(world, g);
  g.target = next.id;
  g.goal = rectOf(next);
  g.mode = "plan";
  world.enemies.queue.push(g.id);
}

// Whether unit u is within `reach` of building e's footprint.
function inReach(u, e, reach) {
  const { w, h } = footprint(e.type, e.rot);
  const dx = Math.max(e.x * TILE - u.x, 0, u.x - (e.x + w) * TILE);
  const dy = Math.max(e.y * TILE - u.y, 0, u.y - (e.y + h) * TILE);
  return dx * dx + dy * dy <= reach * reach;
}

// Melee cannot reach through a wall to the building behind it. Ranged spitters
// still shoot over low walls. Trace the short line to the intended target.
function meleeTarget(world, u, target) {
  const { w, h } = footprint(target.type, target.rot);
  const x = u.x / TILE, y = u.y / TILE;
  const dx = target.x + w / 2 - x, dy = target.y + h / 2 - y;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 4));
  for (let i = 0; i <= steps; i++) {
    const e = entityAt(world, Math.floor(x + dx * i / steps), Math.floor(y + dy * i / steps));
    if (e && !walkable(e)) return e;
  }
  return target;
}

// The first building on group g's path ahead of unit u, as far as `reach`, that's
// in the way, or null.
function inTheWay(world, u, g, reach) {
  for (let i = u.step; 2 * i < g.path.length; i++) {
    const dx = g.path[2 * i] * TILE + TILE / 2 - u.x;
    const dy = g.path[2 * i + 1] * TILE + TILE / 2 - u.y;
    if (dx * dx + dy * dy > reach * reach) break;
    const e = entityAt(world, g.path[2 * i], g.path[2 * i + 1]);
    if (e && !walkable(e)) return e;
  }
  return null;
}

// A unit attacks what it's chewing through, or its group's target once that's in
// reach; otherwise it walks the path, forwards or, going home, backwards. A spitter
// stops to spit at a building in the way as soon as it's in reach, looking every
// fourth tick. A group founding a nest that finds its way blocked goes home.
function stepUnit(world, u) {
  const g = world.enemies.groups.get(u.group);
  const kind = UNITS[u.kind];
  if (u.cool > 0) u.cool--;
  let foe = u.target ? world.entities.get(u.target) : null;
  if (!foe) {
    u.target = 0;
    const t = g.mode === "home" ? null : world.entities.get(g.target);
    if (t && inReach(u, t, kind.reach)) foe = u.kind === SPITTER ? t : meleeTarget(world, u, t);
    else if (u.kind === SPITTER && g.path && g.mode !== "home" && g.kind !== "expand" && (world.tick + u.id) % 4 === 0) {
      foe = inTheWay(world, u, g, kind.reach);
      if (foe) u.target = foe.id;
    }
  }
  if (foe) {
    if (u.cool > 0) return;
    u.cool = kind.rate;
    g.hit = world.tick;
    damage(world, foe, kind.damage);
    return;
  }
  if (!g.path) return; // waiting at the nest for its path
  const back = g.mode === "home";
  const i = back ? u.step - 1 : u.step;
  if (i < 0) return rejoin(world, u, g);
  if (2 * i >= g.path.length) return; // at the end, waiting for another target
  const wx = g.path[2 * i];
  const wy = g.path[2 * i + 1];
  const e = entityAt(world, wx, wy);
  if (e && !walkable(e)) {
    if (g.kind === "expand" && !back) return goHome(world, g);
    u.target = e.id; // in the way: chew through it
    return;
  }
  const tx = wx * TILE + TILE / 2 + u.ox;
  const ty = wy * TILE + TILE / 2 + u.oy;
  const dx = tx - u.x;
  const dy = ty - u.y;
  const d2 = dx * dx + dy * dy;
  const v = kind.speed;
  if (d2 <= v * v) {
    moveUnit(world, u, tx, ty);
    u.step = back ? i : i + 1;
  } else {
    const d = Math.sqrt(d2);
    moveUnit(world, u, u.x + Math.round((dx * v) / d), u.y + Math.round((dy * v) / d));
  }
}

// Destroys nest `id`: its tiles are free, it's never made again, and evolution goes
// up. An alert says so, and says when that was the last of its base.
export function destroyNest(world, id) {
  const en = world.enemies;
  const n = nestOf(world, id);
  if (!n || en.dead.has(id)) return;
  en.dead.add(id);
  en.nests.delete(id);
  for (let cy = Math.floor(n.y / CHUNK); cy <= Math.floor((n.y + NEST - 1) / CHUNK); cy++) {
    for (let cx = Math.floor(n.x / CHUNK); cx <= Math.floor((n.x + NEST - 1) / CHUNK); cx++) {
      const c = world.chunks.get(chunkKey(cx, cy));
      if (!c) continue;
      c.nests = c.nests.filter((m) => m.id !== id);
      for (let y = n.y; y < n.y + NEST; y++) {
        for (let x = n.x; x < n.x + NEST; x++) {
          if (Math.floor(x / CHUNK) === cx && Math.floor(y / CHUNK) === cy) c.ids[tileIndex(x, y)] = 0;
        }
      }
      c.version++;
    }
  }
  world.mapVersion++;
  en.evolution += (1 - en.evolution) * EVOLUTION.nest;
  const last = !baseNestsOf(world, baseKey(id)).length;
  raiseAt(world, last ? "cleared" : "nest", "nest", n.x + NEST / 2, n.y + NEST / 2);
}

// Path finding: A* over the tiles in a box round the start and the goal, 8 ways,
// with no corner cutting past anything but open ground. Costs are in tenths of a
// tile: 10 a tile straight, 14 diagonally, plus a building's health for one that has
// to be chewed through. A tile's cost is read from the world the first time the
// search reaches it. A search looks at no more than BUDGET tiles a tick, so a long
// one is spread over a few ticks (world.enemies.search is the one under way), and
// is saved as it stands; a loaded one carries on exactly where it was.
//
// A search ({ from, goal, home, solid, x0, y0, W, H, looked, seq, size, heapKey,
// heapCell, state, cost, best, came, touched, nTouched }) has a cell per tile of its
// box (`solid` if buildings can't be chewed through, only gone round):
// `state` 0 for not reached, 1 reached (its `cost`, the cheapest way there found so
// far, `best`, and where that came from, `came`, are known) and 2 done. `touched`
// lists the reached cells, for saving. The heap holds cells to look at, ordered by
// estimated total cost and then by when they were found (`seq`), so ties always
// break the same way. The per-cell arrays are big, so a world keeps one set
// (world.enemies.cells, not saved) for its searches, one at a time, and only
// `state` is cleared for each.
const PAD = 48; // tiles round start and goal a search may go
const MAX_CELLS = 400 * 400;
const SEARCH_MAX = 60000; // tiles a search looks at, at most
export const BUDGET = 1000; // tiles a search looks at in a tick
const OPEN = 10; // what a tile of open ground costs
const MOVES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

// A new search for a path from tile `from` to a tile beside rectangle `goal`
// ({ x, y, w, h }), using the cells of `pool` (world.enemies.cells, or fresh ones).
// Tiles in `home` (the nest a group sets out from) can be walked over, and with
// `solid` buildings can't be. Null if the box it needs is too big.
export function newSearch(from, goal, home = null, pool = {}, solid = false) {
  const x0 = Math.min(from.x, goal.x) - PAD;
  const y0 = Math.min(from.y, goal.y) - PAD;
  const W = Math.max(from.x, goal.x + goal.w) + PAD - x0;
  const H = Math.max(from.y, goal.y + goal.h) + PAD - y0;
  if (W * H > MAX_CELLS) return null;
  if (!(pool.state?.length >= W * H)) {
    pool.state = new Uint8Array(W * H);
    pool.cost = new Int32Array(W * H);
    pool.best = new Int32Array(W * H);
    pool.came = new Int32Array(W * H);
  } else pool.state.fill(0, 0, W * H);
  const s = {
    from: { x: from.x, y: from.y },
    goal: { x: goal.x, y: goal.y, w: goal.w, h: goal.h },
    home: home && { x: home.x, y: home.y, w: home.w, h: home.h },
    solid,
    x0,
    y0,
    W,
    H,
    looked: 0,
    seq: 0,
    size: 0,
    heapKey: new Float64Array(256),
    heapCell: new Int32Array(256),
    state: pool.state,
    cost: pool.cost,
    best: pool.best,
    came: pool.came,
    touched: new Int32Array(256),
    nTouched: 0,
  };
  return s;
}

const inRect = (x, y, r) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

// What stepping onto (x, y) costs in search s, -1 for never, read from the world
// the first time it's asked.
function costAt(world, s, x, y) {
  if (x < s.x0 || y < s.y0 || x >= s.x0 + s.W || y >= s.y0 + s.H) return -1;
  const k = (y - s.y0) * s.W + (x - s.x0);
  if (s.state[k]) return s.cost[k];
  let c = OPEN;
  if (inRect(x, y, s.goal)) c = -1;
  else if (!inRect(x, y, s.home)) {
    const ch = chunkOf(world, x, y);
    const i = tileIndex(x, y);
    const id = ch.ids[i];
    if (ch.ore[i] === WATER || id === NEST_ID) c = -1;
    else if (id) {
      const e = world.entities.get(id);
      if (!walkable(e)) c = s.solid ? -1 : OPEN + healthOf(world, e);
    }
  }
  s.state[k] = 1;
  s.cost[k] = c;
  s.best[k] = 0x7fffffff;
  if (s.nTouched === s.touched.length) {
    const t = new Int32Array(s.nTouched * 2);
    t.set(s.touched);
    s.touched = t;
  }
  s.touched[s.nTouched++] = k;
  return c;
}

function heapPush(s, key, cell) {
  if (s.size === s.heapKey.length) {
    const k = new Float64Array(s.size * 2);
    k.set(s.heapKey);
    s.heapKey = k;
    const c = new Int32Array(s.size * 2);
    c.set(s.heapCell);
    s.heapCell = c;
  }
  const { heapKey, heapCell } = s;
  let i = s.size++;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heapKey[p] <= key) break;
    heapKey[i] = heapKey[p];
    heapCell[i] = heapCell[p];
    i = p;
  }
  heapKey[i] = key;
  heapCell[i] = cell;
}

function heapPop(s) {
  const { heapKey, heapCell } = s;
  const top = heapCell[0];
  const key = heapKey[--s.size];
  const cell = heapCell[s.size];
  let i = 0;
  for (;;) {
    let c = 2 * i + 1;
    if (c >= s.size) break;
    if (c + 1 < s.size && heapKey[c + 1] < heapKey[c]) c++;
    if (heapKey[c] >= key) break;
    heapKey[i] = heapKey[c];
    heapCell[i] = heapCell[c];
    i = c;
  }
  heapKey[i] = key;
  heapCell[i] = cell;
  return top;
}

// Queues cell (x, y), reached for g, in search s.
function reach(s, x, y, g) {
  const { goal } = s;
  const dx = Math.max(goal.x - 1 - x, 0, x - (goal.x + goal.w));
  const dy = Math.max(goal.y - 1 - y, 0, y - (goal.y + goal.h));
  const guess = 10 * Math.max(dx, dy) + 4 * Math.min(dx, dy);
  heapPush(s, (g + guess) * 0x100000 + s.seq++, (y - s.y0) * s.W + (x - s.x0));
}

// Looks at up to `budget` more tiles in search s. Returns the path (x, y pairs
// from `from` on, in an Int32Array), null if there's none within reach, or
// undefined if it isn't done yet.
export function runSearch(world, s, budget = Infinity) {
  const { W, x0, y0, goal, state, best, came } = s;
  if (!s.looked && !s.size && !s.nTouched) {
    costAt(world, s, s.from.x, s.from.y);
    const start = (s.from.y - y0) * W + (s.from.x - x0);
    best[start] = 0;
    came[start] = -1;
    reach(s, s.from.x, s.from.y, 0);
  }
  for (let n = 0; n < budget; n++) {
    if (!s.size || s.looked >= SEARCH_MAX) return null;
    const k = heapPop(s);
    if (state[k] === 2) continue;
    state[k] = 2;
    s.looked++;
    const x = x0 + (k % W);
    const y = y0 + Math.floor(k / W);
    if (x >= goal.x - 1 && x <= goal.x + goal.w && y >= goal.y - 1 && y <= goal.y + goal.h) {
      const tiles = [];
      for (let at = k; at >= 0; at = came[at]) tiles.push(x0 + (at % W), y0 + Math.floor(at / W));
      const path = new Int32Array(tiles.length);
      for (let i = 0; i < tiles.length; i += 2) {
        path[i] = tiles[tiles.length - 2 - i];
        path[i + 1] = tiles[tiles.length - 1 - i];
      }
      return path;
    }
    for (const [mx, my] of MOVES) {
      const nx = x + mx;
      const ny = y + my;
      const c = costAt(world, s, nx, ny);
      if (c < 0) continue;
      if (mx && my && (costAt(world, s, x + mx, y) !== OPEN || costAt(world, s, x, y + my) !== OPEN)) continue;
      const m = (ny - y0) * W + (nx - x0);
      if (state[m] === 2) continue;
      const g = best[k] + (mx && my ? Math.round(c * 1.4) : c);
      if (g >= best[m]) continue;
      best[m] = g;
      came[m] = k;
      reach(s, nx, ny, g);
    }
  }
  return undefined;
}

// A path from tile `from` to a tile beside rectangle `goal`, worked out in one go:
// what runSearch returns, or null.
export function findPath(world, from, goal, home = null) {
  const s = newSearch(from, goal, home);
  return s ? runSearch(world, s) : null;
}

// Search s as plain data for a save: only the cells it has reached.
export function saveSearch(s) {
  const at = s.touched.slice(0, s.nTouched);
  const pick = (arr) => {
    const out = new arr.constructor(at.length);
    for (let i = 0; i < at.length; i++) out[i] = arr[at[i]];
    return out;
  };
  return {
    from: { ...s.from },
    goal: { ...s.goal },
    home: s.home && { ...s.home },
    solid: s.solid,
    looked: s.looked,
    seq: s.seq,
    heapKey: s.heapKey.slice(0, s.size),
    heapCell: s.heapCell.slice(0, s.size),
    touched: at,
    state: pick(s.state),
    cost: pick(s.cost),
    best: pick(s.best),
    came: pick(s.came),
  };
}

// A search from saveSearch's data, in the cells of `pool`, or null if it doesn't
// fit together.
export function loadSearch(d, pool = {}) {
  const s = newSearch(d.from, d.goal, d.home, pool, d.solid === true);
  const n = d.touched?.length;
  if (!s || !(d.touched instanceof Int32Array) || [d.state, d.cost, d.best, d.came].some((a) => a?.length !== n)) return null;
  if (!(d.heapKey instanceof Float64Array) || !(d.heapCell instanceof Int32Array) || d.heapKey.length !== d.heapCell.length) return null;
  const cells = s.W * s.H;
  for (let i = 0; i < n; i++) {
    const k = d.touched[i];
    if (!(k >= 0 && k < cells) || s.state[k] || !(d.state[i] === 1 || d.state[i] === 2)) return null;
    if (!(d.came[i] >= -1 && d.came[i] < cells)) return null;
    s.state[k] = d.state[i];
    s.cost[k] = d.cost[i];
    s.best[k] = d.best[i];
    s.came[k] = d.came[i];
  }
  if (![...d.heapCell].every((k) => k >= 0 && k < cells && s.state[k])) return null;
  s.touched = d.touched.slice();
  s.nTouched = n;
  s.heapKey = d.heapKey.length ? d.heapKey.slice() : new Float64Array(256);
  s.heapCell = d.heapCell.length ? d.heapCell.slice() : new Int32Array(256);
  s.size = d.heapKey.length;
  s.looked = d.looked;
  s.seq = d.seq;
  return s;
}

// The units within `r` tiles of tile (x, y), found through the chunks round it
// (for turrets).
export function unitsNear(world, x, y, r) {
  const out = [];
  const en = world.enemies;
  for (let cy = Math.floor((y - r) / CHUNK); cy <= Math.floor((y + r) / CHUNK); cy++) {
    for (let cx = Math.floor((x - r) / CHUNK); cx <= Math.floor((x + r) / CHUNK); cx++) {
      const at = en.byChunk.get(chunkKey(cx, cy));
      if (!at) continue;
      for (const u of at) {
        const dx = u.x / TILE - x;
        const dy = u.y / TILE - y;
        if (dx * dx + dy * dy <= r * r) out.push(u);
      }
    }
  }
  return out;
}

// Bases, for the map view and the base panel. Every base with a nest in a charted
// chunk, from the nests seen so far: [{ key, x, y, w, h, nests, units }], with the
// box round its nests and how many units it has, at home (GUARDS for a nest that
// hasn't woken) and out.
export function chartedBases(world) {
  const en = world.enemies;
  const bases = new Map();
  for (const n of world.nests.values()) {
    if (en.dead.has(n.id) || !isCharted(world, Math.floor(n.x / CHUNK), Math.floor(n.y / CHUNK))) continue;
    const key = baseKey(n.id);
    let b = bases.get(key);
    if (!b) bases.set(key, (b = { key, x0: n.x, y0: n.y, x1: n.x + NEST, y1: n.y + NEST, nests: 0, units: 0 }));
    Object.assign(b, { x0: Math.min(b.x0, n.x), y0: Math.min(b.y0, n.y), x1: Math.max(b.x1, n.x + NEST), y1: Math.max(b.y1, n.y + NEST) });
    b.nests++;
    b.units += en.nests.get(n.id)?.home.length ?? GUARDS;
  }
  for (const g of en.groups.values()) {
    const b = bases.get(baseKey(g.nest));
    if (b) b.units += g.units.length;
  }
  return [...bases.values()].map(({ key, x0, y0, x1, y1, nests, units }) => ({ key, x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0, nests, units }));
}

// The base with a charted nest nearest ground point (x, y), within r tiles of its
// middle, or null.
export function baseNear(world, x, y, r) {
  let best = null;
  let d2 = r * r;
  for (const n of world.nests.values()) {
    if (world.enemies.dead.has(n.id) || !isCharted(world, Math.floor(n.x / CHUNK), Math.floor(n.y / CHUNK))) continue;
    const d = (n.x + NEST / 2 - x) ** 2 + (n.y + NEST / 2 - y) ** 2;
    if (d <= d2) [best, d2] = [n, d];
  }
  return best && baseKey(best.id);
}

// What the base panel shows of base `key`: its nests (with their health and units
// at home), the units it has out by what they're doing, how many of each kind it
// has in all, and its tier. Nests that haven't woken are at full health with GUARDS
// mites at home.
export function baseInfo(world, key) {
  const en = world.enemies;
  const kinds = UNITS.map(() => 0);
  const nests = baseNestsOf(world, key).map((n) => {
    const s = en.nests.get(n.id);
    const home = s ? s.home : Array(GUARDS).fill(MITE);
    for (const k of home) kinds[k]++;
    return { id: n.id, x: n.x, y: n.y, hp: s ? s.hp : NEST_HEALTH, home: home.length };
  });
  const out = { attack: 0, defend: 0, expand: 0 };
  for (const g of en.groups.values()) {
    if (baseKey(g.nest) !== key) continue;
    out[g.kind] += g.units.length;
    for (const id of g.units) kinds[en.units.get(id).kind]++;
  }
  const units = kinds.reduce((a, b) => a + b, 0);
  return { key, nests, out, kinds, units, tier: tierOf(units) };
}
