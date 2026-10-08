import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { rescueFixture } from './helpers/rescue-fixture.mjs';
import { CREW_CART } from '../src/zombie-crew-cart.js';

const semantic = (name) => name.replace(/_0\d+$/, '');
function bone(actor, name) {
  let result;
  actor.source.traverse((node) => {
    if (!result && node.isBone && semantic(node.name) === name) result = node;
  });
  assert(result, name);
  return result;
}

function localBox(object, root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  object.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.visible) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++)
      box.expandByPoint(
        root.worldToLocal(mesh.localToWorld(mesh.getVertexPosition(i, new THREE.Vector3()))),
      );
  });
  return box;
}

function skinClearBox(actor, root, box, label) {
  root.updateMatrixWorld(true);
  actor.source.traverse((mesh) => {
    if (!mesh.isSkinnedMesh || !mesh.visible) return;
    mesh.skeleton.update();
    const points = [];
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++)
      points.push(
        root.worldToLocal(mesh.localToWorld(mesh.getVertexPosition(i, new THREE.Vector3()))),
      );
    const index = mesh.geometry.index;
    for (let i = 0; i < (index?.count ?? points.length); i += 3) {
      const triangle = new THREE.Triangle(
        ...[0, 1, 2].map((j) => points[index ? index.getX(i + j) : i + j]),
      );
      assert(!box.intersectsTriangle(triangle), `${actor.layout.id} skin crosses ${label}`);
    }
  });
}

function seatContact(actor, root, seat) {
  const box = localBox(seat, root);
  let lowest = Infinity;
  actor.source.traverse((mesh) => {
    if (!mesh.isSkinnedMesh || !mesh.visible) return;
    mesh.skeleton.update();
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      const p = root.worldToLocal(
        mesh.localToWorld(mesh.getVertexPosition(i, new THREE.Vector3())),
      );
      if (p.x > box.min.x && p.x < box.max.x && p.z > box.min.z && p.z < box.max.z)
        lowest = Math.min(lowest, p.y);
    }
  });
  const gap = lowest - box.max.y;
  assert(gap > -0.003 && gap < 0.018, `seat contact gap: ${gap}`);
  skinClearBox(actor, root, box.clone().expandByScalar(-0.005), seat.name);
  return gap;
}

test('farm cart keeps both seated faces visible and puts the real driver hands on its steering rim', async () => {
  const f = await rescueFixture(() => 0.9, { withHeist: true });
  f.cart.mountDriver();
  f.cart.mountGiant();
  const root = f.cart.root,
    asset = root.children[0],
    rim = asset.getObjectByName('driver_steering_wheel'),
    hood = asset.getObjectByName('farm_low_bonnet'),
    driver = f.zombies.actor('pvz-conehead');
  const rimVertices = [];
  root.updateMatrixWorld(true);
  for (let i = 0; i < rim.geometry.attributes.position.count; i++)
    rimVertices.push(rim.localToWorld(rim.getVertexPosition(i, new THREE.Vector3())));
  const handGaps = ['LeftHand', 'RightHand'].map((name) => {
    const hand = bone(driver, name).getWorldPosition(new THREE.Vector3());
    return Math.min(...rimVertices.map((p) => p.distanceTo(hand)));
  });
  assert(
    handGaps.every((gap) => gap < 0.055),
    JSON.stringify(handGaps),
  );
  assert(localBox(hood, root).max.y < 1.15, 'Bonnet must stay below the driver face');
  const hoodBox = localBox(hood, root);
  assert(hoodBox.getSize(new THREE.Vector3()).z > 0.7, 'Bonnet needs real depth');
  skinClearBox(driver, root, hoodBox, hood.name);
  const giantSeat = asset.getObjectByName('giant_bench');
  const seatSize = localBox(giantSeat, root).getSize(new THREE.Vector3());
  assert(
    seatSize.x > 2.2 && seatSize.z > 0.55 && seatSize.y < 0.14,
    'Giant needs a horizontal bench',
  );
  const seatGaps = [
    seatContact(driver, root, asset.getObjectByName('driver_seat_cushion')),
    seatContact(f.zombies.actor('pvz-gargantuar'), root, giantSeat),
  ];
  for (const name of ['side_panel_-1_boarding_gate', 'side_top_rail_-1_boarding_gate'])
    skinClearBox(
      f.zombies.actor('pvz-gargantuar'),
      root,
      localBox(asset.getObjectByName(name), root),
      name,
    );
  const visibleFaces = [];
  for (const id of ['pvz-conehead', 'pvz-gargantuar']) {
    const actor = f.zombies.actor(id);
    const head = root.worldToLocal(bone(actor, 'Head').getWorldPosition(new THREE.Vector3()));
    for (const eye of [
      [-7, 3.9, 7.6],
      [-9, 3.4, 0],
      [0, 2.8, 10],
    ]) {
      for (const dx of [-0.08, 0, 0.08]) {
        const target = root.localToWorld(head.clone().add(new THREE.Vector3(dx, 0.16, 0.1))),
          origin = root.localToWorld(new THREE.Vector3(...eye)),
          ray = new THREE.Raycaster(origin, target.clone().sub(origin).normalize());
        ray.far = origin.distanceTo(target) - 0.01;
        assert.equal(ray.intersectObject(asset, true).length, 0, `${id}: blocked face from ${eye}`);
      }
    }
    visibleFaces.push({ id, head: head.toArray() });
  }
  const bytes = readFileSync(new URL('../src/assets/models/zombie-crew-cart.glb', import.meta.url));
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert(json.images.every((image) => Number.isInteger(image.bufferView)));
  assert(json.materials.some((m) => m.name === 'Charcoal rubber tyre'));
  assert(json.materials.some((m) => m.name === 'Muted olive painted steel'));
  mkdirSync(new URL('../output/zombie-farm-cart/', import.meta.url), { recursive: true });
  writeFileSync(
    new URL('../output/zombie-farm-cart/visibility-validation.json', import.meta.url),
    JSON.stringify({ handGaps, seatGaps, visibleFaces, glbBytes: bytes.length }, null, 2),
  );
});

