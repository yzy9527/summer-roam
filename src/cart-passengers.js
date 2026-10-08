import * as THREE from 'three';

const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const semantic = (name) => name.replace(/_0\d+$/, '');

// Seat the original browncoat; every duplicated head/body skin receives the pose.
export function createCartDriver(
  source,
  object,
  {
    hipY = 0.94,
    hipZ = 1,
    feetY = 0.68,
    feetZ = 1.5,
    footX = 0.18,
    handY = 1.095,
    handZ = 1.41,
    handX = 0.29,
    armBend = [1, -0.3, 0],
  } = {},
) {
  const parent = object.parent;
  object.position.set(0, 0, 0);
  object.rotation.set(0, 0, 0);
  const copies = new Map();
  source.traverse((bone) => {
    if (!bone.isBone) return;
    const name = semantic(bone.name);
    if (!copies.has(name)) copies.set(name, []);
    copies.get(name).push(bone);
  });
  const entries = new Map(
    [...copies].map(([name, bones]) => [
      name,
      {
        bone: bones[0],
        rest: bones[0].quaternion.clone().normalize(),
        position: bones[0].position.clone(),
      },
    ]),
  );
  const find = (name) => {
    const e = entries.get(name);
    if (!e) throw new Error(`Cart driver missing bone: ${name}`);
    return e;
  };
  parent.updateMatrixWorld(true);
  const hip = parent.worldToLocal(find('Hips').bone.getWorldPosition(new THREE.Vector3()));
  object.position.set(-hip.x, hipY - hip.y, hipZ - hip.z);
  parent.updateMatrixWorld(true);
  const limbs = [];
  for (const [index, side] of ['Left', 'Right'].entries()) {
    const sign = index === 0 ? 1 : -1;
    for (const leg of [true, false]) {
      const a = find(side + (leg ? 'UpLeg' : 'Arm'));
      const b = find(side + (leg ? 'Leg' : 'ForeArm'));
      const c = find(side + (leg ? 'Foot' : 'Hand'));
      const world = c.bone.getWorldQuaternion(new THREE.Quaternion());
      const localOrientation = parent
        .getWorldQuaternion(new THREE.Quaternion())
        .invert()
        .multiply(world)
        .normalize();
      limbs.push({
        a,
        b,
        c,
        l1: a.bone
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(b.bone.getWorldPosition(new THREE.Vector3())),
        l2: b.bone
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(c.bone.getWorldPosition(new THREE.Vector3())),
        target: leg
          ? new THREE.Vector3(sign * footX, feetY, feetZ)
          : new THREE.Vector3(sign * handX, handY, handZ),
        bend: leg
          ? new THREE.Vector3(0, 0, 1)
          : new THREE.Vector3(sign * armBend[0], armBend[1], armBend[2]),
        localOrientation,
      });
    }
  }
  const aim = (entry, child, target) => {
    const direction = target.clone().sub(entry.bone.getWorldPosition(new THREE.Vector3()));
    direction
      .applyQuaternion(entry.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert())
      .normalize();
    const restDirection = child.position.clone().normalize().applyQuaternion(entry.rest);
    entry.bone.quaternion.setFromUnitVectors(restDirection, direction).multiply(entry.rest);
    entry.bone.quaternion.normalize();
    entry.bone.updateWorldMatrix(false, true);
  };
  let clock = 0;
  function pose() {
    for (const e of entries.values()) {
      e.bone.quaternion.copy(e.rest);
      e.bone.position.copy(e.position);
    }
    find('Head').bone.quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(Z, Math.sin(clock * 0.85) * 0.018),
    );
    parent.updateMatrixWorld(true);
    for (const { a, b, c, l1, l2, target, bend, localOrientation } of limbs) {
      const start = a.bone.getWorldPosition(new THREE.Vector3());
      const end = parent.localToWorld(target.clone());
      const direction = end.clone().sub(start);
      const distance = THREE.MathUtils.clamp(
        direction.length(),
        Math.abs(l1 - l2) + 0.001,
        l1 + l2 - 0.001,
      );
      direction.normalize();
      const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
      const perpendicular = bend
        .clone()
        .applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()));
      perpendicular.addScaledVector(direction, -perpendicular.dot(direction)).normalize();
      const joint = start
        .clone()
        .addScaledVector(direction, along)
        .addScaledVector(perpendicular, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
      aim(a, b.bone, joint);
      aim(b, c.bone, start.clone().addScaledVector(direction, distance));
      c.bone.quaternion.copy(
        c.bone.parent
          .getWorldQuaternion(new THREE.Quaternion())
          .invert()
          .multiply(parent.getWorldQuaternion(new THREE.Quaternion()))
          .multiply(localOrientation),
      );
      c.bone.quaternion.normalize();
    }
    for (const [name, e] of entries)
      for (const bone of copies.get(name)) {
        bone.quaternion.copy(e.bone.quaternion);
        bone.position.copy(e.bone.position);
      }
    parent.updateMatrixWorld(true);
  }
  pose();
  return {
    update(dt) {
      if (dt > 0) {
        clock += dt;
        pose();
      }
    },
    snapshot: () => ({
      seated: true,
      clock,
      hips: find('Hips').bone.getWorldPosition(new THREE.Vector3()).toArray(),
    }),
  };
}

