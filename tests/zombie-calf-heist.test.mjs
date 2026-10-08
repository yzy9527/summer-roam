import { loadModel as load } from './helpers/model-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';

import { interactionFixture } from './helpers/interaction-fixture.mjs';
import { createZombieController } from '../src/field-zombies.js';
import { createCrewCart } from '../src/zombie-crew-cart.js';
import { createZombieCorral } from '../src/zombie-corral.js';
import { CORRAL } from '../src/corral-model.js';
import { createZombieCalfHeist, CALF_RENDEZVOUS } from '../src/zombie-calf-heist.js';
import { createTaskClearance } from '../src/task-clearance.js';
import { landscapeHeight } from '../src/world-queries.js';
import {
  createZombieLookout,
  LOOKOUT_SITE,
  LOOKOUT_NOTICE_SECONDS,
} from '../src/zombie-lookout.js';

async function fixture(carryMode, withLookout = false) {
  const f = await interactionFixture(() => 0.9),
    scene = new THREE.Scene(),
    colliders = f.animals.map((a) => a.collider),
    sources = new Map();
  for (const id of ['pvz-browncoat', 'pvz-conehead', 'pvz-gargantuar'])
    sources.set(id, await load('models/pvz-zombies/' + id + '.glb'));
  for (const a of f.animals) {
    scene.add(a.group);
    a.source = a.group.children[0];
    a.bindPose = [];
    a.source.traverse((n) => {
      if (n.isBone)
        a.bindPose.push({ bone: n, rotation: n.quaternion.clone(), position: n.position.clone() });
    });
  }
  const zombies = createZombieController(sources, colliders);
  scene.add(zombies.root);
  zombies.addGatekeeper();
  const lookout = withLookout ? createZombieLookout(scene, colliders, zombies) : null;
  const cart = createCrewCart(await load('models/zombie-crew-cart.glb'), zombies, colliders);
  scene.add(cart.root);
  const corral = createZombieCorral(scene, colliders, cart, zombies, {
    externalDelivery: true,
    guard: 'pvz-gatekeeper',
    gateSide: 'right',
    random: () => 0.9,
  });
  const animals = {
    animal: f.animal,
    transportAvailable: (id) => f.interactions.canReserveTransport(f.animal(id)),
    reserveYield: (id) => (f.interactions.reserveYield(f.animal(id)) ? f.animal(id) : null),
    releaseYield: (id) => f.interactions.releaseYield(f.animal(id)),
    releaseTransport: (id) => f.interactions.releaseTransport(f.animal(id)),
    reserveTransport(id) {
      const a = f.animal(id);
      return f.interactions.reserveTransport(a) ? a : null;
    },
  };
  const heist = createZombieCalfHeist(scene, colliders, cart, zombies, animals, corral, {
    carryMode,
    lookout,
  });
  const car = { x: 132, z: 10, heading: 0 };
  const tick = (dt = 1 / 30) => {
    f.interactions.update(dt, car, 'day', dt);
    zombies.update(dt, car);
    cart.update(dt, car);
    corral.update(dt, car, dt);
    heist.update(dt, car);
  };
  return {
    ...f,
    fieldAnimals: animals,
    scene,
    colliders,
    zombies,
    cart,
    corral,
    heist,
    lookout,
    tick,
    car,
  };
}

function place(a, x, z) {
  a.x = x;
  a.z = z;
  a.group.position.set(x, landscapeHeight(x, z) + 0.025, z);
  Object.assign(a.collider, { x, z });
  a.group.updateMatrixWorld(true);
}

function runUntil(f, phase, seconds = 400) {
  for (let i = 0; i < seconds * 10 && f.heist.snapshot().phase !== phase; i++) f.tick(0.1);
  assert.equal(
    f.heist.snapshot().phase,
    phase,
    JSON.stringify({ heist: f.heist.snapshot(), cart: f.cart.snapshot() }),
  );
}

test('cart stops before the herd and turns concurrently with real giant running at 30/60/120fps', async () => {
  const results = [];
  for (const fps of [30, 60, 120]) {
    const f = await fixture('underarm');
    place(f.animal('hornless-calf'), -25, 15.8);
    runUntil(f, 'herd-dismount');
    assert(
      f.cart.root.position.distanceTo(
        new THREE.Vector3(CALF_RENDEZVOUS.x, f.cart.root.position.y, CALF_RENDEZVOUS.z),
      ) < 0.001,
    );
    assert.equal(f.cart.snapshot().speed, 0);
    runUntil(f, 'seek-calf');
    const giant = f.zombies.actor('pvz-gargantuar');
    let concurrentFrames = 0,
      reversed = false,
      frozen = false;
    for (let i = 0; i < fps * 50 && f.heist.snapshot().phase !== 'carry-to-cart'; i++) {
      const before = f.cart.snapshot(),
        from = giant.object.position.clone();
      f.tick(1 / fps);
      const c = f.cart.snapshot(),
        h = f.heist.snapshot();
      assert(c.position[2] < -19, 'Turning car must stay outside the herd');
      const distance = Math.hypot(
        c.position[0] - before.position[0],
        c.position[2] - before.position[2],
      );
      const yaw = Math.abs(
        Math.atan2(Math.sin(c.heading - before.heading), Math.cos(c.heading - before.heading)),
      );
      if (distance < 1e-9) assert(yaw < 1e-9, 'Stopped car cannot rotate its body');
      if (
        distance > 1e-5 &&
        giant.object.position.distanceTo(from) > 1e-5 &&
        giant.rig.snapshot().run > 0.1
      )
        concurrentFrames++;
      reversed ||= c.speed < -0.01;
      if (!frozen && h.herdTurn.stage === 'turning' && distance > 1e-5) {
        const state = JSON.stringify([h, c, giant.rig.snapshot()]);
        for (let j = 0; j < 5; j++) f.tick(0);
        assert.equal(
          JSON.stringify([f.heist.snapshot(), f.cart.snapshot(), giant.rig.snapshot()]),
          state,
        );
        frozen = true;
      }
    }
    assert.equal(f.heist.snapshot().phase, 'carry-to-cart');
    assert(concurrentFrames > fps / 2, `${fps}fps: running and driving must overlap`);
    assert(reversed && frozen);
    assert.equal(f.heist.snapshot().herdTurn.stage, 'ready');
    assert(Math.hypot(f.cart.root.position.x + 26, f.cart.root.position.z + 27) < 0.001);
    assert(
      Math.abs(
        Math.atan2(
          Math.sin(f.cart.root.rotation.y - Math.PI / 2),
          Math.cos(f.cart.root.rotation.y - Math.PI / 2),
        ),
      ) < 0.001,
    );
    const parked = f.cart.root.position.clone();
    runUntil(f, 'returning');
    assert(
      f.cart.root.position.distanceTo(parked) < 0.001,
      'Ready car must wait throughout loading',
    );
    assert(f.cart.cargo === f.animal('hornless-calf'));
    for (let i = 0; i < fps * 6; i++) {
      f.tick(1 / fps);
      const c = f.cart.snapshot();
      assert(c.route.every((segment) => segment.gear === 1 && Math.abs(segment.curvature) < 1e-8));
      assert(Math.abs(c.position[2] - CALF_RENDEZVOUS.z) < 0.001);
    }
    assert(
      f.cart.root.position.x > parked.x + 10,
      'Loaded cart must accelerate straight toward camp',
    );
    results.push({ fps, concurrentFrames, reversed, frozen, position: f.cart.snapshot().position });
  }
  mkdirSync('output/zombie-calf-rendezvous', { recursive: true });
  writeFileSync('output/zombie-calf-rendezvous/concurrency.json', JSON.stringify(results, null, 2));
});

test('blocked turnaround keeps the carrier outside until clear, then loads and departs straight', async () => {
  const f = await fixture('underarm');
  place(f.animal('hornless-calf'), -25, 15.8);
  runUntil(f, 'seek-calf');
  Object.assign(f.car, { x: -30.7, z: -29.75 });
  runUntil(f, 'carry-to-cart');
  const at = f.zombies.actor('pvz-gargantuar').object.position.clone();
  for (let i = 0; i < 50; i++) f.tick(0.1);
  assert.equal(f.heist.snapshot().phase, 'carry-to-cart');
  assert.notEqual(f.heist.snapshot().herdTurn.stage, 'ready');
  assert(f.zombies.actor('pvz-gargantuar').object.position.distanceTo(at) < 0.001);
  assert.equal(f.cart.cargo, null);
  assert.equal(f.cart.snapshot().speed, 0);
  Object.assign(f.car, { x: 132, z: 10 });
  runUntil(f, 'returning');
  assert.equal(f.heist.snapshot().herdTurn.stage, 'ready');
  f.tick(0.1);
  assert(
    f.cart
      .snapshot()
      .route.every((segment) => segment.gear === 1 && Math.abs(segment.curvature) < 1e-8),
  );
});

