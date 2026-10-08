import { loadModel as load } from './helpers/model-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';

import { createZombieController } from '../src/field-zombies.js';
import { createWoodCart } from './compatibility/zombie-wood-cart.js';
import { createZombieCorral } from './compatibility/zombie-corral.js';
import { createCartCargo } from '../src/cart-passengers.js';
import { createCorralVoice } from '../src/corral-audio.js';
import { CORRAL, createCorralModel } from '../src/corral-model.js';
import { createCorralGateControl } from '../src/corral-gate-control.js';
import { clearAnimalSegment, dryAnimalPoint, findAnimalPath } from '../src/corral-navigation.js';
import { inAnimalMeadow } from '../src/animal-meadow.js';
import { drivingHeight } from '../src/world-queries.js';

async function fixture() {
  const sources = new Map();
  for (const id of ['pvz-browncoat', 'pvz-conehead', 'pvz-gargantuar'])
    sources.set(id, await load(`models/pvz-zombies/${id}.glb`));
  const colliders = [],
    scene = new THREE.Scene(),
    zombies = createZombieController(sources, colliders);
  scene.add(zombies.root);
  const source = await load('models/copper-cow/copper-cow-rigged.glb');
  const cart = createWoodCart(
    await load('models/zombie-wood-cart.glb'),
    source,
    zombies,
    colliders,
  );
  scene.add(cart.root);
  let drawValue = 0.9;
  const corral = createZombieCorral(scene, colliders, cart, zombies, { random: () => drawValue });
  const events = [];
  corral.connectAudio((e) => events.push(e));
  const car = { x: 132, z: 10, heading: 0 };
  const tick = (dt = 1 / 30, clock = dt, timeOfDay = 'day') => {
    zombies.update(dt, car);
    cart.update(dt, car);
    corral.update(dt, car, clock, timeOfDay);
  };
  const until = (predicate, seconds = 180) => {
    for (let i = 0; i < seconds * 30; i++) {
      if (predicate()) return;
      tick();
    }
    assert(
      predicate(),
      JSON.stringify({
        phase: corral.snapshot().phase,
        animals: corral.snapshot().animals.map((a) => ({
          x: a.x,
          z: a.z,
          mode: a.mode,
          blocked: a.blocked,
          route: a.route,
        })),
        zombies: zombies
          .snapshot()
          .zombies.map((z) => ({ id: z.id, position: z.position, blocked: z.blocked })),
      }),
    );
  };
  return {
    scene,
    colliders,
    zombies,
    cart,
    corral,
    events,
    source,
    tick,
    until,
    setRandom: (v) => {
      drawValue = v;
    },
  };
}

