import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { STARTING_PLATFORM } from '../../src/road-network.js';
import {
  drivingHeight,
  inStream,
  isRoadSurface,
  islandDistance,
  roadPoint,
} from '../../src/world-queries.js';
import { insidePaddy } from '../../src/paddy-profile.js';
import { vehicleObstacleGap } from '../../src/vehicle-collision.js';
import { createCartDriver, createCartCargo } from '../../src/cart-passengers.js';

export const WOOD_CART = Object.freeze({
  centerX: STARTING_PLATFORM.x + 32,
  centerZ: 10,
  patrolX: 3.8,
  patrolZ: 7,
  halfWidth: 1.1,
  halfLength: 1.99,
  wheelRadius: 0.34,
  wheelbase: 2.41,
  bedWidth: 1.55,
  bedLength: 2.5,
  deckHeight: 0.55,
});
const wheelNames = ['wheel_FL', 'wheel_FR', 'wheel_BL', 'wheel_BR'];
// Sample the full hull at the same spacing without rebuilding the grid each step.
const footprint = [];
for (let i = 0; i <= 10; i++)
  for (let j = 0; j <= 18; j++)
    footprint.push({
      x: WOOD_CART.halfWidth * ((2 * i) / 10 - 1),
      z: WOOD_CART.halfLength * ((2 * j) / 18 - 1),
    });

export function cartRoutePoint(phase) {
  return {
    x: WOOD_CART.centerX + WOOD_CART.patrolX * Math.cos(phase),
    z: WOOD_CART.centerZ + WOOD_CART.patrolZ * Math.sin(phase),
    heading: Math.atan2(-WOOD_CART.patrolX * Math.sin(phase), WOOD_CART.patrolZ * Math.cos(phase)),
  };
}

export function cartObstacleGap(p, c) {
  const dx = c.x - p.x,
    dz = c.z - p.z;
  const x = dx * Math.cos(p.heading) - dz * Math.sin(p.heading);
  const z = dx * Math.sin(p.heading) + dz * Math.cos(p.heading);
  return (
    Math.hypot(
      Math.max(0, Math.abs(x) - WOOD_CART.halfWidth),
      Math.max(0, Math.abs(z) - WOOD_CART.halfLength),
    ) - c.radius
  );
}

