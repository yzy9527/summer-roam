import * as THREE from 'three';
import { roadPoint, terrainHeight } from './world-base.js';
import { paddyContour, paddyLift, paddyDistance } from './paddy-profile.js';
export function paddySurfaceGeometry(p, offset = 0, lift = 0.048) {
  const contour = paddyContour(p, roadPoint, offset),
    v = [p.x, terrainHeight(p.x, p.z) + lift, p.z],
    uv = [p.x / 4, p.z / 4],
    idx = [],
    segments = contour.length,
    rings = 12;
  for (let ring = 1; ring <= rings; ring++)
    for (const q of contour) {
      const t = ring / rings,
        x = p.x + (q.x - p.x) * t,
        z = p.z + (q.z - p.z) * t;
      v.push(x, terrainHeight(x, z) + lift, z);
      uv.push(x / 4, z / 4);
    }
  for (let i = 0; i < segments; i++) idx.push(0, 1 + ((i + 1) % segments), 1 + i);
  for (let r = 1; r < rings; r++)
    for (let i = 0; i < segments; i++) {
      const a = 1 + (r - 1) * segments + i,
        b = 1 + (r - 1) * segments + ((i + 1) % segments),
        c = a + segments,
        d = b + segments;
      idx.push(a, b, c, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const fv = g.attributes.position.array;
  const faces = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3,
      b = idx[i + 1] * 3,
      d = idx[i + 2] * 3,
      area = (fv[b + 2] - fv[a + 2]) * (fv[d] - fv[a]) - (fv[b] - fv[a]) * (fv[d + 2] - fv[a + 2]);
    if (area > 1e-8) faces.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  g.setIndex(faces);
  const waterDepth = [];
  for (let i = 0; i < g.attributes.position.count; i++) {
    const position = g.attributes.position;
    waterDepth.push(
      THREE.MathUtils.clamp(
        -paddyDistance(p, position.getX(i), position.getZ(i), roadPoint) / 0.65,
        0,
        1,
      ),
    );
  }
  g.setAttribute('waterDepth', new THREE.Float32BufferAttribute(waterDepth, 1));
  g.computeVertexNormals();
  return g;
}
export function roundedPaddyBankGeometry(p) {
  const v = [],
    c = [],
    idx = [],
    offsets = [-0.08, 0.05, 0.18, 0.3, 0.425, 0.55, 0.7, 0.85, 1.04],
    segments = 128;
  for (const offset of offsets)
    for (const q of paddyContour(p, roadPoint, offset, segments)) {
      const h = paddyLift(q.x, q.z, roadPoint);
      v.push(q.x, terrainHeight(q.x, q.z) + h, q.z);
      const col = new THREE.Color('#806b42').lerp(
        new THREE.Color('#6d853d'),
        Math.min(1, h / 0.082),
      );
      c.push(col.r, col.g, col.b);
    }
  for (let r = 0; r < offsets.length - 1; r++)
    for (let i = 0; i < segments; i++) {
      const a = r * segments + i,
        b = r * segments + ((i + 1) % segments),
        d = a + segments,
        e = b + segments;
      idx.push(a, b, d, b, e, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  const fv = g.attributes.position.array;
  const faces = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3,
      b = idx[i + 1] * 3,
      d = idx[i + 2] * 3,
      area = (fv[b + 2] - fv[a + 2]) * (fv[d] - fv[a]) - (fv[b] - fv[a]) * (fv[d + 2] - fv[a + 2]);
    if (area > 1e-8) faces.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  g.setIndex(faces);
  g.computeVertexNormals();
  return g;
}
