import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { COMEDY_ACTIONS, comedyPose, createComedy } from '../src/gameplay/zombies/comedy.js';
import { createZombieController } from '../src/field-zombies.js';
import { createSceneActions } from '../src/scene-actions.js';
import { loadModel } from './helpers/model-loader.mjs';

test('automatic comedy waits 10–20 active seconds, avoids repeats, freezes and yields', () => {
  for (const random of [() => 0, () => 0.999999]) {
    let clear = true,
      finished = 0;
    const show = createComedy({
      random,
      clear: () => clear,
      settle: () => true,
      pose() {},
      finish() {
        finished++;
      },
    });
    const initial = show.snapshot().wait;
    assert(initial >= 10 && initial <= 20);
    for (let t = 0; t < initial - 0.1; t += 0.1) show.update(0.1);
    assert(!show.active);
    show.update(0.2);
    const first = show.snapshot().action;
    assert(first);
    const paused = show.snapshot();
    show.update(0);
    assert.deepEqual(show.snapshot(), paused);
    assert(!show.start('dance'), 'no queued or overlapping performance');
    while (show.active) show.update(0.1);
    assert.equal(finished, 1);
    assert(show.snapshot().wait >= 10 && show.snapshot().wait <= 20);
    while (!show.active) show.update(0.1);
    assert.notEqual(show.snapshot().action, first);
    clear = false;
    show.update(0.1);
    assert(!show.active);
    assert.equal(finished, 2);
  }
});

test('performances finish stopping from arbitrary patrol stride phases instead of waiting on an unreachable future foot target', async () => {
  const { controller: z } = await fixture();
  for (let phase = 1; phase <= 24; phase++) {
    for (let i = 0; i < phase * 3; i++) z.update(1 / 60, null);
    assert(z.performComedy('disco', null));
    let frames = 0;
    while (z.snapshot().zombies[0].comedy.settling && frames++ < 90) z.update(1 / 60, null);
    assert(frames < 90, 'stride phase ' + phase + ' settles within 1.5 seconds');
    z.take('pvz-browncoat');
    z.release('pvz-browncoat');
  }
});

async function fixture() {
  const source = await loadModel('models/pvz-zombies/pvz-browncoat.glb');
  const colliders = [];
  const controller = createZombieController(
    new Map([['pvz-browncoat', source]]),
    colliders,
    () => 0,
    { comedy: true, random: () => 0.5 },
  );
  return { controller, colliders, actor: controller.actor('pvz-browncoat') };
}

test('seven real-GLB performances retain bone lengths, supporting shoes, synchronized skins and resume walking at 30/60/120fps', async () => {
  for (const fps of [30, 60, 120]) {
    const { controller: z, actor } = await fixture();
    const rest = new Map();
    actor.source.traverse((n) => {
      if (n.isBone && !n.name.startsWith('Hips')) rest.set(n, n.position.clone());
    });
    const signatures = new Set();
    z.update(0.3, null);
    for (const action of COMEDY_ACTIONS) {
      assert(z.performComedy(action.id, null));
      let frames = 0,
        peak = null;
      while (z.snapshot().zombies[0].comedy.action) {
        z.update(1 / fps, null);
        frames++;
        const state = z.snapshot().zombies[0];
        if (state.comedy.time > 1 && !peak) peak = JSON.stringify(state.joints);
        for (const [n, p] of rest) assert(n.position.distanceTo(p) < 1e-8, n.name + ' length');
        const feet = state.legs.map((l) => new THREE.Vector3(...l.foot));
        const pose = comedyPose(action.id, state.comedy.time, action.duration);
        const airborne = (pose.feet?.every((f) => f[1] > 0) ?? false) || state.run > 0.5;
        if (!airborne)
          assert(
            feet.some((p, i) => p.distanceTo(new THREE.Vector3(...state.legs[i].planted)) < 0.02),
            'grounded phases retain a supporting shoe',
          );
        actor.source.traverse((n) => {
          if (!n.isBone) return;
          assert(n.quaternion.toArray().every(Number.isFinite));
        });
        const copies = new Map();
        actor.source.traverse((n) => {
          if (!n.isBone) return;
          const key = n.name.replace(/_0\d+$/, '');
          if (copies.has(key))
            assert(
              n.quaternion.clone().normalize().angleTo(copies.get(key).clone().normalize()) < 1e-6,
              key + ' copies',
            );
          else copies.set(key, n.quaternion.clone());
        });
        if (frames === 30) {
          const before = JSON.stringify(z.snapshot());
          z.update(0, null);
          assert.equal(JSON.stringify(z.snapshot()), before);
        }
        assert(frames < fps * 10, 'must finish');
      }
      signatures.add(peak);
      const before = actor.object.position.clone();
      for (let i = 0; i < fps; i++) z.update(1 / fps, null);
      assert(actor.object.position.distanceTo(before) > 0.05, 'patrol resumes');
    }
    assert.equal(signatures.size, COMEDY_ACTIONS.length, 'distinct poses');
  }
});