test('real cart cow dismounts, follows a nose lead into the pen, then stays behind the latched gate with touch-only bull feedback', async () => {
  const f = await fixture(),
    phases = new Set();
  const originalSource = f.source.getObjectByName('Head').quaternion.clone();
  let ropeSeen = false,
    dismountSeen = false,
    forwardSteps = 0,
    lastGateAmount = 0,
    handledFrames = 0,
    gateFreezeChecked = false;
  for (let i = 0; i < 30 * 150; i++) {
    const cowBefore = f.corral.animals[0];
    const before = cowBefore && { x: cowBefore.x, z: cowBefore.z, mode: cowBefore.mode };
    f.tick();
    const s = f.corral.snapshot();
    if (Math.abs(s.gateAmount - lastGateAmount) > 1e-6) {
      handledFrames++;
      assert(Math.abs(s.gateOperation.facingError) < 0.09, 'operator faces the moving door handle');
      assert(s.gateOperation.handGap < 0.1, 'real right hand reaches the iron ring');
      const armCopies = [];
      f.zombies.actor('pvz-conehead').source.traverse((n) => {
        if (n.isBone && n.name.replace(/_0\d+$/, '') === 'RightArm') armCopies.push(n.quaternion);
      });
      for (const q of armCopies)
        assert(
          q.clone().normalize().angleTo(armCopies[0].clone().normalize()) < 1e-6,
          'hand gesture synchronizes every skinned rig',
        );
      if (!gateFreezeChecked) {
        const frozenGate = JSON.stringify(f.corral.snapshot());
        f.corral.update(0, { x: 132, z: 10 }, 30);
        assert.equal(
          JSON.stringify(f.corral.snapshot()),
          frozenGate,
          'paused door, body facing and reaching hand all freeze',
        );
        gateFreezeChecked = true;
      }
    }
    lastGateAmount = s.gateAmount;
    phases.add(s.phase);
    ropeSeen ||= s.ropeVisible;
    dismountSeen ||= s.phase === 'dismounting';
    const cow = f.corral.animals[0];
    if (cow) {
      for (const id of ['pvz-browncoat', 'pvz-conehead', 'pvz-gargantuar']) {
        const actor = f.zombies.actor(id);
        assert(
          Math.hypot(cow.x - actor.object.position.x, cow.z - actor.object.position.z) >=
            cow.radius + actor.collider.radius + 0.1,
          'zombie and cow bodies remain separated during unloading, turning and exit',
        );
      }
    }
    if (before?.mode === 'leading' && cow.mode === 'leading') {
      const dx = cow.x - before.x,
        dz = cow.z - before.z;
      if (Math.hypot(dx, dz) > 1e-6) {
        forwardSteps++;
        assert(
          Math.abs(dx * Math.cos(cow.heading) - dz * Math.sin(cow.heading)) < 1e-8,
          'led cow moves along its body, without sideways sliding',
        );
        const nose = cow.rig.contactPoint();
        const tail = cow.source.getObjectByName('Tail').getWorldPosition(new THREE.Vector3());
        const anatomical = new THREE.Vector2(nose.x - tail.x, nose.z - tail.z).normalize();
        assert(
          anatomical.dot(new THREE.Vector2(dx, dz).normalize()) > 0.95,
          'the real nose and tail agree with movement, rather than reversed Euler Y',
        );
        const guide = f.zombies.actor('pvz-browncoat').object.position;
        const desired = Math.atan2(guide.x - cow.x, guide.z - cow.z);
        assert(
          Math.abs(Math.atan2(Math.sin(desired - cow.heading), Math.cos(desired - cow.heading))) <
            0.13,
          'cow faces the rope holder before stepping',
        );
      }
    }
    if (s.phase === 'ready') break;
  }
  const s = f.corral.snapshot();
  assert.equal(
    s.phase,
    'ready',
    JSON.stringify({
      driverRoute: s.driverRoute,
      animals: s.animals.map((a) => ({
        x: a.x,
        z: a.z,
        mode: a.mode,
        route: a.route,
        blocked: a.blocked,
      })),
      zombies: f.zombies.snapshot().zombies.map((z) => ({ id: z.id, position: z.position })),
    }),
  );
  assert(ropeSeen && dismountSeen);
  assert(forwardSteps > 100);
  assert(handledFrames > 100);
  assert(phases.has('unloading') && phases.has('leading') && phases.has('leaving'));
  assert.equal(f.corral.animals[0].group, f.cart.cargo.group, 'same skin transfers out of the bed');
  assert.equal(f.cart.cargo.group.parent, f.scene);
  assert(f.cart.snapshot().cargoReleased);
  assert(
    f.source.getObjectByName('Head').quaternion.angleTo(originalSource) < 1e-6,
    'meadow source unchanged',
  );
  f.until(() => f.corral.snapshot().gateAmount < 0.01, 20);
  const a = f.corral.animals[0];
  f.corral.touch(a, { x: a.x + 1, z: a.z });
  f.corral.touch(a, { x: a.x + 1, z: a.z });
  f.corral.touch(a, { x: a.x + 1, z: a.z });
  assert.equal(a.taps, 3);
  assert.equal(a.chargeRun, 0);
  assert.equal(a.chargePose, 0);
  for (let i = 0; i < 30 * 25; i++) {
    f.tick();
    assert.equal(a.mode, 'confined');
    assert(a.x > CORRAL.x - CORRAL.halfX + a.radius);
    assert(a.z > CORRAL.z - CORRAL.halfZ + a.radius);
  }
  assert(f.events.some((e) => e.type === 'animal-tap'));
  const frozen = JSON.stringify(f.corral.snapshot()),
    pose = a.source.getObjectByName('Head').quaternion.clone();
  f.corral.update(0, { x: 132, z: 10 }, 30);
  assert.equal(JSON.stringify(f.corral.snapshot()), frozen);
  assert(a.source.getObjectByName('Head').quaternion.angleTo(pose) < 1e-6);
  const taps = a.taps;
  const bodyRay = new THREE.Raycaster(new THREE.Vector3(a.x, 8, a.z), new THREE.Vector3(0, -1, 0));
  assert(f.corral.pat(bodyRay), 'visible skin accepts the real click route');
  assert.equal(a.taps, taps + 1);
  const cover = new THREE.Mesh(new THREE.BoxGeometry(4, 0.2, 4), new THREE.MeshBasicMaterial());
  cover.position.set(a.x, 5, a.z);
  f.scene.add(cover);
  assert.equal(f.corral.pat(bodyRay), false, 'opaque scenery occludes touch');
  assert.equal(a.taps, taps + 1);
  f.scene.remove(cover);
  const gateRay = new THREE.Raycaster(
    new THREE.Vector3(164, drivingHeight(164, 20) + 0.86, 21),
    new THREE.Vector3(0, 0, -1),
  );
  assert(f.corral.pat(gateRay), 'a visible gate rail opens the gate');
  assert(f.corral.snapshot().gateRequested);
  f.until(() => f.corral.snapshot().gateOpen, 30);
  assert(f.corral.setGateOpen(false), 'a fresh close request may reverse an opening action');
  assert.equal(f.corral.snapshot().gateRequested, false);
  f.until(
    () =>
      f.corral.snapshot().gateAmount === 0 &&
      ['idle', 'returning'].includes(f.corral.snapshot().gateOperation.stage),
    30,
  );
  assert.equal(
    f.corral.model.latch.position.x,
    CORRAL.gateWidth - 0.19,
    'closed gate is latched after reversal',
  );
});

