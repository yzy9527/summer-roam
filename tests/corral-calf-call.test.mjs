import { receiveCorralCargo } from './helpers/corral-animal.mjs';
import { loadModel } from './helpers/model-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { createZombieController } from '../src/field-zombies.js';
import { createCartCargo } from '../src/cart-passengers.js';
import { CORRAL_CALF_CALL, CORRAL_MANUAL_CLOSE } from '../src/zombie-corral.js';
import { createZombieCorral } from './compatibility/zombie-corral.js';
import { CORRAL } from '../src/corral-model.js';
import { createCorralVoice, CORRAL_CALF_CALL_URLS } from '../src/corral-audio.js';
import { drivingHeight } from '../src/world-queries.js';

const load = (path) => loadModel('models/' + path);

async function fixture() {
  const sources = new Map();
  for (const id of ['pvz-browncoat', 'pvz-conehead', 'pvz-gargantuar'])
    sources.set(id, await load(`pvz-zombies/${id}.glb`));
  const scene = new THREE.Scene(),
    colliders = [],
    zombies = createZombieController(sources, colliders);
  scene.add(zombies.root);
  const cart = { root: new THREE.Group() };
  scene.add(cart.root);
  let value = 0.5,
    gateValue = 0.5;
  const corral = createZombieCorral(scene, colliders, cart, zombies, {
    externalDelivery: true,
    random: () => 0.9,
    callRandom: () => value,
    gateRandom: () => gateValue,
  });
  const cargo = createCartCargo(await load('hornless-calf/hornless-calf-rigged.glb'), scene);
  cargo.group.position.set(CORRAL.x, drivingHeight(CORRAL.x, CORRAL.z) + 0.025, CORRAL.z);
  const calf = receiveCorralCargo(corral, cargo, colliders, 'hornless-calf');
  corral.finishDelivery(calf);
  const events = [];
  corral.connectAudio((e) => events.push(e));
  const car = { x: 132, z: 10, heading: 0 };
  const tick = (clock = 0.05, dt = 0.05, time = 'day') => corral.update(dt, car, clock, time);
  return {
    scene,
    corral,
    calf,
    events,
    tick,
    zombies,
    colliders,
    car,
    setRandom: (next) => (value = next),
    setGateRandom: (next) => (gateValue = next),
  };
}

test('real confined calf draws independently at 30-second boundaries; pause freezes and escape resets', async () => {
  const f = await fixture();
  assert.deepEqual(CORRAL_CALF_CALL, { interval: 30, probability: 0.5 });
  const state = () => f.corral.snapshot().animals[0].confinedCall;
  f.tick(29.9);
  assert.equal(state().draws, 0);
  const frozen = { ...state() };
  f.tick(120, 0);
  assert.deepEqual(state(), frozen);
  f.tick(0.1);
  assert.equal(state().draws, 1);
  assert.equal(state().calls, 0, 'exactly 0.5 does not pass');
  f.setRandom(0.499999);
  f.tick(30);
  assert.equal(state().draws, 2);
  assert.equal(state().calls, 1);
  const call = f.events.find((e) => e.type === 'calf-confined-call');
  assert.equal(call.instanceId, f.calf.instanceId);
  assert.equal(call.x, f.calf.x);
  assert.equal(call.z, f.calf.z);
  assert(f.corral.setGateOpen(true));
  f.tick(30);
  assert.equal(state().draws, 2, 'gate operation suspends confined timer');
  f.calf.mode = 'home';
  f.tick();
  assert.equal(state().in, 30);
  assert(f.events.some((e) => e.type === 'animal-stop'));
  assert(!f.events.some((e) => e.type === 'animal-run'), 'confined voice cannot start escape');
});

