import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { milkFixture } from './helpers/milk-fixture.mjs';
import { MILK_VISIT } from '../src/gameplay/milk/visit.js';
import { createSceneActions } from '../src/scene-actions.js';

const until = (f, predicate, seconds = 450, dt = 0.05) => {
  for (let i = 0; i < seconds / dt; i++) {
    f.step(dt);
    if (predicate(f.milk.snapshot())) return;
  }
  assert.fail(JSON.stringify(f.milk.snapshot()));
};
const nativeVertices = (root) => {
  const points = [];
  root.updateMatrixWorld(true);
  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    mesh.skeleton?.update();
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++)
      points.push(mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
  });
  return points;
};

for (const fps of [30, 60, 120])
  test(`${fps}fps: original skins, one lidless pail, gallop, two clear leaps, drink, return and cooldown refill`, async () => {
    const f = await milkFixture();
    f.confine();
    const originalCalf = f.calf.group,
      bucket = f.milk.bucket.root;
    const bones = [];
    f.leopard.source.traverse((b) => {
      if (b.isBone && b.name !== 'Body') bones.push([b, b.position.clone()]);
    });
    assert.equal(f.milk.availability(), '');
    assert(f.milk.start());
    assert(!f.milk.start());
    let last = '',
      fast = 0,
      flights = 0,
      drank = 0,
      minClearance = Infinity,
      footError = 0;
    const phases = new Set();
    for (let i = 0; i < 450 * fps; i++) {
      f.step(1 / fps);
      const s = f.milk.snapshot();
      phases.add(s.phase);
      assert.equal(f.calf.group, originalCalf);
      assert.equal(f.milk.bucket.root, bucket);
      assert(s.navigation.slices <= 96);
      if (last !== s.phase) {
        const before = f.milk.snapshot(),
          pose = f.leopard.rig.snapshot();
        f.step(0);
        assert.deepEqual(f.milk.snapshot(), before);
        assert.deepEqual(f.leopard.rig.snapshot(), pose);
        last = s.phase;
      }
      if (s.carried)
        assert(new THREE.Vector3(...s.grip).distanceTo(new THREE.Vector3(...s.mouth)) < 1e-8);
      const animation = f.leopard.rig.snapshot();
      if (animation.gait === 'gallop') fast = Math.max(fast, f.leopard.velocity);
      if (s.jump?.phase === 'flight' && s.jump.progress > 0.01) {
        flights++;
        assert(animation.legs.every((l) => !l.stance));
        for (const l of animation.legs)
          footError = Math.max(
            footError,
            new THREE.Vector3(...l.foot).distanceTo(new THREE.Vector3(...l.solvedTarget)),
          );
        // Test the deformed native skin and the carried pail, not root height.
        if (i % 4 === 0)
          for (const p of [...nativeVertices(f.leopard.group), ...nativeVertices(bucket)])
            if (Math.abs(p.x - 168) < 0.18 && p.z > 20 && p.z < 26)
              minClearance = Math.min(minClearance, p.y - 0.12 - 1.62);
      }
      for (const [b, position] of bones) assert(b.position.distanceTo(position) < 1e-8, b.name);
      if (s.phase === 'feeding' && s.milk < 1) {
        drank++;
        assert.equal(f.calf.transportOwner, 'milk-visit');
        assert(f.calf.rig.contactPoint().distanceTo(new THREE.Vector3(164.3, 0.41, 23.2)) < 0.08);
        assert(f.corral.ploughAvailability(f.calf));
      }
      if (s.phase === 'idle') break;
    }
    const end = f.milk.snapshot();
    assert.equal(end.phase, 'idle', JSON.stringify(end));
    assert.equal(end.result, 'fed');
    assert.equal(end.delivered, 1);
    for (const p of [
      'taking',
      'approaching',
      'windup-in',
      'jumping-in',
      'landing-in',
      'placing',
      'feeding',
      'collecting',
      'windup-out',
      'jumping-out',
      'landing-out',
      'putting-back',
      'returning-home',
    ])
      assert(phases.has(p), p);
    assert(fast > 4, 'fast gallop');
    assert(flights > fps);
    assert(drank > fps);
    assert(
      Number.isFinite(minClearance) && minClearance > 0.1,
      `skin/bucket fence clearance ${minClearance}`,
    );
    assert(footError < 0.12, `native paw IK ${footError}`);
    assert.equal(f.leopard.transportOwner, undefined);
    assert.equal(f.calf.transportOwner, 'corral');
    assert.equal(f.calf.mode, 'confined');
    assert.equal(f.corral.gateState().gateAmount, 0);
    assert.equal(end.milk, 0);
    assert.equal(end.cooldown, MILK_VISIT.cooldown);
    assert(Math.hypot(f.leopard.x - f.leopard.homeX, f.leopard.z - f.leopard.homeZ) < 0.05);
    assert.equal(f.colliders.filter((c) => c.milkLanding).length, 0);
    assert(!f.milk.start());
    const paused = f.milk.snapshot();
    f.milk.update(0, f.car, 90);
    assert.deepEqual(f.milk.snapshot(), paused);
    for (let i = 0; i < 31 * fps; i++) f.step(1 / fps);
    assert.equal(f.milk.snapshot().milk, 1);
    assert.equal(f.milk.snapshot().cooldown, 0);
    assert.equal(f.milk.bucket.root, bucket);
    assert(f.milk.start());
    assert(f.milk.cancel());
  });

