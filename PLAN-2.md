# Factory: plan 2 (after the MVP)

The next chunk of work once the MVP in [PLAN.md](PLAN.md) is done. It picks up
from "After the MVP": the logistics you need to build bigger, tools that make a
big factory buildable with one thumb, a bigger world, a second production tier
(fluids, then oil), and the polish that makes it feel like a game.

Phases carry on the MVP's numbering (11 onwards). Everything in PLAN.md's core
decisions still holds.

## Core decisions for this plan

- **Belts stay single-lane (Satisfactory-style).** Splitters, sorters and
  side-loading do the jobs Factorio uses two lanes for. The transport sim
  (`sim/transport.js`) is built around one lane, and two lanes would double every
  belt rule for something that's hard to see on a phone. Revisit only if mixed
  belts turn out to be the thing players miss most.
- **Crossing is underground, not up.** The world stays one flat layer. Belts (and
  later pipes) cross by going under, which keeps the 2D grid, the camera and the
  tap targets as they are.
- **Progression stays the HUB.** Each content phase adds its buildings and recipes
  to new HUB milestones (phase 10) instead of adding research labs and science
  packs. Feeding the HUB by belt becomes the late-game "automate this" goal.
- **Peaceful.** No enemies in this plan.
- **One thumb at scale.** Once factories reach hundreds of buildings, placing them
  one at a time on a phone is the bottleneck, so copy and paste come early.
