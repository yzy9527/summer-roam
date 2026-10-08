import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { STARTING_PLATFORM as P, fieldRoadPaths } from '../src/road-network.js';
import { createStartingPlatform } from '../src/starting-platform.js';
import {
  spawnState,
  stepDrive,
  isRoadSurface,
  inStream,
  islandDistance,
  drivingHeight,
} from '../src/drive.js';
import { roadsidePlantAllowed } from '../src/roadside-planting.js';
import { grassAllowed } from '../src/summer-grass.js';

test('original platform remains drivable facing the outer straight road', () => {
  const s = { ...spawnState(), x: P.x, z: P.z, heading: P.heading };
  assert.equal(s.x, 132);
  assert.equal(s.z, 10);
  assert.equal(s.heading, 0);
  assert.equal(s.speed, 0);
  let hits = 0;
  for (let i = 0; i < 360; i++) if (stepDrive(s, { forward: true }, 1 / 120)) hits++;
  assert.equal(hits, 0);
  assert.equal(s.x, P.x);
  assert(s.z > P.z + P.radius);
  assert.equal(s.surface, '公路');
});

test('rendered platform matches driveable bounds and excludes shoulder plants', () => {
  const asphalt = new THREE.MeshStandardMaterial({ color: '#cdc7c0' }),
    mesh = createStartingPlatform(asphalt);
  const vertices = mesh.geometry.attributes.position,
    uv = mesh.geometry.attributes.uv;
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  assert(Math.abs(box.min.x - (P.x - P.radius)) < 1e-5);
  assert(Math.abs(box.max.z - (P.z + P.radius)) < 1e-5);
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i),
      z = vertices.getZ(i);
    assert(Math.abs(vertices.getY(i) - drivingHeight(x, z) - 0.035) < 1e-6);
    assert(Math.abs(uv.getX(i) - x * 0.23) < 1e-5);
  }
  for (let r = 0; r <= P.radius - 0.1; r += 0.5)
    for (let i = 0; i < 24; i++) {
      const x = P.x + r * Math.cos((i * Math.PI) / 12),
        z = P.z + r * Math.sin((i * Math.PI) / 12);
      assert(isRoadSurface(x, z));
      assert(!inStream(x, z));
      assert(islandDistance(x, z) < -2);
      assert.equal(roadsidePlantAllowed(x, z), false);
      assert.equal(grassAllowed(x, z, []), false);
      for (const heading of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const s = { ...spawnState(), x, z, heading, speed: 1 };
        assert.equal(stepDrive(s, {}, 1 / 120), false);
      }
    }
  assert(mesh.receiveShadow);
  assert(mesh.material.polygonOffset);
  assert.notEqual(mesh.material, asphalt);
});

test('bottom lane and curved corner stay connected to the new platform', () => {
  const path = fieldRoadPaths[0];
  for (let i = 1; i < path.length && path[i].z <= P.z; i++) {
    const a = path[i - 1],
      b = path[i],
      heading = Math.atan2(b.x - a.x, b.z - a.z);
    for (let j = 0; j <= 20; j++) {
      const x = a.x + ((b.x - a.x) * j) / 20,
        z = a.z + ((b.z - a.z) * j) / 20;
      assert(isRoadSurface(x, z));
      assert.equal(
        stepDrive({ ...spawnState(), x, z, heading, speed: 1 }, { forward: true }, 1 / 120),
        false,
      );
    }
  }
});
