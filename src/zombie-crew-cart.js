import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from './asset-url.js';
import { createCartDriver } from './cart-passengers.js';
import { CORRAL } from './corral-model.js';
import {
  drivingHeight,
  inStream,
  isRoadSurface,
  islandDistance,
  roadPoint,
} from './world-queries.js';
import { insidePaddy } from './paddy-profile.js';
import { vehicleObstacleGap } from './vehicle-collision.js';
import { dryAnimalPoint } from './corral-navigation.js';
import { advanceCartPose, planCartPosePath, CREW_TURN_RADIUS } from './crew-cart-navigation.js';

export const CREW_CART = Object.freeze({
  cruiseSpeed: 60 / 3.6, // km/h to world metres per second
  positioningSpeed: 2.4,
  reverseSpeed: 1.2,
  wheelbase: 5.1778,
  wheelRadius: 0.46,
  turnRadius: CREW_TURN_RADIUS,
  halfWidth: 2.08,
  halfLength: 3.61,
  bedWidth: 2.6505,
  bedLength: 4.6,
  deckHeight: 0.551,
  rearZ: -3.4224,
  calfZ: -2.48,
  driverEntryZ: 2.09,
});
export const CREW_PARKING = Object.freeze({
  x: 170.25,
  z: 2,
  heading: -Math.PI / 2,
  length: 8,
  width: 5,
});

export const CREW_DOCK = Object.freeze({
  x: CORRAL.x + 0.46,
  // Leave the giant's ramp approach outside the guard's entire opening arc.
  z: CORRAL.z - CORRAL.halfZ - 9.5 + CREW_CART.rearZ,
  heading: Math.PI,
});
export const CREW_PARKING_APPROACH = Object.freeze({
  x: CREW_PARKING.x - 1 - 4.5,
  z: CREW_PARKING.z - 4.5,
  heading: Math.PI,
});

export const CREW_PARKING_ALIGN = Object.freeze({
  x: CREW_PARKING.x - 1,
  z: CREW_PARKING.z,
  heading: CREW_PARKING.heading,
  reverse: true,
  radius: 4.5,
});

