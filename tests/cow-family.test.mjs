import { loadAnimalGeometry as loadGeometry } from './helpers/animal-geometry.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { createAnimalAnimation } from '../src/animal-animation.js';
import { ANIMAL_PROFILES } from '../src/animal-profiles.js';
import { createCowBehavior } from '../src/cow-behavior.js';
import { createCowFamily } from '../src/cow-family.js';
import { ANIMAL_LAYOUT, animalPointAllowed } from '../src/field-animals.js';

test('real cow pair waits for actual speech, responds at five seconds, meets and releases lock', async () => {
  const animals = [];
  for (const config of ANIMAL_LAYOUT.filter((a) =>
    ['golden-cow', 'hornless-calf'].includes(a.id),
  )) {
    const { id, x, z } = config;
    const root = await loadGeometry(id),
      group = new THREE.Group(),
      box = new THREE.Box3().setFromObject(root, true),
      center = box.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -box.min.y, -center.z);
    group.add(root);
    group.scale.setScalar(0.4875);
    group.position.set(x, 0.12, z);
    group.rotation.y = -Math.PI / 2;
    const a = {
      ...config,
      radius: 1.5,
      x,
      z,
      homeX: x,
      homeZ: z,
      heading: -Math.PI / 2,
      scale: 0.4875,
      speed: 0.4,
      clock: 0,
      distance: 0,
      velocity: 0,
      look: 0,
      behavior: createCowBehavior('cow'),
      group,
    };
    a.rig = createAnimalAnimation(root, group, ANIMAL_PROFILES[id]);
    animals.push(a);
    assert.ok(a.rig.contactReach > 0.4);
  }
  const f = createCowFamily(animals, (x, z, a, car, pair) =>
      animalPointAllowed(x, z, a, [], animals, car, pair),
    ),
    tick = () => {
      f.update(1 / 60, {});
      for (const a of animals) {
        a.clock += 1 / 60;
        a.group.position.set(a.x, 0.12, a.z);
        a.group.rotation.y = a.heading;
        a.rig.update(1 / 60, a, 0, 0);
      }
    };
  assert.equal(f.reserve(), true);
  assert.equal(f.reserve(), false);
  for (let i = 0; i < 60; i++) tick();
  assert.equal(f.snapshot().phase, 'pending');
  f.event('playing');
  f.event('time', 4.99);
  for (let i = 0; i < 180; i++) tick();
  assert.equal(animals[0].heading, -Math.PI / 2);
  f.event('time', 5);
  for (let i = 0; i < 180; i++) tick();
  assert.ok(animals[0].heading > -0.1);
  f.event('ended');
  assert.equal(f.reserve(), false);
  let comfort = false,
    min = Infinity;
  for (let i = 0; i < 2400 && f.busy(); i++) {
    tick();
    if (f.snapshot().phase === 'comfort') {
      comfort = true;
      min = Math.min(min, animals[0].rig.contactPoint().distanceTo(animals[1].rig.contactPoint()));
    }
  }
  assert.equal(comfort, true);
  assert.equal(f.snapshot().reason, 'complete');
  assert.ok(min < 0.22, `nose gap ${min}`);
  assert.equal(f.reserve(), true);
  f.event('cancel');
  assert.equal(f.busy(), false);
  assert.ok(animals.every((a) => a.familyLook === undefined));
});
test('blocked meadow cancels safely, and dt zero freezes family timers', () => {
  const animals = ['golden-cow', 'hornless-calf'].map((id, i) => ({
    id,
    x: -11,
    z: 4 + i * 7,
    heading: 0,
    rig: { contactReach: 0.8 },
    behavior: { down: 0, raised: 0 },
  }));
  const f = createCowFamily(animals, () => false);
  f.reserve();
  f.event('playing');
  const s = f.snapshot();
  f.update(0, {});
  assert.deepEqual(f.snapshot(), s);
  f.event('ended');
  f.update(0.1, {});
  assert.equal(f.snapshot().reason, 'no-safe-route');
  assert.equal(f.busy(), false);
});