test('manual capture near the rendezvous carries the calf clear before waiting for the turn', async () => {
  const f = await fixture('underarm'),
    calf = f.animal('hornless-calf');
  place(calf, -26, -19);
  assert(f.heist.startManual());
  runUntil(f, 'carry-to-cart');
  assert.equal(f.heist.snapshot().herdTurn.stage, 'clearing');
  const before = f.zombies.actor('pvz-gargantuar').object.position.clone();
  runUntil(f, 'returning');
  assert.equal(f.heist.snapshot().herdTurn.stage, 'ready');
  assert(
    f.zombies
      .actor('pvz-gargantuar')
      .object.getWorldPosition(new THREE.Vector3())
      .distanceTo(before) > 1,
  );
  assert.equal(f.cart.cargo, calf);
});

test('reunion during dismount or mid-turn safely returns crew to the fixed rendezvous and releases them', async () => {
  for (const stage of ['herd-dismount', 'turning']) {
    const f = await fixture('underarm');
    place(f.animal('hornless-calf'), -25, 15.8);
    runUntil(f, stage === 'turning' ? 'seek-calf' : stage);
    if (stage === 'turning') {
      for (let i = 0; i < 300 && Math.abs(f.cart.snapshot().speed) < 0.01; i++) f.tick(0.1);
      assert.equal(f.heist.snapshot().herdTurn.stage, 'turning');
      assert(Math.abs(f.cart.snapshot().speed) > 0.01);
    }
    const calf = f.animal('hornless-calf');
    place(f.animal('golden-cow'), calf.x + 5, calf.z);
    f.tick(0.1);
    runUntil(f, 'waiting');
    assert.equal(f.cart.cargo, null);
    assert.equal(calf.transportOwner, undefined);
    assert(!f.zombies.actor('pvz-gargantuar').scripted);
    assert(!f.zombies.actor('pvz-conehead').scripted);
    assert(f.heist.snapshot().trigger.cooldown > 0);
  }
});

test('lookout observes from the high platform, rings once and delays crew departure; pause freezes notification', async () => {
  const f = await fixture('underarm', true),
    calf = f.animal('hornless-calf');
  const actor = f.zombies.actor('pvz-lookout'),
    before = actor.rig.snapshot();
  assert.equal(
    actor.object.position.y,
    landscapeHeight(LOOKOUT_SITE.x, LOOKOUT_SITE.z) + LOOKOUT_SITE.deck,
  );
  assert(LOOKOUT_SITE.deck >= 8);
  assert.equal(f.lookout.telescope.children.filter((n) => n.name === '望远镜三脚架支脚').length, 3);
  f.tick(0.1);
  const tripod = f.lookout.telescope.position.clone();
  f.tick(0.1);
  const scopeGrip = f.lookout.scope.localToWorld(new THREE.Vector3(0.13, -0.08, -0.65));
  assert(
    actor.rig.handPoint().distanceTo(scopeGrip) < 0.08,
    'Lookout must actually hold the telescope',
  );
  assert(
    f.lookout.telescope.position.distanceTo(tripod) < 1e-9,
    'Tripod feet must stay fixed on platform',
  );
  assert(
    !f.colliders.includes(actor.collider),
    'Elevated lookout must not block actors at ground level',
  );
  place(calf, -25, 15.8);
  const events = [];
  f.heist.connectLookoutAudio((event) => {
    if (!event.type.startsWith('lookout-voice')) events.push(event.type);
  });
  for (let i = 0; i < 40; i++) f.tick(0.1);
  assert.equal(f.heist.snapshot().phase, 'lookout-notice');
  assert(!f.zombies.actor('pvz-conehead').scripted);
  assert.equal(calf.transportOwner, undefined);
  for (let i = 0; i < 15; i++) f.tick(0.1);
  assert.deepEqual(events, ['lookout-bell']);
  assert.notDeepEqual(actor.rig.snapshot().joints.LeftArm, before.joints.LeftArm);
  const paused = f.heist.snapshot(),
    pose = actor.rig.snapshot();
  for (let i = 0; i < 10; i++) f.tick(0);
  assert.deepEqual(f.heist.snapshot(), paused);
  assert.deepEqual(actor.rig.snapshot(), pose);
  runUntil(f, 'crew-boarding', 5);
  assert.deepEqual(events, ['lookout-bell']);
  assert(f.zombies.actor('pvz-conehead').scripted);
});

function placeCrewBySteps(f) {
  for (const [id, z] of [
    ['pvz-conehead', 2.3],
    ['pvz-gargantuar', -0.65],
  ]) {
    const actor = f.zombies.actor(id),
      at = f.cart.world(-5, 0, z);
    actor.object.position.set(at.x, landscapeHeight(at.x, at.z), at.z);
    actor.object.rotation.set(0, f.cart.root.rotation.y + Math.PI / 2, 0, 'YXZ');
    Object.assign(actor.collider, { x: at.x, z: at.z });
    f.zombies.rebind(id);
  }
}

test('alarm crew walks and seats concurrently at 30/60/120fps; departure waits for both settled poses', async () => {
  for (const fps of [30, 60, 120]) {
    const f = await fixture('underarm', true);
    place(f.animal('hornless-calf'), -25, 15.8);
    runUntil(f, 'crew-boarding', 10);
    placeCrewBySteps(f);
    const driver = f.zombies.actor('pvz-conehead'),
      giant = f.zombies.actor('pvz-gargantuar');
    const parked = f.cart.root.position.clone();
    let concurrentWalking = 0,
      concurrentSeating = 0,
      checkedPause = false;
    for (let i = 0; i < fps * 30 && f.heist.snapshot().phase === 'crew-boarding'; i++) {
      const beforeDriver = driver.object.getWorldPosition(new THREE.Vector3());
      const beforeGiant = giant.object.getWorldPosition(new THREE.Vector3());
      f.tick(1 / fps);
      if (
        driver.object.getWorldPosition(new THREE.Vector3()).distanceTo(beforeDriver) > 1e-5 &&
        giant.object.getWorldPosition(new THREE.Vector3()).distanceTo(beforeGiant) > 1e-5
      )
        concurrentWalking++;
      if (driver.transitioning && giant.transitioning) {
        concurrentSeating++;
        if (!checkedPause) {
          const state = f.heist.snapshot(),
            driverPose = driver.rig.snapshot(),
            giantPose = giant.rig.snapshot();
          for (let j = 0; j < 5; j++) f.tick(0);
          assert.deepEqual(f.heist.snapshot(), state);
          assert.deepEqual(driver.rig.snapshot(), driverPose);
          assert.deepEqual(giant.rig.snapshot(), giantPose);
          checkedPause = true;
        }
      }
      assert(f.cart.root.position.distanceTo(parked) < 1e-9);
      assert.equal(f.cart.snapshot().speed, 0);
    }
    assert(concurrentWalking > fps / 2, `${fps}fps: both must move in the same frames`);
    assert(concurrentSeating > fps / 2, `${fps}fps: seating must overlap`);
    assert(checkedPause);
    assert.equal(f.heist.snapshot().phase, 'outbound');
    for (const actor of [driver, giant]) {
      assert(actor.seated && !actor.transitioning);
      assert.equal(actor.object.parent, f.cart.root);
    }
    for (let i = 0; i < fps * 2; i++) f.tick(1 / fps);
    assert(f.cart.root.position.distanceTo(parked) > 0.05, 'Ready crew must depart');
  }
});

test('blocked giant does not stall driver boarding or allow the cart to leave early', async () => {
  const f = await fixture('underarm');
  place(f.animal('hornless-calf'), -25, 15.8);
  runUntil(f, 'crew-boarding', 5);
  placeCrewBySteps(f);
  const at = f.cart.world(-3.15, 0, -0.65),
    blocker = { x: at.x, z: at.z, radius: 0.5 };
  f.colliders.push(blocker);
  const parked = f.cart.root.position.clone(),
    giant = f.zombies.actor('pvz-gargantuar');
  for (let i = 0; i < 160; i++) f.tick(0.1);
  assert.equal(f.heist.snapshot().phase, 'crew-boarding');
  assert.equal(f.heist.snapshot().boarding['pvz-conehead'], 'ready');
  assert.equal(f.heist.snapshot().boarding['pvz-gargantuar'], 'approach');
  assert(!giant.seated);
  assert(f.cart.root.position.distanceTo(parked) < 1e-9);
  f.colliders.splice(f.colliders.indexOf(blocker), 1);
  runUntil(f, 'outbound', 30);
  assert(giant.seated && !giant.transitioning);
});

test('reunion during simultaneous seating finishes both transitions then cancels without an outbound trip', async () => {
  const f = await fixture('underarm'),
    calf = f.animal('hornless-calf');
  place(calf, -25, 15.8);
  runUntil(f, 'crew-boarding', 5);
  placeCrewBySteps(f);
  const driver = f.zombies.actor('pvz-conehead'),
    giant = f.zombies.actor('pvz-gargantuar');
  for (let i = 0; i < 150 && !(driver.transitioning && giant.transitioning); i++) f.tick(0.1);
  assert(driver.transitioning && giant.transitioning);
  const parked = f.cart.root.position.clone();
  place(calf, -25, 10);
  f.tick(0.1);
  assert.equal(f.heist.snapshot().trigger.abortReason, 'reunited');
  runUntil(f, 'abort-returning', 15);
  assert(!driver.transitioning && !giant.transitioning);
  assert(f.cart.root.position.distanceTo(parked) < 1e-9);
  runUntil(f, 'waiting');
  assert.equal(calf.transportOwner, undefined);
  assert(!driver.seated && !giant.seated);
  assert(!driver.scripted && !giant.scripted);
});

