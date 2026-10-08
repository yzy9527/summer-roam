import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnState, stepDrive, inStream, roadFrame } from '../src/drive.js';
import { canalOffset } from '../src/canal-profile.js';
import { culvertLayout, CULVERT_STATIONS, addCanalCulvert } from '../src/canal-culvert.js';
import * as THREE from 'three';

test('starting pad and grass over covered canal ends allow driving in every heading', () => {
  const points = [
    [-5, 4],
    [-5, 5],
    [-5.5, 4],
    [-5.5, 5],
  ];
  for (const station of [6, 7, 8, 192, 193, 194]) {
    const f = roadFrame(station),
      d = canalOffset(station);
    points.push([f.x + f.nx * d, f.z + f.nz * d]);
  }
  for (const [x, z] of points) {
    assert.equal(inStream(x, z), false);
    for (let i = 0; i < 24; i++) {
      const s = { ...spawnState(), x, z, heading: (i * Math.PI) / 12, speed: 1 };
      assert.equal(
        stepDrive(s, { forward: true }, 1 / 120),
        false,
        `blocked dry ground ${x},${z}, heading ${i}`,
      );
      assert(Math.hypot(s.x - x, s.z - z) > 0);
    }
  }
});

test('open water and vehicle corners at each exposed inlet still block driving', () => {
  for (const station of [10, 21, 60, 114, 174, 190]) {
    const f = roadFrame(station),
      d = canalOffset(station),
      x = f.x + f.nx * d,
      z = f.z + f.nz * d;
    assert(inStream(x, z));
    const s = { ...spawnState(), x, z, heading: f.heading, speed: 1 };
    assert(stepDrive(s, { forward: true }, 1 / 120));
    assert.equal(s.x, x);
    assert.equal(s.z, z);
  }
  for (const station of CULVERT_STATIONS) {
    const p = culvertLayout(station);
    const x = p.x + 0.8 * Math.sin(p.heading),
      z = p.z + 0.8 * Math.cos(p.heading);
    assert.equal(inStream(x, z), false, 'centre is on covered side');
    const s = { ...spawnState(), x, z, heading: p.heading };
    assert(stepDrive(s, {}, 0), 'front or rear extends into exposed water');
  }
});

test('inlet stone jambs retain their obstacle collisions', () => {
  const colliders = [];
  addCanalCulvert(
    new THREE.Scene(),
    colliders,
    [],
    null,
    (color) => new THREE.MeshStandardMaterial({ color }),
  );
  for (const c of colliders) {
    const s = { ...spawnState(), x: c.x, z: c.z };
    assert(stepDrive(s, {}, 0, colliders));
  }
});
