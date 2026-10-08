import { loadAnimalGeometry as loadGeometry } from './helpers/animal-geometry.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createAnimalAnimation } from '../src/animal-animation.js';
import { ANIMAL_PROFILES } from '../src/animal-profiles.js';
import { addFieldAnimals, ANIMAL_LAYOUT } from '../src/field-animals.js';
import { createCowBehavior, updateCowBehavior } from '../src/cow-behavior.js';

for (const id of ['copper-cow', 'hornless-calf', 'reference-wolf', 'baola-leopard'])
  test(id + ' actual export walks, lowers its head, articulates tail and freezes', async () => {
    const root = await loadGeometry(id),
      group = new THREE.Group(),
      profile = ANIMAL_PROFILES[id];
    const bounds = new THREE.Box3().setFromObject(root, true),
      center = bounds.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -bounds.min.y, -center.z);
    group.add(root);
    group.scale.setScalar(0.4875);
    group.position.set(-11, 0.145, 4);
    let bones = 0,
      blink = 0,
      gaze = 0;
    root.traverse((n) => {
      if (n.isBone) bones++;
      if (n.morphTargetDictionary?.Blink !== undefined) blink++;
      if (n.morphTargetDictionary?.GazeLeft !== undefined) gaze++;
      if (n.isSkinnedMesh) {
        const w = n.geometry.getAttribute('skinWeight');
        for (let i = 0; i < w.count; i++)
          assert.ok(Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1) < 1e-4);
      }
    });
    assert.equal(bones, profile.species === 'leopard' ? 32 : profile.species === 'wolf' ? 28 : 22);
    assert.ok(blink >= 6);
    assert.ok(gaze >= 2);
    const rig = createAnimalAnimation(root, group, profile),
      a = {
        scale: 0.4875,
        distance: 0,
        clock: 0,
        look: 0.1,
        gestureType: 0,
        behavior: createCowBehavior(profile.species),
      };
    const first = rig.snapshot();
    let lift = 0,
      eye = 0,
      error = 0;
    for (let i = 0; i < 360; i++) {
      const step = 0.28 / 60;
      group.position.z += step;
      a.distance += step;
      a.clock += 1 / 60;
      rig.update(1 / 60, a, 0.5, 0.8);
      const state = rig.snapshot();
      eye = Math.max(eye, state.blink);
      for (const l of state.legs) {
        assert.ok(l.foot.every(Number.isFinite));
        lift = Math.max(lift, l.foot[1] - first.legs.find((f) => f.name === l.name).foot[1]);
        if (state.activity > 0.99)
          error = Math.max(
            error,
            new THREE.Vector3(...l.foot).distanceTo(new THREE.Vector3(...l.target)),
          );
      }
    }
    assert.ok(lift > 0.025);
    assert.ok(eye > 0.8);
    assert.ok(error < 0.05, `foot error ${error}`);
    for (let i = 0; i < 180; i++) rig.update(1 / 60, a, 0, 0);
    const muzzle = root.getObjectByName(
      profile.species === 'leopard'
        ? 'Reference_yellow_muzzle'
        : profile.species === 'wolf'
          ? 'Continuous_icy_gray_muzzle'
          : 'Continuous_ivory_muzzle',
    );
    const box = () => {
      group.updateMatrixWorld(true);
      muzzle.skeleton.update();
      muzzle.computeBoundingBox();
      return muzzle.boundingBox.clone().applyMatrix4(muzzle.matrixWorld);
    };
    const standing = box();
    a.behavior.down = 1;
    rig.update(1 / 60, a, 0.5, 0);
    const lowered = box();
    assert.ok(lowered.min.y < standing.min.y - 0.2);
    assert.ok(lowered.min.y > 0.12, `muzzle below ground ${lowered.min.y}`);
    a.behavior.down = 0;
    a.clock = 0;
    a.behavior.swishTime = 2;
    rig.update(1 / 60, a, 0, 0);
    const rest = rig.snapshot().tail;
    let travel = 0;
    for (let i = 0; i < 100; i++) {
      a.behavior.swishTime = i / 60;
      rig.update(1 / 60, a, 0, 0);
      const t = rig.snapshot().tail;
      assert.ok(t.every((b) => b.rotation.every(Number.isFinite)));
      travel = Math.max(
        travel,
        new THREE.Vector3(...t[2].position).distanceTo(new THREE.Vector3(...rest[2].position)),
      );
    }
    assert.ok(travel > 0.05);
    const frozen = rig.snapshot();
    rig.update(0, a, 1, 1);
    assert.deepEqual(rig.snapshot(), frozen);
  });