test('task clearance automatically moves an overlapping idle zombie aside and both crew finish boarding', async () => {
  const f = await fixture('underarm');
  place(f.animal('hornless-calf'), -25, 15.8);
  runUntil(f, 'crew-boarding', 5);
  placeCrewBySteps(f);
  const blocker = f.zombies.actor('pvz-browncoat'),
    at = f.cart.world(-3.15, 0, -0.65);
  blocker.object.position.set(at.x, landscapeHeight(at.x, at.z), at.z);
  Object.assign(blocker.collider, { x: at.x, z: at.z });
  f.zombies.release(blocker.layout.id);
  blocker.layout.speed = 0;
  const before = blocker.object.position.clone();
  let sawYield = false,
    paused = false;
  for (let i = 0; i < 450 && f.heist.snapshot().phase === 'crew-boarding'; i++) {
    const old = blocker.object.position.clone();
    f.tick(0.1);
    assert(
      blocker.object.position.distanceTo(old) < 0.081,
      'Letting through must use walking, not teleport',
    );
    if (f.heist.snapshot().clearance.some((a) => a.id === blocker.layout.id)) {
      sawYield = true;
      if (!paused) {
        const state = f.heist.snapshot(),
          position = blocker.object.position.clone();
        f.tick(0);
        assert.deepEqual(f.heist.snapshot(), state);
        assert(blocker.object.position.equals(position));
        paused = true;
      }
    }
  }
  assert(sawYield && paused);
  assert(blocker.object.position.distanceTo(before) > 1);
  assert.equal(f.heist.snapshot().phase, 'outbound');
});

test('task clearance lets the gold cow leave existing cart contact and releases her after the cart passes', async () => {
  const f = await fixture('underarm'),
    mother = f.animal('golden-cow');
  f.cart.mountDriver();
  f.cart.mountGiant();
  f.cart.root.position.set(-26, landscapeHeight(-26, 6), 6);
  f.cart.root.rotation.y = 0;
  for (const [i, c] of f.colliders.filter((c) => c.woodenCart).entries()) {
    const p = f.cart.world(0, 0, (i - 2) * 1.4);
    Object.assign(c, { x: p.x, z: p.z });
  }
  place(mother, -26, 9.3);
  place(f.animal('copper-cow'), -34, 20);
  place(f.animal('hornless-calf'), -18, 20);
  const clearance = createTaskClearance(f.colliders, f.zombies, f.fieldAnimals, {
    exclude: ['hornless-calf', 'pvz-conehead', 'pvz-gargantuar'],
  });
  const from = f.cart.world(0, 0, -3.57),
    to = f.cart.world(0, 0, 3.57);
  clearance.request(from, to, 2.13, f.car);
  assert.equal(mother.transportOwner, 'task-yield');
  const original = { x: mother.x, z: mother.z };
  const bones = mother.rig.snapshot();
  for (let i = 0; i < 160; i++) {
    const old = { x: mother.x, z: mother.z };
    clearance.update(0.1, f.car);
    assert(Math.hypot(mother.x - old.x, mother.z - old.z) <= 0.081);
  }
  assert(Math.hypot(mother.x - original.x, mother.z - original.z) > 2);
  assert.notDeepEqual(mother.rig.snapshot(), bones);
  assert.equal(mother.transportOwner, undefined);
  assert.equal(mother.taps, 0);
  assert(f.cart.routeTo({ x: -26, z: 2, heading: 0 }, f.car, { reverse: true }));
  for (let i = 0; i < 200 && !f.cart.arrived(); i++) f.cart.update(0.1, f.car);
  assert(f.cart.arrived());
});

test('task clearance opens a blocked pickup pose and the giant actually completes holding the same calf', async () => {
  const f = await fixture('underarm'),
    calf = f.animal('hornless-calf'),
    mother = f.animal('golden-cow');
  place(calf, -25, 10);
  place(mother, -25, 11.08);
  place(f.animal('copper-cow'), -34, 22);
  const giant = f.zombies.actor('pvz-gargantuar');
  giant.object.position.set(-25, landscapeHeight(-25, 14.5), 14.5);
  giant.object.rotation.set(0, Math.PI, 0, 'YXZ');
  Object.assign(giant.collider, { x: -25, z: 14.5 });
  f.zombies.rebind(giant.layout.id);
  const skin = calf.group;
  assert(f.heist.holdManual());
  // Real rendering uses small and varying steps: a shallow tangent must be
  // safe from its first step, not just at the coarser path sample endpoint.
  for (let i = 0; i < 45 * 120 && f.heist.snapshot().phase !== 'manual-hold'; i++) f.tick(1 / 120);
  assert.equal(f.heist.snapshot().phase, 'manual-hold');
  assert.equal(calf.group, skin);
  assert(f.heist.snapshot().carrying);
  assert(f.heist.snapshot().handGaps.every((d) => d < 0.12));
  assert(Math.hypot(mother.x + 25, mother.z - 11.08) > 1);
});

test('reunion during lookout notification cancels the bell and never takes the crew or calf', async () => {
  const f = await fixture('underarm', true),
    calf = f.animal('hornless-calf');
  const events = [];
  f.heist.connectLookoutAudio((event) => {
    if (!event.type.startsWith('lookout-voice')) events.push(event.type);
  });
  place(calf, -25, 15.8);
  for (let i = 0; i < 55; i++) f.tick(0.1);
  place(calf, -25, 10);
  f.tick(0.1);
  assert.equal(f.heist.snapshot().phase, 'waiting');
  assert.deepEqual(events, ['lookout-bell', 'lookout-cancel']);
  assert.equal(f.heist.snapshot().trigger.isolatedFor, 0);
  assert.equal(calf.transportOwner, undefined);
  assert(!f.zombies.actor('pvz-conehead').scripted);
  assert(!f.zombies.actor('pvz-gargantuar').scripted);
  assert.equal(f.cart.cargo, null);
});