- **Performance target, raised:** 60 UPS on a mid-range phone with ~3,000 buildings
  and ~15,000 items on belts (the MVP's was 1,000 and 5,000).

## How each phase works (same as the MVP)

- It ends with a build you can run on the phone and a short checklist to try by hand.
- New sim logic gets `npm test` coverage.
- A new building goes in `BUILDINGS`, gets a model, a panel if it has settings, a
  place in `ui/catalog.js`, a key if there's room, and a HUB milestone that unlocks it.
- Anything that changes the save bumps `SAVE_VERSION` and adds a step to `MIGRATIONS`.

## Phases

### Phase 11: Underground belts, splitters and sorters ✅ (done)
The logistics every layout needs: crossing one belt line with another, splitting a
line, and sorting mixed items. None of it needs power or the HUB, so it can come
before phases 9 and 10 if you want it sooner.

- **Underground belt** (a pair: an entrance and an exit facing the same way). Items
  go in, travel under up to 4 tiles of anything at belt speed, and come out. Place
  the entrance and the tiles where an exit can go light up the way it faces; tap one
  to place the exit. Removing either end gives back what's underground.
- **Splitter** (1×1). Items come in the back and go out front, left and right in
  turn. An exit with nothing attached, or no room, is skipped, so a splitter with
  two belts attached splits 50/50.
- **Sorter** (1×1). A splitter with a setting on each exit: *any*, one item, or
  *overflow* (gets what the other exits don't want or have no room for). An item
  no exit will take waits at the input, and the panel says so. It's set from its
  panel: three rows (left, front, right) that open an item picker. Small icons on
  the model show each exit's setting.
- Merging stays side-loading (belt into the side of a line). A separate merger only
  if that feels unfair in play.
- Stretch: dragging a belt line across another belt puts in an underground pair by
  itself.
- Sim notes: underground pairs link on placement. An entrance acts as one long belt
  (gap + 1 tiles), so `BELT_LEN` becomes a per-belt length. A splitter is a one-tile
  belt whose items pick their exit at the middle; `beltNetwork` gets a
  splitter mode. Items are drawn going round to the exit they picked, like a corner.
- Done as: `underground` is one building type with `end` "in"/"out"; each end is
  built on its own and pairs as it's built (`pair` holds the other's id; an exit
  needs an entrance up to 5 tiles behind it; an entrance pairs with a lone exit
  ahead). With the tool picked, tapping an entrance without an exit lights its tiles
  again. `beltNetwork` covers every conveyor: `len` per conveyor, `exits` per
  splitter, and a depth-first `order`. A splitter's item picks its way at the middle,
  counting the items already heading each way; one held up because its way filled
  picks again. Sorter filters are [front, left, right]; an item goes to the ways set to
  it, else "any", and when those are full or missing, "overflow". Logistics (milestone
  2) unlocks undergrounds and splitters, Assembly (3) sorters. Save format 6. The
  stretch goal (dragging a belt across a belt makes an underground pair) isn't done.
- [ ] A belt line crosses another through an underground pair, and neither line's items leak into the other.
- [ ] A splitter feeding three belts sends a third down each, and skips a belt that's full.
- [ ] A sorter set to iron ore on the left and overflow in front splits a mixed belt cleanly, and says when an item has nowhere to go.
- [ ] You can't place an exit out of range, and the valid tiles are obvious while placing.

### Phase 12: Select, copy, paste and mass remove ✅ (done)
A Select tool: drag a box (touch: press and hold, then drag, like belts), then
**Copy**, **Cut**, **Remove all** or **Rotate** the selection. Paste shows the whole
selection as a ghost that follows your finger, with the same two-tap touch placement
as a single building. It's green where it fits, red where it doesn't, and pays for
what it can. Settings come along (recipes, sorter filters). **Pick** (tap a building
with the Build tool open) picks the same building and facing. **Undo** covers the
last build, remove or paste.
- Done as: `sim/layout.js`. A layout is the box a group of buildings covers and a
  part per building: type, place, facing, and settings (underground end, assembler
  recipe, sorter filters); what they hold isn't copied. `planLayout` says for each
  part whether it'd be built or why not ("locked", "blocked", "unpaid"), paying in
  order, and the ghost uses it; `buildLayout` builds and reports what it skipped and
  what's missing. Underground exits go last, so their entrances are there to pair
  with. Select sits in the bottom bar (C); the selected buildings are tinted, and the
  tool bar gets a second row: Copy, Cut, Rotate, Remove (Ctrl+C, Ctrl+X, R, Delete).
  **Rotate on a selection turns it where it stands**: it's taken down and built again
  turned, so what it held goes to the inventory, and it's refused if a neighbour is in
  the way. While pasting, Rotate turns the ghost. Paste stays picked to paste again,
  and Select's Paste button (V) brings the clipboard back. Pick also works with Q under
  a mouse. Undo is a button next to Pause (Z, Ctrl+Z), 50 steps deep; undoing a removal
  builds it again, paid for, with its settings, and older steps follow the rebuilt
  buildings' new ids. Neither the clipboard nor the undo history is saved, so the save
  format didn't change. The bottom bar has seven buttons now, narrower on phones.
- [ ] Copying a furnace column with its inserters and pasting it next to the first builds a working copy.
- [ ] Removing a selection gives back everything in it, including what's on its belts.
- [ ] A paste that's partly blocked builds the parts that fit and says what was skipped.

### Phase 13: A bigger world ✅ (done)
The 128×128 map gets cramped once there are sub-factories. The map becomes **endless**,
split into 32×32 chunks that are generated from the seed when first seen and
rendered (ground texture, rocks) per chunk, so only what's on screen costs anything.
Only chunks you've changed go in the save. New terrain: **water** (lakes you can't
build on, needed by phase 16), ore patches further apart than before, and further
out, bigger and richer ore fields. Zooming far out turns into a **map view**: flat
colours, ore patches with what's left, buildings as blocks. The map view has a **fog
of war**, as in Factorio: it only shows charted land, which is what you've looked at
on the playfield and what a **radar** has scanned. The playfield always shows
everything, and you can build anywhere. A saved game from before loads with its old
map in the middle of the new one.
- Done as: `sim/chunks.js` keeps the chunks (ore or water per tile, what's left,
  the building on it) and the charted ones; `map.js` generates a chunk from the seed
  alone, so chunks come out the same in any order. The start is (0, 0). Four starting
  patches sit 30–40 tiles out, at least 15 tiles apart, with a lake 85–100 out. Beyond
  them each 96×96 square holds at most one patch (none within 90 tiles of the start),
  growing bigger and richer out to 800 tiles, and lakes come from noise beyond 70
  tiles. Chunks far from the camera that are untouched and empty are let go of. The
  map view starts past 64 tiles across (up to 512), draws charted chunks flat and
  leaves the fog as the background; a tap zooms in there. What's on screen on the
  playfield is charted (game.js), as are the 4×4 chunks round the start. The **Radar**
  (2×2, 120 kW, unlocked by Logistics, key 0) scans chunks nearest first out to 12
  chunks (384 tiles), 4 s each, skipping charted ones, and is done when its range is
  charted. The power overlay became a window that follows the camera. Save format 7:
  dug-into chunks and the charted list; a version 6 map is moved so its middle is the
  start, and all of it is charted.