test('carnivores sniff while cattle graze', () => {
  for (const species of ['cow', 'wolf', 'leopard']) {
    const b = createCowBehavior(species);
    updateCowBehavior(b, 2.1, false, () => 0);
    updateCowBehavior(b, 1.7, false, () => 0);
    assert.equal(b.state, species === 'cow' ? 'grazing' : 'sniffing');
    assert.equal(b.down, 1);
  }
});

test('all real skins receive their own ray click, cool down and freeze', async () => {
  const roots = await Promise.all(ANIMAL_LAYOUT.map((c) => loadGeometry(c.id))),
    original = GLTFLoader.prototype.loadAsync,
    random = Math.random;
  GLTFLoader.prototype.loadAsync = async (url) => ({
    scene: roots[ANIMAL_LAYOUT.findIndex((c) => url.includes('/' + c.id + '/'))],
  });
  Math.random = () => 0.2;
  try {
    const scene = new THREE.Scene(),
      warnings = [],
      controller = await addFieldAnimals(scene, [], warnings),
      car = { x: 0, z: 5 };
    assert.deepEqual(warnings, []);
    assert.equal(controller.snapshot().length, ANIMAL_LAYOUT.length);
    for (const animal of controller.snapshot()) {
      assert.ok(animal.animation?.rigged);
      controller.graze(animal.id);
      controller.update(0.1, car);
      const g = scene.getObjectByName(animal.id);
      g.updateMatrixWorld(true);
      const body = g.getObjectByName(
        animal.id === 'reference-wolf'
          ? 'Continuous_horizontal_wolf_body'
          : 'Continuous_quadruped_body_and_four_legs',
      );
      body.skeleton.update();
      body.computeBoundingBox();
      const center = body.boundingBox
        .clone()
        .applyMatrix4(body.matrixWorld)
        .getCenter(new THREE.Vector3());
      const origin = center.clone().add(new THREE.Vector3(3, 0, 0));
      const ray = new THREE.Raycaster(origin, center.clone().sub(origin).normalize());
      assert.ok(controller.pat(ray, car), animal.id + ' click missed');
      const clicked = controller.snapshot().find((a) => a.id === animal.id);
      assert.equal(clicked.behavior.pats, 1);
      assert.equal(clicked.behavior.state, 'alert');
      const taps = [];
      controller.pat(ray, car, (hit) => taps.push(hit));
      assert.equal(controller.snapshot().find((a) => a.id === animal.id).behavior.pats, 1);
      assert.deepEqual(taps, [{ id: animal.id, taps: 2 }]);
      if (animal.id === 'hornless-calf') {
        controller.pat(ray, car, (hit) => taps.push(hit));
        controller.pat(ray, car, (hit) => taps.push(hit));
        assert.equal(taps.at(-1).taps, 4);
        assert.equal(controller.snapshot().find((a) => a.id === animal.id).behavior.pats, 1);
        const blocker = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5));
        blocker.position.copy(origin.clone().lerp(center, 0.5));
        scene.add(blocker);
        blocker.updateMatrixWorld(true);
        assert.equal(
          controller.pat(ray, car, () => assert.fail('occluded tap counted')),
          false,
        );
        assert.equal(controller.snapshot().find((a) => a.id === animal.id).taps, 4);
        scene.remove(blocker);
      }
    }
    const frozen = controller.snapshot();
    controller.update(0, car);
    assert.deepEqual(controller.snapshot(), frozen);
  } finally {
    GLTFLoader.prototype.loadAsync = original;
    Math.random = random;
  }
});