export function createCrewCart(asset, zombies, colliders, ground = drivingHeight) {
  const root = new THREE.Group();
  root.name = '路锥驾驶的大僵尸与小牛木车';
  asset.traverse((mesh) => {
    if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true;
  });
  root.add(asset);
  // The bay lies left of the gate approach (+X), farther back from the gate.
  // Its opening and the cart's nose face -X, away from the island edge.
  root.position.set(CREW_PARKING.x, ground(CREW_PARKING.x, CREW_PARKING.z), CREW_PARKING.z);
  root.rotation.y = CREW_PARKING.heading;
  root.rotation.order = 'YXZ';
  const wheels = ['FL', 'FR', 'BL', 'BR'].map((id) => {
    const roll = asset.getObjectByName('wheel_' + id),
      steer = new THREE.Group();
    steer.position.copy(roll.position);
    asset.add(steer);
    steer.add(roll);
    roll.position.set(0, 0, 0);
    return { roll, steer, front: id.startsWith('F') };
  });
  const leaf = asset.getObjectByName('rear_gate_hinge');
  const boardingLeaf = asset.getObjectByName('giant_boarding_gate_hinge');
  // Open the rear end of the right wall with the tailgate, so the giant's
  // shoulder can turn on the ramp without passing through the original rail.
  const loadingSide = new THREE.Group();
  loadingSide.name = 'Rear loading side flap';
  loadingSide.position.set(0.8175 * 1.71, CREW_CART.deckHeight, 0);
  root.add(loadingSide);
  root.updateMatrixWorld(true);
  const split = -2.0;
  for (const name of ['side_panel_1', 'side_top_rail_1', 'side_bottom_rail_1']) {
    const mesh = asset.getObjectByName(name);
    const rear = mesh.clone();
    rear.name = name + '_loading_flap';
    mesh.parent.add(rear);
    root.updateMatrixWorld(true);
    const trim = (part, keepRear) => {
      const meshes = [];
      part.traverse((mesh) => {
        if (mesh.isMesh) meshes.push(mesh);
      });
      for (const mesh of meshes) {
        if (mesh !== part) {
          const box = new THREE.Box3().setFromObject(mesh, true);
          const local = new THREE.Box3();
          for (const x of [box.min.x, box.max.x])
            for (const y of [box.min.y, box.max.y])
              for (const z of [box.min.z, box.max.z])
                local.expandByPoint(root.worldToLocal(new THREE.Vector3(x, y, z)));
          if (keepRear ? local.min.z >= split : local.max.z <= split) {
            mesh.removeFromParent();
            continue;
          }
        }
        mesh.geometry = mesh.geometry.clone();
        const positions = mesh.geometry.attributes.position;
        const point = new THREE.Vector3();
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions, i);
          root.worldToLocal(mesh.localToWorld(point));
          point.z = keepRear ? Math.min(point.z, split) : Math.max(point.z, split);
          mesh.worldToLocal(root.localToWorld(point));
          positions.setXYZ(i, point.x, point.y, point.z);
        }
        positions.needsUpdate = true;
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeBoundingSphere();
      }
    };
    trim(mesh, false);
    trim(rear, true);
    loadingSide.attach(rear);
  }
  const bodies = [-2.8, -1.4, 0, 1.4, 2.8].map(() => ({
    x: 0,
    z: 0,
    radius: 1.85,
    height: 3.5,
    woodenCart: true,
  }));
  let routeSpeed = CREW_CART.cruiseSpeed,
    speed = 0,
    distance = 0,
    gate = 0,
    boardingGate = 0,
    requestedGate = false,
    route = [],
    parkingHeading = null,
    routeGoal = null,
    steering = 0,
    gear = 1,
    blocked = false,
    driver = null,
    passenger = null;
  const boards = new THREE.Group();
  root.add(boards);
  boards.name = 'Giant boarding steps';
  boards.visible = false;
  const material = asset.getObjectByName('giant_bench').material;
  for (const boardZ of [-0.65, CREW_CART.driverEntryZ])
    for (let i = 0; i < 4; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.13, 1.45), material);
      step.position.set(-1.47 - i * 0.4, 0.5 - i * 0.14, boardZ);
      step.castShadow = step.receiveShadow = true;
      boards.add(step);
    }
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.08, 3.2), material);
  ramp.name = 'Wide rear loading ramp';
  ramp.position.set(0, 0.275, -4.99);
  ramp.rotation.x = -Math.atan2(0.551, 3.15);
  ramp.castShadow = ramp.receiveShadow = true;
  ramp.visible = false;
  root.add(ramp);
  function sync() {
    root.updateMatrixWorld(true);
    for (let i = 0; i < bodies.length; i++) {
      const p = root.localToWorld(new THREE.Vector3(0, 0, (i - 2) * 1.4));
      Object.assign(bodies[i], { x: p.x, z: p.z });
    }
    for (const w of wheels) {
      const p = w.steer.getWorldPosition(new THREE.Vector3());
      w.steer.position.y += ground(p.x, p.z) + CREW_CART.wheelRadius + 0.006 - p.y;
    }
    root.updateMatrixWorld(true);
  }
  function safe(p, car) {
    const s = Math.sin(p.heading),
      c = Math.cos(p.heading);
    for (const o of colliders) {
      if (
        o.woodenCart ||
        (o.zombie === 'pvz-conehead' && zombies.actor(o.zombie)?.seated) ||
        (o.zombie === 'pvz-gargantuar' && zombies.actor(o.zombie)?.seated)
      )
        continue;
      const dx = o.x - p.x,
        dz = o.z - p.z,
        x = dx * c - dz * s,
        z = dx * s + dz * c;
      const signedGap = (lx, lz) => {
        const dx = Math.abs(lx) - CREW_CART.halfWidth,
          dz = Math.abs(lz) - CREW_CART.halfLength;
        return (
          Math.hypot(Math.max(0, dx), Math.max(0, dz)) + Math.min(0, Math.max(dx, dz)) - o.radius
        );
      };
      const gap = signedGap(x, z);
      if (gap < 0.16) {
        const heading = root.rotation.y,
          rx = o.x - root.position.x,
          rz = o.z - root.position.z;
        const before = signedGap(
          rx * Math.cos(heading) - rz * Math.sin(heading),
          rx * Math.sin(heading) + rz * Math.cos(heading),
        );
        // Existing dynamic contact may only become shallower. Static scenery
        // and newly encountered characters keep their full collision margin.
        if (!(o.animal || o.zombie) || before >= 0.16 || gap < before - 1e-7) return false;
      }
    }
    for (let i = 0; i <= 4; i++)
      for (let j = 0; j <= 8; j++) {
        const lx = CREW_CART.halfWidth * (i / 2 - 1),
          lz = CREW_CART.halfLength * (j / 4 - 1);
        const x = p.x + c * lx + s * lz,
          z = p.z - s * lx + c * lz;
        if (
          islandDistance(x, z) > -1 ||
          inStream(x, z) ||
          isRoadSurface(x, z) ||
          insidePaddy(x, z, roadPoint, 0.1)
        )
          return false;
      }
    if (car)
      for (const along of [-2.8, -1.4, 0, 1.4, 2.8])
        if (
          vehicleObstacleGap(car.x, car.z, car.heading ?? 0, {
            x: p.x + s * along,
            z: p.z + c * along,
            radius: 1.85,
          }) < 0.2
        )
          return false;
    return true;
  }
  sync();
  colliders.push(...bodies);
  const api = {
    root,
    parkingBay: createCrewParkingBay(ground),
    boards,
    cargo: null,
    world(x, y, z) {
      return root.localToWorld(new THREE.Vector3(x, y, z));
    },
    mountDriver() {
      if (driver) return;
      zombies.restore('pvz-conehead');
      const actor = zombies.mountDriver(root, 'pvz-conehead');
      driver = createCartDriver(actor.source, actor.object, {
        hipY: 1.08,
        hipZ: 1.84,
        feetZ: 2.43,
        handX: 0.25,
        handY: 1.32,
        handZ: 2.34,
      });
      actor.seatedPose = driver;
    },
    mountGiant() {
      if (passenger) return;
      zombies.restore('pvz-gargantuar');
      const actor = zombies.mountDriver(root, 'pvz-gargantuar');
      passenger = createCartDriver(actor.source, actor.object, {
        hipY: 1.16,
        hipZ: -0.3,
        feetY: 0.68,
        feetZ: 0.6,
        footX: 0.37,
        // Broad passenger silhouette: elbows out, wrists beside the torso.
        handY: 2.02,
        handZ: -0.32,
        handX: 1.02,
        armBend: [1, -0.3, -0.15],
      });
      actor.seatedPose = passenger;
    },
    releaseDriver(at) {
      zombies.releaseDriver(at, 'pvz-conehead');
      driver = null;
    },
    releaseGiant(at) {
      zombies.releaseDriver(at, 'pvz-gargantuar');
      passenger = null;
    },
    setGateOpen(open) {
      if (Math.abs(speed) > 0.02) return false;
      requestedGate = open;
      return true;
    },
    stop() {
      route = [];
      routeGoal = null;
      parkingHeading = null;
      speed = 0;
      blocked = false;
    },
    canDrivePose: (at, car) => safe(at, car),
    canPark(at, car) {
      if (!safe(at, car)) return false;
      // A parked cart must also be able to turn for its return trip. A narrow
      // pose beside a cow can fit at arrival yet trap the cart when it turns.
      if (
        !dryAnimalPoint(
          at.x,
          at.z,
          Math.hypot(CREW_CART.halfWidth, CREW_CART.halfLength) + 0.16,
          colliders,
          car,
          (c) => c.woodenCart,
        )
      )
        return false;
      for (let i = 0; i < 16; i++)
        if (!safe({ ...at, heading: (i * Math.PI) / 8 }, car)) return false;
      // Leave room for both side steps and the full rear loading ramp.
      for (const [x, z, radius] of [
        [-3.15, -0.65, 1.05],
        [-3.15, CREW_CART.driverEntryZ, 0.7],
        [0, -6.65, 1.45],
      ]) {
        const wx = at.x + Math.cos(at.heading) * x + Math.sin(at.heading) * z,
          wz = at.z - Math.sin(at.heading) * x + Math.cos(at.heading) * z;
        if (!dryAnimalPoint(wx, wz, radius, colliders, car, (c) => c.woodenCart)) return false;
      }
      return true;
    },
    routeTo(goal, car, { speed: cruiseSpeed = CREW_CART.cruiseSpeed, reverse = false } = {}) {
      const from = { x: root.position.x, z: root.position.z, heading: root.rotation.y };
      const to = {
        ...goal,
        heading:
          goal.heading ?? Math.atan2(goal.x - from.x, goal.z - from.z) + (reverse ? Math.PI : 0),
      };
      if (!safe(to, car)) return false;
      const path = planCartPosePath(from, to, (p) => safe(p, car), {
        reverse,
        radius: goal.radius ?? CREW_CART.turnRadius,
      });
      if (!path) {
        blocked = true;
        return false;
      }
      route = path;
      routeGoal = to;
      routeSpeed = reverse ? Math.min(cruiseSpeed, CREW_CART.reverseSpeed) : cruiseSpeed;
      parkingHeading = to.heading;
      blocked = false;
      return true;
    },
    arrived: () => route.length === 0 && Math.abs(speed) < 0.02 && !blocked,
    update(dt, car) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.1);
      gate = THREE.MathUtils.damp(gate, requestedGate ? 1 : 0, 6, dt);
      leaf.rotation.x = (-gate * Math.PI) / 2;
      loadingSide.rotation.z = (-gate * Math.PI) / 2;
      boardingGate = THREE.MathUtils.damp(boardingGate, boards.visible ? 1 : 0, 6, dt);
      boardingLeaf.rotation.y = (boardingGate * Math.PI) / 2;
      const steps = Math.ceil(dt / Math.min(0.025, 0.15 / Math.max(routeSpeed, 1)));
      for (let n = 0; n < steps; n++) {
        const step = dt / steps,
          segment = route[0];
        if (!segment || requestedGate || gate > 0.005 || boards.visible || boardingGate > 0.005) {
          speed = 0;
          steering = THREE.MathUtils.damp(steering, 0, 7, step);
        } else {
          const desiredSteering = Math.atan(CREW_CART.wheelbase * segment.curvature);
          steering = THREE.MathUtils.damp(steering, desiredSteering, 7, step);
          const remaining = route.reduce((sum, s) => sum + s.remaining, 0);
          const curveLimit = segment.curvature
            ? Math.sqrt(1.5 / Math.abs(segment.curvature))
            : routeSpeed;
          const nextCurve = route.slice(1).find((s) => s.curvature);
          const bendLimit =
            nextCurve && !segment.curvature
              ? Math.sqrt(1.5 / Math.abs(nextCurve.curvature) + 2 * 2.5 * segment.remaining)
              : routeSpeed;
          const target = Math.min(
            routeSpeed,
            curveLimit,
            bendLimit,
            Math.sqrt(2 * 2.5 * remaining),
          );
          // Come to rest before changing direction; steering never rotates the parked body.
          if (gear !== segment.gear && Math.abs(speed) > 0.01) {
            speed = Math.sign(speed) * Math.max(0, Math.abs(speed) - 2.5 * step);
          } else {
            gear = segment.gear;
            const magnitude = Math.abs(speed);
            speed =
              gear *
              (magnitude + THREE.MathUtils.clamp(target - magnitude, -2.5 * step, 1.8 * step));
            const move = Math.min(segment.remaining, Math.abs(speed) * step);
            const next = advanceCartPose(
              { x: root.position.x, z: root.position.z, heading: root.rotation.y },
              gear * move,
              segment.curvature,
            );
            blocked = !safe(next, car);
            if (blocked) speed = 0;
            else {
              root.position.set(next.x, ground(next.x, next.z), next.z);
              root.rotation.y = next.heading;
              distance += gear * move;
              segment.remaining -= move;
              if (segment.remaining < 1e-7) route.shift();
              if (!route.length) speed = 0;
              sync();
            }
          }
        }
        for (const w of wheels) {
          w.roll.rotation.x = distance / CREW_CART.wheelRadius;
          if (w.front) w.steer.rotation.y = steering;
        }
      }
      ramp.visible = requestedGate && gate > 0.99;
      if (!zombies.actor('pvz-conehead').transitioning) driver?.update(dt);
      if (!zombies.actor('pvz-gargantuar').transitioning) passenger?.update(dt);
    },
    snapshot: () => ({
      position: root.position.toArray(),
      heading: root.rotation.y,
      speed,
      distance,
      blocked,
      parkingHeading,
      routeGoal,
      gear,
      steering,
      parkingBay: CREW_PARKING,
      route,
      gateAmount: gate,
      gateOpen: requestedGate,
      boardingGateAmount: boardingGate,
      cargoEnclosed: !requestedGate && gate < 0.005 && !boards.visible && boardingGate < 0.005,
      bed: { length: 4.6, width: 2.6505, floor: 0.551 },
      driver: { id: 'pvz-conehead', seated: !!driver },
      passenger: { id: 'pvz-gargantuar', seated: !!passenger },
      cargo: { id: 'hornless-calf', loaded: !!api.cargo },
    }),
  };
  return api;
}

