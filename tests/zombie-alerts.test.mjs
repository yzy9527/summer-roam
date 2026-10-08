import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rescueFixture } from './helpers/rescue-fixture.mjs';
import { landscapeHeight } from '../src/world-queries.js';
import { chooseGiantPatrolGoal } from '../src/zombie-alerts.js';

test('a giant that sees an escaped calf never starts automatic pursuit without an alarm', async () => {
  const f = await rescueFixture();
  f.escaping(-26, -27, { x: 100, z: -27 });
  f.placeGiant(-34, -27, Math.PI / 2);
  for (let i = 0; i < 30; i++) f.tick();
  assert.equal(f.rescue.snapshot().phase, 'idle');
  assert.equal(f.rescue.snapshot().captures, 0);
  assert.equal(f.events.filter((e) => e.type === 'zombie-no').length, 0);
});

test('an observer must look toward the calf, have a clear sight line, and alarm only once per escape', async () => {
  const f = await rescueFixture();
  const calf = f.escaping(-26, -3, { x: -26, z: 5 });
  f.placeGiant(-24.8, -4);
  const actor = f.zombies.actor('pvz-browncoat');
  actor.object.position.set(-30, landscapeHeight(-30, 1), 1);
  Object.assign(actor.collider, { x: -30, z: 1 });
  const face = (heading) => {
    actor.object.rotation.y = heading;
    f.zombies.rebind(actor.layout.id);
    actor.rig.update(0.01, 0, landscapeHeight);
    f.zombies.release(actor.layout.id);
  };
  face(-Math.PI / 4);
  f.rescue.update(0.1, f.car);
  assert.equal(f.events.filter((e) => e.type === 'zombie-no').length, 0);
  face((Math.PI * 3) / 4);
  const wall = { x: -28, z: -1, radius: 0.7 };
  f.colliders.push(wall);
  f.rescue.update(0.1, f.car);
  assert.equal(f.events.filter((e) => e.type === 'zombie-no').length, 0);
  f.colliders.splice(f.colliders.indexOf(wall), 1);
  f.rescue.update(0.1, f.car);
  assert.equal(f.events.filter((e) => e.type === 'zombie-no').length, 1);
  assert(['alert-search', 'chasing', 'reaching'].includes(f.rescue.snapshot().phase));
  for (let i = 0; i < 30; i++) f.rescue.update(0.05, f.car);
  assert.equal(f.events.filter((e) => e.type === 'zombie-no').length, 1);
  assert.equal(calf.escapeEpoch, 1);
});

test('a closing guard faces and points before departing, closes normally, and shares the escape alarm', async () => {
  const f = await rescueFixture();
  f.place(f.animal('hornless-calf'), 164, 24);
  f.corral.finishDelivery(f.animal('hornless-calf'));
  f.corral.setManualGateOpen(true);
  for (let i = 0; i < 42; i++) f.tick();
  const calf = f.escaping(164, 15, { x: 164, z: -27 });
  f.placeGiant(140, -27);
  const guard = f.zombies.actor('pvz-gatekeeper');
  const origin = guard.object.position.clone();
  assert(f.corral.requestGuardClose());
  let pointing = false,
    checkedDirection = false,
    bestPointDot = -1;
  for (let i = 0; i < 1000; i++) {
    f.tick();
    const n = f.rescue.snapshot().alert;
    if (n?.guard && n.stage === 'pointing') {
      pointing = true;
      assert(guard.object.position.distanceTo(origin) < 1e-8);
      const direction = Math.atan2(n.point.x - origin.x, n.point.z - origin.z);
      assert(
        Math.abs(
          Math.atan2(
            Math.sin(direction - guard.object.rotation.y),
            Math.cos(direction - guard.object.rotation.y),
          ),
        ) < 0.05,
      );
      if (i > 5) {
        let arm;
        guard.source.traverse((n) => {
          if (!arm && n.isBone && n.name.replace(/_0\d+$/, '') === 'RightArm') arm = n;
        });
        const shoulder = arm?.getWorldPosition(new THREE.Vector3());
        if (shoulder) {
          const hand = guard.rig.handPoint().sub(shoulder).setY(0).normalize();
          const aim = new THREE.Vector3(
            n.point.x - shoulder.x,
            0,
            n.point.z - shoulder.z,
          ).normalize();
          bestPointDot = Math.max(bestPointDot, hand.dot(aim));
          checkedDirection ||= hand.dot(aim) > 0.8;
        }
      }
    }
    if (f.corral.snapshot().gateAmount === 0 && f.corral.snapshot().gateOperation.stage === 'idle')
      break;
  }
  assert(pointing);
  assert(checkedDirection, String(bestPointDot));
  assert.equal(
    f.corral.snapshot().gateAmount,
    0,
    JSON.stringify(f.corral.snapshot().gateOperation),
  );
  assert.equal(f.events.filter((e) => e.type === 'zombie-no').length, 1);
  assert(calf.escapeEpoch === 1);
});

