import { loadAnimalGeometry as loadGeometry } from './helpers/animal-geometry.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { createAnimalAnimation } from '../src/animal-animation.js';
import { ANIMAL_PROFILES } from '../src/animal-profiles.js';
import { createCowBehavior } from '../src/cow-behavior.js';
import { createAnimalEncounters } from '../src/animal-encounters.js';
import { ANIMAL_LAYOUT, animalPointAllowed } from '../src/field-animals.js';

async function setup(random = () => 0, obstacles = []) {
  const animals = [];
  for (const config of ANIMAL_LAYOUT) {
    const root = await loadGeometry(config.id),
      group = new THREE.Group(),
      box = new THREE.Box3().setFromObject(root, true),
      size = box.getSize(new THREE.Vector3()),
      center = box.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -box.min.y, -center.z);
    group.add(root);
    group.scale.setScalar(config.scale);
    group.position.set(config.x, 0.12, config.z);
    group.rotation.y = -Math.PI / 2;
    const a = {
      ...config,
      homeX: config.x,
      homeZ: config.z,
      radius: Math.max(0.7, (Math.hypot(size.x, size.z) * config.scale) / 2),
      group,
      heading: -Math.PI / 2,
      clock: 0,
      distance: 0,
      velocity: 0,
      look: 0,
      behavior: createCowBehavior(ANIMAL_PROFILES[config.id].species),
    };
    a.rig = createAnimalAnimation(root, group, ANIMAL_PROFILES[config.id]);
    animals.push(a);
  }
  let familyBusy = false,
    chargeBusy = false;
  const f = createAnimalEncounters(
    animals,
    (x, z, a, car, pair) => animalPointAllowed(x, z, a, obstacles, animals, car, pair),
    { family: { busy: () => familyBusy }, charge: { busy: () => chargeBusy } },
    random,
  );
  const tick = () => {
    f.update(1 / 60, { x: 0, z: 0 });
    for (const a of animals) {
      a.clock += 1 / 60;
      a.group.position.set(a.x, 0.12, a.z);
      a.group.rotation.y = a.heading;
      a.rig.update(1 / 60, a, 0, 0);
    }
  };
  return {
    f,
    animals,
    tick,
    setFamily: (v) => (familyBusy = v),
    setCharge: (v) => (chargeBusy = v),
  };
}
test('real wolf safely reaches calf, articulates jaw once, freezes and cools down', async () => {
  const { f, animals, tick } = await setup(),
    wolf = animals.find((a) => a.id === 'reference-wolf'),
    calf = animals.find((a) => a.id === 'hornless-calf');
  let bites = 0,
    min = Infinity,
    jaw = false,
    gallop = false;
  f.onBite = () => bites++;
  assert.equal(f.tap({ x: 0, z: 0 }), true);
  assert.equal(f.tap({ x: 0, z: 0 }), false);
  const before = f.snapshot();
  f.update(0, { x: 0, z: 0 });
  assert.deepEqual(f.snapshot(), before);
  for (let i = 0; i < 2400 && f.busy(); i++) {
    tick();
    min = Math.min(min, wolf.rig.contactPoint().distanceTo(calf.rig.contactPoint()));
    jaw ||= (wolf.bitePose ?? 0) > 0.5;
    gallop ||= wolf.rig.snapshot().gait === 'gallop';
  }
  assert.equal(
    f.snapshot().reason,
    'complete',
    JSON.stringify({
      ...f.snapshot(),
      min,
      wolf: wolf.rig.contactPoint().toArray(),
      calf: calf.rig.contactPoint().toArray(),
      reach: [wolf.rig.contactReach, calf.rig.contactReach],
    }),
  );
  assert.equal(bites, 1);
  assert.ok(min < 0.2);
  assert.ok(jaw);
  assert.ok(gallop);
  assert.equal(wolf.chargeRun, 0);
  assert.ok(wolf.rig.snapshot().legs.some((l) => l.steps > 0));
  assert.equal(f.tap({ x: 0, z: 0 }), false);
  assert.equal(f.snapshot().cooldown, 10);
});
test('wolf respects family ownership and safe route failure; bull faces live calf without charging', async () => {
  const { f, animals, tick, setFamily, setCharge } = await setup();
  setFamily(true);
  assert.equal(f.tap({ x: 0, z: 0 }), false);
  setFamily(false);
  const calf = animals.find((a) => a.id === 'hornless-calf'),
    bull = animals.find((a) => a.id === 'copper-cow');
  assert.equal(f.follow(), true);
  const origin = { x: bull.x, z: bull.z },
    heading = bull.heading;
  for (let i = 0; i < 90; i++) tick();
  assert.notEqual(bull.heading, heading);
  assert.equal(bull.x, origin.x);
  assert.equal(bull.z, origin.z);
  calf.x -= 2;
  for (let i = 0; i < 240; i++) tick();
  assert.ok(Math.abs(bull.familyLook) < 0.1);
  setCharge(true);
  tick();
  assert.equal(f.snapshot().talking, false);
  const blocked = await setup(() => 0, [{ x: -25, z: 12, radius: 30 }]);
  assert.equal(blocked.f.tap({ x: 0, z: 0 }), false);
  assert.equal(blocked.f.snapshot().reason, 'no-safe-route');
});