test('real calf sleeps without periodic cries; every draw still advances and no missed cry is queued', async () => {
  const f = await fixture();
  f.setRandom(0);
  for (let i = 0; i < 180; i++) f.tick(0.05, 0.05, 'night');
  assert.equal(f.corral.snapshot().animals[0].sleep.phase, 'sleeping');
  f.tick(30, 0.05, 'night');
  assert.equal(f.corral.snapshot().animals[0].confinedCall.draws, 1);
  assert.equal(f.events.filter((e) => e.type === 'calf-confined-call').length, 0);
});

function finishManualOpen(f) {
  for (let i = 0; i < 50 && f.corral.snapshot().gateAmount < 1; i++) f.tick();
  assert.equal(f.corral.snapshot().gateAmount, 1);
}

test('visible wooden door opens smoothly for two seconds without the guard, freezes mid-swing, then starts its timer', async () => {
  const f = await fixture();
  const guard = f.zombies.actor('pvz-conehead');
  const original = guard.object.position.clone();
  const click = (target) => {
    f.scene.updateMatrixWorld(true);
    const origin = target.clone().add(new THREE.Vector3(0, 0, -5));
    return f.corral.pat(new THREE.Raycaster(origin, target.clone().sub(origin).normalize()));
  };
  const gate = f.corral.model.gate;
  const target = gate.localToWorld(new THREE.Vector3(CORRAL.gateWidth / 2, 0.8, 0));
  assert(click(target));
  assert.equal(f.corral.snapshot().gateRequested, true);
  assert.equal(f.corral.snapshot().gateAmount, 0);
  assert.equal(f.corral.snapshot().gateOperation.stage, 'manual-opening');
  assert.equal(f.corral.snapshot().manualGate.drawIn, null);
  for (let i = 0; i < 20; i++) f.tick();
  assert(Math.abs(f.corral.snapshot().gateAmount - 0.5) < 1e-8);
  assert.equal(f.corral.snapshot().manualGate.drawIn, null);
  const frozen = JSON.stringify(f.corral.snapshot());
  f.tick(100, 0);
  assert.equal(JSON.stringify(f.corral.snapshot()), frozen);
  finishManualOpen(f);
  assert.equal(f.corral.snapshot().gateAmount, 1);
  assert.equal(f.corral.snapshot().gateOperation.stage, 'idle');
  assert(guard.object.position.equals(original));
  assert.equal(f.corral.snapshot().manualGate.drawIn, 5);
  assert.equal(f.corral.model.latch.position.x, CORRAL.gateWidth - 0.19 - 0.17);
  assert(f.corral.model.gateBodies.some((c) => c.z < CORRAL.z - CORRAL.halfZ - 1));
  assert(click(f.corral.model.handPoint()));
  assert.equal(f.corral.snapshot().gateRequested, false);
  assert.equal(f.corral.snapshot().gateAmount, 0);
  assert.equal(f.corral.snapshot().manualGate.drawIn, null);
  assert(guard.object.position.equals(original));
  assert(f.corral.model.gateBodies.every((c) => Math.abs(c.z - (CORRAL.z - CORRAL.halfZ)) < 1e-9));
});

