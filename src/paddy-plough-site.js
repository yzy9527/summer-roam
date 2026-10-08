import { paddyLayout, paddyDistance } from './paddy-profile.js';
import { roadPoint, terrainHeight } from './world-base.js';

// The two existing fields now share one long working outline.
export const PLOUGH_FIELD = Object.freeze(paddyLayout(roadPoint).find((p) => p.working));
export const isPloughField = (p) => p.row === PLOUGH_FIELD.row && p.col === PLOUGH_FIELD.col;
export const ploughGround = (x, z) => terrainHeight(x, z) + 0.006;
export const ploughWater = (x, z) => terrainHeight(x, z) + 0.05;
export const inPloughField = (x, z, margin = 0.8) =>
  paddyDistance(PLOUGH_FIELD, x, z, roadPoint) < -margin;

export const PLOUGH_ROW_LENGTH = 30;
const lanes = [-6, -2, 2, 6],
  halfRow = PLOUGH_ROW_LENGTH / 2;
// The outer headland uses a shallow ellipse to fit the entire convoy inside
// the existing bank. Arc-length lookup keeps world speed uniform.
const returnDistances = [0];
for (let i = 1; i <= 256; i++) {
  const a = (i * Math.PI) / 256,
    b = ((i - 1) * Math.PI) / 256;
  returnDistances.push(
    returnDistances.at(-1) +
      Math.hypot(6 * (Math.cos(a) - Math.cos(b)), 3 * (Math.sin(a) - Math.sin(b))),
  );
}
const segments = [];
for (let i = 0; i < lanes.length; i++) {
  const direction = i % 2 ? -1 : 1;
  segments.push({ length: halfRow * 2, kind: 'row', x: lanes[i], direction });
  if (i < lanes.length - 1)
    segments.push({ length: Math.PI * 2, kind: 'turn', x: lanes[i] + 2, direction });
}
segments.push({ length: returnDistances.at(-1), kind: 'return' });
export const PLOUGH_ROUTE_LENGTH = segments.reduce((n, s) => n + s.length, 0);

// Arcs retain position and tangent continuity; every member follows the same
// route at a different distance, rather than cutting the cow's corners.
export function ploughRoute(distance, side = 0) {
  let d = ((distance % PLOUGH_ROUTE_LENGTH) + PLOUGH_ROUTE_LENGTH) % PLOUGH_ROUTE_LENGTH;
  let segment = segments.at(-1);
  for (const s of segments) {
    segment = s;
    if (d < s.length) break;
    d -= s.length;
  }
  let x, z, heading;
  if (segment.kind === 'row') {
    x = segment.x;
    z = segment.direction * (d - halfRow);
    heading = segment.direction > 0 ? 0 : Math.PI;
  } else if (segment.kind === 'turn') {
    const a = d / 2;
    x = segment.x - 2 * Math.cos(a);
    z = segment.direction * (halfRow + 2 * Math.sin(a));
    heading = Math.atan2(Math.sin(a), segment.direction * Math.cos(a));
  } else {
    let i = 1;
    while (i < 256 && returnDistances[i] < d) i++;
    const a =
      ((i - 1 + (d - returnDistances[i - 1]) / (returnDistances[i] - returnDistances[i - 1])) *
        Math.PI) /
      256;
    x = 6 * Math.cos(a);
    z = -halfRow - 3 * Math.sin(a);
    heading = Math.atan2(-6 * Math.sin(a), -3 * Math.cos(a));
  }
  return {
    x: PLOUGH_FIELD.x + x + Math.cos(heading) * side,
    z: PLOUGH_FIELD.z + z - Math.sin(heading) * side,
    heading,
    turning: segment.kind !== 'row',
  };
}
