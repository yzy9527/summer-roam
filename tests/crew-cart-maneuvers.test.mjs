import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rescueFixture } from './helpers/rescue-fixture.mjs';
import { CORRAL } from '../src/corral-model.js';
import {
  CREW_CART,
  CREW_PARKING,
  CREW_DOCK,
  CREW_PARKING_APPROACH,
  CREW_PARKING_ALIGN,
} from '../src/zombie-crew-cart.js';

test('real crew cart follows arcs, reverses to unload, and reverses into its marked home bay', async () => {
  const f = await rescueFixture();
  const cart = f.cart;
  assert(cart.root.position.x > 164);
  assert.equal(cart.root.rotation.y, CREW_PARKING.heading);
  assert.equal(cart.parkingBay.children.length, 6);
  cart.mountDriver();
  cart.mountGiant();
  const goals = [
    { x: 160, z: CREW_PARKING.z, heading: CREW_PARKING.heading },
    { x: 146, z: -27, heading: -Math.PI / 2 },
    { x: -26, z: -27, heading: -Math.PI / 2 },
    { x: -29, z: -12, heading: 0 },
    { x: -29, z: -16, heading: 0, reverse: true },
    { x: -18, z: -16, heading: Math.PI },
    { x: -26, z: -27, heading: Math.PI / 2 },
    { x: 148, z: -27, heading: Math.PI / 2 },
    { x: 158, z: 3, heading: 0 },
    { x: 169, z: 3, heading: Math.PI },
    { x: CREW_DOCK.x, z: -8, heading: Math.PI },
    { ...CREW_DOCK, reverse: true },
    { ...CREW_PARKING_APPROACH, z: CREW_PARKING_APPROACH.z - 7.5 },
    { ...CREW_PARKING_APPROACH, reverse: true },
    { ...CREW_PARKING_ALIGN },
    { ...CREW_PARKING, reverse: true },
  ];
  let sawArc = false,
    sawReverse = false;
  for (const goal of goals) {
    assert(cart.routeTo(goal, f.car, { reverse: !!goal.reverse }), JSON.stringify(goal));
    for (let i = 0; i < 1500 && !cart.arrived(); i++) {
      const previous = cart.snapshot();
      cart.update(0.1, f.car);
      const next = cart.snapshot();
      const travel = Math.hypot(
        next.position[0] - previous.position[0],
        next.position[2] - previous.position[2],
      );
      const yaw = Math.abs(
        Math.atan2(
          Math.sin(next.heading - previous.heading),
          Math.cos(next.heading - previous.heading),
        ),
      );
      assert(!next.blocked, JSON.stringify({ goal, next }));
      if (travel < 1e-9) assert(yaw < 1e-9, 'A stationary vehicle must never rotate its body');
      else assert(yaw / travel < 1 / (goal.radius ?? CREW_CART.turnRadius) + 0.001);
      assert(
        Math.abs(next.speed) <=
          (goal.reverse ? CREW_CART.reverseSpeed : CREW_CART.cruiseSpeed) + 1e-6,
      );
      sawArc ||= yaw > 0.001;
      sawReverse ||= next.speed < -0.01;
      const frozen = JSON.stringify(next);
      cart.update(0, f.car);
      assert.equal(JSON.stringify(cart.snapshot()), frozen);
    }
    assert(cart.arrived(), JSON.stringify({ goal, state: cart.snapshot() }));
    assert(Math.hypot(cart.root.position.x - goal.x, cart.root.position.z - goal.z) < 0.001);
  }
  assert(sawArc && sawReverse);
  assert.equal(cart.snapshot().gear, -1);
  assert(
    Math.abs(
      Math.atan2(
        Math.sin(cart.root.rotation.y - CREW_PARKING.heading),
        Math.cos(cart.root.rotation.y - CREW_PARKING.heading),
      ),
    ) < 0.001,
  );
});

test('the cart refuses an obstructed reverse parking route', async () => {
  const f = await rescueFixture();
  f.cart.mountDriver();
  f.cart.mountGiant();
  f.cart.root.position.set(CREW_PARKING_APPROACH.x, 0, CREW_PARKING_APPROACH.z);
  f.cart.root.rotation.y = CREW_PARKING_APPROACH.heading;
  f.colliders.push({ x: CREW_PARKING.x, z: CREW_PARKING.z, radius: 0.6 });
  const before = f.cart.root.position.clone();
  assert(!f.cart.routeTo(CREW_PARKING, f.car, { reverse: true }));
  f.cart.update(0.1, f.car);
  assert(f.cart.root.position.distanceTo(before) < 1e-8);
});

test('the rearward bay faces its opening and the unloading ramp clears the entire gate swing', async () => {
  const f = await rescueFixture(),
    cart = f.cart;
  const stripes = cart.parkingBay.children,
    back = stripes.find((s) => s.geometry.parameters.width === CREW_PARKING.width),
    entries = stripes.filter((s) => s.geometry.parameters.width === 0.55),
    centre = cart.root.position,
    nose = cart.world(0, 0, 1).sub(centre).setY(0).normalize();
  assert(back.position.clone().sub(centre).setY(0).dot(nose) < 0);
  for (const entry of entries) assert(entry.position.clone().sub(centre).setY(0).dot(nose) > 0);
  const bayBounds = new THREE.Box3().setFromObject(cart.parkingBay);
  assert(bayBounds.min.x > CORRAL.x + CORRAL.gateWidth / 2, 'Bay overlaps the gate approach');
  assert(bayBounds.max.z < 8, 'Bay must move behind the old starting position');

  cart.root.position.set(CREW_DOCK.x, centre.y, CREW_DOCK.z);
  cart.root.rotation.y = CREW_DOCK.heading;
  cart.mountDriver();
  cart.mountGiant();
  cart.setGateOpen(true);
  for (let i = 0; i < 30; i++) cart.update(0.1, f.car);
  const ramp = cart.root.getObjectByName('Wide rear loading ramp'),
    rampBounds = new THREE.Box3().setFromObject(ramp),
    model = f.corral.model;
  assert(Math.abs(CORRAL.z - CORRAL.halfZ - cart.world(0, 0, CREW_CART.rearZ).z - 9.5) < 1e-6);
  for (let i = 0; i <= 40; i++) {
    model.setAmount(i / 40);
    assert(cart.canDrivePose(CREW_DOCK, f.car), `Gate obstructs vehicle at ${i / 40}`);
    assert(!new THREE.Box3().setFromObject(model.gate).intersectsBox(rampBounds), 'Gate hits ramp');
    const operator = model.operatorPoint(i / 40),
      gap = Math.hypot(
        Math.max(rampBounds.min.x - operator.x, 0, operator.x - rampBounds.max.x),
        Math.max(rampBounds.min.z - operator.z, 0, operator.z - rampBounds.max.z),
      );
    assert(gap > 0.82, 'Ramp blocks gatekeeper throughout gate operation');
    const giantApproach = cart.world(0, 0, -6.65);
    assert(
      Math.hypot(giantApproach.x - operator.x, giantApproach.z - operator.z) >
        f.zombies.actor('pvz-gargantuar').collider.radius +
          f.zombies.actor('pvz-gatekeeper').collider.radius +
          0.12,
      'Giant ramp approach must clear the moving guard while they work concurrently',
    );
  }
});
