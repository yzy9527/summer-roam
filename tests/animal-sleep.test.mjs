import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createAnimalSleep } from '../src/animal-sleep.js';
import { createAnimalAnimation } from '../src/animal-animation.js';
import { createCowBehavior } from '../src/cow-behavior.js';
import { ANIMAL_PROFILES } from '../src/animal-profiles.js';
import { ANIMAL_LAYOUT, addFieldAnimals } from '../src/field-animals.js';
import { assetUrl } from '../src/asset-url.js';
import { loadAnimalGeometry } from './helpers/animal-geometry.mjs';

function stub(id = 'golden-cow') {
  return { id, rig: {}, behavior: createCowBehavior('cow'), velocity: 1, target: { x: 1, z: 2 } };
}
function advance(sleep, seconds, mode = 'night') {
  for (let i = 0; i < Math.round(seconds * 10); i++) sleep.update(0.1, mode);
}

test('night sleep waits for exclusive activity, vehicle clearance and collision escape', () => {
  const a = stub();
  let busy = true,
    safe = true;
  const s = createAnimalSleep([a], { busy: () => busy, safe: () => safe, random: () => 0 });
  advance(s, 8);
  assert.equal(s.snapshot(a).phase, 'awake');
  busy = false;
  safe = false;
  advance(s, 8);
  assert.equal(s.snapshot(a).phase, 'awake');
  safe = true;
  a.collisionEscape = true;
  advance(s, 8);
  assert.equal(s.snapshot(a).phase, 'awake');
  a.collisionEscape = false;
  advance(s, 4);
  assert.equal(s.snapshot(a).phase, 'sleeping');
  assert.equal(a.velocity, 0);
  assert.equal(a.target, null);
  safe = false;
  s.update(0.1, 'night');
  assert.equal(s.snapshot(a).phase, 'waking');
});

test('cows and leopard sleep through the game night, pause freezes time and dawn releases locomotion', () => {
  const animals = ['golden-cow', 'copper-cow', 'hornless-calf', 'baola-leopard'].map(stub);
  const s = createAnimalSleep(animals, { random: () => 0 });
  advance(s, 1000);
  for (const a of animals) assert.equal(s.snapshot(a).phase, 'sleeping');
  const frozen = animals.map((a) => s.snapshot(a));
  s.update(0, 'day');
  assert.deepEqual(
    animals.map((a) => s.snapshot(a)),
    frozen,
  );
  s.update(0.1, 'day');
  assert(animals.every((a) => s.snapshot(a).phase === 'waking'));
  advance(s, 2, 'day');
  for (const a of animals) {
    assert(s.ready(a));
    assert.equal(a.sleepAmount, 0);
    assert.equal(a.behavior.state, 'idle');
  }
});

for (const [draw, asleep, awake] of [
  [0, 120, 45],
  [1, 240, 90],
]) {
  test(`wolf sleeps ${asleep}s, stands before ${awake}s of independent activity, then rests again`, () => {
    const wolf = stub('reference-wolf'),
      cow = stub();
    const s = createAnimalSleep([wolf, cow], { random: () => draw });
    while (s.snapshot(wolf).phase !== 'sleeping') s.update(0.1, 'night');
    assert.equal(s.snapshot(wolf).remaining, asleep);
    advance(s, asleep - 0.2);
    assert.equal(s.snapshot(wolf).phase, 'sleeping');
    advance(s, 0.3);
    assert.equal(s.snapshot(wolf).phase, 'waking');
    assert.equal(s.snapshot(wolf).wakes, 1);
    while (!s.ready(wolf)) s.update(0.1, 'night');
    assert.equal(s.snapshot(wolf).restIn, awake);
    advance(s, awake - 0.2);
    assert(s.ready(wolf));
    advance(s, 3);
    assert.equal(s.snapshot(wolf).phase, 'sleeping');
    assert.equal(s.snapshot(cow).phase, 'sleeping');
  });
}

test('physical response waits for upright posture, repeats do not stack, pause and dawn discard pending sound', () => {
  const a = stub();
  const s = createAnimalSleep([a], { random: () => 0 });
  let responses = 0;
  advance(s, 5);
  assert(s.wake(a, () => responses++));
  assert(s.wake(a, () => (responses += 100)));
  assert.equal(responses, 0);
  advance(s, 2.1);
  assert.equal(responses, 1);
  advance(s, 20);
  s.wake(a, () => responses++);
  s.update(0, 'night');
  advance(s, 3);
  assert.equal(responses, 1);
  advance(s, 20);
  s.wake(a, () => responses++);
  advance(s, 3, 'day');
  assert.equal(responses, 1);
});

