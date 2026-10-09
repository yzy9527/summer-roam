import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMilkNavigation } from '../src/gameplay/milk/navigation.js';
import { landscapeHeight } from '../src/world-queries.js';

function fixture(x = -26, z = -24, heading = Math.PI, now = () => 0) {
  const collider = { x, z, radius: 1 },
    a = {
      id: 'leopard',
      x,
      z,
      radius: 1,
      heading,
      velocity: 0,
      distance: 0,
      collider,
      group: new THREE.Group(),
    };
  const colliders = [collider];
  const navigation = createMilkNavigation(colliders, landscapeHeight, () => false, { now });
  return { a, colliders, navigation };
}

test('short clear motion starts in the current frame and a live obstacle still blocks the whole body', () => {
  const { a, colliders, navigation: n } = fixture(-26, -22, 0);
  n.beginFrame();
  n.move(a, { x: -26, z: -20 }, 1 / 60, null, 1);
  assert(a.velocity > 0);
  assert.equal(n.snapshot().pending, 0);
  colliders.push({ x: a.x, z: a.z + 1.3, radius: 0.5 });
  n.beginFrame();
  const start = { x: a.x, z: a.z };
  n.move(a, { x: -26, z: -20 }, 0.05, null, 1);
  assert.equal(a.x, start.x);
  assert.equal(a.z, start.z);
  assert(a.blocked);
  assert.equal(n.snapshot().actors[0].waiting, 'blocked');
});

test('a checked first leg is usable while the long next leg is still planning, with a continuous diagonal corner', () => {
  const { a, navigation: n } = fixture();
  const goals = [
    { x: -26, z: -27 },
    { x: 168, z: -27 },
    { x: 170.4, z: 24.2 },
  ];
  n.beginFrame();
  n.prepare(a, goals, null);
  assert(n.snapshot().pending > 0);
  n.move(a, goals, 0.05, null, 4.5);
  assert(a.velocity > 0, 'finished prefix moves before the complete route is available');
  assert(a.z < -24);
  assert(n.snapshot().slices <= 96);
  let diagonal = false,
    stationary = 0,
    maxStationary = 0;
  for (let i = 0; i < 6 * 60; i++) {
    n.beginFrame();
    n.move(a, goals, 1 / 60, null, 4.5);
    assert(n.allowed(a, a.x, a.z, null), 'curve stays on dry navigable ground');
    if (a.velocity < 0.001) stationary += 1 / 60;
    else stationary = 0;
    maxStationary = Math.max(maxStationary, stationary);
    diagonal ||=
      a.x > -26 && a.z > -27.1 && Math.abs(Math.sin(a.heading) * Math.cos(a.heading)) > 0.1;
  }
  assert(diagonal);
  assert(maxStationary < 0.2, `unexplained corner stop ${maxStationary}`);
  assert(a.x > -23, 'continues into the next leg');
});

test('searching actors and preplanning share one clock deadline in the production budget', () => {
  let clock = 0;
  const { a, navigation: n } = fixture(-26, -24, Math.PI, () => (clock += 0.1));
  const goals = [
    { x: -26, z: -27 },
    { x: 168, z: -27 },
  ];
  n.beginFrame();
  n.prepare(a, goals, null);
  const before = n.snapshot();
  assert(before.slices > 0 && before.slices < 96);
  n.move(a, goals, 0.05, null, 4.5);
  assert.equal(n.snapshot().slices, before.slices, 'no new budget for the second caller');
  assert(n.snapshot().pending > 0);
});

test('a newly occupied generated bend is discarded when replanning to the remaining destination', () => {
  const { a, colliders, navigation: n } = fixture(-26, -24, 0);
  colliders.push({ x: -26, z: -18, radius: 1 });
  const goal = { x: -26, z: -10 };
  for (let i = 0; i < 50; i++) {
    n.beginFrame();
    n.move(a, goal, 0.05, null, 2);
  }
  assert(a.z > -24, 'the initially checked detour has begun');
  // This occupies the detour's generated corner, not its final destination.
  colliders.push({ x: -23.6, z: -18.4, radius: 0.65 });
  let blocked = false,
    arrived = false;
  for (let i = 0; i < 600; i++) {
    n.beginFrame();
    arrived = n.move(a, goal, 0.05, null, 2);
    blocked ||= a.blocked;
    assert(n.allowed(a, a.x, a.z, null), 'replanning never moves through the new obstacle');
    if (arrived) break;
  }
  assert(blocked, 'the real movement sweep encounters the newly occupied bend');
  assert(arrived, 'the obsolete corner does not remain a mandatory retry destination');
});
