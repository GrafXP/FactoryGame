import * as THREE from "three";
import { ORE } from "../sim/map.js";
import { MINE_TICKS } from "../sim/world.js";
import { ORE_ITEM } from "../sim/items.js";
import { beltNetwork } from "../sim/transport.js";
import { CHUNK, LIMIT } from "../sim/chunks.js";
import { createTerrain } from "./terrain.js";
import { createBuildingLayer } from "./buildings.js";
import { drawStatusIcons } from "./status.js";
import { createItemLayer } from "./items.js";
import { drawBeltItems, beltItemCount } from "./belt-items.js";
import { createMachineParts } from "./machines.js";
import { createRecipeIcons } from "./recipe-icons.js";
import { createPowerLayer } from "./power.js";
import { createPollutionLayer } from "./pollution.js";
import { createEnemyLayer, createMapMarkers, drawHealthBars } from "./enemies.js";
import { createBillboards } from "./billboards.js";
import { createVisible } from "./visible.js";

// Ore colours are picked so the four ores differ in hue *and* lightness in both
// themes: iron blue, copper orange, coal black, stone pale sand. Ore items are drawn
// in their ore's colour; `items` has the rest (plates are also told apart by shape).
const PALETTES = {
  dark: {
    bg: 0x12141a,
    ground: 0x232833,
    grid: 0x3a4050,
    accent: 0x5be38a,
    hemiSky: 0xbfd4ff,
    hemiGround: 0x20242e,
    ore: { [ORE.IRON]: 0x8fb3dd, [ORE.COPPER]: 0xe8834f, [ORE.COAL]: 0x0c0d10, [ORE.STONE]: 0xd8c49a },
    belt: 0x3b3f4a,
    beltArrow: 0xf2c94c,
    underground: 0x5b6170,
    splitter: 0xf2c94c,
    sorter: 0x6cb4ff,
    miner: 0x6d7a8c,
    minerTop: 0xf2c94c,
    chest: 0x9a6a3c,
    chestBand: 0x4a4f5c,
    furnace: 0x8a7f72,
    furnaceTop: 0x5d554c,
    furnaceMouth: 0x17130f,
    inserter: 0x4a4f5c,
    inserterArm: 0xf2c94c,
    assembler: 0x5f7a96,
    assemblerBase: 0x363d4a,
    assemblerCog: 0xf2c94c,
    generator: 0x6f6a64,
    generatorBase: 0x363d4a,
    generatorTop: 0xa9b4c2,
    generatorWheel: 0xf2c94c,
    pole: 0x9a7650,
    poleTop: 0xd9d4c7,
    wire: 0xe0a060,
    hub: 0x5a6f86,
    hubBase: 0x363d4a,
    hubTrim: 0xf2c94c,
    powerArea: 0x6cb4ff,
    radar: 0x6d7a8c,
    radarDish: 0xd9d4c7,
    water: 0x1f6f8b,
    // The map view: charted ground, buildings and belts as blocks, and the fog over
    // what isn't charted.
    mapGround: 0x2c313c,
    mapBuilding: 0xe6e9ef,
    mapBelt: 0xf2c94c,
    fog: 0x0b0c10,
    pollution: 0xff4a3d,
    // Enemies: nests on their creep, the units, what's left of a destroyed building,
    // and on the map, nests and attacks.
    nest: 0x5a2d4a,
    nestHole: 0x160a12,
    nestSpike: 0xd8c7a8,
    creep: 0x3a2436,
    mite: 0xc0452c,
    brute: 0x7a3d28,
    bruteArmor: 0x8c8f99,
    spitter: 0x7aa33a,
    spitterSac: 0xc6e06a,
    ruin: 0x7a6a5e,
    mapNest: 0xd0357a,
    attack: 0xff8a1f,
    items: {
      "iron-plate": 0xc8d4e3,
      "copper-plate": 0xf5a36c,
      "stone-brick": 0xb65a3c,
      "iron-gear": 0xa9b4c2,
      "copper-cable": 0xf0a24a,
      "electronic-circuit": 0x3fbf6a,
    },
    ok: 0x5be38a,
    bad: 0xff5a5a,
  },
  light: {
    bg: 0xdfeaf2,
    ground: 0xc9ccd2,
    grid: 0x9aa1ad,
    accent: 0x0e8f43,
    hemiSky: 0xffffff,
    hemiGround: 0x8a8f99,
    ore: { [ORE.IRON]: 0x3f6fa8, [ORE.COPPER]: 0xc4561f, [ORE.COAL]: 0x2a2a2e, [ORE.STONE]: 0xf0e6cc },
    belt: 0x55596a,
    beltArrow: 0xffd23f,
    underground: 0x6a7080,
    splitter: 0xe0a800,
    sorter: 0x1f6fd1,
    miner: 0x7d8899,
    minerTop: 0xe0a800,
    chest: 0xa8743f,
    chestBand: 0x3a3f4c,
    furnace: 0xa39584,
    furnaceTop: 0x6e655a,
    furnaceMouth: 0x221c16,
    inserter: 0x55596a,
    inserterArm: 0xe0a800,
    assembler: 0x7b95b0,
    assemblerBase: 0x4a5260,
    assemblerCog: 0xe0a800,
    generator: 0x8c867e,
    generatorBase: 0x4a5260,
    generatorTop: 0x9aa6b5,
    generatorWheel: 0xe0a800,
    pole: 0x7a5a38,
    poleTop: 0xf2eee4,
    wire: 0x7a3f12,
    hub: 0x7b95b0,
    hubBase: 0x4a5260,
    hubTrim: 0xe0a800,
    powerArea: 0x1f6fd1,
    radar: 0x7d8899,
    radarDish: 0xf2eee4,
    water: 0x4fb3d9,
    mapGround: 0xd3d6dc,
    mapBuilding: 0x2a2f3a,
    mapBelt: 0xc99700,
    fog: 0x7c8591,
    pollution: 0xd4201a,
    nest: 0x6b3355,
    nestHole: 0x1c0d17,
    nestSpike: 0xf0e2c4,
    creep: 0x9c7e92,
    mite: 0xa8341e,
    brute: 0x5d2c1d,
    bruteArmor: 0x6d717c,
    spitter: 0x5f8a26,
    spitterSac: 0xa6c43c,
    ruin: 0x4a3f38,
    mapNest: 0xa0205a,
    attack: 0xe06a00,
    items: {
      "iron-plate": 0x7d8ea3,
      "copper-plate": 0xd9793a,
      "stone-brick": 0xa0442a,
      "iron-gear": 0x6b7788,
      "copper-cable": 0xc4661a,
      "electronic-circuit": 0x1f9a4a,
    },
    ok: 0x10a84f,
    bad: 0xe0282e,
  },
};
const MIN_ZOOM = 6;
// Zoomed out past MAP_ZOOM tiles across, the playfield turns into the map view.
export const MAP_ZOOM = 64;
const MAX_ZOOM = 512;
export const DEFAULT_ZOOM = 24;
const GRID = 160; // tiles across the grid lines, which follow the camera
const CAMERA_DIR = new THREE.Vector3(0, 50, 30).normalize(); // angled view, looking north

