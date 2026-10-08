import * as THREE from 'three';
import { CALF_TASK_SPEED } from './config.js';
const smooth = (t) => t * t * t * (10 + t * (-15 + 6 * t));
const turn = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
// This controller exclusively owns the seat/ground bone and parent transitions.
export function createCrewTransitions({ scene, zombies, ground }) {
  const transitions = new Map();
  function transitionPose(actor, action) {
    const oldPosition = actor.object.getWorldPosition(new THREE.Vector3()),
      oldQuaternion = actor.object.getWorldQuaternion(new THREE.Quaternion());
    const from = [];
    actor.source.traverse((n) => {
      if (n.isBone) from.push({ bone: n, q: n.quaternion.clone(), p: n.position.clone() });
    });
    action();
    const toPosition = actor.object.position.clone(),
      toQuaternion = actor.object.quaternion.clone();
    const fromPosition = oldPosition.clone();
    const fromQuaternion = oldQuaternion.clone();
    const seatParent = actor.object.parent;
    seatParent.localToWorld(toPosition);
    toQuaternion.premultiply(seatParent.getWorldQuaternion(new THREE.Quaternion()));
    scene.attach(actor.object);
    fromPosition.copy(oldPosition);
    fromQuaternion.copy(oldQuaternion);
    transitions.set(actor, {
      seatParent,
      actor,
      from,
      toPosition,
      toQuaternion,
      fromPosition,
      fromQuaternion,
      mounting: actor.seated,
      stage: actor.seated ? 'walk' : 'stand',
      t: 0,
    });
    for (const e of from) {
      e.toQ = e.bone.quaternion.clone();
      e.toP = e.bone.position.clone();
      e.bone.quaternion.copy(e.q);
      e.bone.position.copy(e.p);
    }
    actor.object.position.copy(fromPosition);
    actor.object.quaternion.copy(fromQuaternion);
    actor.transitioning = true;
  }
  function updateTransition(tr, dt) {
    const a = tr.actor;
    const blendBones = (t) => {
      for (const e of tr.from) {
        e.bone.quaternion.copy(e.q).slerp(e.toQ, t);
        e.bone.position.copy(e.p).lerp(e.toP, t);
      }
    };
    if (tr.stage === 'stand') {
      tr.t = Math.min(1, tr.t + dt / 0.8);
      blendBones(smooth(tr.t));
      a.object.position.y = THREE.MathUtils.lerp(tr.fromPosition.y, tr.toPosition.y, smooth(tr.t));
      if (tr.t === 1) {
        tr.stage = 'walk';
        tr.t = 0;
        zombies.rebind(a.layout.id);
      }
    } else if (tr.stage === 'walk') {
      const p = a.object.position;
      const dx = tr.toPosition.x - p.x,
        dz = tr.toPosition.z - p.z;
      const distance = Math.hypot(dx, dz),
        heading = Math.atan2(dx, dz);
      const error = turn(heading, a.object.rotation.y);
      const yaw = THREE.MathUtils.clamp(error, -dt * 1.8, dt * 1.8);
      a.object.rotation.y += yaw;
      const step =
        Math.abs(error - yaw) < 0.12 ? Math.min(distance, CALF_TASK_SPEED.steps * dt) : 0;
      p.x += (dx * step) / Math.max(distance, 1e-9);
      p.z += (dz * step) / Math.max(distance, 1e-9);
      // Seat translation uses the walking rig; lowering only starts at the seat.
      a.rig.update(
        dt,
        Math.max(step, Math.abs(yaw) * 0.07),
        (x, z) => ground(x, z) + 0.551,
        a.object.rotation.y,
        0,
      );
      if (distance < 0.02) {
        if (!tr.mounting) {
          tr.seatParent.attach(a.object);
          a.transitioning = false;
          transitions.delete(a);
          Object.assign(a.collider, { x: p.x, z: p.z });
          return true;
        }
        tr.stage = 'seat-turn';
        tr.t = 0;
      }
    } else if (tr.stage === 'seat-turn') {
      const desired = new THREE.Euler().setFromQuaternion(tr.toQuaternion, 'YXZ').y;
      const error = turn(desired, a.object.rotation.y);
      const yaw = THREE.MathUtils.clamp(error, -dt * 1.8, dt * 1.8);
      a.object.rotation.y += yaw;
      a.rig.update(dt, Math.abs(yaw) * 0.07, (x, z) => ground(x, z) + 0.551);
      if (Math.abs(error) < 0.02) {
        tr.stage = 'sit';
        tr.fromPosition.copy(a.object.position);
        for (const e of tr.from) {
          e.q.copy(e.bone.quaternion);
          e.p.copy(e.bone.position);
        }
      }
    } else {
      tr.t = Math.min(1, tr.t + dt / 0.8);
      blendBones(smooth(tr.t));
      a.object.position.copy(tr.fromPosition).lerp(tr.toPosition, smooth(tr.t));
      a.object.quaternion.copy(tr.toQuaternion);
      if (tr.t === 1) {
        tr.seatParent.attach(a.object);
        a.transitioning = false;
        transitions.delete(a);
        return true;
      }
    }
    a.object.updateMatrixWorld(true);
    return false;
  }
  return { transitions, transitionPose, updateTransition };
}
