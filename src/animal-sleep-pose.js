import * as THREE from 'three';
import { landscapeHeight } from './world-queries.js';

const up = new THREE.Vector3(0, 1, 0);
const xAxis = new THREE.Vector3(1, 0, 0);
// Fold real articulated limbs with fixed bone lengths. The belly measurement is
// taken from Body-weighted vertices of the shipped skin, including calf scale.
export function createAnimalSleepPose({
  root,
  group,
  profile,
  body,
  bodyRest,
  head,
  restQ,
  legs,
  blinkMeshes,
  solveLeg,
  aim,
}) {
  const pose = profile.sleep;
  if (!pose) return null;
  let belly = Infinity;
  root.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const torsoIndices = new Set(
      mesh.skeleton.bones.flatMap((bone, index) =>
        bone === body || ['Pelvis', 'Spine_Lower', 'Spine_Upper', 'Chest'].includes(bone.name)
          ? [index]
          : [],
      ),
    );
    const ids = mesh.geometry.attributes.skinIndex,
      weights = mesh.geometry.attributes.skinWeight;
    for (let i = 0; i < weights.count; i++) {
      let weight = 0;
      for (let k = 0; k < 4; k++)
        if (torsoIndices.has(ids.getComponent(i, k))) weight += weights.getComponent(i, k);
      if (weight > 0.8)
        belly = Math.min(
          belly,
          group.worldToLocal(mesh.localToWorld(mesh.getVertexPosition(i, new THREE.Vector3()))).y,
        );
    }
  });
  const drop = Math.max(0, belly - pose.belly);
  let amount = 0;
  return {
    update(dt, animal) {
      amount = animal.sleepAmount;
      const previousNeck = root.getObjectByName('Neck').quaternion.clone();
      const previousHead = head.quaternion.clone();
      for (const [bone, q] of restQ) bone.quaternion.copy(q);
      body.position.copy(bodyRest);
      body.position.y -= drop * amount;
      body.position.y += Math.sin(animal.clock * 1.3) * 0.003 * amount;
      const neck = root.getObjectByName('Neck');
      neck.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, pose.neck * amount));
      neck.quaternion.slerp(previousNeck, Math.exp(-dt * 6));
      head.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, pose.head * amount));
      head.quaternion.slerp(previousHead, Math.exp(-dt * 6));
      group.updateMatrixWorld(true);
      for (const [i, name] of ['Tail', 'Tail_Mid', 'Tail_Tip'].entries()) {
        const bone = root.getObjectByName(name);
        bone.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(xAxis, pose.tailLift[i] * amount),
        );
        // Curl horizontally in the parent's frame, preserving the tail's length.
        const axis = up
          .clone()
          .applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()))
          .applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
        bone.quaternion.premultiply(
          new THREE.Quaternion().setFromAxisAngle(axis, pose.tailCurl[i] * amount),
        );
        bone.updateWorldMatrix(true, true);
      }
      for (const side of ['L', 'R'])
        root
          .getObjectByName('Ear_' + side)
          .quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, -0.06 * amount));
      group.updateMatrixWorld(true);
      const support = animal.supportHeight ?? landscapeHeight;
      for (const leg of legs) {
        if (animal.treeClimb) continue;
        const front = leg.name[0] === 'F';
        const local = leg.restFoot.clone();
        local.z += (front ? pose.fore : pose.hind) * (profile.sleepUnit ?? 1) * amount;
        local.x += Math.sign(local.x) * pose.spread * amount;
        const target = group.localToWorld(local);
        target.y = support(target.x, target.z) + 0.025 + leg.restFoot.y * animal.scale;
        const footQ = group
          .getWorldQuaternion(new THREE.Quaternion())
          .multiply(leg.hoofQ)
          .normalize();

        const hip = leg.upper.getWorldPosition(new THREE.Vector3());
        const offset = leg.distalOffset.clone();
        if (leg.hock) {
          const length = offset.length();
          const folded = new THREE.Vector3(0, length * 0.3, -length * Math.sqrt(1 - 0.3 ** 2));
          // Offset is in the group frame, while the walking offset is in foot space.
          offset.applyQuaternion(leg.hoofQ).lerp(folded, amount).setLength(length);
          offset
            .multiplyScalar(animal.scale)
            .applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
        }
        const joint = target.clone().add(offset);
        const hint = new THREE.Vector3(0, 0, front || leg.hock ? 1 : -1).applyQuaternion(
          group.getWorldQuaternion(new THREE.Quaternion()),
        );
        const knee = solveLeg(hip, joint, leg.l1 * animal.scale, leg.l2 * animal.scale, hint);
        aim(leg.upper, knee, dt);
        aim(leg.lower, joint, dt);
        if (leg.hock) aim(leg.hock, target, dt);
        leg.hoof.quaternion.copy(
          leg.hoof.parent
            .getWorldQuaternion(new THREE.Quaternion())
            .invert()
            .multiply(footQ)
            .normalize(),
        );
        leg.hoof.updateWorldMatrix(false, true);
        leg.anchor.copy(leg.hoof.getWorldPosition(new THREE.Vector3()));
        leg.anchorQ.copy(footQ);
        leg.solvedTarget = target;
        leg.lastFoot = leg.anchor.clone();
        leg.start = leg.goal = null;
        leg.stanceTime = Infinity;
        delete leg.runStance;
      }
      const closed = THREE.MathUtils.smoothstep(amount, 0.15, 0.8);
      for (const mesh of blinkMeshes) {
        const morph = mesh.morphTargetDictionary;
        mesh.morphTargetInfluences[morph.Blink] = closed;
        if (morph.GazeLeft !== undefined)
          mesh.morphTargetInfluences[morph.GazeLeft] = mesh.morphTargetInfluences[morph.GazeRight] =
            0;
      }
      return closed;
    },
    snapshot: () => ({
      amount,
      bodyDrop: drop * group.scale.x,
      bellyClearance: pose.belly * group.scale.x,
    }),
    reset() {
      amount = 0;
    },
  };
}