// Draws a world. Reads sim state each frame, never writes it. The camera starts over
// the start of the map, (0, 0).
export function createView(container, world, { theme = "dark" } = {}) {
  let COLORS = PALETTES[theme] || PALETTES.dark;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 1.4);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(10, 20, 8);
  scene.add(sun);

  // Orthographic camera: one world unit = one tile, tile (x, y) spans x..x+1, z..z+1.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  const center = new THREE.Vector3(0, 0, 0);
  let zoom = DEFAULT_ZOOM; // tiles visible across the shorter screen side
  const isMap = () => zoom > MAP_ZOOM;

  // The ground, a chunk at a time (terrain.js), and grid lines over it.
  const terrain = createTerrain(scene);
  // The map view's pollution overlay (pollution.js), when it's switched on.
  const pollution = createPollutionLayer(scene);
  let showPollution = false;
  const grid = new THREE.GridHelper(GRID, GRID);
  grid.material.transparent = true;
  scene.add(grid);

  // Everything but the ground: hidden in the map view, where buildings are blocks
  // drawn into the ground. Only what's on screen is drawn (visible.js).
  const play = new THREE.Group();
  scene.add(play);
  const visible = createVisible();
  const buildings = createBuildingLayer(play);
  const items = createItemLayer(play);
  const machines = createMachineParts(play);
  const icons = createBillboards(play); // status (status.js) and recipe icons
  const recipeIcons = createRecipeIcons();
  const power = createPowerLayer(play);
  const ghosts = createBuildingLayer(play, { ghost: true });
  // Enemies (enemies.js), and the ruins of destroyed buildings, see-through.
  const enemies = createEnemyLayer(play);
  const ruins = createBuildingLayer(play, { ghost: true, tint: "ruin" });
  let shownRuins = null;
  let shownRuinCount = -1;
  const markers = createMapMarkers(scene);

  // Highlight for a tile or footprint: a translucent fill plus an outline.
  const selection = new THREE.Group();
  const selFill = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false }),
  );
  selFill.rotation.x = -Math.PI / 2;
  const selLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.5, 0, -0.5),
      new THREE.Vector3(0.5, 0, -0.5),
      new THREE.Vector3(0.5, 0, 0.5),
      new THREE.Vector3(-0.5, 0, 0.5),
    ]),
    new THREE.LineBasicMaterial(),
  );
  selection.add(selFill, selLine);
  // Drawn over everything, so it still shows on top of a building marked for removal.
  for (const obj of [selFill, selLine]) {
    obj.material.depthTest = false;
    obj.renderOrder = 2;
  }
  selection.visible = false;
  play.add(selection);

  // The tile being hand-mined: an outline and a bar that fills up to the next item.
  const mineMark = new THREE.Group();
  const mineFill = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0.5),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }),
  );
  const mineLine = new THREE.LineLoop(selLine.geometry.clone().translate(0.5, 0, 0.5), new THREE.LineBasicMaterial());
  mineMark.add(mineFill, mineLine);
  for (const obj of [mineFill, mineLine]) {
    obj.material.depthTest = false;
    obj.renderOrder = 2;
  }
  mineMark.visible = false;
  play.add(mineMark);

  // Lit tiles and footprints: where an underground exit can go while placing one,
  // or the buildings in a selection. The instanced mesh is swapped for a bigger
  // one when a selection outgrows it.
  const MARK_INSET = 0.07;
  const markGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const markMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false, depthTest: false });
  let marks = null;
  const ensureMarks = (n) => {
    if (marks && marks.instanceMatrix.count >= n) return;
    let cap = 16;
    while (cap < n) cap *= 2;
    if (marks) {
      play.remove(marks);
      marks.dispose();
    }
    marks = new THREE.InstancedMesh(markGeometry, markMaterial, cap);
    marks.renderOrder = 2;
    marks.frustumCulled = false;
    marks.count = 0;
    marks.visible = false;
    play.add(marks);
  };
  ensureMarks(0);

  let highlightKind = "select";
  const paintHighlight = () => {
    const color = highlightKind === "remove" ? COLORS.bad : COLORS.accent;
    selFill.material.color.set(color);
    selFill.material.opacity = highlightKind === "box" ? 0.12 : 0.3;
    selLine.material.color.set(color);
    mineFill.material.color.set(COLORS.accent);
    markMaterial.color.set(COLORS.accent);
    mineLine.material.color.set(COLORS.accent);
  };

  let shownMap = null; // whether the map view was drawn last frame
  const applyTheme = () => {
    shownMap = null; // sets the background again
    terrain.setTheme(COLORS);
    pollution.setTheme(COLORS.pollution);
    hemi.color.set(COLORS.hemiSky);
    hemi.groundColor.set(COLORS.hemiGround);
    grid.material.color.set(COLORS.grid);
    paintHighlight();
    buildings.setTheme(COLORS);
    ghosts.setTheme(COLORS);
    ruins.setTheme(COLORS);
    enemies.setTheme(COLORS);
    markers.setTheme(COLORS);
    machines.setTheme(COLORS);
    power.setTheme(COLORS);
    const itemColors = { ...COLORS.items };
    for (const ore in ORE_ITEM) itemColors[ORE_ITEM[ore]] = COLORS.ore[ore];
    items.setTheme(itemColors);
    icons.clear();
    recipeIcons.setTheme(itemColors);
  };
  applyTheme();

  const updateCamera = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    const aspect = w / h;
    const half = zoom / 2;
    camera.left = -half * Math.max(aspect, 1);
    camera.right = half * Math.max(aspect, 1);
    camera.top = half / Math.min(aspect, 1);
    camera.bottom = -half / Math.min(aspect, 1);
    // Far enough back that all the ground in view is in front of the camera, however
    // far out it's zoomed: the ground at the top and bottom edges of the screen is
    // further and nearer than the middle by the half-height over the tilt's tangent.
    const depth = (camera.top * CAMERA_DIR.z) / CAMERA_DIR.y;
    camera.position.copy(center).addScaledVector(CAMERA_DIR, depth + 50);
    camera.far = 2 * depth + 100;
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // Grid lines turn to noise when zoomed far out, so fade them.
    grid.material.opacity = THREE.MathUtils.clamp((50 - zoom) / 30, 0, 1) * 0.7;
    grid.visible = grid.material.opacity > 0;
    grid.position.set(Math.round(center.x), 0.01, Math.round(center.z));
  };

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    updateCamera();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // Screen point → point on the ground plane, in tile units.
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ndc = new THREE.Vector2();
  const hit = new THREE.Vector3();
  const groundAt = (clientX, clientY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
    return { x: hit.x, y: hit.z };
  };

  // The ground the screen shows, from (x0, y0) to (x1, y1) in tiles (null if the
  // screen has no size yet).
  const corners = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  const onScreen = { x0: 0, y0: 0, x1: 0, y1: 0 };
  const screenRect = () => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [nx, ny] of corners) {
      raycaster.setFromCamera(ndc.set(nx, ny), camera);
      if (!raycaster.ray.intersectPlane(groundPlane, hit)) continue;
      x0 = Math.min(x0, hit.x);
      x1 = Math.max(x1, hit.x);
      y0 = Math.min(y0, hit.z);
      y1 = Math.max(y1, hit.z);
    }
    if (x0 > x1) return null;
    return Object.assign(onScreen, { x0, y0, x1, y1 });
  };
  // The chunks the screen shows, from (cx0, cy0) to (cx1, cy1), with `margin` more each way.
  const visibleChunks = (margin = 0) => {
    const r = screenRect();
    if (!r) return null;
    const at = (v) => Math.floor(v / CHUNK);
    return { cx0: at(r.x0) - margin, cy0: at(r.y0) - margin, cx1: at(r.x1) + margin, cy1: at(r.y1) + margin };
  };

  // Camera moves used by the input controls. The centre stays within LIMIT of the start.
  const cam = {
    groundAt,
    // Moves the camera to look at ground point (x, y).
    centerOn(x, y) {
      cam.panBy(x - center.x, y - center.z);
    },
    panBy(dx, dy) {
      center.x = THREE.MathUtils.clamp(center.x + dx, -LIMIT, LIMIT);
      center.z = THREE.MathUtils.clamp(center.z + dy, -LIMIT, LIMIT);
      updateCamera();
    },
    // Looks at ground point (x, y) from `tiles` across.
    zoomTo(x, y, tiles) {
      zoom = THREE.MathUtils.clamp(tiles, MIN_ZOOM, MAX_ZOOM);
      cam.centerOn(x, y);
    },
    // Zooms by `factor` (>1 = zoom out) keeping the ground under (clientX, clientY) still.
    zoomAt(factor, clientX, clientY) {
      const before = groundAt(clientX, clientY);
      zoom = THREE.MathUtils.clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
      updateCamera();
      const after = groundAt(clientX, clientY);
      if (before && after) cam.panBy(before.x - after.x, before.y - after.y);
    },
    get zoom() {
      return zoom;
    },
    get center() {
      return { x: center.x, y: center.z };
    },
  };

  return {
    canvas: renderer.domElement,
    cam,
    // How many draw calls the last frame took.
    get drawCalls() {
      return renderer.info.render.calls;
    },
    // Whether it's showing the map view rather than the playfield.
    get mapMode() {
      return isMap();
    },
    // The chunks on screen, for charting what the player looks at (null if the
    // screen has no size yet).
    visibleChunks: () => visibleChunks(0),
    render() {
      const mapMode = isMap();
      const range = visibleChunks(mapMode ? 0 : 1);
      if (range) terrain.update(world, range, mapMode);
      pollution.update(world, mapMode && showPollution);
      markers.update(world, mapMode);
      if (mapMode !== shownMap) {
        shownMap = mapMode;
        play.visible = !mapMode;
        scene.background = new THREE.Color(mapMode ? COLORS.fog : COLORS.bg);
      }
      grid.visible = !mapMode && grid.material.opacity > 0;
      const onGround = screenRect();
      if (mapMode || !onGround) return renderer.render(scene, camera);
      const { list, changed } = visible.update(world, onGround);
      enemies.update(world, range, onGround);
      if (world.ruins !== shownRuins || world.ruins.length !== shownRuinCount) {
        shownRuins = world.ruins;
        shownRuinCount = world.ruins.length;
        ruins.set(world.ruins.map((r) => (r.type === "underground" ? { ...r, model: `underground-${r.end}` } : r)));
      }
      if (changed) {
        // Belts are drawn straight or as a corner, depending on what feeds them, and
        // underground belts as an entrance or an exit.
        const { shape } = beltNetwork(world);
        const models = { left: "belt-left", right: "belt-right" };
        buildings.set(
          list.map((e) =>
            e.type === "belt" ? { ...e, model: models[shape.get(e)] } : e.type === "underground" ? { ...e, model: `underground-${e.end}` } : e,
          ),
        );
      }
      // Loose items: on belts, and one at most in each inserter's hand.
      items.begin(beltItemCount(list) + list.length);
      drawBeltItems(world, items, list);
      machines.update(world, items, list);
      items.end();
      power.update(world, cam.center);
      icons.begin();
      recipeIcons.update(list, icons);
      drawStatusIcons(world, list, icons);
      drawHealthBars(world, list, icons);
      icons.end();
      const m = world.mining;
      mineMark.visible = !!m;
      if (m) {
        mineMark.position.set(m.x, 0.04, m.y);
        mineFill.scale.x = Math.max(0.001, m.progress / MINE_TICKS);
      }
      renderer.render(scene, camera);
    },
    // Lights up tiles [{ x, y }] or footprints [{ x, y, w, h }] (or none, for null).
    setMarks(rects) {
      const list = rects || [];
      ensureMarks(list.length);
      const m = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const scale = new THREE.Vector3();
      const q = new THREE.Quaternion();
      list.forEach(({ x, y, w = 1, h = 1 }, i) => {
        pos.set(x + w / 2, 0.035, y + h / 2);
        scale.set(w - 2 * MARK_INSET, 1, h - 2 * MARK_INSET);
        marks.setMatrixAt(i, m.compose(pos, q, scale));
      });
      marks.count = list.length;
      marks.visible = list.length > 0;
      marks.instanceMatrix.needsUpdate = true;
    },
    // Outlines rect { x, y, w, h } in tiles; kind "select" (accent), "remove" (red)
    // or "box" (accent, with a fainter fill, for a selection or a paste).
    setHighlight(rect, kind = "select") {
      selection.visible = !!rect;
      if (!rect) return;
      selection.position.set(rect.x + rect.w / 2, 0.03, rect.y + rect.h / 2);
      selection.scale.set(rect.w, 1, rect.h);
      highlightKind = kind;
      paintHighlight();
    },
    // Shows the ground poles power, and the area and wires of a pole about to be
    // built at tile `pole` if given; null hides them.
    setPowerOverlay(overlay) {
      power.set(overlay);
    },
    // Whether the map view shows pollution.
    setPollutionOverlay(on) {
      showPollution = on;
    },
    // Ghost previews: [{ type, x, y, rot, ok }], green where ok, red where not.
    setGhosts(list) {
      ghosts.set(list);
    },
    setTheme(name) {
      COLORS = PALETTES[name] || PALETTES.dark;
      applyTheme();
    },
    dispose() {
      ro.disconnect();
      terrain.dispose();
      pollution.dispose();
      enemies.dispose();
      markers.dispose();
      items.dispose();
      machines.dispose();
      icons.dispose();
      power.dispose();
      scene.traverse((obj) => {
        obj.geometry?.dispose();
        obj.material?.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
