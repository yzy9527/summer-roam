import * as THREE from 'three';
import { CALF_CARRY_MODES } from './config.js';
const smooth = (t) => t * t * t * (10 + t * (-15 + 6 * t));
// Pose application is separate from reservation, task phases and sound decisions.
export function createHeistCarryPose({ giant, getCalf, getPose, getMode }) {
  let handGaps = [0, 0];
  const frame = () => CALF_CARRY_MODES[getMode()];
  const local = (x, y, z) =>
    giant.object.localToWorld(new THREE.Vector3(x / 0.7, y / 0.7, z / 0.7));
  const heldHeading = () => giant.object.rotation.y + frame().yaw;
  const heldPosition = (height = frame().height) => local(frame().x, height, frame().z);
  const syncCalf = () => {
    const calf = getCalf();
    const p = calf.group.getWorldPosition(new THREE.Vector3());
    calf.x = p.x;
    calf.z = p.z;
    Object.assign(calf.collider, { x: p.x, z: p.z });
  };
  function throwPose(dt, progress, swinging = false) {
    const calf = getCalf(),
      pose = getPose(),
      carryMode = getMode();
    const underarm = carryMode === 'underarm';
    const z = swinging
      ? THREE.MathUtils.lerp(-0.2, underarm ? 0.55 : 0.08, progress)
      : -0.2 * progress;
    const y = swinging
      ? THREE.MathUtils.lerp(underarm ? 0.1 : 0.02, underarm ? 0.5 : 0.06, progress)
      : (underarm ? 0.1 : 0.02) * progress;
    calf.group.position.copy(local(frame().x, frame().height + y, frame().z + z));
    calf.group.rotation.set(0, heldHeading(), 0, 'YXZ');
    updatePose(dt, true);
    const targets = pose.supports(carryMode);
    giant.rig.hold(
      targets,
      swinging ? (underarm ? 0.12 : 0.04) * (1 - progress) : (underarm ? 0.12 : 0.04) * progress,
      dt,
      1,
      carryMode,
      swinging ? 1 - smooth(THREE.MathUtils.clamp((progress - 0.75) / 0.25, 0, 1)) : 1,
      {
        lean: underarm
          ? swinging
            ? THREE.MathUtils.lerp(-0.08, 0.22, progress)
            : -0.08 * progress
          : swinging
            ? THREE.MathUtils.lerp(0.2, 0.4, progress)
            : THREE.MathUtils.lerp(0.25, 0.2, progress),
        palmPitch: swinging ? (underarm ? -0.5 : -0.2) * progress : 0,
      },
    );
    handGaps = giant.rig.hands(carryMode).map((p, i) => p.distanceTo(targets[i]));
    syncCalf();
  }
  function hold(dt, squat, reach = 1) {
    const pose = getPose(),
      carryMode = getMode();
    const targets = pose.supports(carryMode);
    giant.rig.hold(targets, squat, dt, reach, carryMode);
    handGaps = giant.rig.hands(carryMode).map((p, i) => p.distanceTo(targets[i]));
  }
  function updatePose(dt, carried = true, blend = 1) {
    getPose().update(dt, carried, blend, getMode());
  }
  function carryPose(dt, height = frame().height, squat = 0, blend = 1) {
    const calf = getCalf();
    calf.group.position.copy(heldPosition(height));
    calf.group.rotation.set(0, heldHeading(), 0, 'YXZ');
    updatePose(dt, true, blend);
    hold(dt, squat);
    syncCalf();
  }
  function measureHands(targets) {
    handGaps = giant.rig.hands(getMode()).map((p, i) => p.distanceTo(targets[i]));
    return handGaps;
  }
  return {
    measureHands,
    syncCalf,
    throwPose,
    hold,
    updatePose,
    carryPose,
    heldHeading,
    heldPosition,
    get handGaps() {
      return handGaps;
    },
  };
}
