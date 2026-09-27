// Gun turrets use magazines without electricity; lasers use power (power.js).
// The loaded magazine is consumed
// when opened; its remaining shots stay in the turret until fired or dismantled.
//
// A turret shoots the nearest enemy unit in range, keeping it until it dies or
// leaves range, and with none in range the nearest nest (`nest`, its id, 0 for
// none): that's how bases are cleared (enemies.js). In peaceful mode it only shoots
// units out defending their base. `looked` is the world.mapVersion at which it last
// found no nest in range, so it looks again only once nests may have changed; it
// isn't saved, and a loaded turret just looks again.
import { BUILDINGS } from "./buildings.js";
import { count, take, give } from "./inventory.js";
import { unitsNear, TILE, hitUnit, hitNest, nestOf } from "./enemies.js";
import { NEST } from "./map.js";
import { CHUNK, getChunk } from "./chunks.js";
import { consumed, produced, KILLS } from "./stats.js";
import { usePower } from "./power.js";
import { raise } from "./world.js";

// What a magazine gives: `shots` shots of `damage`, less the target's armour, of
// which `pierce` doesn't count. Research raises the damage and how often a turret
// shoots (world.upgrades, tech.js).
export const AMMO = {
  "firearm-magazine": { shots: 10, damage: 6, pierce: 0 },
  "piercing-magazine": { shots: 10, damage: 8, pierce: 3 },
};
const { stack: STACK, feed: FEED } = BUILDINGS.turret;
export const isTurret = (e) => e.type === "turret" || e.type === "laser-turret";
export const turretRange = (world, t) => BUILDINGS[t.type].range + world.upgrades.bonus.range;
export const turretState = () => ({ ammo: null, loaded: null, shots: 0, cool: 0, target: 0, nest: 0, aim: 0, fired: -1, kills: 0, damage: 0, warned: -600, status: "no-ammo", looked: -1 });
export const laserState = () => ({ cool: 0, target: 0, nest: 0, aim: 0, fired: -1, kills: 0, damage: 0, status: "idle", looked: -1, beam: 0, beamAim: 0 });
const room = (t, item, limit) => Object.hasOwn(AMMO, item) && (!t.ammo || t.ammo.item === item) ? Math.max(0, limit - (t.ammo?.n || 0)) : 0;
export const turretRoom = (t, item) => room(t, item, STACK);
export const turretCanTake = (t, item) => room(t, item, FEED) > 0;
export function turretAdd(t, item, n = 1) {
  if (t.ammo) t.ammo.n += n;
  else t.ammo = { item, n };
}
export function loadTurret(t, inv, item, max = Infinity) {
  const n = Math.min(count(inv, item), turretRoom(t, item), max);
  if (n > 0) { take(inv, { [item]: n }); turretAdd(t, item, n); }
  return n;
}
export function emptyTurret(t, inv, max = Infinity) {
  const n = Math.min(t.ammo?.n || 0, max);
  if (!n) return {};
  const moved = { [t.ammo.item]: n };
  if (!(t.ammo.n -= n)) t.ammo = null;
  give(inv, moved);
  return moved;
}
const distance = (t, u) => (u.x / TILE - t.x - 1) ** 2 + (u.y / TILE - t.y - 1) ** 2;

// Whether turrets shoot unit u: any with the enemies on, only defenders in peaceful mode.
const fair = (world, u) => world.enemies.on || world.enemies.groups.get(u.group).kind === "defend";

// The nearest nest within range of turret t (to the nearest tile of it), or null.
function nestInRange(world, t, range) {
  if (t.looked === world.mapVersion && t.lookedRange === range) return null;
  const cx = t.x + 1;
  const cy = t.y + 1;
  let best = null;
  let bestD = range * range;
  for (let y = Math.floor((cy - range - NEST) / CHUNK); y <= Math.floor((cy + range) / CHUNK); y++) {
    for (let x = Math.floor((cx - range - NEST) / CHUNK); x <= Math.floor((cx + range) / CHUNK); x++) {
      for (const n of getChunk(world, x, y).nests) {
        const dx = Math.max(n.x - cx, 0, cx - n.x - NEST);
        const dy = Math.max(n.y - cy, 0, cy - n.y - NEST);
        const d = dx * dx + dy * dy;
        if (d < bestD || (d === bestD && (!best || n.id < best.id))) [best, bestD] = [n, d];
      }
    }
  }
  if (!best) { t.looked = world.mapVersion; t.lookedRange = range; }
  return best;
}

export function stepTurret(world, t) {
  const laser = t.type === "laser-turret";
  const range = turretRange(world, t);
  if (!laser && t.cool) t.cool--;
  const en = world.enemies;
  let u = en.units.get(t.target);
  if (!u || distance(t, u) > range * range || !fair(world, u)) {
    u = null;
    let best = range * range;
    for (const candidate of unitsNear(world, t.x + 1, t.y + 1, range)) {
      if (!fair(world, candidate)) continue;
      const d = distance(t, candidate);
      if (d <= best && (!u || d < best || candidate.id < u.id)) { u = candidate; best = d; }
    }
    t.target = u?.id || 0;
  }
  let nest = null;
  if (!u) nest = t.nest && !en.dead.has(t.nest) ? nestOf(world, t.nest) : nestInRange(world, t, range);
  t.nest = nest?.id || 0;
  if (!laser && !t.shots && !t.ammo) {
    t.status = "no-ammo";
    if (u && world.tick - t.warned >= 600) { raise(world, "no-ammo", t); t.warned = world.tick; }
    return;
  }
  t.status = u || nest ? "working" : "idle";
  // The laser's recharge clock advances only on powered ticks. Two ticks of
  // stored energy smooth supply; sustained brownouts slow its shooting evenly.
  // With nothing to shoot it spends only its small standby drain.
  if (laser) {
    const draw = BUILDINGS[t.type][u || nest ? "draw" : "drain"];
    if (!usePower(world, t, draw)) return;
    if (t.cool) t.cool--;
  }
  if (!u && !nest) return;
  const [ax, ay] = u ? [u.x / TILE, u.y / TILE] : [nest.x + NEST / 2, nest.y + NEST / 2];
  t.aim = Math.atan2(ax - t.x - 1, t.y + 1 - ay);
  if (t.cool) return;
  if (!laser && !t.shots) {
    t.loaded = t.ammo.item;
    t.shots = AMMO[t.loaded].shots;
    consumed(world.stats, t.loaded);
    if (!--t.ammo.n) t.ammo = null;
  }
  const damage = laser ? world.upgrades.laserDamage : world.upgrades.damage[t.loaded];
  // Lasers ignore physical armour; their raw damage stays below piercing guns.
  const pierce = laser ? damage : AMMO[t.loaded].pierce;
  const hit = u ? hitUnit(world, u, damage, t, pierce) : hitNest(world, nest.id, damage, t);
  t.damage += hit.damage;
  if (hit.killed) {
    t.kills++;
    produced(world.stats, KILLS);
    t.target = 0;
    t.nest = 0;
  }
  if (laser) { t.beam = Math.hypot(ax - t.x - 1, ay - t.y - 1); t.beamAim = t.aim; }
  else if (!--t.shots) t.loaded = null;
  t.cool = laser ? world.upgrades.laserRate : world.upgrades.rate;
  t.fired = world.tick;
}
