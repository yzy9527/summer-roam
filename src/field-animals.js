import { createLeopardTree } from './leopard-tree.js';
import { leopardTreeGroundAllowed } from './leopard-tree-site.js';
import { createWolfMountain } from './wolf-mountain.js';
import { onMountainTrail, inMountainApproach } from './mountain-profile.js';
import { assetUrl } from './asset-url.js';
import { circlePointClear } from './actor-navigation.js';
import { createAnimalEncounters } from './animal-encounters.js';
import { createBullCharge, bullPointAllowed } from './bull-charge.js';
import { createAnimalInteractions } from './animal-interactions.js';
import { createCowFamily } from './cow-family.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCowBehavior, updateCowBehavior, patCow, cowRetreatTarget } from './cow-behavior.js';
import { createAnimalAnimation } from './animal-animation.js';
import { ANIMAL_PROFILES } from './animal-profiles.js';
import { inAnimalMeadow, inBullPatrol, BULL_PATROL } from './animal-meadow.js';
import { landscapeHeight, inStream } from './world-queries.js';
import { nearestRoad, isRoadSurface } from './world-base.js';
import { vehicleHitsObstacle, vehicleObstacleGap } from './vehicle-collision.js';

export const ANIMAL_LAYOUT = [
  { id: 'golden-cow', x: -25, z: 4, range: 4, speed: 0.32, scale: 0.4875 },
  { id: 'copper-cow', x: -30, z: 7, range: 4, speed: 0.28, scale: 0.4875 },
  { id: 'hornless-calf', x: -25, z: 10, range: 6, speed: 0.42, scale: 0.4875 },
  { id: 'reference-wolf', x: -29, z: 16, range: 3, speed: 0.52, scale: 0.45 },
  { id: 'baola-leopard', x: -20, z: 17, range: 2.5, speed: 0.48, scale: 0.45 },
];

// Keep a full body margin around scenery, water, vehicles and other animals.
export function animalPointAllowed(x, z, animal, obstacles, animals, car, partners = []) {
  if (!(animal.id === 'copper-cow' ? inBullPatrol(x, z) : inAnimalMeadow(x, z))) return false;
  if (
    animal.id !== 'copper-cow' &&
    !partners.includes(animal) &&
    Math.hypot(x - animal.homeX, z - animal.homeZ) > animal.range
  )
    return false;
  if (isRoadSurface(x, z) || nearestRoad(x, z).distance < 3.8 || inStream(x, z)) return false;
  if (car && Math.hypot(x - car.x, z - car.z) < animal.radius + 1.7) return false;
  if (!circlePointClear(x, z, animal.radius, obstacles, 0.35)) return false;
  return !animals.some((a) => {
    if (a === animal || partners.includes(a)) return false;
    const next = Math.hypot(x - a.x, z - a.z),
      current = Math.hypot(animal.x - a.x, animal.z - a.z);
    const separating = animal.familySeparation && a.familySeparation && next > current + 0.000001;
    return next < animal.radius + a.radius + 0.4 && !separating;
  });
}

export function collisionCarClear(x, z, a, car) {
  const margin = a.radius + 1.7,
    current = Math.hypot(a.x - car.x, a.z - car.z),
    next = Math.hypot(x - car.x, z - car.z);
  const gap = vehicleObstacleGap(car.x, car.z, car.heading, { x, z, radius: a.radius });
  const currentGap = vehicleObstacleGap(car.x, car.z, car.heading, {
    x: a.x,
    z: a.z,
    radius: a.radius,
  });
  return next >= margin
    ? gap >= 0.01
    : next > current + 0.000001 && gap >= Math.min(0.01, currentGap) - 0.000001;
}

