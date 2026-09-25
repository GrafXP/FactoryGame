# Factory: MVP plan

A factory-building game in the spirit of Factorio / Satisfactory, played in the
browser and on a phone. Same stack as `game-test`: Vite + vanilla JS + three.js,
SPA routes, light/dark theme, fullscreen PWA.

## Core decisions

- **Factorio-style mechanics, drawn in 3D.** The world is a 2D tile grid (buildings
  snap to tiles, belts run in 4 directions). three.js renders it with an angled
  orthographic camera. Satisfactory-style free 3D building with a walking player
  would be far bigger than an MVP and hard to control on a touchscreen.
- **The simulation is separate from rendering.** `src/sim/` is plain JS data and logic
  with no three.js and no DOM. It runs at a fixed 60 ticks/s (`src/game.js`), whatever
  the display frame rate. Because of this split, saving is just serialising the world
  and the sim can be tested headless with `npm test` (Node's built-in runner, no extra deps).
- **The renderer only reads.** `src/render/` reads the world each frame and never
  changes it. Buildings and belt items use `InstancedMesh` so thousands of them stay cheap.
- **Touch first, keyboard/mouse too.** Every action must work with one thumb:
  drag to pan, pinch to zoom, tap to select, a toolbar to build. Mouse and keys are
  shortcuts on top of that.
- **Performance target:** 60 UPS / 60 FPS on a mid-range phone with ~1,000 buildings
  and ~5,000 items on belts.

## Layout

```
src/
  main.js         routes and pages (home, play, help), HUD wiring
  game.js         owns world + view, fixed-timestep loop
  build.js        build mode: tool, rotation, ghosts, taps/drags → sim calls
  storage.js      the saved game in IndexedDB
  sim/            world state and tick logic (headless, tested)
  render/         three.js scene, camera, meshes, input controls
  ui/             the game page's DOM UI: build menu, resource bar, building panels, icons
  theme.js, fullscreen.js, style.css   copied from game-test
test/             node:test specs for sim/
```

## Phases

Every phase ends with a build you can run on the phone (`npm run dev -- --host`)
and a short checklist to try by hand. Sim logic also gets `npm test` coverage as it grows.

### Phase 0: Skeleton ✅ (done)
App shell, empty 64×64 grid, fixed tick loop, pause, theme, fullscreen.
- [ ] `/play` shows a grid with a spinning green cube in the middle.
- [ ] The HUD clock counts up in seconds. Pause (button, P or Esc) stops it and the cube.
- [ ] Switching apps pauses the game. ☀/☾ switches theme and the scene recolours.
- [ ] `npm test` passes.

### Phase 1: Map and camera ✅ (done)
Seeded procedural terrain with ore patches (iron, copper, coal, stone). Camera
panning, zooming and bounds. Debug overlay showing FPS/UPS and the tile under your finger.
The map grew to 128×128 so there's room for more than a starter base; one patch of
each ore is guaranteed within ~20 tiles of the centre.
- [ ] Drag with one finger or the mouse to pan. Pinch or the scroll wheel zooms. You can't lose the map.
- [ ] Ore patches are easy to tell apart in both themes.
- [ ] Tapping a tile shows its coordinates and resource.
- [ ] `?seed=42` gives the same map every reload. A different seed gives a different map.

### Phase 2: Build mode ✅ (done)
Build toolbar, a ghost preview that follows your finger, rotate, place, and a
remove mode. Buildings have footprints (1×1 belt, 2×2 miner, 1×1 chest) and can't
overlap. They don't do anything yet.
Touch: a quick drag always pans, so belt lines start with a press-and-hold (a short
buzz) and then a drag. Mouse: left-drag lays belts, right/middle-drag pans.
A finger hides the ghost, so touch builds in two taps: the first shows the ghost,
a tap on the ghost builds it. Remove works the same way (tap to mark, tap again
to remove). With a mouse the ghost follows the cursor and one click does it.
- [ ] Pick a building, see a green ghost (red where it isn't allowed), tap to place.
- [ ] The rotate button (or R) turns the ghost, and placed buildings keep their facing.
- [ ] Remove mode deletes a tapped building.
- [ ] Dragging a belt lays a straight line of belts.
- [ ] Panning while in build mode still works and doesn't place anything by accident.

### Phase 3: Items and inventory ✅ (done)
Item types, a player inventory panel, and hand-mining (hold on an ore tile).
Buildings cost items, and you start with a small kit.
With no tool picked, press and hold on ore to mine it (one item every half second,
and the tile runs out). The bag button (or I) opens the inventory, and toolbar badges
show how many of each building you can afford. Costs moved to plates in phase 7
(furnaces cost stone, so a new player can always smelt); gears come in phase 8.
- [ ] Holding on iron ore adds iron ore to the inventory at a steady rate.
- [ ] Placing a building takes its cost out of the inventory. With too few items you can't place it and you're told why.
- [ ] Removing a building gives its items back.

### Phase 4: Miners and chests ✅ (done)
Miners placed on ore produce an item every N ticks into whatever sits on their
output tile. Chests store items. Tap a chest to see its contents and take them.
A miner digs the ore under its 2×2 footprint once a second and only while its
output has room, so a stopped miner loses nothing. The output tile is in front of
the chute (the yellow block on the miner's front). Chests hold 50 items. Tap a
miner or chest with no tool picked for its panel; removing a chest also gives back
what's in it.
- [ ] A miner on iron with a chest in front fills the chest over time.
- [ ] A miner not on ore shows a "no resource" icon and does nothing.
- [ ] When the chest is full the miner stops and shows a "blocked" icon.
- [ ] Taking items from a chest moves them into the inventory.

### Phase 5: Belts ✅ (done)
Belt transport, which is the heart of the game. Items move smoothly along belts, go
round corners, and back up when blocked. Miners output onto belts and belts feed into chests.
Single-lane belts for the MVP.
Belts run at 1.875 tiles/s and carry at most 7.5 items/s (items at least a quarter
tile apart); positions are whole numbers so the sim stays exact. A belt fed only from
one side is a corner; a belt running into the side of a line drops its items onto
that line's middle when there's a gap. Belts facing each other head-on don't connect.
How belts connect is worked out from the layout and cached (`beltNetwork`), and it
isn't saved. The sim handles ~5,000 belt items in well under 1 ms per tick.
- [ ] Miner → a winding belt → chest: ore visibly travels and ends up in the chest.
- [ ] Removing the chest makes items stop and bunch up at the belt's end without overlapping.
- [ ] Two belts merging into one works and the throughput is capped.
- [ ] Still 60 FPS with ~2,000 items on belts (check the debug overlay).

### Phase 6: Save and load ✅ (done)
Autosave to IndexedDB every 30 s, when leaving the page and when the app is
hidden. A versioned save format, plus New game / Continue on the home page.
`sim/save.js` turns a world into plain data (the map's typed arrays go into IndexedDB
as they are) and back, checking everything on the way in. Derived state (tile grid,
belt network) is rebuilt on load, and buildings keep their order so a loaded world
runs tick-for-tick like the saved one. Bump `SAVE_VERSION` and add a step to
`MIGRATIONS` whenever the format changes (phase 7's plate costs, for one). There's one
save slot. /play continues it; New game asks first and saves straight away, and
`?seed=` with a save asks which to play. Pause has Save and quit; *Saved* flashes
under the clock.
- [ ] Build something, close the tab, reopen it: everything is exactly where it was, items mid-belt included.
- [ ] New game asks for confirmation and starts a fresh map.
- [ ] Loading a save from an older version either migrates or fails with a clear message.

### Phase 7: Inserters and furnaces ✅ (done)
Inserters move items between belts, chests and machines. Furnaces smelt ore into
plates (they burn coal as fuel).
A furnace (2×2, costs 10 stone) works out its recipe from the ore it's given
(`sim/recipes.js`): iron or copper ore → a plate a second, 2 stone → a brick in 2 s.
One coal burns for 8 plates. It has input, fuel and output slots; the player can
fill them up to 50 from the furnace's panel and take the output, but belts, miners
and inserters only top the input and fuel up to 5. An inserter (1×1) takes one
item from the building behind it and drops it in front, taking 24 ticks each way
(1.2 items/s). It only picks up what the target can take right now, so one inserter
feeds a furnace ore and coal off a mixed belt, and it only takes a furnace's output.
Inserters run without power until phase 9. Building costs are now plates, and the
start kit is plates, stone and some coal. The save format went to version 2 (old
saves load unchanged). Loose items are drawn by shape (rocks, plates, bricks), and
the toolbar scrolls on narrow phones with Rotate pinned at the end.
- [ ] Ore belt → inserter → furnace → inserter → belt → chest ends with plates in the chest.
- [ ] A furnace without coal stops and shows a "no fuel" icon.
- [ ] Inserters visibly swing, and only pick up items the target can accept.

### Interface redesign ✅ (done, between phases 7 and 8)
The flat toolbar couldn't hold many more buildings, and you couldn't see what you
carried without opening the bag. Now the top bar has Back, the clock and Pause, and
under it the resource bar shows an icon and a count for every item you carry (counts
flash when they change; tap it for the inventory). The bottom bar has Build, four
quick slots and Remove. Build opens a sheet with a tab per category (`ui/catalog.js`,
where every new building must be listed) and a card per building: what it's for, its
cost, how many you can afford. A building picked there takes over the quick slot
used longest ago (kept in localStorage). While a tool is picked, a bar above shows
its cost (short items in red), Rotate and Done. Theme, fullscreen and debug info
(now off by default) moved into the pause menu. Items have icons in their belt
shape and colour (rock, plate, brick; `ITEMS[id].shape`).
- [ ] You can always see what you carry, and a count changing is noticeable.
- [ ] Any building is at most two taps away, and the bar at the bottom fits a small phone.
- [ ] You can tell what a building costs, and what you're missing, before placing it.

### Phase 8: Assemblers and recipes ✅ (done)
Assemblers with a recipe picker. The first recipe chain: gear, copper cable,
circuit. Hand-crafting the same recipes from the inventory.
Recipes live in `sim/recipes.js` (RECIPES, keyed by the item they make): a gear
is 2 iron plates in 2 s, 2 copper cables 1 copper plate in 1 s, a circuit 1 iron
plate + 3 cables in 2.5 s. Those rates let one inserter (1.2 items/s) keep each
input fed, so copper → cable assembler → inserter → circuit assembler makes a
circuit every 2.5 s. An assembler (3×3) is set from its panel, which is a recipe
picker until it has one; changing the recipe gives back what it holds. Machines
fill each ingredient to two crafts' worth, the player up to 50. A cog on top turns
once per craft, and an icon on the roof's corner shows the recipe (a "?" until it
has one). Hand-crafting (`sim/crafting.js`) is a queue in the inventory panel, twice
as fast as an assembler; asking for something crafts its missing parts first, a
craft takes its ingredients when it starts, and cancelling the one under way gives
them back. The queue is saved (save format 3). Picking a building you can't afford
but could craft the parts of shows a Craft button next to Done. Miners and
inserters now cost gears (inserters a circuit too); the start kit has some gears
and circuits.
- [ ] Set an assembler to gears, feed it iron plates, and gears come out.
- [ ] A fully automated circuit line (iron + copper → cable + plates → circuits) runs unattended.
- [ ] Hand-crafting a gear from plates works from the inventory panel.

### Phase 9: Power ✅ (done)
Coal generators, power poles with a connection range, and consumers that slow
down when there's too little power. Miners, inserters and assemblers switch to electric.
Power is whole joules per tick (60 J/tick = 1 kW; `sim/power.js`). A coal generator
(3×2, `sim/generator.js`) makes up to 600 kW and burns only what's drawn: a coal
(4 MJ, `FUEL_ENERGY`) lasts 6.7 s at full power. It takes coal like a furnace, so an
inserter or a miner on coal can feed it. A pole joins every pole within 7 tiles
(wires drawn as the fewest that join them, shortest first) and powers buildings within
3 tiles; joined poles are one network, worked out from the layout and cached like
`beltNetwork`. Miners draw 90 kW, assemblers 75 kW and inserters 15 kW, only while
they work. Each has a store of two ticks' energy that the network tops up each tick;
when the generators can't make it all, every machine gets the same share, so they all
slow evenly (status stays "working"; an amber bolt and the panels say why). With none
they show "no-power". Placing anything electric tints the ground the poles power, and
a pole ghost shows its area and the wires it'll get. Tap a pole or generator for its
network: what it makes, what it uses, and how well it keeps up. The start kit covers a
generator and some poles. Save format 4: old saves load with their machines stopped
and the parts for a generator and ten poles in the inventory. Machine tests that
aren't about power keep stores full with `test/helpers.js`'s `charge`.
- [ ] Unpowered machines show a "no power" icon and don't run.
- [ ] Poles show their range while you place them, and wires connect automatically.
- [ ] When demand is higher than supply, everything slows evenly and the power panel shows why.

### Phase 10: Progression (MVP complete)
A Satisfactory-style HUB: deliver batches of items to reach milestones that unlock
buildings and recipes. There's a starting goal and a "you've automated circuits" end state.
- [ ] A new game only has basic buildings, and the first milestone is obvious.
- [ ] Delivering the required items unlocks the next buildings, with a clear notification.
- [ ] A new player can get from an empty map to automated circuits without reading the code.

## After the MVP
Planned in [PLAN-2.md](PLAN-2.md): underground belts, splitters and sorters first,
then copy-paste and blueprints, faster belts, a bigger map, performance, stats,
fluids and oil, sound and a tutorial.