test('manual bell is independent, grips the hanging rope with real bones, and alarm is locked for the capture task', async () => {
  const f = await fixture('underarm', true);
  const { createSceneActions, pickActionTarget } = await import('../src/scene-actions.js');
  const registry = createSceneActions({
    getField: () => ({
      animals: { animal: f.animal },
      lookout: f.lookout,
      calfHeist: f.heist,
      zombies: f.zombies,
      corral: f.corral,
      woodenCart: f.cart,
    }),
  });
  const target = { type: 'actor', id: 'pvz-lookout' };
  const events = [];
  f.heist.connectLookoutAudio((e) => events.push(e));
  f.tick(0.1);
  const anchor = f.lookout.bell.getWorldPosition(new THREE.Vector3()).toArray();
  assert.equal(f.lookout.bell.parent, f.lookout.root);
  assert.equal(f.lookout.bell.visible, true);
  assert.equal(f.lookout.root.getObjectByName('铜铃悬挂横梁'), undefined);
  assert.equal(f.lookout.suspension.parent, f.lookout.root);
  const rest = f.lookout.snapshot();
  assert(Math.abs(rest.grip[0] - rest.bellPosition[0]) < 1e-8);
  assert(Math.abs(rest.grip[2] - rest.bellPosition[2]) < 1e-8);
  assert(f.lookout.rope.quaternion.angleTo(new THREE.Quaternion()) > Math.PI - 1e-8);
  assert.equal(registry.execute(target, 'ring-bell').ok, true);
  assert.equal(registry.execute(target, 'ring-bell').ok, false);
  assert.equal(registry.execute(target, 'calf-alarm').ok, false);
  const source = f.lookout.actor.source;
  const bones = [];
  source.traverse((n) => {
    if (n.isBone) bones.push(n);
  });
  const lengths = bones.map((n) => n.position.length());
  const hand = bones.find((n) => n.name.replace(/_0\d+$/, '') === 'RightHand');
  const finger = bones.find((n) => n.name.replace(/_0\d+$/, '') === 'RightHandIndex1');
  const beforeFinger = finger.quaternion.clone();
  let peakAngle = 0;
  for (let i = 0; i < 32; i++) {
    f.tick(0.1);
    const s = f.lookout.snapshot();
    assert.equal(f.heist.snapshot().phase, 'waiting');
    assert.deepEqual(s.bellPosition, anchor);
    peakAngle = Math.max(peakAngle, Math.abs(s.bellAngle));
    if (s.ringTime >= 1.15 && s.ringTime <= 2.25) {
      assert(
        s.handGap < 0.055,
        `Wrist must meet rope: ${JSON.stringify({
          time: s.ringTime,
          gap: s.handGap,
          grip: s.grip,
          hand: hand.getWorldPosition(new THREE.Vector3()).toArray(),
          arm: bones
            .find((n) => n.name.replace(/_0\d+$/, '') === 'RightArm')
            .getWorldPosition(new THREE.Vector3())
            .toArray(),
          elbow: bones
            .find((n) => n.name.replace(/_0\d+$/, '') === 'RightForeArm')
            .getWorldPosition(new THREE.Vector3())
            .toArray(),
        })}`,
      );
      assert(finger.quaternion.angleTo(beforeFinger) > 0.1);
      const sameHands = bones.filter((n) => /^RightHand(?:_0\d+)?$/.test(n.name));
      assert(sameHands.every((n) => n.quaternion.equals(hand.quaternion)));
    }
    assert(
      bones.every(
        (n, j) =>
          /^Hips(?:_0\d+)?$/.test(n.name) || Math.abs(n.position.length() - lengths[j]) < 1e-7,
      ),
    );
    if (i === 14) {
      const paused = f.lookout.snapshot();
      f.tick(0);
      assert.deepEqual(f.lookout.snapshot(), paused);
    }
  }
  assert(peakAngle > 0.2);
  assert.deepEqual(
    events.map((e) => e.type),
    ['lookout-bell'],
  );
  assert.deepEqual(
    events.map((e) => e.strike),
    [0],
  );
  assert.equal(f.lookout.snapshot().strikes, 2);
  assert.equal(f.lookout.snapshot().ringMode, null);
  assert.equal(f.lookout.bell.rotation.z, 0);
  assert.equal(!!f.zombies.actor('pvz-conehead').scripted, false);
  assert.equal(f.animal('hornless-calf').transportOwner, undefined);
  // Actual visible geometry can select the elevated actor for the action wheel.
  const head = f.lookout.actor.rig.headPoint();
  const ray = new THREE.Raycaster(
    head.clone().add(new THREE.Vector3(0, 0.18, 2)),
    new THREE.Vector3(0, 0, -1),
  );
  const selected = pickActionTarget(
    f.scene,
    ray,
    { animals: { animal: f.animal }, zombies: f.zombies, corral: f.corral },
    null,
  );
  assert.equal(
    selected.id,
    'pvz-lookout',
    JSON.stringify({
      head: head.toArray(),
      selected,
      hits: ray
        .intersectObjects(f.scene.children, true)
        .slice(0, 4)
        .map((h) => ({ name: h.object.name, point: h.point.toArray() })),
    }),
  );
  assert.equal(registry.execute(target, 'calf-alarm').ok, true);
  assert.equal(f.heist.snapshot().phase, 'lookout-notice');
  assert.equal(
    registry.actions(target).find((a) => a.id === 'calf-alarm').reason,
    '抓牛任务进行中',
  );
  assert.equal(registry.execute(target, 'ring-bell').ok, false);
  runUntil(f, 'crew-boarding', LOOKOUT_NOTICE_SECONDS + 1);
  const capturePhase = f.heist.snapshot().phase;
  assert.equal(registry.execute(target, 'ring-bell').ok, true);
  assert.equal(f.heist.snapshot().phase, capturePhase);
  assert.equal(registry.execute(target, 'calf-alarm').ok, false);
  assert.equal(registry.execute(target, 'ring-bell').ok, false);
  for (let i = 0; i < 33; i++) f.tick(0.1);
  assert.equal(f.lookout.snapshot().ringMode, null);
  assert.equal(f.heist.snapshot().manualTask, 'capture');
  assert.equal(
    registry.actions(target).find((a) => a.id === 'calf-alarm').reason,
    '抓牛任务进行中',
  );
});

test('automatic notice waits for an independent manual bell and cancellation does not stop a manual bell', async () => {
  const f = await fixture('underarm', true);
  place(f.animal('hornless-calf'), -25, 15.8);
  for (let i = 0; i < 35; i++) f.tick(0.1);
  assert(f.lookout.ring());
  for (let i = 0; i < 20; i++) f.tick(0.1);
  assert.equal(f.heist.snapshot().phase, 'waiting');
  f.lookout.cancelNotice();
  assert.equal(f.lookout.snapshot().ringMode, 'manual');
  runUntil(f, 'lookout-notice', 3);
  assert.equal(f.lookout.snapshot().ringMode, 'notice');
  assert.equal(f.lookout.ring(), false);
  place(f.animal('hornless-calf'), -25, 10);
  f.tick(0.1);
  assert.equal(f.heist.snapshot().phase, 'waiting');
  assert.equal(f.lookout.snapshot().ringMode, null);
  assert(f.lookout.ring());
});

test('warning voice only accompanies alarms and actual playing/stopped events control the real jaw', async () => {
  const f = await fixture('underarm', true);
  const events = [];
  let playback;
  f.heist.connectLookoutAudio((event, notify) => {
    events.push(event.type);
    if (event.type === 'lookout-voice') playback = notify;
    return true;
  });
  assert(f.heist.alertManual());
  for (let i = 0; i < 12; i++) f.tick(0.1);
  assert.deepEqual(events, ['lookout-voice']);
  assert.equal(f.lookout.snapshot().speaking, false);
  let jaw;
  f.lookout.actor.source.traverse((n) => {
    if (n.isBone && n.name.replace(/_0\d+$/, '') === 'Jaw' && !jaw) jaw = n;
  });
  const silent = jaw.quaternion.clone();
  playback('playing');
  f.tick(0.1);
  assert.equal(f.lookout.snapshot().speaking, true);
  assert(jaw.quaternion.clone().normalize().angleTo(silent.clone().normalize()) > 0.05);
  playback('stopped');
  f.tick(0.1);
  assert.equal(f.lookout.snapshot().speaking, false);
  assert(jaw.quaternion.clone().normalize().angleTo(silent.clone().normalize()) < 1e-6);
  assert(f.heist.cancelManual());
  assert.equal(events.at(-1), 'lookout-cancel');
  assert(f.lookout.ring());
  playback('playing'); // Late events from a cancelled alarm cannot open the jaw.
  for (let i = 0; i < 33; i++) f.tick(0.1);
  assert.equal(f.lookout.snapshot().speaking, false);
  assert.equal(events.filter((e) => e === 'lookout-voice').length, 1);
});

test('30/60/120fps rope pulls keep the real hand in contact, hold bone lengths and emit exactly two strikes', async () => {
  const f = await fixture('underarm', true);
  for (const fps of [30, 60, 120]) {
    const events = [];
    f.lookout.connectAudio((e) => {
      events.push(e);
      return true;
    });
    assert(f.lookout.ring());
    let contactFrames = 0;
    for (let i = 0; i < Math.ceil((LOOKOUT_NOTICE_SECONDS + 0.1) * fps); i++) {
      f.lookout.update(1 / fps, { noticing: false, time: 0, target: f.animal('hornless-calf') });
      const s = f.lookout.snapshot();
      if (s.ringTime > 1.12 && s.ringTime < 2.3) {
        assert(s.handGap < 0.055, `${fps}fps hand gap ${s.handGap}`);
        contactFrames++;
      }
      assert(f.lookout.actor.rig.snapshot().legs.every((l) => l.foot.every(Number.isFinite)));
    }
    assert(contactFrames > fps);
    assert.deepEqual(
      events.map((e) => [e.type, e.strike]),
      [
        ['lookout-bell', 0],
        ['lookout-bell', 1],
      ],
    );
    assert.equal(f.lookout.snapshot().ringMode, null);
  }
});

test('heist waits for four continuous seconds away from BOTH parents, respects ownership and pause', async () => {
  const f = await fixture('underarm'),
    calf = f.animal('hornless-calf');
  for (let i = 0; i < 80; i++) f.tick(0.1);
  assert.equal(f.heist.snapshot().phase, 'waiting');
  assert.equal(calf.transportOwner, undefined);
  assert.equal(!!f.zombies.actor('pvz-gargantuar').scripted, false);
  assert.equal(f.heist.start(), false);
  // Far from mother but still protected by bull.
  place(calf, -30, 15);
  for (let i = 0; i < 50; i++) f.tick(0.1);
  assert.equal(f.heist.snapshot().phase, 'waiting');
  place(calf, -25, 15.8);
  for (let i = 0; i < 30; i++) f.tick(0.1);
  assert(f.heist.snapshot().trigger.isolatedFor > 2.9);
  const before = f.heist.snapshot();
  for (let i = 0; i < 20; i++) f.tick(0);
  assert.deepEqual(f.heist.snapshot(), before);
  f.interactions.update(0.1, f.car, 'night', 0.1);
  assert(f.interactions.sleep.rest(calf));
  f.interactions.update(0.1, f.car, 'night', 0.1);
  f.heist.update(0.1, f.car);
  assert.equal(f.heist.snapshot().trigger.isolatedFor, 0, 'Sleeping calf cannot trigger');
  for (let i = 0; i < 30; i++) f.interactions.update(0.1, f.car, 'day', 0.1);
  assert(f.interactions.reserveFamily());
  f.tick(0.1);
  assert.equal(f.heist.snapshot().trigger.isolatedFor, 0);
  f.interactions.familyEvent('cancel');
  place(calf, -25, 15.8);
  for (let i = 0; i < 39; i++) f.tick(0.1);
  assert.equal(f.heist.snapshot().phase, 'waiting');
  place(calf, -25, 14);
  f.tick(0.1);
  assert.equal(f.heist.snapshot().trigger.isolatedFor, 0, 'Exactly ten meters is protected');
  place(calf, -25, 15.8);
  for (let i = 0; i < 40; i++) f.tick(0.1);
  assert.equal(f.heist.snapshot().phase, 'crew-boarding');
  assert.equal(calf.transportOwner, undefined, 'Outbound must not freeze calf');
});

