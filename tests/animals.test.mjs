import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addFieldAnimals, animalPointAllowed, ANIMAL_LAYOUT } from '../src/field-animals.js';
import { landscapeHeight, roadFrame } from '../src/drive.js';
import { inAnimalMeadow, inBullPatrol } from '../src/animal-meadow.js';

test('expanded starting meadow stays outside the poles and bounds family retreats', () => {
  const poles = Array.from({ length: 8 }, (_, i) => {
    const f = roadFrame(12 + i * 26);
    return { x: f.x - f.nx * 9, z: f.z - f.nz * 9 };
  });
  for (const a of ANIMAL_LAYOUT) {
    for (let i = 0; i < 64; i++) {
      const angle = (i * Math.PI) / 32,
        x = a.x + Math.cos(angle) * a.range,
        z = a.z + Math.sin(angle) * a.range;
      assert.ok(inAnimalMeadow(x, z));
      assert.ok(poles.every((p) => Math.hypot(x - p.x, z - p.z) > 8));
    }
  }
  const a = { x: -18, z: 5, homeX: -18, homeZ: 5, range: 3, radius: 1 };
  assert.equal(animalPointAllowed(-16, 5, a, [], [], null), false);
  assert.equal(animalPointAllowed(-16, 5, a, [], [], null, [a]), false);
  assert.equal(animalPointAllowed(-22, 5, a, [], [], null, [a]), true);
});

test('four meadow animals wander safely, pause exactly and cull at distance', async () => {
  const original = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async (url) => {
    const root = new THREE.Group(),
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.8, 3.7));
    mesh.position.y = 1.4;
    root.add(mesh);
    return { scene: root };
  };
  try {
    const scene = new THREE.Scene(),
      colliders = [],
      warnings = [];
    const animals = await addFieldAnimals(scene, colliders, warnings);
    const initial = animals.snapshot();
    assert.equal(initial.length, ANIMAL_LAYOUT.length);
    assert.deepEqual(warnings, []);
    const traveled = new Set();
    for (let frame = 0; frame < 7200; frame++) {
      animals.update(1 / 60, { x: 0, z: 5 });
      const snapshot = animals.snapshot();
      for (const a of snapshot) {
        if (a.id === 'copper-cow') assert.ok(inBullPatrol(a.x, a.z));
        else assert.ok(Math.hypot(a.x - a.homeX, a.z - a.homeZ) <= a.range + 1e-6);
        assert.ok(animalPointAllowed(a.x, a.z, a, [], snapshot, { x: 0, z: 5 }));
        const collider = colliders.find((c) => c.x === a.x && c.z === a.z);
        assert.ok(collider);
        const group = scene.getObjectByName(a.id);
        assert.ok(Math.abs(group.position.y - landscapeHeight(a.x, a.z) - 0.025) < 1e-6);
        const start = initial.find((b) => b.id === a.id);
        if (Math.hypot(a.x - start.x, a.z - start.z) > 0.4) traveled.add(a.id);
      }
    }
    assert.equal(traveled.size, ANIMAL_LAYOUT.length);
    const before = animals.snapshot();
    for (let i = 0; i < 60; i++) animals.update(0, { x: 0, z: 5 });
    assert.deepEqual(animals.snapshot(), before);
    animals.update(0, { x: 0, z: 195 });
    assert.ok(animals.snapshot().every((a) => !a.visible));
  } finally {
    GLTFLoader.prototype.loadAsync = original;
  }
});

test('animal candidates reject road, scenery, vehicle and occupied grass', () => {
  const a = { homeX: -22, homeZ: 5, range: 12, radius: 1, x: -22, z: 5 };
  assert.equal(animalPointAllowed(0, 5, a, [], [], null), false);
  assert.equal(animalPointAllowed(-22, 5, a, [{ x: -22, z: 5, radius: 1 }], [], null), false);
  assert.equal(animalPointAllowed(-22, 5, a, [], [], { x: -22, z: 5 }), false);
  assert.equal(animalPointAllowed(-22, 5, a, [], [{ x: -22, z: 5, radius: 1 }], null), false);
  assert.equal(animalPointAllowed(-22, 5, a, [], [], null), true);
});

test('facial pivots preserve geometry, horns follow the head and expressions freeze on pause', async () => {
  const original = GLTFLoader.prototype.loadAsync,
    originalRandom = Math.random;
  Math.random = () => 0.1;
  GLTFLoader.prototype.loadAsync = async (url) => {
    const root = new THREE.Group();
    for (const [name, x, y, z] of [
      ['Continuous_quadruped_body_and_four_legs', 0, 1, 0],
      ['Continuous_tapered_head', 0, 2, 1],
      ['Swept_up_gray_horn', 0.3, 2.5, 1],
      ['Continuous_ivory_muzzle', 0, 1.8, 1.5],
      ['Lower_lip', 0, 1.6, 1.5],
      ['Hanging_curved_tail', 0, 1, -1],
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3));
      m.name = name;
      m.position.set(x, y, z);
      root.add(m);
    }
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(side * 0.7, 2.1, 1));
      m.name = 'Pointed_outer_ear_' + side;
      root.add(m);
    }
    return { scene: root };
  };
  try {
    const scene = new THREE.Scene(),
      animals = await addFieldAnimals(scene, [], []);
    const group = scene.getObjectByName('golden-cow'),
      head = group.getObjectByName('Animal_head_joint');
    const horn = group.getObjectByName('Swept_up_gray_horn');
    assert.equal(horn.parent, head);
    assert.equal(group.scale.x, 0.4875);
    assert.equal(animals.snapshot()[0].ears.length, 2);
    group.updateMatrixWorld(true);
    const local = group.worldToLocal(horn.getWorldPosition(new THREE.Vector3()));
    assert.ok(Math.abs(local.x - 0.3) < 1e-6);
    assert.ok(Math.abs(local.y - 1.65) < 1e-6);
    let jawMoved = false,
      headMoved = false;
    for (let i = 0; i < 3600; i++) {
      animals.update(1 / 60, { x: 0, z: 5 });
      const s = animals.snapshot()[0];
      jawMoved ||= s.jaw > 0.01;
      headMoved ||= Math.abs(s.head[1]) > 0.02;
    }
    assert.ok(jawMoved);
    assert.ok(headMoved);
    const before = animals.snapshot();
    animals.update(0, { x: 0, z: 5 });
    assert.deepEqual(animals.snapshot(), before);
  } finally {
    GLTFLoader.prototype.loadAsync = original;
    Math.random = originalRandom;
  }
});