export async function addFieldAnimals(
  scene,
  colliders,
  warnings,
  mountainAvailable = false,
  treeSite = null,
) {
  const loader = new GLTFLoader(),
    animals = [],
    staticObstacles = [...colliders];
  let obstacles = staticObstacles;
  const results = await Promise.all(
    ANIMAL_LAYOUT.map(async (config) => {
      try {
        const root = (await loader.loadAsync(assetUrl(config.id))).scene;
        return { config, root };
      } catch (error) {
        warnings.push(config.id);
        console.warn('Animal unavailable:', config.id, error);
        return null;
      }
    }),
  );
  for (const result of results) {
    if (!result) continue;
    const { config, root } = result,
      bounds = new THREE.Box3().setFromObject(root, true);
    const center = bounds.getCenter(new THREE.Vector3()),
      size = bounds.getSize(new THREE.Vector3());
    const pose = new THREE.Group(),
      group = new THREE.Group();
    root.position.set(-center.x, -bounds.min.y, -center.z);
    pose.add(root);
    group.add(pose);
    group.name = config.id;
    group.scale.setScalar(config.scale);
    scene.add(group);
    root.traverse((n) => {
      if (n.isMesh) {
        n.receiveShadow = true;
        n.castShadow = /Continuous.*body|Continuous.*head|mask head/i.test(
          n.name.replaceAll('_', ' '),
        );
      }
    });
    // Reparent complete facial assemblies with their transforms preserved.
    // GLTFLoader replaces spaces in exported names with underscores.
    const meshes = [];
    root.traverse((n) => {
      if (n.isMesh) {
        if (!n.geometry.boundingBox) n.geometry.computeBoundingBox();
        meshes.push(n);
      }
    });
    const label = (n) => n.name.replaceAll('_', ' ');
    const pivot = (name, parent, position, nodes) => {
      const joint = new THREE.Group();
      joint.name = name;
      joint.position.copy(position);
      parent.add(joint);
      group.updateMatrixWorld(true);
      for (const n of nodes) joint.attach(n);
      return joint;
    };
    const rigged = !!root.getObjectByName('FL_Upper');
    const headNodes = rigged
      ? []
      : meshes.filter((n) => !/body|hoof|paw|tail|chest bib|fur tufts/i.test(label(n)));
    const headMesh = headNodes.find((n) => /tapered head|mask head/i.test(label(n)));
    const neck = headMesh
      ? headMesh.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(0, size.y * 0.65, size.z * 0.15);
    if (headMesh) pose.worldToLocal(neck);
    neck.y -= size.y * 0.14;
    neck.z -= size.z * 0.1;
    const head = pivot('Animal_head_joint', pose, neck, headNodes);
    const tails = rigged ? [] : meshes.filter((n) => /tail/i.test(label(n)));
    const tail = pivot(
      'Animal_tail_joint',
      pose,
      new THREE.Vector3(0, size.y * 0.55, -size.z * 0.28),
      tails,
    );
    const mouths = headNodes.filter((n) =>
      /lower lip|lower chin|lower muzzle fold|mouth line|lower mouth edge/i.test(label(n)),
    );
    const muzzle = headNodes.find((n) => /ivory muzzle|icy gray muzzle/i.test(label(n)));
    const jawPosition = muzzle
      ? muzzle.getWorldPosition(new THREE.Vector3())
      : head.getWorldPosition(new THREE.Vector3());
    head.worldToLocal(jawPosition);
    jawPosition.y -= size.y * 0.055;
    jawPosition.z -= size.z * 0.06;
    const jaw = pivot('Animal_jaw_joint', head, jawPosition, mouths);
    // A very small muzzle motion accompanies the lower-mouth opening.
    const muzzleRest = muzzle
      ? { position: muzzle.position.clone(), rotation: muzzle.rotation.clone() }
      : null;
    const ears = [];
    for (const side of [-1, 1]) {
      group.updateMatrixWorld(true);
      const nodes = headNodes.filter(
        (n) =>
          /ear/i.test(label(n)) &&
          Math.sign(
            pose.worldToLocal(n.localToWorld(n.geometry.boundingBox.getCenter(new THREE.Vector3())))
              .x,
          ) === side,
      );
      if (nodes.length) {
        const earBounds = new THREE.Box3();
        for (const n of nodes) earBounds.expandByObject(n);
        const anchor = earBounds.getCenter(new THREE.Vector3());
        head.worldToLocal(anchor);
        anchor.x -= side * size.x * 0.08;
        ears.push({ side, joint: pivot('Animal_ear_joint_' + side, head, anchor, nodes) });
      }
    }
    const rig = null;
    const animal = {
      behavior: rigged ? createCowBehavior(ANIMAL_PROFILES[config.id]?.species) : null,
      rig,
      ...config,
      homeX: config.x,
      homeZ: config.z,
      x: config.x,
      z: config.z,
      radius: Math.max(0.7, (Math.hypot(size.x, size.z) * config.scale) / 2),
      group,
      pose,
      tail,
      head,
      jaw,
      jawRestY: jawPosition.y,
      ears,
      muzzle,
      muzzleRest,
      velocity: 0,
      motion: 0,
      taps: 0,
      gesture: 0,
      gestureDuration: 1,
      gestureWait: 1 + Math.random() * 4,
      gestureType: 0,
      look: 0,
      heading: -Math.PI / 2,
      target: null,
      wait: animals.length * 0.8,
      clock: animals.length * 1.7,
      distance: 0,
    };
    // Layout coordinates are on the dry meadow beyond the irrigation bank.
    if (!animalPointAllowed(animal.x, animal.z, animal, obstacles, animals, null)) {
      let found = false;
      for (let i = 0; i < 80; i++) {
        const angle = i * 2.399,
          r = Math.sqrt(i / 80) * animal.range;
        const x = animal.homeX + Math.cos(angle) * r,
          z = animal.homeZ + Math.sin(angle) * r;
        if (animalPointAllowed(x, z, animal, obstacles, animals, null)) {
          animal.x = x;
          animal.z = z;
          found = true;
          break;
        }
      }
      if (!found) {
        scene.remove(group);
        warnings.push(config.id + ' placement');
        continue;
      }
    }
    const collider = {
      x: animal.x,
      z: animal.z,
      radius: animal.radius,
      height: size.y * config.scale,
      animal: animal.id,
    };
    animal.collider = collider;
    colliders.push(collider);
    animals.push(animal);
    group.position.set(animal.x, landscapeHeight(animal.x, animal.z) + 0.025, animal.z);
    group.rotation.y = animal.heading;
    animal.source = root;
    animal.bindPose = [];
    root.traverse((n) => {
      if (n.isBone)
        animal.bindPose.push({
          bone: n,
          rotation: n.quaternion.clone(),
          position: n.position.clone(),
        });
    });
    if (rigged) animal.rig = createAnimalAnimation(root, group, ANIMAL_PROFILES[config.id]);
  }
  const family = createCowFamily(animals, (x, z, a, car, pair) =>
    animalPointAllowed(x, z, a, obstacles, animals, car, pair),
  );
  const charge = createBullCharge(
    animals,
    (x, z, a, car, contact) => bullPointAllowed(x, z, a, obstacles, animals, car, contact),
    (hit) => {
      charge.onImpact?.(hit);
    },
    () => charge.onStopVoice?.(),
  );
  const encounters = createAnimalEncounters(
    animals,
    (x, z, a, car, pair) => animalPointAllowed(x, z, a, obstacles, animals, car, pair),
    { family, charge },
  );
  const mountain = mountainAvailable
    ? createWolfMountain(animals, (x, z, a, car, trail, departing = []) => {
        if (
          trail ? !onMountainTrail(x, z, 0.55) : !(inAnimalMeadow(x, z) || inMountainApproach(x, z))
        )
          return false;
        if (isRoadSurface(x, z) || inStream(x, z) || nearestRoad(x, z).distance < 3.8) return false;
        if (car && Math.hypot(x - car.x, z - car.z) < a.radius + 1.7) return false;
        if (
          obstacles.some(
            (c) =>
              !(trail && c.mountain) && Math.hypot(x - c.x, z - c.z) < a.radius + c.radius + 0.35,
          )
        )
          return false;
        return !animals.some((b) => {
          if (b === a) return false;
          const next = Math.hypot(x - b.x, z - b.z),
            current = Math.hypot(a.x - b.x, a.z - b.z);
          return (
            next < a.radius + b.radius + 0.4 && !(departing.includes(b) && next >= current - 1e-7)
          );
        });
      })
    : null;
  const tree = treeSite
    ? createLeopardTree(animals, treeSite, (x, z, a, car, entry) =>
        leopardTreeGroundAllowed(x, z, a, obstacles, animals, car, entry),
      )
    : null;
  let sleepCar = null;
  const interactions = createAnimalInteractions({
    animals,
    family,
    charge,
    encounters,
    mountain,
    tree,
    sleepSafe: (a) => !sleepCar || Math.hypot(a.x - sleepCar.x, a.z - sleepCar.z) >= a.radius + 1.7,
  });
  const sleep = interactions.sleep;
  const owned = interactions.owns;
  const contacts = new Set();
  // At contact the ordinary car margin is already violated. Permit only outward
  // steps until clear, keeping the full scenery, meadow and animal checks.
  const escapeAllowed = (x, z, a, car) =>
    animalPointAllowed(x, z, a, obstacles, animals, null) && collisionCarClear(x, z, a, car);

  function contact(a, car, onHit) {
    const response = interactions.vehicleContact(a, car);
    if (response?.ignored) return;
    if (response?.triggered) {
      onHit({ id: a.id, response: 'revenge' });
      return;
    }
    a.recoil = null;
    a.collisionEscape = true;
    const target = cowRetreatTarget(
      a,
      car,
      (x, z) => escapeAllowed(x, z, a, car),
      [2.4, 2, 1.6, 1, 0.7],
    );
    const b = a.behavior;
    Object.assign(b, {
      reactionTime: 0,
      driveTime: target ? 8 : 0,
      alertDown: b.down,
      state: 'alert',
      time: 0,
      duration: 1.25,
      escape: target,
      swishTime: 0,
      swishStrength: 1,
      swishSide: 1,
    });
    a.target = null;
    a.wait = 1.1;
    a.velocity = 0;
    onHit({ id: a.id });
  }
  function tap(a, source, car, onTap) {
    const triggered = interactions.requestBullTap(a, car);
    onTap({ id: a.id, taps: a.taps, ...(triggered ? { charge: true } : {}) });
    if (interactions.tapFeedback(a, source, car)) return;
    const target = cowRetreatTarget(a, source, (x, z) =>
      animalPointAllowed(x, z, a, obstacles, animals, car),
    );
    if (patCow(a.behavior, target)) {
      a.collisionEscape = false;
      a.target = null;
      a.wait = 1.1;
      a.velocity = 0;
    }
  }

  return {
    animal: (id) => animals.find((a) => a.id === id),
    transportAvailable(id) {
      return interactions.canReserveTransport(animals.find((a) => a.id === id));
    },
    wakeForYield(id) {
      const a = animals.find((a) => a.id === id);
      if (a && !a.transportOwner && sleep.owns(a)) sleep.wake(a);
    },
    reserveYield(id) {
      const a = animals.find((a) => a.id === id);
      return interactions.reserveYield(a) ? a : null;
    },
    releaseYield(id) {
      return interactions.releaseYield(animals.find((a) => a.id === id));
    },
    releaseTransport(id) {
      return interactions.releaseTransport(animals.find((a) => a.id === id));
    },
    reserveTransport(id) {
      const a = animals.find((a) => a.id === id);
      if (!a || !interactions.reserveTransport(a)) return null;
      a.target = null;
      a.velocity = a.motion = 0;
      return a;
    },
    modelSource(id) {
      return animals.find((a) => a.id === id)?.pose.children[0] ?? null;
    },
    family,
    charge,
    encounters,
    interactions,
    mountain,
    tree,
    sleep,
    actionAvailability(a, action) {
      if (!animals.includes(a) || !a?.rig || !a.behavior) return '动物暂不可用';
      if (a.transportOwner) return '正在搬运或圈养中';
      if (action === 'wake') return sleep.ready(a) ? '已经站起来了' : '';
      if (action === 'tap')
        return mountain?.touchLocked(a) || tree?.touchLocked(a) ? '当前动作不能被触摸打断' : '';
      if (interactions.owns(a)) return !sleep.ready(a) ? '正在休息或起身' : '正在参与其他互动';
      if (a.behavior.state === 'alert' || a.behavior.driveTime > 0) return '正在退让，请稍候';
      return '';
    },
    touch(a, source, car, onTap = () => {}) {
      if (this.actionAvailability(a, 'tap')) return false;
      if (mountain?.owns(a)) mountain.cancelApproach();
      if (tree?.owns(a)) tree.cancelApproach();
      a.taps++;
      if (!sleep.wake(a, () => tap(a, source, car, onTap))) tap(a, source, car, onTap);
      return true;
    },
    rest(id = 'golden-cow') {
      return sleep.rest(animals.find((a) => a.id === id));
    },
    wake(id = 'golden-cow') {
      const a = animals.find((a) => a.id === id);
      return a ? sleep.wake(a) : false;
    },
    biteReaction(calf, wolf, car) {
      const target = cowRetreatTarget(
        calf,
        wolf,
        (x, z) => animalPointAllowed(x, z, calf, obstacles, animals, car),
        [1.6, 1, 0.7],
      );
      Object.assign(calf.behavior, {
        state: 'alert',
        time: 0,
        duration: 1.25,
        escape: target,
        driveTime: target ? 8 : 0,
        reactionTime: 0,
        swishTime: 0,
        swishStrength: 1,
      });
      calf.target = null;
      calf.wait = 1.1;
    },
    collide(collider, car, onHit = () => {}) {
      const a = animals.find((a) => a.collider === collider);
      if (
        !a ||
        a.transportOwner ||
        contacts.has(a) ||
        mountain?.touchLocked(a) ||
        tree?.touchLocked(a)
      )
        return false;
      contacts.add(a);
      if (!sleep.wake(a, () => contact(a, car, onHit))) contact(a, car, onHit);
      return true;
    },
    turn(id = 'golden-cow') {
      const a = animals.find((a) => a.id === id);
      if (!a?.behavior || mountain?.owns(a) || tree?.owns(a)) return;
      if (!sleep.ready(a)) {
        sleep.wake(a);
        return;
      }
      if (this.actionAvailability(a, 'turn')) return false;
      const source = { x: a.x + Math.sin(a.heading) * 2, z: a.z + Math.cos(a.heading) * 2 };
      const target = cowRetreatTarget(a, source, (x, z) =>
        animalPointAllowed(x, z, a, obstacles, animals, null),
      );
      if (target) {
        a.target = target;
        a.wait = 0;
        Object.assign(a.behavior, { state: 'walking', down: 0, raised: 0, time: 0 });
        return true;
      }
      return false;
    },
    graze(id = 'golden-cow') {
      const a = animals.find((a) => a.id === id);
      if (!a?.behavior || mountain?.owns(a) || tree?.owns(a)) return;
      if (!sleep.ready(a)) {
        sleep.wake(a);
        return;
      }
      if (this.actionAvailability(a, 'graze')) return false;
      Object.assign(a.behavior, { state: 'lowering', time: 0, duration: 1.6, down: 0, raised: 0 });
      a.target = null;
      a.velocity = 0;
      a.wait = 2;
      return true;
    },
    pat(raycaster, car, onTap = () => {}) {
      const candidates = animals.filter((a) => a.behavior && a.group.visible);
      for (const a of candidates) {
        a.group.updateWorldMatrix(true, true);
        a.group.traverse((n) => {
          if (n.isSkinnedMesh) {
            n.skeleton.update();
            n.computeBoundingSphere();
            n.computeBoundingBox();
          }
        });
      }
      const hit = raycaster.intersectObjects(
        candidates.map((a) => a.group),
        true,
      )[0];
      if (!hit) return false;
      const a = candidates.find((a) => {
        let node = hit.object;
        while (node) {
          if (node === a.group) return true;
          node = node.parent;
        }
        return false;
      });
      // Only visible geometry can be touched; scenery in front blocks the ray.
      const inFront = raycaster
        .intersectObjects(
          scene.children.filter((o) => o !== a.group && o.visible),
          true,
        )
        .find(
          (h) =>
            h.distance < hit.distance - 0.02 &&
            !h.object.isSprite &&
            h.object.material?.opacity !== 0,
        );
      if (inFront || a.transportOwner || mountain?.touchLocked(a) || tree?.touchLocked(a))
        return false;
      if (mountain?.owns(a)) mountain.cancelApproach();
      if (tree?.owns(a)) tree.cancelApproach();
      a.taps++;
      const source =
        Math.hypot(a.x - hit.point.x, a.z - hit.point.z) > 0.1 ? hit.point : raycaster.ray.origin;
      if (!sleep.wake(a, () => tap(a, source, car, onTap))) tap(a, source, car, onTap);
      return true;
    },
    snapshot: () =>
      animals.map((a) => ({
        id: a.id,
        sleep: sleep.snapshot(a),
        collisionEscape: !!a.collisionEscape,
        taps: a.taps,
        x: a.x,
        z: a.z,
        y: a.group.position.y,
        touchLocked: !!mountain?.touchLocked(a) || !!tree?.touchLocked(a),
        homeX: a.homeX,
        homeZ: a.homeZ,
        range: a.range,
        radius: a.radius,
        heading: a.heading,
        walking: !!a.target,
        visible: a.group.visible,
        scale: a.scale,
        head: a.head.rotation.toArray().slice(0, 3),
        jaw: a.jaw.rotation.x,
        tail: a.tail.rotation.toArray().slice(0, 3),
        ears: a.ears.map((e) => e.joint.rotation.z),
        reaction: a.behavior
          ? { time: a.behavior.reactionTime, driveTime: a.behavior.driveTime, recoil: !!a.recoil }
          : null,
        behavior: a.behavior
          ? {
              state: a.behavior.state,
              down: a.behavior.down,
              raised: a.behavior.raised,
              pats: a.behavior.pats,
            }
          : null,
        animation: a.rig?.snapshot(),
      })),
    update(dt, car, timeOfDay = 'day', clockDt = dt, viewer = car) {
      sleepCar = car;
      // NPCs are created after the meadow. Include their live footprints so
      // parents cannot stroll into a manually approaching/holding giant.
      obstacles = [
        ...staticObstacles,
        ...colliders.filter((c) => (c.zombie || c.woodenCart) && !staticObstacles.includes(c)),
      ];
      if (dt > 0)
        for (const a of contacts)
          if (
            !vehicleHitsObstacle(car.x, car.z, car.heading, {
              x: a.x,
              z: a.z,
              radius: a.radius + 0.25,
            })
          )
            contacts.delete(a);
      interactions.update(dt, car, timeOfDay, clockDt);
      for (const a of animals) {
        if (a.transportOwner) {
          a.group.visible = true;
          continue;
        }
        a.group.visible = Math.hypot(a.x - viewer.x, a.z - viewer.z) < 90;
        if (dt <= 0) continue;
        a.clock += dt;
        a.wait -= dt;
        if (
          a.familySeparation &&
          !animals.some(
            (b) => b !== a && Math.hypot(a.x - b.x, a.z - b.z) < a.radius + b.radius + 0.4,
          )
        )
          a.familySeparation = false;
        if (a.behavior && !owned(a)) {
          updateCowBehavior(a.behavior, dt, !!a.target);
          if (
            a.behavior.state === 'alert' &&
            a.behavior.escape &&
            a.behavior.time >= 0.35 &&
            a.behavior.down < 0.4
          ) {
            a.target = a.behavior.escape;
            a.behavior.escape = null;
            a.behavior.state = 'walking';
            a.wait = 0;
          }
          if (
            a.behavior.state === 'alert' &&
            !a.behavior.escape &&
            a.behavior.time >= a.behavior.duration
          ) {
            a.collisionEscape = false;
            a.behavior.state = 'idle';
            a.behavior.time = 0;
            a.wait = 1.5;
          }
          if (!['idle', 'walking'].includes(a.behavior.state)) a.wait = Math.max(a.wait, 0.3);
        }
        if (!owned(a) && !a.target && a.wait <= 0) {
          for (let i = 0; i < 12; i++) {
            const angle = Math.random() * Math.PI * 2,
              r = Math.sqrt(Math.random()) * a.range;
            const x =
                a.id === 'copper-cow'
                  ? BULL_PATROL.minX + Math.random() * (BULL_PATROL.maxX - BULL_PATROL.minX)
                  : a.homeX + Math.cos(angle) * r,
              z =
                a.id === 'copper-cow'
                  ? BULL_PATROL.minZ + Math.random() * (BULL_PATROL.maxZ - BULL_PATROL.minZ)
                  : a.homeZ + Math.sin(angle) * r;
            if (
              Math.hypot(x - a.x, z - a.z) > 0.6 &&
              animalPointAllowed(x, z, a, obstacles, animals, car)
            ) {
              a.target = { x, z };
              break;
            }
          }
          if (!a.target) a.wait = 1;
        }
        let moving = owned(a) && a.velocity > 0.001;
        if (a.target && !owned(a)) {
          const dx = a.target.x - a.x,
            dz = a.target.z - a.z,
            distance = Math.hypot(dx, dz);
          if (distance < 0.08) {
            a.collisionEscape = false;
            if (a.behavior) a.behavior.driveTime = 0;
            a.target = null;
            a.wait = 2 + Math.random() * 5;
          } else {
            const desired = Math.atan2(dx, dz),
              error = Math.atan2(Math.sin(desired - a.heading), Math.cos(desired - a.heading));
            a.heading += THREE.MathUtils.clamp(error, -dt * 0.9, dt * 0.9);
            const targetSpeed =
              a.speed *
              (a.behavior?.driveTime > 0
                ? ['wolf', 'leopard'].includes(ANIMAL_PROFILES[a.id]?.species)
                  ? 1.7
                  : a.id === 'hornless-calf'
                    ? 1.8
                    : 1.6
                : 1) *
              Math.min(1, distance / 0.5) *
              (a.collisionEscape ? (Math.abs(error) < 0.15 ? 1 : 0) : Math.max(0, Math.cos(error)));
            a.velocity += (targetSpeed - a.velocity) * (1 - Math.exp(-dt * 2.5));
            const step = Math.min(distance, a.velocity * dt);
            const x = a.x + Math.sin(a.heading) * step,
              z = a.z + Math.cos(a.heading) * step;
            if (
              step <= 1e-9 ||
              (a.collisionEscape
                ? escapeAllowed(x, z, a, car)
                : animalPointAllowed(x, z, a, obstacles, animals, car))
            ) {
              a.x = x;
              a.z = z;
              a.distance += step;
              moving = step > 0.0001;
            } else {
              a.collisionEscape = false;
              a.target = null;
              a.wait = 1.5;
              a.velocity = 0;
              if (a.behavior) a.behavior.driveTime = 0;
            }
          }
        }
        a.collider.x = a.x;
        a.collider.z = a.z;
        a.collider.radius =
          a.treeClimb && a.group.position.y - treeSite.group.position.y > 1.4
            ? 0
            : charge.owns(a)
              ? Math.min(a.radius, 0.43)
              : a.radius;
        if (!a.treeClimb)
          a.group.position.set(a.x, (a.supportHeight ?? landscapeHeight)(a.x, a.z) + 0.025, a.z);
        if (a.supportNormal) {
          const n = a.supportNormal(a.x, a.z),
            sin = Math.sin(a.heading),
            cos = Math.cos(a.heading);
          a.slopePitch = THREE.MathUtils.damp(
            a.slopePitch ?? 0,
            Math.atan2(n.x * sin + n.z * cos, n.y),
            8,
            dt,
          );
          a.slopeRoll = THREE.MathUtils.damp(
            a.slopeRoll ?? 0,
            Math.atan2(-n.x * cos + n.z * sin, n.y),
            8,
            dt,
          );
        } else {
          a.slopePitch = THREE.MathUtils.damp(a.slopePitch ?? 0, 0, 8, dt);
          a.slopeRoll = THREE.MathUtils.damp(a.slopeRoll ?? 0, 0, 8, dt);
        }
        if (a.treeClimb) {
          const f = treeSite.frame(a.treeClimb.s);
          const mount = a.treeClimb.mount ?? 1;
          const jumpPosition = a.treeClimb.position;
          const target = treeSite.sample(a.treeClimb.s).point.addScaledVector(f.normal, 0.025);
          if (mount < 1)
            target.lerp(
              new THREE.Vector3(
                treeSite.entry.x,
                landscapeHeight(treeSite.entry.x, treeSite.entry.z) + 0.025,
                treeSite.entry.z,
              ),
              1 - mount,
            );
          const baseOrientation = new THREE.Quaternion().setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(f.side, f.normal, f.forward),
          );
          const yawRotation = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            a.treeClimb.yaw ?? 0,
          );
          if (a.treeClimb.pivot)
            target.add(
              a.treeClimb.pivot
                .clone()
                .sub(a.treeClimb.pivot.clone().applyQuaternion(yawRotation))
                .applyQuaternion(baseOrientation)
                .multiplyScalar(a.scale),
            );
          const displacement = target.clone().sub(a.group.position);
          if (jumpPosition) a.group.position.copy(jumpPosition);
          else if (mount < 1 && !a.treeClimb.blockedStep)
            a.group.position.lerp(target, 1 - Math.exp(-dt * 12));
          else if (mount === 1) a.group.position.add(displacement.clampLength(0, dt * 0.65));
          const orientation = baseOrientation.clone().multiply(yawRotation);
          if (mount < 1)
            orientation.slerp(
              new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                treeSite.entryHeading,
              ),
              1 - mount,
            );
          if (a.treeClimb.orientation) a.group.quaternion.copy(a.treeClimb.orientation);
          else if (mount < 1 && !a.treeClimb.blockedStep)
            a.group.quaternion.slerp(orientation, 1 - Math.exp(-dt * 12));
          else if (mount === 1) a.group.quaternion.rotateTowards(orientation, dt * 1.3);
        } else a.group.rotation.set(a.slopePitch, a.heading, a.slopeRoll, 'YXZ');
        if (!moving) a.velocity *= Math.exp(-dt * 4);
        a.motion += ((moving ? 1 : 0) - a.motion) * (1 - Math.exp(-dt * 4));
        // Independent, intermittent gestures, with zero velocity at the envelope endpoints.
        if (!sleep.owns(a) && !a.treeClimb) a.gestureWait -= dt;
        if (!sleep.owns(a) && !a.treeClimb && a.gestureWait <= 0 && a.gesture === 0) {
          a.gestureDuration = 2 + Math.random() * 2.5;
          a.gesture = dt;
          a.gestureType = Math.floor(Math.random() * 3);
          a.look = (Math.random() - 0.5) * 0.22;
        }
        let envelope = 0,
          phase = 0;
        if (!sleep.owns(a) && !a.treeClimb && a.gesture > 0) {
          a.gesture += dt;
          phase = a.gesture / a.gestureDuration;
          envelope = Math.sin(Math.PI * Math.min(1, phase)) ** 2;
          if (phase >= 1) {
            a.gesture = 0;
            a.gestureWait = 2 + Math.random() * 6;
            envelope = 0;
          }
        }
        const wolf = a.id === 'reference-wolf',
          chew =
            a.gestureType === 0
              ? envelope * (0.5 + 0.5 * Math.sin(phase * Math.PI * (wolf ? 4 : 10)))
              : 0;
        if (a.rig) {
          a.pose.scale.y = 1;
          a.pose.position.y = 0;
          a.rig.update(dt, a, chew, owned(a) ? 0 : envelope);
          continue;
        }
        a.head.rotation.x =
          0.012 * Math.sin(a.clock * 0.9) + envelope * (a.gestureType === 1 ? 0.07 : 0.015);
        a.head.rotation.y = 0.018 * Math.sin(a.clock * 0.55) + a.look * envelope;
        a.head.rotation.z = 0.008 * Math.sin(a.clock * 0.7);
        a.jaw.rotation.x = (wolf ? 0.08 : 0.1) * chew;
        a.jaw.position.y = a.jawRestY - 0.012 * chew;
        if (a.muzzle) {
          a.muzzle.position.y = a.muzzleRest.position.y - 0.004 * chew;
          a.muzzle.rotation.x = a.muzzleRest.rotation.x + 0.012 * chew;
        }
        for (const ear of a.ears)
          ear.joint.rotation.z =
            ear.side *
            (0.018 * Math.sin(a.clock * 1.2) +
              (a.gestureType === 2 ? 0.1 * envelope * Math.sin(phase * Math.PI * 6) : 0));
        a.pose.scale.y = 1 + 0.002 * Math.sin(a.clock * 1.8);
        const swish = a.gestureType === 2 ? 0.22 * envelope * Math.sin(phase * Math.PI * 4) : 0;
        a.tail.rotation.z = 0.055 * Math.sin(a.clock * 1.3) + swish;
        a.tail.rotation.y = 0.06 * Math.sin(a.clock * 0.9) + swish * 0.5;
        a.pose.position.y = a.motion * 0.004 * (1 + Math.sin(a.distance * 12));
      }
    },
  };
}
