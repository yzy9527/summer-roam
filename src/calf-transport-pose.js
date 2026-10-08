import * as THREE from 'three';
import { solveCowLeg } from './animal-animation.js';

const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (t) => THREE.MathUtils.clamp(t, 0, 1);

// Transport owns the original skin. Suspended feet never run ground-world IK.
export function restoreCalf(a) {
  for (const { bone, rotation, position } of a.bindPose) {
    bone.quaternion.copy(rotation);
    bone.position.copy(position);
  }
  a.group.updateMatrixWorld(true);
}

export function createCalfTransportPose(a) {
  restoreCalf(a);
  const landingLegs = ['FL', 'FR', 'HL', 'HR'].map((name) => {
    const upper = a.source.getObjectByName(name + '_Upper'),
      lower = a.source.getObjectByName(name + '_Lower'),
      hoof = a.source.getObjectByName(name + '_Hoof');
    const hip = a.group.worldToLocal(upper.getWorldPosition(new THREE.Vector3())),
      knee = a.group.worldToLocal(lower.getWorldPosition(new THREE.Vector3())),
      foot = a.group.worldToLocal(hoof.getWorldPosition(new THREE.Vector3()));
    return { name, upper, lower, hoof, foot, l1: hip.distanceTo(knee), l2: knee.distanceTo(foot) };
  });
  const aim = (bone, child, target) => {
    const origin = bone.getWorldPosition(new THREE.Vector3()),
      from = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize(),
      to = target.clone().sub(origin).normalize(),
      world = bone.getWorldQuaternion(new THREE.Quaternion());
    world.premultiply(new THREE.Quaternion().setFromUnitVectors(from, to));
    bone.quaternion.copy(
      bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world),
    );
    bone.updateWorldMatrix(false, true);
  };
  const point = (names) =>
    names
      .reduce(
        (p, name) =>
          p.add(
            a.group.worldToLocal(
              a.source.getObjectByName(name).getWorldPosition(new THREE.Vector3()),
            ),
          ),
        new THREE.Vector3(),
      )
      .multiplyScalar(1 / names.length);
  const fore = point(['FL_Upper', 'FR_Upper']),
    hind = point(['HL_Upper', 'HR_Upper']);
  fore.y -= 0.04 / a.scale;
  hind.y -= 0.04 / a.scale;
  // Close downward against the outer abdomen; the elbow stays above the back.
  const belly = fore.clone().lerp(hind, 0.5);
  belly.x -= 0.24 / a.scale;
  // Set the heel higher so the downward fingers close beneath the abdomen,
  // between naturally hanging legs, rather than leaving an empty hand loop.
  belly.y += 0.42 / a.scale;
  const axis = (name, direction, angle) =>
    a.source
      .getObjectByName(name)
      .quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(direction, angle));
  const worldAxis = (name, direction, angle) => {
    const bone = a.source.getObjectByName(name);
    const local = direction
      .clone()
      .applyQuaternion(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(local, angle));
  };
  let clock = 0,
    struggleAge = Infinity,
    calling = false,
    struggle = 0,
    shake = 0,
    blink = 0,
    tail = 0,
    headYaw = 0,
    headPitch = 0,
    kicks = [];
  return {
    supports: (mode = 'two-hand') =>
      (mode === 'underarm' ? [belly] : [fore, hind]).map((p) => a.group.localToWorld(p.clone())),
    startStruggle() {
      struggleAge = 0;
    },
    setCalling(value) {
      calling = !!value;
    },
    land(progress) {
      // Flex the real legs while all four hoof transforms remain fixed in the bed.
      const compression = Math.sin(Math.PI * clamp(progress)) ** 2 * 0.075;
      const orientations = landingLegs.map((leg) =>
        leg.hoof.getWorldQuaternion(new THREE.Quaternion()),
      );
      a.source.getObjectByName('Body').position.y -= compression / a.scale;
      a.group.updateMatrixWorld(true);
      for (const [i, leg] of landingLegs.entries()) {
        const target = a.group.localToWorld(leg.foot.clone()),
          hip = leg.upper.getWorldPosition(new THREE.Vector3()),
          hint = new THREE.Vector3(0, 0, leg.name.startsWith('F') ? 1 : -1).applyQuaternion(
            a.group.getWorldQuaternion(new THREE.Quaternion()),
          ),
          knee = solveCowLeg(hip, target, leg.l1 * a.scale, leg.l2 * a.scale, hint);
        aim(leg.upper, leg.lower, knee);
        aim(leg.lower, leg.hoof, target);
        leg.hoof.quaternion.copy(
          leg.hoof.parent
            .getWorldQuaternion(new THREE.Quaternion())
            .invert()
            .multiply(orientations[i]),
        );
        leg.hoof.updateWorldMatrix(false, true);
      }
      a.group.updateMatrixWorld(true);
    },
    update(dt, carried = true, blend = 1, mode = 'two-hand') {
      if (!(dt > 0)) return;
      clock += dt;
      if (Number.isFinite(struggleAge)) struggleAge += dt;
      // Let the feet clear the ground first, then sustain several alternating
      // kicks. Decay smoothly instead of abruptly returning to the hanging pose.
      struggle =
        carried && struggleAge < 2.25
          ? smooth(clamp(struggleAge / 0.3)) *
            (1 - smooth(clamp((struggleAge - 1.3) / 0.95))) *
            smooth(clamp(blend / 0.5))
          : 0;
      restoreCalf(a);
      kicks = [];
      if (carried)
        for (const [i, prefix] of ['FL', 'FR', 'HL', 'HR'].entries()) {
          const wave = struggle
            ? Math.sin(struggleAge * 12 + [0, Math.PI, Math.PI * 0.7, Math.PI * 1.7][i])
            : 0;
          const kick = wave * (prefix.startsWith('F') ? 0.38 : 0.46) * struggle;
          kicks.push(kick);
          axis(
            prefix + '_Upper',
            new THREE.Vector3(1, 0, 0),
            (prefix.startsWith('F') ? -1 : 1) * (mode === 'underarm' ? 0 : 0.1) * blend + kick,
          );
          axis(
            prefix + '_Lower',
            new THREE.Vector3(1, 0, 0),
            (mode === 'underarm' ? 0.06 : 0.16) * blend + (1 + wave) * 0.25 * struggle,
          );
        }
      const shakeTime = clock % 7.1;
      shake =
        !carried && shakeTime > 2.4 && shakeTime < 3.7
          ? Math.sin(((shakeTime - 2.4) / 1.3) * Math.PI) ** 2 *
            Math.sin((shakeTime - 2.4) * 12) *
            0.15
          : 0;
      headYaw = struggle ? Math.sin(struggleAge * 8) * 0.36 * struggle : 0;
      headPitch = struggle ? Math.sin(struggleAge * 6.5 + 0.4) * 0.15 * struggle : 0;
      worldAxis('Neck', new THREE.Vector3(0, 1, 0), headYaw * 0.15);
      worldAxis('Head', new THREE.Vector3(0, 1, 0), shake + headYaw);
      worldAxis(
        'Head',
        new THREE.Vector3(1, 0, 0).applyQuaternion(
          a.group.getWorldQuaternion(new THREE.Quaternion()),
        ),
        headPitch,
      );
      axis('Head', new THREE.Vector3(0, 0, 1), Math.sin(clock * 1.2) * 0.025);
      for (const [name, gain] of [
        ['Ear_L', 0.04],
        ['Ear_R', -0.045],
      ])
        axis(
          name,
          new THREE.Vector3(0, 0, 1),
          Math.sin(clock * 1.7 + gain * 8) * gain + struggle * gain * 2,
        );
      tail = Math.sin(clock * 1.45) * (carried ? 0.05 : 0.13);
      for (const [i, name] of ['Tail', 'Tail_Mid', 'Tail_Tip'].entries())
        axis(
          name,
          new THREE.Vector3(0, 0, 1),
          Math.sin(clock * 1.45 - i * 0.38) * (carried ? 0.05 : 0.13) * (1 + i * 0.4),
        );
      if (calling) axis('Jaw', new THREE.Vector3(1, 0, 0), 0.08 + 0.07 * Math.sin(clock * 14) ** 2);
      const t = clock % 4.1;
      blink = t < 0.24 ? Math.sin((t / 0.24) * Math.PI) ** 2 : 0;
      a.source.traverse((n) => {
        if (n.morphTargetDictionary?.Blink !== undefined)
          n.morphTargetInfluences[n.morphTargetDictionary.Blink] = blink;
      });
      a.group.updateMatrixWorld(true);
    },
    snapshot: () => ({
      clock,
      struggleAge: Number.isFinite(struggleAge) ? struggleAge : null,
      struggle,
      calling,
      shake,
      blink,
      tail,
      headYaw,
      headPitch,
      kicks,
    }),
  };
}