test('40% boundary and thirty-second repeat draws, No once, three-second close request, short chase and real gallop home', async () => {
  const f = await fixture();
  f.until(() => f.corral.snapshot().phase === 'ready');
  f.until(() => f.corral.snapshot().gateAmount < 0.01, 20);
  f.setRandom(0.4);
  assert(f.corral.setGateOpen(true));
  f.until(() => f.corral.snapshot().draws === 1, 30);
  assert.equal(f.corral.animals[0].mode, 'confined', 'exact .4 does not escape');
  const draws = f.corral.snapshot().draws;
  for (let i = 0; i < 29 * 30; i++) f.tick();
  assert.equal(f.corral.snapshot().draws, draws);
  const paused = JSON.stringify(f.corral.snapshot());
  f.corral.update(0, { x: 132, z: 10 }, 100);
  assert.equal(JSON.stringify(f.corral.snapshot()), paused);
  f.setRandom(0.399999);
  f.until(() => f.corral.snapshot().draws === 2, 2);
  const a = f.corral.animals[0];
  assert.equal(a.mode, 'escaping');
  f.until(() => a.outside, 30);
  assert.equal(f.events.filter((e) => e.type === 'zombie-no').length, 1);
  assert(f.corral.snapshot().closeIn > 2.8);
  assert.equal(f.corral.snapshot().chase.mode, 'chasing');
  const roadblock = { x: 168, z: -27, radius: 4 };
  f.colliders.push(roadblock);
  for (let i = 0; i < 85; i++) f.tick();
  assert.equal(f.corral.snapshot().closePending, false);
  f.until(() => f.corral.snapshot().closePending || !f.corral.snapshot().gateOpen, 2);
  let gallop = false,
    flight = false,
    maxSpeed = 0,
    maxFootGap = 0,
    worstFoot = null;
  f.until(() => f.corral.snapshot().chase.mode === 'returning', 5);
  for (let i = 0; i < 30 * 8; i++) f.tick();
  assert.equal(a.mode, 'escaping');
  assert.equal(a.routeGoal, 'exit', 'an unavailable next leg cannot be marked reached');
  assert(Math.hypot(a.x - 164, a.z - 17.8) < 0.15, 'wait at the last reachable exit');
  f.colliders.splice(f.colliders.indexOf(roadblock), 1);
  assert(
    dryAnimalPoint(168, -27, a.radius + 0.08, f.colliders, { x: 132, z: 10, heading: 0 }),
    'southern goal becomes available after clearing the obstacle',
  );
  for (let i = 0; i < 30 * 160; i++) {
    f.tick();
    const pose = a.rig.snapshot();
    gallop ||= pose.gait === 'gallop';
    flight ||= pose.gait === 'gallop' && pose.legs.every((l) => !l.stance);
    maxSpeed = Math.max(maxSpeed, a.velocity);
    for (const l of pose.legs)
      if (pose.gait === 'gallop' && l.stance) {
        const gap = Math.abs(l.foot[1] - l.target[1]);
        if (gap > maxFootGap) {
          maxFootGap = gap;
          worstFoot = { gap, leg: l, velocity: a.velocity, heading: a.heading, x: a.x, z: a.z };
        }
      }
    assert(Number.isFinite(a.x) && Number.isFinite(a.chargeRun));
    if (a.mode === 'home') break;
  }
  assert.equal(
    a.mode,
    'home',
    JSON.stringify({
      x: a.x,
      z: a.z,
      heading: a.heading,
      routeGoal: a.routeGoal,
      route: a.route,
      blocked: a.blocked,
      planWait: a.planWait,
    }),
  );
  assert(inAnimalMeadow(a.x, a.z));
  assert(gallop && flight);
  assert(maxSpeed > 3);
  assert(maxFootGap < 0.025, 'actual planted hoof follows ground: ' + JSON.stringify(worstFoot));
  assert.equal(a.chargeRun, 0);
  assert.equal(f.events.filter((e) => e.type === 'zombie-no').length, 1);
  assert(f.events.filter((e) => e.type === 'animal-run').length > 1);
  assert(!f.corral.snapshot().gateOpen);
  assert.equal(f.corral.snapshot().chase.mode, 'idle');
  mkdirSync(new URL('../output/zombie-corral/', import.meta.url), { recursive: true });
  writeFileSync(
    new URL('../output/zombie-corral/validation.json', import.meta.url),
    JSON.stringify(
      {
        realAssets: true,
        gallop,
        flight,
        maxSpeed,
        maxFootGap,
        returned: [a.x, a.z],
        draws: f.corral.snapshot().draws,
        noRequests: 1,
        threeSecondClose: true,
      },
      null,
      2,
    ),
  );
});

