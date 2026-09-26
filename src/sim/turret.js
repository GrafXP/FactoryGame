// Gun turrets use magazines without electricity. The loaded magazine is consumed
// when opened; its remaining shots stay in the turret until fired or dismantled.
import { BUILDINGS } from "./buildings.js";
import { count, take, give } from "./inventory.js";
import { unitsNear, TILE, hitUnit } from "./enemies.js";
import { consumed } from "./stats.js";
import { raise } from "./world.js";

export const AMMO = { "firearm-magazine": { shots: 10, damage: 6 } };
const { range: RANGE, rate: RATE, stack: STACK, feed: FEED } = BUILDINGS.turret;
export const turretState = () => ({ ammo: null, loaded: null, shots: 0, cool: 0, target: 0, aim: 0, fired: -1, kills: 0, damage: 0, warned: -600, status: "no-ammo" });
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
export function stepTurret(world, t) {
  if (t.cool) t.cool--;
  let u = world.enemies.on && world.enemies.units.get(t.target);
  if (!u || distance(t, u) > RANGE * RANGE) {
    u = null;
    let best = RANGE * RANGE;
    if (world.enemies.on) for (const candidate of unitsNear(world, t.x + 1, t.y + 1, RANGE)) {
      const d = distance(t, candidate);
      if (d <= best && (!u || d < best || candidate.id < u.id)) { u = candidate; best = d; }
    }
    t.target = u?.id || 0;
  }
  if (!t.shots && !t.ammo) {
    t.status = "no-ammo";
    if (u && world.tick - t.warned >= 600) { raise(world, "no-ammo", t); t.warned = world.tick; }
    return;
  }
  t.status = u ? "working" : "idle";
  if (!u) return;
  t.aim = Math.atan2(u.x / TILE - t.x - 1, t.y + 1 - u.y / TILE);
  if (t.cool) return;
  if (!t.shots) {
    t.loaded = t.ammo.item;
    t.shots = AMMO[t.loaded].shots;
    consumed(world.stats, t.loaded);
    if (!--t.ammo.n) t.ammo = null;
  }
  const hit = hitUnit(world, u, AMMO[t.loaded].damage, t);
  t.damage += hit.damage;
  if (hit.killed) { t.kills++; t.target = 0; }
  if (!--t.shots) t.loaded = null;
  t.cool = RATE;
  t.fired = world.tick;
}
