// Production statistics: how much of each item is made and used, and how busy
// each machine has been.
//
// Made: what miners dig, furnaces smelt, assemblers make, and the player mines or
// crafts by hand. Used: the ore a furnace smelts and the fuel it lights, what
// assemblers and hand-crafts make things from (counted when the craft is done,
// since one called off gives it back), the coal generators burn and what the HUB
// is given. An item moved from one building to another is neither.
//
// world.stats is { since, now, series }. `now` counts this second so far
// ({ made: { item: n }, used: { item: n } }). Every second it goes into `series`,
// which has three rings per item (WINDOWS): the last minute a second at a time,
// the last 10 minutes 10 s at a time and the last hour a minute at a time, each
// BUCKETS long, for what was made and what was used. series[item] is one
// Uint32Array: window w's ring for kind k (MADE or USED) starts at
// (w * 2 + k) * BUCKETS, and the bucket that ends at tick t is at
// (t / window.ticks - 1) % BUCKETS in it, so where each ring is up to follows from
// the clock. `since` is the tick counting started (a game from before stats starts
// at the tick it was loaded), so a young game's rates aren't spread over time it
// didn't have. All of it is saved.
//
// Besides items, it counts pollution (POLLUTION, see pollution.js): what machines
// give off as made and what the ground takes in as used, in the sim's whole
// numbers; and electricity (POWER, see power.js), in joules: what generators
// deliver as made and what the machines on a network ask for as used, so a network
// short of power shows as more used than made. Those can outgrow a Uint32Array's
// hour, so their series are Float64Arrays.
//
// Machines (miners, furnaces, assemblers) count the ticks they spend in each
// status (ACTIVITY), in `activity`: what it's doing (`status`) and since which tick
// (`from`), which is counted when that changes, so a tick costs one comparison;
// this second's ticks in `now`, the last BUCKETS seconds' in `ring`
// (ACTIVITY.length per second) and their totals in `sum`. A tick spent waiting for
// power on a network that can't make enough counts as "no-power", though the
// machine says it's still working, just slower. That isn't saved: it's only the
// last minute, and fills again in one.

const TICK_RATE = 60; // ticks a second, as in world.js (which imports this file)
export const BUCKETS = 60;
export const WINDOWS = [
  { id: "1m", name: "1 min", ticks: TICK_RATE },
  { id: "10m", name: "10 min", ticks: 10 * TICK_RATE },
  { id: "1h", name: "1 hour", ticks: 60 * TICK_RATE },
];
export const MADE = 0;
export const USED = 1;
export const SERIES_LEN = WINDOWS.length * 2 * BUCKETS;
const PER_BUCKET = WINDOWS.map((w, i) => (i ? w.ticks / WINDOWS[i - 1].ticks : 1)); // finer buckets in each

export const POLLUTION = "pollution";
export const POWER = "power";
export const NOT_ITEMS = [POLLUTION, POWER]; // what's counted besides items
const newSeries = (id) => (NOT_ITEMS.includes(id) ? new Float64Array(SERIES_LEN) : new Uint32Array(SERIES_LEN));

export const statsState = (since = 0) => ({ since, now: { made: {}, used: {} }, series: {} });

export function produced(stats, item, n = 1) {
  stats.now.made[item] = (stats.now.made[item] || 0) + n;
}

export function consumed(stats, item, n = 1) {
  stats.now.used[item] = (stats.now.used[item] || 0) + n;
}

// Everything in `items` ({ item: count }), as used.
export function consumedAll(stats, items) {
  for (const id in items) consumed(stats, id, items[id]);
}

// The statuses a machine's activity counts; the first is working, the rest are
// what held it up.
export const ACTIVITY = ["working", "no-input", "no-fuel", "no-power", "full", "no-output", "no-resource", "no-recipe"];
const CODE = Object.fromEntries(ACTIVITY.map((s, i) => [s, i]));
export const TRACKED = new Set(["miner", "furnace", "assembler"]);

const activityState = () => ({
  status: null,
  from: 0,
  now: new Uint8Array(ACTIVITY.length),
  ring: new Uint8Array(BUCKETS * ACTIVITY.length),
  sum: new Uint16Array(ACTIVITY.length),
});

// Counts this tick for machine e, after it has stepped. `starved` is the tick it
// last waited for power (power.js).
export function tally(world, e) {
  const a = e.activity || (e.activity = activityState());
  const status = e.starved === world.tick ? "no-power" : e.status;
  if (status !== a.status) {
    count(a, world.tick);
    a.status = status;
  }
}