test('confined wolf is silent on touch and gate sweep waits for an animal occupying the opening', async () => {
  const f = await fixture();
  f.until(() => f.corral.snapshot().phase === 'ready');
  f.until(() => f.corral.snapshot().gateAmount < 0.01, 20);
  const cargo = createCartCargo(
    await load('models/reference-wolf/reference-wolf-rigged.glb'),
    new THREE.Group(),
    0.45,
  );
  cargo.release(f.scene);
  cargo.group.position.set(166, drivingHeight(166, 23), 23);
  const wolf = f.corral.receive(cargo, 'reference-wolf');
  wolf.mode = 'confined';
  const count = f.events.length;
  f.corral.touch(wolf, { x: 166.5, z: 23 });
  assert.equal(f.events.length, count);
  assert.equal(wolf.taps, 1);
  assert.equal(wolf.behavior.reactionTime, 0);
  assert(f.corral.setGateOpen(true));
  f.until(() => f.corral.snapshot().gateAmount > 0.99, 30);
  const a = f.corral.animals[0];
  a.x = 164;
  a.z = 20;
  a.route = [];
  a.wait = 100;
  assert(f.corral.setGateOpen(false));
  for (let i = 0; i < 30; i++) f.tick();
  assert(f.corral.snapshot().gateOpen, 'body in swept gate holds door open');
  a.z = 23;
  f.until(() => !f.corral.snapshot().gateOpen, 30);
});

