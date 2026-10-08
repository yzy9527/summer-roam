import * as THREE from 'three';
import { drivingHeight } from '../world-queries.js';
import { terrainHeight } from '../world-base.js';
export function createVehicleCamera({ getState, getCamera, getQA, getDrag, orbit, colliders }) {
  let renderedAngle = getState().heading,
    renderedPitch = orbit.pitch,
    renderedDistance = orbit.distance;
  const lookTarget = new THREE.Vector3(),
    cameraTarget = new THREE.Vector3();
  function update(dt, snap = false) {
    const state = getState(),
      camera = getCamera(),
      qa = getQA(),
      drag = getDrag();
    if (qa?.updateInspectionCamera(camera)) return;
    // Interpolate spherical values, never a chord through the car during an orbit.
    const blend = snap ? 1 : 1 - Math.exp(-dt * (drag ? 10 : 4.5));
    const driftMix = state.drift?.amount ?? 0;
    const targetAngle = state.heading + (state.drift?.slipAngle ?? 0) * driftMix * 0.65 + orbit.yaw;
    const angleDelta = Math.atan2(
      Math.sin(targetAngle - renderedAngle),
      Math.cos(targetAngle - renderedAngle),
    );
    renderedAngle += angleDelta * blend;
    renderedPitch += (orbit.pitch - renderedPitch) * blend;
    renderedDistance += (orbit.distance - renderedDistance) * blend;
    const d = renderedDistance * Math.cos(renderedPitch);
    cameraTarget.set(
      state.x - Math.sin(renderedAngle) * d,
      drivingHeight(state.x, state.z) + 1.45 + renderedDistance * Math.sin(renderedPitch),
      state.z - Math.cos(renderedAngle) * d,
    );
    // The terrain is low and open. Lift the camera above the few larger scenery hills.
    cameraTarget.y = Math.max(cameraTarget.y, drivingHeight(cameraTarget.x, cameraTarget.z) + 1.25);
    // Keep the sightline clear when looking across a rolling hill, not only at the camera endpoint.
    const targetY = drivingHeight(state.x, state.z) + 0.15; // Protect the tyres as well as the cabin.
    for (let i = 1; i < 16; i++) {
      const t = i / 16,
        x = state.x + (cameraTarget.x - state.x) * t,
        z = state.z + (cameraTarget.z - state.z) * t;
      const required = drivingHeight(x, z) + 0.35;
      cameraTarget.y = Math.max(cameraTarget.y, targetY + (required - targetY) / t);
    }
    // Prevent a low orbit from entering tree trunks or house volumes.
    const focus = new THREE.Vector3(state.x, drivingHeight(state.x, state.z) + 1.25, state.z);
    for (let j = 1; j <= 20; j++) {
      const t = j / 20,
        p = focus.clone().lerp(cameraTarget, t);
      if (
        colliders.some(
          (c) =>
            Math.hypot(p.x - c.x, p.z - c.z) < c.radius + 0.25 &&
            p.y < terrainHeight(c.x, c.z) + (c.height || 5.5),
        )
      ) {
        cameraTarget.copy(focus.clone().lerp(cameraTarget, Math.max(0.35, t - 0.08)));
        break;
      }
    }
    lookTarget.set(
      state.x + Math.sin(renderedAngle) * 5.5,
      drivingHeight(state.x, state.z) + 2.65,
      state.z + Math.cos(renderedAngle) * 5.5,
    );
    qa?.applyVehicleCamera(
      cameraTarget,
      lookTarget,
      renderedAngle,
      renderedPitch,
      renderedDistance,
    );
    camera.position.copy(cameraTarget);
    camera.lookAt(lookTarget);
  }
  return { update };
}
