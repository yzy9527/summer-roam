import * as THREE from 'three';

const axis = new THREE.Vector3(1, 0, 0);
const ease = (t) => t * t * t * (10 + t * (-15 + 6 * t));

// Ground-to-ground leap: planted wind-up, hind push, gathered flight and
// fore-first landing. Uses the real leopard joints, including fixed hocks.
export function createLeopardJumpPose({ root, group, body, bodyRest, restQ, legs, solveLeg }) {
  let active = false;
  const anchors = new Map(),
    previous = new Map();
  const bindWorld = new Map();
  root.traverse((bone) => {
    if (bone.isBone)
      bindWorld.set(
        bone,
        group
          .getWorldQuaternion(new THREE.Quaternion())
          .invert()
          .multiply(bone.getWorldQuaternion(new THREE.Quaternion())),
      );
  });
  function aim(bone, target, dt) {
    const reference = group
      .getWorldQuaternion(new THREE.Quaternion())
      .multiply(bindWorld.get(bone));
    const from = new THREE.Vector3(0, 1, 0).applyQuaternion(reference);
    const to = target.clone().sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
    const desired = new THREE.Quaternion()
      .setFromUnitVectors(from, to)
      .multiply(reference)
      .normalize();
    if (previous.has(bone)) previous.get(bone).rotateTowards(desired, dt * 28);
    else previous.set(bone, desired.clone());
    bone.quaternion.copy(
      bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(previous.get(bone)),
    );
    bone.updateWorldMatrix(false, true);
  }
  return {
    update(dt, a) {
      const state = a.milkJump;
      if (!active) {
        active = true;
        for (const leg of legs) anchors.set(leg, leg.hoof.getWorldPosition(new THREE.Vector3()));
      }
      for (const [bone, q] of restQ) bone.quaternion.copy(q);
      const t = state.progress;
      const windup = state.phase === 'windup',
        flight = state.phase === 'flight';
      const crouch = windup
        ? Math.sin(Math.PI * t) * 0.12
        : flight
          ? 0
          : Math.sin(Math.PI * t) * 0.09;
      body.position.copy(bodyRest);
      body.position.y -= crouch / a.scale;
      const pitch = windup
        ? -0.08 * Math.sin(Math.PI * t)
        : flight
          ? -0.1 * Math.sin(2 * Math.PI * t)
          : 0;
      for (const [i, name] of ['Pelvis', 'Spine_Lower', 'Spine_Upper', 'Chest'].entries())
        root
          .getObjectByName(name)
          ?.quaternion.multiply(
            new THREE.Quaternion().setFromAxisAngle(axis, pitch * [0.4, -0.6, -0.3, 0.7][i]),
          );
      for (const [i, name] of ['Tail', 'Tail_Mid', 'Tail_Tip'].entries())
        root
          .getObjectByName(name)
          ?.quaternion.multiply(
            new THREE.Quaternion().setFromAxisAngle(
              axis,
              (-0.12 * Math.sin(Math.PI * t) * (i + 1)) / 3,
            ),
          );
      group.updateMatrixWorld(true);
      for (const leg of legs) {
        const fore = leg.name[0] === 'F';
        const footQ = group.getWorldQuaternion(new THREE.Quaternion()).multiply(leg.hoofQ);
        let target;
        if (windup) target = anchors.get(leg).clone();
        else {
          const local = leg.restFoot.clone();
          const gathered = flight
            ? Math.sin(Math.PI * t)
            : 1 - ease(Math.min(1, t / (fore ? 0.18 : 0.35)));
          local.y += ((fore ? 0.28 : 0.38) * gathered) / a.scale;
          local.z += ((fore ? -0.12 : 0.15) * gathered) / a.scale;
          target = group.localToWorld(local);
          if (!flight)
            target.y =
              state.ground(target.x, target.z) +
              0.025 +
              leg.restFoot.y * a.scale +
              (fore ? 0 : 0.07 * (1 - ease(Math.min(1, t / 0.35))));
        }
        const hip = leg.upper.getWorldPosition(new THREE.Vector3());
        const offset = leg.distalOffset.clone().multiplyScalar(a.scale).applyQuaternion(footQ);
        const joint = target.clone().add(offset),
          reach = (leg.l1 + leg.l2) * a.scale - 0.00002;
        const d = joint.clone().sub(hip);
        if (d.length() > reach) {
          joint.copy(hip).add(d.setLength(reach));
          target.copy(joint).sub(offset);
        }
        const knee = solveLeg(
          hip,
          joint,
          leg.l1 * a.scale,
          leg.l2 * a.scale,
          new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion),
        );
        aim(leg.upper, knee, dt);
        aim(leg.lower, joint, dt);
        if (leg.hock) aim(leg.hock, target, dt);
        leg.hoof.quaternion.copy(
          leg.hoof.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(footQ),
        );
        leg.hoof.updateWorldMatrix(false, true);
        leg.runStance = windup || (!flight && (fore || t >= 0.35));
        leg.solvedTarget = target;
        leg.lastFoot = leg.hoof.getWorldPosition(new THREE.Vector3());
      }
      return 0;
    },
    reset() {
      active = false;
      anchors.clear();
      previous.clear();
      for (const leg of legs) {
        leg.anchor.copy(leg.hoof.getWorldPosition(new THREE.Vector3()));
        leg.anchorQ.copy(leg.hoof.getWorldQuaternion(new THREE.Quaternion()));
        leg.lastFoot = leg.anchor.clone();
        leg.start = leg.goal = null;
        delete leg.runStance;
      }
    },
    snapshot: () => ({ active }),
  };
}