test('driver walks in and out through the visible doorway behind the front wheel without crossing its fender', async () => {
  const f = await rescueFixture(() => 0.9, { withHeist: true });
  const root = f.cart.root,
    actor = f.zombies.actor('pvz-conehead'),
    asset = root.children[0],
    entryZ = CREW_CART.driverEntryZ;
  for (const name of [
    'driver_fixed_step_upper_-1',
    'driver_fixed_step_lower_-1',
    'driver_entry_sill_-1',
  ])
    assert(asset.getObjectByName(name)?.visible, name);
  const fender = localBox(asset.getObjectByName('farm_fender_FR'), root),
    partition = localBox(asset.getObjectByName('cargo_front_partition'), root),
    cap = localBox(asset.getObjectByName('partition_top_cap'), root);
  assert(entryZ > partition.max.z + 0.35 && entryZ < fender.min.z - 0.35);
  const ground = (x, z) => {
    const p = root.worldToLocal(new THREE.Vector3(x, root.position.y, z));
    return root.position.y + THREE.MathUtils.clamp((p.x + 3.05) / 1.7, 0, 1) * CREW_CART.deckHeight;
  };
  const start = f.cart.world(-2.9, 0, entryZ),
    end = f.cart.world(-0.8, CREW_CART.deckHeight, entryZ);
  actor.object.position.copy(start);
  actor.object.rotation.set(0, root.rotation.y + Math.PI / 2, 0, 'YXZ');
  f.zombies.rebind(actor.layout.id);
  let samples = 0;
  for (const target of [end, start]) {
    let arrived = false;
    for (let i = 0; i < 240 && !arrived; i++) {
      arrived = f.zombies.walk(actor.layout.id, target, 1 / 30, {
        speed: 1.1,
        car: f.car,
        ground,
        ignore: (c) => c.woodenCart,
      });
      if (i % 4 === 0) {
        skinClearBox(actor, root, fender, 'front fender at doorway');
        skinClearBox(actor, root, partition, 'cargo partition at doorway');
        skinClearBox(actor, root, cap, 'partition cap at doorway');
        samples++;
      }
    }
    assert(arrived, 'Driver must reach the doorway and return to the ground');
  }
  assert(samples > 20);
});

test('larger rubber wheels stay inside the navigation footprint at full steering and roll by their actual radius', async () => {
  const f = await rescueFixture();
  const cart = f.cart,
    root = cart.root,
    asset = root.children[0];
  for (const id of ['FL', 'FR', 'BL', 'BR']) {
    const wheel = asset.getObjectByName('wheel_' + id);
    assert(Math.abs(wheel.userData.radius - CREW_CART.wheelRadius) < 1e-6);
    const straight = localBox(wheel, root);
    assert(Math.abs(straight.getSize(new THREE.Vector3()).y / 2 - CREW_CART.wheelRadius) < 0.005);
    if (id.startsWith('F')) {
      for (const angle of [
        -Math.atan(CREW_CART.wheelbase / 4.5),
        Math.atan(CREW_CART.wheelbase / 4.5),
      ]) {
        wheel.parent.rotation.y = angle;
        const box = localBox(wheel, root);
        assert(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) < CREW_CART.halfWidth);
      }
      wheel.parent.rotation.y = 0;
    }
  }
  assert(cart.routeTo({ x: 160, z: 2, heading: -Math.PI / 2 }, f.car));
  for (let i = 0; i < 40; i++) cart.update(0.1, f.car);
  assert(cart.snapshot().distance > 0.5);
  for (const id of ['FL', 'FR', 'BL', 'BR'])
    assert(
      Math.abs(
        asset.getObjectByName('wheel_' + id).rotation.x -
          cart.snapshot().distance / CREW_CART.wheelRadius,
      ) < 1e-8,
    );
});

