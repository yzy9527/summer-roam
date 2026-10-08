import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNoharaActor } from './helpers/nohara-geometry.mjs';
import { createShiroController, SHIRO_ROAM } from '../src/shiro-controller.js';
import * as THREE from 'three';
import { NOHARA_HOUSE_SITE } from '../src/nohara-house-site.js';
import { prepareNoharaHouse } from '../src/nohara-house.js';
import { actorPointAllowed } from '../src/actor-navigation.js';

test('real Shiro uses mapped four-foot gait, true gallop, bounded call route and pause', async () => {
  const actor = await loadNoharaActor('shiro');
  const dog = createShiroController(
    actor,
    [actor.collider],
    () => 0,
    () => 0.75,
  );
  const player = { x: -39, z: 207, jumpPhase: 'ground' };
  assert.equal(dog.call(player, null), 'coming');
  assert.equal(dog.call(player, null), 'busy');
  let gallop = false,
    flight = false,
    maxError = 0;
  for (let i = 0; i < 700; i++) {
    dog.update(1 / 60, player, null);
    const s = dog.snapshot();
    gallop ||= s.rig.gait === 'gallop';
    flight ||= s.rig.gait === 'gallop' && s.rig.legs.every((l) => l.swinging);
    assert.ok(Math.abs(s.x - SHIRO_ROAM.x) <= SHIRO_ROAM.halfWidth);
    assert.ok(Math.abs(s.z - SHIRO_ROAM.z) <= SHIRO_ROAM.halfDepth);
    for (const leg of s.rig.legs) {
      assert.ok(leg.foot.every(Number.isFinite));
      if (leg.stance) maxError = Math.max(maxError, Math.abs(leg.foot[1] - leg.solvedTarget[1]));
    }
    actor.source.traverse((n) => {
      if (n.isBone) assert.ok(n.quaternion.toArray().every(Number.isFinite));
    });
  }
  assert.ok(gallop);
  assert.ok(flight);
  assert.ok(maxError < 0.04, String(maxError));
  assert.equal(dog.snapshot().rig.tail.length, 7);
  assert.equal(dog.snapshot().rig.jaw, null);
  assert.ok(dog.snapshot().footSteps > 8);
  const before = dog.snapshot();
  dog.update(0, player, null);
  assert.deepEqual(dog.snapshot(), before);
});

test('Shiro seated and lying poses articulate real limbs without changing bone lengths', async () => {
  for (const random of [() => 0.1, () => 0.24]) {
    const actor = await loadNoharaActor('shiro'),
      dog = createShiroController(actor, [actor.collider], () => 0, random);
    const lengths = [];
    actor.source.traverse((b) => {
      if (b.isBone) lengths.push([b, b.position.length()]);
    });
    for (let i = 0; i < 220; i++) dog.update(1 / 60, { x: -39, z: 200 }, null);
    assert.ok(['sit', 'lie'].includes(dog.snapshot().activity));
    assert.ok(dog.snapshot().poseAmount > 0.9);
    for (const [b, length] of lengths)
      if (b.name !== 'Body') assert.ok(Math.abs(b.position.length() - length) < 1e-7);
  }
});

test('Shiro autonomously visits all house sides without crossing the actual house or parked car', async () => {
  const actor = await loadNoharaActor('shiro');
  const house = await loadNoharaActor('nohara-house');
  const size = new THREE.Box3()
    .setFromObject(prepareNoharaHouse(house.source), true)
    .getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x + 0.5 - NOHARA_HOUSE_SITE.width) < 0.001);
  assert.ok(Math.abs(size.z + 0.5 - NOHARA_HOUSE_SITE.depth) < 0.001);
  const width = size.x + 0.5,
    depth = size.z + 0.5;
  const columns = Math.ceil(width / 3.5),
    rows = Math.ceil(depth / 3.5);
  const dx = width / columns,
    dz = depth / rows;
  const colliders = [actor.collider];
  for (let i = 0; i < columns; i++)
    for (let j = 0; j < rows; j++)
      colliders.push({
        x: SHIRO_ROAM.x + (i + 0.5 - columns / 2) * dx,
        z: SHIRO_ROAM.z + (j + 0.5 - rows / 2) * dz,
        radius: Math.hypot(dx, dz) / 2,
      });
  let seed = 731;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const dog = createShiroController(actor, colliders, () => 0, random);
  const car = { x: -48, z: 213, heading: Math.PI / 2 };
  const sides = new Set();
  let walking = false,
    running = false;
  for (let i = 0; i < 720 * 30; i++) {
    dog.update(1 / 30, car, car);
    const { x, z } = dog.state;
    assert.ok(actorPointAllowed(x, z, dog.state, colliders, car, { avoidRoad: true }));
    assert.ok(Math.abs(x - SHIRO_ROAM.x) <= SHIRO_ROAM.halfWidth);
    assert.ok(Math.abs(z - SHIRO_ROAM.z) <= SHIRO_ROAM.halfDepth);
    if (x > SHIRO_ROAM.x + width / 2 + 0.5) sides.add('front');
    if (x < SHIRO_ROAM.x - width / 2 - 0.5) sides.add('rear');
    if (z > SHIRO_ROAM.z + depth / 2 + 0.5) sides.add('right');
    if (z < SHIRO_ROAM.z - depth / 2 - 0.5) sides.add('left');
    walking ||= dog.snapshot().activity === 'walk' && dog.state.velocity > 0.2;
    running ||= dog.snapshot().rig.gait === 'gallop';
  }
  assert.equal(sides.size, 4, [...sides].join(','));
  assert.ok(walking && running);
  const paused = dog.snapshot();
  dog.update(0, car, car);
  assert.deepEqual(dog.snapshot(), paused);
});