test('space checks and task takeover reject stale manual requests without affecting cloned roles', async () => {
  const { controller: z, colliders, actor } = await fixture();
  const registry = createSceneActions({ getField: () => ({ zombies: z }), getCar: () => null });
  const target = { type: 'actor', id: 'pvz-browncoat' };
  assert.equal(registry.actions(target).length, 8);
  assert(!registry.actions(target).some((a) => a.id === 'comedy-arm'));
  assert(!z.performComedy('arm', null));
  assert(registry.execute(target, 'comedy-dance').ok);
  assert.equal(registry.actions(target)[0].reason.code, 'actions.comedyBusy');
  z.update(0.1, null);
  z.take('pvz-browncoat');
  assert.equal(z.snapshot().zombies[0].comedy.action, null);
  assert(!registry.execute(target, 'comedy-scare').ok);
  z.release('pvz-browncoat');
  colliders.push({ x: actor.object.position.x + 1.3, z: actor.object.position.z, radius: 0.3 });
  assert(!z.performComedy('dance', null));
  colliders.pop();
  assert(z.performComedy('dance', null));
  z.addGatekeeper();
  assert.equal(z.snapshot().zombies.find((a) => a.id === 'pvz-gatekeeper').comedy, undefined);
});

test('disco has real two-shoe flight, planted landings and overhead arms at 30/60/120fps', async () => {
  for (const fps of [30, 60, 120]) {
    const { controller: z, actor } = await fixture();
    const root = actor.object.position.clone();
    const joints = new Map();
    actor.source.traverse((n) => {
      if (n.isBone) joints.set(n.name.replace(/_0\d+$/, ''), n);
    });
    assert(z.performComedy('disco', null));
    let flights = 0,
      flying = false,
      overhead = false,
      landed = 0;
    while (z.snapshot().zombies[0].comedy.action) {
      z.update(1 / fps, null);
      const state = z.snapshot().zombies[0];
      const lift = state.legs.map((l) => l.foot[1] - l.planted[1]);
      assert(
        lift.every((v) => v > -0.008),
        'shoes cannot sink below support',
      );
      const nowFlying = lift.every((v) => v > 0.04);
      if (nowFlying && !flying) flights++;
      if (!nowFlying && flying) landed++;
      flying = nowFlying;
      for (const side of ['Left', 'Right']) {
        if (
          joints.get(side + 'Hand').getWorldPosition(new THREE.Vector3()).y >
          joints.get(side + 'Arm').getWorldPosition(new THREE.Vector3()).y + 0.15
        )
          overhead = true;
        if (state.comedy.time > 1 && state.comedy.time < 7) {
          const shoulder = joints.get(side + 'Arm').getWorldPosition(new THREE.Vector3());
          const elbow = joints.get(side + 'ForeArm').getWorldPosition(new THREE.Vector3());
          const wrist = joints.get(side + 'Hand').getWorldPosition(new THREE.Vector3());
          assert(
            elbow.clone().sub(shoulder).angleTo(wrist.clone().sub(elbow)) > 0.25 &&
              elbow.clone().sub(shoulder).angleTo(wrist.clone().sub(elbow)) < 1.7,
            'disco elbows extend and recover naturally',
          );
          const hand = joints.get(side + 'Hand');
          const rest = actor.restPose.find(
            (entry) => entry.name.replace(/_0\d+$/, '') === side + 'Hand',
          ).rotation;
          assert(
            hand.quaternion.clone().normalize().angleTo(rest.clone().normalize()) < 1e-6,
            'disco wrists follow the forearms without folding',
          );
        }
      }
      assert(actor.object.position.distanceTo(root) < 1e-8, 'dancing does not translate the root');
    }
    assert(flights >= 3 && landed === flights, `hops and landings: ${flights}/${landed}`);
    assert(overhead, 'arms rise above the shoulders');
    for (const leg of z.snapshot().zombies[0].legs)
      assert(new THREE.Vector3(...leg.foot).distanceTo(new THREE.Vector3(...leg.planted)) < 0.02);
  }
});

