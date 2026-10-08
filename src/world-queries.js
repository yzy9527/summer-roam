import { roadPoint, roadFrame, terrainHeight } from './world-base.js';
import { culvertGroundHeight } from './culvert-profile.js';
import { paddyLift } from './paddy-profile.js';
import {
  canalOffset,
  canalWidth,
  canalBlend,
  canalCollisionMargin,
  bankHeight,
  isOpenCanalStation,
} from './canal-profile.js';
export * from './world-base.js';

// Composed physical world queries: no vehicle simulation or mesh construction.
export function canalCoordinates(x, z) {
  let s = Math.max(0, Math.min(200, z)),
    f,
    d;
  for (let i = 0; i < 8; i++) {
    f = roadFrame(s);
    d = (x - f.x) * f.nx + (z - f.z) * f.nz;
    s = Math.max(0, Math.min(200, z - f.nz * d));
  }
  f = roadFrame(s);
  d = (x - f.x) * f.nx + (z - f.z) * f.nz;
  return { s, d: d - canalOffset(s) };
}
export function landscapeHeight(x, z) {
  if (z < 0 || z > 205) return terrainHeight(x, z);
  const { s, d } = canalCoordinates(x, z),
    t = canalBlend(s),
    a = Math.abs(d),
    edge = canalWidth(s) / 2;
  const shift = 0.024 * t * Math.sin(s * 3.5 + Math.sign(d) * 1.9),
    remap = d - Math.sign(d) * shift * Math.max(0, Math.min(1, (a - edge) / 0.3));
  return culvertGroundHeight(
    x,
    z,
    terrainHeight(x, z) +
      (s >= 10 && s <= 190
        ? bankHeight(remap, s) +
          0.018 * t * Math.sin(s * 5 + d * 7) * Math.exp(-(((a - edge - 0.425) / 0.22) ** 2))
        : 0),
  );
}
// Only the authorized local bank changes vehicle/camera support height.
export function drivingHeight(x, z) {
  return landscapeHeight(x, z) + paddyLift(x, z, roadPoint);
}
export function regionAt() {
  return '夏日田野';
}
export function streamX(z) {
  const p = roadFrame(z);
  return p.x + p.nx * canalOffset(z);
}
export function inStream(x, z) {
  const { s, d } = canalCoordinates(x, z);
  return isOpenCanalStation(s) && Math.abs(d) < canalWidth(s) / 2 + canalCollisionMargin(s);
}
