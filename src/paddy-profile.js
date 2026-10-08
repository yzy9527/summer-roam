import { fieldRoadClearance } from './road-network.js';
// Shared natural water outline and soil berm support profile.
export function paddyLayout(roadPoint) {
  const fields = Array.from({ length: 45 }, (_, i) => {
    const row = Math.floor(i / 5),
      col = i % 5,
      z = row === 0 ? -8 : -4 + row * 24;
    return { row, col, z, x: Math.max(roadPoint(z - 12).x, roadPoint(z + 12).x) + 13 + col * 23 };
  });
  // Join the working field to its next neighbour along the rows. All water,
  // banks, planting and navigation consume this same continuous outline.
  const working = fields.find((p) => p.row === 1 && p.col === 4),
    neighbour = fields.find((p) => p.row === 2 && p.col === 4);
  const minX = Math.min(working.x, neighbour.x) - 10.15,
    maxX = Math.max(working.x, neighbour.x) + 10.15;
  Object.assign(working, {
    x: (minX + maxX) / 2,
    z: (working.z + neighbour.z) / 2,
    halfX: (maxX - minX) / 2,
    halfZ: (neighbour.z - working.z) / 2 + 10.65,
    working: true,
    mergedRows: [1, 2],
  });
  return fields.filter((p) => p !== neighbour);
}
export function paddyLift(x, z, roadPoint) {
  let lift = 0;
  for (const p of sharedPaddies(roadPoint)) {
    if (
      Math.abs(x - p.x) > (p.halfX ?? 10.15) + 1.25 ||
      Math.abs(z - p.z) > (p.halfZ ?? 10.65) + 1.25
    )
      continue;
    const d = paddyDistance(p, x, z, roadPoint),
      t = Math.abs(d - 0.425) / 0.62;
    if (t < 1)
      lift = Math.max(lift, (0.092 + 0.008 * Math.sin(x * 0.37 + z * 0.46)) * (1 - t * t) ** 2);
  }
  return lift;
}

// One smooth outline drives water, rice, berms and roadside planting exclusion.
const layouts = new WeakMap();
export function sharedPaddies(roadPoint) {
  if (!layouts.has(roadPoint)) layouts.set(roadPoint, paddyLayout(roadPoint));
  return layouts.get(roadPoint);
}
function smoothMax(a, b, k = 0.35) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}
export function paddyDistance(p, x, z, roadPoint) {
  const radius = 2.15,
    qx = Math.abs(x - p.x) - ((p.halfX ?? 10.15) - radius),
    qz = Math.abs(z - p.z) - ((p.halfZ ?? 10.65) - radius);
  const box = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - radius;
  const organic = box + 0.1 * Math.sin(x * 0.45 + z * 0.31) + 0.07 * Math.sin(z * 0.73 - x * 0.26);
  const dz = 0.1,
    slope = (roadPoint(z + dz).x - roadPoint(z - dz).x) / (2 * dz),
    mainDistance = Math.abs(x - roadPoint(z).x) / Math.hypot(1, slope);
  return smoothMax(organic, 5.25 - Math.min(mainDistance, fieldRoadClearance(x, z)));
}
export function insidePaddy(x, z, roadPoint, margin = 0) {
  return sharedPaddies(roadPoint).some(
    (p) =>
      Math.abs(x - p.x) < (p.halfX ?? 10.15) + 1.35 + margin &&
      Math.abs(z - p.z) < (p.halfZ ?? 10.65) + 1.35 + margin &&
      paddyDistance(p, x, z, roadPoint) <= margin,
  );
}
export function paddyContour(p, roadPoint, offset = 0, segments = 128) {
  const points = [];
  const reach = Math.hypot(p.halfX ?? 10.15, p.halfZ ?? 10.65) + Math.abs(offset) + 2;
  for (let i = 0; i < segments; i++) {
    const a = (i * Math.PI * 2) / segments,
      dx = Math.cos(a),
      dz = Math.sin(a);
    let lo = 0,
      hi = reach;
    for (let r = 0.25; r <= reach; r += 0.25) {
      if (paddyDistance(p, p.x + dx * r, p.z + dz * r, roadPoint) >= offset) {
        hi = r;
        lo = r - 0.25;
        break;
      }
    }
    for (let j = 0; j < 25; j++) {
      const r = (lo + hi) / 2;
      if (paddyDistance(p, p.x + dx * r, p.z + dz * r, roadPoint) < offset) lo = r;
      else hi = r;
    }
    const r = (lo + hi) / 2;
    points.push({ x: p.x + dx * r, z: p.z + dz * r });
  }
  return points;
}
