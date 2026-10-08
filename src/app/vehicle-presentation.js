import * as THREE from 'three';
import { bullImpactPose } from '../bull-impact.js';
import { drivingHeight } from '../world-queries.js';
import { VEHICLE_CONFIG } from '../vehicle-config.js';
import { steeringAngle, frontWheelAngle } from '../vehicle-steering.js';
export function createVehiclePresentation({ getVehicle, getImpact, setImpact, reducedMotion }) {
  let bullBaseRoll = 0;
  function update(dt) {
    const { state, mode, car, body, wheels } = getVehicle();
    let bullImpact = getImpact();
    if (bullImpact && mode === 'playing') bullImpact.time += dt;
    const impactWave =
      bullImpact && bullImpact.time < 0.65
        ? Math.sin(bullImpact.time * 26) * Math.exp(-bullImpact.time * 7)
        : 0;
    const impulse = bullImpactPose(bullImpact);
    if (impulse.done) {
      bullImpact = null;
      setImpact(null);
    }
    const sy = drivingHeight(state.x, state.z),
      fx = Math.sin(state.heading),
      fz = Math.cos(state.heading),
      rx = Math.cos(state.heading),
      rz = -Math.sin(state.heading);
    const tyreGround = wheels.map((w) =>
      drivingHeight(
        state.x + rx * w.steerGroup.position.x + fx * w.steerGroup.position.z,
        state.z + rz * w.steerGroup.position.x + fz * w.steerGroup.position.z,
      ),
    );
    const support = tyreGround.length
      ? tyreGround.reduce((a, b) => a + b, 0) / tyreGround.length
      : sy;
    car.position.set(state.x, support + VEHICLE_CONFIG.groundOffset, state.z);
    car.rotation.y = state.heading;
    const slope =
      (drivingHeight(
        state.x + fx * (VEHICLE_CONFIG.wheelbase / 2),
        state.z + fz * (VEHICLE_CONFIG.wheelbase / 2),
      ) -
        drivingHeight(
          state.x - fx * (VEHICLE_CONFIG.wheelbase / 2),
          state.z - fz * (VEHICLE_CONFIG.wheelbase / 2),
        )) /
      VEHICLE_CONFIG.wheelbase;
    const camber =
      (drivingHeight(
        state.x + rx * (VEHICLE_CONFIG.track / 2),
        state.z + rz * (VEHICLE_CONFIG.track / 2),
      ) -
        drivingHeight(
          state.x - rx * (VEHICLE_CONFIG.track / 2),
          state.z - rz * (VEHICLE_CONFIG.track / 2),
        )) /
      VEHICLE_CONFIG.track;
    car.rotation.x = -Math.atan(slope);
    car.rotation.z = Math.atan(camber) + impulse.roll;
    car.position.y += impulse.lift;
    car.position.x += rx * impulse.shift;
    car.position.z += rz * impulse.shift;
    bullBaseRoll = THREE.MathUtils.lerp(
      bullBaseRoll,
      -state.steer * state.speed * 0.0014,
      reducedMotion ? 1 : Math.min(1, dt * 7),
    );
    body.rotation.z =
      bullBaseRoll + (reducedMotion ? 0 : impactWave * (bullImpact?.side ?? 0) * 0.045);
    body.rotation.x = reducedMotion ? 0 : impactWave * (bullImpact?.along ?? 0) * 0.025;
    body.position.y = reducedMotion
      ? 0
      : Math.sin(((state.wheelRoll * VEHICLE_CONFIG.wheelRadius) / 0.43) * 0.7) *
          Math.min(Math.abs(state.speed) * 0.0006, 0.015) +
        state.bump * 0.022 +
        Math.abs(impactWave) * 0.014;
    const angle = steeringAngle(state.steer, state.speed);
    wheels.forEach((w) => {
      w.steerGroup.rotation.y = w.front ? frontWheelAngle(angle, w.steerGroup.position.x) : 0;
      w.rollGroup.rotation.x = state.wheelRoll;
      w.steerGroup.position.y = VEHICLE_CONFIG.wheelRadius;
    });
    car.updateMatrixWorld(true);
    // Small suspension travel follows rounded berms without changing drive response.
    if (!impulse.locked)
      for (let pass = 0; pass < 2; pass++)
        for (const w of wheels) {
          const p = w.steerGroup.getWorldPosition(new THREE.Vector3()),
            target =
              drivingHeight(p.x, p.z) + VEHICLE_CONFIG.groundOffset + VEHICLE_CONFIG.wheelRadius;
          w.steerGroup.position.y += (target - p.y) / car.matrixWorld.elements[5];
          w.steerGroup.updateMatrixWorld(true);
        }
  }
  return {
    update,
    reset() {
      bullBaseRoll = 0;
    },
  };
}
