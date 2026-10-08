import * as THREE from 'three';
import { drivingHeight } from './world-queries.js';

// Presets keep choosing the live subject/framing. Manual input owns the viewing angle.
export function createInspectionCamera(groundHeight = drivingHeight) {
  const offset = new THREE.Vector3();
  const focus = new THREE.Vector3();
  let active = false,
    manual = false,
    yaw = 0,
    pitch = 0,
    zoom = 1;
  return {
    get active() {
      return active;
    },
    get focus() {
      return active ? focus : null;
    },
    reset() {
      active = manual = false;
      zoom = 1;
    },
    rotate(dx, dy) {
      if (!active) return false;
      if (dx || dy) {
        manual = true;
        yaw -= dx * 0.006;
        pitch = THREE.MathUtils.clamp(pitch + dy * 0.004, 0.04, 1.45);
      }
      return true;
    },
    zoom(delta) {
      if (!active) return false;
      zoom = THREE.MathUtils.clamp(zoom * Math.exp(delta * 0.001), 0.5, 3);
      return true;
    },
    update(camera, position, target) {
      active = true;
      focus.copy(target);
      offset.copy(position).sub(target);
      const radius = Math.max(0.01, offset.length());
      if (!manual) {
        yaw = Math.atan2(offset.x, offset.z);
        pitch = Math.asin(THREE.MathUtils.clamp(offset.y / radius, -1, 1));
      }
      if (!manual && zoom === 1) camera.position.copy(position);
      else {
        const distance = radius * zoom;
        camera.position.set(
          target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
          target.y + Math.sin(pitch) * distance,
          target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
        );
        camera.position.y = Math.max(
          camera.position.y,
          groundHeight(camera.position.x, camera.position.z) + 0.18,
        );
      }
      camera.lookAt(target);
    },
  };
}
