import * as THREE from "three";

// A flat gear lying on the ground, `depth` thick from y = 0 up: `teeth` teeth
// between radius r (root) and R (tips), with a hole of radius h. Used for gear
// items and the cog on top of an assembler.
export function gearGeometry(teeth, r, R, h, depth) {
  const shape = new THREE.Shape();
  const step = (Math.PI * 2) / teeth;
  let first = true;
  for (let i = 0; i < teeth; i++) {
    for (const [da, rad] of [
      [-0.3, r],
      [-0.18, R],
      [0.18, R],
      [0.3, r],
    ]) {
      const a = i * step + da * step * 1.6;
      const x = Math.cos(a) * rad;
      const y = Math.sin(a) * rad;
      if (first) shape.moveTo(x, y);
      else shape.lineTo(x, y);
      first = false;
    }
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, h, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  // Extruded along z, then laid flat: z becomes up.
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 }).rotateX(-Math.PI / 2);
}