test('manual opening checks each five-second boundary at 50%, freezes on pause and cancels repeats after notice', async () => {
  const f = await fixture();
  assert.deepEqual(CORRAL_MANUAL_CLOSE, { interval: 5, probability: 0.5 });
  assert(f.corral.setManualGateOpen(true));
  finishManualOpen(f);
  f.tick(4.9);
  assert.equal(f.corral.snapshot().manualGate.draws, 0);
  const frozen = JSON.stringify(f.corral.snapshot());
  f.tick(100, 0);
  assert.equal(JSON.stringify(f.corral.snapshot()), frozen);
  f.tick(0.1);
  assert.equal(f.corral.snapshot().manualGate.draws, 1);
  assert.equal(f.corral.snapshot().manualGate.notices, 0, '0.5 does not pass');
  assert.equal(f.corral.snapshot().gateRequested, true);
  f.setGateRandom(0.499999);
  f.tick(5);
  assert.equal(f.corral.snapshot().manualGate.notices, 1);
  assert.equal(f.corral.snapshot().manualGate.drawIn, null);
  assert.equal(f.corral.snapshot().gateAmount, 1, 'guard must walk over before closing');
  assert.equal(f.corral.snapshot().gateOperation.stage, 'approaching');
  assert.equal(f.corral.snapshot().gateRequested, false);
  f.tick(50);
  assert.equal(
    f.corral.snapshot().manualGate.draws,
    2,
    'no repeated notice while guard is working',
  );
  assert(f.corral.setManualGateOpen(true), 'manual reopen interrupts pending guard close');
  assert.equal(f.corral.snapshot().manualGate.drawIn, 5);
  assert.equal(f.corral.snapshot().gateOperation.stage, 'returning');
  assert.equal(f.corral.snapshot().gateRequested, true);
  f.setGateRandom(0.5);
  f.tick(4.9);
  assert.equal(f.corral.snapshot().manualGate.draws, 0);
  assert(f.corral.setManualGateOpen(false));
  f.tick(30);
  assert.equal(f.corral.snapshot().manualGate.draws, 0, 'closing by hand cancels timer');
  assert.equal(f.corral.snapshot().gateAmount, 0);
});

test('independent missed guard draws can continue for several intervals, then real guard closes and latches', async () => {
  const f = await fixture();
  assert(f.corral.setManualGateOpen(true));
  finishManualOpen(f);
  f.tick(35);
  assert.equal(f.corral.snapshot().manualGate.draws, 7);
  assert.equal(f.corral.snapshot().manualGate.notices, 0);
  assert.equal(f.corral.snapshot().gateAmount, 1);
  f.setGateRandom(0);
  f.tick(5);
  let reached = false;
  for (let i = 0; i < 80 * 20; i++) {
    f.tick();
    const s = f.corral.snapshot();
    if (s.gateAmount < 1 && s.gateAmount > 0) {
      reached = true;
      assert(s.gateOperation.handGap < 0.1);
    }
    if (s.gateAmount === 0 && ['idle', 'returning'].includes(s.gateOperation.stage)) break;
  }
  const s = f.corral.snapshot();
  assert(reached, 'real hand and leaf complete a guarded closing swing');
  assert.equal(s.gateAmount, 0);
  assert.equal(s.manualGate.active, false);
  assert.equal(s.manualGate.notices, 1);
  assert.equal(f.corral.model.latch.position.x, CORRAL.gateWidth - 0.19);
});

test('manual swings keep full swept body and vehicle checks; scripted opening does not start manual timer', async () => {
  const f = await fixture();
  const p = f.corral.model.leafPoint(0.25, 2.3);
  const blocker = { x: p.x, z: p.z, radius: 0.18 };
  f.colliders.push(blocker);
  assert(!f.corral.setManualGateOpen(true));
  assert.equal(f.corral.snapshot().gateAmount, 0);
  assert.equal(f.corral.snapshot().manualGate.lastClick, 'blocked');
  f.colliders.splice(f.colliders.indexOf(blocker), 1);
  assert(f.corral.setManualGateOpen(true));
  finishManualOpen(f);
  Object.assign(f.car, p);
  f.tick(0);
  assert(!f.corral.setManualGateOpen(false), 'car in swept leaf blocks direct close');
  assert.equal(f.corral.snapshot().gateAmount, 1);
  Object.assign(f.car, { x: 132, z: 10 });
  f.tick(0);
  assert(f.corral.setManualGateOpen(false));
  assert(f.corral.prepareGate(true));
  assert.equal(f.corral.snapshot().manualGate.drawIn, null);
});