// Counts the ticks from `from` up to (not including) tick t in what machine
// activity `a` has been doing, and goes on from t.
function count(a, t) {
  if (a.status !== null) a.now[CODE[a.status]] += t - a.from;
  a.from = t;
}

// At the end of every second: this second's counts go into the rings, and every
// 10 s and every minute the finer ring's last buckets are added up into the next.
// `machines` are the buildings that tally().
export function rollStats(world, machines) {
  const t = world.tick;
  if (t % TICK_RATE) return;
  const stats = world.stats;
  const { made, used } = stats.now;
  for (const id in made) stats.series[id] ||= newSeries(id);
  for (const id in used) stats.series[id] ||= newSeries(id);
  for (const id in stats.series) {
    const s = stats.series[id];
    s[slot(0, MADE, t)] = made[id] || 0;
    s[slot(0, USED, t)] = used[id] || 0;
    for (let w = 1; w < WINDOWS.length && t % WINDOWS[w].ticks === 0; w++) {
      for (const k of [MADE, USED]) {
        let n = 0;
        for (let i = 0; i < PER_BUCKET[w]; i++) n += s[slot(w - 1, k, t - i * WINDOWS[w - 1].ticks)];
        s[slot(w, k, t)] = n;
      }
    }
  }
  // Emptied rather than replaced, so counting goes on into objects of the same shape.
  for (const id in made) made[id] = 0;
  for (const id in used) used[id] = 0;

  const k = ACTIVITY.length;
  const at = ((t / TICK_RATE - 1) % BUCKETS) * k;
  for (const e of machines) {
    const a = e.activity;
    if (!a) continue;
    count(a, t + 1); // this tick has been tallied
    for (let i = 0; i < k; i++) {
      a.sum[i] += a.now[i] - a.ring[at + i];
      a.ring[at + i] = a.now[i];
      a.now[i] = 0;
    }
  }
}

// Where the bucket of window w ending at tick t (a multiple of its length) is.
const slot = (w, kind, t) => (w * 2 + kind) * BUCKETS + ((t / WINDOWS[w].ticks - 1) % BUCKETS);

// How many of window w's buckets hold counts: all of them, unless counting started
// less than the window ago.
export function covered(world, w) {
  const len = WINDOWS[w].ticks;
  return Math.min(BUCKETS, Math.floor(world.tick / len) - Math.ceil(world.stats.since / len));
}

// Window w's buckets of what was made (MADE) or used (USED) of `item`, oldest first;
// buckets from before counting started are null.
export function history(world, item, w, kind) {
  const s = world.stats.series[item];
  const n = Math.max(0, covered(world, w));
  const last = Math.floor(world.tick / WINDOWS[w].ticks); // the newest bucket ends at last × its length
  const out = [];
  for (let i = BUCKETS - 1; i >= 0; i--) {
    out.push(i >= n ? null : s ? s[(w * 2 + kind) * BUCKETS + ((last - 1 - i) % BUCKETS)] : 0);
  }
  return out;
}

// How many of `item` a minute were made (MADE) or used (USED) over window w, or
// null before the first bucket is in.
export function perMinute(world, item, w, kind) {
  const n = covered(world, w);
  if (n <= 0) return null;
  let total = 0;
  for (const v of history(world, item, w, kind)) total += v || 0;
  return (total * 60 * TICK_RATE) / (n * WINDOWS[w].ticks);
}

// The items with anything made or used over window w, in `order`.
export function itemsSeen(world, w, order) {
  return order.filter((id) => world.stats.series[id] && [MADE, USED].some((k) => history(world, id, w, k).some((v) => v > 0)));
}

// How machine e spent the last minute or so: the share of ticks in each status
// ({ status: fraction }, only those it spent any in) and how many seconds that
// covers. Null before it has stepped.
export function activityOf(world, e) {
  const a = e.activity;
  if (!a) return null;
  let total = 0;
  const ticks = ACTIVITY.map((s, i) => a.sum[i] + a.now[i] + (s === a.status ? world.tick + 1 - a.from : 0));
  for (const n of ticks) total += n;
  if (!total) return null;
  const share = {};
  ACTIVITY.forEach((s, i) => ticks[i] && (share[s] = ticks[i] / total));
  return { share, seconds: total / TICK_RATE };
}
