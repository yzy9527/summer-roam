import * as THREE from 'three';
const random =
  (seed = 10221) =>
  () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
export function leafMaterial() {
  return new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.96,
  });
}
// A hand-shaped three-dimensional twig with folded, overlapping leaf fans.
export function leafSpray(seed, coarse = false) {
  const rnd = random(seed),
    v = [],
    idx = [],
    colors = [];
  for (let branch = 0; branch < 3; branch++)
    for (let n = 0; n < 4; n++) {
      const a = branch * 2.1 + n * 0.48 + (rnd() - 0.5) * 0.5,
        t = (n + 0.6) / 4;
      const cx = Math.cos(a) * (0.03 + t * 0.13),
        cz = Math.sin(a) * (0.03 + t * 0.15),
        cy = t * 0.13;
      const size = 0.075 + rnd() * 0.06,
        b = v.length / 3;
      for (const [x, y, z] of [
        [0, 0, -1],
        [-0.48, 0, -0.2],
        [-0.4, 0, 0.55],
        [0, -0.08, 1],
        [0.4, 0, 0.55],
        [0.48, 0, -0.2],
        [0, 0.18, 0],
      ]) {
        const xx = x * size,
          zz = z * size;
        v.push(
          cx + xx * Math.cos(a) - zz * Math.sin(a),
          cy + y * size,
          cz + xx * Math.sin(a) + zz * Math.cos(a),
        );
        const c = new THREE.Color('#648840').lerp(
          new THREE.Color('#b3bd59'),
          Math.max(0, t * 0.6 + y),
        );
        colors.push(c.r, c.g, c.b);
      }
      if (coarse) for (let k = 1; k < 5; k++) idx.push(b, b + k, b + k + 1);
      else for (let k = 0; k < 6; k++) idx.push(b + k, b + ((k + 1) % 6), b + 6);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
