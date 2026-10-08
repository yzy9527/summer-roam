import test from 'node:test';
import assert from 'node:assert/strict';
import { rescueFixture } from './helpers/rescue-fixture.mjs';

function runUntil(f, controller, phase, seconds = 500) {
  for (let i = 0; i < seconds * 10 && controller.snapshot().phase !== phase; i++) {
    f.cart.update(0.1, f.car);
    f.tick(0.1);
  }
  assert.equal(controller.snapshot().phase, phase, JSON.stringify(controller.snapshot()));
}

test('manual hold walks from actual positions, contacts and holds the original GLB, freezes, safely lowers and releases', async () => {
  const f = await rescueFixture(() => 0.9, { withHeist: true }),
    a = f.animal('hornless-calf');
  f.place(a, -25, 10, 0);
  f.placeGiant(-22, 7, 0);
  const original = a.group,
    calfPosition = a.group.position.clone(),
    giantPosition = f.giant.object.position.clone();
  assert(f.heist.holdManual(a));
  assert(a.group.position.equals(calfPosition));
  assert(f.giant.object.position.equals(giantPosition));
  assert.equal(f.heist.holdManual(a), false);
  assert.equal(f.heist.startManual(a), false);
  let fastest = 0,
    running = false;
  for (let i = 0; i < 800 && f.heist.snapshot().phase !== 'manual-hold'; i++) {
    const before = f.giant.object.position.clone();
    f.tick(0.1);
    fastest = Math.max(
      fastest,
      Math.hypot(f.giant.object.position.x - before.x, f.giant.object.position.z - before.z) / 0.1,
    );
    running ||= f.giant.rig.snapshot().run > 0.1;
  }
  assert.equal(f.heist.snapshot().phase, 'manual-hold');
  assert(fastest > 2.5 && fastest <= 3.1 + 1e-6, `Empty approach speed: ${fastest}`);
  assert(running, 'Fast approach must use the biped running pose');
  assert.equal(a.group, original);
  assert(f.heist.snapshot().handGaps.every((d) => d < 0.12));
  assert(a.group.position.y > calfPosition.y + 0.7);
  assert.equal(a.transportOwner, 'heist');
  const frozen = JSON.stringify({
    h: f.heist.snapshot(),
    pose: f.giant.rig.snapshot(),
    calf: a.group.position,
  });
  f.tick(0);
  assert.equal(
    JSON.stringify({ h: f.heist.snapshot(), pose: f.giant.rig.snapshot(), calf: a.group.position }),
    frozen,
  );
  assert(f.heist.putDownManual());
  runUntil(f, f.heist, 'waiting', 30);
  assert.equal(a.transportOwner, undefined);
  assert.equal(a.group, original);
  assert(f.colliders.includes(a.collider));
  assert.equal(f.colliders.filter((c) => c === a.collider).length, 1);
  assert.equal(f.rescue.snapshot().phase, 'idle');
  assert(f.heist.crewAvailable());
  assert(f.heist.snapshot().trigger.cooldown > 0);
});

test('cancel approaching/held manual task restores ownership without changing calf location or abandoning suspended calf', async () => {
  for (const held of [false, true]) {
    const f = await rescueFixture(() => 0.9, { withHeist: true }),
      a = f.animal('hornless-calf');
    f.place(a, -25, 10, 0);
    f.placeGiant(-22, 7, 0);
    assert(f.heist.holdManual(a));
    if (held) runUntil(f, f.heist, 'manual-hold', 80);
    assert(f.heist.cancelManual());
    if (held) assert.equal(a.transportOwner, 'heist', 'release only after safe lowering');
    runUntil(f, f.heist, 'waiting', 40);
    assert.equal(a.transportOwner, undefined);
    assert(f.colliders.includes(a.collider));
    assert.equal(f.rescue.snapshot().phase, 'idle');
    assert(f.heist.crewAvailable());
  }
});

test('manual vehicle capture bypasses only automatic isolation; original auto start still refuses, busy/sleep/cooldown still reject', async () => {
  const f = await rescueFixture(() => 0.9, { withHeist: true }),
    a = f.animal('hornless-calf');
  f.place(a, -25, 10, 0);
  f.place(f.animal('golden-cow'), -25, 4, 0);
  assert.equal(f.heist.start(), false);
  assert(f.heist.startManual(a));
  assert.equal(f.heist.snapshot().manualTask, 'capture');
  assert.equal(f.heist.startManual(a), false);
  runUntil(f, f.heist, 'calf-in-flight', 300);
  assert.equal(f.heist.cancelManual(), false, 'Never release transport ownership while airborne');
  assert.equal(a.transportOwner, 'heist');
  runUntil(f, f.heist, 'complete', 800);
  assert.equal(a.mode, 'confined');
  assert.equal(a.transportOwner, 'corral');
  assert.equal(f.corral.animals[0], a);
});

test('manual recapture starts outside discovery radius without moving entities and remains exclusive with vehicle crew', async () => {
  const f = await rescueFixture(() => 0.9, { withHeist: true });
  const a = f.escaping(-26, -27, { x: 100, z: -27 });
  f.placeGiant(-37, -27, Math.PI / 2);
  assert.equal(f.rescue.snapshot().phase, 'idle');
  const before = f.giant.object.position.clone();
  assert(f.rescue.startManual(a));
  assert(f.giant.object.position.equals(before));
  assert.equal(f.heist.holdManual(a), false);
  assert.equal(f.rescue.startManual(a), false);
  for (let i = 0; i < 80; i++) f.tick(0.1);
  assert(
    ['chasing', 'reaching', 'lifting', 'carrying'].includes(f.rescue.snapshot().phase),
    JSON.stringify(f.rescue.snapshot()),
  );
  assert.equal(f.rescue.snapshot().manual, true);
  assert(f.rescue.cancelManual());
  runUntil(f, f.rescue, 'idle', 40);
  assert.equal(f.rescue.snapshot().phase, 'idle');
  assert(f.heist.crewAvailable());
});

test('delivered original calf clears stale waiting/escape state, roams within the closed pen and freezes when paused', async () => {
  const f = await rescueFixture(() => 0.9, { withHeist: true });
  const a = f.animal('hornless-calf');
  f.place(a, 164, 23, 0);
  a.wait = 600;
  a.behavior.escape = { x: 164, z: 12 };
  a.behavior.driveTime = 40;
  a.route = [{ x: 164, z: 12 }];
  a.blocked = true;
  const original = a.group;
  f.corral.finishDelivery(a);
  assert.equal(a.behavior.escape, null);
  assert.equal(a.behavior.driveTime, 0);
  assert.equal(a.blocked, false);
  const origin = { x: a.x, z: a.z };
  let furthest = 0;
  for (let i = 0; i < 600; i++) {
    f.tick(0.1);
    furthest = Math.max(furthest, Math.hypot(a.x - origin.x, a.z - origin.z));
    assert(a.x > 160 + a.radius && a.x < 168 - a.radius);
    assert(a.z > 20 + a.radius && a.z < 26 - a.radius);
  }
  assert(furthest > 0.6, `Calf remains stationary: ${furthest}`);
  assert.equal(a.group, original);
  assert.equal(a.transportOwner, 'corral');
  assert.equal(a.mode, 'confined');
  const frozen = JSON.stringify(f.corral.snapshot());
  f.tick(0);
  assert.equal(JSON.stringify(f.corral.snapshot()), frozen);
});
