import { VEHICLE_CONFIG as C } from './vehicle-config.js';

// Equivalent front axle angle. Limit cornering acceleration at speed so a
// held direction key gives full lock for manoeuvres and gentler highway turns.
export function steeringAngle(steer, speed = 0) {
  const limit = Math.atan((C.maxLateralAcceleration * C.wheelbase) / Math.max(speed * speed, 1e-6));
  return Math.max(-1, Math.min(1, steer)) * Math.min(C.maxSteeringAngle, limit);
}

// Ackermann geometry: local +X is the inside wheel for positive steering.
export function frontWheelAngle(angle, localX) {
  const tangent = Math.tan(angle);
  return Math.atan2(C.wheelbase * tangent, C.wheelbase - localX * tangent);
}

// State position follows the axle midpoint, rather than the rear axle.
export function steeringMotion(steer, speed) {
  const angle = steeringAngle(steer, speed),
    tangent = Math.tan(angle);
  const slipAngle = Math.atan(tangent / 2);
  return { slipAngle, yawRate: (speed * Math.cos(slipAngle) * tangent) / C.wheelbase };
}
