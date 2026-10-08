import { loadModel as load } from './helpers/model-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { createZombieController } from '../src/field-zombies.js';
import {
  createWoodCart,
  WOOD_CART,
  cartRoutePoint,
  cartObstacleGap,
  addZombieWoodCart,
} from './compatibility/zombie-wood-cart.js';
import { createCartCargo } from '../src/cart-passengers.js';
import { STARTING_PLATFORM } from '../src/road-network.js';
import { drivingHeight } from '../src/world-queries.js';

const cowIds = ['golden-cow', 'copper-cow', 'hornless-calf'];

async function fixture() {
  const sources = new Map();
  for (const id of ['pvz-browncoat', 'pvz-conehead', 'pvz-gargantuar'])
    sources.set(id, await load(`models/pvz-zombies/${id}.glb`));
  const colliders = [];
  const zombies = createZombieController(sources, colliders);
  const asset = await load('models/zombie-wood-cart.glb');
  const cow = await load('models/copper-cow/copper-cow-rigged.glb');
  const cart = createWoodCart(asset, cow, zombies, colliders);
  return { cart, zombies, colliders, asset, cow };
}
function localBounds(object, parent) {
  parent.updateMatrixWorld(true);
  const box = new THREE.Box3();
  object.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const vertex = new THREE.Vector3();
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, vertex);
      box.expandByPoint(parent.worldToLocal(mesh.localToWorld(vertex)));
    }
  });
  return box;
}
const boneState = (root) => {
  const values = [];
  root.traverse((node) => {
    if (node.isBone)
      values.push([node.name, ...node.quaternion.toArray(), ...node.position.toArray()]);
  });
  return values;
};

test('shipped wooden GLB has embedded wood maps, full rear gate, sockets and rolling pivots', async () => {
  const bytes = readFileSync(
    new URL('../assets-source/zombie-wood-cart/zombie-wood-cart.glb', import.meta.url),
  );
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert.equal(json.images.length, 2);
  assert(json.images.every((i) => i.bufferView !== undefined && !i.uri));
  assert(!json.cameras?.length);
  const asset = await load('models/zombie-wood-cart.glb');
  const size = new THREE.Box3().setFromObject(asset, true).getSize(new THREE.Vector3());
  assert(size.z > 3.8 && size.z < 4);
  assert(size.x > 2 && size.x < 2.3);
  const gate = asset.getObjectByName('rear_gate_hinge');
  assert(gate.getObjectByName('rear_gate_panel'));
  assert.equal(gate.userData.closedAngle, 0);
  for (const name of [
    'driver_socket',
    'cargo_socket',
    'wheel_FL',
    'wheel_FR',
    'wheel_BL',
    'wheel_BR',
  ])
    assert(asset.getObjectByName(name), name);
  asset.updateMatrixWorld(true);
  for (const name of ['wheel_FL', 'wheel_FR', 'wheel_BL', 'wheel_BR']) {
    const wheel = asset.getObjectByName(name);
    const box = new THREE.Box3().setFromObject(wheel, true);
    assert(Math.abs(box.getCenter(new THREE.Vector3()).y - wheel.position.y) < 1e-5);
    assert(Math.abs(box.min.y) < 1e-5);
    assert(Math.abs(wheel.userData.radius - WOOD_CART.wheelRadius) < 1e-6);
  }
});

test('every full-size cow fits, including a real skin cloned from its transformed meadow parent', async () => {
  for (const id of cowIds) {
    const source = await load(`models/${id}/${id}-rigged.glb`);
    const original = new THREE.Group();
    original.position.set(-28, 0.64, 8);
    original.scale.setScalar(0.4875);
    original.rotation.y = -Math.PI / 2;
    const bounds = new THREE.Box3().setFromObject(source, true);
    const center = bounds.getCenter(new THREE.Vector3());
    source.position.set(-center.x, -bounds.min.y, -center.z);
    original.add(source);
    original.updateMatrixWorld(true);
    const originalState = boneState(original);
    const parent = new THREE.Group();
    const cargo = createCartCargo(clone(source), parent);
    for (let frame = 0; frame <= 240; frame++) {
      parent.position.set(158 + frame * 0.01, 0.13, 10);
      parent.rotation.y = frame * 0.015;
      cargo.update(1 / 60);
      if (frame % 30 !== 0) continue;
      const box = localBounds(cargo.group, parent);
      assert(box.min.x >= -0.775 + 0.1 && box.max.x <= 0.775 - 0.1, id + ' side margin');
      assert(box.min.z > -1.8 + 0.1 && box.max.z < 0.7 - 0.1, id + ' head/tail margin');
      assert(Math.abs(box.min.y - 0.551) < 0.001, id + ' hooves planted on bed');
    }
    assert.deepEqual(boneState(original), originalState);
    assert.equal(cargo.snapshot().scale, 0.4875);
    const before = boneState(cargo.group),
      snap = cargo.snapshot();
    cargo.update(0);
    assert.deepEqual(boneState(cargo.group), before);
    assert.deepEqual(cargo.snapshot(), snap);
  }
});

