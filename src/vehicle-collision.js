import { VEHICLE_CONFIG } from './vehicle-config.js';
import { canalCoordinates } from './world-queries.js';
import { canalWidth, isOpenCanalStation } from './canal-profile.js';

export function vehicleObstacleGap(x, z, heading, c) {
  const dx = c.x - x,
    dz = c.z - z,
    cos = Math.cos(heading),
    sin = Math.sin(heading);
  const px = dx * cos - dz * sin,
    pz = dx * sin + dz * cos - VEHICLE_CONFIG.collisionCenterZ;
  const rx = Math.max(0, Math.abs(px) - VEHICLE_CONFIG.collisionHalfWidth),
    rz = Math.max(0, Math.abs(pz) - VEHICLE_CONFIG.collisionHalfLength);
  return Math.hypot(rx, rz) - c.radius;
}
export function vehicleHitsObstacle(x, z, heading, c) {
  return vehicleObstacleGap(x, z, heading, c) < 0.01;
}
// Dynamic colliders can move into a parked car or grow back after a bull charge.
// Existing overlap permits only a continuously separating path, never a deeper push.
export function vehicleSeparates(start, next, c) {
  let gap = vehicleObstacleGap(start.x, start.z, start.heading, c),
    distance = Math.hypot(start.x - c.x, start.z - c.z);
  if (gap >= 0.01) return false;
  const turn = Math.atan2(
    Math.sin(next.heading - start.heading),
    Math.cos(next.heading - start.heading),
  );
  const samples = Math.max(
    1,
    Math.ceil(Math.hypot(next.x - start.x, next.z - start.z) / 0.08),
    Math.ceil(Math.abs(turn) / 0.04),
  );
  for (let i = 1; i <= samples; i++) {
    const t = i / samples,
      x = start.x + (next.x - start.x) * t,
      z = start.z + (next.z - start.z) * t;
    const nextGap = vehicleObstacleGap(x, z, start.heading + turn * t, c),
      nextDistance = Math.hypot(x - c.x, z - c.z);
    if (nextGap < gap - 1e-7 || (nextGap <= gap + 1e-7 && nextDistance <= distance + 1e-7))
      return false;
    gap = nextGap;
    distance = nextDistance;
  }
  return true;
}
export function vehicleTouchesWater(x, z, heading) {
  const cos = Math.cos(heading),
    sin = Math.sin(heading);
  // Include front/rear midpoints: a narrow channel can pass between the corners.
  for (const along of [-1, 0, 1])
    for (const side of [-1, 0, 1]) {
      const a = along * VEHICLE_CONFIG.collisionHalfLength + VEHICLE_CONFIG.collisionCenterZ,
        b = side * VEHICLE_CONFIG.collisionHalfWidth;
      const { s, d } = canalCoordinates(x + sin * a + cos * b, z + cos * a - sin * b);
      if (isOpenCanalStation(s) && Math.abs(d) < canalWidth(s) / 2 + 0.02) return true;
    }
  return false;
}
