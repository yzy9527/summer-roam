import { loadAnimalGeometry } from './helpers/animal-geometry.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addFieldAnimals } from '../src/field-animals.js';
import {
  createAnimalAnimation as createGoldenCowAnimation,
  solveCowLeg,
  cowTailSwish,
} from '../src/animal-animation.js';

const loadGeometry = () => loadAnimalGeometry('golden-cow');

test('golden cow export has normalized skin weights, four articulated legs and blink morphs', async () => {
  const root = await loadGeometry();
  let skinned = 0,
    blink = 0;
  root.traverse((n) => {
    if (n.isSkinnedMesh) {
      skinned++;
      const weights = n.geometry.getAttribute('skinWeight');
      for (let i = 0; i < weights.count; i++)
        assert.ok(
          Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1) <
            1e-4,
        );
    }
    if (n.morphTargetDictionary?.Blink !== undefined) blink++;
  });
  assert.equal(skinned, 39);
  assert.equal(blink, 6);
  const pupil = root.getObjectByName('Horizontal_teal_pupil');
  assert.ok(pupil.morphTargetDictionary.GazeLeft !== undefined);
  assert.ok(pupil.morphTargetDictionary.GazeRight !== undefined);
  for (const leg of ['FL', 'FR', 'HL', 'HR'])
    for (const part of ['Upper', 'Lower', 'Hoof'])
      assert.ok(root.getObjectByName(leg + '_' + part).isBone);
});

test('actual cow rig lifts feet, plants support hooves, blinks and settles to standing', async () => {
  const root = await loadGeometry(),
    group = new THREE.Group();
  const bounds = new THREE.Box3().setFromObject(root),
    center = bounds.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -bounds.min.y, -center.z);
  group.add(root);
  group.scale.setScalar(0.4875);
  group.position.set(-11, 0.145, 4);
  const rig = createGoldenCowAnimation(root, group),
    animal = { scale: 0.4875, distance: 0, clock: 0, look: 0, gestureType: 0 };
  assert.ok(rig);
  const first = rig.snapshot();
  let maxLift = 0,
    maxBlink = 0,
    maxError = 0,
    planted = 0;
  for (let i = 0; i < 600; i++) {
    group.position.z += 0.32 / 60;
    animal.distance += 0.32 / 60;
    animal.clock += 1 / 60;
    rig.update(1 / 60, animal, 0.6, 0.8);
    const state = rig.snapshot();
    maxBlink = Math.max(maxBlink, state.blink);
    for (const leg of state.legs) {
      assert.ok(leg.foot.every(Number.isFinite));
      maxLift = Math.max(
        maxLift,
        leg.foot[1] - first.legs.find((l) => l.name === leg.name).foot[1],
      );
      if (state.activity > 0.99) {
        maxError = Math.max(
          maxError,
          new THREE.Vector3(...leg.foot).distanceTo(new THREE.Vector3(...leg.target)),
        );
        if (leg.target[1] < 0.22) planted++;
      }
    }
  }
  assert.ok(maxLift > 0.04);
  assert.ok(maxBlink > 0.8);
  assert.ok(planted > 100);
  assert.ok(maxError < 0.035, `IK foot error ${maxError}`);
  for (let i = 0; i < 180; i++) {
    animal.clock += 1 / 60;
    rig.update(1 / 60, animal, 0, 0);
  }
  const beforePause = rig.snapshot();
  rig.update(0, animal, 1, 1);
  assert.deepEqual(rig.snapshot(), beforePause);
  const final = rig.snapshot();
  assert.ok(final.activity < 0.001);
  assert.ok(
    final.legs.every(
      (l) => Math.abs(l.foot[1] - first.legs.find((a) => a.name === l.name).foot[1]) < 0.01,
    ),
  );
});

test('leg IK preserves segment lengths and chooses bending side', () => {
  const hip = new THREE.Vector3(0, 1, 0),
    foot = new THREE.Vector3(0, 0.1, 0.1);
  const knee = solveCowLeg(hip, foot, 0.5, 0.5, new THREE.Vector3(0, 0, 1));
  assert.ok(Math.abs(knee.distanceTo(hip) - 0.5) < 1e-6);
  assert.ok(Math.abs(knee.distanceTo(foot) - 0.5) < 1e-6);
  assert.ok(knee.z > 0.1);
});

test('neck skin bends the muzzle towards grass without moving planted feet', async () => {
  const root = await loadGeometry(),
    group = new THREE.Group();
  const bounds = new THREE.Box3().setFromObject(root),
    center = bounds.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -bounds.min.y, -center.z);
  group.add(root);
  group.scale.setScalar(0.4875);
  group.position.set(-11, 0.145, 4);
  const rig = createGoldenCowAnimation(root, group),
    animal = {
      scale: 0.4875,
      distance: 0,
      clock: 0,
      look: 0,
      gestureType: 0,
      behavior: { down: 0, raised: 0 },
    };
  const muzzle = root.getObjectByName('Continuous_ivory_muzzle');
  const muzzleBounds = () => {
    group.updateMatrixWorld(true);
    muzzle.skeleton.update();
    muzzle.computeBoundingBox();
    return muzzle.boundingBox.clone().applyMatrix4(muzzle.matrixWorld);
  };
  const standing = muzzleBounds(),
    feet = rig.snapshot().legs;
  animal.behavior.down = 1;
  rig.update(1 / 60, animal, 0.5, 0);
  const grazing = muzzleBounds();
  assert.ok(
    grazing.min.y < standing.min.y - 0.35,
    `muzzle descent ${standing.min.y - grazing.min.y}`,
  );
  assert.ok(grazing.min.y > 0.12, `muzzle penetrates ground ${grazing.min.y}`);
  for (const foot of rig.snapshot().legs)
    assert.ok(Math.abs(foot.foot[1] - feet.find((f) => f.name === foot.name).foot[1]) < 0.01);
  animal.behavior.down = 0;
  animal.behavior.raised = 1;
  rig.update(1 / 60, animal, 0, 0);
  assert.ok(muzzleBounds().max.y > standing.max.y + 0.03);
});

