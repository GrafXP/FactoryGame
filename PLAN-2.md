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
  one at a time on a phone is the bottleneck, so copy, paste and blueprints come early.
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

### Phase 12: Select, copy, paste and mass remove
A Select tool: drag a box (touch: press and hold, then drag, like belts), then
**Copy**, **Cut**, **Remove all** or **Rotate** the selection. Paste shows the whole
selection as a ghost that follows your finger, with the same two-tap touch placement
as a single building. It's green where it fits, red where it doesn't, and pays for
what it can. Settings come along (recipes, sorter filters). **Pick** (tap a building
with the Build tool open) picks the same building and facing. **Undo** covers the
last build, remove or paste.
- [ ] Copying a furnace column with its inserters and pasting it next to the first builds a working copy.
- [ ] Removing a selection gives back everything in it, including what's on its belts.
- [ ] A paste that's partly blocked builds the parts that fit and says what was skipped.

### Phase 13: Blueprints and planned buildings
Save a selection as a named **blueprint**. Blueprints are kept in the browser apart
from the save, so they carry over to new games, and they can be exported and imported
as a text string for sharing. Pasting what you can't afford yet leaves **planned
buildings**: faint ghosts that build themselves from your inventory as soon as you
can pay, nearest first. The resource bar shows what the plans still need.
- [ ] A blueprint made in one game can be pasted in a new one.
- [ ] Exporting a blueprint and importing the text elsewhere gives the same layout.
- [ ] Planned buildings get built by themselves as items come in, and can be removed like buildings.

### Phase 14: Faster belts and inserters
A second tier to grow into: **Mk2 belts** (3.75 tiles/s, 15 items/s, double the
speed with the same item gap), underground belts and splitters to match, and a **fast
inserter** (2.4 items/s, needs power). Building a faster belt over a slower one
**upgrades it in place**: facing and items are kept, and the old one is refunded.
Dragging a line of Mk2 belts over a Mk1 line upgrades the lot. Unlocked by a HUB milestone.
- [ ] Upgrading a busy belt line doesn't drop or move any items.
- [ ] A Mk2 line fed by two full Mk1 lines carries both.
- [ ] Tiers are told apart at a glance (arrow colour), in both themes.

### Phase 15: A bigger world
The 128×128 map gets cramped once there are sub-factories. It grows to **512×512**,
split into 32×32 chunks that are generated from the seed when first seen and
rendered (ground texture, rocks) per chunk, so only what's on screen costs anything.
Only chunks you've changed go in the save. New terrain: **water** (lakes you can't
build on, needed by phase 18) and further, richer ore fields. Zooming far out turns
into a **map view**: flat colours, ore patches with what's left, buildings as blocks.
A saved game from before loads as a 128×128 corner of the new map.
- [ ] Panning across the whole map stays smooth, and an empty map loads as fast as today.
- [ ] Zooming all the way out shows the map view, and you can tell where the ore is.
- [ ] A save with a big factory in one corner stays about as small as today's.

### Phase 16: Performance pass
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
- [ ] The benchmark factory runs at 60 UPS on a mid-range phone.
- [ ] A loaded save still runs tick-for-tick like the saved one (sleeping machines wake the same way).

### Phase 17: Production statistics
You can't balance what you can't see. A **Stats** panel lists each item's production
and consumption per minute over the last minute, 10 minutes and hour, with a small
graph each. A machine's panel shows how busy it has been (working % over the last
minute) and what held it up (no input, full, no power). A line that's starved or
backed up is then easy to find. The counters live in the sim and are saved, so
graphs survive a reload.
- [ ] Building a second furnace column shows plate production double in Stats within a minute.
- [ ] A starved assembler's panel shows it idle most of the time, and why.

### Phase 18: Fluids and steam power
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

### Phase 19: Steel, oil and plastic
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

### Phase 20: Sound and feel
Sounds made in code with Web Audio, so there are no files to download:
- clicks for the UI, a thunk for placing, a crunch for removing;
- a ping when a craft finishes, a fanfare for a milestone;
- a quiet hum that grows with the working machines on screen.

Volume and haptics settings in the pause menu. Small touches: buildings pop in when
placed, and a short puff when removed.
- [ ] Building, removing and crafting all sound right, and nothing is annoying after 10 minutes.
- [ ] Sound can be turned off in one tap, and stays off.

### Phase 21: Onboarding and saves
- **Tutorial**: an optional guided first game (mine by hand, smelt, place a miner,
  belts, inserters, an assembler), each step checked against the sim, with an arrow
  at what to tap. After that, **hints** show up when something has been stuck a
  while (e.g. a furnace out of fuel for 30 s: "Furnaces burn coal…").
- **Saves**: three save slots, and export/import of a save as a file for backups or
  moving between devices.
- [ ] Someone who has never played gets to automated plates with the tutorial and no help.
- [ ] Exporting a save on the phone and importing it on a computer continues the same game.

## Order and dependencies

| Phase | Needs | Why this order |
|---|---|---|
| 11 Underground, splitters, sorters | MVP phase 8 | The first thing bigger layouts need; independent of power and the HUB |
| 12 Copy, paste, remove | 11 | Should copy splitter and sorter settings from day one |
| 13 Blueprints, planned buildings | 12 | Built on the selection and paste code |
| 14 Faster belts and inserters | 11, 9 (power) | Upgrading in place reuses paste's "build over" |
| 15 Bigger world | — | Water and far ore are needed by 18 and 19 |
| 16 Performance | 15 | Measured on the big map, before fluids and oil add load |
| 17 Stats | — | Anywhere; most useful once factories are big |
| 18 Fluids, steam | 15 (water), 9 (power) | |
| 19 Steel, oil, plastic | 18 | Oil is a fluid |
| 20 Sound, 21 Onboarding | — | Last, when what they describe has settled |

## Open questions

- **Map size**: a fixed 512×512, or endless chunks? Endless is the same code with
  no edge. The catch is saves that grow without limit and a map view that has to
  find its bounds. The plan assumes fixed, since it's simpler to test.
- **Planned buildings**: should they build themselves from the inventory (as
  planned), or wait for a tap?
- **Merger**: is side-loading enough, or do players expect a merger building?

## Later (plan 3 candidates)

Trains (they need the bigger map first), drones or bots for deliveries, a
Space-Elevator-style end goal, enemies as an optional mode, and multiplayer.
