import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canalWidth,
  canalOffset,
  waterLevel,
  bankHeight,
  localCanalBlend,
} from '../src/canal-profile.js';
import { fieldGroundGeometry, fieldGroundHeight } from '../src/field-landscape.js';
import { terrainHeight, roadFrame, inStream, isRoadSurface } from '../src/drive.js';
test('full canal bed remains below water and the driving lane stays clear', () => {
  for (let s = 8; s <= 192; s += 0.5) {
    const f = roadFrame(s),
      off = canalOffset(s),
      x = f.x + f.nx * off,
      z = f.z + f.nz * off;
    assert(canalWidth(s) >= 1.2 && canalWidth(s) <= 1.6);
    if (s <= 10 || s >= 33) assert.equal(canalWidth(s), 1.2);
    if (s >= 10 && s <= 190)
      assert(fieldGroundHeight(x, z) < terrainHeight(x, z) + waterLevel(s) - 0.14);
    assert.equal(inStream(x, z), s >= 10 && s <= 190);
    for (const d of [-2.25, 0, 2.25]) {
      const px = f.x + f.nx * d,
        pz = f.z + f.nz * d;
      assert(!inStream(px, pz));
      assert(Math.abs(fieldGroundHeight(px, pz) - terrainHeight(px, pz)) < 1e-8);
    }
    assert(isRoadSurface(f.x, f.z));
  }
});
test('single ground mesh has no interior seams or reversed top faces', () => {
  const g = fieldGroundGeometry(),
    p = g.attributes.position,
    edges = new Map();
  for (let i = 0; i < g.index.count; i += 3) {
    const a = g.index.getX(i),
      b = g.index.getX(i + 1),
      c = g.index.getX(i + 2);
    const y =
      (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a)) -
      (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a));
    assert(y > 0);
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = [u, v].sort((x, y) => x - y).join(',');
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  for (const [key, n] of edges) {
    assert(n <= 2);
    if (n === 1) {
      for (const id of key.split(',').map(Number)) {
        const x = p.getX(id),
          z = p.getZ(id);
        assert(Math.abs(x) === 300 || z === -110 || z === 550);
        assert(Math.abs(p.getY(id) - terrainHeight(x, z)) < 1e-5);
      }
    }
  }
});
test('water and channel fade into dry ground before both turning pads', () => {
  for (const s of [4, 196]) {
    assert(Math.abs(waterLevel(s)) < 1e-9);
    assert(Math.abs(bankHeight(0, s)) < 1e-9);
  }
  for (let s = 4.01; s < 196; s += 0.01)
    assert(Math.abs(waterLevel(s) - waterLevel(s - 0.01)) < 0.002);
});

test('local stone cut widens and lowers smoothly, without changing the outer canal', () => {
  assert.equal(canalWidth(21), 1.6);
  assert.equal(waterLevel(21), -0.48);
  for (let s = 4; s <= 196; s += 0.05) {
    assert(Math.abs(canalWidth(s) - canalWidth(s - 0.05)) < 0.009);
    assert(Math.abs(waterLevel(s) - waterLevel(s - 0.05)) < 0.01);
    if (s < 10 || s > 33) {
      assert.equal(localCanalBlend(s), 0);
      assert.equal(canalWidth(s), 1.2);
    }
  }
  for (let s = 14; s <= 28; s += 0.5) {
    const f = roadFrame(s),
      off = canalOffset(s);
    for (const side of [-1, 1]) {
      assert(
        inStream(f.x + f.nx * (off + side * 0.9), f.z + f.nz * (off + side * 0.9)),
        'stone wall vehicle clearance',
      );
      const d = off + side * 1.9;
      assert(!inStream(f.x + f.nx * d, f.z + f.nz * d), 'bank route remains outside collision');
    }
    assert(bankHeight(0.8, s) < waterLevel(s));
    assert(Math.abs(bankHeight(1.08, s)) < 1e-8);
  }
});

// Widening moves the outer bank, retaining the road-facing edge.
test('wider channel retains its former road-side shoreline', () => {
  for (const s of [10, 21, 34, 114, 174, 190]) {
    const formerOffset = -6.8 + 2.2;
    const formerWidth = 0.85 + 0.45 * localCanalBlend(s);
    assert(Math.abs(canalOffset(s) + canalWidth(s) / 2 - (formerOffset + formerWidth / 2)) < 1e-8);
  }
});

test('open channel water uses the same low middle-section level through both endpoints', () => {
  for (let s = 10; s <= 190; s += 0.5) assert.equal(waterLevel(s), -0.48);
});
