import * as THREE from 'three';
import { landscapeHeight } from './world-queries.js';

const up = new THREE.Vector3(0, 1, 0),
  xAxis = new THREE.Vector3(1, 0, 0);
const ease = (t) => t * t * t * (10 + t * (-15 + 6 * t));

// Separate contact gait on a three-dimensional branch. Planted paws retain their
// position/normal; only one paw swings at a time. Bone lengths remain unchanged.
export function createAnimalTreePose({
  root,
  group,
  body,
  bodyRest,
  restQ,
  legs,
  blinkMeshes,
  solveLeg,
  sleepPose,
}) {
  let active = false,
    cycle = 0,
    lastDistance = 0,
    descentPitch = 0;
  let feet = new Map();
  const contactCache = new Map();
  const turnPivot = legs
    .reduce(
      (center, leg) =>
        center.add(group.worldToLocal(leg.upper.getWorldPosition(new THREE.Vector3()))),
      new THREE.Vector3(),
    )
    .multiplyScalar(1 / legs.length);
  turnPivot.y = 0;
  const spine = ['Pelvis', 'Spine_Lower', 'Spine_Upper', 'Chest']
    .map((name) => root.getObjectByName(name))
    .filter(Boolean);
  const bindForward = new THREE.Vector3(0, 0, 1).applyQuaternion(
    group.getWorldQuaternion(new THREE.Quaternion()),
  );
  const spineBind = spine.map((bone) => ({
    q: bone.getWorldQuaternion(new THREE.Quaternion()).normalize(),
    z: group.worldToLocal(bone.getWorldPosition(new THREE.Vector3())).z,
  }));
  function contact(a, leg, lead = 0) {
    const { tree } = a.treeClimb;
    const local = leg.walkCenter.clone();
    local.x = leg.restFoot.x;
    local.y = leg.restFoot.y;
    local.z += lead / a.scale + (leg.name[0] === 'F' ? -0.12 : 0.18) * (a.treeClimb.rest ?? 0);
    const probe = group.localToWorld(local);
    const hip = leg.upper.getWorldPosition(new THREE.Vector3());
    const reach = (leg.l1 + leg.l2 + leg.distalOffset.length() * 0.35) * a.scale - 0.045;
    const orientation = group.getWorldQuaternion(new THREE.Quaternion());
    const cached = contactCache.get(leg);
    if (
      lead === 0 &&
      cached &&
      cached.probe.distanceTo(probe) < 0.006 &&
      cached.hip.distanceTo(hip) < 0.006 &&
      cached.orientation.angleTo(orientation) < 0.005 &&
      cached.point.distanceTo(hip) < reach
    )
      return { point: cached.point.clone(), normal: cached.normal.clone(), q: cached.q.clone() };
    const p = tree.contactNear(probe, hip, reach);
    const q = group.getWorldQuaternion(new THREE.Quaternion()).multiply(leg.hoofQ);
    const normal = up.clone().applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
    q.premultiply(new THREE.Quaternion().setFromUnitVectors(normal, p.normal));
    p.point.addScaledVector(p.normal, 0.025 + leg.restFoot.y * a.scale);
    if (lead === 0)
      contactCache.set(leg, {
        probe,
        hip,
        orientation,
        point: p.point.clone(),
        normal: p.normal.clone(),
        q: q.clone(),
      });
    return { point: p.point, normal: p.normal, q };
  }
  const api = {
    update(dt, a) {
      const state = a.treeClimb;
      state.pivot = turnPivot;
      if (!active) {
        active = true;
        lastDistance = a.distance;
        cycle = 0;
        feet = new Map(
          legs.map((leg) => [
            leg,
            {
              point: leg.hoof.getWorldPosition(new THREE.Vector3()),
              q: leg.hoof.getWorldQuaternion(new THREE.Quaternion()),
              last: leg.offset,
              start: null,
              ground: leg.hoof.getWorldPosition(new THREE.Vector3()),
            },
          ]),
        );
      }
      const previousOffsets = new Map(
        legs
          .filter((leg) => leg.hock)
          .map((leg) => [
            leg,
            leg.hock
              .getWorldPosition(new THREE.Vector3())
              .sub(leg.hoof.getWorldPosition(new THREE.Vector3())),
          ]),
      );
      const previousSpine = spine.map((bone) => bone.quaternion.clone());
      const airborne = state.phase === 'jumping';
      const landing = state.phase === 'landing';
      const jumping = airborne || landing;
      const previousJoints = new Map(
        legs
          .flatMap((leg) => [leg.upper, leg.lower, leg.hock].filter(Boolean))
          .map((bone) => [bone, bone.getWorldQuaternion(new THREE.Quaternion()).normalize()]),
      );
      const previousKnees = new Map(
        legs.map((leg) => [
          leg,
          leg.lower
            .getWorldPosition(new THREE.Vector3())
            .sub(leg.upper.getWorldPosition(new THREE.Vector3())),
        ]),
      );
      const previousFootQ = new Map(
        legs.map((leg) => [leg, leg.hoof.getWorldQuaternion(new THREE.Quaternion())]),
      );
      const lookBones = ['Neck', 'Head', 'Ear_L', 'Ear_R'].map((name) =>
        root.getObjectByName(name),
      );
      const previousLook = lookBones.map((bone) => bone.quaternion.clone().normalize());
      const previousTail = ['Tail', 'Tail_Mid', 'Tail_Tip'].map((name) =>
        root.getObjectByName(name).quaternion.clone(),
      );
      let sleepBlink = null;
      if (state.rest > 0) {
        sleepBlink = sleepPose.update(dt, { ...a, sleepAmount: state.rest });
        body.position.y -= (0.225 * (1 - state.rest)) / a.scale;
        // Long relaxed tail hangs beyond the fork instead of curling into the trunk.
        for (const [i, name] of ['Tail', 'Tail_Mid', 'Tail_Tip'].entries()) {
          const bone = root.getObjectByName(name);
          const desired = restQ
            .get(bone)
            .clone()
            .multiply(
              new THREE.Quaternion().setFromAxisAngle(xAxis, state.rest * [0.2, 0.46, 0.58][i]),
            );
          bone.quaternion.copy(previousTail[i]).slerp(desired, 1 - Math.exp(-dt * 6));
          bone.updateWorldMatrix(true, true);
        }
      }

      const distance = Math.max(0, a.distance - lastDistance);
      lastDistance = a.distance;
      cycle += distance / 0.34;
      if (sleepBlink === null) for (const [bone, q] of restQ) bone.quaternion.copy(q);
      if (sleepBlink === null) {
        body.position.copy(bodyRest);
        body.position.y -= (0.225 * (state.mount ?? 1)) / a.scale;
        body.position.y += Math.sin(cycle * Math.PI * 4) * 0.006;
      }
      const looking =
        sleepBlink === null && a.velocity < 0.01 ? Math.sin(a.clock * 0.48) * 0.12 : 0;
      if (sleepBlink === null) {
        const head = root.getObjectByName('Head');

        head.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(up, looking));
        for (const [i, name] of ['Tail', 'Tail_Mid', 'Tail_Tip'].entries()) {
          const bone = root.getObjectByName(name);
          bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, 0.12));
          bone.quaternion.multiply(
            new THREE.Quaternion().setFromAxisAngle(up, Math.sin(a.clock * 0.9 - i * 0.4) * 0.07),
          );
          bone.quaternion.slerp(previousTail[i], Math.exp(-dt * 8));
        }
        for (const side of ['L', 'R'])
          root
            .getObjectByName('Ear_' + side)
            .quaternion.multiply(
              new THREE.Quaternion().setFromAxisAngle(
                xAxis,
                Math.sin(a.clock * 1.7 + (side === 'L' ? 0 : 2)) * 0.04,
              ),
            );
      }
      // Absolute tree targets: adding a climb offset after the sleep controller
      // blends its previous pose accumulates a large backward bend each frame.
      const rest = state.rest ?? 0;
      const neck = root.getObjectByName('Neck'),
        head = root.getObjectByName('Head');
      neck.quaternion
        .copy(restQ.get(neck))
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(xAxis, THREE.MathUtils.lerp(-0.32, 0.12, rest)),
        );
      head.quaternion
        .copy(restQ.get(head))
        .multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, 0.1 * rest))
        .multiply(new THREE.Quaternion().setFromAxisAngle(up, looking * (1 - rest)));
      for (const [i, bone] of lookBones.entries()) {
        const desired = bone.quaternion.clone().normalize();
        bone.quaternion
          .copy(previousLook[i])
          .rotateTowards(desired, dt * 6)
          .normalize();
        bone.updateWorldMatrix(true, true);
      }
      // A shoulder pull precedes the pelvis push. The spine distributes
      // curvature across real deform joints, while every joint keeps its length.
      descentPitch = THREE.MathUtils.damp(
        descentPitch,
        state.phase === 'descending'
          ? THREE.MathUtils.smoothstep(state.tree.frame(state.s).normal.y, 0.4, 0.85) * -0.08
          : 0,
        6,
        dt,
      );
      body.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, descentPitch));
      const mountPulse = Math.sin(Math.PI * (state.mount ?? 1));
      const pulse = a.velocity > 0.01 ? Math.sin(cycle * Math.PI * 2) * 0.045 : 0;
      const turn = state.phase === 'turning' ? Math.sin(state.yaw ?? 0) : 0;
      const tuck = jumping
        ? Math.sin(Math.PI * (state.jumpT ?? 0))
        : state.phase === 'jump-ready'
          ? Math.sin(Math.PI * Math.min(1, state.phaseTime / 0.45))
          : 0;
      for (const [i, bone] of spine.entries()) {
        const bend =
          mountPulse * [0.24, -0.32, -0.2, 0.12][i] +
          pulse * [0.5, -1, -0.7, 0.4][i] +
          tuck * [0.08, -0.14, -0.1, 0.05][i] -
          descentPitch * [0, 0.5, 0.75, 0.375][i];
        bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(xAxis, bend));
        bone.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(up, turn * [-0.1, 0.08, 0.1, 0.08][i]),
        );
        bone.updateWorldMatrix(true, true);
        if (!jumping && state.phase !== 'turning') {
          const yaw = state.yaw ?? 0;
          const offset =
            (turnPivot.z * (1 - Math.cos(yaw)) + spineBind[i].z * Math.cos(yaw)) * a.scale;
          const curveFrame = state.tree.frame(state.s + offset);
          const desiredForward = curveFrame.forward
            .clone()
            .multiplyScalar(Math.cos(yaw))
            .addScaledVector(curveFrame.side, Math.sin(yaw))
            .normalize();
          const worldQ = bone.getWorldQuaternion(new THREE.Quaternion()).normalize();
          const actualForward = bindForward
            .clone()
            .applyQuaternion(spineBind[i].q.clone().invert())
            .applyQuaternion(worldQ)
            .normalize();
          const align = new THREE.Quaternion().setFromUnitVectors(actualForward, desiredForward);
          const amount =
            THREE.MathUtils.smoothstep(state.mount ?? 1, 0.7, 1) * (1 - (state.rest ?? 0));
          worldQ.premultiply(new THREE.Quaternion().slerp(align, amount));
          bone.quaternion.copy(
            bone.parent
              .getWorldQuaternion(new THREE.Quaternion())
              .invert()
              .multiply(worldQ)
              .normalize(),
          );
        }
        const desired = bone.quaternion.clone();
        bone.quaternion.copy(previousSpine[i]).rotateTowards(desired, dt * 4);
        bone.updateWorldMatrix(true, true);
      }
      if (landing) body.position.y -= (0.055 * Math.sin(Math.PI * (state.landing ?? 0))) / a.scale;
      if (jumping) {
        body.position.y += (0.225 * (state.mount ?? 1) * ease(state.jumpT ?? 0)) / a.scale;
        if (airborne) body.position.y -= (0.045 * tuck) / a.scale;
      }
      group.updateMatrixWorld(true);
      const mounting = (state.mount ?? 1) < 1;
      let swinging = [...feet.values()].some((f) => f.start);
      const neutralContacts = new Map(legs.map((leg) => [leg, contact(a, leg)]));
      let candidate = null,
        worstDrift = 0;
      if (!swinging && !jumping)
        for (const leg of legs) {
          const f = feet.get(leg);
          if (!f || (mounting && !f.attached)) continue;
          const delta = neutralContacts.get(leg).point.clone().sub(f.point);
          const ahead =
            delta.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion)) < -0.03;
          const drift = delta.length();
          const phase = (cycle + leg.offset) % 1;
          const scheduled = distance > 0 && phase >= 0.78 && (f.last < 0.78 || f.last > phase);
          const hip = leg.upper.getWorldPosition(new THREE.Vector3());
          const joint = f.point.clone();
          const urgent =
            drift > 0.008 &&
            hip.distanceTo(joint) > (leg.l1 + leg.l2 + leg.distalOffset.length()) * a.scale - 0.018;
          const score = drift + (urgent ? 1 : 0);
          if (((!ahead && drift > 0.115) || scheduled || urgent) && score > worstDrift) {
            candidate = leg;
            worstDrift = score;
          }
        }
      state.blockedStep =
        !jumping &&
        [...feet].some(([leg, f]) => {
          if (mounting && !f.attached) return false;
          const hip = leg.upper.getWorldPosition(new THREE.Vector3());
          const joint = f.point.clone();
          const delta = neutralContacts.get(leg).point.clone().sub(f.point);
          const ahead =
            delta.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion)) < -0.03;
          return (
            (!ahead && delta.length() > 0.145) ||
            (delta.length() > 0.009 &&
              hip.distanceTo(joint) >
                (leg.l1 + leg.l2 + leg.distalOffset.length()) * a.scale - 0.008)
          );
        });
      for (const leg of legs) {
        if (!feet.has(leg))
          feet.set(leg, { ...contact(a, leg), last: (cycle + leg.offset) % 1, start: null });
        const f = feet.get(leg),
          phase = (cycle + leg.offset) % 1;
        const neutral = neutralContacts.get(leg);

        if (!jumping && (!mounting || f.attached) && leg === candidate && !f.start && !swinging) {
          f.start = f.point.clone();
          f.startQ = f.q.clone();
          f.goal = contact(a, leg, mounting ? 0 : a.velocity > 0.01 ? 0.17 : 0);
          f.duration = Math.max(mounting ? 0.1 : 0.17, f.start.distanceTo(f.goal.point) / 1.1);
          f.elapsed = 0;
          swinging = true;
        }
        let target = f.point.clone(),
          footQ = f.q.clone(),
          lift = 0;
        if (f.start) {
          f.elapsed += dt;
          const t = Math.min(1, f.elapsed / f.duration);
          lift = 64 * (t * (1 - t)) ** 3;
          target
            .copy(f.start)
            .lerp(f.goal.point, ease(t))
            .addScaledVector(f.goal.normal, 0.04 * lift);
          footQ.copy(f.startQ).slerp(f.goal.q, ease(t));
          if (t === 1) {
            f.point.copy(f.goal.point);
            f.q.copy(f.goal.q);
            f.start = null;
            leg.steps++;
            swinging = false;
          }
        }
        if (mounting && !f.attached) {
          const time = state.phaseTime ?? 0;
          const start =
            leg.name[0] === 'F' ? (leg.name === 'FL' ? 0.02 : 0.1) : leg.name === 'HL' ? 0.3 : 0.5;
          const end = leg.name[0] === 'F' ? (leg.name === 'FL' ? 0.55 : 0.65) : 1.8;
          const t = THREE.MathUtils.clamp((time - start) / (end - start), 0, 1);
          f.mountGoal = neutral.point.clone();
          target.copy(f.ground).lerp(f.mountGoal, ease(t));
          footQ
            .copy(group.getWorldQuaternion(new THREE.Quaternion()).multiply(leg.hoofQ))
            .slerp(neutral.q, t * t);
          f.point.copy(target);
          f.q.copy(footQ);
          if (t === 1) f.attached = true;
        }
        if (jumping) {
          f.start = null;
          const local = leg.restFoot.clone();
          const t = state.jumpT ?? 0;
          const fore = leg.name[0] === 'F';
          local.y += (fore ? 0.16 : 0.25) * Math.sin(Math.PI * t);
          local.z += (fore ? -0.1 : 0.12) * Math.sin(Math.PI * t);
          local.y += body.position.y - bodyRest.y;
          if (!f.flightStart) f.flightStart = group.worldToLocal(f.point.clone());
          local.lerp(f.flightStart, 1 - THREE.MathUtils.smoothstep(t, 0, 0.45));
          target.copy(group.localToWorld(local));
          footQ.copy(group.getWorldQuaternion(new THREE.Quaternion()).multiply(leg.hoofQ));
          if (landing) {
            const groundY = landscapeHeight(target.x, target.z) + 0.025 + leg.restFoot.y * a.scale;
            target.y =
              groundY +
              (fore ? 0 : 0.05 * (1 - THREE.MathUtils.smoothstep(state.landing ?? 0, 0, 0.3)));
          }
          f.point.copy(target);
          f.q.copy(footQ);
        }
        const previousQ = previousFootQ.get(leg);
        previousQ.rotateTowards(footQ, dt * 16);
        footQ.copy(previousQ);
        const hip = leg.upper.getWorldPosition(new THREE.Vector3());
        const offset = leg.distalOffset.clone().multiplyScalar(a.scale).applyQuaternion(footQ);
        if (leg.hock) {
          const previousOffset = previousOffsets.get(leg);
          const offsetTurn = new THREE.Quaternion().setFromUnitVectors(
            previousOffset.clone().normalize(),
            offset.clone().normalize(),
          );
          offset
            .copy(previousOffset)
            .applyQuaternion(new THREE.Quaternion().rotateTowards(offsetTurn, dt * 8));
          // A deeply flexed ankle cannot retain the standing metatarsal angle:
          // rotate its fixed-length segment back, leaving the paw on the bark.
          const rotateOffset = (from, to, t) => {
            const turn = new THREE.Quaternion().setFromUnitVectors(
              from.clone().normalize(),
              to.clone().normalize(),
            );
            return from.clone().applyQuaternion(new THREE.Quaternion().slerp(turn, t));
          };
          const minReach = Math.abs(leg.l1 - leg.l2) * a.scale + 0.04;
          const maxReach = (leg.l1 + leg.l2) * a.scale - 0.02;
          if (hip.distanceTo(target.clone().add(offset)) > maxReach) {
            const towardHip = hip.clone().sub(target).normalize().multiplyScalar(offset.length());
            let lo = 0,
              hi = 1;
            for (let i = 0; i < 18; i++) {
              const t = (lo + hi) / 2;
              const candidate = rotateOffset(offset, towardHip, t);
              if (hip.distanceTo(target.clone().add(candidate)) > maxReach) lo = t;
              else hi = t;
            }
            offset.copy(rotateOffset(offset, towardHip, hi));
          }
          const folded = target.clone().sub(hip).normalize().multiplyScalar(offset.length());
          const length = offset.length();
          if (hip.distanceTo(target.clone().add(offset)) < minReach) {
            let lo = 0,
              hi = 1;
            if (hip.distanceTo(target.clone().add(folded)) < minReach)
              folded.copy(target).sub(hip).normalize().multiplyScalar(length);
            for (let i = 0; i < 18; i++) {
              const t = (lo + hi) / 2;
              const candidate = rotateOffset(offset, folded, t);
              if (hip.distanceTo(target.clone().add(candidate)) < minReach) lo = t;
              else hi = t;
            }
            offset.copy(rotateOffset(offset, folded, hi));
          }
        }
        const joint = target.clone().add(offset);
        const direction = joint.clone().sub(hip).normalize();
        const hint = previousKnees.get(leg).clone();
        hint.addScaledVector(direction, -hint.dot(direction));
        if (hint.lengthSq() < 0.000001) {
          hint.copy(new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion));
          hint.addScaledVector(direction, -hint.dot(direction));
          if (hint.lengthSq() < 0.01) hint.copy(up).applyQuaternion(group.quaternion);
        }
        hint.normalize();
        const knee = solveLeg(hip, joint, leg.l1 * a.scale, leg.l2 * a.scale, hint);
        const aimContactJoint = (bone, child, point) => {
          bone.quaternion.copy(
            bone.parent
              .getWorldQuaternion(new THREE.Quaternion())
              .invert()
              .multiply(previousJoints.get(bone)),
          );
          bone.updateWorldMatrix(false, true);
          const origin = bone.getWorldPosition(new THREE.Vector3());
          const from = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
          const to = point.clone().sub(origin).normalize();
          const desired = new THREE.Quaternion()
            .setFromUnitVectors(from, to)
            .multiply(bone.getWorldQuaternion(new THREE.Quaternion()))
            .normalize();
          const q = previousJoints
            .get(bone)
            .clone()
            .normalize()
            .rotateTowards(desired, dt * 22)
            .normalize();
          bone.quaternion.copy(
            bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q).normalize(),
          );
          bone.updateWorldMatrix(false, true);
        };
        aimContactJoint(leg.upper, leg.lower, knee);
        aimContactJoint(leg.lower, leg.hock ?? leg.hoof, joint);
        if (leg.hock) aimContactJoint(leg.hock, leg.hoof, target);
        leg.hoof.quaternion.copy(
          leg.hoof.parent
            .getWorldQuaternion(new THREE.Quaternion())
            .invert()
            .multiply(footQ)
            .normalize(),
        );
        leg.hoof.updateWorldMatrix(false, true);
        if (leg.toes)
          leg.toes.quaternion.multiply(
            new THREE.Quaternion().setFromAxisAngle(xAxis, -0.12 * lift),
          );
        leg.anchor.copy(f.point);
        leg.anchorQ.copy(f.q);
        leg.lastFoot = leg.hoof.getWorldPosition(new THREE.Vector3());
        leg.solvedTarget = target.clone();
        leg.runStance = !airborne && !f.start;
        leg.start = null;
        leg.goal = null;
        f.last = phase;
      }
      state.swinging = [...feet.values()].some((f) => f.start);
      if (state.phase === 'turning' || mounting)
        state.blockedStep ||= [...feet.values()].some((f) => f.start);
      state.settled = ![...feet.values()].some((f) => f.start) && !state.blockedStep;
      const blink = sleepBlink ?? Math.max(0, Math.sin(a.clock * 0.8)) ** 32;
      for (const mesh of blinkMeshes) {
        const morph = mesh.morphTargetDictionary;
        mesh.morphTargetInfluences[morph.Blink] = blink;
        if (morph.GazeLeft !== undefined) {
          mesh.morphTargetInfluences[morph.GazeLeft] = Math.max(0, -looking);
          mesh.morphTargetInfluences[morph.GazeRight] = Math.max(0, looking);
        }
      }
      return blink;
    },
    reset() {
      active = false;
      descentPitch = 0;
      feet.clear();
      contactCache.clear();
      for (const leg of legs) {
        leg.anchor.copy(leg.hoof.getWorldPosition(new THREE.Vector3()));
        leg.anchorQ.copy(leg.hoof.getWorldQuaternion(new THREE.Quaternion()));
        leg.lastFoot = leg.anchor.clone();
        leg.start = leg.goal = null;
        delete leg.runStance;
      }
    },
    snapshot: () => ({
      active,
      cycle,
      contacts: [...feet].map(([leg, f]) => ({
        name: leg.name,
        swinging: !!f.start,
        point: f.point.toArray(),
      })),
    }),
  };
  return api;
}
