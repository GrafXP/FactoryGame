import * as THREE from "three";
import { ORE } from "../sim/map.js";
import { MINE_TICKS } from "../sim/world.js";
import { ORE_ITEM } from "../sim/items.js";
import { beltNetwork } from "../sim/transport.js";
import { createBuildingLayer } from "./buildings.js";
import { createStatusIcons } from "./status.js";
import { createItemLayer } from "./items.js";
import { drawBeltItems, beltItemCount } from "./belt-items.js";
import { createMachineParts } from "./machines.js";
import { createRecipeIcons } from "./recipe-icons.js";
import { createPowerLayer } from "./power.js";

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
    powerArea: 0x6cb4ff,
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
    powerArea: 0x1f6fd1,
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
const ORE_TINT = 0.55; // how strongly an ore colours its ground tile
const MIN_ZOOM = 6;
const CAMERA_OFFSET = new THREE.Vector3(0, 50, 30); // angled view, looking north

// Cheap per-tile hash for cosmetic jitter. Render-only, so it doesn't need the sim's rng.
const jitter = (x, y, k) => {
  const h = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
  return h - Math.floor(h);
};

// Draws a world. Reads sim state each frame, never writes it.
export function createView(container, world, { theme = "dark" } = {}) {
  let COLORS = PALETTES[theme] || PALETTES.dark;
  const { size, ore, amount } = world.map;

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
  const center = new THREE.Vector3(size / 2, 0, size / 2);
  const maxZoom = size;
  let zoom = 24; // tiles visible across the shorter screen side

  // Ground: one texel per tile, so ore patches cost no extra geometry.
  const groundPixels = new Uint8Array(size * size * 4);
  const groundTex = new THREE.DataTexture(groundPixels, size, size);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  groundTex.magFilter = THREE.NearestFilter;
  const groundMat = new THREE.MeshStandardMaterial({ map: groundTex });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(size / 2, 0, size / 2);
  scene.add(ground);

  const grid = new THREE.GridHelper(size, size);
  grid.material.transparent = true;
  grid.position.set(size / 2, 0.01, size / 2);
  scene.add(grid);

  // A rock on every ore tile; richer tiles get bigger rocks.
  const oreTiles = [];
  for (let i = 0; i < ore.length; i++) if (ore[i]) oreTiles.push(i);
  const rocks = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9 }),
    oreTiles.length,
  );
  rocks.frustumCulled = false;
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    oreTiles.forEach((i, n) => {
      const x = i % size;
      const y = (i / size) | 0;
      const r = 0.16 + 0.14 * Math.min(1, amount[i] / 1500);
      p.set(x + 0.5 + (jitter(x, y, 1) - 0.5) * 0.35, r * 0.4, y + 0.5 + (jitter(x, y, 2) - 0.5) * 0.35);
      q.setFromEuler(e.set(jitter(x, y, 3) * 3, jitter(x, y, 4) * 6, 0));
      s.set(r, r * (0.7 + jitter(x, y, 5) * 0.4), r);
      rocks.setMatrixAt(n, m.compose(p, q, s));
    });
  }
  scene.add(rocks);

  const buildings = createBuildingLayer(scene);
  const statusIcons = createStatusIcons(scene);
  const items = createItemLayer(scene);
  const machines = createMachineParts(scene);
  const recipeIcons = createRecipeIcons(scene);
  const power = createPowerLayer(scene, size);
  const ghosts = createBuildingLayer(scene, { ghost: true });
  let drawnVersion = -1;

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
  scene.add(selection);

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
  scene.add(mineMark);

  let highlightKind = "select";
  const paintHighlight = () => {
    const color = highlightKind === "remove" ? COLORS.bad : COLORS.accent;
    selFill.material.color.set(color);
    selLine.material.color.set(color);
    mineFill.material.color.set(COLORS.accent);
    mineLine.material.color.set(COLORS.accent);
  };

  // Ground colours and rocks for the current ore layer. Runs again whenever a
  // tile is mined out (world.mapVersion), which is rare, so it just redoes the lot.
  let drawnOre = -1;
  const noRock = new THREE.Matrix4().makeScale(0, 0, 0);
  const paintOre = () => {
    drawnOre = world.mapVersion;
    const base = new THREE.Color(COLORS.ground);
    const oreColors = {};
    for (const k in COLORS.ore) oreColors[k] = new THREE.Color(COLORS.ore[k]);
    const c = new THREE.Color();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        c.copy(base);
        if (ore[i]) c.lerp(oreColors[ore[i]], ORE_TINT);
        c.multiplyScalar(0.96 + jitter(x, y, 0) * 0.08);
        // Texture rows run bottom-up in v, which is north-to-south (-z) on the rotated plane.
        const t = ((size - 1 - y) * size + x) * 4;
        const hex = c.getHex(); // sRGB, clamped
        groundPixels[t] = hex >> 16;
        groundPixels[t + 1] = (hex >> 8) & 255;
        groundPixels[t + 2] = hex & 255;
        groundPixels[t + 3] = 255;
      }
    }
    groundTex.needsUpdate = true;

    oreTiles.forEach((i, n) => {
      if (ore[i]) rocks.setColorAt(n, c.copy(oreColors[ore[i]]).multiplyScalar(0.9 + jitter(i, 0, 6) * 0.2));
      else rocks.setMatrixAt(n, noRock); // mined out
    });
    rocks.instanceMatrix.needsUpdate = true;
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  };

  const applyTheme = () => {
    scene.background = new THREE.Color(COLORS.bg);
    hemi.color.set(COLORS.hemiSky);
    hemi.groundColor.set(COLORS.hemiGround);
    grid.material.color.set(COLORS.grid);
    paintHighlight();
    buildings.setTheme(COLORS);
    ghosts.setTheme(COLORS);
    machines.setTheme(COLORS);
    power.setTheme(COLORS);
    const itemColors = { ...COLORS.items };
    for (const ore in ORE_ITEM) itemColors[ORE_ITEM[ore]] = COLORS.ore[ore];
    items.setTheme(itemColors);
    recipeIcons.setTheme(itemColors);
    paintOre();
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
    camera.position.copy(center).add(CAMERA_OFFSET);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // Grid lines turn to noise when zoomed far out, so fade them.
    grid.material.opacity = THREE.MathUtils.clamp((50 - zoom) / 30, 0, 1) * 0.7;
    grid.visible = grid.material.opacity > 0;
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

  // Camera moves used by the input controls. The centre stays on the map, so you can't lose it.
  const cam = {
    groundAt,
    panBy(dx, dy) {
      center.x = THREE.MathUtils.clamp(center.x + dx, 0, size);
      center.z = THREE.MathUtils.clamp(center.z + dy, 0, size);
      updateCamera();
    },
    // Zooms by `factor` (>1 = zoom out) keeping the ground under (clientX, clientY) still.
    zoomAt(factor, clientX, clientY) {
      const before = groundAt(clientX, clientY);
      zoom = THREE.MathUtils.clamp(zoom * factor, MIN_ZOOM, maxZoom);
      updateCamera();
      const after = groundAt(clientX, clientY);
      if (before && after) cam.panBy(before.x - after.x, before.y - after.y);
    },
    get zoom() {
      return zoom;
    },
  };

  return {
    canvas: renderer.domElement,
    cam,
    render() {
      if (drawnVersion !== world.version) {
        drawnVersion = world.version;
        // Belts are drawn straight or as a corner, depending on what feeds them.
        const { shape } = beltNetwork(world);
        const models = { left: "belt-left", right: "belt-right" };
        buildings.set([...world.entities.values()].map((e) => (e.type === "belt" ? { ...e, model: models[shape.get(e)] } : e)));
      }
      // Loose items: on belts, and one at most in each inserter's hand.
      items.begin(beltItemCount(world) + world.entities.size);
      drawBeltItems(world, items);
      machines.update(world, items);
      items.end();
      if (drawnOre !== world.mapVersion) paintOre();
      power.update(world);
      statusIcons.update(world);
      recipeIcons.update(world.entities.values());
      const m = world.mining;
      mineMark.visible = !!m;
      if (m) {
        mineMark.position.set(m.x, 0.04, m.y);
        mineFill.scale.x = Math.max(0.001, m.progress / MINE_TICKS);
      }
      renderer.render(scene, camera);
    },
    // Outlines rect { x, y, w, h } in tiles; kind "select" (accent) or "remove" (red).
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
      groundTex.dispose();
      statusIcons.dispose();
      items.dispose();
      machines.dispose();
      recipeIcons.dispose();
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
