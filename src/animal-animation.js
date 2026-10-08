import { reactionAmount } from './animal-drive.js';
import { createAnimalSleepPose } from './animal-sleep-pose.js';
import { createAnimalTreePose } from './animal-tree-pose.js';
import * as THREE from 'three';
import { landscapeHeight } from './world-queries.js';
const swinging = (leg) => (leg.runStance === undefined ? !!leg.start : !leg.runStance);
const up = new THREE.Vector3(0, 1, 0),
  axisX = new THREE.Vector3(1, 0, 0);
const ease = (t) => t * t * (3 - 2 * t);
const smoothStep = (t) => t * t * t * (10 + t * (-15 + 6 * t));

// Analytic two-bone IK; the bending hint chooses the knee side without stretching.
export function solveCowLeg(hip, foot, l1, l2, bendHint) {
  const direction = foot.clone().sub(hip),
    distance = THREE.MathUtils.clamp(
      direction.length(),
      Math.abs(l1 - l2) + 0.00001,
      l1 + l2 - 0.00001,
    );
  direction.normalize();
  const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
  const bend = bendHint.clone().addScaledVector(direction, -bendHint.dot(direction)).normalize();
  return hip
    .clone()
    .addScaledVector(direction, along)
    .addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
}

// A brief wind-up, fast sweep, smaller counter-sweep and damped recovery.
// Distal joints follow later, letting the switch lag and overtake the tail base.
export function cowTailSwish(time) {
  const keys = [
    [0, 0],
    [0.1, -0.12],
    [0.26, 0.85],
    [0.46, -0.48],
    [0.72, 0.15],
    [1.08, 0],
  ];
  if (time <= 0 || time >= 1.08) return 0;
  for (let i = 1; i < keys.length; i++)
    if (time <= keys[i][0]) {
      const [t0, v0] = keys[i - 1],
        [t1, v1] = keys[i];
      return v0 + (v1 - v0) * ease((time - t0) / (t1 - t0));
    }
  return 0;
}

// Transverse gallop: left hind, right hind, left fore, leading right fore,
// then one gathered flight. Timing is deliberately asymmetric, unlike the walk.
export function bullGallopPhase(cycle, name) {
  const touchdown = { HL: 0, HR: 0.12, FL: 0.4, FR: 0.52 }[name],
    duty = name === 'FR' ? 0.32 : 0.28;
  const phase = (((cycle - touchdown) % 1) + 1) % 1;
  return { phase, duty, stance: phase < duty };
}

