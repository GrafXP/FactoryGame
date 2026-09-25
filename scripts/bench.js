// Headless benchmark: builds the benchmark factory (src/sim/bench.js) and reports
// how long a tick takes.
//
//   npm run bench                 the big one
//   npm run bench -- small 600    another size, and how many ticks to time
//
// For where the time goes: node --cpu-prof scripts/bench.js, then open the
// .cpuprofile in Chrome's DevTools (Performance).
import { performance } from "node:perf_hooks";
import { step, place, removeAt, TICK_RATE } from "../src/sim/world.js";
import { benchWorld, benchCounts, drain } from "../src/sim/bench.js";

const [name = "big", ticksArg = "1800"] = process.argv.slice(2);
const TICKS = Number(ticksArg);
const WARMUP = 40 * TICK_RATE; // long enough for every belt to fill to how it runs

let t = performance.now();
const { world, sinks } = benchWorld(name);
const built = performance.now() - t;
const run = (n) => {
  for (let i = 0; i < n; i++) {
    step(world);
    drain(sinks);
  }
};

t = performance.now();
run(WARMUP);
const warm = performance.now() - t;

const times = [];
for (let i = 0; i < TICKS; i++) {
  const s = performance.now();
  step(world);
  drain(sinks);
  times.push(performance.now() - s);
}
times.sort((a, b) => a - b);
const mean = times.reduce((a, b) => a + b, 0) / times.length;
const pct = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];

const { buildings, belts, items } = benchCounts(world);
const statuses = {};
for (const e of world.entities.values()) if (e.status) statuses[`${e.type} ${e.status}`] = (statuses[`${e.type} ${e.status}`] || 0) + 1;

// What building something costs in a factory this big: the tick after a building
// goes up works out again the networks it's part of (the belt network for a belt,
// the power network for a pole), and what each machine's neighbours are. Each
// type is taken down and put back up, a few times over.
const change = (type) => {
  const list = [...world.entities.values()].filter((e) => e.type === type).slice(0, 20);
  let ms = 0;
  for (const e of list) {
    removeAt(world, e.x, e.y);
    place(world, type, e.x, e.y, e.rot);
    const s = performance.now();
    step(world);
    ms += performance.now() - s;
    drain(sinks);
  }
  return ms / list.length;
};
const changes = ["belt", "pole", "inserter"].map((type) => `${type} ${change(type).toFixed(1)} ms`);

const ms = (v) => `${v.toFixed(3)} ms`;
console.log(`bench=${name}: ${buildings} buildings (${buildings - belts} + ${belts} belts), ${items} items on belts`);
console.log(`built in ${ms(built)}, ${WARMUP} ticks of warm-up in ${ms(warm)} (${ms(warm / WARMUP)} a tick)`);
console.log(`${TICKS} ticks: mean ${ms(mean)}, median ${ms(pct(0.5))}, 95% ${ms(pct(0.95))}, max ${ms(times.at(-1))}`);
console.log(`the sim uses ${((mean * TICK_RATE) / 10).toFixed(1)}% of the time at ${TICK_RATE} UPS`);
console.log(`the tick after building something: ${changes.join(", ")}`);
console.log(Object.entries(statuses).sort().map(([k, n]) => `  ${k}: ${n}`).join("\n"));