- [ ] Panning a long way stays smooth, and an empty map loads as fast as before.
- [ ] Zooming all the way out shows the map view, you can tell where the ore is, and land you haven't seen is fog.
- [ ] A radar charts the land round it over time, and the map view shows it.
- [ ] A save with a big factory in one corner stays about as small as before.

### Phase 14: Performance pass ✅ (done)
Measure first: a benchmark (`?bench=big`) that builds a 3,000-building factory with
15,000 belt items headless and in the browser, reporting ms per tick and per frame.
Then fix what the numbers point at. Likely candidates:
- machines with nothing to do sleep until a neighbour changes, instead of being
  stepped every tick;
- belts with no items are skipped;
- the status and recipe icons are batched instead of one sprite each;
- only if the main thread is still over budget, the sim moves to a **Web Worker**
  and the renderer reads a per-frame snapshot.

The target is the one at the top of this plan, checked on a real phone.
- Done as: `sim/bench.js` builds the benchmark straight into a world: 48 modules (miners
  on painted ore, a furnace column, a line of gear assemblers, generators fed by coal
  miners, poles) on cleared ground make 3,120 buildings, and belt loops packed tight
  bring it to 6,288 belts carrying 15,000 items once they've filled. The chests at the
  belts' ends are emptied every tick, so it runs flat out. (A belt holds 4 items, so
  3,000 buildings and 15,000 items only fit with the belts on top.) `npm run bench` runs
  it headless and reports ms a tick, and the tick after building something;
  `/play?bench=big` (or `small`) plays it in the browser, never saved, with the debug
  readout on. That readout now always has draw calls, ms a tick and ms a frame.
  Measured on a laptop with an Intel UHD 620: a tick went from 2.9 to 0.75 ms (headless),
  and drawing a frame from 22–37 ms (23–41 fps) to 2–3 ms at 60 fps, 3–5 ms zoomed right
  out. The sim: step() goes through the machines only, with each one's neighbours worked
  out once per layout (`world.machines`); power keeps each consumer's draw and the loose
  generators instead of looking through every building each tick; the belt network has
  each conveyor's length and way out in one list (`steps`). The view draws only what's
  on screen (`render/visible.js` keeps the buildings by chunk): buildings, belt items,
  moving parts and icons. Instanced meshes send the GPU only the part in use and are
  hidden when empty (three binds a mesh's shaders even to draw nothing), and the status
  and recipe icons are one instanced draw from an atlas (`render/billboards.js`). Building
  in a big factory worked out every network again, about 40 ms; the belt and power
  networks now have their own counters (`world.beltVersion`, `powerVersion`), so a belt
  doesn't redo power nor a pole the belts, and each takes about 7 ms at this size. All of
  it is worked out from the layout, not saved, and the sim does exactly what it did
  before, tick for tick (checked against the old code on the benchmark and on random
  factories), so the save format didn't change. Machines don't sleep: an idle one is a
  few checks now, and the numbers didn't point at them. Nor was a Web Worker needed.
- [ ] The benchmark factory runs at 60 UPS on a mid-range phone.
- [ ] A loaded save still runs tick-for-tick like the saved one.

### Phase 15: Production statistics ✅ (done)
You can't balance what you can't see. A **Stats** panel lists each item's production
and consumption per minute over the last minute, 10 minutes and hour, with a small
graph each. A machine's panel shows how busy it has been (working % over the last
minute) and what held it up (no input, full, no power). A line that's starved or
backed up is then easy to find. The counters live in the sim and are saved, so
graphs survive a reload.
- Done as: `sim/stats.js`. Made is what miners dig, furnaces smelt, assemblers make
  and the player mines or crafts by hand; used is a furnace's ore and the fuel it
  lights, what assemblers and hand-crafts make things from, the coal generators burn
  and what the HUB is given (by belt, inserter or its panel: `deliverToHub`). Moving
  items between buildings is neither. Ingredients count when a craft is done, not when
  it starts, since one called off gives them back. `world.stats` counts the second
  under way, then puts it in three rings of 60 buckets per item (1 s, 10 s and 1 min,
  so the last minute, 10 minutes and hour), each coarser one added up from the finer;
  where each ring is up to follows from the clock. Rates are over the time counted,
  so a young game isn't spread over an hour it hasn't had. Miners, furnaces and
  assemblers count the ticks they spend in each status over the last minute (a tick
  waiting for power on a network that's short counts as no power, though the status
  still says working), counted only when the status changes so a tick costs one
  comparison; that isn't saved, since it fills again in a minute. Every machine now
  gets all its fields when it's built (`starved`, `activity`), which kept the
  benchmark within about 6% of what it was. The Stats button sits between the clock
  and Undo (G), and opens a panel with 1 min / 10 min / 1 hour, a row per item made or
  used (made and used a minute) and a graph of both. Save format 8; an older save
  starts counting when it's loaded.
