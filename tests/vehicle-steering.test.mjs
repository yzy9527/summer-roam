import test from 'node:test';
import assert from 'node:assert/strict';
import { VEHICLE_CONFIG as C } from '../src/vehicle-config.js';
import { steeringAngle, frontWheelAngle, steeringMotion } from '../src/vehicle-steering.js';
import { spawnState, stepDrive } from '../src/drive.js';

test('full lock uses 35 degrees and both front wheels share a turning centre', () => {
  const angle = steeringAngle(1, 2),
    left = frontWheelAngle(angle, C.track / 2),
    right = frontWheelAngle(angle, -C.track / 2);
  assert(Math.abs(angle - (35 * Math.PI) / 180) < 1e-12);
  assert(left > angle && right < angle);
  const radius = C.wheelbase / Math.tan(angle);
  assert(Math.abs(C.wheelbase / Math.tan(left) + C.track / 2 - radius) < 1e-12);
  assert(Math.abs(C.wheelbase / Math.tan(right) - C.track / 2 - radius) < 1e-12);
  assert.equal(frontWheelAngle(-angle, -C.track / 2), -left);
  assert.equal(frontWheelAngle(-angle, C.track / 2), -right);
  assert.equal(frontWheelAngle(0, C.track / 2), 0);
});

test('speed limits cornering and reverse preserves steering geometry', () => {
  for (const speed of [2, 6, 12]) {
    const forward = steeringMotion(1, speed),
      reverse = steeringMotion(1, -speed);
    assert.equal(reverse.yawRate, -forward.yawRate);
    assert.equal(reverse.slipAngle, forward.slipAngle);
    assert(speed * Math.abs(forward.yawRate) <= C.maxLateralAcceleration + 1e-12);
  }
  assert(steeringAngle(1, 12) < steeringAngle(1, 2));
  assert.equal(steeringMotion(1, 0).yawRate, 0);
});

test('low speed full lock follows the geometric circle in both directions', () => {
  for (const steer of [-1, 1])
    for (const speed of [-2, 2]) {
      const s = { ...spawnState(), x: 20, z: 0, heading: 0, steer };
      const rearRadius = C.wheelbase / Math.tan(steeringAngle(steer, speed));
      const centre = { x: 20 + rearRadius, z: -C.wheelbase / 2 };
      const radius = Math.hypot(rearRadius, C.wheelbase / 2);
      for (let n = 0; n < 360; n++) {
        s.speed = speed;
        assert.equal(
          stepDrive(
            s,
            { left: steer > 0, right: steer < 0, forward: speed > 0, backward: speed < 0 },
            1 / 120,
          ),
          false,
        );
        assert(Math.abs(Math.hypot(s.x - centre.x, s.z - centre.z) - radius) < 0.02);
      }
      assert(Math.abs(s.heading) > 1.9, 'full lock should produce a tight turn');
    }
});
