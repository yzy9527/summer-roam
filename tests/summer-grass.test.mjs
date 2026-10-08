import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { grassAllowed, addSummerGrass } from '../src/summer-grass.js';
import { roadFrame, roadPoint, nearestRoad } from '../src/drive.js';
import { canalOffset } from '../src/canal-profile.js';
import { paddyLayout } from '../src/paddy-profile.js';
const paddies = paddyLayout(roadPoint);
function at(s, d) {
  const f = roadFrame(s);
  return { x: f.x + f.nx * d, z: f.z + f.nz * d };
}
test('short grass excludes paved lane, irrigation, crops and house footprints', () => {
  for (const s of [12, 42, 85, 150, 190])
    for (const d of [0, 2, -2, canalOffset(s)]) {
      const p = at(s, d);
      assert.equal(grassAllowed(p.x, p.z, []), false);
    }
  for (const p of paddies) assert.equal(grassAllowed(p.x, p.z, []), false);
  const p = at(42, 3.45);
  assert.equal(grassAllowed(p.x, p.z, []), true);
  assert.equal(grassAllowed(p.x, p.z, [{ ...p, radius: 3 }]), false);
});
test('road shoulder grass creates only current geometry and reuses it while moving', () => {
  const scene = new THREE.Scene();
  const cull = [];
  const grass = addSummerGrass(scene, cull, []);
  const geometries = scene.children.map((mesh) => mesh.geometry);
  for (const s of [42, 120, 190]) {
    grass.update(s, at(s, 0));
    assert.deepEqual(
      scene.children.map((mesh) => mesh.geometry),
      geometries,
    );
    for (const mesh of scene.children) {
      const shape = mesh.geometry.attributes.shape;
      for (let i = 0; i < shape.count; i++) assert.ok(shape.getX(i) <= 0.220001);
    }
  }
  assert.equal(cull.length, 0);
  assert.equal(grass.snapshot().retired, 0);
  assert.ok(grass.snapshot().blades > 0);
});

test('paving excludes leaf reach at road shoulders, turning discs and all bridge decks', () => {
  for (const s of [12, 42, 85, 150, 190])
    for (const d of [-3, -2.8, 2.8, 3]) {
      const p = at(s, d);
      assert.equal(grassAllowed(p.x, p.z, []), false);
    }
  for (const [x, z] of [
    [0, 0],
    [-26, 200],
  ])
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      assert.equal(grassAllowed(x + Math.cos(a) * 7.8, z + Math.sin(a) * 7.8, []), false);
    }
  for (const s of [21, 34, 114, 174]) {
    const p = at(s, canalOffset(s) + 0.95);
    assert.equal(grassAllowed(p.x, p.z, []), false);
  }
});

test('open fields use the ground texture without grass blades', () => {
  for (const s of [42, 85, 150])
    for (const d of [-20, -10, -5, 5, 10, 20]) {
      const p = at(s, d);
      assert.equal(grassAllowed(p.x, p.z, []), false);
    }
  const scene = new THREE.Scene();
  addSummerGrass(scene, [], []);
  for (const mesh of scene.children) {
    const roots = mesh.geometry.attributes.root;
    for (let i = 0; i < roots.count; i++) {
      const d = nearestRoad(roots.getX(i), roots.getZ(i)).distance;
      assert.ok(d >= 3.03998 && d <= 4.04002);
    }
  }
});