export async function addZombieCrewCart(scene, colliders, warnings, zombies) {
  try {
    const asset = (await new GLTFLoader().loadAsync(assetUrl('zombie-crew-cart'))).scene;
    const cart = createCrewCart(asset, zombies, colliders);
    scene.add(cart.root, cart.parkingBay);
    return cart;
  } catch (error) {
    warnings.push('zombie-crew-cart');
    console.warn('Crew cart unavailable', error);
    return null;
  }
}

export function createCrewParkingBay(ground = drivingHeight) {
  const bay = new THREE.Group();
  bay.name = 'Crew parking bay';
  const material = new THREE.MeshStandardMaterial({ color: '#eee6cc', roughness: 1 });
  const paint = (x, z, width, length) => {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(width, 0.018, length), material);
    const wx = CREW_PARKING.x - z,
      wz = CREW_PARKING.z + x;
    stripe.position.set(wx, ground(wx, wz) + 0.024, wz);
    stripe.rotation.y = CREW_PARKING.heading;
    stripe.receiveShadow = true;
    bay.add(stripe);
  };
  for (const side of [-1, 1]) paint((side * CREW_PARKING.width) / 2, 0, 0.12, CREW_PARKING.length);
  paint(0, -CREW_PARKING.length / 2, CREW_PARKING.width, 0.12);
  // Short entry marks and a centre guide give the parking bay a visible opening.
  for (const side of [-1, 1])
    paint((side * CREW_PARKING.width) / 2, CREW_PARKING.length / 2, 0.55, 0.12);
  paint(0, 0.8, 0.12, 1.2);
  return bay;
}
