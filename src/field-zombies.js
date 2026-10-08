import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { assetUrl } from './asset-url.js';
import { drivingHeight, inStream, isRoadSurface, islandDistance } from './world-queries.js';
import { insidePaddy } from './paddy-profile.js';
import { roadPoint } from './world-base.js';
import { vehicleObstacleGap } from './vehicle-collision.js';
import { ZOMBIE_LAYOUT, zombiePatrolPoint } from './zombie-layout.js';
import { separatesCircle } from './task-clearance.js';
import { createZombieAnimation } from './zombie-animation.js';

export function createZombieController(sources, colliders = [], groundHeight = drivingHeight) {
  const root = new THREE.Group();
  root.name = 'PvZ zombies on the starting left lawn';
  const actors = [];
  function addActor(layout, modelId = layout.id) {
    if (!sources.has(modelId)) return null;
    const source = clone(sources.get(modelId));
    const object = new THREE.Group();
    object.name = layout.label;
    object.add(source);
    object.updateMatrixWorld(true);
    const feet = [];
    source.traverse((node) => {
      if (node.isBone && /^(Left|Right)Foot_0\d+$/.test(node.name))
        feet.push(node.getWorldPosition(new THREE.Vector3()));
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = false;
    });
    if (!feet.length) throw new Error(`Zombie has no skinned feet: ${layout.id}`);
    const bounds = new THREE.Box3().setFromObject(source, true);
    const center = feet
      .reduce((sum, p) => sum.add(p), new THREE.Vector3())
      .multiplyScalar(1 / feet.length);
    source.position.x -= center.x;
    source.position.y -= bounds.min.y;
    source.position.z -= center.z;
    object.scale.setScalar(layout.scale);
    // Quaternion seat transitions must retain a single upright yaw, including
    // turns through 180 degrees. XYZ can represent the same yaw as X/Z flips.
    object.rotation.order = 'YXZ';
    root.add(object);
    const start = zombiePatrolPoint(layout, layout.phase);
    object.position.set(start.x, groundHeight(start.x, start.z), start.z);
    object.rotation.y = Math.atan2(
      -layout.patrolX * Math.sin(layout.phase),
      layout.patrolZ * Math.cos(layout.phase),
    );
    const rig = createZombieAnimation(source, object, {
      giant: layout.id === 'pvz-gargantuar',
      flagBearer: layout.id === 'pvz-flagbearer',
      scale: layout.scale,
      speed: layout.speed,
    });
    const collider = {
      x: start.x,
      z: start.z,
      radius: layout.radius,
      height: (bounds.max.y - bounds.min.y) * layout.scale,
      zombie: layout.id,
    };
    const actor = { layout, object, source, rig, collider, phase: layout.phase, blocked: false };
    actor.restPose = [];
    // Capture the source binding pose, not the already animated walking pose.
    sources.get(modelId).traverse((n) => {
      if (n.isBone)
        actor.restPose.push({
          name: n.name,
          rotation: n.quaternion.clone(),
          position: n.position.clone(),
        });
    });
    actors.push(actor);
    return actor;
  }
  for (const layout of ZOMBIE_LAYOUT) addActor(layout);
  colliders.push(...actors.map((actor) => actor.collider));
  let elapsed = 0;
  function safe(
    actor,
    p,
    car,
    ignore = () => false,
    handling = false,
    heading = actor.object.rotation.y,
  ) {
    const radius = actor.collider.radius;
    for (const [dx, dz] of [
      [0, 0],
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
    ])
      if (
        islandDistance(p.x + dx, p.z + dz) > -2 ||
        inStream(p.x + dx, p.z + dz) ||
        isRoadSurface(p.x + dx, p.z + dz) ||
        insidePaddy(p.x + dx, p.z + dz, roadPoint, 0.3)
      )
        return false;
    if (
      colliders.some((c) => {
        if (c === actor.collider || ignore(c)) return false;
        const dx = p.x - c.x,
          dz = p.z - c.z,
          distance = Math.hypot(dx, dz);
        // A standing human is shallower front-to-back than across the arms.
        // Door handling uses that oriented footprint against timber only;
        // animals, other characters and vehicles retain full body clearance.
        const forward =
          (dx * Math.sin(heading) + dz * Math.cos(heading)) / Math.max(distance, 1e-9);
        const bodyRadius =
          handling && c.corral
            ? Math.sqrt(0.35 ** 2 * forward ** 2 + radius ** 2 * (1 - forward ** 2))
            : radius;
        const margin = actor.scripted ? 0.12 : 0.25;
        if (
          (c.zombie || c.animal || c.woodenCart) &&
          separatesCircle(actor.object.position, p, bodyRadius, c, margin)
        )
          return false;
        return distance < bodyRadius + c.radius + margin;
      })
    )
      return false;
    return (
      !car || vehicleObstacleGap(car.x, car.z, car.heading ?? 0, { ...actor.collider, ...p }) > 0.4
    );
  }
  // No static substitute is used when an asset or its rig cannot load.
  return {
    root,
    actor: (id) => actors.find((a) => a.layout.id === id),
    addPloughman(at) {
      let actor = actors.find((a) => a.layout.id === 'pvz-ploughman');
      if (actor) return actor;
      actor = addActor(
        {
          ...ZOMBIE_LAYOUT[0],
          id: 'pvz-ploughman',
          label: '水田扶犁僵尸',
          x: at.x,
          z: at.z,
          patrolX: 0,
          patrolZ: 0,
          phase: 0,
          speed: 0.35,
        },
        'pvz-browncoat',
      );
      if (actor) {
        actor.layout = { ...actor.layout, patrolX: 1, patrolZ: 1.2 };
        actor.patrolHome = { x: at.x, z: at.z };
        colliders.push(actor.collider);
      }
      return actor;
    },
    removePloughman() {
      const index = actors.findIndex((a) => a.layout.id === 'pvz-ploughman');
      if (index < 0) return;
      const [actor] = actors.splice(index, 1);
      actor.object.removeFromParent();
      const collider = colliders.indexOf(actor.collider);
      if (collider >= 0) colliders.splice(collider, 1);
    },
    addLookout(at) {
      let actor = actors.find((a) => a.layout.id === 'pvz-lookout');
      if (actor) return actor;
      actor = addActor(
        {
          ...ZOMBIE_LAYOUT[0],
          id: 'pvz-lookout',
          label: '瞭望塔普通僵尸',
          x: at.x,
          z: at.z,
          patrolX: 0,
          patrolZ: 0,
          phase: 0,
        },
        'pvz-browncoat',
      );
      if (!actor) return null;
      actor.scripted = true;
      actor.object.position.set(at.x, at.y, at.z);
      actor.object.rotation.y = -Math.PI / 2;
      this.restore('pvz-lookout');
      this.rebind('pvz-lookout');
      return actor;
    },
    addGatekeeper() {
      if (actors.some((a) => a.layout.id === 'pvz-gatekeeper')) return;
      const actor = addActor(
        {
          ...ZOMBIE_LAYOUT[0],
          id: 'pvz-gatekeeper',
          label: '看门普通僵尸',
          x: 160.2,
          z: 16.8,
          patrolX: 0.6,
          patrolZ: 0.6,
          phase: 0,
        },
        'pvz-browncoat',
      );
      if (actor) {
        actor.patrolHome = { x: actor.layout.x, z: actor.layout.z };
        colliders.push(actor.collider);
      }
    },
    restore(id) {
      const actor = actors.find((a) => a.layout.id === id);
      if (!actor) return;
      const rests = new Map(actor.restPose.map((e) => [e.name, e]));
      actor.source.traverse((n) => {
        const rest = rests.get(n.name);
        if (n.isBone && rest) {
          n.quaternion.copy(rest.rotation);
          n.position.copy(rest.position);
        }
      });
      actor.object.updateMatrixWorld(true);
    },
    rebind(id) {
      const actor = actors.find((a) => a.layout.id === id);
      if (!actor || actor.seated) return;
      this.restore(id);
      actor.rig = createZombieAnimation(actor.source, actor.object, {
        giant: id === 'pvz-gargantuar',
        flagBearer: id === 'pvz-flagbearer',
        scale: actor.layout.scale,
        speed: actor.layout.speed,
      });
    },
    release(id) {
      const actor = actors.find((a) => a.layout.id === id);
      if (!actor || actor.seated) return;
      actor.scripted = false;
      // Resume locally, never jump back to the old patrol circle.
      actor.layout = {
        ...actor.layout,
        x:
          actor.patrolHome?.x ??
          actor.object.position.x - actor.layout.patrolX * Math.cos(actor.phase),
        z:
          actor.patrolHome?.z ??
          actor.object.position.z - actor.layout.patrolZ * Math.sin(actor.phase),
      };
      actor.patrolGoal = null;
      actor.blockedFor = 0;
    },
    canStand(id, point, car, { ignore } = {}) {
      const a = actors.find((a) => a.layout.id === id);
      return a ? safe(a, point, car, ignore) : false;
    },
    take(id) {
      const actor = actors.find((a) => a.layout.id === id && !a.seated);
      if (actor) actor.scripted = true;
      return actor;
    },
    face(id, target, dt, car, { ignore, ground = groundHeight } = {}) {
      const actor = actors.find((a) => a.layout.id === id && !a.seated);
      if (!actor || !(dt > 0)) return false;
      actor.scripted = true;
      const p = actor.object.position;
      const desired = Math.atan2(target.x - p.x, target.z - p.z);
      const error = Math.atan2(
        Math.sin(desired - actor.object.rotation.y),
        Math.cos(desired - actor.object.rotation.y),
      );
      const yaw = THREE.MathUtils.clamp(error, -dt * 1.8, dt * 1.8);
      actor.blocked = !safe(actor, p, car, ignore, false, actor.object.rotation.y + yaw);
      if (!actor.blocked) {
        actor.object.rotation.y += yaw;
        actor.rig.update(dt, Math.abs(yaw) * 0.07, ground);
      }
      return !actor.blocked && Math.abs(error) < 0.04;
    },
    handleGate(id, target, focus, dt, car, reach = 1) {
      const actor = actors.find((a) => a.layout.id === id && !a.seated);
      if (!actor || !(dt > 0)) return false;
      actor.scripted = true;
      const p = actor.object.position,
        dx = target.x - p.x,
        dz = target.z - p.z;
      const distance = Math.hypot(dx, dz);
      const desired = Math.atan2(focus.x - p.x, focus.z - p.z);
      const error = Math.atan2(
        Math.sin(desired - actor.object.rotation.y),
        Math.cos(desired - actor.object.rotation.y),
      );
      const yaw = THREE.MathUtils.clamp(error, -dt * 1.8, dt * 1.8);
      const step = Math.min(distance, dt * 1.05);
      const next = {
        x: p.x + (dx / Math.max(distance, 1e-9)) * step,
        z: p.z + (dz / Math.max(distance, 1e-9)) * step,
      };
      actor.blocked = !safe(actor, next, car, undefined, true, actor.object.rotation.y + yaw);
      if (!actor.blocked) {
        actor.object.rotation.y += yaw;
        actor.object.position.set(next.x, groundHeight(next.x, next.z), next.z);
        Object.assign(actor.collider, next);
        actor.rig.update(dt, Math.max(step, Math.abs(yaw) * 0.07), groundHeight);
      }
      actor.rig.reach(focus, reach, dt);
      return (
        !actor.blocked &&
        Math.hypot(target.x - actor.object.position.x, target.z - actor.object.position.z) <
          0.025 &&
        Math.abs(error) < 0.06
      );
    },
    walk(
      id,
      target,
      dt,
      {
        speed = 0.65,
        car,
        ignore,
        ground = groundHeight,
        facingHeading,
        run = false,
        alignBeforeMove = false,
      } = {},
    ) {
      const actor = actors.find((a) => a.layout.id === id && !a.seated);
      if (!actor || !(dt > 0)) return false;
      actor.scripted = true;
      const p = actor.object.position,
        dx = target.x - p.x,
        dz = target.z - p.z;
      const distance = Math.hypot(dx, dz),
        movementHeading = Math.atan2(dx, dz),
        desired = facingHeading ?? movementHeading;
      const turn = Math.atan2(
        Math.sin(desired - actor.object.rotation.y),
        Math.cos(desired - actor.object.rotation.y),
      );
      const yaw = THREE.MathUtils.clamp(turn, -dt * 1.8, dt * 1.8);
      const aligned = !alignBeforeMove || Math.abs(turn - yaw) < 0.12;
      const step = aligned ? Math.min(distance, speed * dt * Math.max(0, Math.cos(turn))) : 0;
      const next = {
        x: p.x + (dx / Math.max(distance, 1e-9)) * step,
        z: p.z + (dz / Math.max(distance, 1e-9)) * step,
      };
      const samples = Math.max(1, Math.ceil(step / 0.08));
      actor.blocked = false;
      for (let i = 1; i <= samples; i++) {
        const t = i / samples;
        if (
          !safe(
            actor,
            { x: p.x + (next.x - p.x) * t, z: p.z + (next.z - p.z) * t },
            car,
            ignore,
            false,
            actor.object.rotation.y + yaw * t,
          )
        ) {
          actor.blocked = true;
          break;
        }
      }
      if (!actor.blocked) {
        actor.object.rotation.y += yaw;
        actor.object.position.set(next.x, ground(next.x, next.z), next.z);
        Object.assign(actor.collider, next);
        if (!run || step < 1e-6) actor.rig.stopRunning();
        actor.rig.update(
          dt,
          Math.max(step, Math.abs(yaw) * 0.07),
          ground,
          movementHeading,
          run && step > 1e-6 ? 1 : 0,
        );
      } else actor.rig.stopRunning();
      // Reach a turn's waypoint before selecting the next segment. A broad
      // arrival radius cuts the inside corner into nearby animals.
      return distance < 0.02;
    },
    mountDriver(parent, id = 'pvz-browncoat') {
      const actor = actors.find((a) => a.layout.id === id);
      if (!actor || actor.seated) throw new Error('Browncoat unavailable for wooden cart');
      actor.seated = true;
      actor.driverRest = [];
      actor.source.traverse((bone) => {
        if (bone.isBone)
          actor.driverRest.push({
            bone,
            rotation: bone.quaternion.clone(),
            position: bone.position.clone(),
          });
      });
      parent.add(actor.object);
      const index = colliders.indexOf(actor.collider);
      if (index >= 0) colliders.splice(index, 1);
      return actor;
    },
    releaseDriver(at = null, id = 'pvz-browncoat') {
      const actor = actors.find((a) => a.seated && a.layout.id === id);
      if (!actor) return;
      actor.seated = false;
      delete actor.seatedPose;
      for (const { bone, rotation, position } of actor.driverRest) {
        bone.quaternion.copy(rotation);
        bone.position.copy(position);
      }
      delete actor.driverRest;
      root.add(actor.object);
      const p = at ?? zombiePatrolPoint(actor.layout, actor.phase);
      actor.object.position.set(p.x, p.y ?? groundHeight(p.x, p.z), p.z);
      actor.object.rotation.set(
        0,
        Math.atan2(
          -actor.layout.patrolX * Math.sin(actor.phase),
          actor.layout.patrolZ * Math.cos(actor.phase),
        ),
        0,
        'YXZ',
      );
      actor.rig = createZombieAnimation(actor.source, actor.object, {
        giant: actor.layout.id === 'pvz-gargantuar',
        flagBearer: actor.layout.id === 'pvz-flagbearer',
        scale: actor.layout.scale,
        speed: actor.layout.speed,
      });
      Object.assign(actor.collider, { x: p.x, z: p.z });
      if (at) actor.scripted = true;
      if (!colliders.includes(actor.collider)) colliders.push(actor.collider);
    },
    update(dt, car) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.1);
      elapsed += dt;
      for (const actor of actors) {
        if (actor.seated || actor.scripted) continue;
        const { layout, object } = actor;
        if (actor.patrolHome) {
          actor.patrolWait = Math.max(0, (actor.patrolWait ?? 0) - dt);
          if (!actor.patrolGoal && !actor.patrolWait) {
            for (let i = 0; i < 12; i++) {
              const angle = Math.random() * Math.PI * 2;
              const size = Math.sqrt(Math.random());
              const target = {
                x: layout.x + Math.cos(angle) * layout.patrolX * size,
                z: layout.z + Math.sin(angle) * layout.patrolZ * size,
              };
              const distance = Math.hypot(
                target.x - object.position.x,
                target.z - object.position.z,
              );
              if (distance < 0.25) continue;
              const steps = Math.ceil(distance / 0.15);
              if (
                Array.from({ length: steps }, (_, j) => (j + 1) / steps).every((t) =>
                  safe(
                    actor,
                    {
                      x: object.position.x + (target.x - object.position.x) * t,
                      z: object.position.z + (target.z - object.position.z) * t,
                    },
                    car,
                  ),
                )
              ) {
                actor.patrolGoal = target;
                break;
              }
            }
            if (!actor.patrolGoal) actor.patrolWait = 1;
          }
          if (actor.patrolGoal) {
            const arrived = this.walk(layout.id, actor.patrolGoal, dt, {
              speed: layout.speed,
              alignBeforeMove: true,
              car,
            });
            actor.scripted = false;
            actor.blockedFor = actor.blocked ? (actor.blockedFor ?? 0) + dt : 0;
            if (arrived || actor.blockedFor > 2) {
              actor.patrolGoal = null;
              actor.patrolWait = arrived ? 0.8 + Math.random() * 1.5 : 0.3;
            }
          }
          actor.rig.flutter(dt);
          continue;
        }
        const derivative = Math.hypot(
          layout.patrolX * Math.sin(actor.phase),
          layout.patrolZ * Math.cos(actor.phase),
        );
        if (derivative < 1e-6) {
          actor.rig.flutter(dt);
          continue;
        }
        const direction = actor.patrolDirection ?? 1;
        const phase = actor.phase + (direction * layout.speed * dt) / derivative;
        const next = zombiePatrolPoint(layout, phase);
        actor.blocked = !safe(actor, next, car);
        if (actor.blocked) {
          actor.blockedFor = (actor.blockedFor ?? 0) + dt;
          if (actor.blockedFor > 2) {
            actor.patrolDirection = -direction;
            actor.blockedFor = 0;
          }
          actor.rig.flutter(dt);
          continue;
        }
        const heading = Math.atan2(
          -direction * layout.patrolX * Math.sin(phase),
          direction * layout.patrolZ * Math.cos(phase),
        );
        const error = Math.atan2(
          Math.sin(heading - object.rotation.y),
          Math.cos(heading - object.rotation.y),
        );
        if (Math.abs(error) > 0.12) {
          const yaw = THREE.MathUtils.clamp(error, -dt * 1.8, dt * 1.8);
          object.rotation.y += yaw;
          actor.rig.update(dt, Math.abs(yaw) * 0.07, groundHeight);
          actor.rig.flutter(dt);
          continue;
        }
        const distance = Math.hypot(next.x - object.position.x, next.z - object.position.z);
        actor.blockedFor = 0;
        actor.phase = phase % (Math.PI * 2);
        object.rotation.y = Math.atan2(
          -direction * layout.patrolX * Math.sin(phase),
          direction * layout.patrolZ * Math.cos(phase),
        );
        object.position.set(next.x, groundHeight(next.x, next.z), next.z);
        Object.assign(actor.collider, next);
        actor.rig.update(dt, distance, groundHeight);
        actor.rig.flutter(dt);
      }
    },
    snapshot: () => ({
      elapsed,
      zombies: actors.map((actor) => ({
        id: actor.layout.id,
        label: actor.layout.label,
        position: actor.object.getWorldPosition(new THREE.Vector3()).toArray(),
        heading: new THREE.Euler().setFromQuaternion(
          actor.object.getWorldQuaternion(new THREE.Quaternion()),
          'YXZ',
        ).y,
        blocked: actor.blocked,
        ...(actor.scripted ? { scripted: true } : {}),
        radius: actor.collider.radius,
        ...(actor.seated ? actor.seatedPose?.snapshot() : actor.rig.snapshot()),
      })),
    }),
  };
}

export async function addFieldZombies(scene, colliders, warnings) {
  const sources = new Map();
  await Promise.all(
    ZOMBIE_LAYOUT.map(async ({ id }) => {
      try {
        sources.set(id, (await new GLTFLoader().loadAsync(assetUrl(id))).scene);
      } catch (error) {
        warnings.push(id);
        console.warn(`Zombie model unavailable: ${id}`, error);
      }
    }),
  );
  try {
    const controller = createZombieController(sources, colliders);
    scene.add(controller.root);
    return controller;
  } catch (error) {
    warnings.push('pvz-zombie-rig');
    console.warn('Zombie skeleton could not be initialized.', error);
    return null;
  }
}
