import { inStream, isRoadSurface, islandDistance, roadPoint } from './world-queries.js';
import { insidePaddy } from './paddy-profile.js';
import { vehicleObstacleGap } from './vehicle-collision.js';

export function dryAnimalPoint(x, z, radius, colliders, car, ignore = () => false) {
  for (const [dx, dz] of [
    [0, 0],
    [radius, 0],
    [-radius, 0],
    [0, radius],
    [0, -radius],
  ]) {
    if (
      islandDistance(x + dx, z + dz) > -2 ||
      inStream(x + dx, z + dz) ||
      isRoadSurface(x + dx, z + dz) ||
      insidePaddy(x + dx, z + dz, roadPoint, 0.15)
    )
      return false;
  }
  if (colliders.some((c) => !ignore(c) && Math.hypot(x - c.x, z - c.z) < radius + c.radius + 0.12))
    return false;
  return !car || vehicleObstacleGap(car.x, car.z, car.heading ?? 0, { x, z, radius }) > 0.15;
}

export function clearAnimalSegment(a, b, allowed, spacing = 0.2) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / spacing));
  for (let i = 1; i <= steps; i++)
    if (!allowed(a.x + ((b.x - a.x) * i) / steps, a.z + ((b.z - a.z) * i) / steps)) return false;
  return true;
}

// A bounded grid searches the dry corridor around the road's southern endpoint.
// All accepted edges and the final simplified path are sampled at body clearance.
export function findAnimalPath(start, goal, allowed, options) {
  const search = animalPathSearch(start, goal, allowed, options);
  let result;
  do result = search.next();
  while (!result.done);
  return result.value;
}

// Yield between clearance samples, expansions and simplification checks so a
// caller can share a bounded search budget across all actors in a display frame.
export function* animalPathSearch(start, goal, allowed, { step = 1, padding = 10 } = {}) {
  function* sample(x, z) {
    yield;
    return allowed(x, z);
  }
  function* segment(a, b, spacing = 0.2) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / spacing));
    for (let i = 1; i <= steps; i++)
      if (!(yield* sample(a.x + ((b.x - a.x) * i) / steps, a.z + ((b.z - a.z) * i) / steps)))
        return false;
    return true;
  }
  if (!(yield* sample(goal.x, goal.z))) return null;
  if (yield* segment(start, goal)) return [{ ...goal }];
  const minX = Math.max(-40, Math.floor(Math.min(start.x, goal.x) - padding));
  const maxX = Math.min(171, Math.ceil(Math.max(start.x, goal.x) + padding));
  const minZ = Math.max(-31, Math.floor(Math.min(start.z, goal.z) - padding));
  const maxZ = Math.min(38, Math.ceil(Math.max(start.z, goal.z) + padding));
  const width = Math.ceil((maxX - minX) / step) + 1;
  const height = Math.ceil((maxZ - minZ) / step) + 1;
  const point = (key) => ({
    x: minX + (key % width) * step,
    z: minZ + Math.floor(key / width) * step,
  });
  const keyOf = (p) => Math.round((p.x - minX) / step) + Math.round((p.z - minZ) / step) * width;
  const first = keyOf(start),
    last = keyOf(goal);
  const open = [{ key: first, cost: 0, score: Math.hypot(goal.x - start.x, goal.z - start.z) }];
  const costs = new Map([[first, 0]]),
    previous = new Map(),
    visited = new Set(),
    safe = new Map();
  function* usable(key) {
    if (!safe.has(key)) {
      const p = point(key);
      safe.set(key, yield* sample(p.x, p.z));
    }
    return safe.get(key);
  }
  while (open.length) {
    yield;
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].score < open[best].score) best = i;
    const node = open.splice(best, 1)[0];
    if (visited.has(node.key)) continue;
    visited.add(node.key);
    const at = node.key === first ? start : point(node.key);
    if (node.key === last || Math.hypot(at.x - goal.x, at.z - goal.z) < step * 1.5) {
      if (yield* segment(at, goal)) {
        const route = [{ ...goal }];
        let key = node.key;
        while (key !== first) {
          yield;
          route.unshift(point(key));
          key = previous.get(key);
        }
        const result = [];
        let from = start;
        while (route.length) {
          let end = route.length - 1;
          while (end > 0 && !(yield* segment(from, route[end]))) end--;
          result.push(route[end]);
          from = route[end];
          route.splice(0, end + 1);
        }
        return result;
      }
    }
    const col = node.key % width,
      row = Math.floor(node.key / width);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const x = col + dx,
        z = row + dz;
      if (x < 0 || x >= width || z < 0 || z >= height) continue;
      const key = x + z * width;
      if (visited.has(key) || !(yield* usable(key))) continue;
      const next = point(key);
      if (!(yield* segment(at, next, 0.3))) continue;
      const cost = node.cost + Math.hypot(at.x - next.x, at.z - next.z);
      if (cost >= (costs.get(key) ?? Infinity)) continue;
      costs.set(key, cost);
      previous.set(key, node.key);
      open.push({ key, cost, score: cost + Math.hypot(goal.x - next.x, goal.z - next.z) });
    }
  }
  return null;
}
