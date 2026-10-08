import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createAnimalAnimation } from './animal-animation.js';
import { ANIMAL_PROFILES } from './animal-profiles.js';
import { vehicleObstacleGap } from './vehicle-collision.js';
import { isRoadSurface, inStream } from './world-queries.js';
import {
  PLOUGH_FIELD,
  PLOUGH_ROUTE_LENGTH,
  ploughRoute,
  ploughGround,
  inPloughField,
} from './paddy-plough-site.js';
import { createPaddyWhip } from './paddy-whip.js';
import { createPloughProps, createPloughEffects, link } from './paddy-plough-props.js';

const missingRig = '缺少旗手或完整耕牛骨骼';
const difference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const ease = (t) => THREE.MathUtils.smoothstep(t, 0, 1);
const worldOffset = (object, x, y, z) =>
  object.localToWorld(new THREE.Vector3(x, y, z).divideScalar(object.scale.x));

export function createPaddyPloughing(
  scene,
  colliders,
  zombies,
  cowSource,
  {
    random = Math.random,
    cowId = 'golden-cow',
    cowScale = 0.4875,
    ploughSource,
    existingCow = null,
  } = {},
) {
  const leader = zombies.actor('pvz-flagbearer');
  if (!leader || !cowSource) throw new Error(missingRig);
  const root = new THREE.Group();
  root.name = '僵尸牵牛犁田队伍';
  scene.add(root);
  const source = existingCow?.source ?? clone(cowSource);
  source.updateMatrixWorld(true);
  source.traverse((n) => {
    if (n.isSkinnedMesh) n.skeleton.update();
    if (n.isMesh) {
      n.castShadow = n.receiveShadow = true;
      n.frustumCulled = false;
    }
  });
  const bounds = new THREE.Box3().setFromObject(source, true),
    center = bounds.getCenter(new THREE.Vector3());
  if (!existingCow) source.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  const group = existingCow?.group ?? new THREE.Group();
  if (!existingCow) {
    group.name = '水田耕牛';
    group.add(source);
  }
  group.scale.setScalar(cowScale);
  group.rotation.order = 'YXZ';
  if (!existingCow) root.add(group);
  const start = ploughRoute(0);
  if (!existingCow) {
    group.position.set(start.x, ploughGround(start.x, start.z) + 0.025, start.z);
    group.rotation.y = start.heading;
  }
  const cow = existingCow ?? {
    id: cowId,
    instanceId: 'paddy-ox',
    group,
    source,
    scale: cowScale,
    x: start.x,
    z: start.z,
    heading: start.heading,
    clock: 0,
    distance: 0,
    velocity: 0,
    motion: 0,
    look: 0,
    chargeRun: 0,
    chargePose: 0,
    supportHeight: ploughGround,
    behavior: { down: 0.18, raised: 0, swishTime: 2, swishSide: 1, swishStrength: 0.55 },
  };
  if (!existingCow) cow.rig = createAnimalAnimation(source, group, ANIMAL_PROFILES[cowId]);
  if (!cow.rig) throw new Error('耕牛必须具有真实蒙皮及四腿IK');
  // Use a real, Body-skinned rump vertex as the whip landmark. A guessed
  // interior point would make the lash end disappear inside the cow.
  const body = source.getObjectByName('Body');
  const wanted = worldOffset(group, 0.28, 0.86, -0.63);
  let rumpVertex = null,
    nearest = Infinity;
  source.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const indices = mesh.geometry.attributes.skinIndex,
      weights = mesh.geometry.attributes.skinWeight;
    mesh.skeleton.update();
    for (let i = 0; i < indices.count; i++) {
      let influence = 0;
      for (let j = 0; j < 4; j++)
        if (mesh.skeleton.bones[indices.getComponent(i, j)] === body)
          influence += weights.getComponent(i, j);
      if (influence < 0.999) continue;
      const point = mesh.localToWorld(mesh.getVertexPosition(i, new THREE.Vector3()));
      const d = point.distanceToSquared(wanted);
      if (d < nearest) {
        nearest = d;
        rumpVertex = point;
      }
    }
  });
  if (!rumpVertex) throw new Error('耕牛缺少可验证的臀部蒙皮接触点');
  const rumpLocal = body.worldToLocal(rumpVertex);
  const rumpPoint = () => body.localToWorld(rumpLocal.clone());
  if (!existingCow) {
    cow.collider = { x: cow.x, z: cow.z, radius: 1.16, height: 1.6, ploughing: true };
    colliders.push(cow.collider);
  }
  // Repeated tasks can start midway through a corral stride. Measure mounting
  // geometry in the preserved binding pose, then restore the live pose before
  // returning; planted feet and the original animation controller stay intact.
  const livePose = existingCow?.bindPose?.map(({ bone }) => ({
    bone,
    rotation: bone.quaternion.clone(),
    position: bone.position.clone(),
  }));
  let props;
  try {
    for (const pose of existingCow?.bindPose ?? []) {
      pose.bone.quaternion.copy(pose.rotation);
      pose.bone.position.copy(pose.position);
    }
    props = createPloughProps(root, cow, ploughSource);
  } finally {
    for (const pose of livePose ?? []) {
      pose.bone.quaternion.copy(pose.rotation);
      pose.bone.position.copy(pose.position);
    }
    group.updateMatrixWorld(true);
  }
  const effects = createPloughEffects(root);
  // The rigid beam remains behind the animal even for a longer replacement.
  // Move its operator with the handle, keeping the original walking controller.
  const drawDistance = Math.max(2.35, -props.fit.metrics.rearZ + 1.12 + 0.28);
  const workerOffset = -drawDistance - 0.85;
  const worker = zombies.addPloughman(ploughRoute(workerOffset, 0.4));
  if (!worker) throw new Error('缺少扶犁僵尸模型');
  const crew = [
    { actor: leader, offset: 3.1, side: -0.65 },
    { actor: worker, offset: workerOffset, side: 0.4 },
  ];
  function toolPosition(distance) {
    const p = ploughRoute(distance - drawDistance),
      at = ploughRoute(distance);
    return { ...p, heading: Math.atan2(at.x - p.x, at.z - p.z) };
  }
  function crewPosition(member, distance) {
    if (member.actor !== worker) return ploughRoute(distance + member.offset, member.side);
    const p = toolPosition(distance),
      s = Math.sin(p.heading),
      c = Math.cos(p.heading);
    // The operator follows the actual handle around corners. Keep the same
    // grip-to-body relation as on a straight row, without stretching the arm.
    return { x: p.x + c * 0.4 - s * 0.85, z: p.z - s * 0.4 - c * 0.85, heading: p.heading };
  }
  for (const member of existingCow ? [] : crew) {
    const p = crewPosition(member, 0);
    zombies.take(member.actor.layout.id);
    member.actor.object.position.set(p.x, ploughGround(p.x, p.z), p.z);
    member.actor.object.rotation.set(0, p.heading, 0, 'YXZ');
    Object.assign(member.actor.collider, { x: p.x, z: p.z, ploughing: true });
    zombies.rebind(member.actor.layout.id);
  }
  const ploughCollider = { x: start.x, z: start.z, radius: 0.45, height: 1.2, ploughing: true };
  colliders.push(ploughCollider);
  const owned = new Set([cow.collider, ploughCollider, ...crew.map((m) => m.actor.collider)]);
  let boost = 0;
  let traveled = 0,
    clock = 0,
    velocity = 0,
    lift = 0,
    blocked = false;
  let whipIn = 3,
    whipTime = null,
    contacts = 0,
    reacted = false,
    swished = false,
    callRolls = 0,
    callRequests = 0,
    voicePlaying = false;
  const lash = createPaddyWhip();
  let sound = () => false,
    scratchIn = 0,
    furrowDistance = 0,
    splashes = 0,
    visualTime = 0;
  let lastLegs = cow.rig.footContacts();
  const events = [];
  const emit = (type, p, strength = 1, notify, call) => {
    const event = { type, x: p.x, z: p.z, strength, cowId, call };
    events.push(event);
    if (events.length > 20) events.shift();
    return sound(event, notify);
  };
  function positions(distance) {
    const cowPoint = ploughRoute(distance),
      ploughPoint = toolPosition(distance);
    const s = Math.sin(ploughPoint.heading),
      c = Math.cos(ploughPoint.heading);
    const hitch = {
      x: ploughPoint.x + c * 0.51 * props.fit.metrics.yokeWidth + s * 1.12,
      z: ploughPoint.z - s * 0.51 * props.fit.metrics.yokeWidth + c * 1.12,
    };
    return [
      { ...cowPoint, radius: cow.radius ?? 1.16 },
      ...crew.map((m) => ({
        ...crewPosition(m, distance),
        radius: m.actor.collider.radius,
      })),
      { ...ploughPoint, radius: 0.45 },
      { ...hitch, radius: 0.27 },
      { x: (hitch.x + ploughPoint.x) / 2, z: (hitch.z + ploughPoint.z) / 2, radius: 0.27 },
    ];
  }
  function clear(distance, car) {
    return positions(distance).every((p, index) => {
      if (
        !inPloughField(p.x, p.z, index === 0 ? 1.15 : 0.75) ||
        isRoadSurface(p.x, p.z) ||
        inStream(p.x, p.z)
      )
        return false;
      if (car && vehicleObstacleGap(car.x, car.z, car.heading ?? 0, p) < 0.45) return false;
      return !colliders.some(
        (c) => !owned.has(c) && Math.hypot(p.x - c.x, p.z - c.z) < p.radius + c.radius + 0.15,
      );
    });
  }
  function poseTools(dt, draw = true) {
    const p = toolPosition(traveled);
    props.plough.position.set(p.x, ploughGround(p.x, p.z) + lift * 0.19, p.z);
    // Point the trailing beam along the pull direction, not the path tangent.
    const draftHeading = p.heading;
    props.plough.rotation.set(-lift * 0.12, draftHeading, 0, 'YXZ');
    props.plough.updateMatrixWorld(true);
    Object.assign(ploughCollider, { x: p.x, z: p.z });
    worker.rig.workGrip('Left', props.grip(), dt);
    leader.rig.workGrip('Left', worldOffset(leader.object, 0.28, 1.07, -0.1), dt);
    const hand = leader.rig.gripPoint('Left'),
      nose = props.nose();

    if (draw)
      props.lead.update(
        new THREE.QuadraticBezierCurve3(
          hand,
          hand
            .clone()
            .lerp(nose, 0.5)
            .add(new THREE.Vector3(0, velocity > 0.01 ? -0.055 : -0.24, 0)),
          nose,
        ),
      );
    if (draw)
      props.updateTraces(
        Math.max(lift, ease(Math.abs(difference(draftHeading, cow.heading)) / 0.5)),
      );
    const t = whipTime ?? 0;
    const raise = whipTime === null ? 0 : ease(t / 0.32) * (1 - ease((t - 0.36) / 0.24));
    const snap = whipTime === null ? 0 : ease((t - 0.36) / 0.18) * (1 - ease((t - 0.68) / 0.52));
    const target = worldOffset(
      worker.object,
      -0.34,
      1.2 + raise * 0.3,
      0.24 - raise * 0.35 + snap * 0.24,
    );
    worker.rig.workGrip('Right', target, dt, -raise * 0.45 + snap * 0.5);
    const grip = worker.rig.gripPoint('Right');
    const angle = -raise * 0.85 + snap * 0.9;
    const handleAxis = new THREE.Vector3(0, Math.cos(angle), Math.sin(angle)).applyQuaternion(
      worker.object.getWorldQuaternion(new THREE.Quaternion()),
    );
    const handleTip = grip.clone().addScaledVector(handleAxis, 0.245);
    const handleBottom = grip.clone().addScaledVector(handleAxis, -0.09);
    link(props.handle, handleBottom, handleTip);
    const rump = rumpPoint();
    lash.update(
      blocked ? 0 : dt,
      handleTip,
      rump,
      worker.object.rotation.y,
      whipTime,
      ploughGround(p.x, p.z),
    );
    if (draw) props.whip.update(lash.curve);
    if (whipTime !== null && !swished && t >= 0.38 && !blocked) {
      swished = true;
      emit('whip-swish', grip, 0.38);
    }
    if (
      whipTime !== null &&
      !reacted &&
      t >= 0.58 &&
      t < 0.74 &&
      lash.tip.distanceTo(rump) < 0.045 &&
      !blocked
    ) {
      reacted = true;
      contacts++;
      cow.behavior.swishTime = 0;
      cow.behavior.raised = 0.28;
      boost = 2.5;
      emit('whip', rump, 0.55);
      callRolls++;
      const roll = random();
      if (roll < (cowId === 'hornless-calf' ? 0.4 : 0.3)) {
        callRequests++;
        emit(
          'cow-call',
          rump,
          1,
          (state) => {
            voicePlaying = state === 'playing';
          },
          cowId === 'hornless-calf' && roll >= 0.2 ? 'calf-lift-call' : undefined,
        );
      }
    }
  }
  // Initial grips use the same real limb solver as ongoing motion.
  if (!existingCow) poseTools(1 / 60);
  const api = {
    root,
    cow,
    leader,
    worker,
    props,
    toolTarget: () => toolPosition(traveled),
    progress: () => ({
      blocked,
      distance: traveled,
      speed: velocity,
      boost,
      contacts,
      callRequests,
    }),
    formation: () => ({
      cow: ploughRoute(traveled),
      leader: crewPosition(crew[0], traveled),
      worker: crewPosition(crew[1], traveled),
    }),
    begin() {
      cow.supportHeight = ploughGround;
      lastLegs = cow.rig.footContacts();
    },
    stop() {
      whipTime = null;
      boost = 0;
      velocity = cow.velocity = 0;
      voicePlaying = false;
      sound({ type: 'cow-stop' });
      root.visible = group.visible = leader.object.visible = worker.object.visible = true;
    },
    dispose() {
      api.stop();
      props.halter.removeFromParent();
      props.yoke.removeFromParent();
      root.removeFromParent();
      const index = colliders.indexOf(ploughCollider);
      if (index >= 0) colliders.splice(index, 1);
      // Only dispose task-owned geometry; GLB materials/meshes are shared assets.
      for (const cord of [props.lead, props.whip, props.trace, props.neckStrap]) {
        cord.mesh.geometry.dispose();
        cord.mesh.material.dispose();
      }
      props.yoke.traverse((n) => {
        if (n.isMesh) n.geometry.dispose();
      });
    },
    connectAudio(handler) {
      sound = handler ?? (() => false);
    },
    update(dt, car, camera) {
      const distanceToCamera = camera ? Math.hypot(cow.x - camera.x, cow.z - camera.z) : 0;
      root.visible =
        group.visible =
        leader.object.visible =
        worker.object.visible =
          distanceToCamera < 120;
      if (!(dt > 0)) return;
      visualTime += dt;
      const draw = distanceToCamera < 60 || visualTime >= 0.1;
      if (draw) visualTime = 0;
      const steps = Math.ceil(dt * 60),
        h = dt / steps;
      for (let frame = 0; frame < steps; frame++) {
        clock += h;
        const turn = ploughRoute(traveled).turning;
        const ploughTurn = ploughRoute(traveled - drawDistance).turning;
        const targetSpeed = turn ? 0.22 : boost > 0 ? 0.46 : 0.35;
        const nextSpeed = THREE.MathUtils.damp(velocity, targetSpeed, 2.8, h);
        const nextDistance = traveled + nextSpeed * h;
        blocked = !clear(nextDistance, car);
        velocity = blocked ? 0 : nextSpeed;
        if (!blocked) boost = Math.max(0, boost - h);
        const distance = velocity * h;
        traveled += distance;
        lift = THREE.MathUtils.damp(lift, ploughTurn ? 1 : 0, 4, h);
        for (const member of crew) {
          const actor = member.actor,
            at = crewPosition(member, traveled);
          const before = actor.object.position.clone(),
            oldHeading = actor.object.rotation.y;
          actor.object.position.set(at.x, ploughGround(at.x, at.z), at.z);
          actor.object.rotation.y += difference(at.heading, oldHeading);
          Object.assign(actor.collider, { x: at.x, z: at.z });
          const movement = Math.max(
            before.distanceTo(actor.object.position),
            Math.abs(difference(at.heading, oldHeading)) * 0.07,
          );
          actor.rig.update(h, movement, ploughGround);
        }
        const at = ploughRoute(traveled);
        cow.x = at.x;
        cow.z = at.z;
        cow.heading += difference(at.heading, cow.heading);
        cow.clock += h;
        cow.distance += distance;
        cow.velocity = velocity;
        cow.motion = THREE.MathUtils.damp(cow.motion, velocity > 0 ? 1 : 0, 4, h);
        cow.behavior.swishTime += h;
        cow.behavior.raised = Math.max(0, cow.behavior.raised - h * 0.22);
        group.position.set(at.x, ploughGround(at.x, at.z) + 0.025, at.z);
        group.rotation.y = cow.heading;
        Object.assign(cow.collider, { x: at.x, z: at.z });
        cow.vocalPose = THREE.MathUtils.damp(
          cow.vocalPose ?? 0,
          voicePlaying ? 0.65 + 0.35 * Math.sin(cow.clock * 9) ** 2 : 0,
          18,
          h,
        );
        cow.rig.update(h, cow, 0, 0);
        sound({ type: 'cow-position', cowId, x: cow.x, z: cow.z });
        const legs = cow.rig.footContacts();
        for (let i = 0; i < legs.length; i++) {
          if (lastLegs[i].swinging && !legs[i].swinging) {
            const point = new THREE.Vector3(...legs[i].foot);
            effects.splash(point);
            splashes++;
            emit('splash', point, 0.4);
          }
        }
        lastLegs = legs;
        if (velocity > 0 && !turn && lift < 0.1) whipIn = Math.max(0, whipIn - h);
        if (whipIn <= 0 && whipTime === null && velocity > 0 && !turn && lift < 0.1) {
          whipTime = 0;
          whipIn = 3;
          reacted = false;
          swished = false;
        }
        if (whipTime !== null) {
          // A blocked convoy holds its current gesture until it can advance.
          if (!blocked) whipTime += h;
          if (whipTime >= 1.35) {
            whipTime = null;
          }
        }
        const renderTools = draw && frame === steps - 1;
        poseTools(h, renderTools);
        if (velocity > 0 && lift < 0.1) {
          furrowDistance += distance;
          scratchIn -= h;
          if (furrowDistance >= 0.16) {
            effects.furrow(props.plough.position, props.plough.rotation.y);
            furrowDistance = 0;
          }
          if (scratchIn <= 0) {
            emit('soil', props.plough.position, 0.25);
            scratchIn = 0.45;
          }
        }
        effects.update(h, renderTools);
      }
    },
    snapshot: () => ({
      field: PLOUGH_FIELD,
      phase: blocked ? 'waiting' : lift > 0.3 ? 'turning' : 'ploughing',
      clock,
      distance: traveled,
      laps: Math.floor(traveled / PLOUGH_ROUTE_LENGTH),
      speed: velocity,
      boost,
      lift,
      blocked,
      whip: { in: whipIn, time: whipTime, contacts, callRolls, callRequests, ...lash.snapshot() },
      splashes,
      cow: {
        id: cow.id,
        voicePlaying,
        vocalPose: cow.vocalPose ?? 0,
        position: group.position.toArray(),
        heading: cow.heading,
        rig: cow.rig.snapshot(),
      },
      crew: crew.map((m) => ({
        id: m.actor.layout.id,
        position: m.actor.object.position.toArray(),
        heading: m.actor.object.rotation.y,
        rig: m.actor.rig.snapshot(),
      })),
      lead: [leader.rig.gripPoint('Left').toArray(), props.nose().toArray()],
      plough: {
        position: props.plough.position.toArray(),
        grip: props.grip().toArray(),
        hand: worker.rig.gripPoint('Left').toArray(),
        shareTip: props.shareTip().toArray(),
        shareHeel: props.shareHeel().toArray(),
        hitch: props.hitch().toArray(),
        pull: props.pull().toArray(),
        harness: {
          ...props.fit.metrics,
          contact: props.fit.contact().toArray(),
          gap: props.fit.gap(),
        },
      },
      effects: effects.snapshot(),
      events: [...events],
    }),
  };
  return api;
}
