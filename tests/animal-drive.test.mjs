import test from 'node:test';
import assert from 'node:assert/strict';
import { createCowBehavior, patCow, updateCowBehavior } from '../src/cow-behavior.js';
import { familyDriveFeedback, updateFamilyDrive, reactionAmount } from '../src/animal-drive.js';
import { createCowFamily } from '../src/cow-family.js';
test('blocked animals still react, while quick repeat cannot stack driving', () => {
  const b = createCowBehavior();
  assert.ok(patCow(b, null));
  assert.equal(b.driveTime, 0);
  updateCowBehavior(b, 0.5, false);
  assert.ok(reactionAmount(b) > 0.9);
  assert.equal(patCow(b, { x: 1, z: 1 }), false);
});
test('family recoil moves away smoothly, checks dynamic obstacles, freezes and never queues', () => {
  const a = { x: -11, z: 11, taps: 4, distance: 0, behavior: createCowBehavior() };
  assert.ok(familyDriveFeedback(a, { x: -10, z: 11 }, () => true));
  assert.equal(
    familyDriveFeedback(a, { x: -10, z: 11 }, () => true),
    false,
  );
  const before = JSON.stringify(a);
  updateFamilyDrive(a, 0, () => true);
  assert.equal(JSON.stringify(a), before);
  let peak = 0;
  for (let i = 0; i < 45; i++) {
    updateFamilyDrive(a, 1 / 60, () => true);
    peak = Math.max(peak, a.velocity);
  }
  assert.ok(Math.abs(a.x + 11.22) < 0.001);
  assert.equal(a.recoil, null);
  assert.ok(peak < 0.6);
  a.behavior.feedbackCooldown = 0;
  familyDriveFeedback(a, { x: -10, z: 11 }, () => true);
  const x = a.x;
  updateFamilyDrive(a, 0.4, () => false);
  assert.equal(a.x, x);
});
test('feedback during calling does not reset media time; displaced approach replans under same lock', () => {
  const pair = ['golden-cow', 'hornless-calf'].map((id, i) => ({
    id,
    x: -11,
    z: 4 + i * 7,
    heading: 0,
    radius: 1,
    speed: 0.3,
    distance: 0,
    rig: { contactReach: 0.8 },
    behavior: createCowBehavior(),
  }));
  const f = createCowFamily(pair, () => true);
  f.reserve();
  f.event('playing');
  f.event('time', 5.2);
  pair[1].recoil = { time: 0 };
  f.update(0.2, {});
  assert.equal(f.snapshot().voiceTime, 5.2);
  assert.equal(f.snapshot().phase, 'calling');
  f.event('ended');
  f.update(0.1, {});
  assert.equal(f.snapshot().phase, 'planning');
  pair[1].recoil = null;
  f.update(0.1, {});
  assert.equal(f.snapshot().phase, 'approaching');
  f.displaced();
  assert.equal(f.snapshot().phase, 'planning');
  assert.equal(f.reserve(), false);
  f.event('cancel');
  assert.equal(pair[1].recoil, null);
});
