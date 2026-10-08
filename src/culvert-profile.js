import { roadFrame, terrainHeight } from './world-base.js';
import { CANAL, canalOffset, canalWidth, waterLevel, canalBankTop } from './canal-profile.js';

// Match the existing Three.js MathUtils arithmetic, including lerp operation order.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (x, y, t) => (1 - t) * x + t * y;
function smoothstep(x, min, max) {
  if (x <= min) return 0;
  if (x >= max) return 1;
  x = (x - min) / (max - min);
  return x * x * (3 - 2 * x);
}
export const CULVERT = { station: CANAL.openEnd, length: 1.0, width: 1.2, roof: 0.08 };
export const CULVERT_STATIONS = [CANAL.openStart, CANAL.openEnd];
export function culvertLayout(station = CULVERT.station) {
  const f = roadFrame(station),
    d = canalOffset(station),
    x = f.x + f.nx * d,
    z = f.z + f.nz * d,
    ground = terrainHeight(x, z),
    heading = f.heading + (station === 10 ? Math.PI : 0);
  const water = ground + waterLevel(station),
    bed = water - 0.2,
    bankTop = ground + canalBankTop(station),
    spring = bankTop - 0.08,
    rise = (canalWidth(station) / 2 + 0.2) * (Math.SQRT2 - 1);
  return {
    station,
    x,
    z,
    ground,
    heading,
    water,
    bed,
    bankTop,
    spring,
    rise,
    top: bankTop + rise,
    width: canalWidth(station),
    length: CULVERT.length,
    tailStart: 0.3,
  };
}
export function culvertGroundHeight(x, z, original) {
  for (const station of CULVERT_STATIONS) {
    const p = culvertLayout(station),
      dx = x - p.x,
      dz = z - p.z,
      across = dx * Math.cos(p.heading) - dz * Math.sin(p.heading),
      along = dx * Math.sin(p.heading) + dz * Math.cos(p.heading);
    if (along < -0.08 || along > 6.1 || Math.abs(across) > p.width / 2 + 0.38) continue;
    if (along >= 0 && along < 0.62 && Math.abs(across) > p.width / 2 + 0.07) {
      const base = terrainHeight(x, z),
        edge = 1 - smoothstep(Math.abs(across), p.width / 2 + 0.2, p.width / 2 + 0.44),
        fade = 1 - smoothstep(along, 0.22, 0.62);
      return lerp(base, p.bankTop + roofLift(p, across, along), edge * fade);
    }
    if (along <= p.tailStart && Math.abs(across) <= p.width / 2 + 0.07)
      return Math.min(original, p.bed);
    if (along > p.tailStart) {
      const fill = smoothstep(along, p.tailStart, p.length),
        edge = 1 - smoothstep(Math.abs(across), p.width / 2 + 0.07, p.width / 2 + 0.38),
        floor = Math.abs(across) <= p.width / 2 + 0.07 ? Math.min(original, p.bed) : original;
      return lerp(floor, terrainHeight(x, z), fill * edge);
    }
  }
  return original;
}
export function roofLift(p, x, z) {
  const half = p.width / 2 + 0.2,
    radius = half * Math.SQRT2,
    across = clamp(x, -half, half);
  // A 90-degree circular segment across the inlet, softened into the ground behind it.
  return (Math.sqrt(radius * radius - across * across) - half) * (1 - smoothstep(z, 0.12, 0.35));
}
