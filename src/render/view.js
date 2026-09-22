import * as THREE from "three";

const PALETTES = {
  dark: {
    bg: 0x12141a,
    ground: 0x1c1f28,
    grid: 0x2c303c,
    accent: 0x5be38a,
    hemiSky: 0xbfd4ff,
    hemiGround: 0x20242e,
  },
  light: {
    bg: 0xdfeaf2,
    ground: 0xc9ccd2,
    grid: 0x9aa1ad,
    accent: 0x0e8f43,
    hemiSky: 0xffffff,
    hemiGround: 0x8a8f99,
  },
};

// Draws a world. Reads sim state each frame, never writes it.
export function createView(container, world, { theme = "dark" } = {}) {
  let COLORS = PALETTES[theme] || PALETTES.dark;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(COLORS.hemiSky, COLORS.hemiGround, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(10, 20, 8);
  scene.add(sun);

  // Top-down-ish orthographic camera: one world unit = one tile.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  const center = new THREE.Vector3(world.size / 2, 0, world.size / 2);
  let zoom = 12; // tiles visible across the shorter screen side

  const groundMat = new THREE.MeshStandardMaterial();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(world.size, world.size), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(world.size / 2, 0, world.size / 2);
  scene.add(ground);

  let grid = null;
  const buildGrid = () => {
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      grid.material.dispose();
    }
    grid = new THREE.GridHelper(world.size, world.size, COLORS.grid, COLORS.grid);
    grid.position.set(world.size / 2, 0.01, world.size / 2);
    scene.add(grid);
  };

  // Placeholder marker at the map centre until there are real entities to draw.
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial());
  marker.position.set(Math.floor(world.size / 2) + 0.5, 0.4, Math.floor(world.size / 2) + 0.5);
  scene.add(marker);

  const applyTheme = () => {
    scene.background = new THREE.Color(COLORS.bg);
    groundMat.color.set(COLORS.ground);
    marker.material.color.set(COLORS.accent);
    buildGrid();
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
    camera.position.set(center.x, 50, center.z + 30);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
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

  return {
    canvas: renderer.domElement,
    render() {
      marker.rotation.y = world.tick / 60;
      renderer.render(scene, camera);
    },
    setTheme(name) {
      COLORS = PALETTES[name] || PALETTES.dark;
      applyTheme();
    },
    dispose() {
      ro.disconnect();
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
