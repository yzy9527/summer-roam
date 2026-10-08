import { inStream, islandDistance, isRoadSurface } from './world-queries.js';
import { insidePaddy } from './paddy-profile.js';
import { roadPoint } from './world-base.js';
import { vehicleObstacleGap } from './vehicle-collision.js';

export function circlePointClear(x, z, radius, obstacles, margin = 0, ignore) {
  return !obstacles.some(
    (c) => c !== ignore && Math.hypot(x - c.x, z - c.z) < radius + c.radius + margin,
  );
}

export function actorPointAllowed(
  x,
  z,
  actor,
  obstacles,
  car,
  { home, range, avoidRoad = false } = {},
) {
  const radius = actor.radius;
  if (home && Math.hypot(x - home.x, z - home.z) > range) return false;
  for (const [dx, dz] of [
    [0, 0],
    [radius, 0],
    [-radius, 0],
    [0, radius],
    [0, -radius],
  ]) {
    if (islandDistance(x + dx, z + dz) > -2 || inStream(x + dx, z + dz)) return false;
    if (insidePaddy(x + dx, z + dz, roadPoint, 0.05)) return false;
    if (avoidRoad && isRoadSurface(x + dx, z + dz)) return false;
  }
  if (!circlePointClear(x, z, radius, obstacles, 0.08, actor.collider)) return false;
  return !car || vehicleObstacleGap(car.x, car.z, car.heading, { x, z, radius }) > 0.1;
}

export function clearSegment(a, b, allowed, spacing = 0.08) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / spacing));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (!allowed(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

// Bounded grid search around home; shortcuts retain full swept-body checks.
export function actorRoute(start, goal, allowed, home, range = 12) {
  if (!allowed(goal.x, goal.z)) return null;
  if (clearSegment(start, goal, allowed)) return [goal];
  const cell = 0.65,
    count = Math.ceil((range * 2) / cell) + 1;
  const origin = { x: home.x - range, z: home.z - range };
  const point = (key) => ({
    x: origin.x + (key % count) * cell,
    z: origin.z + Math.floor(key / count) * cell,
  });
  const index = (p) => {
    const x = Math.round((p.x - origin.x) / cell),
      z = Math.round((p.z - origin.z) / cell);
    return x < 0 || z < 0 || x >= count || z >= count ? -1 : z * count + x;
  };
  const first = index(start);
  if (first < 0) return null;
  const queue = [first],
    previous = new Map([[first, null]]);
  for (let i = 0; i < queue.length; i++) {
    const key = queue[i],
      p = key === first ? start : point(key);
    if (Math.hypot(p.x - goal.x, p.z - goal.z) < cell * 1.5 && clearSegment(p, goal, allowed)) {
      const path = [goal];
      for (let k = key; k !== first; k = previous.get(k)) path.unshift(point(k));
      return path;
    }
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
    ]) {
      const x = (key % count) + dx,
        z = Math.floor(key / count) + dz;
      if (x < 0 || z < 0 || x >= count || z >= count) continue;
      const next = z * count + x;
      if (!previous.has(next) && clearSegment(p, point(next), allowed)) {
        previous.set(next, key);
        queue.push(next);
      }
    }
  }
  return null;
}
