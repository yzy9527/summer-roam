// Additional lanes on the driver's left (+x when travelling towards +z).
export const FIELD_ROAD_WIDTH = 4.5,
  FIELD_ROAD_OUTER_X = 132;
export const STARTING_PLATFORM = Object.freeze({
  x: FIELD_ROAD_OUTER_X,
  z: 10,
  radius: 7.5,
  heading: 0,
});
export function onStartingPlatform(x, z, padding = 0) {
  return (
    Math.hypot(x - STARTING_PLATFORM.x, z - STARTING_PLATFORM.z) <
    STARTING_PLATFORM.radius + padding
  );
}
function outerPath() {
  const p = [
    { x: 0, z: 0 },
    { x: 122, z: 0 },
  ];
  for (let i = 1; i <= 20; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 40;
    p.push({ x: 122 + 10 * Math.cos(a), z: 10 + 10 * Math.sin(a) });
  }
  p.push({ x: 132, z: 190 });
  for (let i = 1; i <= 20; i++) {
    const a = (i * Math.PI) / 40;
    p.push({ x: 122 + 10 * Math.cos(a), z: 190 + 10 * Math.sin(a) });
  }
  p.push({ x: -26, z: 200 });
  return p;
}
export const fieldRoadPaths = [outerPath()];
export function nearestFieldRoad(x, z) {
  let best = { distance: Infinity, point: null };
  for (const path of fieldRoadPaths)
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i],
        dx = b.x - a.x,
        dz = b.z - a.z,
        t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz))),
        point = { x: a.x + dx * t, z: a.z + dz * t },
        distance = Math.hypot(x - point.x, z - point.z);
      if (distance < best.distance) best = { distance, point };
    }
  return best;
}
export function fieldRoadClearance(x, z) {
  return nearestFieldRoad(x, z).distance;
}
export function fieldRoadBankFade(x, z) {
  const t = Math.max(0, Math.min(1, fieldRoadClearance(x, z) - 2.8));
  return t * t * (3 - 2 * t);
}
