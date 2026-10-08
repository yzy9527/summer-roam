import test from 'node:test';
import assert from 'node:assert/strict';
import { masonryPlacements, masonryColliders } from '../src/environment-sample.js';
import { roadFrame, spawnState, stepDrive, nearestRoad } from '../src/drive.js';
const sets = masonryPlacements(),
  colliders = masonryColliders(sets),
  empty = { forward: false, backward: false, left: false, right: false, brake: false };
test('real masonry and bridge collision bounds leave the complete driving lane clear', () => {
  assert(sets.flat().length > 100);
  for (const q of sets.flat()) {
    assert(Number.isFinite(q.y));
    const d = nearestRoad(q.x, q.z).distance;
    assert(
      d - Math.hypot(q.sx / 2, q.sz / 2) - 0.035 - 0.88 > 2.25,
      'stone clearance across full road width',
    );
  }
  const s = 21,
    f = roadFrame(s);
  assert(
    Math.hypot(f.x - colliders.at(-1).x, f.z - colliders.at(-1).z) -
      colliders.at(-1).radius -
      0.88 >
      2.25,
  );
});
test('vehicles cannot enter visible stone fragments in either transition', () => {
  for (const q of sets.flat().filter((q) => q.z < 14 || q.z > 28)) {
    const r = nearestRoad(q.x, q.z),
      dx = q.x - r.point.x,
      dz = q.z - r.point.z;
    const car = { ...spawnState(), x: r.point.x, z: r.point.z, heading: Math.atan2(dx, dz) };
    let hits = 0;
    for (let n = 0; n < 360; n++)
      if (stepDrive(car, { ...empty, forward: true }, 1 / 120, colliders)) hits++;
    assert(hits > 0);
    assert(Math.hypot(car.x - q.x, car.z - q.z) > 0.88, 'no body penetration');
  }
});
