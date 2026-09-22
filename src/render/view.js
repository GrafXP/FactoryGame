import * as THREE from "three";
import { ORE } from "../sim/map.js";

// Ore colours are picked so the four ores differ in hue *and* lightness in both
// themes: iron blue, copper orange, coal black, stone pale sand.
const PALETTES = {
  dark: {
    bg: 0x12141a,
    ground: 0x232833,
    grid: 0x3a4050,
    accent: 0x5be38a,
    hemiSky: 0xbfd4ff,
    hemiGround: 0x20242e,
    ore: { [ORE.IRON]: 0x8fb3dd, [ORE.COPPER]: 0xe8834f, [ORE.COAL]: 0x0c0d10, [ORE.STONE]: 0xd8c49a },
  },
  light: {
    bg: 0xdfeaf2,
    ground: 0xc9ccd2,
    grid: 0x9aa1ad,
    accent: 0x0e8f43,
    hemiSky: 0xffffff,
    hemiGround: 0x8a8f99,
    ore: { [ORE.IRON]: 0x3f6fa8, [ORE.COPPER]: 0xc4561f, [ORE.COAL]: 0x2a2a2e, [ORE.STONE]: 0xf0e6cc },
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

  // Highlight for the selected tile: a translucent fill plus an outline.
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
  selection.visible = false;
  scene.add(selection);

  const applyTheme = () => {
    scene.background = new THREE.Color(COLORS.bg);
    hemi.color.set(COLORS.hemiSky);
    hemi.groundColor.set(COLORS.hemiGround);
    grid.material.color.set(COLORS.grid);
    selFill.material.color.set(COLORS.accent);
    selLine.material.color.set(COLORS.accent);

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

    oreTiles.forEach((i, n) => rocks.setColorAt(n, c.copy(oreColors[ore[i]]).multiplyScalar(0.9 + jitter(i, 0, 6) * 0.2)));
    if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
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
      renderer.render(scene, camera);
    },
    setSelected(tile) {
      selection.visible = !!tile;
      if (tile) selection.position.set(tile.x + 0.5, 0.03, tile.y + 0.5);
    },
    setTheme(name) {
      COLORS = PALETTES[name] || PALETTES.dark;
      applyTheme();
    },
    dispose() {
      ro.disconnect();
      groundTex.dispose();
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