test('real gate operator completes both swings at 30, 60 and 120 fps without catching the latch post', async () => {
  const source = await load('models/pvz-zombies/pvz-conehead.glb');
  for (const fps of [30, 60, 120]) {
    const scene = new THREE.Scene(),
      colliders = [],
      dt = 1 / fps;
    const zombies = createZombieController(new Map([['pvz-conehead', source]]), colliders);
    scene.add(zombies.root);
    const actor = zombies.actor('pvz-conehead'),
      home = { x: actor.object.position.x, z: actor.object.position.z };
    const model = createCorralModel(scene, colliders);
    const car = { x: 132, z: 10, heading: 0 };
    const routeTo = (goal) =>
      findAnimalPath(
        actor.object.position,
        goal,
        (x, z) =>
          dryAnimalPoint(x, z, actor.collider.radius, colliders, car, (c) => c === actor.collider),
        { step: 0.25, padding: 8 },
      ) ?? [];
    const gate = createCorralGateControl(model, zombies, colliders, {
      operator: 'pvz-conehead',
      home,
      routeTo,
      getCar: () => car,
      canClose: () => true,
      sound: () => {},
      walkRoute(route, dt) {
        if (zombies.walk('pvz-conehead', route[0], dt, { speed: 0.7, car })) route.shift();
      },
    });
    for (const open of [true, false]) {
      gate.request(open);
      let previous = gate.amount,
        finished = false;
      for (let i = 0; i < fps * 70; i++) {
        gate.update(dt);
        const s = gate.snapshot();
        if (Math.abs(gate.amount - previous) > 1e-7) {
          assert(Math.abs(s.facingError) < 0.09, 'faces handle at ' + fps + ' fps');
          assert(s.handGap < 0.1, 'real hand stays at handle at ' + fps + ' fps');
        }
        previous = gate.amount;
        if (s.stage === 'idle') {
          finished = true;
          break;
        }
      }
      assert(
        finished,
        JSON.stringify({
          fps,
          open,
          amount: gate.amount,
          operation: gate.snapshot(),
          position: actor.object.position,
          blocked: actor.blocked,
        }),
      );
      assert.equal(gate.amount, open ? 1 : 0);
      assert.equal(gate.open, open);
    }
  }
});

test('navigation rejects unavailable paths and samples scenery, rice, road, water and car clearance', () => {
  const allowed = (x, z) => !(x > 1 && x < 3 && z > -2 && z < 2);
  const path = findAnimalPath({ x: 0, z: 0 }, { x: 4, z: 0 }, allowed, { step: 0.5, padding: 4 });
  assert(path);
  let at = { x: 0, z: 0 };
  for (const p of path) {
    assert(clearAnimalSegment(at, p, allowed));
    at = p;
  }
  assert.equal(
    findAnimalPath({ x: 0, z: 0 }, { x: 4, z: 0 }, () => false),
    null,
  );
  assert(!dryAnimalPoint(0, 10, 1, [], null));
  assert(!dryAnimalPoint(-4.6, 20, 1, [], null));
  assert(!dryAnimalPoint(164, 23, 1, [{ x: 164, z: 23, radius: 0.2 }], null));
  assert(!dryAnimalPoint(164, 23, 1, [], { x: 164, z: 23, heading: 0 }));
});

