import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assembleVehicle } from '../src/vehicle-runtime.js';
import { createVehicleLightControl, createVehicleLights } from '../src/vehicle-lights.js';

test('night defaults to low beam; manual off persists until a new night; toggling remembers high beam', () => {
  const control = createVehicleLightControl();
  assert.equal(control.snapshot().mode, 'off');
  assert.equal(control.toggleBeam(), false);
  control.setTimeOfDay('night');
  assert.equal(control.snapshot().mode, 'low');
  control.toggleBeam();
  assert.equal(control.snapshot().mode, 'high');
  control.toggle();
  control.setTimeOfDay('night');
  assert.equal(control.snapshot().mode, 'off');
  control.toggle();
  assert.equal(control.snapshot().mode, 'high');
  control.setTimeOfDay('day');
  assert.equal(control.snapshot().mode, 'off');
  control.toggle();
  assert.equal(control.snapshot().mode, 'high', 'manual daytime lighting is allowed');
  control.setTimeOfDay('night');
  assert.equal(control.snapshot().mode, 'low');
  const before = control.snapshot();
  control.select('invalid');
  control.setTimeOfDay('invalid');
  assert.deepEqual(control.snapshot(), before);
});

for (const assetName of ['surf-car-09', 'surf-car-09-base']) {
  test(`${assetName}: real asset lights follow vehicle transforms and reuse their rig across modes`, async () => {
    globalThis.ProgressEvent ??= class {};
    const bytes = readFileSync(new URL(`../src/assets/models/${assetName}.glb`, import.meta.url));
    const asset = (
      await new GLTFLoader().parseAsync(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        '',
      )
    ).scene;
    const { car, body } = assembleVehicle(asset);
    const scene = new THREE.Scene();
    scene.add(car);
    const original = new Map(),
      originalNodes = new Map();
    body.traverse((node) => {
      if (node.isMesh) originalNodes.set(node, node.material);
      for (const m of node.material
        ? Array.isArray(node.material)
          ? node.material
          : [node.material]
        : [])
        original.set(m, { color: m.emissive.clone(), intensity: m.emissiveIntensity });
    });
    const controller = createVehicleLights(car, body);
    const rig = car.getObjectByName('Vehicle headlights');
    const lamps = rig.children.filter((node) => node.isSpotLight);
    const children = rig.children.length;
    assert.equal(lamps.length, 1, 'the pair shares one shadow pass');
    assert(lamps.every((light) => !light.visible && light.intensity === 0));
    controller.setMode('low');
    const low = lamps[0];
    const lowDistance = low.distance,
      lowAngle = low.angle,
      lowIntensity = low.intensity;
    assert(lamps.every((light) => light.castShadow && light.visible));
    car.position.set(7, 2, 8);
    car.rotation.set(0.12, Math.PI / 2, 0.06);
    scene.updateMatrixWorld(true);
    const direction = low.target
      .getWorldPosition(new THREE.Vector3())
      .sub(low.getWorldPosition(new THREE.Vector3()))
      .normalize();
    assert(direction.x > 0.9, 'beam follows a ninety-degree vehicle turn');
    controller.setMode('high');
    assert(low.distance > lowDistance && low.angle < lowAngle && low.intensity > lowIntensity);
    assert(low.target.position.y > 0, 'high beam aims above low beam');
    for (const [material, saved] of original) {
      assert.deepEqual(material.emissive, saved.color, 'asset source material is not mutated');
      assert.equal(material.emissiveIntensity, saved.intensity);
    }
    assert.equal(rig.children.length, children);
    controller.setMode('off');
    assert(lamps.every((light) => !light.visible && light.intensity === 0));
    body.traverse((node) => {
      for (const m of node.material
        ? Array.isArray(node.material)
          ? node.material
          : [node.material]
        : []) {
        if (['Headlight glass', 'Red rear lenses'].includes(m.name)) {
          assert.equal(m.emissiveIntensity, 1);
          assert.equal(m.emissive.getHex(), 0);
        }
      }
    });
    if (assetName === 'surf-car-09') assert.equal(controller.snapshot().lenses, 6);
    const clones = new Set();
    body.traverse((node) => {
      for (const material of node.material
        ? Array.isArray(node.material)
          ? node.material
          : [node.material]
        : [])
        if (!original.has(material)) clones.add(material);
    });
    assert.equal(
      clones.size,
      assetName === 'surf-car-09' ? 2 : 0,
      'shared lamp materials are cloned once',
    );
    let disposed = 0;
    for (const material of clones) material.addEventListener('dispose', () => disposed++);
    controller.dispose();
    assert(!car.getObjectByName('Vehicle headlights'));
    assert.equal(disposed, clones.size);
    for (const [node, material] of originalNodes)
      assert.equal(node.material, material, 'disposing restores the original material references');
    controller.dispose();
    assert.equal(disposed, clones.size, 'repeated cleanup does not dispose materials twice');
  });
}