- [ ] Building a second furnace column shows plate production double in Stats within a minute.
- [ ] A starved assembler's panel shows it idle most of the time, and why.

### Phase 16: Fluids and steam power
The first fluid chain. An **offshore pump** on the shore pumps water, which goes
through **pipes** (joining their neighbours by themselves, like belts) and
**underground pipes** to **boilers** that burn coal and turn it into steam for
**steam engines**. That becomes the main power source, with phase 9's coal generator
as the early one. A **storage tank** buffers any fluid.
Fluid model: each connected run of pipes is one pool with a total amount and
capacity (as in Factorio 2.0). Flow within it is instant, limited only by pumps and
by what machines draw. That's cheap to simulate and easy to show in a panel. Pipes
carrying different fluids can't be joined, and placing one that would join them is
refused with a reason.
- [ ] Pump → pipes → boiler → steam engine powers the factory once the coal generators are removed.
- [ ] Tapping a pipe shows what's in its run, how full it is, and what's drawing from it.
- [ ] A pipe that would mix water and steam can't be placed, and says why.

### Phase 17: Steel, oil and plastic
The second production tier and the next HUB milestones:
- **Steel**: furnaces smelt 5 iron plates into 1 steel plate.
- **Oil**: oil wells are spots on the map, not patches. A **pumpjack** on one pumps
  crude oil and slows as the well runs down, but never below a minimum.
- **Refinery** (crude oil → petroleum gas).
- **Chemical plant** (gas + coal → plastic).
- **Advanced circuits** in assemblers (circuits + plastic + cable).
- A faster **assembler Mk2** and an **electric miner**.

Assemblers and chemical plants take fluid ingredients through pipes, and an
assembler with a fluid recipe shows its pipe connections.
- [ ] A fully automated line from oil well to advanced circuits runs unattended.
- [ ] A drained well keeps producing at its minimum rate.
- [ ] The HUB's tier 3 milestone asks for advanced circuits, and a new player can see how to get there.