export function createWoodCart(
  asset,
  cowSource,
  zombies,
  colliders = [],
  groundHeight = drivingHeight,
) {
  for (const name of [...wheelNames, 'rear_gate_hinge', 'driver_socket', 'cargo_socket'])
    if (!asset.getObjectByName(name)) throw new Error(`Wood cart missing node: ${name}`);
  const root = new THREE.Group();
  root.name = 'Zombie driven wooden cattle cart';
  root.rotation.order = 'YXZ';
  root.add(asset);
  const wheels = wheelNames.map((name) => {
    const roll = asset.getObjectByName(name);
    if (
      !Number.isFinite(roll.userData.radius) ||
      Math.abs(roll.userData.radius - WOOD_CART.wheelRadius) > 1e-6
    )
      throw new Error('Wood cart wheel radius mismatch');
    const steer = new THREE.Group();
    steer.position.copy(roll.position);
    asset.add(steer);
    steer.add(roll);
    roll.position.set(0, 0, 0);
    return { roll, steer, front: name.includes('_F'), x: steer.position.x };
  });
  const gate = asset.getObjectByName('rear_gate_hinge');
  const cargo = createCartCargo(clone(cowSource), root);
  // The normal browncoat becomes this driver, instead of adding a fourth zombie.
  const rider = zombies.mountDriver(root);
  const driver = createCartDriver(rider.source, rider.object);
  rider.seatedPose = driver;
  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (mesh.isSkinnedMesh) mesh.frustumCulled = false;
  });
  let phase = Math.PI,
    speed = 0,
    distance = 0,
    clock = 0;
  let enabled = true,
    delivering = false,
    cargoReleased = false,
    blocked = false,
    gateOpen = false,
    gateAmount = 0;
  const hull = [-1.4, -0.7, 0, 0.7, 1.4].map(() => ({
    x: 0,
    z: 0,
    radius: WOOD_CART.halfWidth,
    height: 2.4,
    woodenCart: true,
  }));
  function place(p) {
    root.position.set(p.x, groundHeight(p.x, p.z) + 0.006, p.z);
    root.rotation.y = p.heading;
    // Vertical suspension keeps every wooden wheel supported on the sampled lawn.
    root.updateMatrixWorld(true);
    for (const wheel of wheels) {
      const v = wheel.steer.getWorldPosition(new THREE.Vector3());
      wheel.steer.position.y += groundHeight(v.x, v.z) + WOOD_CART.wheelRadius + 0.006 - v.y;
    }
    for (const [i, c] of hull.entries()) {
      const along = (i - 2) * 0.7;
      c.x = p.x + Math.sin(p.heading) * along;
      c.z = p.z + Math.cos(p.heading) * along;
    }
    root.updateMatrixWorld(true);
  }
  function safe(p, car) {
    if (colliders.some((c) => !c.woodenCart && cartObstacleGap(p, c) < 0.3)) return false;
    if (
      car &&
      hull.some(
        (c, i) =>
          vehicleObstacleGap(car.x, car.z, car.heading ?? 0, {
            ...c,
            x: p.x + Math.sin(p.heading) * (i - 2) * 0.7,
            z: p.z + Math.cos(p.heading) * (i - 2) * 0.7,
          }) < 0.45,
      )
    )
      return false;
    const sin = Math.sin(p.heading),
      cos = Math.cos(p.heading);
    return footprint.every((local) => {
      const x = p.x + cos * local.x + sin * local.z,
        z = p.z - sin * local.x + cos * local.z;
      return (
        islandDistance(x, z) < -2 &&
        !inStream(x, z) &&
        !isRoadSurface(x, z) &&
        !insidePaddy(x, z, roadPoint, 0.3)
      );
    });
  }
  place(cartRoutePoint(phase));
  // Publish collision bodies only after initialization succeeds.
  colliders.push(...hull);
  return {
    root,
    cargo,
    driver,
    deliveryMode(value = true) {
      delivering = value;
      enabled = !value;
    },
    unloadCargo(parent) {
      if (cargoReleased || speed > 0.02 || gateAmount < 0.99) return null;
      cargo.release(parent);
      cargoReleased = true;
      return cargo;
    },
    cargoSupportHeight(x, z) {
      const local = root.worldToLocal(new THREE.Vector3(x, root.position.y, z));
      if (Math.abs(local.x) > 0.78 || local.z < -4.8) return groundHeight(x, z);
      return groundHeight(x, z) + 0.551 * THREE.MathUtils.clamp((local.z + 4.8) / 3, 0, 1);
    },
    setCruising(value) {
      enabled = !!value;
    },
    setGateOpen(open) {
      if (speed > 0.02) return false;
      gateOpen = !!open;
      if (gateOpen) speed = 0;
      return true;
    },
    update(dt, car) {
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.1);
      const steps = Math.ceil(dt / 0.025);
      const step = dt / steps;
      for (let n = 0; n < steps; n++) {
        clock += step;
        gateAmount = THREE.MathUtils.damp(gateAmount, gateOpen ? 1 : 0, 6, step);
        gate.rotation.x = (-gateAmount * Math.PI) / 2;
        const derivative = Math.hypot(
          WOOD_CART.patrolX * Math.sin(phase),
          WOOD_CART.patrolZ * Math.cos(phase),
        );
        const curvature = (WOOD_CART.patrolX * WOOD_CART.patrolZ) / derivative ** 3;
        const target =
          enabled && !gateOpen && gateAmount < 0.005
            ? Math.min(0.9, Math.sqrt(0.22 / curvature))
            : 0;
        speed =
          gateOpen || gateAmount >= 0.005
            ? 0
            : THREE.MathUtils.damp(speed, target, target ? 1.5 : 5, step);
        const nextPhase = phase + (speed * step) / derivative;
        const next = cartRoutePoint(nextPhase);
        blocked = !safe(next, car);
        if (blocked) {
          speed = 0;
          continue;
        }
        const before = cartRoutePoint(phase);
        const moved = Math.hypot(next.x - before.x, next.z - before.z);
        const turn = Math.atan2(
          Math.sin(next.heading - before.heading),
          Math.cos(next.heading - before.heading),
        );
        phase = nextPhase % (Math.PI * 2);
        distance += moved;
        place(next);
        const steerAngle = moved > 1e-7 ? Math.atan((WOOD_CART.wheelbase * turn) / moved) : 0;
        for (const wheel of wheels) {
          if (wheel.front)
            wheel.steer.rotation.y = Math.atan2(
              WOOD_CART.wheelbase * Math.tan(steerAngle),
              WOOD_CART.wheelbase - wheel.x * Math.tan(steerAngle),
            );
          wheel.roll.rotation.x = distance / WOOD_CART.wheelRadius;
        }
      }
      if (rider.seated) driver.update(dt);
      if (!cargoReleased) cargo.update(dt);
    },
    snapshot: () => ({
      position: root.position.toArray(),
      heading: root.rotation.y,
      phase,
      speed,
      distance,
      clock,
      blocked,
      cruising: enabled,
      delivering,
      cargoReleased,
      gateOpen,
      gateAmount,
      bed: { length: WOOD_CART.bedLength, width: WOOD_CART.bedWidth, floor: WOOD_CART.deckHeight },
      driver: { id: 'pvz-browncoat', ...driver.snapshot(), seated: !!rider.seated },
      cargo: { ...cargo.snapshot(), standing: !cargoReleased, loaded: !cargoReleased },
      wheels: wheels.map((w) => ({ steer: w.steer.rotation.y, roll: w.roll.rotation.x })),
    }),
  };
}

export async function addZombieWoodCart(scene, colliders, warnings, animals, zombies) {
  try {
    const cow = animals.modelSource('copper-cow');
    if (!cow || !zombies) throw new Error('Cart requires the adult cow and zombie driver');
    const asset = (
      await new GLTFLoader().loadAsync(
        new URL('../../assets-source/zombie-wood-cart/zombie-wood-cart.glb', import.meta.url).href,
      )
    ).scene;
    const cart = createWoodCart(asset, cow, zombies, colliders);
    scene.add(cart.root);
    return cart;
  } catch (error) {
    zombies?.releaseDriver();
    warnings.push('zombie-wood-cart');
    console.warn('Wooden cattle cart could not be initialized.', error);
    return null;
  }
}
