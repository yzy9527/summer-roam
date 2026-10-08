import * as THREE from 'three';
import { VEHICLE_CONFIG } from './vehicle-config.js';
export const WHEEL_NAMES = ['wheel_FL', 'wheel_FR', 'wheel_BL', 'wheel_BR'];
export function validateVehicleAsset(asset) {
  for (const name of WHEEL_NAMES) {
    const wheel = asset.getObjectByName(name);
    if (!wheel) throw new Error('Missing wheel ' + name);
    if (
      !Number.isFinite(wheel.userData.radius) ||
      Math.abs(wheel.userData.radius * VEHICLE_CONFIG.modelScale - VEHICLE_CONFIG.wheelRadius) >
        1e-6
    )
      throw new Error('Wheel radius/config mismatch ' + name);
    if (
      Math.abs(wheel.quaternion.x) + Math.abs(wheel.quaternion.y) + Math.abs(wheel.quaternion.z) >
      1e-5
    )
      throw new Error('Unexpected wheel root rotation ' + name);
    const bounds = new THREE.Box3().setFromObject(wheel, true),
      center = bounds.getCenter(new THREE.Vector3());
    if (
      Math.abs(
        ((bounds.max.y - bounds.min.y) / 2) * VEHICLE_CONFIG.modelScale -
          VEHICLE_CONFIG.wheelRadius,
      ) > 1e-5 ||
      center.distanceTo(wheel.position) > 1e-5
    )
      throw new Error('Wheel geometry/pivot mismatch ' + name);
  }
  return asset;
}
export function assembleVehicle(asset) {
  const car = new THREE.Group(),
    body = new THREE.Group(),
    wheels = [];
  car.rotation.order = 'YXZ';
  car.add(body);
  asset.scale.multiplyScalar(VEHICLE_CONFIG.modelScale);
  body.add(asset);
  for (const name of WHEEL_NAMES) {
    const pivot = asset.getObjectByName(name),
      steerGroup = new THREE.Group();
    steerGroup.position.copy(pivot.position).multiplyScalar(VEHICLE_CONFIG.modelScale);
    pivot.position.set(0, 0, 0);
    pivot.scale.multiplyScalar(VEHICLE_CONFIG.modelScale);
    car.add(steerGroup);
    steerGroup.add(pivot);
    wheels.push({ steerGroup, rollGroup: pivot, front: name.includes('_F') });
  }
  return { car, body, wheels };
}