### Phase 18: Sound and feel
Sounds made in code with Web Audio, so there are no files to download:
- clicks for the UI, a thunk for placing, a crunch for removing;
- a ping when a craft finishes, a fanfare for a milestone;
- a quiet hum that grows with the working machines on screen.

Volume and haptics settings in the pause menu. Small touches: buildings pop in when
placed, and a short puff when removed.
- [ ] Building, removing and crafting all sound right, and nothing is annoying after 10 minutes.
- [ ] Sound can be turned off in one tap, and stays off.

### Phase 19: Onboarding and saves
- **Tutorial**: an optional guided first game (mine by hand, smelt, place a miner,
  belts, inserters, an assembler), each step checked against the sim, with an arrow
  at what to tap. After that, **hints** show up when something has been stuck a
  while (e.g. a furnace out of fuel for 30 s: "Furnaces burn coal…").
- **Saves**: three save slots, and export/import of a save as a file for backups or
  moving between devices.
- [ ] Someone who has never played gets to automated plates with the tutorial and no help.
- [ ] Exporting a save on the phone and importing it on a computer continues the same game.

### Phase 20: Blueprints and planned buildings
Save a selection as a named **blueprint**. Blueprints are kept in the browser apart
from the save, so they carry over to new games, and they can be exported and imported
as a text string for sharing. Pasting what you can't afford yet leaves **planned
buildings**: faint ghosts that build themselves from your inventory as soon as you
can pay, nearest first. The resource bar shows what the plans still need.
- [ ] A blueprint made in one game can be pasted in a new one.
- [ ] Exporting a blueprint and importing the text elsewhere gives the same layout.
- [ ] Planned buildings get built by themselves as items come in, and can be removed like buildings.

### Phase 21: Faster belts and inserters
A second tier to grow into: **Mk2 belts** (3.75 tiles/s, 15 items/s, double the
speed with the same item gap), underground belts and splitters to match, and a **fast
inserter** (2.4 items/s, needs power). Building a faster belt over a slower one
**upgrades it in place**: facing and items are kept, and the old one is refunded.
Dragging a line of Mk2 belts over a Mk1 line upgrades the lot. Unlocked by a HUB milestone.
- [ ] Upgrading a busy belt line doesn't drop or move any items.
- [ ] A Mk2 line fed by two full Mk1 lines carries both.
- [ ] Tiers are told apart at a glance (arrow colour), in both themes.

## Order and dependencies

| Phase | Needs | Why this order |
|---|---|---|
| 11 Underground, splitters, sorters | MVP phase 8 | The first thing bigger layouts need; independent of power and the HUB |
| 12 Copy, paste, remove | 11 | Should copy splitter and sorter settings from day one |
| 13 Bigger world | — | Water and far ore are needed by 16 and 17 |
| 14 Performance | 13 | Measured on the big map, before fluids and oil add load |
| 15 Stats | — | Anywhere; most useful once factories are big |
| 16 Fluids, steam | 13 (water), 9 (power) | |
| 17 Steel, oil, plastic | 16 | Oil is a fluid |
| 18 Sound, 19 Onboarding | — | Near the end, when what they describe has settled |
| 20 Blueprints, planned buildings | 12 | Built on the selection and paste code; moved late, since copy and paste cover most of it |
| 21 Faster belts and inserters | 11, 9 (power) | Upgrading in place reuses paste's "build over"; moved late |

## Open questions

- ~~**Map size**: a fixed 512×512, or endless chunks?~~ Endless (phase 13). Saves
  stay small since only dug-into chunks are kept, and the map view shows what's
  charted, so it has no bounds to find.
- **Planned buildings**: should they build themselves from the inventory (as
  planned), or wait for a tap?
- **Merger**: is side-loading enough, or do players expect a merger building?

## Later (plan 3 candidates)

Trains (they need the bigger map first), drones or bots for deliveries, a
Space-Elevator-style end goal, enemies as an optional mode, and multiplayer.