export function createAnimalAnimation(root, group, profile = {}) {
  const carnivore = ['wolf', 'leopard', 'dog'].includes(profile.species);
  const stride = profile.stride ?? 0.4,
    stepHeight = profile.stepHeight ?? 0.15,
    walkDuty = profile.walkDuty ?? 0.78,
    walkFrequency = profile.walkFrequency ?? 3.3;
  const find = (name) => {
      const mapped = profile.bones?.[name] ?? name;
      return root.getObjectByName(mapped) ?? root.getObjectByName(mapped.replaceAll('.', ''));
    },
    head = find('Head'),
    jaw = find('Jaw');
  if (!head?.isBone || !find('FL_Upper')?.isBone) return null;
  group.updateMatrixWorld(true);
  const muzzle = root.getObjectByName('Continuous_ivory_muzzle');
  // The local forward extent is measured in the bind pose, independent of layout yaw.
  const localBox = new THREE.Box3();
  if (muzzle)
    muzzle.traverse((n) => {
      if (n.isMesh) {
        const pos = n.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++)
          localBox.expandByPoint(
            group.worldToLocal(n.localToWorld(new THREE.Vector3().fromBufferAttribute(pos, i))),
          );
      }
    });
  const contactLocal = localBox.isEmpty()
    ? new THREE.Vector3(...(profile.contactLocal ?? [0, 0.9, 1.8]))
    : localBox.getCenter(new THREE.Vector3());
  if (!localBox.isEmpty()) contactLocal.z = localBox.max.z;
  const contactReach = contactLocal.z * group.scale.x;
  const headContact = head.worldToLocal(group.localToWorld(contactLocal.clone()));
  // Measure the real horn tips in the head's bind space, so collision follows the skin.
  const hornTips = [];
  root.traverse((n) => {
    if (!n.isMesh || !/Swept_up_gray_horn/.test(n.name)) return;
    const pos = n.geometry.attributes.position;
    let tip = null;
    for (let i = 0; i < pos.count; i++) {
      const v = n.localToWorld(new THREE.Vector3().fromBufferAttribute(pos, i));
      if (!tip || v.y > tip.y) tip = v;
    }
    if (tip) hornTips.push(head.worldToLocal(tip));
  });
  const restQ = new Map();
  root.traverse((n) => {
    if (n.isBone) restQ.set(n, n.quaternion.clone().normalize());
  });
  const legs = [
    ['HL', 0],
    ['FL', 0.75],
    ['HR', 0.5],
    ['FR', 0.25],
  ].map(([name, offset]) => {
    const upper = find(name + '_Upper'),
      lower = find(name + '_Lower'),
      hoof = find(name + '_Hoof'),
      hock = find(name + '_Hock'),
      toes = find(name + '_Toes');
    const local = (n) => group.worldToLocal(n.getWorldPosition(new THREE.Vector3()));
    const hip = local(upper),
      knee = local(lower),
      foot = local(hoof);
    return {
      name,
      offset,
      upper,
      lower,
      hoof,
      hock,
      toes,
      restFoot: foot,
      walkCenter: new THREE.Vector3(foot.x, foot.y, hip.z - (hock ? local(hock).z - foot.z : 0)),
      l1: hip.distanceTo(knee),
      l2: knee.distanceTo(hock ? local(hock) : foot),
      distalOffset: hock
        ? local(hock)
            .sub(foot)
            .applyQuaternion(
              group
                .getWorldQuaternion(new THREE.Quaternion())
                .invert()
                .multiply(hoof.getWorldQuaternion(new THREE.Quaternion()))
                .invert(),
            )
        : new THREE.Vector3(),
      anchor: hoof.getWorldPosition(new THREE.Vector3()),
      anchorQ: hoof.getWorldQuaternion(new THREE.Quaternion()),
      start: null,
      goal: null,
      swingTime: 0,
      swingDuration: 0.25,
      stanceTime: Infinity,
      liftScale: 1,
      steps: 0,
      lastPhase: offset,
      hoofQ: group
        .getWorldQuaternion(new THREE.Quaternion())
        .invert()
        .multiply(hoof.getWorldQuaternion(new THREE.Quaternion())),
    };
  });
  const blinkMeshes = [];
  root.traverse((n) => {
    if (n.morphTargetDictionary?.Blink !== undefined) blinkMeshes.push(n);
  });
  const restGroupQ = new Map();
  root.traverse((n) => {
    if (n.isBone)
      restGroupQ.set(
        n,
        group
          .getWorldQuaternion(new THREE.Quaternion())
          .invert()
          .multiply(n.getWorldQuaternion(new THREE.Quaternion())),
      );
  });
  const body = find('Body'),
    bodyRest = body.position.clone();
  let lastHeading = group.rotation.y,
    gait = 'walk',
    runAmount = 0,
    bodyRun = 0,
    walkRecovery = 0,
    walkJointRate = profile.walkJointRate ?? 8;
  const lastPosition = group.position.clone();
  let cycle = 0,
    blinkClock = 0,
    nextBlink = 2 + Math.random() * 3,
    blink = 0,
    lastDistance = 0,
    activity = 0;
  // Swing from the bind direction, rather than aiming local +Y at nearly -Y.
  // The latter has an ambiguous 180-degree axis and flips the skin's roll at turns.
  const previousAim = new Map();
  const aim = (bone, target, dt) => {
    const reference = group
      .getWorldQuaternion(new THREE.Quaternion())
      .multiply(restGroupQ.get(bone));
    const direction = target.clone().sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
    const swing = new THREE.Quaternion().setFromUnitVectors(
      up.clone().applyQuaternion(reference),
      direction,
    );
    const desired = swing.multiply(reference).normalize();
    const previous = previousAim.get(bone);
    if (previous) {
      const angle = previous.angleTo(desired);
      const limit = dt * (gait === 'gallop' || walkRecovery > 0 ? 36 : walkJointRate);
      if (angle > limit) desired.slerp(previous, 1 - limit / angle);
    }
    previousAim.set(bone, desired.clone());
    bone.quaternion.copy(
      bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired).normalize(),
    );
    bone.updateWorldMatrix(false, true);
  };
  const sleepPose = createAnimalSleepPose({
    root,
    group,
    profile,
    body,
    bodyRest,
    head,
    restQ,
    legs,
    blinkMeshes,
    solveLeg: solveCowLeg,
    aim,
  });
  const treePose =
    profile.species === 'leopard'
      ? createAnimalTreePose({
          root,
          group,
          body,
          bodyRest,
          restQ,
          legs,
          blinkMeshes,
          solveLeg: solveCowLeg,
          sleepPose,
        })
      : null;
  let treeActive = false;
  let sleeping = false;
  return {
    hornPoints: () => hornTips.map((p) => head.localToWorld(p.clone())),
    contactReach,
    contactPoint: () => head.localToWorld(headContact.clone()),
    update(dt, animal, chew, envelope) {
      if (dt <= 0) return;
      if (treePose && animal.treeClimb) {
        treeActive = true;
        activity = runAmount = bodyRun = 0;
        gait = 'climb';
        lastDistance = animal.distance;
        lastHeading = animal.heading;
        lastPosition.copy(group.position);
        blink = treePose.update(dt, animal);
        return;
      }
      if (treeActive) {
        treeActive = false;
        treePose.reset();
        previousAim.clear();
        gait = 'walk';
        lastPosition.copy(group.position);
        lastDistance = animal.distance;
        for (const leg of legs) leg.lastPhase = (cycle + leg.offset) % 1;
      }
      if (sleepPose && animal.sleepAmount > 0) {
        sleeping = true;
        activity = runAmount = bodyRun = 0;
        gait = 'walk';
        lastDistance = animal.distance;
        lastHeading = group.rotation.y;
        lastPosition.copy(group.position);
        blink = sleepPose.update(dt, animal);
        return;
      }
      if (sleeping) {
        sleeping = false;
        sleepPose.reset();
        previousAim.clear();
        for (const leg of legs) leg.lastPhase = (cycle + leg.offset) % 1;
      }
      const supportHeight = animal.supportHeight ?? landscapeHeight;
      const howl = animal.howlPose ?? 0;
      const traveled = Math.max(0, animal.distance - lastDistance);
      const locomotionSpeed = Number.isFinite(animal.velocity)
        ? Math.max(0, animal.velocity)
        : traveled / dt;
      const heading = group.rotation.y,
        headingDelta = Math.atan2(Math.sin(heading - lastHeading), Math.cos(heading - lastHeading)),
        turn = Math.abs(headingDelta);
      lastHeading = heading;
      const tightTurn = turn / dt > (profile.walkTightTurnRate ?? 0.6);
      const charge = animal.chargePose ?? 0,
        run = animal.chargeRun ?? 0;
      const nextGait = run > 0.2 && locomotionSpeed > 0.5 ? 'gallop' : 'walk';
      // Gather airborne feet before the first gallop touchdown. A walk's
      // planted anchors cannot safely start halfway through a running stance.
      if (gait === 'walk' && nextGait === 'gallop') cycle = Math.ceil(cycle) + 0.84;
      walkRecovery =
        gait === 'gallop' && nextGait === 'walk' ? 0.25 : Math.max(0, walkRecovery - dt);
      gait = nextGait;
      walkJointRate = THREE.MathUtils.damp(
        walkJointRate,
        (profile.walkJointRate ?? 8) +
          Math.max(
            12 * THREE.MathUtils.clamp((locomotionSpeed - 0.4) / 0.5, 0, 1),
            Math.max(0, 20 - (profile.walkJointRate ?? 8)) *
              THREE.MathUtils.clamp(turn / dt / 0.9, 0, 1),
          ),
        12,
        dt,
      );
      runAmount = run;
      bodyRun = carnivore ? THREE.MathUtils.damp(bodyRun, run, 12, dt) : run;
      // At quick-walk speeds, lengthen the cycle's travel rather than letting
      // a fixed minimum swing overlap the next beat on the same side.
      const walkStride =
        gait === 'walk'
          ? Math.max(stride, locomotionSpeed / (walkFrequency * animal.scale))
          : stride;
      const gaitStride = walkStride + run * ((profile.runStride ?? stride * 2.7) - walkStride),
        gaitHeight = stepHeight * (1 + run * 0.35);
      lastDistance = animal.distance;
      const walkVelocity = group.position.clone().sub(lastPosition).divideScalar(dt);
      walkVelocity.y = 0;
      lastPosition.copy(group.position);
      const advance = Math.max(
        traveled / (gaitStride * animal.scale),
        turn / (profile.turnStride ?? 0.85),
      );
      cycle += advance;
      activity +=
        ((traveled / dt > 0.012 || turn / dt > 0.025 ? 1 : 0) - activity) * (1 - Math.exp(-dt * 7));
      for (const [bone, q] of restQ) bone.quaternion.copy(q);
      const gallopCycle = cycle % 1,
        flight =
          gait === 'gallop' && gallopCycle > 0.84
            ? Math.sin((Math.PI * (gallopCycle - 0.84)) / 0.16)
            : 0;
      const pitch =
        0.006 * activity * Math.sin(cycle * Math.PI * 4) +
        run * 0.055 * Math.sin(cycle * Math.PI * 2);
      body.position.copy(bodyRest);
      body.position.y +=
        (bodyRun *
          (-(profile.runDrop ?? 0.08) +
            (profile.runBob ?? 0.025) * (0.5 + 0.5 * Math.sin(cycle * Math.PI * 2)) +
            (profile.runFlightHeight ?? 0.06) * flight)) /
        animal.scale;
      // Leave a small, species-configured reach reserve while changing feet.
      if (carnivore || gait === 'walk')
        body.position.y -=
          ((profile.walkCrouch ?? (carnivore ? 0.018 : 0.012)) * activity * (1 - bodyRun)) /
          animal.scale;
      body.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axisX, pitch));
      if (profile.species === 'leopard') {
        const flex = run * Math.sin(cycle * Math.PI * 2) * 0.11;
        for (const [i, name] of ['Pelvis', 'Spine_Lower', 'Spine_Upper', 'Chest'].entries()) {
          const bone = find(name);
          bone?.quaternion.multiply(
            new THREE.Quaternion().setFromAxisAngle(axisX, flex * [0.5, -1, -0.6, 0.4][i]),
          );
        }
      }
      const reaction = reactionAmount(animal.behavior),
        down = animal.behavior?.down || 0,
        raised = Math.max(animal.behavior?.raised || 0, reaction * 0.65);
      const neck = find('Neck');
      if (neck)
        neck.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(
            axisX,
            down * (profile.neckDown ?? 0.82) -
              raised * 0.12 +
              charge * 0.48 -
              run * pitch * 0.7 -
              howl * 0.48,
          ),
        );
      if (!carnivore && down > 0.5)
        chew = Math.max(chew, down * (0.45 + 0.45 * Math.sin(animal.clock * 5.8)));
      head.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(
          axisX,
          down * (profile.headDown ?? 0.38) -
            raised * 0.18 +
            charge * 0.38 -
            howl * 0.52 +
            0.025 * Math.sin(animal.clock * 0.85) +
            0.045 * envelope,
        ),
      );
      head.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          animal.look * envelope * 0.7 + reaction * 0.1 * (animal.behavior?.swishSide || 1),
        ),
      );
      if (animal.familyLook !== undefined) {
        group.updateMatrixWorld(true);
        const axis = up
          .clone()
          .applyQuaternion(head.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
        head.quaternion.premultiply(
          new THREE.Quaternion().setFromAxisAngle(
            axis,
            Math.max(-0.3, Math.min(0.3, animal.familyLook)),
          ),
        );
      }
      jaw?.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(
          axisX,
          (carnivore ? 0.09 : 0.13) * chew +
            (animal.bitePose ?? 0) * 0.25 +
            howl * 0.22 +
            (animal.vocalPose ?? 0) * 0.22,
        ),
      );
      jaw?.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          (carnivore ? 0.008 : 0.025) * chew * Math.sin(animal.clock * 5),
        ),
      );
      const time = animal.behavior?.swishTime ?? 2,
        side = animal.behavior?.swishSide ?? 1,
        strength = animal.behavior?.swishStrength ?? 1;
      for (const [name, delay, gain] of profile.tailBones ?? [
        ['Tail', 0, 0.78],
        ['Tail_Mid', 0.065, 0.56],
        ['Tail_Tip', 0.13, 0.68],
      ]) {
        const bone = find(name);
        if (!bone) continue;
        const swish = cowTailSwish(time - delay) * side * strength * gain * (profile.tailGain ?? 1);
        const drift = 0.025 * Math.sin(animal.clock * 1.1 - delay * 3);
        bone.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), swish + drift),
        );
        // Lift out behind the rump before the lateral sweep; don't fold towards the legs.
        const lift =
          (profile.tailLift ?? 0.3) *
          Math.sin(Math.PI * THREE.MathUtils.clamp((time - delay) / 1.08, 0, 1)) ** 2;
        bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axisX, lift));
      }
      for (const side of ['L', 'R'])
        find('Ear_' + side)?.quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(
            axisX,
            0.035 * Math.sin(animal.clock * 1.3) +
              (animal.gestureType === 2 ? 0.13 * envelope : 0) -
              reaction * (carnivore ? 0.22 : 0.16) -
              charge * 0.22,
          ),
        );
      group.updateMatrixWorld(true);
      // Correct the most stretched support leg first without starving another leg.
      const reachRatio = (leg) => {
        const ankle = leg.anchor
          .clone()
          .add(leg.distalOffset.clone().multiplyScalar(animal.scale).applyQuaternion(leg.anchorQ));
        return (
          leg.upper.getWorldPosition(new THREE.Vector3()).distanceTo(ankle) /
          ((leg.l1 + leg.l2) * animal.scale)
        );
      };
      const solveOrder =
        gait === 'walk' ? [...legs].sort((a, b) => reachRatio(b) - reachRatio(a)) : legs;
      for (const leg of solveOrder) {
        const hip = leg.upper.getWorldPosition(new THREE.Vector3());
        const desiredQ = group
          .getWorldQuaternion(new THREE.Quaternion())
          .multiply(leg.hoofQ)
          .normalize();
        if (animal.supportNormal) {
          const normal = animal.supportNormal(leg.anchor.x, leg.anchor.z);
          const bodyUp = up
            .clone()
            .applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
          desiredQ.premultiply(new THREE.Quaternion().setFromUnitVectors(bodyUp, normal));
        }
        let target,
          swing = 0;
        if (gait === 'gallop') {
          const timing = bullGallopPhase(cycle, leg.name),
            lead = (profile.runLead ?? 0.24) / animal.scale;
          if (leg.runStance === undefined) {
            leg.anchor.copy(leg.lastFoot ?? leg.hoof.getWorldPosition(new THREE.Vector3()));
            leg.runStart = group.worldToLocal(leg.anchor.clone());
            leg.start = null;
          }
          if (timing.stance) {
            if (leg.runStance === false) {
              if (leg.lastFoot) leg.anchor.copy(leg.lastFoot);
              leg.anchor.y =
                supportHeight(leg.anchor.x, leg.anchor.z) + 0.025 + leg.restFoot.y * animal.scale;
              leg.anchorQ.copy(desiredQ);
              leg.steps++;
            }
            target = leg.anchor.clone();
          } else {
            if (leg.runStance !== false) leg.runStart = group.worldToLocal(leg.anchor.clone());
            const t = (timing.phase - timing.duty) / (1 - timing.duty);
            swing = Math.sin(Math.PI * t);
            const local = leg.runStart
              .clone()
              .lerp(leg.restFoot.clone().add(new THREE.Vector3(0, 0, lead)), ease(t));
            target = group.localToWorld(local);
            target.y =
              supportHeight(target.x, target.z) +
              0.025 +
              leg.restFoot.y * animal.scale +
              (profile.runLift ?? 0.13) * Math.sin(Math.PI * t) +
              flight * 0.045;
            leg.anchor.copy(target);
            leg.anchorQ.slerp(desiredQ, 1 - Math.exp(-dt * 18));
          }
          leg.runStance = timing.stance;
          leg.lastPhase = timing.phase;
        } else {
          if (leg.runStance !== undefined) {
            delete leg.runStance;
            leg.start = null;
            leg.lastPhase = (cycle + leg.offset) % 1;
          }
          const phase = (cycle + leg.offset) % 1;
          const paw = leg.name === 'FL' ? (animal.chargePaw ?? 0) : 0;
          const neutral = group.localToWorld(
            leg.restFoot.clone().add(new THREE.Vector3(0, paw * 0.14, -paw * 0.18)),
          );
          neutral.y =
            supportHeight(neutral.x, neutral.z) +
            0.025 +
            (leg.restFoot.y + paw * 0.14) * animal.scale;

          const liftoff = walkDuty;
          const phaseCrossed =
            phase >= liftoff &&
            (leg.lastPhase < liftoff || leg.lastPhase > phase) &&
            cycle - (leg.stepCycle ?? -1) > 0.65;

          const ankle = leg.anchor
            .clone()
            .add(
              leg.distalOffset.clone().multiplyScalar(animal.scale).applyQuaternion(leg.anchorQ),
            );
          // A gentle heading change must not suddenly remove 6% of a leg's
          // usable reach. Use the same reach boundary at every frame rate.
          const reach = hip.distanceTo(ankle) / ((leg.l1 + leg.l2) * animal.scale);
          const overextended = reach > (tightTurn ? 0.94 : 0.995);
          const twisted = leg.anchorQ.angleTo(desiredQ) > (profile.maxFootTurn ?? 0.32);
          const supportCenter =
            traveled / dt > 0.012 ? group.localToWorld(leg.walkCenter.clone()) : neutral;
          supportCenter.y = neutral.y;
          const far = leg.anchor.distanceTo(supportCenter) > gaitStride * animal.scale * 0.85;
          if (!leg.start) leg.stanceTime += dt;
          const period = 1 / Math.max(0.1, advance / dt);
          const settled =
            leg.stanceTime >= THREE.MathUtils.clamp(period * (tightTurn ? 0.12 : 0.18), 0.06, 0.22);
          const correctiveReady =
            settled && (cycle - (leg.stepCycle ?? -1) > 0.55 || reach > (tightTurn ? 1 : 1.02));
          // One corrective foot at a time; preserve the other support feet during turns.
          if (
            !leg.start &&
            activity > 0.02 &&
            (phaseCrossed ||
              ((twisted || far || overextended) &&
                correctiveReady &&
                !legs.some((l) => l.start && l.corrective)))
          ) {
            const corrective = !phaseCrossed && (twisted || far || overextended);
            leg.corrective = corrective;
            leg.stepReason = phaseCrossed ? 'cycle' : twisted ? 'turn' : far ? 'distance' : 'reach';
            leg.stepCycle = cycle;
            leg.start = leg.anchor.clone();
            leg.startQ = leg.anchorQ.clone();
            leg.swingTime = 0;
            leg.swingDuration = THREE.MathUtils.clamp(
              (1 - liftoff) / Math.max(0.1, advance / dt),
              locomotionSpeed > 0.55
                ? (profile.walkFastSwingMin ?? 0.06)
                : (profile.walkSwingMin ?? 0.08),
              0.38,
            );
            if (corrective) {
              // Species-sized recovery steps; only genuinely quick turns
              // shorten the swing. Small corrections also lift less.
              leg.swingDuration = THREE.MathUtils.clamp(
                leg.swingDuration,
                tightTurn
                  ? (profile.walkTurnSwingMin ?? 0.06)
                  : (profile.walkCorrectiveSwingMin ?? 0.1),
                tightTurn
                  ? (profile.walkTurnSwingMax ?? 0.08)
                  : (profile.walkCorrectiveSwingMax ?? 0.18),
              );
            }
            const lead = traveled / dt > 0.012 ? gaitStride * (liftoff / 2) : 0;
            // Centre the support joint below the hip/shoulder. Preserve the
            // hock-to-paw offset, rather than adding stride to splayed bind feet.
            const landing = traveled / dt > 0.012 ? leg.walkCenter.clone() : leg.restFoot.clone();
            leg.goal = group.localToWorld(landing.add(new THREE.Vector3(0, 0, lead)));
            // Land ahead of the body at touchdown, not ahead of where it was
            // at liftoff. Otherwise the next stance is shortened into a shuffle.
            leg.goal.addScaledVector(walkVelocity, leg.swingDuration);
            if (turn / dt > 0.025) {
              // Predict the shoulder/hip's rotation as well as translation.
              // An outer leg travels much farther than the body's centre.
              const angle = (headingDelta / dt) * leg.swingDuration;
              const displacement = walkVelocity
                .clone()
                .applyAxisAngle(up, angle / 2)
                .multiplyScalar(leg.swingDuration);
              const futureHip = hip
                .clone()
                .sub(group.position)
                .applyAxisAngle(up, angle)
                .add(group.position)
                .add(displacement);
              leg.goal
                .addScaledVector(walkVelocity, -leg.swingDuration)
                .sub(group.position)
                .applyAxisAngle(up, angle)
                .add(group.position)
                .add(displacement);
              if (tightTurn)
                leg.goal.addScaledVector(
                  up.clone().cross(futureHip.clone().sub(group.position).sub(displacement)),
                  (headingDelta / dt) * period * liftoff * 0.5,
                );
              futureHip.y +=
                supportHeight(
                  group.position.x + displacement.x,
                  group.position.z + displacement.z,
                ) - supportHeight(group.position.x, group.position.z);
              leg.goal.y =
                supportHeight(leg.goal.x, leg.goal.z) + 0.025 + leg.restFoot.y * animal.scale;
              const futureOffset = leg.distalOffset
                  .clone()
                  .multiplyScalar(animal.scale)
                  .applyQuaternion(desiredQ)
                  .applyAxisAngle(up, angle),
                vertical = futureHip.y - leg.goal.y - futureOffset.y,
                radius = Math.sqrt(
                  Math.max(0, ((leg.l1 + leg.l2) * animal.scale * 0.98) ** 2 - vertical ** 2),
                ),
                horizontal = new THREE.Vector3(
                  leg.goal.x + futureOffset.x - futureHip.x,
                  0,
                  leg.goal.z + futureOffset.z - futureHip.z,
                );
              if (horizontal.length() > radius) {
                horizontal.setLength(radius);
                leg.goal.x = futureHip.x + horizontal.x - futureOffset.x;
                leg.goal.z = futureHip.z + horizontal.z - futureOffset.z;
              }
            }
            leg.goal.y =
              supportHeight(leg.goal.x, leg.goal.z) + 0.025 + leg.restFoot.y * animal.scale;
            leg.goalQ = desiredQ.clone();
            leg.liftScale = corrective
              ? THREE.MathUtils.clamp(
                  Math.hypot(leg.goal.x - leg.start.x, leg.goal.z - leg.start.z) /
                    (gaitStride * animal.scale * 0.5),
                  0.25,
                  1,
                )
              : 1;
            leg.steps++;
          }
          if (leg.start) {
            leg.swingTime += dt;
            const t = Math.min(1, leg.swingTime / leg.swingDuration);
            const progress = smoothStep(t);
            // Repeated endpoint Bezier controls give zero velocity and
            // acceleration at liftoff/touchdown (see smooth-walk research notes).
            swing = 64 * t ** 3 * (1 - t) ** 3 * leg.liftScale;
            // A moving body's planned landing can rotate gently while the foot is airborne.
            leg.goalQ.slerp(desiredQ, 1 - Math.exp(-dt * 10));
            leg.anchor.copy(leg.start).lerp(leg.goal, progress);
            leg.anchor.y += swing * gaitHeight * animal.scale;
            leg.anchorQ.copy(leg.startQ).slerp(leg.goalQ, progress);
            if (t >= 1) {
              leg.anchor.copy(leg.goal);
              leg.anchorQ.copy(leg.goalQ);
              leg.start = null;
              leg.goal = null;
              leg.corrective = false;
              leg.stanceTime = 0;
            }
          } else if (activity < 0.02) {
            leg.anchor.lerp(neutral, 1 - Math.exp(-dt * 12));
            leg.anchorQ.slerp(desiredQ, 1 - Math.exp(-dt * 12));
          }
          target = neutral.clone().lerp(leg.anchor, activity * (1 - paw));
        }
        // Roll only airborne feet. Planted soles retain their world orientation.
        const footQ = desiredQ.clone().slerp(leg.anchorQ, activity);
        footQ.multiply(
          new THREE.Quaternion().setFromAxisAngle(axisX, swing * (profile.footRoll ?? 0.1)),
        );
        // A digitigrade hind leg has an elevated hock and a separate metatarsal.
        // Solve the thigh/shin to the hock, then aim its distal bone at the paw.
        const offset = leg.distalOffset.clone().multiplyScalar(animal.scale).applyQuaternion(footQ),
          jointTarget = target.clone().add(offset),
          delta = jointTarget.clone().sub(hip),
          maxReach = (leg.l1 + leg.l2) * animal.scale - 0.00002;
        if (delta.length() > maxReach) {
          jointTarget.copy(hip).add(delta.setLength(maxReach));
          target.copy(jointTarget).sub(offset);
        }
        leg.solvedTarget = target.clone();
        const hint = new THREE.Vector3(
          0,
          0,
          leg.name[0] === 'H' && !leg.hock ? -1 : 1,
        ).applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
        const knee = solveCowLeg(
          hip,
          jointTarget,
          leg.l1 * animal.scale,
          leg.l2 * animal.scale,
          hint,
        );
        aim(leg.upper, knee, dt);
        aim(leg.lower, jointTarget, dt);
        if (leg.hock) aim(leg.hock, target, dt);
        leg.hoof.quaternion.copy(
          leg.hoof.parent
            .getWorldQuaternion(new THREE.Quaternion())
            .invert()
            .multiply(footQ)
            .normalize(),
        );
        leg.hoof.updateWorldMatrix(false, true);
        if (leg.toes) {
          leg.toes.quaternion.multiply(
            new THREE.Quaternion().setFromAxisAngle(axisX, -swing * (profile.toeCurl ?? 0.16)),
          );
          leg.toes.updateWorldMatrix(false, true);
        }
        leg.lastFoot = leg.hoof.getWorldPosition(new THREE.Vector3());
        if (gait === 'walk') leg.lastPhase = (cycle + leg.offset) % 1;
      }
      blinkClock += dt;
      if (blinkClock >= nextBlink) {
        const t = (blinkClock - nextBlink) / 0.24;
        blink = t < 1 ? Math.sin(Math.PI * t) ** 2 : 0;
        if (t >= 1) {
          blinkClock = 0;
          nextBlink = 2.5 + Math.random() * 4;
        }
      }
      for (const mesh of blinkMeshes) {
        const morph = mesh.morphTargetDictionary;
        mesh.morphTargetInfluences[morph.Blink] = blink;
        if (morph.GazeLeft !== undefined) {
          const gaze =
            (animal.familyLook !== undefined
              ? Math.max(-0.7, Math.min(0.7, animal.familyLook))
              : 0.65 * Math.sin(animal.clock * 0.45)) *
            (1 - blink);
          mesh.morphTargetInfluences[morph.GazeLeft] = Math.max(0, -gaze);
          mesh.morphTargetInfluences[morph.GazeRight] = Math.max(0, gaze);
        }
      }
    },
    footContacts: () =>
      legs.map((l) => ({
        swinging: swinging(l),
        foot: l.hoof.getWorldPosition(new THREE.Vector3()).toArray(),
      })),
    snapshot: () => ({
      rigged: true,
      gait,
      run: runAmount,
      cycle,
      activity,
      blink,
      sleeping,
      tree: treePose?.snapshot(),
      sleep: sleepPose?.snapshot(),
      head: head.quaternion.toArray(),
      jaw: jaw?.quaternion.toArray() ?? null,
      tail: (profile.tailBones?.map(([name]) => name) ?? ['Tail', 'Tail_Mid', 'Tail_Tip']).map(
        (name) => {
          const b = find(name);
          return b
            ? {
                name,
                rotation: b.quaternion.toArray(),
                position: b.getWorldPosition(new THREE.Vector3()).toArray(),
              }
            : null;
        },
      ),
      legs: legs.map((l) => ({
        name: l.name,
        stance: l.runStance,
        swinging: swinging(l),
        steps: l.steps,
        corrective: !!l.corrective,
        stepReason: l.stepReason,
        swingDuration: l.swingDuration,
        rotation: l.hoof.getWorldQuaternion(new THREE.Quaternion()).toArray(),
        foot: l.hoof.getWorldPosition(new THREE.Vector3()).toArray(),
        target: l.anchor.toArray(),
        solvedTarget: l.solvedTarget?.toArray(),
        hock: l.hock?.getWorldPosition(new THREE.Vector3()).toArray(),
        toes: l.toes?.quaternion.toArray(),
      })),
    }),
  };
}