class Media {
  listeners = new Map();
  currentTime = 0;
  volume = 0;
  plays = 0;
  paused = true;
  fail = false;
  addEventListener(type, fn) {
    this.listeners.set(type, fn);
  }
  emit(type) {
    this.listeners.get(type)?.();
  }
  play() {
    this.plays++;
    this.paused = false;
    return this.fail ? Promise.reject(new Error('failed')) : Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
test('No MP3 is unchanged; corral voice locks pending play, suppresses wolves and repeats, releases on pause/failure and respects other voices', async () => {
  assert.deepEqual(
    readFileSync(new URL('../assets-source/audio/zombies_noooomp.mp3', import.meta.url)),
    readFileSync(new URL('../src/assets/audio/zombies_noooomp.mp3', import.meta.url)),
  );
  const no = new Media(),
    cow = new Media();
  let free = true;
  const voice = createCorralVoice({ 'zombie-no': no, 'copper-cow': cow }, () => free);
  voice.sync({ enabled: true, volume: 0.22, position: { x: 164, z: 20 } });
  const event = { type: 'zombie-no', id: 'copper-cow', instanceId: 'one', x: 164, z: 20 };
  assert(voice.event(event, true));
  assert(voice.busy());
  assert(!voice.event(event, true));
  assert.equal(no.plays, 1);
  no.emit('playing');
  assert(voice.snapshot().started);
  no.emit('ended');
  assert(!voice.busy());
  assert(!voice.event({ ...event, type: 'animal-tap', id: 'reference-wolf' }, true));
  free = false;
  assert(!voice.event(event, true));
  free = true;
  no.fail = true;
  assert(voice.event(event, true));
  await Promise.resolve();
  assert(!voice.busy());
  no.fail = false;
  assert(voice.event(event, true));
  voice.sync({ enabled: false, volume: 0.22, position: { x: 164, z: 20 } });
  assert(!voice.busy());
  assert(no.paused);
  assert(!voice.event(event, false));
});

test('night corral sleep waits for delivery; a sleeping cow stands before touch or gate escape', async () => {
  const f = await fixture();
  let transit = false;
  for (let i = 0; i < 30 * 180 && f.corral.snapshot().phase !== 'ready'; i++) {
    f.tick(1 / 30, 1 / 30, 'night');
    for (const a of f.corral.snapshot().animals)
      if (['dismounting', 'leading'].includes(a.mode)) {
        transit = true;
        assert.equal(a.sleep.phase, 'awake', 'moving cargo is never folded');
      }
  }
  assert(transit);
  assert.equal(f.corral.snapshot().phase, 'ready');
  for (let i = 0; i < 30 * 10; i++) f.tick(1 / 30, 1 / 30, 'night');
  const a = f.corral.animals[0];
  assert.equal(f.corral.snapshot().animals[0].sleep.phase, 'sleeping');
  const count = f.events.filter((e) => e.type === 'animal-tap').length;
  f.corral.touch(a, { x: a.x + 1, z: a.z });
  f.corral.touch(a, { x: a.x + 1, z: a.z });
  assert.equal(f.events.filter((e) => e.type === 'animal-tap').length, count);
  assert.equal(f.corral.snapshot().animals[0].sleep.phase, 'waking');
  for (let i = 0; i < 65; i++) f.tick(1 / 30, 1 / 30, 'night');
  assert.equal(f.events.filter((e) => e.type === 'animal-tap').length, count + 1);
  for (let i = 0; i < 30 * 25; i++) f.tick(1 / 30, 1 / 30, 'night');
  assert.equal(f.corral.snapshot().animals[0].sleep.phase, 'sleeping');
  f.setRandom(0.1);
  assert(f.corral.setGateOpen(true));
  let waking = false,
    escaping = false;
  for (let i = 0; i < 30 * 35; i++) {
    f.tick(1 / 30, 1 / 30, 'night');
    const s = f.corral.snapshot().animals[0];
    waking ||= s.sleep.phase === 'waking';
    if (s.mode === 'escaping') {
      assert.equal(s.sleep.amount, 0, 'escape starts upright');
      escaping = true;
      break;
    }
  }
  assert(waking && escaping);
});
