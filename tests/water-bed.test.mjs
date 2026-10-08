import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { canalBedGeometry, canalPebblePlacements, waterBedMaterial } from '../src/water-bed.js';
import { canalCoordinates, landscapeHeight } from '../src/world-queries.js';
import { canalWidth, waterLevel, CANAL } from '../src/canal-profile.js';
import { terrainHeight, roadPoint } from '../src/world-base.js';
import { paddyLayout, paddyDistance } from '../src/paddy-profile.js';
import { paddySurfaceGeometry } from '../src/paddy-geometry.js';

test('sand overlay follows the physical bed, stays submerged and ends at the covered inlets', () => {
  const geometry = canalBedGeometry(),
    positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const { s, d } = canalCoordinates(x, z);
    assert(s >= CANAL.openStart - 0.001 && s <= CANAL.openEnd + 0.001);
    assert(Math.abs(d) <= canalWidth(s) / 2 + 0.001);
    assert(Math.abs(y - landscapeHeight(x, z) - 0.004) < 0.00002);
    assert(y <= terrainHeight(x, z) + waterLevel(s) + 0.006);
    if (Math.abs(d) < canalWidth(s) * 0.25) assert(y < terrainHeight(x, z) + waterLevel(s) - 0.12);
  }
  for (let i = 0; i < geometry.index.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(positions, geometry.index.getX(i));
    const b = new THREE.Vector3().fromBufferAttribute(positions, geometry.index.getX(i + 1));
    const c = new THREE.Vector3().fromBufferAttribute(positions, geometry.index.getX(i + 2));
    assert(new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).y > 0);
  }
});

test('actual Blender pebbles remain under water and leave a clear central flow corridor', async () => {
  const bytes = await readFile(new URL('../src/assets/models/water-pebbles.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  gltf.scene.updateMatrixWorld(true);
  const bounds = Array.from({ length: 4 }, (_, i) => {
    const mesh = gltf.scene.getObjectByName(`Water_pebble_${i}`);
    assert(mesh?.isMesh);
    return new THREE.Box3().setFromObject(mesh, true);
  });
  const placements = canalPebblePlacements();
  assert.deepEqual(placements, canalPebblePlacements());
  assert(placements.length > 250 && placements.length < 900);
  for (const p of placements) {
    const { s, d } = canalCoordinates(p.x, p.z),
      b = bounds[p.variant];
    assert(Math.abs(d) > 0.1, 'central flow corridor stays open');
    assert(
      Math.abs(d) +
        Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z)) *
          p.radius <
        canalWidth(s) / 2,
    );
    assert(p.y + b.max.y * p.radius < terrainHeight(p.x, p.z) + waterLevel(s) - 0.025);
    assert(p.y + b.min.y * p.radius > landscapeHeight(p.x, p.z) - 0.025);
  }
});

test('paddy mud lies beneath the water with continuous shore attenuation and shared day/night controls', () => {
  for (const p of paddyLayout(roadPoint).filter((p) => p.col === 0)) {
    const water = paddySurfaceGeometry(p),
      mud = paddySurfaceGeometry(p, 0, 0.006);
    const depth = water.attributes.waterDepth,
      position = water.attributes.position;
    for (let i = 0; i < position.count; i++) {
      assert(Math.abs(position.getY(i) - mud.attributes.position.getY(i) - 0.042) < 0.000001);
      assert(depth.getX(i) >= 0 && depth.getX(i) <= 1);
      if (paddyDistance(p, position.getX(i), position.getZ(i), roadPoint) > -0.01)
        assert(depth.getX(i) < 0.02);
    }
  }
  const time = { value: 12 },
    night = { value: 0.5 };
  for (const canal of [false, true]) {
    const material = waterBedMaterial({ canal, time, night });
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    material.onBeforeCompile(shader);
    assert.equal(shader.uniforms.uBedNight, night);
    assert.equal(shader.uniforms.uBedTime, time);
  }
});
