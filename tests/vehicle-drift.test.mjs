import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnState, stepDrive } from '../src/drive.js';
import { inStream, islandDistance } from '../src/world-queries.js';
import { vehicleHitsObstacle, vehicleTouchesWater } from '../src/vehicle-collision.js';

const fixture = (speed = 8) => ({ ...spawnState(), x: 20, z: 0, heading: 0, speed });
const drive = (s, input, frames = 90, dt = 1 / 120) => {
  for (let i = 0; i < frames; i++) assert.equal(stepDrive(s, input, dt), false);
};

test('Shift alone, low speed, reversing and braking retain normal driving exactly', () => {
  for (const [speed, input] of [
    [2, { forward: true, left: true }],
    [8, { forward: true }],
    [8, { forward: true, left: false }],
    [8, { forward: true, right: false }],
    [-4, { backward: true, left: true }],
    [8, { brake: true, left: true }],
  ]) {
    const normal = fixture(speed),
      shifted = fixture(speed);
    for (let i = 0; i < 12; i++) {
      stepDrive(normal, input, 1 / 60);
      stepDrive(shifted, { ...input, drift: true }, 1 / 60);
      assert.deepEqual(shifted, normal);
    }
  }
});

test('a zero-duration step freezes active drift inertia even after releasing Shift', () => {
  const s = fixture();
  drive(s, { forward: true, left: true, drift: true });
  const before = structuredClone(s);
  stepDrive(s, {}, 0);
  assert.deepEqual(s, before);
});

test('left and right drifts have actual mirrored lateral motion and larger yaw than normal turning', () => {
  const states = [];
  for (const side of [-1, 1]) {
    const s = fixture(),
      normal = fixture();
    const input = { forward: true, left: side > 0, right: side < 0 };
    drive(s, { ...input, drift: true });
    drive(normal, input);
    assert(s.drift.active && s.drift.amount > 0.95);
    assert(s.drift.slipAngle * side < -0.2, 'velocity trails the turned vehicle nose');
    assert(Math.abs(s.heading) > Math.abs(normal.heading) * 1.4);
    assert(Math.abs(s.drift.lateralSpeed) > 1.5);
    assert(Math.abs(s.drift.lateralSpeed) <= s.speed * 0.65);
    states.push(s);
  }
  assert(Math.abs(states[0].x + states[1].x - 40) < 1e-9);
  assert.equal(states[0].z, states[1].z);
  assert.equal(states[0].heading, -states[1].heading);
});

test('release recovers continuously, then returns to the original driving path; brake stops lateral motion', () => {
  for (const brake of [false, true]) {
    const s = fixture();
    drive(s, { forward: true, left: true, drift: true });
    const slip = s.drift.slipAngle,
      heading = s.heading;
    stepDrive(s, { forward: !brake, brake }, 1 / 120);
    assert.equal(s.drift.active, false);
    assert(Math.abs(s.drift.slipAngle - slip) < 0.04, 'no snap on release');
    assert(Math.abs(s.heading - heading) < 0.02);
    drive(s, { forward: !brake, brake }, 360);
    assert.equal(s.drift, undefined);
    if (brake) assert.equal(s.speed, 0);
  }
});

test('countersteering changes yaw without teleporting or unbounded sideways speed', () => {
  const s = fixture();
  drive(s, { forward: true, left: true, drift: true });
  const previous = { x: s.x, z: s.z };
  stepDrive(s, { forward: true, right: true, drift: true }, 1 / 30);
  assert(Math.hypot(s.x - previous.x, s.z - previous.z) < 0.3);
  drive(s, { forward: true, right: true, drift: true }, 120);
  assert(s.drift.yawRate < -0.7);
  assert(s.drift.slipAngle > 0.1);
});

test('sliding collision stops at first contact, fires once and clears drift inertia', () => {
  const s = fixture();
  drive(s, { forward: true, left: true, drift: true });
  const heading = s.heading + s.drift.slipAngle;
  const obstacle = { x: s.x + Math.sin(heading) * 3, z: s.z + Math.cos(heading) * 3, radius: 0.3 };
  let calls = 0,
    blocked = false;
  for (let i = 0; i < 60 && !blocked; i++)
    blocked = stepDrive(
      s,
      { forward: true, left: true, drift: true },
      1 / 30,
      [obstacle],
      () => calls++,
    );
  assert(blocked);
  assert.equal(calls, 1);
  assert.equal(s.drift, undefined);
  assert(!vehicleHitsObstacle(s.x, s.z, s.heading, obstacle));
});

test('drift continues to respect water and world boundaries and is consistent across frame rates', () => {
  const fine = fixture(),
    coarse = fixture();
  drive(fine, { forward: true, left: true, drift: true }, 90);
  drive(coarse, { forward: true, left: true, drift: true }, 30, 1 / 40);
  assert(Math.hypot(fine.x - coarse.x, fine.z - coarse.z) < 1e-8);
  for (const initial of [
    { x: -1, z: 18, heading: -Math.PI / 2 },
    { x: 100, z: 240, heading: 0 },
  ]) {
    const s = { ...fixture(), ...initial };
    let blocked = false;
    for (let i = 0; i < 240 && !blocked; i++) {
      blocked = stepDrive(s, { forward: true, right: true, drift: true }, 1 / 30);
      assert(!inStream(s.x, s.z) && !vehicleTouchesWater(s.x, s.z, s.heading));
      assert(islandDistance(s.x, s.z) <= -2);
    }
    assert(blocked);
    assert.equal(s.drift, undefined);
  }
});
