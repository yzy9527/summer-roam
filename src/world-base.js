import { NOHARA_HOUSE_SITE, houseSiteHeight } from './nohara-house-site.js';
import { nearestFieldRoad, onStartingPlatform } from './road-network.js';

// Metres, seconds, radians. Shared by the renderer and the driving simulation.
export const TAU = Math.PI * 2;
export const ROAD_LENGTH = 200,
  ROAD_WIDTH = 4.5;
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function roadPoint(distance) {
  const z = Math.max(0, Math.min(ROAD_LENGTH, distance));
  return { x: -18 * smooth(18, 105, z) - 8 * smooth(120, 185, z), z };
}
export function roadFrame(distance) {
  const p = roadPoint(distance),
    a = roadPoint(Math.max(0, distance - 0.1)),
    b = roadPoint(Math.min(ROAD_LENGTH, distance + 0.1)),
    heading = Math.atan2(b.x - a.x, b.z - a.z);
  return { ...p, heading, nx: Math.cos(heading), nz: -Math.sin(heading) };
}
export const roadSamples = Array.from({ length: 401 }, (_, i) => roadPoint(i * 0.5));
const mainRoadBounds = {
  minX: Math.min(...roadSamples.map((p) => p.x)) - ROAD_WIDTH / 2 - 0.18,
  maxX: Math.max(...roadSamples.map((p) => p.x)) + ROAD_WIDTH / 2 + 0.18,
  minZ: roadSamples[0].z - ROAD_WIDTH / 2 - 0.18,
  maxZ: roadSamples.at(-1).z + ROAD_WIDTH / 2 + 0.18,
};
export function nearestMainRoad(x, z) {
  let best = { distance: Infinity, point: null, index: 0, side: 0 };
  for (let i = 0; i < roadSamples.length - 1; i++) {
    const a = roadSamples[i],
      b = roadSamples[i + 1],
      dx = b.x - a.x,
      dz = b.z - a.z,
      t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz))),
      px = a.x + dx * t,
      pz = a.z + dz * t,
      d = Math.hypot(x - px, z - pz);
    if (d < best.distance)
      best = {
        distance: d,
        point: { x: px, z: pz },
        index: i,
        side: Math.sign((x - px) * dz - (z - pz) * dx),
      };
  }
  return best;
}
export function nearestRoad(x, z) {
  const main = nearestMainRoad(x, z),
    field = nearestFieldRoad(x, z);
  return field.distance < main.distance ? { ...field, index: 0, side: 0 } : main;
}
export function islandDistance(x, z) {
  return Math.max(Math.abs(x) - 175, -z - 35, z - 245);
}
export function coastline() {
  return 175;
}
function originalTerrainHeight(x, z) {
  const road = roadPoint(z),
    right = smooth(-road.x + 12, -road.x + 35, -x),
    hill = smooth(115, 205, z);
  return 0.12 + hill * 1.9 + right * (0.6 + 0.55 * Math.sin(z * 0.035) ** 2);
}
export function terrainHeight(x, z) {
  return houseSiteHeight(
    x,
    z,
    originalTerrainHeight(x, z),
    originalTerrainHeight(NOHARA_HOUSE_SITE.x, NOHARA_HOUSE_SITE.z),
  );
}

export function isRoadSurface(x, z) {
  return (
    onStartingPlatform(x, z) ||
    nearestFieldRoad(x, z).distance < ROAD_WIDTH / 2 + 0.18 ||
    Math.hypot(x, z) < 7.7 ||
    Math.hypot(x + 26, z - 200) < 8 ||
    (x >= mainRoadBounds.minX &&
      x <= mainRoadBounds.maxX &&
      z >= mainRoadBounds.minZ &&
      z <= mainRoadBounds.maxZ &&
      nearestMainRoad(x, z).distance < ROAD_WIDTH / 2 + 0.18)
  );
}
