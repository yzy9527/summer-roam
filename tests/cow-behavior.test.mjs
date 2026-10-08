import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCowBehavior,
  updateCowBehavior,
  patCow,
  cowRetreatTarget,
  isAnimalTap,
} from '../src/cow-behavior.js';

test('idle cow lowers, grazes, raises and watches with smooth transitions', () => {
  const b = createCowBehavior();
  const seen = new Set();
  let previous = 0;
  for (let i = 0; i < 1000; i++) {
    updateCowBehavior(b, 1 / 60, false, () => 0.2);
    seen.add(b.state);
    assert.ok(Math.abs(b.down - previous) < 0.03);
    previous = b.down;
  }
  for (const state of ['lowering', 'grazing', 'raising', 'idle']) assert.ok(seen.has(state));
  const watch = createCowBehavior();
  for (let i = 0; i < 170; i++) updateCowBehavior(watch, 1 / 60, false, () => 0.9);
  assert.equal(watch.state, 'watching');
  assert.ok(watch.raised > 0.1);
  const frozen = { ...b };
  updateCowBehavior(b, 0, false);
  assert.deepEqual(b, frozen);
});
test('pat interrupts grazing, raises smoothly and throttles repeated taps', () => {
  const b = createCowBehavior();
  b.state = 'grazing';
  b.down = 1;
  assert.equal(patCow(b, { x: -12, z: 5 }), true);
  assert.equal(b.pats, 1);
  assert.equal(patCow(b, { x: -13, z: 5 }), false);
  updateCowBehavior(b, 0.605, false);
  assert.ok(Math.abs(b.down - 0.5) < 1e-6);
  updateCowBehavior(b, 0.645, false);
  assert.equal(b.down, 0);
  assert.equal(b.state, 'alert');
  assert.deepEqual(b.escape, { x: -12, z: 5 });
});
test('retreat finds a safe path and differentiates click from camera drag', () => {
  const a = { x: -11, z: 4 };
  const target = cowRetreatTarget(
    a,
    { x: -10, z: 4 },
    (x, z) => x >= -13 && x <= -9 && z >= 2 && z <= 6,
  );
  assert.ok(target.x < a.x);
  assert.equal(
    cowRetreatTarget(a, { x: 0, z: 0 }, () => false),
    null,
  );
  assert.ok(isAnimalTap({ startX: 100, startY: 100, moved: false }, { x: 102, y: 101 }));
  assert.equal(isAnimalTap({ startX: 100, startY: 100, moved: true }, { x: 100, y: 100 }), false);
  assert.equal(isAnimalTap(null, { x: 100, y: 100 }), false);
});