test('original zombie drives a complete circuit, with synchronized sitting skins, supported wheels and frozen pause', async () => {
  const { cart, zombies, colliders } = await fixture();
  assert.equal(zombies.snapshot().zombies.length, 3);
  assert(zombies.snapshot().zombies[0].seated);
  assert.equal(colliders.filter((c) => c.zombie).length, 2);
  const driver = cart.root.getObjectByName('普通僵尸');
  const feet = ['LeftFoot', 'RightFoot'].map((name) => {
    let bone;
    driver.traverse((n) => {
      if (n.isBone && n.name.replace(/_0\d+$/, '') === name && !bone) bone = n;
    });
    return bone;
  });
  const positions = new Set();
  let maxSteer = 0;
  for (let frame = 0; frame < 60 * 65; frame++) {
    zombies.update(1 / 60, STARTING_PLATFORM);
    cart.update(1 / 60, STARTING_PLATFORM);
    const s = cart.snapshot();
    assert(!s.blocked, 'approved local lawn circuit stays clear');
    assert(s.speed >= 0 && s.speed <= 0.91);
    positions.add(`${Math.round(s.position[0])},${Math.round(s.position[2])}`);
    maxSteer = Math.max(maxSteer, Math.abs(s.wheels[0].steer));
    if (frame % 120 !== 0) continue;
    for (const foot of feet) {
      const p = cart.root.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
      assert(Math.abs(p.y - 0.68) < 1e-5);
      assert(Math.abs(p.z - 1.5) < 1e-5);
    }
    const copies = new Map();
    driver.traverse((n) => {
      if (!n.isBone) return;
      const key = n.name.replace(/_0\d+$/, '');
      if (copies.has(key))
        assert(copies.get(key).angleTo(n.quaternion) < 1e-6, key + ' duplicated skin');
      else copies.set(key, n.quaternion.clone());
    });
    const cargo = localBounds(cart.cargo.group, cart.root);
    assert(cargo.min.x > -0.775 && cargo.max.x < 0.775);
    assert(cargo.min.z > -1.8 && cargo.max.z < 0.7);
    assert(Math.abs(cargo.min.y - 0.551) < 1e-5);
    for (const wheel of cart.root.children[0].children.filter((c) =>
      c.children.some((n) => /^wheel_[FB][LR]$/.test(n.name)),
    )) {
      const p = wheel.getWorldPosition(new THREE.Vector3());
      assert(Math.abs(p.y - WOOD_CART.wheelRadius - drivingHeight(p.x, p.z) - 0.006) < 1e-6);
    }
  }
  assert(positions.size > 25);
  assert(cart.snapshot().distance > 45);
  assert(maxSteer > 0.2);
  const snap = cart.snapshot(),
    pose = boneState(cart.root);
  cart.update(0, STARTING_PLATFORM);
  assert.deepEqual(cart.snapshot(), snap);
  assert.deepEqual(boneState(cart.root), pose);
  mkdirSync(new URL('../output/zombie-wood-cart/', import.meta.url), { recursive: true });
  writeFileSync(
    new URL('../output/zombie-wood-cart/runtime-validation.json', import.meta.url),
    JSON.stringify(
      {
        circuitSeconds: 65,
        distance: snap.distance,
        visitedCells: positions.size,
        maxSteer,
        cargoFits: true,
        pauseFrozen: true,
      },
      null,
      2,
    ),
  );
});