// Transport is a standing pose in the bed's frame, with no ground walking IK.
// Only the carried instance is controlled here; meadow cows keep their own behavior.
export function createCartCargo(source, parent, scale = 0.4875) {
  const group = new THREE.Group();
  group.name = 'Carried adult copper cow';
  // A cloned skin must refresh its bone matrices before measuring. Its cached
  // matrixWorld can still refer to the meadow animal's former parent transform.
  source.updateMatrixWorld(true);
  source.traverse((mesh) => {
    if (mesh.isSkinnedMesh) mesh.skeleton.update();
  });
  const bounds = new THREE.Box3().setFromObject(source, true);
  const size = bounds.getSize(new THREE.Vector3()).multiplyScalar(scale);
  if (size.x > 1.35 || size.z > 2.3) throw new Error('Cow does not fit the wooden cart');
  const center = bounds.getCenter(new THREE.Vector3());
  source.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  group.add(source);
  group.scale.setScalar(scale);
  group.position.set(0, 0.551, -0.55);
  parent.add(group);
  group.updateMatrixWorld(true);
  const bindPose = [];
  source.traverse((bone) => {
    if (bone.isBone)
      bindPose.push({ bone, rotation: bone.quaternion.clone(), position: bone.position.clone() });
  });
  const animated = ['Head', 'Neck', 'Jaw', 'Ear_L', 'Ear_R', 'Tail', 'Tail_Mid', 'Tail_Tip'].map(
    (name) => {
      const bone = source.getObjectByName(name);
      if (!bone?.isBone) throw new Error(`Cargo cow missing bone: ${name}`);
      return { name, bone, rest: bone.quaternion.clone().normalize() };
    },
  );
  const faces = [];
  source.traverse((mesh) => {
    if (mesh.morphTargetDictionary?.Blink !== undefined) faces.push(mesh);
  });
  let clock = 0;
  return {
    group,
    source,
    release(parent) {
      for (const { bone, rotation, position } of bindPose) {
        bone.quaternion.copy(rotation);
        bone.position.copy(position);
      }
      parent.attach(group);
      group.updateMatrixWorld(true);
    },
    update(dt) {
      if (!(dt > 0)) return;
      clock += dt;
      for (const { name, bone, rest } of animated) {
        bone.quaternion.copy(rest);
        const tail = name.startsWith('Tail');
        const delay = name === 'Tail_Tip' ? 0.6 : name === 'Tail_Mid' ? 0.3 : 0;
        const angle = tail
          ? Math.sin(clock * 1.1 - delay) * 0.065
          : name.startsWith('Ear')
            ? Math.sin(clock * 1.7 + (name === 'Ear_L' ? 0 : 1.5)) * 0.028
            : name === 'Jaw'
              ? (0.5 + 0.5 * Math.sin(clock * 2.1)) * 0.024
              : Math.sin(clock * 0.8) * 0.014;
        bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(tail ? Z : X, angle));
      }
      const t = clock % 4.3;
      const blink = t < 0.24 ? Math.sin((Math.PI * t) / 0.24) ** 2 : 0;
      for (const face of faces)
        face.morphTargetInfluences[face.morphTargetDictionary.Blink] = blink;
      group.updateMatrixWorld(true);
    },
    snapshot: () => ({ id: 'copper-cow', scale, size: size.toArray(), clock, standing: true }),
  };
}