test('ray tap reaches the actual skinned cow and interrupts eating before retreating', async () => {
  const root = await loadGeometry(),
    original = GLTFLoader.prototype.loadAsync,
    random = Math.random;
  Math.random = () => 0.2;
  GLTFLoader.prototype.loadAsync = async (url) => {
    if (url.includes('golden-cow')) return { scene: root };
    const stub = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.position.y = 0.5;
    stub.add(mesh);
    return { scene: stub };
  };
  try {
    const scene = new THREE.Scene(),
      animals = await addFieldAnimals(scene, [], []),
      car = { x: 0, z: 5 };
    let cow;
    for (let i = 0; i < 3600; i++) {
      animals.update(1 / 60, car);
      cow = animals.snapshot()[0];
      if (cow.behavior.state === 'grazing') break;
    }
    assert.equal(cow.behavior.state, 'grazing');
    const origin = new THREE.Vector3(cow.x + 3, 1.05, cow.z + 3),
      point = new THREE.Vector3(cow.x, 0.7, cow.z);
    const ray = new THREE.Raycaster(origin, point.sub(origin).normalize());
    assert.ok(animals.pat(ray, car));
    assert.equal(animals.snapshot()[0].behavior.state, 'alert');
    assert.equal(animals.snapshot()[0].behavior.pats, 1);
    animals.pat(ray, car);
    assert.equal(animals.snapshot()[0].behavior.pats, 1);
    const frozen = animals.snapshot();
    animals.update(0, car);
    assert.deepEqual(animals.snapshot(), frozen);
    for (let i = 0; i < 420; i++) animals.update(1 / 60, car);
    const after = animals.snapshot()[0];
    assert.ok(Math.hypot(after.x - cow.x, after.z - cow.z) > 0.4);
  } finally {
    GLTFLoader.prototype.loadAsync = original;
    Math.random = random;
  }
});

test('tail swish has a delayed flexible tip, a counter-sweep and finite recovery', async () => {
  assert.equal(cowTailSwish(0), 0);
  assert.equal(cowTailSwish(2), 0);
  assert.ok(cowTailSwish(0.26) > 0.8);
  assert.ok(cowTailSwish(0.46) < -0.4);
  const root = await loadGeometry(),
    group = new THREE.Group();
  group.add(root);
  group.scale.setScalar(0.4875);
  const rig = createGoldenCowAnimation(root, group),
    animal = {
      scale: 0.4875,
      distance: 0,
      clock: 0,
      look: 0,
      gestureType: 0,
      behavior: { swishTime: 0, swishSide: 1, swishStrength: 1 },
    };
  assert.equal(root.getObjectByName('Tail_Mid').parent, root.getObjectByName('Tail'));
  assert.equal(root.getObjectByName('Tail_Tip').parent, root.getObjectByName('Tail_Mid'));
  const rest = rig.snapshot().tail;
  let maxTipTravel = 0,
    minClearance = Infinity,
    minRumpDistance = Infinity;
  const tuft = root.getObjectByName('Golden_brown_tail_tuft');
  for (let i = 0; i < 100; i++) {
    animal.behavior.swishTime = i / 60;
    rig.update(1 / 60, animal, 0, 0);
    const tail = rig.snapshot().tail;
    for (const b of tail) assert.ok(b.rotation.every(Number.isFinite));
    maxTipTravel = Math.max(
      maxTipTravel,
      new THREE.Vector3(...tail[2].position).distanceTo(new THREE.Vector3(...rest[2].position)),
    );
    tuft.skeleton.update();
    tuft.computeBoundingBox();
    const center = tuft.boundingBox
      .clone()
      .applyMatrix4(tuft.matrixWorld)
      .getCenter(new THREE.Vector3());
    const modelCenter = center.clone().divideScalar(0.4875);
    minRumpDistance = Math.min(
      minRumpDistance,
      (modelCenter.x / 0.68) ** 2 +
        ((modelCenter.y - 1.34) / 0.67) ** 2 +
        ((modelCenter.z + 1.03) / 0.55) ** 2,
    );
    for (const name of ['HL', 'HR']) {
      const a = root.getObjectByName(name + '_Upper').getWorldPosition(new THREE.Vector3()),
        b = root.getObjectByName(name + '_Lower').getWorldPosition(new THREE.Vector3()),
        d = b.clone().sub(a);
      const t = THREE.MathUtils.clamp(center.clone().sub(a).dot(d) / d.lengthSq(), 0, 1);
      minClearance = Math.min(minClearance, center.distanceTo(a.addScaledVector(d, t)));
    }
    if (i === 16)
      assert.ok(
        root
          .getObjectByName('Tail')
          .quaternion.angleTo(root.getObjectByName('Tail_Mid').quaternion) > 0.1,
      );
  }
  assert.ok(maxTipTravel > 0.1);
  assert.ok(minRumpDistance > 1.3, `tail/rump clearance ${minRumpDistance}`);
  assert.ok(minClearance > 0.15, `tail/hindleg clearance ${minClearance}`);
  const frozen = rig.snapshot();
  rig.update(0, animal, 0, 0);
  assert.deepEqual(rig.snapshot(), frozen);
  const final = rig.snapshot().tail;
  for (let i = 0; i < 3; i++)
    assert.ok(
      new THREE.Quaternion(...final[i].rotation).angleTo(
        new THREE.Quaternion(...rest[i].rotation),
      ) < 0.04,
    );
});
