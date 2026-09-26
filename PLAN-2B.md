# Factory: plan 2B (enemies, defense, then research)

A plan that goes in between: after phase 15 of [PLAN-2.md](PLAN-2.md), before its
fluids. It gives the factory something to fight: enemies that live out on the map
and attack when pollution reaches them, and the turrets, walls and ammunition that
keep them off. Ammunition is a production line like any other, and feeding the
turrets becomes one of the factory's jobs. Once defense works, science packs and
labs arrive, and research takes over from the HUB as the way new things unlock.

Phases carry on the numbering (16 onwards); plan 2's fluids and everything after
them move up to 22 onwards. PLAN.md's core decisions still hold, and so do plan 2's,
apart from the two this plan changes: it isn't peaceful any more, and research
comes after the HUB.

## Core decisions for this plan

- **There's no player character, so enemies attack the factory.** Nothing on the map
  stands for the player: enemies go for buildings, and defense is automatic.
  Turrets shoot on their own, fed with ammunition by inserters and belts like any
  other building, and walls take the hits. This is the one-thumb version of defense:
  the player builds and supplies it, and doesn't have to aim.
- **Pollution starts attacks (as in Factorio).** Machines give off pollution, which
  spreads from chunk to chunk and soaks into the ground. When it reaches a nest, the
  nest turns what it takes in into attack groups. A small, clean factory is left
  alone, and a big one near nests gets attacked more. There are no timed waves.
- **Enemies live in nests on the endless map.** Nests are generated from the seed
  with the chunks, like ore. There are none near the start (a safe zone), and they
  get closer together and stronger further out. They show on the map view once
  charted, so a radar is also an early warning.
- **Losing buildings is a setback, never game over.** A destroyed building leaves a
  **ruin** that remembers what stood there, facing and settings included. Its
  contents are lost, but it's rebuilt with a tap, or all at once. Progress lives in
  the world, not in the HUB (as it already does), so losing the HUB only means
  building it again.
- **Enemies are simulated in whole numbers, with positions in 1/256 of a tile**, like
  the belts. The sim stays exact and deterministic, and a loaded save carries on tick
  for tick. Random choices use the seeded RNG (`sim/rng.js`).
- **Peaceful mode is a setting, not another game.** New games ask **Enemies: on /
  peaceful**. With peaceful, nests only fight back when they're attacked. Saves from
  before this plan load as peaceful, and the pause menu can turn enemies on for them.
- **The HUB stays for the opening, and research follows it.** Defense unlocks through
  HUB milestones (phases 18–19). Then the last milestone unlocks **labs**, and
  everything new after that, in this plan and in plan 2's later phases, is
  researched with science packs. Every building and recipe is still unlocked by
  exactly one milestone or technology, and that stays tested.
- **Performance target, added to plan 2's:** 60 UPS on a mid-range phone with ~300
  enemies moving and ~150 turrets shooting, on top of the 3,000-building factory. Far
  from the factory, nests only keep a pollution count and don't step units.

## How each phase works (same as before)

- It ends with a build you can run on the phone and a short checklist to try by hand.
- New sim logic gets `npm test` coverage.
- A new building goes in `BUILDINGS`, gets a model, a panel if it has settings, a
  place in `ui/catalog.js`, a key if there's room, and a milestone or technology that
  unlocks it.
- Anything that changes the save bumps `SAVE_VERSION` and adds a step to `MIGRATIONS`.

## Phases

### Phase 16: Pollution ✅ (done)
Pollution first, harmless for now, so the next phase's trigger can be seen and tuned
before anything attacks.
- Each chunk holds a pollution amount. Every second, machines add to their chunk
  while they work: miners, furnaces and generators a lot, assemblers a little, belts,
  inserters and poles nothing. A chunk passes a share of what it holds to its four
  neighbours and loses some to the ground; a lake absorbs more. So a factory has a
  cloud round it that grows with it and levels off.
- The map view gets a **pollution overlay**: a red tint over polluted chunks, and a
  switch to turn it on and off. The Stats panel gets a Pollution row (made and
  absorbed a minute), and machines' panels say how much they give off.
- Only chunks with pollution are stepped, so an empty map costs nothing. Pollution is
  saved per chunk, only where there is some.
- Sim notes: `sim/pollution.js`, stepped once a second like `rollStats`; pollution
  lives next to each chunk's ore. Emission is a number per building type in
  `BUILDINGS` (`pollution`), and uses the machine's activity, so an idle machine is
  clean.