test('availability/menu deny free calf and other owners; waking and early cancellation return the same pail', async () => {
  const f = await milkFixture();
  assert.match(f.milk.availability(), /围栏/);
  assert(!f.milk.start());
  f.confine();
  f.leopard.transportOwner = 'heist';
  assert(f.milk.availability());
  delete f.leopard.transportOwner;
  const actions = createSceneActions({
    getField: () => ({ animals: f.animals, corral: f.corral, leopardMilk: f.milk }),
    getCar: () => f.car,
    getTimeOfDay: () => 'day',
  });
  const target = { type: 'animal', animal: f.leopard };
  assert.equal(actions.actions(target).find((a) => a.id === 'milk').label, '给小牛送奶');
  f.step(0.05, 'night');
  assert(f.animals.rest(f.leopard.id));
  for (let i = 0; i < 80; i++) f.step(0.05, 'night');
  assert(!f.animals.sleep.ready(f.leopard));
  assert(f.milk.start());
  assert.equal(actions.actions(target).find((a) => a.id === 'milk').label, '取消送奶');
  assert.equal(f.milk.snapshot().phase, 'waking');
  until(f, (s) => s.phase === 'taking');
  assert(f.milk.cancel());
  until(f, (s) => s.phase === 'idle');
  assert.equal(f.leopard.transportOwner, undefined);
  assert.equal(f.milk.snapshot().result, 'cancelled');
  assert.equal(f.milk.snapshot().milk, 1);
});

test('opening the gate during drinking safely returns the pail; cancelling in flight completes landing before handoff', async () => {
  for (const interruption of ['gate', 'flight']) {
    const f = await milkFixture();
    f.confine();
    assert(f.milk.start());
    if (interruption === 'flight') {
      until(f, (s) => s.phase === 'windup-in');
      const blocker = { x: 165.6, z: 23, radius: 3, height: 2 };
      f.colliders.push(blocker);
      until(f, (s) => s.phase === 'approaching', 2);
      assert(!f.leopard.milkJump);
      assert.equal(f.colliders.filter((c) => c.milkLanding).length, 0);
      f.colliders.splice(f.colliders.indexOf(blocker), 1);
    }
    until(f, (s) => s.phase === (interruption === 'gate' ? 'feeding' : 'jumping-in'));
    if (interruption === 'gate') {
      assert(f.corral.setManualGateOpen(true));
    } else {
      assert(f.milk.cancel());
      assert(f.leopard.milkJump);
      assert.equal(f.leopard.transportOwner, 'milk-visit');
    }
    if (interruption === 'flight') {
      until(f, (s) => s.phase === 'returning-home');
      f.colliders.push({ x: f.leopard.homeX, z: f.leopard.homeZ, radius: 0.4, height: 1 });
    }
    until(f, (s) => s.phase === 'idle');
    if (interruption === 'flight')
      assert(Math.hypot(f.leopard.x - f.leopard.homeX, f.leopard.z - f.leopard.homeZ) > 2);
    const s = f.milk.snapshot();
    assert(s.cancelled);
    assert.equal(s.delivered, 0);
    assert(!f.leopard.milkJump);
    assert.equal(f.leopard.transportOwner, undefined);
    assert.equal(f.colliders.filter((c) => c.milkLanding).length, 0);
    assert(Math.hypot(s.bucket[0] - s.station.x, s.bucket[2] - s.station.z) < 1e-8);
    assert.notEqual(f.calf.transportOwner, 'milk-visit');
  }
});