test('obstacle and player car stop the cart; gate only opens parked and prevents driving until latched', async () => {
  const { cart, colliders } = await fixture();
  for (let i = 0; i < 90; i++) cart.update(1 / 60, STARTING_PLATFORM);
  assert(!cart.setGateOpen(true), 'cannot open while moving');
  const s = cart.snapshot();
  const obstacle = {
    x: s.position[0] + Math.sin(s.heading) * 1.9,
    z: s.position[2] + Math.cos(s.heading) * 1.9,
    radius: 0.4,
  };
  colliders.push(obstacle);
  cart.update(1 / 60, STARTING_PLATFORM);
  assert(cart.snapshot().blocked);
  assert.equal(cart.snapshot().speed, 0);
  const distance = cart.snapshot().distance;
  for (let i = 0; i < 30; i++) cart.update(1 / 60, STARTING_PLATFORM);
  assert.equal(cart.snapshot().distance, distance);
  colliders.splice(colliders.indexOf(obstacle), 1);
  const player = { x: s.position[0], z: s.position[2], heading: s.heading };
  cart.update(1 / 60, player);
  assert(cart.snapshot().blocked);
  assert.equal(cart.snapshot().distance, distance);
  assert(cart.setGateOpen(true));
  for (let i = 0; i < 120; i++) cart.update(1 / 60, STARTING_PLATFORM);
  assert(cart.snapshot().gateAmount > 0.99);
  assert.equal(cart.snapshot().distance, distance);
  assert(cart.setGateOpen(false));
  for (let i = 0; i < 120; i++) cart.update(1 / 60, STARTING_PLATFORM);
  assert(cart.snapshot().gateAmount < 0.005);
  assert(cart.snapshot().distance > distance + 0.5);
  cart.setCruising(false);
  for (let i = 0; i < 120; i++) cart.update(1 / 60, STARTING_PLATFORM);
  assert(cart.setGateOpen(true));
  const parkedDistance = cart.snapshot().distance;
  for (let i = 0; i < 60; i++) cart.update(1 / 60, STARTING_PLATFORM);
  assert.equal(cart.snapshot().speed, 0);
  assert.equal(cart.snapshot().distance, parkedDistance, 'open gate cannot coast forward');
  for (const phase of [0, 1, 2, 3, 4, 5])
    assert(cartObstacleGap(cartRoutePoint(phase), { x: 132, z: 10, radius: 1.7 }) > 15);
});

test('failed model loading preserves the three original zombies and reports a warning', async () => {
  const { zombies, cow } = await fixture();
  zombies.releaseDriver();
  const warnings = [],
    colliders = [];
  const original = GLTFLoader.prototype.loadAsync;
  const warn = console.warn;
  GLTFLoader.prototype.loadAsync = async () => {
    throw new Error('Missing cart GLB');
  };
  console.warn = () => {};
  try {
    const cart = await addZombieWoodCart(
      new THREE.Scene(),
      colliders,
      warnings,
      { modelSource: () => cow },
      zombies,
    );
    assert.equal(cart, null);
    assert.deepEqual(warnings, ['zombie-wood-cart']);
    assert(!zombies.snapshot().zombies.some((z) => z.seated));
  } finally {
    GLTFLoader.prototype.loadAsync = original;
    console.warn = warn;
  }
});

test('failed driver setup restores the walker without leaving cart collision bodies', async () => {
  const { zombies, cow, colliders } = await fixture();
  zombies.releaseDriver();
  // Use an untouched model for initialization, after the successful fixture is discarded.
  const cartAsset = await load('models/zombie-wood-cart.glb');
  colliders.splice(0, colliders.length, ...colliders.filter((c) => c.zombie));
  const original = GLTFLoader.prototype.loadAsync;
  const warn = console.warn;
  GLTFLoader.prototype.loadAsync = async () => ({ scene: cartAsset });
  console.warn = () => {};
  const warnings = [];
  const scene = new THREE.Scene();
  try {
    const cart = await addZombieWoodCart(
      scene,
      colliders,
      warnings,
      { modelSource: () => cow },
      {
        mountDriver(parent) {
          zombies.mountDriver(parent);
          throw new Error('Invalid seated rig');
        },
        releaseDriver: () => zombies.releaseDriver(),
      },
    );
    assert.equal(cart, null);
    assert.deepEqual(warnings, ['zombie-wood-cart']);
    assert.equal(scene.children.length, 0);
    assert.equal(colliders.length, 3);
    assert(!colliders.some((c) => c.woodenCart));
    assert(!zombies.snapshot().zombies.some((z) => z.seated));
    assert.equal(zombies.root.children.length, 3);
    zombies.update(1 / 60, STARTING_PLATFORM);
    assert(zombies.snapshot().zombies.every((z) => Number.isFinite(z.position[0])));
  } finally {
    GLTFLoader.prototype.loadAsync = original;
    console.warn = warn;
  }
});