- Done as: `sim/pollution.js`. Amounts are whole numbers in 1/3600 of a unit, so a
  machine giving off P units a minute adds P for every tick it works (status working
  and not waiting for power), and the sim stays exact whatever order chunks are gone
  through in. Miners give off 15 a minute, furnaces 9, assemblers 3; a coal generator
  45 at full power, given off as it lights each coal, since it only burns what's
  drawn. Once a second (before the stats roll), each polluted chunk loses what the
  ground takes in (1 a tile a second, water 5) and then passes 1% of the rest to each
  neighbour, if it holds at least a unit; shares are worked out before any moves.
  Tuned so a furnace column (~220 a minute) levels off 2–3 chunks out within a few
  minutes, and a factory making ~1,650 a minute reaches 5–6 chunks (160+ tiles,
  where nests start) after ~20 minutes (emissions raised by half after trying it). `world.polluted` holds the chunks with any;
  polluted chunks aren't forgotten. Pollution is a non-item key in the stats
  (`POLLUTION`, a Float64Array series): made is what's given off, used what's taken
  in. The map view's overlay (`render/pollution.js`) is one plane with a texel per
  chunk, smoothed, repainted once a second, and skipped while off; its switch sits
  above the build bar in the map view, on by default, remembered per device.
  Machines' panels say what they give off (lately, and while working), Stats has a
  Pollution row and how much is in the air, and the debug readout shows the tile's
  chunk. Save format 9; an older save starts with clean air. The benchmark tick is
  within ~2% of what it was.
- [ ] A furnace column's cloud grows for a few minutes, then stops growing.
- [ ] Turning the machines off lets the cloud fade.
- [ ] The overlay reads clearly in both themes, and costs nothing when it's off.

### Phase 17: Enemies and nests ✅ (done)
The enemies, what they attack, and what's left when they win. There's no defense yet,
so until phase 18 new games default to peaceful, and this phase is tried with enemies on.
- **Health.** Every building gets `health` (in `BUILDINGS`). A damaged building shows
  a small health bar, and repairs itself slowly once it hasn't been hit for 10 s. At
  0 it's destroyed: it and what it holds are gone, and a **ruin** marks the spot.
  Tapping a ruin rebuilds it, and an alert has **Rebuild all** (N). Both pay from the
  inventory and are built with `sim/layout.js`, like a paste, so settings come back.
- **Nests** (3×3) sit in bases of 2–6, generated per 96×96 region like far ore
  patches: none within 160 tiles of the start, and more and bigger bases further
  out. A nest takes in the pollution of its chunk, and once it has had enough, sends
  an **attack group** of units at the building that polluted most nearby. It keeps a
  few units at home as guards.
- **Units**, which get stronger with **evolution** (below):
  - **Mites**: small, quick, weak, and bite.
  - **Brutes**: big, slow, armoured, and bite hard.
  - **Spitters**: stay back and spit from 12 tiles. They come later in evolution.
- **Evolution** (0 to 1) goes up a little with time, more with the pollution nests
  take in, and most when a nest is destroyed. It decides which units a group is made
  of, and how tough they are. The Stats panel shows it.
- **Moving and attacking.** An attack group gets one path from its nest to its target.
  Water can't be crossed. Belts, poles and underground belts can be walked over, and
  every other building is a wall to chew through, costed by its health. So groups go
  round walls when that's shorter, and through them when not. A unit attacks the
  building in its way, and anything that hits it. It goes home when its target is gone
  and nothing else is near.
- **Alerts.** "Under attack" and "Destroyed" toasts. An alert button next to the clock
  shows the count, and tapping it goes to the latest one. Attacks, ruins and charted
  nests show on the map view.
- Sim notes: `sim/enemies.js` (units, groups, nests, evolution). Units are kept by
  chunk for looking up who's near what. Paths use A* on tiles with a step budget per
  tick, so one long path is spread over a few ticks. Nests are part of the chunk
  generator. A destroyed nest is saved like a dug-into chunk, and live units, groups,
  ruins and evolution are saved too. `render/enemies.js` draws units as instanced
  meshes, only those on screen.