test('reunion on the road returns an empty cart, releases crew and enforces cooldown', async () => {
  const f = await fixture('underarm'),
    calf = f.animal('hornless-calf');
  place(calf, -25, 15.8);
  runUntil(f, 'outbound');
  for (let i = 0; i < 100; i++) f.tick(0.1);
  place(calf, -25, 10);
  f.tick(0.1);
  assert.equal(f.heist.snapshot().trigger.abortReason, 'reunited');
  runUntil(f, 'waiting');
  assert.equal(f.cart.cargo, null);
  assert.equal(calf.transportOwner, undefined);
  assert.equal(f.cart.snapshot().driver.seated, false);
  assert.equal(f.cart.snapshot().passenger.seated, false);
  assert.equal(!!f.zombies.actor('pvz-conehead').scripted, false);
  assert.equal(!!f.zombies.actor('pvz-gargantuar').scripted, false);
  place(calf, -25, 15.8);
  for (let i = 0; i < 290; i++) f.tick(0.1);
  assert.equal(f.heist.snapshot().phase, 'waiting');
  const before = f.heist.snapshot();
  f.tick(0);
  assert.deepEqual(f.heist.snapshot(), before);
  runUntil(f, 'crew-boarding', 8);
});

test('parent approaching before lift cancels and releases the original calf', async () => {
  const f = await fixture('underarm'),
    calf = f.animal('hornless-calf'),
    original = calf.group;
  place(calf, -25, 15.8);
  runUntil(f, 'crouch-and-grip');
  assert.equal(calf.transportOwner, 'heist');
  place(f.animal('golden-cow'), calf.x + 5, calf.z);
  f.tick(0.1);
  assert.equal(calf.transportOwner, undefined);
  assert.equal(calf.group, original);
  assert(f.colliders.includes(calf.collider));
  assert.equal(f.heist.snapshot().liftEvents, 0);
  runUntil(f, 'waiting');
  assert.equal(f.cart.cargo, null);
});

function localBounds(object, parent) {
  parent.updateMatrixWorld(true);
  const box = new THREE.Box3(),
    point = new THREE.Vector3();
  object.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.visible) return;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point);
      box.expandByPoint(parent.worldToLocal(mesh.localToWorld(point)));
    }
  });
  return box;
}

// Arms may extend above the rails. Test the deformed skin against the actual
// timber boxes, rather than treating the entire bed as an infinite-height wall.
function assertRailClearance(object, cart) {
  cart.updateMatrixWorld(true);
  const rails = [];
  cart.traverse((mesh) => {
    if (mesh.isMesh && /^side_(panel|top_rail|bottom_rail)/.test(mesh.name))
      rails.push({ name: mesh.name, box: localBounds(mesh, cart) });
  });
  object.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.visible) return;
    const points = [];
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++)
      points.push(
        cart.worldToLocal(mesh.localToWorld(mesh.getVertexPosition(i, new THREE.Vector3()))),
      );
    const indices = mesh.geometry.index;
    const count = indices?.count ?? points.length;
    for (let i = 0; i < count; i += 3) {
      const triangle = new THREE.Triangle(
        points[indices ? indices.getX(i) : i],
        points[indices ? indices.getX(i + 1) : i + 1],
        points[indices ? indices.getX(i + 2) : i + 2],
      );
      for (const { name, box } of rails)
        assert(!box.intersectsTriangle(triangle), `Giant skin intersects ${name}`);
    }
  });
}

test('single-calf preview wraps downward from above, freezes and replays the same skin', async () => {
  const f = await fixture('underarm'),
    calf = f.animal('hornless-calf'),
    original = calf.group;
  const liftNotifications = [];
  f.heist.connectAudio((event, notify) => {
    liftNotifications.push(notify);
    return true;
  });
  assert(f.heist.previewCarry());
  let maxKick = 0,
    maxHead = 0,
    pausedStruggle = false;
  for (let i = 0; i < 100; i++) {
    f.tick(0.05);
    const h = f.heist.snapshot();
    maxKick = Math.max(maxKick, ...(h.expression?.kicks ?? [0]).map(Math.abs));
    maxHead = Math.max(maxHead, Math.abs(h.expression?.headYaw ?? 0));
    for (const name of ['FL_Hoof', 'FR_Hoof', 'HL_Hoof', 'HR_Hoof']) {
      const foot = calf.source.getObjectByName(name).getWorldPosition(new THREE.Vector3());
      assert(foot.y > 0.12, 'Kicking foot crosses the ground');
    }
    if (!pausedStruggle && h.expression?.struggle > 0.65) {
      const before = JSON.stringify(h);
      f.tick(0);
      assert.equal(JSON.stringify(f.heist.snapshot()), before);
      pausedStruggle = true;
    }
  }
  assert(maxKick > 0.35 && maxKick <= 0.46, 'Kicks must be strong but bounded');
  assert(maxHead > 0.3 && maxHead <= 0.36, 'Head twisting must be strong but bounded');
  assert(pausedStruggle);
  assert.equal(f.heist.snapshot().phase, 'preview-hold');
  const giant = f.zombies.actor('pvz-gargantuar');
  const bone = (name) => {
    let found;
    giant.source.traverse((n) => {
      if (n.isBone && n.name.replace(/_0\d+$/, '') === name && !found) found = n;
    });
    return found;
  };
  const wrist = bone('RightHand').getWorldPosition(new THREE.Vector3());
  const elbow = bone('RightForeArm').getWorldPosition(new THREE.Vector3());
  const fingers = bone('RightHandMiddle3').getWorldPosition(new THREE.Vector3());
  assert(elbow.y > wrist.y + 0.2, 'Forearm must reach downward from the upper elbow');
  assert(fingers.y < wrist.y - 0.2, 'Fingers point down, not up');
  assert(f.heist.snapshot().handGaps[0] < 0.01);
  const before = JSON.stringify({ heist: f.heist.snapshot(), cart: f.cart.snapshot() });
  f.tick(0);
  assert.equal(JSON.stringify({ heist: f.heist.snapshot(), cart: f.cart.snapshot() }), before);
  assert(f.heist.previewCarry());
  for (let i = 0; i < 100; i++) f.tick(0.05);
  assert.equal(f.heist.snapshot().phase, 'preview-hold');
  assert.equal(f.animal('hornless-calf').group, original);
  assert.equal(f.cart.cargo, null);
  assert.equal(liftNotifications.length, 2);
  liftNotifications[0]('playing');
  assert.equal(f.heist.snapshot().expression.calling, false, 'Old playback must not affect replay');
  liftNotifications[1]('playing');
  assert.equal(f.heist.snapshot().expression.calling, true);
  liftNotifications[1]('stopped');
  assert.equal(f.heist.snapshot().expression.calling, false);
});

for (const mode of ['underarm', 'two-hand'])
  test(`real giant ${mode} squat bends the legs above ground without stretching the skin`, async () => {
    const f = await fixture(mode);
    assert(f.heist.previewCarry());
    const giant = f.zombies.actor('pvz-gargantuar');
    const legs = giant.source.getObjectByName('Object_210');
    assert(legs?.isSkinnedMesh, 'Check the original imported leg skin');
    const bones = [];
    giant.source.traverse((bone) => {
      if (bone.isBone && /^(Left|Right)(UpLeg|Leg|Foot)_0\d+$/.test(bone.name))
        bones.push({ bone, length: bone.position.length() });
    });
    let lowestHip = Infinity,
      highestHip = -Infinity;
    for (let i = 0; i < 100; i++) {
      f.tick(0.05);
      giant.object.updateMatrixWorld(true);
      const gap = new THREE.Box3().setFromObject(legs, true).min.y - giant.object.position.y;
      assert(gap > -0.008 && gap < 0.025, `Squatting leg skin leaves the ground: ${gap}`);
      for (const { bone, length } of bones)
        assert(Math.abs(bone.position.length() - length) < 1e-8, 'Squatting preserves leg lengths');
      let hip;
      giant.source.traverse((bone) => {
        if (!hip && bone.isBone && /^Hips_0\d+$/.test(bone.name)) hip = bone;
      });
      const y = hip.getWorldPosition(new THREE.Vector3()).y;
      lowestHip = Math.min(lowestHip, y);
      highestHip = Math.max(highestHip, y);
    }
    assert(highestHip - lowestHip > 0.2, 'The supported giant still visibly squats');
    assert.equal(f.heist.snapshot().phase, 'preview-hold');
    assert(f.heist.snapshot().handGaps.every((gap) => gap < 0.02));
  });