for (const id of Object.keys(ANIMAL_PROFILES))
  test(id + ' turns both ways with continuous joints and planted hoof orientation', async () => {
    const root = await loadGeometry(id),
      group = new THREE.Group(),
      profile = ANIMAL_PROFILES[id];
    const bounds = new THREE.Box3().setFromObject(root, true),
      center = bounds.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -bounds.min.y, -center.z);
    group.add(root);
    group.scale.setScalar(0.4875);
    group.position.set(-11, 0.145, 4);
    const rig = createAnimalAnimation(root, group, profile),
      a = { scale: 0.4875, distance: 0, clock: 0, look: 0, gestureType: 0 };
    const joints = ['FL', 'FR', 'HL', 'HR'].flatMap((l) =>
      ['_Upper', '_Lower'].map((p) => root.getObjectByName(l + p)),
    );
    let previous = null,
      previousJoints = null,
      maxJump = 0,
      planted = 0;
    for (let i = 0; i < 720; i++) {
      // Turn in place first, then turn while walking, reverse turn direction halfway.
      group.rotation.y += ((i < 360 ? 1 : -1) * 0.9) / 60;
      if (i % 360 >= 180) {
        const step = 0.28 / 60;
        group.position.x += Math.sin(group.rotation.y) * step;
        group.position.z += Math.cos(group.rotation.y) * step;
        a.distance += step;
      }
      a.clock += 1 / 60;
      rig.update(1 / 60, a, 0, 0);
      const state = rig.snapshot(),
        rotations = joints.map((b) => b.getWorldQuaternion(new THREE.Quaternion()).normalize());
      if (previousJoints)
        for (let j = 0; j < joints.length; j++)
          maxJump = Math.max(maxJump, rotations[j].angleTo(previousJoints[j]));
      if (previous && state.activity > 0.999)
        for (const l of state.legs) {
          const old = previous.legs.find((p) => p.name === l.name);
          if (!l.swinging && !old.swinging && l.steps === old.steps) {
            planted++;
            assert.ok(
              new THREE.Quaternion(...l.rotation)
                .normalize()
                .angleTo(new THREE.Quaternion(...old.rotation).normalize()) < 0.001,
              `support hoof twisted frame ${i} ${l.name} by ${new THREE.Quaternion(...l.rotation).normalize().angleTo(new THREE.Quaternion(...old.rotation).normalize())}`,
            );
          }
        }
      assert.ok(state.legs.every((l) => l.foot.every(Number.isFinite)));
      previous = state;
      previousJoints = rotations;
    }
    assert.ok(planted > 100);
    assert.ok(maxJump < 0.35, `joint flipped by ${maxJump} radians`);
    assert.ok(
      rig.snapshot().legs.every((l) => l.steps > 4),
      'turning must advance all four feet without translation',
    );
    const frozen = rig.snapshot();
    rig.update(0, a, 0, 0);
    assert.deepEqual(rig.snapshot(), frozen);
  });

for (const id of ['reference-wolf', 'baola-leopard'])
  test(id + ' fused paw tips follow foot bones rather than stretching from the torso', async () => {
    const root = await loadGeometry(id);
    root.updateMatrixWorld(true);
    const mesh = root.getObjectByName(
        id === 'reference-wolf'
          ? 'Continuous_horizontal_wolf_body'
          : 'Continuous_quadruped_body_and_four_legs',
      ),
      positions = mesh.geometry.getAttribute('position'),
      weights = mesh.geometry.getAttribute('skinWeight'),
      indices = mesh.geometry.getAttribute('skinIndex');
    let toes = 0;
    for (let i = 0; i < positions.count; i++) {
      const point = mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, i));
      if (point.y >= 0.2) continue;
      toes++;
      for (let k = 0; k < 4; k++)
        if (weights.getComponent(i, k) > 0.00001)
          assert.match(mesh.skeleton.bones[indices.getComponent(i, k)].name, /_(Hoof|Lower)$/);
    }
    assert.ok(toes > 100);
  });