for (const config of ANIMAL_LAYOUT) {
  test(`${config.id}: actual skin folds without changing limb lengths, closes eyes and returns to standing`, async () => {
    const root = await loadAnimalGeometry(config.id);
    const box = new THREE.Box3().setFromObject(root, true),
      center = box.getCenter(new THREE.Vector3());
    const group = new THREE.Group();
    root.position.set(-center.x, -box.min.y, -center.z);
    group.add(root);
    group.scale.setScalar(config.scale);
    group.position.y = 0.025;
    const a = {
      ...config,
      heading: 0,
      look: 0,
      clock: 0,
      distance: 0,
      velocity: 0,
      supportHeight: () => 0,
      behavior: createCowBehavior(ANIMAL_PROFILES[config.id].species),
      sleepAmount: 0,
    };
    const rig = createAnimalAnimation(root, group, ANIMAL_PROFILES[config.id]);
    a.rig = rig;
    const bones = [];
    root.traverse((n) => {
      if (n.isBone) bones.push(n);
    });
    const offsets = bones.map((b) => b.position.clone());
    const body = root.getObjectByName('Body'),
      standingHeight = body.position.y;
    const s = createAnimalSleep([a], { random: () => 0 });
    let previous,
      maxAngle = 0,
      minSkin = Infinity,
      maxFootGap = 0;
    const v = new THREE.Vector3();
    for (let i = 0; i < 360; i++) {
      a.clock += 1 / 60;
      s.update(1 / 60, 'night');
      rig.update(1 / 60, a, 1, 1);
      group.updateMatrixWorld(true);
      if (s.owns(a)) {
        const quats = bones.map((b) => b.getWorldQuaternion(new THREE.Quaternion()));
        if (previous)
          for (let j = 0; j < quats.length; j++)
            maxAngle = Math.max(maxAngle, previous[j].angleTo(quats[j]));
        previous = quats;
        for (const l of rig.snapshot().legs)
          maxFootGap = Math.max(
            maxFootGap,
            new THREE.Vector3(...l.foot).distanceTo(new THREE.Vector3(...l.solvedTarget)),
          );
      }
      if (i % 39 === 0 || i === 359)
        root.traverse((m) => {
          if (!m.isSkinnedMesh) return;
          m.skeleton.update();
          for (let j = 0; j < m.geometry.attributes.position.count; j++)
            minSkin = Math.min(minSkin, m.localToWorld(m.getVertexPosition(j, v)).y);
        });
    }
    assert.equal(s.snapshot(a).phase, 'sleeping');
    assert.equal(rig.snapshot().blink, 1);
    assert.equal(rig.snapshot().activity, 0);
    assert(body.position.y < standingHeight - 0.3);
    assert(minSkin > 0.008, `skin penetrates ground: ${minSkin}`);
    assert(maxFootGap < 0.02, `folding foot misses support: ${maxFootGap}`);
    assert(maxAngle < 0.18, `one-frame joint jump: ${maxAngle}`);
    for (let i = 0; i < bones.length; i++)
      if (bones[i] !== body)
        assert(
          bones[i].position.distanceTo(offsets[i]) < 1e-8,
          `${bones[i].name}: bone length changed`,
        );
    const jaw = root.getObjectByName('Jaw').quaternion.clone();
    for (let i = 0; i < 60; i++) {
      a.clock += 1 / 60;
      rig.update(1 / 60, a, 1, 1);
    }
    assert(
      root.getObjectByName('Jaw').quaternion.angleTo(jaw) < 1e-6,
      'sleep never chews or reacts',
    );
    const frozen = JSON.stringify(rig.snapshot());
    rig.update(0, a, 1, 1);
    assert.equal(JSON.stringify(rig.snapshot()), frozen);
    for (let i = 0; i < 180; i++) {
      a.clock += 1 / 60;
      s.update(1 / 60, 'day');
      rig.update(1 / 60, a, 0, 0);
    }
    assert(s.ready(a));
    assert(!rig.snapshot().sleeping);
    assert(Math.abs(body.position.y - standingHeight) < 0.001);
    assert(rig.snapshot().legs.every((l) => l.foot.every(Number.isFinite)));
  });
}

test('real meadow integration: sleeping bodies stay still, wolf wakes and walks, physical click stands before feedback', async () => {
  const original = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async (url) => ({
    scene: await loadAnimalGeometry(ANIMAL_LAYOUT.find((a) => assetUrl(a.id) === url).id),
  });
  let field;
  const scene = new THREE.Scene(),
    warnings = [];
  try {
    field = await addFieldAnimals(scene, [], warnings, false);
  } finally {
    GLTFLoader.prototype.loadAsync = original;
  }
  assert.deepEqual(warnings, []);
  const car = { x: 0, z: 5, heading: 0, speed: 0 };
  const tick = (seconds, mode = 'night') => {
    for (let i = 0; i < Math.round(seconds * 10); i++) field.update(0.1, car, mode);
  };
  tick(8);
  assert(field.snapshot().every((a) => a.sleep.phase === 'sleeping'));
  const before = field.snapshot();
  let moved = false,
    woke = false;
  for (let i = 0; i < 2450; i++) {
    field.update(0.1, car, 'night');
    const current = field.snapshot();
    const wolf = current.find((a) => a.id === 'reference-wolf'),
      oldWolf = before.find((a) => a.id === wolf.id);
    woke ||= wolf.sleep.wakes > 0;
    moved ||= woke && Math.hypot(wolf.x - oldWolf.x, wolf.z - oldWolf.z) > 0.1;
    for (const a of current.filter((a) => a.id !== 'reference-wolf')) {
      const b = before.find((b) => b.id === a.id);
      assert.equal(a.sleep.phase, 'sleeping');
      assert.equal(a.x, b.x);
      assert.equal(a.z, b.z);
    }
    if (moved) break;
  }
  assert(woke && moved, 'awake wolf actually patrols');
  const a = field.snapshot().find((a) => a.id === 'golden-cow');
  let feedback = 0;
  const ray = new THREE.Raycaster(new THREE.Vector3(a.x, 8, a.z), new THREE.Vector3(0, -1, 0));
  assert(field.pat(ray, car, () => feedback++));
  assert.equal(feedback, 0);
  assert.equal(field.snapshot().find((b) => b.id === a.id).sleep.phase, 'waking');
  tick(2.2);
  assert.equal(feedback, 1);
  tick(4, 'day');
  assert(field.snapshot().every((a) => a.sleep.phase === 'awake'));
});
