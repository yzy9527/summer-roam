import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCorralModel } from '../src/corral-model.js';
import { dryAnimalPoint, findAnimalPath } from '../src/corral-navigation.js';
import { createRescueExitNavigation } from '../src/gameplay/rescue/exit-navigation.js';

test('exit planning falls back from the trapped coarse grid within a shared frame budget and keeps contact separating', () => {
  const colliders = [];
  createCorralModel(new THREE.Scene(), colliders, () => 0, { side: 'right' }).setAmount(1);
  const start = { x: 165, z: 21.5 },
    goal = { x: 158, z: 16 },
    calf = { x: 163.45985, z: 22.54869, radius: 0.8256532768411297 },
    giant = { collider: { radius: 1.05 } };
  const separation = giant.collider.radius + calf.radius + 0.12;
  const distance = (p) => Math.hypot(p.x - calf.x, p.z - calf.z);
  const allowed = (x, z) =>
    distance({ x, z }) >= distance(start) - 1e-7 &&
    dryAnimalPoint(x, z, giant.collider.radius, colliders, null);
  assert.equal(findAnimalPath(start, goal, allowed, { step: 0.75, padding: 8 }), null);
  const navigation = createRescueExitNavigation(colliders, giant, { now: () => 0 });
  let path;
  for (let frame = 0; frame < 300 && !path; frame++) {
    navigation.update(start, [goal], calf, null, 1 / 60);
    assert(navigation.snapshot().slices <= 256);
    path = navigation.takePath();
  }
  assert(path?.length, 'Fine fallback must find the real exit corridor');
  let previous = start;
  for (const target of path) {
    const from = previous;
    const steps = Math.ceil(Math.hypot(target.x - from.x, target.z - from.z) / 0.02);
    for (let i = 1; i <= steps; i++) {
      const next = {
        x: from.x + ((target.x - from.x) * i) / steps,
        z: from.z + ((target.z - from.z) * i) / steps,
      };
      assert(allowed(next.x, next.z));
      assert(distance(next) >= Math.min(separation, distance(previous)) - 1e-7);
      previous = next;
    }
  }
});

test('pending exit search freezes its obstacle snapshot and newly blocked exits wait for a new search', () => {
  const giant = { collider: { radius: 1.05 } },
    calf = { x: 163.46, z: 22.6, radius: 0.826 },
    start = { x: 164.54, z: 22.47 },
    goals = [
      { x: 164.54, z: 18.2 },
      { x: 158, z: 16 },
    ];
  let clock = 0;
  const car = { x: 158, z: 16, heading: 0 };
  const navigation = createRescueExitNavigation([], giant, { now: () => (clock += 0.1) });
  navigation.update(start, goals, calf, car, 1 / 60);
  assert(navigation.snapshot().pending);
  car.x = 100;
  for (let i = 0; i < 30 && navigation.snapshot().pending; i++)
    navigation.update(start, goals, calf, car, 1 / 60);
  assert.equal(
    navigation.takePath(),
    null,
    'Moving the live car must not change an existing search',
  );
  assert(navigation.snapshot().retry > 0);
  for (let i = 0; i < 100 && !navigation.snapshot().ready; i++)
    navigation.update(start, goals, calf, car, 1 / 60);
  assert(navigation.takePath()?.length, 'Clearing the exit allows a fresh safe search');
});