test('all actual animals turn and quick-walk after a visible driving tap', async () => {
  const original = GLTFLoader.prototype.loadAsync,
    random = Math.random;
  GLTFLoader.prototype.loadAsync = async (url) => ({
    scene: await loadGeometry(url.split('/').at(-2)),
  });
  Math.random = () => 0.4;
  try {
    const scene = new THREE.Scene(),
      controller = await addFieldAnimals(scene, [], []),
      car = { x: 0, z: 5 };
    for (const id of Object.keys(ANIMAL_PROFILES)) {
      const g = scene.getObjectByName(id);
      g.updateMatrixWorld(true);
      const body = g.getObjectByName(
        id === 'reference-wolf'
          ? 'Continuous_horizontal_wolf_body'
          : 'Continuous_quadruped_body_and_four_legs',
      );
      body.skeleton.update();
      body.computeBoundingBox();
      const c = body.boundingBox
          .clone()
          .applyMatrix4(body.matrixWorld)
          .getCenter(new THREE.Vector3()),
        o = c.clone().add(new THREE.Vector3(3, 0, 0));
      assert.ok(controller.pat(new THREE.Raycaster(o, c.clone().sub(o).normalize()), car));
    }
    const before = controller.snapshot();
    let changed = 0;
    for (let i = 0; i < 180; i++) controller.update(1 / 60, car);
    const after = controller.snapshot();
    for (const a of after) {
      const b = before.find((b) => b.id === a.id);
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 0.1, a.id + ' did not move away');
      assert.ok(a.animation.legs.some((l) => l.steps > 0));
      changed++;
    }
    assert.equal(changed, ANIMAL_LAYOUT.length);
  } finally {
    GLTFLoader.prototype.loadAsync = original;
    Math.random = random;
  }
});

test('Baola reference eyes remain flush with the human face and preserve blink and gaze', async () => {
  const root = await loadGeometry('baola-leopard');
  root.updateMatrixWorld(true);
  const head = root.getObjectByName('Broad_yellow_leopard_mask_head');
  const headBounds = new THREE.Box3().setFromObject(head, true);
  for (const side of ['L', 'R']) {
    const pupil = root.getObjectByName('Reference_vertical_pupil_' + side);
    const white = root.getObjectByName('Reference_eye_white_' + side);
    const lid = root.getObjectByName('Spotted_upper_eyelid_' + side);
    assert.ok(pupil && white && lid);
    for (const surface of [pupil, white, lid]) {
      const bounds = new THREE.Box3().setFromObject(surface, true);
      assert.ok(bounds.max.z <= headBounds.max.z + 0.028, 'eye surface must stay in its socket');
      assert.ok(surface.morphTargetDictionary.Blink !== undefined);
    }
    assert.ok(pupil.morphTargetDictionary.GazeLeft !== undefined);
    assert.ok(pupil.morphTargetDictionary.GazeRight !== undefined);
  }
  assert.ok(root.getObjectByName('Human_gray_nose_bridge'));
  assert.ok(root.getObjectByName('Human_gray_nose_tip'));
  assert.ok(root.getObjectByName('Pink_lower_reference_nose'));
  assert.ok(root.getObjectByName('Human_upper_mouth_contour'));
  assert.ok(root.getObjectByName('Thick_lower_lip_human_smile'));
  assert.equal(
    root.getObjectByName('Pink_brown_broad_nose'),
    undefined,
    'do not restore a separate protruding animal snout',
  );
});

