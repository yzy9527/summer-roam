import { assetUrl } from './asset-url.js';
// Source GLBs stay at original dimensions. All runtime vehicle parts share this scale.
export const VEHICLE_SCALE = 0.85;
export const VEHICLE_CONFIG = Object.freeze({
  model: assetUrl('vehicle'),
  fallbackModel: assetUrl('vehicle-base'),
  modelScale: VEHICLE_SCALE,
  maxSteeringAngle: (35 * Math.PI) / 180,
  maxLateralAcceleration: 4.5,
  sourceWheelRadius: 0.35,
  wheelRadius: 0.35 * VEHICLE_SCALE,
  wheelbase: 2.24 * VEHICLE_SCALE,
  track: 1.54 * VEHICLE_SCALE,
  groundOffset: 0.035 * VEHICLE_SCALE,
  collisionRadius: 1.018 * VEHICLE_SCALE,
  collisionHalfWidth: 1.018 * VEHICLE_SCALE,
  collisionHalfLength: 1.817 * VEHICLE_SCALE,
  collisionCenterZ: 0.006 * VEHICLE_SCALE,
});
