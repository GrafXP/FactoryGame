import * as THREE from "three";

// Icons floating over buildings (status.js, recipe-icons.js), all drawn in one go:
// a square per icon that always faces the camera, cut from one texture (an atlas)
// that each kind of icon is painted into the first time it's used. Icons are
// painted on a 64-unit grid, like a 64-pixel canvas, and always show on top.
const CELL = 64; // pixels per icon in the atlas
const PAD = 4; // transparent pixels round each, so small (mipmapped) icons don't pick up their neighbours
const COLS = 8;

const vertexShader = /* glsl */ `
  attribute float cell;
  uniform vec2 cells;
  varying vec2 vUv;
  void main() {
    vec2 at = vec2(mod(cell, cells.x), floor(cell / cells.x));
    vUv = (uv + vec2(at.x, cells.y - 1.0 - at.y)) / cells;
    // Faces the camera: the corners are laid out in view space round the centre.
    vec4 centre = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    centre.xy += position.xy * length(instanceMatrix[0].xyz);
    gl_Position = projectionMatrix * centre;
  }
`;
const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  void main() {
    vec4 color = texture2D(map, vUv);
    if (color.a < 0.02) discard;
    gl_FragColor = color;
    #include <colorspace_fragment>
  }
`;

export function createBillboards(parent) {
  const canvas = document.createElement("canvas");
  const g = canvas.getContext("2d");
  let rows = 0;
  let texture = null;
  const cells = new Map(); // icon key → { index, draw }

  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, cells: { value: new THREE.Vector2(COLS, 1) } },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const paint = (index, draw) => {
    const x = (index % COLS) * CELL;
    const y = Math.floor(index / COLS) * CELL;
    g.save();
    g.clearRect(x, y, CELL, CELL);
    g.translate(x + PAD, y + PAD);
    g.scale((CELL - 2 * PAD) / 64, (CELL - 2 * PAD) / 64);
    draw(g);
    g.restore();
    texture.needsUpdate = true;
  };

  // A new, empty atlas with room for `n` icons (a texture can't change size).
  const resize = (n) => {
    rows = Math.max(4, Math.ceil(n / COLS));
    canvas.width = COLS * CELL;
    canvas.height = rows * CELL;
    texture?.dispose();
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    material.uniforms.map.value = texture;
    material.uniforms.cells.value.set(COLS, rows);
  };
  resize(0);

  // Instanced meshes can't grow, so one twice the size replaces it when it's full,
  // keeping the icons already added this frame.
  let mesh = null;
  let n = 0;
  const grow = () => {
    const old = mesh;
    const cap = old ? old.instanceMatrix.count * 2 : 64;
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.setAttribute("cell", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    mesh = new THREE.InstancedMesh(geometry, material, cap);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.count = 0;
    parent.add(mesh);
    if (!old) return;
    mesh.instanceMatrix.array.set(old.instanceMatrix.array);
    geometry.attributes.cell.array.set(old.geometry.attributes.cell.array);
    parent.remove(old);
    old.geometry.dispose();
    old.dispose();
  };
  grow();

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();

  return {
    // The atlas cell of icon `key`, painted by draw(g) the first time.
    cell(key, draw) {
      let c = cells.get(key);
      if (c) return c.index;
      c = { index: cells.size, draw };
      cells.set(key, c);
      if (c.index >= COLS * rows) {
        resize(COLS * rows * 2);
        for (const other of cells.values()) paint(other.index, other.draw);
      } else paint(c.index, draw);
      return c.index;
    },
    // Starts a frame's icons.
    begin() {
      n = 0;
    },
    // Icon `cell` centred on (x, y, z), `size` tiles across.
    add(cell, x, y, z, size) {
      if (n === mesh.instanceMatrix.count) grow();
      mesh.setMatrixAt(n, m.compose(pos.set(x, y, z), q, scale.set(size, size, size)));
      mesh.geometry.attributes.cell.array[n] = cell;
      n++;
    },
    end() {
      mesh.count = n;
      mesh.visible = n > 0; // three binds a mesh's shaders even to draw nothing
      if (!n) return;
      const cellAttr = mesh.geometry.attributes.cell;
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      cellAttr.addUpdateRange(0, n);
      cellAttr.needsUpdate = true;
    },
    // Forgets every icon, so each is painted again when next used (in new colours,
    // say).
    clear() {
      cells.clear();
      resize(0);
    },
    dispose() {
      mesh.geometry.dispose();
      mesh.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
