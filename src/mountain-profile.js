import * as THREE from 'three';
import { landscapeHeight } from './world-queries.js';

// One surface definition drives the exported mountain, route and all four paws.
export const MOUNTAIN_SITE = Object.freeze({
  x: -48,
  z: 3,
  heading: -Math.PI / 2,
});
export const MOUNTAIN_GRID = Object.freeze({
  minX: -18,
  maxX: 20,
  minZ: -10,
  maxZ: 18,
  step: 0.25,
});
export function mountainWorld(x, z) {
  const c = Math.cos(MOUNTAIN_SITE.heading),
    s = Math.sin(MOUNTAIN_SITE.heading);
  return { x: MOUNTAIN_SITE.x + c * x + s * z, z: MOUNTAIN_SITE.z - s * x + c * z };
}
export function mountainLocal(x, z) {
  const dx = x - MOUNTAIN_SITE.x,
    dz = z - MOUNTAIN_SITE.z;
  const c = Math.cos(MOUNTAIN_SITE.heading),
    s = Math.sin(MOUNTAIN_SITE.heading);
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}
export const MOUNTAIN_SUMMIT = Object.freeze(mountainWorld(-1, 6));
export const MOUNTAIN_GATE = Object.freeze({ x: -31.5, z: 18.5 });
export const MOUNTAIN_BASE = landscapeHeight(MOUNTAIN_SITE.x, MOUNTAIN_SITE.z);
const controls = [
  [15.5, 0, -10],
  [16, 1.08, -6],
  [16, 2.7, 0],
  [14, 4.42, 6],
  [10, 5.93, 10],
  [5, 7.28, 10],
  [0, 8.96, 9],
  [-1, 9.6, 7],
  [-1, 9.6, 6],
];
const curve = new THREE.CatmullRomCurve3(
  controls.map((p) => new THREE.Vector3(...p)),
  false,
  'centripetal',
);
export const MOUNTAIN_ROUTE = curve
  .getPoints(220)
  .map((p) => ({ ...mountainWorld(p.x, p.z), height: p.y }));
const smooth = (a, b, v) => THREE.MathUtils.smoothstep(v, a, b);
export function nearestMountainRoute(x, z) {
  let result = { distance: Infinity };
  for (let i = 1; i < MOUNTAIN_ROUTE.length; i++) {
    const a = MOUNTAIN_ROUTE[i - 1],
      b = MOUNTAIN_ROUTE[i];
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const t = THREE.MathUtils.clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
    const distance = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (distance < result.distance)
      result = { distance, height: THREE.MathUtils.lerp(a.height, b.height, t), index: i, t };
  }
  return result;
}
function authoredHeight(x, z) {
  const r = Math.hypot((x + 1) / 18, (z - 4) / 15);
  let h = 9.6 * (1 - smooth(0.22, 1, r));
  // Modest ridges disappear at the road and level summit.
  h +=
    Math.sin(x * 0.8 + z * 0.35) *
    Math.sin(z * 0.65) *
    0.22 *
    smooth(0.3, 0.7, r) *
    (1 - smooth(0.8, 1, r));
  // Keep the authored sculpted cliff exposed; complete it from behind.
  h *= 1 - (1 - smooth(12, 14, Math.abs(x))) * (1 - smooth(1.8, 4.6, z));
  const apron =
    0.55 * smooth(-8, -5, z) * (1 - smooth(2, 5, z)) * (1 - smooth(12, 14, Math.abs(x)));
  h = Math.max(h, apron);
  const summit = Math.hypot(x + 1, z - 6);
  h = THREE.MathUtils.lerp(9.6, h, smooth(2, 3.7, summit));
  const world = mountainWorld(x, z);
  const road = nearestMountainRoute(world.x, world.z);
  h = THREE.MathUtils.lerp(road.height, h, smooth(1.65, 3.1, road.distance));
  const border = Math.min(x + 18, 20 - x, z + 10, 18 - z);
  h = Math.max(0, h * smooth(0, 0.65, border));
  return (
    h -
    0.15 * (1 - smooth(0, 1.5, h)) +
    (landscapeHeight(world.x, world.z) - MOUNTAIN_BASE) * (1 - smooth(0, 2, h))
  );
}
const { minX, maxX, minZ, maxZ, step } = MOUNTAIN_GRID;
export const MOUNTAIN_COLUMNS = Math.round((maxX - minX) / step) + 1;
export const MOUNTAIN_ROWS = Math.round((maxZ - minZ) / step) + 1;
export const MOUNTAIN_HEIGHTS = Array.from({ length: MOUNTAIN_COLUMNS * MOUNTAIN_ROWS }, (_, i) =>
  authoredHeight(
    minX + (i % MOUNTAIN_COLUMNS) * step,
    minZ + Math.floor(i / MOUNTAIN_COLUMNS) * step,
  ),
);
export function mountainHeight(x, z) {
  const local = mountainLocal(x, z),
    lx = local.x,
    lz = local.z;
  if (lx < minX || lx > maxX || lz < minZ || lz > maxZ) return null;
  const gx = (lx - minX) / step,
    gz = (lz - minZ) / step;
  const ix = Math.min(MOUNTAIN_COLUMNS - 2, Math.floor(gx)),
    iz = Math.min(MOUNTAIN_ROWS - 2, Math.floor(gz));
  const u = gx - ix,
    v = gz - iz,
    i = iz * MOUNTAIN_COLUMNS + ix;
  const a = MOUNTAIN_HEIGHTS[i],
    b = MOUNTAIN_HEIGHTS[i + 1],
    c = MOUNTAIN_HEIGHTS[i + MOUNTAIN_COLUMNS],
    d = MOUNTAIN_HEIGHTS[i + MOUNTAIN_COLUMNS + 1];
  // Same diagonal as the exported triangles; never interpolate a different surface.
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
}
export function mountainNormal(x, z) {
  const e = 0.04;
  return new THREE.Vector3(
    -(mountainSupportHeight(x + e, z) - mountainSupportHeight(x - e, z)) / (2 * e),
    1,
    -(mountainSupportHeight(x, z + e) - mountainSupportHeight(x, z - e)) / (2 * e),
  ).normalize();
}
export function onMountainTrail(x, z, radius = 0) {
  return (
    nearestMountainRoute(x, z).distance <= 1.65 - radius ||
    Math.hypot(x - MOUNTAIN_SUMMIT.x, z - MOUNTAIN_SUMMIT.z) <= 2 - radius
  );
}

export function inMountainApproach(x, z) {
  const entry = MOUNTAIN_ROUTE[0],
    dx = entry.x - MOUNTAIN_GATE.x,
    dz = entry.z - MOUNTAIN_GATE.z;
  const t = THREE.MathUtils.clamp(
    ((x - MOUNTAIN_GATE.x) * dx + (z - MOUNTAIN_GATE.z) * dz) / (dx * dx + dz * dz),
    0,
    1,
  );
  return Math.hypot(x - MOUNTAIN_GATE.x - dx * t, z - MOUNTAIN_GATE.z - dz * t) <= 1.7;
}
export function mountainSupportHeight(x, z) {
  return Math.max(landscapeHeight(x, z), MOUNTAIN_BASE + (mountainHeight(x, z) ?? -Infinity));
}
