import test from 'node:test';
import assert from 'node:assert/strict';
import { vehicleTargets } from '../src/audio.js';
test('car sounds remain bounded and gentle even at extreme speeds', () => {
  for (const speed of [-100, -18, -1, 0, 1, 18, 100])
    for (const surface of ['公路', '草地']) {
      const t = vehicleTargets({ speed, surface }, { forward: true, brake: true });
      assert(t.frequency >= 52 && t.frequency <= 110);
      assert(t.engine < 0.08);
      assert(t.rolling < 0.033);
      assert(t.brake <= 0.025);
    }
});
test('stationary car has no tyre or brake noise and reversing does not change sound level', () => {
  assert.equal(vehicleTargets({ speed: 0, surface: '公路' }, { brake: true }).rolling, 0);
  assert.equal(vehicleTargets({ speed: 0, surface: '公路' }, { brake: true }).brake, 0);
  assert.deepEqual(
    vehicleTargets({ speed: -8, surface: '公路' }, { backward: true }),
    vehicleTargets({ speed: 8, surface: '公路' }, { forward: true }),
  );
});