- Done as: `sim/enemies.js`, `sim/health.js`, `render/enemies.js`, `ui/alerts.js`.
  - **Nests** come from `map.js` (`nestsNear`, `nestById`): per 96×96 square set half
    a square off the ore patches' grid, 35% of squares near the safe zone to 80% at
    1,200 tiles, 2–6 nests on a ring, never on water or within 160 tiles. When a chunk
    is made (or loaded) its nest tiles get `NEST_ID` (-1) in `ids`, so nothing can be
    built there and paths can't cross them; `world.nests` keeps each nest seen.
    Destroyed nests are a saved set of ids and are never made again (`destroyNest`,
    which also raises evolution; nothing can destroy one until phase 19).
  - **Nest state** exists only for nests that have taken in pollution: each takes up
    to 2 units a second from the chunk its middle is in (counted as absorbed in
    Stats), and once a second hatches units from it (mite 4, brute 20, spitter 12) up
    to 30 at home. Units at home, the guards included, are only a list of kinds, not
    simulated, so the far map costs nothing. With enemies on, on the 10-second marks, a
    nest with no group out and 3 + a group's worth at home (5 + 15 × evolution units)
    sends the group at the building scoring highest on pollution a minute ÷ (distance +
    32) within 320 tiles.
  - **Paths**: A* on tiles, 8 ways without corner cutting, in a box 48 tiles round
    start and goal; water and nests are impassable, conveyors and poles cost a tile,
    other buildings a tile plus their health (so a 7-chest wall is gone round and a
    61-chest one gone through, tested). One search at a time, 1,000 tiles a tick, saved
    mid-search as the cells it has reached plus its heap, so a loaded game finishes it
    on the same tick. After its target goes, a group takes the nearest building (not a
    belt or pole) within 20 tiles of its path's end, extending the path, or walks the
    path back and rejoins its nest.
  - **Units** move in 1/256 of a tile, follow the group path with their own offset,
    chew through whatever blocks the next tile, and attack the target once in reach
    (1.5 tiles, brutes 1.6, spitters 12). Evolution (a float, saved) rises
    0.000004 a second, 0.00001 per unit of pollution nests take in and 0.002 per nest
    destroyed, each times (1 − evolution); it sets the mix (brutes from 0.2, spitters
    from 0.4) and unit health (×(1 + 2 × evolution)). All randomness is a mulberry32
    state in `world.enemies.rand`.
  - **Health**: `health` per building; only damaged ones are in `world.damaged` (so the
    benchmark's building objects are unchanged). Repair is 2% a second after 10 s
    without a hit. At 0 `destroy` takes the building down with no refund and pushes a
    ruin (its layout part, from `layoutOf`); ruins don't block anything and building
    over one clears it. `rebuild` builds ruins with `buildLayout`, so settings and
    underground pairs come back.
  - **UI**: tapping a ruin rebuilds it (undoable), Remove clears one; the warning
    button by the clock counts ruins plus groups that hit something in the last 10 s,
    goes to the latest alert and opens the Alerts panel (recent alerts to jump to,
    Rebuild all (N) with its cost). Toasts for losses, and attacks at most every 10 s.
    Health bars (billboard icons, 12 steps) sit under damaged buildings, panels show
    health, ruins are drawn see-through, nest ground is creep, and the map view shows
    charted nests (pink), ruins (red) and attack groups (orange). Stats has
    evolution. New games ask Peaceful / Enemies on (default peaceful until phase 18),
    and the pause menu switches it either way (groups out go home). Save format 10;
    older saves load peaceful.
  - Not yet: units only fight buildings (nothing hits them before turrets), guards
    never come out, and nests have no health (phase 19). Tuning of how soon and how
    often attacks come waits for defences in phase 18.
  - Performance: headless, the benchmark factory with enemies on is attacked within
    2 minutes; ticks average 0.4–0.7 ms with up to ~75 units out. The spikes left are
    the belt and power networks being worked out again after a destroyed belt, pole
    or machine, the same as when the player builds one.
- [ ] A factory that pollutes a nearby base gets attacked, and an undefended miner is destroyed.
- [ ] The alert takes you to the attack, and Rebuild all puts the destroyed buildings back as they were.
- [ ] A group walks round a lake, and round a short wall rather than through it.
- [ ] In peaceful mode, nothing attacks.
- [ ] A save during an attack loads with the attack still going, tick for tick.

### Phase 18: Turrets, walls and ammunition ✅ (done)
The answer to phase 17, and the first HUB milestone that isn't about the factory.
- **Gun turret** (2×2, no power). It shoots the nearest enemy within 18 tiles, turning
  to aim. It holds up to 10 magazines, and inserters and belts top it up to 5, like a
  furnace's fuel. It shows it's out of ammo with an amber sign, and its panel shows
  its ammo, kills and damage done. While placing one, its range is drawn on the ground.
- **Wall** (1×1, stone bricks, a lot of health). Walls join their neighbours into one
  line, like belts, and are dragged into lines the same way.
- **Firearm magazine** (4 iron plates, 10 shots). It's made in an assembler or by hand.
- **Piercing magazine** (a firearm magazine, 2 copper plates and an iron gear). More
  damage, and more against armour. It comes with phase 19's milestone.
- Enemies go for turrets that shoot them, so walls in front of turrets matter. A
  turret under attack sends an alert, as does one that runs out of ammo while enemies
  are near.
- **Milestones.** Milestone 2 becomes *Logistics and defense*, and adds gun turrets,
  walls and firearm magazines to what it unlocks, so defense is there before pollution
  reaches any nest. From this phase on, new games default to enemies on.
- Sim notes: `sim/turret.js`. Turrets find targets in the unit chunks round them, and
  only look again when their target dies or leaves range. Damage is whole numbers,
  and armour takes off a flat amount per hit (never below 1). Magazines are items, and
  turrets accept them with `canTake`.
- Done as: `sim/turret.js`, with transport, enemy retaliation, rendering, panels,
  alerts and save support wired into the existing systems.
  - Gun turrets have 400 health, an 18-tile range, and fire every 12 ticks without
    electricity. Firearm magazines cost 4 iron plates, take 2 seconds in an
    assembler (1 second by hand), and give 10 shots of 6 damage before armour.
    Turrets keep their target until it dies or leaves range, then use the enemy
    chunk index to find the nearest. Kills and actual damage are counted per gun.
  - Belts and inserters fill the magazine slot to 5, and the panel to 10. Opening a
    magazine counts it as consumed; remaining shots stay loaded, survive saves,
    and are lost when the turret is dismantled. Unopened magazines are refunded.
    Empty turrets show an amber sign and raise an alert at most every 10 seconds
    while enemies are in range. The panel shows ammunition, kills and damage.
  - Walls cost 5 stone bricks and have 1,000 health. Dragging places a line with
    previews, cost handling and undo; models connect to the four neighbouring
    walls. Melee enemies hit the wall in front of a gun instead of reaching
    through it; spitters can fire over walls. Retaliation extends the group's
    route with the same budgeted path search, respecting terrain and obstacles.
  - Turrets have a rotating gun, muzzle flash and placement range ring. Defense
    has its own build-menu category. Milestone 2 is *Logistics and defense* and
    unlocks turrets, walls and firearm magazines. New games default to enemies
    on; existing saves keep their choice. Save format 11 preserves magazines,
    loaded shots, targets, cooldowns, aim and combat counters.
  - The realistic example now includes an automated ammunition line, a supplied
    turret and walls. Like the performance presets it remains peaceful and never
    replaces a saved game. Piercing magazines remain with phase 19's milestone.
  - Automated checks cover ammunition crafting and resupply, shot counts, armour,
    range, peaceful mode, retaliation, wall damage and repair, early attacks,
    save/load during combat, migration and wall dragging. Full suite: 222 tests.
    Production build and CPU-side render geometry checks pass. The phone checks
    below are still manual; browser appearance and touch have not been verified.
- [ ] Two turrets with a magazine inserter each hold off an early attack with no losses.
- [ ] A turret line fed by a belt of magazines keeps shooting as long as the belt is fed.
- [ ] A turret with no ammo says so, and an alert says so while enemies are near it.
- [ ] Walls in front of turrets take the damage, and repair themselves afterwards.

### Phase 19: Pushing back
Defense holds the line. This phase lets the player take land back, and makes the
enemies push too.
- **Clearing nests.** Nests have health and fight back: their guards come out when a
  turret opens fire. Turrets built within range of a base, fed by hand from their
  panel, clear it ("turret creep"). A cleared base leaves its chunks free to build on,
  and any ore under it can be mined.
- **Expansion.** Every so often (more often with evolution), a small group leaves a base
  to start a new one in empty land nearby. It never settles within 30 tiles of a
  building or in the safe zone. Radars show new bases as they're charted.
- **Evolution in play.** Brutes and spitters join groups as evolution rises. Spitters
  outrange nothing yet, but they hit walls from behind the wall line.
- **Milestone.** A new milestone 4, *Defense*, asks for magazines and walls, and
  unlocks piercing magazines. Circuit production moves to milestone 5.
- **Map markers.** Bases on the map view are coloured by how strong they are, and a
  tap on one shows its nests and units.
- [ ] A base cleared with turret creep stays clear, and the land can be built on.
- [ ] Left alone for an hour, bases spread, but never into the safe zone or onto the factory.
- [ ] Piercing magazines kill brutes clearly faster than firearm magazines do.

### Phase 20: Science packs, labs and research
Research takes over from the HUB. The HUB's milestones stay the opening, and its
last one now unlocks labs.
- **Science packs.** A *red* pack is made from a copper plate and an iron gear, and a
  *green* pack from an inserter and a belt. Both are made in assemblers, or by hand.
- **Lab** (3×3, power). It takes packs by inserter or belt, up to two of each kind.
  All labs work on the one technology under way. For each unit of research, a lab uses
  one of each pack the technology needs, over its time per unit. Its panel shows what
  it's researching and why it's stopped (no packs, no power).
- **Research.** `sim/tech.js` holds the technology tree: each technology's
  prerequisites, units, packs per unit, time per unit, and effects. An effect either
  unlocks buildings and recipes (as milestones do) or changes a number: turret
  damage, shooting speed, wall health. A **Research** panel (button in the top bar)
  lists what can be researched now, by tier, with cost and effects, and a queue. The
  goal card shows the research under way once the HUB is done. A pack in a lab that
  the current research doesn't need stays in the lab.
- **The first tree:**
  - red packs: *Weapon damage 1*, *Shooting speed 1* and *Stronger walls*;
  - red + green packs: *Weapon damage 2*, *Shooting speed 2*, and *Logistics 2* (Mk2
    belts, underground belts, splitters and the fast inserter, moved here from plan 2's
    phase 27 and built in that phase).
- **Milestones.** The last milestone (circuit production) now unlocks labs and red
  packs. Green packs come with the first technology.
- Sim notes: world.research is { done, current, progress, queue }, and is saved.
  `lockedWhy` says which milestone or technology a building needs. Number effects are
  worked out once when research finishes, not on every shot. The Stats panel counts
  packs used like any other items.
- [ ] A line making red packs, feeding three labs, researches Weapon damage 1 on its own, and turrets hit harder afterwards.
- [ ] A lab missing a pack, or power, says so.
- [ ] Every building and recipe is unlocked by exactly one milestone or technology (tested), and the Research panel shows what each one unlocks.

### Phase 21: Military science and the laser turret
The defense side of the tree, and the end of this plan.
- **Military science pack** (grey): a piercing magazine and two walls make two. It's
  needed for the military technologies from here on.
- **Laser turret** (2×2). It runs on power instead of ammo: a lot while it shoots, a
  trickle while it waits. Weaker per shot than a gun turret with piercing ammo, but it
  never runs dry, as long as the power keeps up. It's researched with red, green and
  grey packs.
- **More of the tree:**
  - *Weapon damage 3–4*, *Shooting speed 3–4* (gun turrets);
  - *Laser damage 1–2* and *Laser shooting speed 1–2*;
  - *Stronger walls 2*;
  - *Turret range*, which adds 2 tiles to every turret.
- Stats: the military packs and ammunition used show up where the player expects them,
  and the Stats panel can show kills a minute.
- [ ] A laser turret line on its own generators holds off attacks at mid evolution, and brownouts show up as slower shooting.
- [ ] The whole tree can be researched in order in one game, and nothing locked is left without a way to unlock it.
- [ ] At high evolution, a base close to a big factory is dangerous with gun turrets alone and fine with upgrades and lasers.

## Order and dependencies

| Phase | Needs | Why this order |
|---|---|---|
| 16 Pollution | 13 (chunks), 15 (activity) | What triggers attacks; seen and tuned before anything fights |
| 17 Enemies and nests | 16 | The threat, health and ruins; tried with enemies on, peaceful by default |
| 18 Turrets, walls, ammo | 17 | The answer; enemies on by default from here |
| 19 Pushing back | 18 | Clearing nests needs turrets; expansion needs something to hold it off |
| 20 Science and research | 18 | After defense, as asked; military upgrades are its first technologies |
| 21 Military science, lasers | 20, 9 (power) | Needs the research system and power |

Plan 2's remaining phases follow, renumbered 22–27: fluids, steel and oil, sound,
onboarding, blueprints, and faster belts. Their unlocks move from HUB milestones to
technologies.

## Open questions

- **Peaceful whenever you like?** The plan lets the pause menu turn enemies on (and
  off) at any time. Should turning them off be allowed once they're on, or is that a
  one-way switch, as in Factorio?
- **Ruins and contents.** A destroyed building's contents are lost. Would dropping
  them in the ruin (taken back when it's rebuilt) feel fairer, without making
  defense pointless?
- **Repair.** Buildings repair themselves for free out of combat. If defense turns out
  too forgiving, repair could cost plates, or need a repair pack item.
- **Nests and the HUB.** Should attack groups ever go for the HUB on purpose, or only
  for polluters? The plan says only polluters.
- **Artifacts.** Should destroyed nests drop something to research with (an
  "alien" pack), or is clearing land reward enough?

## Later

A flamethrower turret once fluids are in (phase 22), with oil as its fuel; land
mines; tougher enemy tiers with evolution beyond 1; bots to rebuild ruins
automatically (with planned buildings, phase 26); infinite research for the late
game.
