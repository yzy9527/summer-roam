import { STARTING_PLATFORM } from './road-network.js';
import { VEHICLE_CONFIG } from './vehicle-config.js';
import { steeringMotion } from './vehicle-steering.js';
import { isRoadSurface, islandDistance, inStream } from './world-queries.js';
import { vehicleHitsObstacle, vehicleSeparates, vehicleTouchesWater } from './vehicle-collision.js';
// Preserve the original public API while consumers use the layer that owns each query.
export * from './world-queries.js';
export { vehicleObstacleGap, vehicleHitsObstacle, vehicleSeparates } from './vehicle-collision.js';

export function spawnState() {
  const p = STARTING_PLATFORM;
  return {
    x: p.x,
    z: p.z,
    heading: p.heading,
    speed: 0,
    steer: 0,
    wheelRoll: 0,
    surface: isRoadSurface(p.x, p.z) ? '公路' : '草地',
    bump: 0,
  };
}
export function stepDrive(s, input, dt, colliders = [], onCollision = () => {}) {
  // Small steps inspect the entire sliding path and stop at the first contact.
  const canStartDrift =
    input.drift &&
    s.speed >= 20 / 3.6 &&
    !!input.left !== !!input.right &&
    !input.brake &&
    !input.backward;
  if (dt > 1 / 120 && (canStartDrift || s.drift)) {
    const steps = Math.ceil(dt * 120);
    for (let n = 0; n < steps; n++)
      if (stepDrive(s, input, dt / steps, colliders, onCollision)) return true;
    return false;
  }
  const start = { x: s.x, z: s.z, heading: s.heading };
  const onRoad = isRoadSurface(s.x, s.z);
  s.surface = onRoad ? '公路' : '草地';
  const throttle = (input.forward ? 1 : 0) - (input.backward ? 1 : 0),
    targetSteer = (input.left ? 1 : 0) - (input.right ? 1 : 0);
  s.steer += (targetSteer - s.steer) * Math.min(1, dt * 9);
  const maxSpeed = (onRoad ? 60 : 30) / 3.6; // km/h limits converted to metres per second.
  if (input.brake) s.speed = approach(s.speed, 0, dt * 22);
  else if (throttle) {
    const reversing = Math.sign(s.speed) !== throttle && Math.abs(s.speed) > 0.3;
    s.speed += throttle * (reversing ? 12 : 5.6) * dt;
  } else s.speed = approach(s.speed, 0, dt * (1.9 + Math.abs(s.speed) * 0.09));
  s.speed = Math.min(maxSpeed, Math.max(-6, s.speed));
  const motion = steeringMotion(s.steer, s.speed);
  const drifting =
    !!input.drift && !!targetSteer && s.speed >= 20 / 3.6 && !input.brake && !input.backward;
  // Keep the original numerical path until the first deliberate drift.
  if (drifting && dt > 0 && !s.drift)
    s.drift = {
      active: false,
      amount: 0,
      yawRate: motion.yawRate,
      lateralSpeed: Math.sin(motion.slipAngle) * s.speed,
      slipAngle: motion.slipAngle,
      travelHeading: s.heading + motion.slipAngle,
    };
  let yawRate = motion.yawRate,
    slipAngle = motion.slipAngle;
  if (s.drift && dt > 0) {
    const d = s.drift;
    d.active = drifting;
    d.amount += ((drifting ? 1 : 0) - d.amount) * (1 - Math.exp(-dt * (drifting ? 5 : 4)));
    const targetYaw = Math.max(-1.05, Math.min(1.05, motion.yawRate * (1 + 1.6 * d.amount)));
    d.yawRate += (targetYaw - d.yawRate) * (1 - Math.exp(-dt * 6));
    s.speed = approach(s.speed, 0, dt * d.amount * 0.9);
    const grip = 7 - d.amount * 5.3;
    const normalLateral = Math.sin(motion.slipAngle) * s.speed;
    const targetLateral = normalLateral - (s.speed * d.yawRate * d.amount) / grip;
    d.lateralSpeed += (targetLateral - d.lateralSpeed) * (1 - Math.exp(-dt * grip));
    const limit = Math.abs(s.speed) * 0.65;
    d.lateralSpeed = Math.max(-limit, Math.min(limit, d.lateralSpeed));
    d.slipAngle =
      Math.abs(s.speed) > 0.1
        ? Math.asin(d.lateralSpeed / Math.abs(s.speed)) * Math.sign(s.speed)
        : 0;
    yawRate = d.yawRate;
    slipAngle = d.slipAngle;
    if (
      !drifting &&
      (Math.abs(s.speed) < 0.1 ||
        (d.amount < 0.001 &&
          Math.abs(d.lateralSpeed - normalLateral) < 0.01 &&
          Math.abs(d.yawRate - motion.yawRate) < 0.001))
    ) {
      delete s.drift;
      yawRate = motion.yawRate;
      slipAngle = motion.slipAngle;
    }
  }
  const headingDelta = yawRate * dt;
  const travelHeading = s.heading + headingDelta / 2 + slipAngle;
  if (s.drift && dt > 0) s.drift.travelHeading = travelHeading;
  s.heading += headingDelta;
  const nx = s.x + Math.sin(travelHeading) * s.speed * dt,
    nz = s.z + Math.cos(travelHeading) * s.speed * dt;
  let blocked =
    islandDistance(nx, nz) > -2 || inStream(nx, nz) || vehicleTouchesWater(nx, nz, s.heading);
  for (const c of colliders) {
    const overlapping = vehicleHitsObstacle(start.x, start.z, start.heading, c);
    const separating =
      overlapping && vehicleSeparates(start, { x: nx, z: nz, heading: s.heading }, c);
    if (
      (overlapping && !separating) ||
      (!overlapping && vehicleHitsObstacle(nx, nz, s.heading, c))
    ) {
      blocked = true;
      if (dt > 0 && Math.abs(s.speed) > 0.001) onCollision(c);
      break;
    }
  }
  s.bump = Math.max(0, s.bump - dt * 4);
  if (blocked) {
    s.heading = start.heading;
    s.speed *= -0.18;
    s.bump = 1;
    delete s.drift;
  } else {
    s.x = nx;
    s.z = nz;
  }
  s.wheelRoll += (s.speed * dt) / VEHICLE_CONFIG.wheelRadius;
  return blocked;
}
function approach(value, target, amount) {
  return value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);
}