test('real cattle escape vehicle contact once, freeze, and rearm only after separation without tap counts', async () => {
  const roots = await Promise.all(ANIMAL_LAYOUT.map((c) => loadGeometry(c.id))),
    original = GLTFLoader.prototype.loadAsync,
    random = Math.random;
  Math.random = () => 0.2;
  GLTFLoader.prototype.loadAsync = async (url) => ({
    scene: roots[ANIMAL_LAYOUT.findIndex((c) => url.includes('/' + c.id + '/'))],
  });
  try {
    const colliders = [],
      controller = await addFieldAnimals(new THREE.Scene(), colliders, []),
      events = [];
    for (const id of [
      'copper-cow',
      'golden-cow',
      'hornless-calf',
      'reference-wolf',
      'baola-leopard',
    ]) {
      const before = controller.snapshot().find((a) => a.id === id),
        c = colliders.find((c) => c.x === before.x && c.z === before.z),
        car = { x: before.x + before.radius + 1, z: before.z, heading: 0 };
      assert.equal(
        controller.collide(c, car, (h) => events.push(h)),
        true,
      );
      assert.equal(
        controller.collide(c, car, (h) => events.push(h)),
        false,
      );
      const frozen = controller.snapshot();
      controller.update(0, car);
      assert.deepEqual(controller.snapshot(), frozen);
      for (let i = 0; i < 480; i++) controller.update(1 / 60, car);
      const after = controller.snapshot().find((a) => a.id === id);
      assert.ok(
        Math.hypot(after.x - car.x, after.z - car.z) >
          Math.hypot(before.x - car.x, before.z - car.z) + 0.4,
        id + ' must move away',
      );
      assert.equal(after.taps, 0);
      assert.equal(after.behavior.pats, 0);
      controller.update(0.01, { x: 0, z: 0, heading: 0 });
      assert.equal(controller.collide(c, car), true);
    }
    assert.deepEqual(
      events.map((e) => e.id),
      ['copper-cow', 'golden-cow', 'hornless-calf', 'reference-wolf', 'baola-leopard'],
    );
    const calf = controller.snapshot().find((a) => a.id === 'hornless-calf');
    controller.update(0.01, { x: 0, z: 0, heading: 0 });
    assert.ok(controller.family.reserve());
    controller.family.event('playing');
    assert.equal(
      controller.collide(colliders[ANIMAL_LAYOUT.findIndex((a) => a.id === 'hornless-calf')], {
        x: calf.x + 2,
        z: calf.z,
        heading: 0,
      }),
      true,
    );
    assert.equal(controller.family.busy(), false);
    const bull = controller.snapshot().find((a) => a.id === 'copper-cow'),
      bullCollider = colliders.find((c) => c.x === bull.x && c.z === bull.z),
      parked = { x: bull.x + 4, z: bull.z, heading: 0, speed: 0 };
    controller.update(0.01, { x: 0, z: 0, heading: 0 });
    controller.charge.tap(parked);
    controller.charge.tap(parked);
    assert.equal(controller.charge.tap(parked), true);
    assert.equal(controller.charge.busy(), true);
    assert.equal(controller.collide(bullCollider, parked), true);
    assert.equal(controller.charge.busy(), true);
    assert.equal(controller.charge.snapshot().mode, 'revenge');
    assert.equal(controller.charge.snapshot().vehicleHits, 3);
    assert.equal(controller.charge.snapshot().impacts, 0);
    assert.equal(controller.collide(bullCollider, parked), false);
  } finally {
    GLTFLoader.prototype.loadAsync = original;
    Math.random = random;
  }
});

test('actual mother vehicle contact cancels wolf pursuit so calf bite audio cannot interrupt protection', async () => {
  const original = GLTFLoader.prototype.loadAsync,
    random = Math.random;
  GLTFLoader.prototype.loadAsync = async (url) => ({
    scene: await loadGeometry(url.split('/').at(-2)),
  });
  Math.random = () => 0;
  try {
    const colliders = [],
      f = await addFieldAnimals(new THREE.Scene(), colliders, []);
    assert.equal(f.encounters.tap({ x: 0, z: 0 }), true);
    let bites = 0;
    f.encounters.onBite = () => bites++;
    const mother = f.snapshot().find((a) => a.id === 'golden-cow');
    assert.equal(f.collide(colliders[0], { x: mother.x + 2, z: mother.z, heading: 0 }), true);
    assert.equal(f.encounters.busy(), false);
    for (let i = 0; i < 180; i++) f.update(1 / 60, { x: 0, z: 0 });
    assert.equal(bites, 0);
  } finally {
    GLTFLoader.prototype.loadAsync = original;
    Math.random = random;
  }
});