test('pursuit really travels from dragging walk to run, freezes and resumes without a root jump', async () => {
  for (const fps of [30, 60, 120]) {
    const { controller: z, actor } = await fixture();
    const origin = actor.object.position.clone();
    assert(z.performComedy('pursuit', null));
    let peakSpeed = 0,
      slowSpeed = 0,
      flight = false,
      paused = false;
    while (z.snapshot().zombies[0].comedy.action) {
      const from = actor.object.position.clone();
      z.update(1 / fps, null);
      const state = z.snapshot().zombies[0];
      const speed = from.distanceTo(actor.object.position) * fps;
      peakSpeed = Math.max(peakSpeed, speed);
      if (state.comedy.time > 1.2 && state.comedy.time < 1.8)
        slowSpeed = Math.max(slowSpeed, speed);
      if (state.run > 0.9 && state.legs.every((l) => l.swinging)) flight = true;
      assert(speed < 1.6, 'no translation jump');
      if (!paused && state.run > 0.9) {
        paused = true;
        const snapshot = JSON.stringify(z.snapshot());
        z.update(0, null);
        assert.equal(JSON.stringify(z.snapshot()), snapshot);
      }
    }
    assert(peakSpeed > 1.4 && slowSpeed > 0.3 && slowSpeed < 0.5);
    assert(flight && paused, 'uses genuine running gait including flight');
    assert(actor.object.position.distanceTo(origin) > 3);
    const end = actor.object.position.clone();
    z.update(1 / fps, null);
    assert(actor.object.position.distanceTo(end) < 0.02, 'patrol resumes from the new position');
  }
});

test('pursuit checks the full travel corridor and yields during a running step', async () => {
  const { controller: z, actor, colliders } = await fixture();
  const origin = actor.object.position.clone();
  const forward = new THREE.Vector3(
    Math.sin(actor.object.rotation.y),
    0,
    Math.cos(actor.object.rotation.y),
  );
  const obstacle = origin.clone().addScaledVector(forward, 3);
  colliders.push({ x: obstacle.x, z: obstacle.z, radius: 0.4 });
  assert(z.performComedy('pursuit', null));
  for (let i = 0; i < 300 && z.snapshot().zombies[0].comedy.action; i++) z.update(1 / 60, null);
  assert.equal(z.snapshot().zombies[0].comedy.action, null);
  assert(
    actor.object.position.distanceTo(obstacle) > 1.7,
    'stops before the swept body reaches an obstacle',
  );
  colliders.pop();
  assert(z.performComedy('pursuit', null));
  for (let i = 0; i < 195; i++) z.update(1 / 60, null);
  assert(z.snapshot().zombies[0].run > 0.9);
  const before = actor.object.position.clone();
  z.take('pvz-browncoat');
  assert(actor.object.position.distanceTo(before) < 1e-8);
  assert.equal(z.snapshot().zombies[0].comedy.action, null);
  assert.equal(z.snapshot().zombies[0].run, 0);
});

test('both new actions visibly nod and shake; pursuit hands repeatedly reach and sweep', async () => {
  const { controller: z, actor } = await fixture();
  const hands = [];
  const rightHands = [];
  actor.source.traverse((n) => {
    if (n.isBone && /^LeftHand_0\d+$/.test(n.name)) hands.push(n);
    if (n.isBone && /^RightHand_0\d+$/.test(n.name)) rightHands.push(n);
  });
  for (const id of ['disco', 'pursuit']) {
    assert(z.performComedy(id, null));
    const head = [[], [], []],
      forward = [],
      lateral = [],
      asymmetric = [];
    while (z.snapshot().zombies[0].comedy.action) {
      z.update(1 / 60, null);
      const state = z.snapshot().zombies[0];
      if (state.comedy.time < 2.6 || state.comedy.time > 5) continue;
      const pose = comedyPose(
        id,
        state.comedy.time,
        COMEDY_ACTIONS.find((a) => a.id === id).duration,
      );
      for (let i = 0; i < 3; i++) head[i].push(pose.head[i]);
      const point = actor.object.worldToLocal(hands[0].getWorldPosition(new THREE.Vector3()));
      const rightPoint = actor.object.worldToLocal(
        rightHands[0].getWorldPosition(new THREE.Vector3()),
      );
      forward.push(point.z);
      lateral.push(point.x);
      asymmetric.push(Math.abs(point.z - rightPoint.z));
    }
    const span = (values) => Math.max(...values) - Math.min(...values);
    assert(
      head.every((values) => span(values) > 0.15),
      id + ' head nod, yaw and roll',
    );
    if (id === 'pursuit') {
      assert(span(forward) > 0.18, 'hands thrust forward then recover');
      assert(span(lateral) > 0.1, 'hands sweep out to the sides');
      assert(
        asymmetric.filter((gap) => gap > 0.12).length / asymmetric.length > 0.5,
        'left and right strokes have a clearly different phase',
      );
    }
  }
});
