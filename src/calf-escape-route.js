import { CORRAL } from './corral-model.js';

// Shared landmarks for escape navigation and the giant's post-delivery patrol.
export const CALF_ESCAPE_ROUTE = Object.freeze([
  Object.freeze({ x: CORRAL.x, z: CORRAL.z - CORRAL.halfZ }),
  Object.freeze({ x: 168, z: -27 }),
  Object.freeze({ x: -26, z: -27 }),
]);

export function nearestEscapePoint(point) {
  let best = null;
  for (let i = 1; i < CALF_ESCAPE_ROUTE.length; i++) {
    const a = CALF_ESCAPE_ROUTE[i - 1],
      b = CALF_ESCAPE_ROUTE[i];
    const dx = b.x - a.x,
      dz = b.z - a.z,
      length = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / length ** 2));
    const x = a.x + dx * t,
      z = a.z + dz * t;
    const distance = Math.hypot(point.x - x, point.z - z);
    if (!best || distance < best.distance)
      best = { x, z, distance, dx: dx / length, dz: dz / length };
  }
  return best;
}