for (const mode of ['underarm', 'two-hand'])
  test(`real calf and giant complete ${mode} lifting, shared ride and corral delivery`, async () => {
    const f = await fixture(mode),
      calf = f.animal('hornless-calf'),
      original = calf.group,
      phases = [];
    assert.equal(f.cart.cargo, null);
    place(calf, -25, 15.8);
    const reactions = [];
    f.heist.connectAudio((event, notify) => {
      reactions.push(event);
      notify('playing');
      notify('stopped');
      return true;
    });
    assert.equal(f.heist.setCarryMode('unknown'), false);
    let previous = '',
      maxHandGap = 0;
    const checkedRides = new Set();
    let checkedCarryObstacle = false;
    let checkedWrap = false,
      checkedThrow = false;
    const flightSamples = [];
    let landingFeet = null,
      checkedLanding = false;
    const handRest = new Map();
    f.zombies.actor('pvz-gargantuar').source.traverse((bone) => {
      if (bone.isBone && /^RightHand(?:Index|Middle|Ring|Pinky|Thumb)[0-3]_/.test(bone.name))
        handRest.set(bone, { q: bone.quaternion.clone(), p: bone.position.clone() });
    });
    let passengerBounds = null,
      cargoBounds = null;
    let forwardFrames = 0,
      boardingFrames = 0,
      concurrentUnload = false;
    const giantActor = f.zombies.actor('pvz-gargantuar');
    for (let i = 0; i < 10 * 900; i++) {
      const beforePhase = f.heist.snapshot().phase;
      const beforePosition = giantActor.object.getWorldPosition(new THREE.Vector3());
      f.tick(0.1);
      const afterPosition = giantActor.object.getWorldPosition(new THREE.Vector3());
      const dx = afterPosition.x - beforePosition.x,
        dz = afterPosition.z - beforePosition.z;
      if (
        Math.hypot(dx, dz) > 1e-5 &&
        beforePhase === f.heist.snapshot().phase &&
        (f.heist.snapshot().carrying || giantActor.transitioning) &&
        ![
          'place-in-cart',
          'lift-from-cart',
          'lift-calf',
          'lower-in-corral',
          'outbound',
          'returning',
        ].includes(beforePhase)
      ) {
        const orientation = new THREE.Euler().setFromQuaternion(
          giantActor.object.getWorldQuaternion(new THREE.Quaternion()),
          'YXZ',
        ).y;
        const error = Math.atan2(
          Math.sin(Math.atan2(dx, dz) - orientation),
          Math.cos(Math.atan2(dx, dz) - orientation),
        );
        assert(Math.abs(error) < 0.13, `${beforePhase}: carrier moves sideways by ${error}`);
        if (giantActor.transitioning) boardingFrames++;
        else forwardFrames++;
      }
      const h = f.heist.snapshot();
      if (
        ['corral-dismount', 'approach-loaded-calf', 'walk-to-loaded-calf'].includes(h.phase) &&
        f.corral.gateState().gateAmount < 0.99
      )
        concurrentUnload = true;
      if (h.phase !== previous) {
        phases.push({ phase: h.phase, time: i / 10 });
        previous = h.phase;
        console.log(h.phase, i / 10);
      }
      if (
        ['outbound', 'returning'].includes(h.phase) &&
        !checkedRides.has(h.phase) &&
        !f.zombies.actor('pvz-gargantuar').transitioning
      ) {
        checkedRides.add(h.phase);
        passengerBounds = localBounds(f.zombies.actor('pvz-gargantuar').object, f.cart.root);
        assertRailClearance(f.zombies.actor('pvz-gargantuar').object, f.cart.root);
        assert(
          passengerBounds.min.x > -1.85 && passengerBounds.max.x < 1.85,
          'Giant extends beyond the vehicle collision footprint',
        );
        assert(passengerBounds.max.z < 1.288, 'Giant crosses front partition');
        assert(passengerBounds.min.y > 0.54, 'Giant feet penetrate floor');
        if (f.cart.cargo) {
          cargoBounds = localBounds(calf.group, f.cart.root);
          assert(cargoBounds.max.z < passengerBounds.min.z - 0.2, 'Cow intersects seated giant');
          assert(cargoBounds.min.z > -3.31, 'Cow crosses rear gate');
          assert(cargoBounds.min.y > 0.54, 'Cow hooves penetrate floor');
        }
      }
      if (!checkedThrow && h.phase === 'face-throw') {
        assertRailClearance(calf.group, f.cart.root);
        assertRailClearance(giantActor.object, f.cart.root);
        const at = f.cart.root.worldToLocal(
          giantActor.object.getWorldPosition(new THREE.Vector3()),
        );
        assert(at.x < -3.9, 'Giant must throw from outside the cart');
        checkedThrow = true;
      }
      if (h.phase === 'calf-in-flight') {
        assert.equal(f.cart.cargo, null, 'Cargo ownership starts only after landing');
        assert.equal(h.carrying, false, 'Hands must release the airborne calf');
        assert.equal(calf.group, original);
        assertRailClearance(calf.group, f.cart.root);
        flightSamples.push(calf.group.getWorldPosition(new THREE.Vector3()).toArray());
        const before = calf.group.position.clone(),
          q = calf.group.quaternion.clone(),
          rig = giantActor.rig.snapshot();
        f.tick(0);
        assert(calf.group.position.equals(before) && calf.group.quaternion.equals(q));
        assert.deepEqual(giantActor.rig.snapshot(), rig);
      }
      if (h.phase === 'calf-landing') {
        const feet = ['FL', 'FR', 'HL', 'HR'].map((name) =>
          f.cart.root.worldToLocal(
            calf.source.getObjectByName(name + '_Hoof').getWorldPosition(new THREE.Vector3()),
          ),
        );
        if (!landingFeet) landingFeet = feet;
        else
          feet.forEach((foot, i) =>
            assert(foot.distanceTo(landingFeet[i]) < 0.001, 'Landing hoof slides in bed'),
          );
        assert.equal(f.cart.cargo, calf);
        assertRailClearance(calf.group, f.cart.root);
        checkedLanding = true;
      }
      if (h.carrying && !['throw-windup', 'throw-swing', 'lift-from-cart'].includes(h.phase))
        maxHandGap = Math.max(maxHandGap, ...h.handGaps);
      if (mode === 'underarm' && h.phase === 'carry-to-cart' && !checkedWrap) {
        const giant = f.zombies.actor('pvz-gargantuar');
        const support = calf.group.worldToLocal(giant.rig.hands('underarm')[0]);
        assert(support.x * calf.scale < -0.23, 'Palm must close against outer flank');
        assert(
          Math.abs(
            Math.atan2(
              Math.sin(calf.group.rotation.y - giant.object.rotation.y),
              Math.cos(calf.group.rotation.y - giant.object.rotation.y),
            ),
          ) < 0.001,
          'Cow and giant must face the same direction',
        );
        let bent = 0;
        for (const [bone, rest] of handRest) {
          if (bone.quaternion.angleTo(rest.q) > 0.05) bent++;
          assert(bone.position.distanceTo(rest.p) < 1e-9, 'Finger bones stretch');
        }
        assert(bent >= 30, 'Finger flexion must drive both actual hand skeletons');
        const paused = [...handRest.keys()].map((b) => b.quaternion.toArray());
        f.tick(0);
        assert.deepEqual(
          [...handRest.keys()].map((b) => b.quaternion.toArray()),
          paused,
        );
        checkedWrap = true;
      }
      if (h.phase === 'carry-to-cart' && !checkedCarryObstacle && h.time > 2) {
        const giant = f.zombies.actor('pvz-gargantuar'),
          at = giant.object.position.clone(),
          center = calf.group.getWorldPosition(new THREE.Vector3()),
          direction = center.clone().sub(at).setY(0).normalize(),
          blocker = {
            x: at.x + direction.x * 1.65,
            z: at.z + direction.z * 1.65,
            radius: 0.15,
          };
        assert(f.zombies.canStand('pvz-gargantuar', at, f.car), 'Carrier was already blocked');
        f.colliders.push(blocker);
        assert(
          f.zombies.canStand('pvz-gargantuar', at, f.car),
          'Blocker must hit the calf, not carrier feet',
        );
        for (let j = 0; j < 5; j++) f.tick(0.1);
        assert(
          giant.object.position.distanceTo(at) < 1e-6,
          'Suspended calf moves through obstacle',
        );
        f.colliders.splice(f.colliders.indexOf(blocker), 1);
        checkedCarryObstacle = true;
      }
      if (i % 300 === 0) {
        const before = JSON.stringify([
          f.heist.snapshot(),
          f.cart.snapshot(),
          f.zombies.snapshot(),
        ]);
        f.tick(0);
        assert.equal(
          JSON.stringify([f.heist.snapshot(), f.cart.snapshot(), f.zombies.snapshot()]),
          before,
        );
      }
      if (
        h.phase === 'complete' ||
        h.time > (['outbound', 'returning'].includes(h.phase) ? 240 : 85)
      )
        break;
    }
    mkdirSync('output/zombie-calf-heist', { recursive: true });
    writeFileSync(
      `output/zombie-calf-heist/${mode}-simulation.json`,
      JSON.stringify(
        {
          phases,
          maxHandGap,
          passengerBounds,
          cargoBounds,
          heist: f.heist.snapshot(),
          cart: f.cart.snapshot(),
          corral: f.corral.snapshot(),
          crew: f.zombies.snapshot(),
        },
        null,
        2,
      ),
    );
    assert(concurrentUnload, 'The giant starts unloading while the guard is still opening');
    assert.equal(
      f.heist.snapshot().phase,
      'complete',
      JSON.stringify({
        heist: f.heist.snapshot(),
        cart: f.cart.snapshot(),
        zombies: f.zombies
          .snapshot()
          .zombies.map((z) => ({ id: z.id, position: z.position, blocked: z.blocked })),
      }),
    );
    assert(checkedThrow && checkedLanding);
    assert(flightSamples.length >= 6);
    assert(
      Math.max(...flightSamples.map((p) => p[1])) > flightSamples[0][1] + 0.15,
      'Calf must rise in an arc',
    );
    assert(!f.heist.snapshot().history.includes('carry-up-ramp'));
    assert(forwardFrames > 50);
    assert(boardingFrames > 10);
    assert.equal(reactions.length, 2);
    assert.equal(f.heist.snapshot().liftEvents, 2);
    assert.equal(f.heist.setCarryMode(mode), false);
    assert.equal(f.corral.animals[0], calf);
    assert.equal(f.corral.animals[0].group, original);
    assert.equal(f.cart.cargo, null);
    assert.equal(f.cart.snapshot().driver.seated, false);
    assert.equal(f.cart.snapshot().passenger.seated, false);
    assert.equal(f.corral.snapshot().gateAmount, 0);
    assert(checkedCarryObstacle);
    if (mode === 'underarm') assert(checkedWrap);
    assert(maxHandGap < 0.1, `Unsupported calf: hand gap ${maxHandGap}`);
    assert.equal(f.interactions.reserveFamily(), false);
    assert.equal(f.interactions.requestWolf(f.car), false);
  });

