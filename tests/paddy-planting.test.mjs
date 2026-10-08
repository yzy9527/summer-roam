import test from 'node:test';
import assert from 'node:assert/strict';
import { roadPoint, roadFrame, nearestRoad } from '../src/drive.js';
import {
  paddyLayout,
  paddyContour,
  paddyDistance,
  insidePaddy,
  paddyLift,
} from '../src/paddy-profile.js';
import { paddySurfaceGeometry } from '../src/paddy-geometry.js';
import { roadsidePlantAllowed } from '../src/roadside-planting.js';
import { grassAllowed } from '../src/summer-grass.js';
test('rounded water outlines reserve the road planting strip and exclude square corners', () => {
  for (const p of paddyLayout(roadPoint)) {
    assert(
      paddyDistance(
        p,
        p.x + (p.halfX ?? 10.15) - 0.05,
        p.z + (p.halfZ ?? 10.65) - 0.05,
        roadPoint,
      ) > 0,
    );
    for (const q of paddyContour(p, roadPoint)) {
      assert(Math.abs(paddyDistance(p, q.x, q.z, roadPoint)) < 0.00001);
      assert(nearestRoad(q.x, q.z).distance > 5.1);
    }
    const g = paddySurfaceGeometry(p),
      v = g.attributes.position;
    for (let i = 0; i < v.count; i++)
      assert(paddyDistance(p, v.getX(i), v.getZ(i), roadPoint) < 0.025);
  }
});
test('joined working field has continuous water and mud across both former banks, with one outer contour', () => {
  const fields = paddyLayout(roadPoint),
    p = fields.find((p) => p.working);
  assert.equal(fields.filter((p) => p.col === 4 && p.row === 2).length, 0);
  assert.deepEqual(p.mergedRows, [1, 2]);
  for (let z = 12; z <= 53; z += 0.1) {
    assert(insidePaddy(p.x, z, roadPoint));
    assert(paddyDistance(p, p.x, z, roadPoint) < -1);
    assert.equal(paddyLift(p.x, z, roadPoint), 0, 'no invisible interior bank');
  }
  const v = paddySurfaceGeometry(p).attributes.position;
  let minZ = Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < v.count; i++) {
    minZ = Math.min(minZ, v.getZ(i));
    maxZ = Math.max(maxZ, v.getZ(i));
  }
  assert(maxZ - minZ > 45, 'visible water covers both original fields');
});
test('both shoulders have dry planting room while fields and pavement reject grass and flowers', () => {
  const paddies = paddyLayout(roadPoint);
  for (const s of [42, 85, 150]) {
    const f = roadFrame(s);
    for (const side of [-1, 1]) {
      const x = f.x + f.nx * 3.45 * side,
        z = f.z + f.nz * 3.45 * side;
      assert(grassAllowed(x, z, []));
      assert(roadsidePlantAllowed(x, z, 0.18));
    }
    assert(!roadsidePlantAllowed(f.x, f.z));
  }
  for (const p of paddies) {
    assert(insidePaddy(p.x, p.z, roadPoint));
    assert(!roadsidePlantAllowed(p.x, p.z));
  }
});
