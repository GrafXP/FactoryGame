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
  sim/            world state and tick logic (headless, tested)
  render/         three.js scene, camera, meshes, input controls
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
show how many of each building you can afford. Costs are raw ore for now, since
plates and gears don't exist yet; move them over in phases 7 and 8.
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

### Phase 6: Save and load
Autosave to IndexedDB every 30 s, when leaving the page and when the app is
hidden. A versioned save format, plus New game / Continue on the home page.
- [ ] Build something, close the tab, reopen it: everything is exactly where it was, items mid-belt included.
- [ ] New game asks for confirmation and starts a fresh map.
- [ ] Loading a save from an older version either migrates or fails with a clear message.

### Phase 7: Inserters and furnaces
Inserters move items between belts, chests and machines. Furnaces smelt ore into
plates (they burn coal as fuel).
- [ ] Ore belt → inserter → furnace → inserter → belt → chest ends with plates in the chest.
- [ ] A furnace without coal stops and shows a "no fuel" icon.
- [ ] Inserters visibly swing, and only pick up items the target can accept.

### Phase 8: Assemblers and recipes
Assemblers with a recipe picker. The first recipe chain: gear, copper cable,
circuit. Hand-crafting the same recipes from the inventory.
- [ ] Set an assembler to gears, feed it iron plates, and gears come out.
- [ ] A fully automated circuit line (iron + copper → cable + plates → circuits) runs unattended.
- [ ] Hand-crafting a gear from plates works from the inventory panel.

### Phase 9: Power
Coal generators, power poles with a connection range, and consumers that slow
down when there's too little power. Miners, inserters and assemblers switch to electric.
- [ ] Unpowered machines show a "no power" icon and don't run.
- [ ] Poles show their range while you place them, and wires connect automatically.
- [ ] When demand is higher than supply, everything slows evenly and the power panel shows why.

### Phase 10: Progression (MVP complete)
A Satisfactory-style HUB: deliver batches of items to reach milestones that unlock
buildings and recipes. There's a starting goal and a "you've automated circuits" end state.
- [ ] A new game only has basic buildings, and the first milestone is obvious.
- [ ] Delivering the required items unlocks the next buildings, with a clear notification.
- [ ] A new player can get from an empty map to automated circuits without reading the code.

## After the MVP (not planned yet)
Two-lane belts and splitters, underground belts, blueprints and copy-paste, fluids
and pipes, trains, research labs, enemies/combat, a larger or infinite chunked map,
sound, and a tutorial.
