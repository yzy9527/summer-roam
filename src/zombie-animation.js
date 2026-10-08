import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const smooth = (t) => t * t * t * (10 + t * (-15 + 6 * t));
const semantic = (name) => name.replace(/_0\d+$/, '');

// The head, cone and body have independent copies of the same source rig.
// Animate one rig and copy its local pose to every attached skin, including props.
export function createZombieAnimation(
  source,
  group,
  { giant = false, flagBearer = false, scale, speed },
) {
  const copies = new Map();
  source.traverse((bone) => {
    if (!bone.isBone) return;
    const key = semantic(bone.name);
    if (!copies.has(key)) copies.set(key, []);
    copies.get(key).push(bone);
  });
  const names = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'Jaw'];
  for (const side of ['Left', 'Right'])
    names.push(
      ...['Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase'].map((part) => side + part),
    );
  if (copies.has('Neck1')) names.push('Neck1');
  if (flagBearer)
    names.push('RightHand_Prop_01', 'RightHand_Prop_02', 'RightHand_Prop_03', 'RightHand_Prop_04');
  names.push(
    ...[...copies.keys()].filter((name) =>
      /^(?:Left|Right)Hand(?:Middle|Ring|Pinky|Index|Thumb)[0-3]$/.test(name),
    ),
  );
  group.updateMatrixWorld(true);
  const groupQ = group.getWorldQuaternion(new THREE.Quaternion());
  const entries = new Map(
    names.map((name) => {
      const bone = copies.get(name)?.[0];
      if (!bone) throw new Error(`Missing zombie joint: ${name}`);
      return [
        name,
        {
          bone,
          rest: bone.quaternion.clone(),
          position: bone.position.clone(),
          orientation: groupQ
            .clone()
            .invert()
            .multiply(bone.getWorldQuaternion(new THREE.Quaternion())),
        },
      ];
    }),
  );
  const legs = ['Left', 'Right'].map((side, i) => {
    const upper = entries.get(side + 'UpLeg'),
      lower = entries.get(side + 'Leg'),
      foot = entries.get(side + 'Foot');
    const world = foot.bone.getWorldPosition(new THREE.Vector3());
    const ankle = group.worldToLocal(world.clone());
    return {
      side,
      upper,
      lower,
      foot,
      ankle,
      upperLength: upper.bone
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(lower.bone.getWorldPosition(new THREE.Vector3())),
      lowerLength: lower.bone.getWorldPosition(new THREE.Vector3()).distanceTo(world),
      planted: world.clone(),
      target: world.clone(),
      from: world.clone(),
      heading: group.rotation.y,
      fromHeading: group.rotation.y,
      toHeading: group.rotation.y,
      phaseOffset: i * 0.5,
      swinging: false,
      pending: false,
      progress: 0,
      correction: false,
    };
  });
  // Distance over a full left/right cycle; widen walking steps by 30%.
  const walkStepScale = 1.3;
  const walkStride = (giant ? 0.42 : 0.4) * walkStepScale;
  let stride = walkStride,
    duty = 0.64,
    runAmount = 0;
  let cycles = 0,
    clock = 0,
    flagClock = 0;
  let locomotionUpdated = false,
    holdFeet = null,
    holdAt = null;
  const q = new THREE.Quaternion(),
    delta = new THREE.Quaternion(),
    desired = new THREE.Vector3();
  const restingArm = new Map();
  const armLengths = Object.fromEntries(
    ['Left', 'Right'].map((side) => {
      const a = entries.get(side + 'Arm').bone.getWorldPosition(new THREE.Vector3());
      const b = entries.get(side + 'ForeArm').bone.getWorldPosition(new THREE.Vector3());
      const c = entries.get(side + 'Hand').bone.getWorldPosition(new THREE.Vector3());
      return [side, [a.distanceTo(b), b.distanceTo(c)]];
    }),
  );

  function worldOrientation(entry, rotation, heading = group.rotation.y) {
    const yaw = q.setFromAxisAngle(UP, heading).clone();
    const world = yaw
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)))
      .multiply(entry.orientation);
    entry.bone.quaternion.copy(
      entry.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world),
    );
    entry.bone.updateWorldMatrix(false, true);
  }
  function aim(entry, child, target) {
    const bone = entry.bone;
    const direction = target.clone().sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
    direction.applyQuaternion(bone.parent.getWorldQuaternion(q).invert());
    const bindDirection = child.position.clone().normalize().applyQuaternion(entry.rest);
    bone.quaternion.copy(delta.setFromUnitVectors(bindDirection, direction)).multiply(entry.rest);
    bone.updateWorldMatrix(false, true);
  }
  function solveLeg(leg, target) {
    const hip = leg.upper.bone.getWorldPosition(new THREE.Vector3());
    const direction = target.clone().sub(hip);
    const distance = THREE.MathUtils.clamp(
      direction.length(),
      Math.abs(leg.upperLength - leg.lowerLength) + 0.001,
      leg.upperLength + leg.lowerLength - 0.001,
    );
    direction.normalize();
    const forward = FORWARD.clone().applyQuaternion(group.getWorldQuaternion(q));
    const pole = forward.addScaledVector(direction, -forward.dot(direction)).normalize();
    const along = (leg.upperLength ** 2 - leg.lowerLength ** 2 + distance ** 2) / (2 * distance);
    const knee = hip
      .clone()
      .addScaledVector(direction, along)
      .addScaledVector(pole, Math.sqrt(Math.max(0, leg.upperLength ** 2 - along ** 2)));
    aim(leg.upper, leg.lower.bone, knee);
    aim(leg.lower, leg.foot.bone, hip.addScaledVector(direction, distance));
    worldOrientation(leg.foot, [0, 0, 0], leg.heading);
  }
  function synchronize() {
    for (const [name, entry] of entries)
      for (const bone of copies.get(name)) {
        bone.quaternion.copy(entry.bone.quaternion);
        bone.position.copy(entry.bone.position);
      }
    group.updateMatrixWorld(true);
  }
  function poseBody() {
    for (const entry of entries.values()) {
      entry.bone.quaternion.copy(entry.rest);
      entry.bone.position.copy(entry.position);
    }
    group.updateMatrixWorld(true);
    const wave = cycles * Math.PI * 2;
    const hips = entries.get('Hips');
    const location = hips.bone.getWorldPosition(new THREE.Vector3());
    location.y -= (giant ? 0.048 : 0.038) + 0.007 * (1 - Math.cos(wave * 2)) + runAmount * 0.035;
    // Give the longer walking stance knee clearance without changing the run pose.
    location.y -= (giant ? 0.1 : 0.055) * (1 - runAmount);
    location.y += runAmount * 0.045 * Math.max(0, -Math.cos(wave * 2));
    hips.bone.position.copy(hips.bone.parent.worldToLocal(location));
    worldOrientation(hips, [0.025 + runAmount * 0.13, 0, Math.sin(wave) * (giant ? 0.026 : 0.038)]);
    worldOrientation(entries.get('Spine'), [
      giant ? 0.035 : 0.1,
      Math.sin(wave) * 0.035,
      Math.sin(wave - 0.5) * 0.022,
    ]);
    worldOrientation(entries.get('Head'), [
      0.035 + Math.sin(wave - 0.8) * 0.025,
      Math.sin(wave * 0.5) * 0.045,
      Math.sin(wave - 0.7) * 0.025,
    ]);
    const jaw = entries.get('Jaw');
    jaw.bone.quaternion
      .copy(jaw.rest)
      .multiply(
        delta.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.055 + Math.sin(clock * 1.3) * 0.015),
      );
    for (const [i, side] of ['Left', 'Right'].entries()) {
      const arm = entries.get(side + 'Arm'),
        forearm = entries.get(side + 'ForeArm'),
        hand = entries.get(side + 'Hand');
      const sign = i === 0 ? 1 : -1;
      if (giant) {
        // Preserve the carrier's large hands, pole grip and the imp on its back.
        worldOrientation(arm, [
          Math.sin(wave + i * Math.PI) * (0.04 + runAmount * 0.32),
          0,
          Math.sin(wave) * 0.012,
        ]);
        worldOrientation(forearm, [-runAmount * 0.35, 0, 0]);
      } else {
        desired.set(
          sign * 0.065,
          -0.26 + Math.sin(wave + i * Math.PI) * 0.02,
          0.18 + Math.sin(wave - i) * 0.035,
        );
        desired
          .applyQuaternion(group.getWorldQuaternion(q))
          .add(arm.bone.getWorldPosition(new THREE.Vector3()));
        aim(arm, forearm.bone, desired);
        desired.set(sign * 0.035, -0.14, 0.21 + Math.sin(wave + i) * 0.02);
        desired
          .applyQuaternion(group.getWorldQuaternion(q))
          .add(forearm.bone.getWorldPosition(new THREE.Vector3()));
        aim(forearm, hand.bone, desired);
        worldOrientation(hand, [0.24 + Math.sin(wave - i) * 0.06, 0, 0]);
      }
    }
    if (flagBearer) poseFlag();
    group.updateMatrixWorld(true);
    for (const name of ['RightArm', 'RightForeArm', 'RightHand'])
      restingArm.set(name, entries.get(name).bone.quaternion.clone());
  }
  function poseFlag() {
    const arm = entries.get('RightArm'),
      lower = entries.get('RightForeArm'),
      hand = entries.get('RightHand');
    const shoulder = arm.bone.getWorldPosition(new THREE.Vector3());
    const [l1, l2] = armLengths.Right;
    // Extend horizontally from the actual shoulder; retain a tiny elbow bend.
    const goal = shoulder
      .clone()
      .addScaledVector(
        FORWARD.clone().applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion())),
        (l1 + l2) * 0.994,
      );
    const direction = goal.sub(shoulder);
    const distance = THREE.MathUtils.clamp(
      direction.length(),
      Math.abs(l1 - l2) + 0.002,
      l1 + l2 - 0.002,
    );
    direction.normalize();
    const pole = new THREE.Vector3(-1, -0.4, 0).applyQuaternion(
      group.getWorldQuaternion(new THREE.Quaternion()),
    );
    pole.addScaledVector(direction, -pole.dot(direction)).normalize();
    const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
    aim(
      arm,
      lower.bone,
      shoulder
        .clone()
        .addScaledVector(direction, along)
        .addScaledVector(pole, Math.sqrt(Math.max(0, l1 * l1 - along * along))),
    );
    aim(lower, hand.bone, shoulder.addScaledVector(direction, distance));
    const handOrientation = group
      .getWorldQuaternion(new THREE.Quaternion())
      .multiply(
        new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(FORWARD, UP, new THREE.Vector3(-1, 0, 0)),
        ),
      );
    hand.bone.quaternion.copy(
      hand.bone.parent
        .getWorldQuaternion(new THREE.Quaternion())
        .invert()
        .multiply(handOrientation),
    );
    hand.bone.updateWorldMatrix(false, true);
    // Local Y follows the upright shaft; the cloth trails behind the walker.
    const shaft = entries.get('RightHand_Prop_01');
    const orientation = group
      .getWorldQuaternion(new THREE.Quaternion())
      .multiply(
        new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(
            new THREE.Vector3(0, 0, -1),
            UP,
            new THREE.Vector3(1, 0, 0),
          ),
        ),
      );
    shaft.bone.quaternion.copy(
      shaft.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation),
    );
    shaft.bone.updateWorldMatrix(false, true);
    for (const [i, name] of [
      'RightHand_Prop_02',
      'RightHand_Prop_03',
      'RightHand_Prop_04',
    ].entries()) {
      const entry = entries.get(name);
      entry.bone.quaternion
        .copy(entry.rest)
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            Math.sin(flagClock * 2.2 - i * 0.7) * (0.08 + i * 0.04),
          ),
        );
    }
    for (const [name, entry] of entries) {
      const match = name.match(/^RightHand(Ring|Index)([0-3])$/);
      if (!match) continue;
      const joint = Number(match[2]);
      const angle = [0.08, 0.9, 0.9, 0.65][joint];
      entry.bone.quaternion
        .copy(entry.rest)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle));
    }
    // Oppose the thumb against the pole instead of curling it away from the fist.
    const thumb = entries.get('RightHandThumb1'),
      middle = entries.get('RightHandThumb2'),
      tip = entries.get('RightHandThumb3');
    group.updateMatrixWorld(true);
    const base = thumb.bone.getWorldPosition(new THREE.Vector3());
    const a = middle.bone.position.length() * scale,
      b = tip.bone.position.length() * scale;
    const target = hand.bone.localToWorld(new THREE.Vector3(0.12, 0.045, -0.055));
    const axis = target.clone().sub(base),
      d = THREE.MathUtils.clamp(axis.length(), Math.abs(a - b) + 0.001, a + b - 0.001);
    axis.normalize();
    const bendDirection = new THREE.Vector3(0, 1, 0.2).applyQuaternion(
      hand.bone.getWorldQuaternion(new THREE.Quaternion()),
    );
    bendDirection.addScaledVector(axis, -bendDirection.dot(axis)).normalize();
    const projection = (a * a - b * b + d * d) / (2 * d);
    aim(
      thumb,
      middle.bone,
      base
        .clone()
        .addScaledVector(axis, projection)
        .addScaledVector(bendDirection, Math.sqrt(Math.max(0, a * a - projection * projection))),
    );
    aim(middle, tip.bone, base.addScaledVector(axis, d));
    aim(
      tip,
      { position: new THREE.Vector3(1, 0, 0) },
      hand.bone.localToWorld(new THREE.Vector3(0.14, 0.02, -0.015)),
    );
  }
  function beginStep(leg, groundHeight, correction = false, movementHeading = group.rotation.y) {
    leg.swinging = true;
    leg.correction = correction;
    leg.progress = 0;
    leg.from.copy(leg.planted);
    leg.fromHeading = leg.heading;
    leg.toHeading = group.rotation.y;
    const local = leg.ankle.clone();
    // Land ahead of the hip by half the upcoming stance travel. Include the
    // body's travel during swing, so neither leg trails beyond its reach.
    const direction = movementHeading - group.rotation.y;
    local.x += (Math.sin(direction) * stride * (1 - duty / 2)) / scale;
    local.z += (Math.cos(direction) * stride * (1 - duty / 2)) / scale;
    leg.target.copy(group.localToWorld(local));
    leg.target.y = groundHeight(leg.target.x, leg.target.z) + leg.ankle.y * scale;
  }
  poseBody();
  for (const leg of legs) solveLeg(leg, leg.planted);
  synchronize();
  // The giant's palms have substantial volume. Match their upper surfaces to
  // the calf's underside, rather than burying the wrist joint in its body.
  const palmOffsets = [new THREE.Vector3(0.5, 0.06, 0.294), new THREE.Vector3(0.5, 0.06, -0.294)];
  const wrapPalm = new THREE.Vector3(0.2, 0.06, -0.294);
  const leftPatPalm = new THREE.Vector3(0.2, 0.06, 0.294);
  function patGoal(target) {
    const orientation = group
      .getWorldQuaternion(new THREE.Quaternion())
      .multiply(
        new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(-1, 0, 0),
            new THREE.Vector3(0, -1, 0),
          ),
        ),
      );
    return {
      orientation,
      wrist: target
        .clone()
        .sub(leftPatPalm.clone().multiplyScalar(scale).applyQuaternion(orientation)),
    };
  }
  // Use the real head skin's crown rather than an offset from the actor root.
  const head = entries.get('Head').bone;
  let crown = null;
  if (!giant) {
    source.traverse((mesh) => {
      if (!mesh.isSkinnedMesh) return;
      const indices = mesh.geometry.attributes.skinIndex,
        weights = mesh.geometry.attributes.skinWeight;
      mesh.skeleton.update();
      for (let i = 0; i < indices.count; i++) {
        let weight = 0;
        for (let j = 0; j < 4; j++)
          if (semantic(mesh.skeleton.bones[indices.getComponent(i, j)].name) === 'Head')
            weight += weights.getComponent(i, j);
        if (weight < 0.8) continue;
        const p = mesh.localToWorld(mesh.getVertexPosition(i, new THREE.Vector3()));
        if (!crown || p.y > crown.y) crown = p;
      }
    });
  }
  const crownLocal = head.worldToLocal(crown ?? head.getWorldPosition(new THREE.Vector3()));
  const palmQuaternion = (i, mode = 'two-hand') =>
    group
      .getWorldQuaternion(new THREE.Quaternion())
      .multiply(
        new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().makeBasis(
            mode === 'underarm' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, 1),
            mode === 'underarm'
              ? new THREE.Vector3(0, 0, 1)
              : new THREE.Vector3(i === 0 ? 1 : -1, 0, 0),
            mode === 'underarm'
              ? new THREE.Vector3(-1, 0, 0)
              : new THREE.Vector3(0, i === 0 ? 1 : -1, 0),
          ),
        ),
      );
  return {
    workGrip(side, target, dt, pitch = 0) {
      if (!(dt > 0) || giant) return;
      const arm = entries.get(side + 'Arm'),
        lower = entries.get(side + 'ForeArm'),
        hand = entries.get(side + 'Hand'),
        [l1, l2] = armLengths[side];
      const orientation = group
        .getWorldQuaternion(new THREE.Quaternion())
        .multiply(
          new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(FORWARD, UP, new THREE.Vector3(-1, 0, 0)),
          ),
        )
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch));
      const shoulder = arm.bone.getWorldPosition(new THREE.Vector3());
      const wrist = target
        .clone()
        .sub(new THREE.Vector3(0.12, 0, 0).multiplyScalar(scale).applyQuaternion(orientation));
      const direction = wrist.sub(shoulder),
        d = THREE.MathUtils.clamp(direction.length(), Math.abs(l1 - l2) + 0.002, l1 + l2 - 0.002);
      direction.normalize();
      const pole = new THREE.Vector3(side === 'Left' ? 1 : -1, -0.4, -0.2).applyQuaternion(
        group.getWorldQuaternion(new THREE.Quaternion()),
      );
      pole.addScaledVector(direction, -pole.dot(direction)).normalize();
      const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
      aim(
        arm,
        lower.bone,
        shoulder
          .clone()
          .addScaledVector(direction, along)
          .addScaledVector(pole, Math.sqrt(Math.max(0, l1 * l1 - along * along))),
      );
      aim(lower, hand.bone, shoulder.addScaledVector(direction, d));
      hand.bone.quaternion.copy(
        hand.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation),
      );
      for (const [name, entry] of entries) {
        if (!name.startsWith(side + 'Hand')) continue;
        const match = name.match(/(?:Ring|Index|Middle|Pinky|Thumb)([0-3])$/);
        if (!match) continue;
        entry.bone.quaternion.copy(entry.rest);
        entry.bone.rotateY(
          (side === 'Left' ? -1 : 1) *
            (name.includes('Thumb') ? 0.25 : [0.08, 0.9, 0.9, 0.65][Number(match[1])]),
        );
      }
      synchronize();
    },
    gripPoint(side) {
      return entries.get(side + 'Hand').bone.localToWorld(new THREE.Vector3(0.12, 0, 0));
    },
    flutter(dt) {
      if (!(dt > 0) || !flagBearer) return;
      flagClock += dt;
      poseFlag();
      synchronize();
    },
    watch(dt, { headYaw = 0, headPitch = 0, signal = 0, clock = 0 } = {}) {
      if (!(dt > 0) || giant) return;
      this.update(dt, dt * 0.08, () => group.position.y);
      const feet = legs.map((leg) => leg.foot.bone.getWorldPosition(new THREE.Vector3()));
      poseBody();
      worldOrientation(entries.get('Head'), [headPitch, headYaw, 0]);
      for (const [i, leg] of legs.entries()) solveLeg(leg, feet[i]);
      if (signal > 0) {
        const side = entries.get('LeftArm'),
          lower = entries.get('LeftForeArm');
        const neutral = [side.bone.quaternion.clone(), lower.bone.quaternion.clone()];
        const shoulder = side.bone.getWorldPosition(new THREE.Vector3());
        const elbow = shoulder
          .clone()
          .add(
            new THREE.Vector3(-0.28, 0.22, 0.12).applyQuaternion(
              group.getWorldQuaternion(new THREE.Quaternion()),
            ),
          );
        aim(side, lower.bone, elbow);
        const hand = elbow
          .clone()
          .add(
            new THREE.Vector3(0.08 * Math.sin(clock * 12), 0.32, 0.12).applyQuaternion(
              group.getWorldQuaternion(new THREE.Quaternion()),
            ),
          );
        aim(lower, entries.get('LeftHand').bone, hand);
        side.bone.quaternion.slerp(neutral[0], 1 - signal);
        lower.bone.quaternion.slerp(neutral[1], 1 - signal);
      }
      synchronize();
      const target = group.localToWorld(
        new THREE.Vector3(
          0.3 / scale,
          1.2 / scale,
          (0.42 + signal * 0.07 * Math.sin(clock * 12)) / scale,
        ),
      );
      this.reach(target, signal, dt);
    },
    ringBell(target, amount, dt, pull = 0, speech = 0) {
      if (!(dt > 0) || giant) return;
      this.watch(dt, { headPitch: -0.04 });
      worldOrientation(entries.get('Spine'), [0.08 + pull * 0.055, 0, 0]);
      this.reach(target, amount, dt);
      const jaw = entries.get('Jaw');
      jaw.bone.quaternion.copy(jaw.rest);
      jaw.bone.rotateZ(0.055 + speech * 0.2);
      for (const [name, entry] of entries) {
        const match = name.match(/^RightHand(Middle|Ring|Pinky|Index|Thumb)([0-3])$/);
        if (!match) continue;
        entry.bone.quaternion.copy(entry.rest);
        entry.bone.rotateZ(amount * (match[1] === 'Thumb' ? 0.18 : 0.5));
      }
      synchronize();
    },
    gazeDirection() {
      const q = entries.get('Head').bone.getWorldQuaternion(new THREE.Quaternion());
      q.multiply(entries.get('Head').orientation.clone().invert());
      return FORWARD.clone().applyQuaternion(q).normalize();
    },
    point(target, amount, dt) {
      if (!(dt > 0) || giant) return;
      this.watch(dt);
      const shoulder = entries.get('RightArm').bone.getWorldPosition(new THREE.Vector3());
      const direction = new THREE.Vector3(target.x, target.y ?? shoulder.y, target.z)
        .sub(shoulder)
        .normalize();
      const [a, b] = armLengths.Right;
      this.reach(shoulder.clone().addScaledVector(direction, (a + b) * 0.93), amount, dt);
      for (const [name, entry] of entries) {
        const match = name.match(/^RightHand(Middle|Ring|Pinky|Index|Thumb)([0-3])$/);
        if (!match) continue;
        entry.bone.quaternion.copy(entry.rest);
        if (match[1] !== 'Index') entry.bone.rotateZ(amount * (match[1] === 'Thumb' ? 0.15 : 0.65));
      }
      synchronize();
    },
    hold(targets, squat, dt, reach = 1, mode = 'two-hand', grip = reach, motion = null) {
      if (!(dt > 0)) return;
      const feet = legs.map((leg) => leg.foot.bone.getWorldPosition(new THREE.Vector3()));
      const preserveWalk = locomotionUpdated && squat < 1e-6;
      locomotionUpdated = false;
      const walkingLegs = preserveWalk
        ? [
            'Hips',
            ...legs.flatMap((leg) =>
              ['UpLeg', 'Leg', 'Foot', 'ToeBase'].map((part) => leg.side + part),
            ),
          ].map((name) => {
            const e = entries.get(name);
            return { e, position: e.bone.position.clone(), rotation: e.bone.quaternion.clone() };
          })
        : [];
      if (squat > 1e-6) {
        if (!holdFeet || !holdAt || holdAt.distanceTo(group.position) > 0.02) {
          holdFeet = feet.map((p, i) => p.clone().setY(group.position.y + legs[i].ankle.y * scale));
          holdAt = group.position.clone();
          for (let i = 0; i < legs.length; i++) {
            legs[i].planted.copy(holdFeet[i]);
            legs[i].target.copy(holdFeet[i]);
            legs[i].swinging = legs[i].pending = false;
            legs[i].heading = group.rotation.y;
          }
        }
      } else if (!preserveWalk) {
        holdFeet = null;
        holdAt = null;
      }
      const activeSide = motion?.side ?? 'Right',
        freeSide = activeSide === 'Right' ? 'Left' : 'Right';
      const freeNames = [freeSide + 'Arm', freeSide + 'ForeArm', freeSide + 'Hand'];
      const freeArm = freeNames.map((name) => entries.get(name).bone.quaternion.clone());
      poseBody();
      const hips = entries.get('Hips');
      const position = hips.bone.getWorldPosition(new THREE.Vector3());
      // The imported giant's knees sink below the floor if its hips descend
      // past its ankles. Limit the squat using actual support height/leg reach.
      const supportedFeet = holdFeet ?? feet;
      const clearance = position.y - Math.max(...supportedFeet.map((p) => p.y));
      const drop = Math.min(squat, Math.max(0, clearance * 0.48));
      position.y -= drop;
      hips.bone.position.copy(hips.bone.parent.worldToLocal(position));
      for (const { e, position, rotation } of walkingLegs) {
        e.bone.position.copy(position);
        e.bone.quaternion.copy(rotation);
      }
      worldOrientation(entries.get('Spine'), [
        motion?.lean ?? (mode === 'underarm' ? 0.08 + drop * 0.5 : 0.25 + squat * 1.5),
        0,
        motion?.sideLean ?? 0,
      ]);
      group.updateMatrixWorld(true);
      if (!preserveWalk) for (let i = 0; i < legs.length; i++) solveLeg(legs[i], supportedFeet[i]);
      for (const [i, side] of ['Left', 'Right'].entries()) {
        if (mode === 'underarm' && side !== activeSide) {
          for (const [j, name] of freeNames.entries())
            entries.get(name).bone.quaternion.copy(freeArm[j]);
          continue;
        }
        const arm = entries.get(side + 'Arm'),
          lower = entries.get(side + 'ForeArm'),
          hand = entries.get(side + 'Hand');
        const neutral = [arm, lower, hand].map((e) => e.bone.quaternion.clone());
        const shoulder = arm.bone.getWorldPosition(new THREE.Vector3());
        const [l1, l2] = armLengths[side];
        const handQ = motion?.palmDown
          ? group
              .getWorldQuaternion(new THREE.Quaternion())
              .multiply(
                new THREE.Quaternion().setFromRotationMatrix(
                  new THREE.Matrix4().makeBasis(
                    new THREE.Vector3(0, 0, 1),
                    new THREE.Vector3(side === 'Left' ? -1 : 1, 0, 0),
                    new THREE.Vector3(0, side === 'Left' ? -1 : 1, 0),
                  ),
                ),
              )
          : palmQuaternion(i, mode);
        if (motion?.palmPitch)
          handQ.premultiply(
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(1, 0, 0).applyQuaternion(
                group.getWorldQuaternion(new THREE.Quaternion()),
              ),
              motion.palmPitch,
            ),
          );
        if (mode === 'underarm' && !motion?.palmDown)
          handQ.copy(hand.bone.getWorldQuaternion(new THREE.Quaternion()).slerp(handQ, grip));
        const wrist = targets[mode === 'underarm' ? 0 : i]
          .clone()
          .sub(
            (mode === 'underarm'
              ? activeSide === 'Left'
                ? leftPatPalm
                : wrapPalm
              : palmOffsets[i]
            )
              .clone()
              .multiplyScalar(scale)
              .applyQuaternion(handQ),
          );
        const direction = wrist.sub(shoulder);
        const d = THREE.MathUtils.clamp(
          direction.length(),
          Math.abs(l1 - l2) + 0.002,
          l1 + l2 - 0.002,
        );
        direction.normalize();
        const pole = (
          mode === 'underarm'
            ? new THREE.Vector3(-0.05, 1, -0.1)
            : new THREE.Vector3(i === 0 ? 1 : -1, -0.4, -0.3)
        ).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
        pole.addScaledVector(direction, -pole.dot(direction)).normalize();
        const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
        const elbow = shoulder
          .clone()
          .addScaledVector(direction, along)
          .addScaledVector(pole, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
        aim(arm, lower.bone, elbow);
        aim(lower, hand.bone, shoulder.addScaledVector(direction, d));
        hand.bone.quaternion.copy(
          hand.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handQ),
        );
        for (const [j, e] of [arm, lower, hand].entries())
          e.bone.quaternion.slerp(neutral[j], 1 - reach);
      }
      if (mode === 'underarm') {
        const curlAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(
          group.getWorldQuaternion(new THREE.Quaternion()),
        );
        for (const [name, entry] of entries) {
          const match = name.match(/^RightHand(Middle|Ring|Pinky|Index|Thumb)([0-3])$/);
          if (!match) continue;
          const joint = Number(match[2]);
          const angle =
            (match[1] === 'Thumb' ? [0, 0.12, 0.18, 0.12] : [0.06, 0.28, 0.32, 0.18])[joint] * grip;
          const axis = curlAxis
            .clone()
            .applyQuaternion(entry.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
          entry.bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
          entry.bone.updateWorldMatrix(false, true);
        }
      }
      synchronize();
    },
    hands: (mode = 'two-hand') =>
      (mode === 'underarm' ? ['Right'] : ['Left', 'Right']).map((side) =>
        entries
          .get(side + 'Hand')
          .bone.localToWorld(
            (mode === 'underarm' ? wrapPalm : palmOffsets[side === 'Right' ? 1 : 0]).clone(),
          ),
      ),
    reach(target, amount, dt) {
      if (!(dt > 0) || giant) return;
      const arm = entries.get('RightArm'),
        lower = entries.get('RightForeArm'),
        hand = entries.get('RightHand');
      for (const name of restingArm.keys())
        entries.get(name).bone.quaternion.copy(restingArm.get(name));
      group.updateMatrixWorld(true);
      if (amount > 0) {
        const shoulder = arm.bone.getWorldPosition(new THREE.Vector3());
        const elbow = lower.bone.getWorldPosition(new THREE.Vector3());
        const neutral = hand.bone.getWorldPosition(new THREE.Vector3());
        const l1 = shoulder.distanceTo(elbow),
          l2 = elbow.distanceTo(neutral);
        const goal = neutral.lerp(target, THREE.MathUtils.clamp(amount, 0, 1));
        const direction = goal.clone().sub(shoulder);
        const distance = THREE.MathUtils.clamp(
          direction.length(),
          Math.abs(l1 - l2) + 0.002,
          l1 + l2 - 0.002,
        );
        direction.normalize();
        const pole = new THREE.Vector3(-1, -0.3, 0).applyQuaternion(
          group.getWorldQuaternion(new THREE.Quaternion()),
        );
        pole.addScaledVector(direction, -pole.dot(direction)).normalize();
        const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
        const bend = shoulder
          .clone()
          .addScaledVector(direction, along)
          .addScaledVector(pole, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
        aim(arm, lower.bone, bend);
        aim(lower, hand.bone, shoulder.addScaledVector(direction, distance));
        worldOrientation(hand, [0.08, 0, 0]);
      }
      synchronize();
    },
    handPoint: () => entries.get('RightHand').bone.getWorldPosition(new THREE.Vector3()),
    headPoint: () => entries.get('Head').bone.getWorldPosition(new THREE.Vector3()),
    headTopPoint: () => head.localToWorld(crownLocal.clone()),
    patPalmPoint: () => entries.get('LeftHand').bone.localToWorld(leftPatPalm.clone()),
    canPatHead(target) {
      const shoulder = entries.get('LeftArm').bone.getWorldPosition(new THREE.Vector3());
      return (
        shoulder.distanceTo(patGoal(target).wrist) < armLengths.Left[0] + armLengths.Left[1] - 0.05
      );
    },
    patHead(target, reach, dt, speech = 0) {
      if (!(dt > 0) || !giant) return;
      // Overlay only the left arm on this frame's walk. Keep pelvis and planted-foot IK intact.
      const arm = entries.get('LeftArm'),
        lower = entries.get('LeftForeArm'),
        hand = entries.get('LeftHand');
      const neutral = [arm, lower, hand].map((entry) => entry.bone.quaternion.clone());
      const shoulder = arm.bone.getWorldPosition(new THREE.Vector3());
      const { wrist, orientation } = patGoal(target);
      const [l1, l2] = armLengths.Left;
      const direction = wrist.sub(shoulder);
      const distance = THREE.MathUtils.clamp(
        direction.length(),
        Math.abs(l1 - l2) + 0.002,
        l1 + l2 - 0.002,
      );
      direction.normalize();
      const pole = new THREE.Vector3(-0.05, 1, -0.1).applyQuaternion(
        group.getWorldQuaternion(new THREE.Quaternion()),
      );
      pole.addScaledVector(direction, -pole.dot(direction)).normalize();
      const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
      const elbow = shoulder
        .clone()
        .addScaledVector(direction, along)
        .addScaledVector(pole, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
      aim(arm, lower.bone, elbow);
      aim(lower, hand.bone, shoulder.addScaledVector(direction, distance));
      hand.bone.quaternion.copy(
        hand.bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation),
      );
      for (const [index, entry] of [arm, lower, hand].entries())
        entry.bone.quaternion.slerp(neutral[index], 1 - reach);
      this.speak(speech, dt);
    },
    acknowledgePat(amount, dt) {
      if (!(dt > 0) || giant) return;
      this.watch(dt, { headPitch: amount * 0.38 });
      const feet = legs.map((leg) => leg.foot.bone.getWorldPosition(new THREE.Vector3()));
      const hips = entries.get('Hips');
      const position = hips.bone.getWorldPosition(new THREE.Vector3());
      position.y -= amount * 0.1;
      hips.bone.position.copy(hips.bone.parent.worldToLocal(position));
      group.updateMatrixWorld(true);
      for (const [i, leg] of legs.entries()) solveLeg(leg, feet[i]);
      synchronize();
    },
    speak(amount, dt) {
      if (!(dt > 0)) return;
      const jaw = entries.get('Jaw');
      jaw.bone.quaternion.copy(jaw.rest);
      jaw.bone.rotateZ(0.055 + amount * 0.2);
      synchronize();
    },
    stumble(dt, amount) {
      if (!(dt > 0)) return;
      this.stopRunning();
      poseBody();
      const hips = entries.get('Hips');
      const p = hips.bone.getWorldPosition(new THREE.Vector3());
      p.y -= amount * 0.32;
      hips.bone.position.copy(hips.bone.parent.worldToLocal(p));
      worldOrientation(entries.get('Spine'), [-amount * 0.45, 0, 0]);
      group.updateMatrixWorld(true);
      for (const leg of legs) solveLeg(leg, leg.planted);
      synchronize();
    },
    stopRunning() {
      if (!runAmount) return;
      runAmount = 0;
      stride = walkStride;
      duty = 0.64;
      for (const leg of legs) {
        leg.swinging = leg.pending = false;
        leg.planted.copy(leg.foot.bone.getWorldPosition(new THREE.Vector3()));
      }
      poseBody();
      for (const leg of legs) solveLeg(leg, leg.planted);
      synchronize();
    },
    update(dt, distance, groundHeight, movementHeading = group.rotation.y, run = 0) {
      if (!(dt > 0) || !(distance > 0)) return;
      locomotionUpdated = true;
      holdFeet = null;
      holdAt = null;
      clock += dt;
      runAmount = THREE.MathUtils.clamp(run, 0, 1);
      const fastWalkStride = giant
        ? THREE.MathUtils.lerp(
            walkStride,
            0.7,
            THREE.MathUtils.smoothstep(distance / dt, 0.65, 1.9),
          )
        : walkStride;
      stride = THREE.MathUtils.lerp(fastWalkStride, giant ? 0.98 : 0.82, runAmount);
      duty = runAmount > 0.5 ? 0.42 : 0.64;
      const previous = cycles;
      cycles += distance / stride;
      poseBody();
      for (const leg of legs) {
        const phase = (cycles + leg.phaseOffset) % 1,
          oldPhase = (previous + leg.phaseOffset) % 1;
        if (
          !leg.swinging &&
          ((oldPhase < duty && phase >= duty) || (phase < oldPhase && phase >= duty))
        )
          leg.pending = true;
      }
      // Turning also needs a step; never rotate a planted shoe with the torso.
      if (runAmount > 0.5) {
        for (const leg of legs) {
          const phase = (cycles + leg.phaseOffset) % 1;
          if (!leg.swinging && phase >= duty) {
            leg.pending = false;
            beginStep(leg, groundHeight, false, movementHeading);
          }
        }
      } else if (!legs.some((leg) => leg.swinging)) {
        const angle = (leg) =>
          Math.abs(
            Math.atan2(
              Math.sin(group.rotation.y - leg.heading),
              Math.cos(group.rotation.y - leg.heading),
            ),
          );
        const pending = legs.find((leg) => leg.pending);
        const leg = pending ?? [...legs].sort((a, b) => angle(b) - angle(a))[0];
        const turn = Math.atan2(
          Math.sin(group.rotation.y - leg.heading),
          Math.cos(group.rotation.y - leg.heading),
        );
        if (pending || Math.abs(turn) > 0.32) {
          leg.pending = false;
          beginStep(leg, groundHeight, !pending, movementHeading);
        }
      }
      for (const leg of legs) {
        const target = leg.planted.clone();
        if (leg.swinging) {
          leg.progress = Math.min(
            1,
            leg.progress +
              dt /
                (leg.correction
                  ? 0.45 * walkStepScale
                  : ((1 - duty) * stride) / Math.max(speed, distance / dt)),
          );
          const t = leg.progress,
            blend = smooth(t);
          target.copy(leg.from).lerp(leg.target, blend);
          target.y +=
            64 *
            t ** 3 *
            (1 - t) ** 3 *
            (runAmount > 0.5 ? 0.16 : giant ? 0.055 : leg.side === 'Left' ? 0.058 : 0.028);
          const turn = Math.atan2(
            Math.sin(leg.toHeading - leg.fromHeading),
            Math.cos(leg.toHeading - leg.fromHeading),
          );
          leg.heading = leg.fromHeading + turn * blend;
          if (t === 1) {
            leg.planted.copy(leg.target);
            leg.swinging = false;
            leg.correction = false;
          }
        }
        solveLeg(leg, target);
      }
      synchronize();
    },
    snapshot: () => ({
      cycles,
      clock,
      giant,
      run: runAmount,
      stride,
      duty,
      copies: copies.get('Hips').length,
      joints: Object.fromEntries(
        [
          'Hips',
          'Spine',
          'Head',
          'LeftArm',
          'RightArm',
          'LeftUpLeg',
          'RightUpLeg',
          'LeftLeg',
          'RightLeg',
          'LeftFoot',
          'RightFoot',
        ].map((name) => [name, entries.get(name).bone.quaternion.toArray()]),
      ),
      legs: legs.map((leg) => ({
        side: leg.side,
        swinging: leg.swinging,
        progress: leg.progress,
        heading: leg.heading,
        planted: leg.planted.toArray(),
        foot: leg.foot.bone.getWorldPosition(new THREE.Vector3()).toArray(),
        target: leg.target.toArray(),
      })),
    }),
  };
}