test('manual reopening cancels a real guard midway through closing and resets his hand and five-second timer', async () => {
  const f = await fixture();
  f.setGateRandom(0);
  assert(f.corral.setManualGateOpen(true));
  finishManualOpen(f);
  f.tick(5);
  for (let i = 0; i < 80 * 20 && f.corral.snapshot().gateAmount > 0.55; i++) f.tick();
  const before = f.corral.snapshot();
  assert(before.gateAmount > 0.5 && before.gateAmount <= 0.55);
  assert.equal(before.gateOperation.stage, 'swinging');
  const actor = f.zombies.actor('pvz-conehead');
  const position = actor.object.position.clone();
  assert(f.corral.setManualGateOpen(true));
  assert.equal(f.corral.snapshot().gateOperation.stage, 'manual-opening');
  assert.equal(f.corral.snapshot().manualGate.drawIn, null);
  finishManualOpen(f);
  const after = f.corral.snapshot();
  assert.equal(after.gateAmount, 1);
  assert.equal(after.gateRequested, true);
  assert.equal(after.gateOperation.reach, 0);
  assert.equal(after.gateOperation.stage, 'returning');
  assert.equal(after.manualGate.drawIn, 5);
  assert(actor.object.position.equals(position), 'manual opening never teleports the guard');
});

test('a calf leaving a manually opened pen does not arm the legacy three-second close', async () => {
  const f = await fixture();
  assert(f.corral.setManualGateOpen(true));
  finishManualOpen(f);
  f.calf.mode = 'escaping';
  f.calf.z = CORRAL.z - CORRAL.halfZ - f.calf.radius - 0.1;
  f.calf.route = [];
  Object.assign(f.calf.collider, { x: f.calf.x, z: f.calf.z });
  f.tick();
  assert.equal(f.corral.snapshot().escapeEvents, 1);
  assert.equal(f.corral.snapshot().closeIn, null);
  f.tick(4.9);
  assert.equal(f.corral.snapshot().gateRequested, true);
  assert.equal(f.corral.snapshot().closeIn, null);
  assert.equal(f.corral.snapshot().manualGate.notices, 0);
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
test('confined calf randomly uses both original recordings; car distance, busy, mute, pause and failure never replay', async () => {
  for (const file of ['niulai.mp3', 'mama.wav'])
    assert.deepEqual(
      readFileSync(new URL('../src/assets/audio/' + file, import.meta.url)),
      readFileSync(new URL('../assets-source/audio/' + file, import.meta.url)),
    );
  const media = Object.fromEntries(
    Object.keys(CORRAL_CALF_CALL_URLS).map((key) => [key, new Media()]),
  );
  let random = 0,
    free = true;
  const voice = createCorralVoice(
    media,
    () => free,
    () => random,
  );
  const e = { type: 'calf-confined-call', id: 'hornless-calf', instanceId: 'calf', x: 164, z: 23 };
  const sync = (distance, enabled = true, volume = 0.8) =>
    voice.sync({ enabled, volume, position: { x: 164 + distance, z: 23 } });
  sync(0);
  assert(voice.event(e, true));
  assert.match(voice.snapshot().file, /niulai\.mp3$/);
  assert.equal(voice.snapshot().gain, 0.8);
  assert(!voice.event(e, true), 'pending play locks repeated calls');
  media['calf-confined-niulai'].emit('playing');
  assert(voice.snapshot().started);
  sync(32.5);
  assert.equal(voice.snapshot().gain, 0.2);
  sync(65);
  assert(!voice.busy());
  assert(!voice.event(e, true), 'far call is discarded');
  sync(0);
  assert(!voice.busy(), 'moving closer does not replay discarded or stopped calls');
  random = 0.5;
  assert(voice.event(e, true));
  assert.match(voice.snapshot().file, /mama\.wav$/);
  voice.event({ ...e, type: 'animal-stop' }, true);
  assert(!voice.busy());
  free = false;
  assert(!voice.event(e, true));
  free = true;
  assert(voice.event(e, true));
  sync(0, false);
  assert(!voice.busy());
  assert(!voice.event(e, false));
  sync(0);
  assert(!voice.busy());
  assert(voice.event(e, true));
  sync(0, true, 0);
  assert(!voice.busy());
  sync(0);
  media['calf-confined-mama'].fail = true;
  assert(voice.event(e, true));
  await Promise.resolve();
  assert(!voice.busy());
});