test('giant patrol chooses the escape corridor or other terrain at the 50% boundary without rerolling rejected destinations', () => {
  for (const draw of [0.499999, 0.5]) {
    let count = 0;
    const goal = chooseGiantPatrolGoal(
      { x: 164, z: 15 },
      () => (count++ === 0 ? draw : 0.25),
      () => true,
    );
    assert(goal);
    assert.equal(goal.escapeSide, draw < 0.5);
  }
  let calls = 0,
    checked = 0;
  const goal = chooseGiantPatrolGoal(
    { x: 164, z: 15 },
    () => (calls++ === 0 ? 0.1 : 0.25),
    () => ++checked >= 4,
  );
  assert(goal?.escapeSide);
  assert.equal(checked, 4);
  assert.equal(calls, 13, 'one category draw, then three candidate draws per retry');
});

test('an earlier observer alarm suppresses the closing guard, and a new escape permits a new alarm', async () => {
  const f = await rescueFixture();
  const calf = f.animal('hornless-calf');
  f.place(calf, 164, 24);
  f.corral.finishDelivery(calf);
  f.corral.setManualGateOpen(true);
  for (let i = 0; i < 42; i++) f.tick();
  f.escaping(164, 15, { x: 164, z: -27 });
  f.placeGiant(140, -27);
  const observer = f.zombies.actor('pvz-browncoat');
  observer.object.position.set(160, landscapeHeight(160, 11), 11);
  observer.object.rotation.y = Math.PI / 4;
  Object.assign(observer.collider, { x: 160, z: 11 });
  f.zombies.rebind(observer.layout.id);
  observer.rig.update(0.01, 0, landscapeHeight);
  f.zombies.release(observer.layout.id);
  f.rescue.update(0.05, f.car);
  assert.equal(f.events.filter((e) => e.type === 'zombie-no').length, 1);
  assert.equal(f.rescue.snapshot().phase, 'idle', 'The giant is outside hearing range');
  assert(f.corral.requestGuardClose());
  f.corral.update(0.05, f.car);
  assert.equal(f.corral.snapshot().gateOperation.stage, 'approaching');
  assert.equal(f.rescue.snapshot().alert.guard, false);
  const frozen = JSON.stringify(f.rescue.snapshot());
  f.rescue.update(0, f.car);
  assert.equal(JSON.stringify(f.rescue.snapshot()), frozen);
  for (let i = 0; i < 25; i++) f.rescue.update(0.05, f.car);
  assert.equal(f.events.filter((e) => e.type === 'zombie-no').length, 1);
  calf.escapeEpoch++;
  f.rescue.update(0.05, f.car);
  assert.equal(f.events.filter((e) => e.type === 'zombie-no').length, 2);
});

test('an audible distant report starts a route even when the reported position is occupied by the calf', async () => {
  const f = await rescueFixture();
  f.escaping(-6, -27, { x: 100, z: -27 });
  f.placeGiant(-35, -27, Math.PI / 2);
  const observer = f.zombies.actor('pvz-browncoat');
  observer.object.position.set(-17.5, landscapeHeight(-17.5, -27), -27);
  observer.object.rotation.y = Math.PI / 2;
  Object.assign(observer.collider, { x: -17.5, z: -27 });
  f.zombies.rebind(observer.layout.id);
  observer.rig.update(0.01, 0, landscapeHeight);
  f.zombies.release(observer.layout.id);
  const origin = f.giant.object.position.clone();
  f.rescue.update(0.1, f.car);
  assert.equal(f.events.filter((e) => e.type === 'zombie-no').length, 1);
  assert.equal(f.rescue.snapshot().phase, 'alert-search');
  assert(f.rescue.snapshot().route.length > 0);
  for (let i = 0; i < 20; i++) f.rescue.update(0.1, f.car);
  assert(f.giant.object.position.distanceTo(origin) > 4);
});