test('opened loading side leaves real calf and giant skins clear through the loading turn', async () => {
  const f = await fixture('underarm');
  f.heist.previewCarry();
  f.cart.setGateOpen(true);
  for (let i = 0; i < 60; i++) f.tick(0.1);
  const giant = f.zombies.actor('pvz-gargantuar'),
    calf = f.animal('hornless-calf');
  for (const angle of [0, 0.3, 0.6, 0.9, 1.2, Math.PI / 2]) {
    giant.object.position.copy(f.cart.world(-0.08, 0.551, -3.56));
    giant.object.rotation.y = f.cart.root.rotation.y + angle;
    f.heist.update(0.1, f.car);
    assertRailClearance(calf.group, f.cart.root);
    assertRailClearance(giant.object, f.cart.root);
  }
});

for (const mode of ['underarm', 'two-hand'])
  test(`throw preview ${mode} clears closed rails, keeps hand contact until release and replays the same calf`, async () => {
    const f = await fixture(mode),
      calf = f.animal('hornless-calf'),
      original = calf.group,
      giant = f.zombies.actor('pvz-gargantuar');
    assert(f.heist.previewThrow());
    const obstruction = f.cart.world(-1.5, 0, -2.48),
      blocker = { x: obstruction.x, z: obstruction.z, radius: 0.2 },
      held = calf.group.position.clone();
    f.colliders.push(blocker);
    f.tick(0.1);
    assert.equal(f.heist.snapshot().phase, 'throw-windup');
    assert.equal(f.heist.snapshot().time, 0, 'Blocked throw must not consume windup');
    assert(calf.group.position.equals(held));
    f.colliders.splice(f.colliders.indexOf(blocker), 1);
    const positions = calf.bindPose.map(({ bone }) => bone.position.clone());
    const seen = new Set();
    let maxGap = 0;
    for (let i = 0; i < 120 && f.heist.snapshot().phase !== 'preview-loaded'; i++) {
      f.tick(1 / 60);
      const h = f.heist.snapshot();
      seen.add(h.phase);
      if (['throw-windup', 'throw-swing'].includes(h.phase))
        maxGap = Math.max(maxGap, ...h.handGaps);
      if (i % 6 === 0) {
        assertRailClearance(calf.group, f.cart.root);
        assertRailClearance(giant.object, f.cart.root);
      }
      const before = JSON.stringify([
        h,
        calf.group.position.toArray(),
        calf.group.quaternion.toArray(),
        giant.rig.snapshot(),
      ]);
      f.tick(0);
      assert.equal(
        JSON.stringify([
          f.heist.snapshot(),
          calf.group.position.toArray(),
          calf.group.quaternion.toArray(),
          giant.rig.snapshot(),
        ]),
        before,
      );
      calf.bindPose.forEach(({ bone }, j) => {
        if (bone.name !== 'Body')
          assert(bone.position.distanceTo(positions[j]) < 1e-9, 'Throw stretches a bone');
      });
    }
    assert.equal(f.heist.snapshot().phase, 'preview-loaded');
    assert(maxGap < 0.1, `Hand leaves calf before release: ${maxGap}`);
    assert(seen.has('calf-in-flight') && seen.has('calf-landing'));
    assert.equal(f.cart.cargo, calf);
    const bounds = localBounds(calf.group, f.cart.root);
    assert(bounds.min.y > 0.54 && bounds.min.z > -3.31 && bounds.max.z < -1.3);
    assert.equal(calf.group, original);
    assert(f.heist.previewThrow());
    runUntil(f, 'preview-loaded', 3);
    assert.equal(f.cart.cargo.group, original);
    mkdirSync('output/zombie-calf-throw', { recursive: true });
    writeFileSync(
      `output/zombie-calf-throw/${mode}-validation.json`,
      JSON.stringify(
        {
          mode,
          fps: 60,
          maxHandGap: maxGap,
          phases: [...seen],
          closedRailsClear: true,
          pausedPoseFrozen: true,
          obstructionWaits: true,
          originalInstancePreserved: true,
          boneLengthsPreserved: true,
          cargoBounds: bounds,
          terminal: f.heist.snapshot(),
        },
        null,
        2,
      ),
    );
  });

