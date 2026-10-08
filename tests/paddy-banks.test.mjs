import test from 'node:test';
import assert from 'node:assert/strict';
import { paddyLayout, paddyLift, paddyContour } from '../src/paddy-profile.js';
import { paddyBankGeometry } from '../src/paddy-banks.js';
import { roadPoint, roadFrame, terrainHeight, drivingHeight } from '../src/drive.js';
test('all 44 rounded paddy banks share the visible and physical support profile, including the joined field', () => {
  const fields = paddyLayout(roadPoint);
  assert.equal(fields.length, 44);
  for (const p of fields) {
    const g = paddyBankGeometry(p),
      v = g.attributes.position;
    for (let i = 0; i < v.count; i++) {
      const x = v.getX(i),
        z = v.getZ(i);
      assert(Math.abs(v.getY(i) - (terrainHeight(x, z) + paddyLift(x, z, roadPoint))) < 2e-5);
      assert(Math.abs(drivingHeight(x, z) - v.getY(i)) < 2e-5);
    }
    for (let i = 0; i < g.index.count; i += 3) {
      const a = g.index.getX(i),
        b = g.index.getX(i + 1),
        c = g.index.getX(i + 2),
        y =
          (v.getZ(b) - v.getZ(a)) * (v.getX(c) - v.getX(a)) -
          (v.getX(b) - v.getX(a)) * (v.getZ(c) - v.getZ(a));
      assert(y > 0);
    }
    assert.equal(paddyLift(p.x, p.z, roadPoint), 0);
    for (const q of paddyContour(p, roadPoint, 0.425, 16))
      assert(paddyLift(q.x, q.z, roadPoint) > 0.075);
  }
});
test('paddy banks preserve the driving lane and change smoothly without box end faces', () => {
  for (let s = 0; s <= 200; s += 0.25) {
    const f = roadFrame(s);
    for (const d of [-2.25, 0, 2.25])
      assert.equal(paddyLift(f.x + f.nx * d, f.z + f.nz * d, roadPoint), 0);
  }
  for (const p of paddyLayout(roadPoint))
    for (let d = -11.7; d <= 11.7; d += 0.01) {
      const x = p.x + d,
        z = p.z + 11.075;
      assert(Math.abs(paddyLift(x, z, roadPoint) - paddyLift(x + 0.01, z, roadPoint)) < 0.005);
    }
});