test('iron straps and rivets on the rear side fold with the tailgate and preserve the loading passage', async () => {
  const f = await rescueFixture();
  const root = f.cart.root,
    flap = root.getObjectByName('Rear loading side flap'),
    leaf = root.getObjectByName('rear_gate_hinge');
  assert(leaf.getObjectByName('tail_lamp_-1'));
  assert(leaf.getObjectByName('tail_lamp_1'));
  const fittings = [];
  flap.traverse((node) => {
    if (node.isMesh && node.name.startsWith('bed_iron_strap')) fittings.push(node);
  });
  assert(fittings.length > 0);
  f.cart.setGateOpen(true);
  for (let i = 0; i < 25; i++) f.cart.update(0.1, f.car);
  assert(f.cart.snapshot().gateAmount > 0.999);
  const rear = localBox(flap, root);
  // The original thick top rail becomes a flat plank outside the cargo bay.
  assert(rear.min.x > CREW_CART.bedWidth / 2, JSON.stringify(rear));
  assert(rear.max.y < CREW_CART.deckHeight + 0.13, JSON.stringify(rear));
  for (const fitting of fittings)
    assert(localBox(fitting, root).max.y < CREW_CART.deckHeight + 0.01);
  const paused = flap.rotation.z;
  f.cart.update(0, f.car);
  assert.equal(flap.rotation.z, paused);
  f.cart.setGateOpen(false);
  for (let i = 0; i < 25; i++) f.cart.update(0.1, f.car);
  assert(f.cart.snapshot().gateAmount < 0.001);
});

test('closed boarding gate completes the calf enclosure and the cart waits for it to latch before driving', async () => {
  const f = await rescueFixture(() => 0.9, { withHeist: true });
  const root = f.cart.root,
    asset = root.children[0];
  f.cart.mountDriver();
  f.cart.mountGiant();
  const panels = [];
  root.traverse((mesh) => {
    if (mesh.isMesh && mesh.name.startsWith('side_panel_')) panels.push(mesh);
  });
  root.updateMatrixWorld(true);
  for (const side of [-1, 1])
    for (let z = -3.24; z < 1.29; z += 0.1) {
      const origin = root.localToWorld(new THREE.Vector3(0, 0.86, z)),
        direction = new THREE.Vector3(side, 0, 0).transformDirection(root.matrixWorld),
        ray = new THREE.Raycaster(origin, direction, 0, 1.6);
      assert(ray.intersectObjects(panels, false).length > 0, `Open cargo side at ${side}, ${z}`);
    }
  assert(f.cart.snapshot().cargoEnclosed);
  const door = asset.getObjectByName('giant_boarding_gate_hinge');
  f.cart.boards.visible = true;
  for (let i = 0; i < 15; i++) f.cart.update(0.1, f.car);
  assert(f.cart.snapshot().boardingGateAmount > 0.999);
  const before = door.quaternion.toArray();
  f.cart.update(0, f.car);
  assert.deepEqual(door.quaternion.toArray(), before);
  assert(f.cart.routeTo({ x: 160, z: 2, heading: -Math.PI / 2 }, f.car));
  const distance = f.cart.snapshot().distance;
  f.cart.update(0.1, f.car);
  assert.equal(f.cart.snapshot().distance, distance, 'Open doorway must prevent driving');
  f.cart.boards.visible = false;
  for (let i = 0; i < 8; i++) {
    f.cart.update(0.1, f.car);
    if (f.cart.snapshot().boardingGateAmount > 0.005)
      assert.equal(f.cart.snapshot().distance, distance, 'Wait until the doorway closes');
  }
  for (let i = 0; i < 15; i++) f.cart.update(0.1, f.car);
  assert(f.cart.snapshot().cargoEnclosed);
  assert(f.cart.snapshot().distance > distance);
});