for (const [mode, fps] of [
  ['underarm', 30],
  ['underarm', 60],
  ['underarm', 120],
  ['two-hand', 60],
])
  test(`unload throw and guard signal ${mode} at ${fps}fps run alongside driver parking`, async () => {
    const f = await fixture(mode),
      calf = f.animal('hornless-calf'),
      original = calf.group;
    const giant = f.zombies.actor('pvz-gargantuar'),
      guard = f.zombies.actor('pvz-gatekeeper');
    const signals = [],
      samples = [],
      paused = new Set();
    let walkingRig = null,
      overlayFrames = 0;
    function checkWalkingPat() {
      if (walkingRig === giant.rig) return;
      walkingRig = giant.rig;
      const patHead = walkingRig.patHead.bind(walkingRig);
      walkingRig.patHead = (...args) => {
        overlayFrames++;
        const before = walkingRig.snapshot();
        patHead(...args);
        const after = walkingRig.snapshot();
        assert.deepEqual(after.legs, before.legs, 'Arm overlay must retain planted-foot IK');
        for (const name of [
          'Hips',
          'Spine',
          'LeftUpLeg',
          'RightUpLeg',
          'LeftLeg',
          'RightLeg',
          'LeftFoot',
          'RightFoot',
        ])
          assert.deepEqual(
            after.joints[name],
            before.joints[name],
            'Pat must retain the walking body pose',
          );
        assert.equal(after.cycles, before.cycles, 'Arm overlay must not advance gait twice');
      };
    }
    const boneLengths = new Map();
    giant.source.traverse((bone) => {
      if (bone.isBone && !bone.name.startsWith('Hips'))
        boneLengths.set(bone, bone.position.length());
    });
    f.heist.connectGateSignalAudio((event, notify) => {
      if (event.type === 'gate-signal-stop') return false;
      signals.push({
        ...event,
        phase: f.heist.snapshot().phase,
        gate: f.corral.snapshot().gateRequested,
        ahead: giant.object.position.x - guard.object.position.x,
      });
      notify('playing');
      notify('stopped');
      return true;
    });
    assert(f.heist.previewDelivery());
    let cleared = false,
      movingDuringThrow = false,
      handoffWhileParking = false,
      minPatGap = Infinity;
    let landingFeet = null,
      patHeading = null,
      previousPat = null,
      patTravel = 0,
      releasedWalk = false;
    for (let i = 0; i < fps * 150; i++) {
      if (f.heist.snapshot().phase === 'pat-guard') checkWalkingPat();
      f.tick(1 / fps);
      const h = f.heist.snapshot(),
        c = f.corral.snapshot();
      if (!h.driverParking)
        assert(
          Math.abs(f.cart.snapshot().speed) < 0.02,
          'Cart must wait for loaded giant to clear the ramp',
        );
      if (h.driverParking && !cleared) {
        const p = f.cart.root.worldToLocal(giant.object.getWorldPosition(new THREE.Vector3()));
        assert(
          p.z < -7.7 &&
            Math.abs(
              giant.object.position.y -
                landscapeHeight(giant.object.position.x, giant.object.position.z),
            ) < 0.01,
        );
        assert.equal(f.cart.cargo, null);
        cleared = true;
      }
      if (h.phase === 'corral-throw-windup') {
        assert(
          giant.object.position.z > 20 && giant.object.position.z < 21,
          'Giant crosses only a short distance through the gate',
        );
        assert.equal(calf.transportOwner, 'heist');
      }
      if (h.phase === 'corral-calf-in-flight') {
        assert.equal(calf.group, original);
        assert.equal(h.carrying, false);
        assert.equal(calf.transportOwner, 'heist');
        assert.equal(f.corral.animals.length, 0, 'Do not hand off before touchdown');
        movingDuringThrow ||= Math.abs(f.cart.snapshot().speed) > 0.02;
        const bounds = localBounds(calf.group, f.corral.model.root);
        assert(
          bounds.min.x > CORRAL.x - 1.95 && bounds.max.x < CORRAL.x + 1.95,
          'Real calf skin clips gate posts in flight',
        );
      }
      if (h.phase === 'corral-calf-landing') {
        const feet = ['FL', 'FR', 'HL', 'HR'].map((name) =>
          calf.source.getObjectByName(name + '_Hoof').getWorldPosition(new THREE.Vector3()),
        );
        if (!landingFeet) landingFeet = feet;
        else
          feet.forEach((foot, j) =>
            assert(foot.distanceTo(landingFeet[j]) < 0.001, 'Landing hoof slides on the ground'),
          );
      }
      if (h.phase === 'pat-guard') {
        patHeading ??= giant.object.rotation.y;
        assert(
          Math.abs(giant.object.rotation.y - patHeading) < 1e-9,
          'No turn to swap hands after walking left',
        );
        assert(
          Math.abs(
            Math.atan2(Math.sin(patHeading + Math.PI / 2), Math.cos(patHeading + Math.PI / 2)),
          ) < 0.12,
          'Giant keeps walking-left heading',
        );
        assert(c.guardGreeting && c.controlled);
        assert(c.gateRequested, 'Guard must wait for the completed gesture');
        minPatGap = Math.min(minPatGap, h.guardPat.gap ?? Infinity);
        if (previousPat) {
          const distance = previousPat.position.distanceTo(giant.object.position);
          assert(
            distance > 0.8 / fps,
            'Giant must keep walking during windup, contact and retraction',
          );
          assert(
            giant.rig.snapshot().cycles > previousPat.cycles,
            'Gait must advance during the pat',
          );
          patTravel += distance;
        }
        previousPat = {
          position: giant.object.position.clone(),
          cycles: giant.rig.snapshot().cycles,
        };
        for (const [bone, length] of boneLengths)
          assert(Math.abs(bone.position.length() - length) < 1e-8, 'Pat must not stretch bones');
        const copies = new Map();
        giant.source.traverse((bone) => {
          if (!bone.isBone) return;
          const name = bone.name.replace(/_0\d+$/, '');
          if (
            !/^(Hips|Spine|Spine1|Spine2|Neck|Neck1|Head|Jaw|(?:Left|Right)(?:Arm|ForeArm|Hand|UpLeg|Leg|Foot|ToeBase|Hand(?:Middle|Ring|Pinky|Index|Thumb)[0-3]))$/.test(
              name,
            )
          )
            return;
          if (copies.has(name))
            assert(
              bone.quaternion.equals(copies.get(name)),
              `Repeated skin skeletons diverge: ${name} ${bone.quaternion.angleTo(copies.get(name))}`,
            );
          else copies.set(name, bone.quaternion.clone());
        });
      }
      if (h.phase === 'delivery-handoff' && !handoffWhileParking) {
        assert.equal(giant.scripted, false);
        assert(f.heist.giantAvailable());
        assert.equal(c.gateRequested, false);
        assert(c.gateAmount > 0, 'Giant is free before the guard finishes closing');
        assert.notEqual(h.driverParking.stage, 'complete', 'Parking must run independently');
        assert.equal(calf.transportOwner, 'corral');
        handoffWhileParking = true;
        previousPat = {
          position: giant.object.position.clone(),
          cycles: giant.rig.snapshot().cycles,
        };
      } else if (h.phase === 'delivery-handoff' && !releasedWalk) {
        assert(
          giant.object.position.x < previousPat.position.x,
          'Free patrol continues left without stopping',
        );
        assert(
          giant.rig.snapshot().cycles > previousPat.cycles,
          'Release must preserve the gait rather than rebind',
        );
        releasedWalk = true;
      }
      if (
        [
          'corral-throw-windup',
          'corral-throw-swing',
          'corral-calf-in-flight',
          'corral-calf-landing',
          'pat-guard',
          'delivery-handoff',
        ].includes(h.phase) &&
        !paused.has(h.phase)
      ) {
        const before = JSON.stringify([
          f.heist.snapshot(),
          f.cart.snapshot(),
          calf.group.position.toArray(),
          giant.rig.snapshot(),
          guard.rig.snapshot(),
        ]);
        f.tick(0);
        assert.equal(
          JSON.stringify([
            f.heist.snapshot(),
            f.cart.snapshot(),
            calf.group.position.toArray(),
            giant.rig.snapshot(),
            guard.rig.snapshot(),
          ]),
          before,
        );
        paused.add(h.phase);
      }
      if (h.phase === 'pat-guard' || !samples.length || samples.at(-1).phase !== h.phase)
        samples.push({
          phase: h.phase,
          time: h.elapsed,
          parking: h.driverParking?.stage,
          gap: h.guardPat.gap,
          phaseTime: h.time,
          giant: giant.object.position.toArray(),
          cycles: giant.rig.snapshot().cycles,
          crown: guard.rig.headTopPoint().toArray(),
          hand: giant.rig.patPalmPoint().toArray(),
        });
      if (h.phase === 'complete') break;
    }
    mkdirSync('output/zombie-walking-guard-pat', { recursive: true });
    writeFileSync(
      `output/zombie-walking-guard-pat/${mode}-${fps}fps.json`,
      JSON.stringify(
        {
          samples,
          minPatGap,
          patTravel,
          signals,
          heist: f.heist.snapshot(),
          corral: f.corral.snapshot(),
        },
        null,
        2,
      ),
    );
    assert.equal(f.heist.snapshot().phase, 'complete');
    assert(cleared && movingDuringThrow && handoffWhileParking);
    assert(minPatGap < 0.08);
    assert(patTravel > 0.75 && releasedWalk);
    assert(overlayFrames > fps * 0.7);
    assert.equal(signals.length, 1);
    assert.equal(signals[0].phase, 'pat-guard');
    assert.equal(signals[0].gate, true);
    assert(signals[0].ahead > 0, 'Pat lands before the giant is parallel with the guard');
    assert.equal(f.heist.snapshot().guardPat.events, 1);
    assert.equal(f.corral.animals[0], calf);
    assert.equal(calf.group, original);
    assert.equal(f.corral.snapshot().gateAmount, 0);
    assert.equal(f.heist.snapshot().driverParking.stage, 'complete');
    assert(!f.heist.snapshot().history.includes('lower-in-corral'));
    assert(!f.heist.snapshot().history.includes('release-corral-grip'));
  });

test('blocked parking and muted brain audio do not delay giant release or guard closing', async () => {
  const f = await fixture('underarm');
  let signals = 0;
  f.heist.connectGateSignalAudio((event) => {
    if (event.type === 'gate-signal-brains') signals++;
    return false;
  });
  assert(f.heist.previewDelivery());
  runUntil(f, 'corral-throw-windup');
  const blocker = { x: CORRAL.x, z: CORRAL.z - 1, radius: 0.2 };
  f.colliders.push(blocker);
  for (let i = 0; i < 20; i++) f.tick(0.1);
  assert.equal(f.heist.snapshot().phase, 'corral-throw-windup');
  assert.equal(f.heist.snapshot().time, 0);
  f.colliders.splice(f.colliders.indexOf(blocker), 1);
  Object.assign(f.car, { x: 164.75, z: -10, heading: 0 });
  runUntil(f, 'delivery-handoff');
  assert(f.heist.giantAvailable());
  assert.equal(f.zombies.actor('pvz-gargantuar').scripted, false);
  assert.equal(signals, 1);
  assert.notEqual(f.heist.snapshot().driverParking.stage, 'complete');
  for (let i = 0; i < 500 && f.corral.snapshot().gateAmount > 0; i++) f.tick(0.1);
  assert.equal(f.corral.snapshot().gateAmount, 0);
  assert.notEqual(f.heist.snapshot().driverParking.stage, 'complete');
  Object.assign(f.car, { x: 132, z: 10, heading: 0 });
  runUntil(f, 'complete');
  assert.equal(signals, 1);
});

test('mutating a heist snapshot cannot rewrite task history, hands or route state', async () => {
  const f = await fixture('underarm');
  assert(f.heist.startManual());
  f.tick(0.05);
  const before = f.heist.snapshot(),
    copy = f.heist.snapshot();
  copy.history.push('injected');
  copy.handGaps[0] = 999;
  if (copy.goal) copy.goal.x = 999;
  if (copy.route?.length) copy.route[0].x = 999;
  assert.deepEqual(f.heist.snapshot(), before);
});
