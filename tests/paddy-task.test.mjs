import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rescueFixture } from './helpers/rescue-fixture.mjs';
import { createPaddyTask, PLOUGH_SECONDS, PLOUGH_WAIT } from '../src/paddy-task.js';
import { createSceneActions } from '../src/scene-actions.js';
import { createZombieLookout } from '../src/zombie-lookout.js';
import { createWhipHolster } from '../src/paddy-whip-holster.js';
import { createCord } from '../src/paddy-plough-props.js';

async function fixture() {
  const f = await rescueFixture(() => 0.9, { withFlag: true });
  createZombieLookout(f.scene, f.colliders, f.zombies);
  const fire = await f.load('campsite-cooking-set.glb');
  const bounds = new THREE.Box3().setFromObject(fire, true);
  const scale = 2.1 / bounds.getSize(new THREE.Vector3()).y;
  f.colliders.push({
    x: 156.5,
    z: 24,
    radius:
      Math.hypot(
        Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)),
        Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)),
      ) * scale,
    height: 2.1,
    campsite: true,
  });
  const task = createPaddyTask(
    f.scene,
    f.colliders,
    f.zombies,
    f.fieldAnimals,
    f.corral,
    await f.load('paddy-plough.glb'),
    { random: () => 0 },
  );
  const calf = f.animal('hornless-calf'),
    group = calf.group;
  const events = [];
  task.connectAudio((e, notify) => {
    events.push(e);
    if (e.type === 'cow-call') notify?.('playing');
    return true;
  });
  const field = {
    animals: f.fieldAnimals,
    corral: f.corral,
    zombies: f.zombies,
    paddyPloughing: task,
  };
  const menu = createSceneActions({
    getField: () => field,
    getCar: () => null,
    getTimeOfDay: () => 'day',
  });
  const target = { type: 'actor', id: 'pvz-ploughman' };
  const tick = (dt = 0.05, car = null) => {
    f.zombies.update(dt, car);
    f.corral.update(dt, car, dt, 'day');
    task.update(dt, car);
  };
  const runUntil = (phase, limit = 550) => {
    for (let t = 0; task.progress().phase !== phase && t < limit; t += 0.05) tick();
    assert.equal(task.progress().phase, phase, JSON.stringify(task.progress()));
  };
  const confine = () => {
    f.place(calf, 164, 23.5, Math.PI);
    calf.motion = 0;
    f.corral.finishDelivery(calf);
  };
  return { ...f, task, calf, group, events, menu, target, tick, runUntil, confine };
}

test('idle guard and field worker patrol their own ranges independently before any task', async () => {
  const f = await fixture();
  const guard = f.zombies.actor('pvz-gatekeeper'),
    worker = f.task.worker;
  const actors = [guard, worker];
  const starts = actors.map((a) => a.object.position.clone());
  const travel = [0, 0];
  for (let frame = 0; frame < 160; frame++) {
    const before = actors.map((a) => a.object.position.clone());
    f.tick();
    actors.forEach((a, i) => {
      assert.equal(a.scripted, false);
      const p = a.object.position;
      travel[i] += before[i].distanceTo(p);
      const distance =
        ((p.x - a.patrolHome.x) / a.layout.patrolX) ** 2 +
        ((p.z - a.patrolHome.z) / a.layout.patrolZ) ** 2;
      assert(distance <= 1.01, 'Idle workers stay inside their assigned patrol area');
    });
  }
  assert(
    travel.every((distance) => distance > 0.3),
    'Both idle roles visibly move',
  );
  assert(
    starts[1].x < 121 && worker.object.position.x < 121,
    'Worker stays beside the existing field',
  );
});

test('carried whip follows the real animated waist skin through turns, with a physical strap and attached handle', async () => {
  const f = await fixture(),
    worker = f.task.worker;
  const root = new THREE.Group(),
    whip = createCord(0.013, '#493c2b');
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 1, 8));
  root.add(whip.mesh, handle);
  f.scene.add(root);
  const holster = createWhipHolster(root, worker, whip, handle);
  let first;
  for (let i = 0; i < 90; i++) {
    worker.object.rotation.y = i * 0.035;
    worker.object.position.x += 0.008;
    worker.rig.update(1 / 60, 0.008, () => 0.12, worker.object.rotation.y);
    worker.object.updateMatrixWorld(true);
    holster.update(true);
    const s = holster.snapshot(),
      mesh = worker.source.getObjectByName(s.mesh);
    const skin = mesh.localToWorld(mesh.getVertexPosition(s.vertex, new THREE.Vector3()));
    const anchor = new THREE.Vector3(...s.anchor);
    assert(Math.abs(anchor.distanceTo(skin) - 0.018) < 1e-6, 'mount stays 18mm from the real coat');
    const holder = root.getObjectByName('贴腰鞭子挂扣');
    assert.equal(holder.children.length, 2);
    const handleTop = handle.localToWorld(new THREE.Vector3(0, -0.5, 0));
    assert(
      handleTop.distanceTo(holder.localToWorld(new THREE.Vector3(-0.025, -0.085, 0.02))) < 1e-6,
    );
    first ??= anchor.clone();
  }
  assert(first.distanceTo(new THREE.Vector3(...holster.snapshot().anchor)) > 0.3);
  holster.update(false);
  assert.equal(holster.snapshot().visible, false);
  holster.dispose();
  assert.equal(root.getObjectByName('贴腰鞭子挂扣'), undefined);
});

test('captured original calf completes timed ploughing and returns through the real gate; no default ox, escape, duplicate owner or timer drift', async () => {
  const f = await fixture(),
    { task, calf, menu, target } = f;
  assert.equal(task.cow, null);
  assert.equal(PLOUGH_SECONDS, 300);
  assert(!menu.actions({ type: 'actor', id: 'pvz-flagbearer' }).some((a) => /plough/.test(a.id)));
  assert.equal(f.scene.getObjectByName('水田耕牛'), undefined);
  assert.match(menu.actions(target)[0].reason, /抓回/);
  assert.equal(task.start(), false);
  f.confine();
  assert.equal(menu.execute(target, 'start-plough').ok, true);
  assert.equal(task.start(), false);
  assert.equal(f.corral.setManualGateOpen(true), false);
  assert.equal(f.fieldAnimals.transportAvailable(calf.id), false);
  const taps = calf.taps;
  f.corral.touch(calf, { x: calf.x, z: calf.z });
  assert.equal(calf.taps, taps);
  f.runUntil('hitching');
  assert(
    task.worker.object.position.x < 121,
    'the worker waits at the field while the leader fetches the calf',
  );
  assert.equal(task.worker.scripted, true);
  assert.equal(
    task.progress().workerPhase,
    'waiting',
    'worker prepares independently before the calf arrives',
  );
  assert(
    Math.hypot(
      task.worker.object.position.x - PLOUGH_WAIT.x,
      task.worker.object.position.z - PLOUGH_WAIT.z,
    ) < 0.06,
  );
  assert(task.progress().carrying && task.progress().holster.visible);
  const waitingWorker = task.worker.object.position.clone();
  for (let i = 0; i < 20; i++) f.tick();
  assert(
    waitingWorker.distanceTo(task.worker.object.position) < 0.001,
    'waiting worker stays clear of the calf entrance',
  );
  const ropeEnds = task.snapshot().lead;
  assert(new THREE.Vector3(...ropeEnds[0]).distanceTo(new THREE.Vector3(...ropeEnds[1])) < 0.22);
  assert(task.progress().history.includes('signal'));
  f.runUntil('ploughing');
  assert.equal(task.cow, calf);
  assert.equal(calf.group, f.group);
  assert.equal(calf.transportOwner, 'plough');
  assert.equal(task.progress().remaining, PLOUGH_SECONDS);
  const paused = JSON.stringify(task.snapshot());
  task.update(0, null);
  assert.equal(JSON.stringify(task.snapshot()), paused);
  const blocker = { x: calf.x, z: calf.z, radius: 0.25 };
  f.colliders.push(blocker);
  for (let i = 0; i < 20; i++) f.tick();
  assert.equal(task.progress().remaining, PLOUGH_SECONDS);
  f.colliders.splice(f.colliders.indexOf(blocker), 1);
  let work = 0,
    maxSpeed = 0,
    contacts = 0,
    boost = false;
  while (task.progress().phase === 'ploughing' && work < PLOUGH_SECONDS + 1) {
    const previous = new THREE.Vector3(calf.x, 0, calf.z);
    f.tick();
    work += 0.05;
    assert(previous.distanceTo(new THREE.Vector3(calf.x, 0, calf.z)) < 0.04);
    assert.equal(calf.group, f.group);
    assert.equal(calf.mode, 'plough-reserved');
    const s = task.snapshot();
    maxSpeed = Math.max(maxSpeed, s.speed);
    contacts = s.whip.contacts;
    boost ||= s.boost > 0;
  }
  assert(Math.abs(work - PLOUGH_SECONDS) < 0.11);
  assert(contacts > 0);
  assert(boost && maxSpeed > 0.4);
  assert(f.events.some((e) => e.type === 'cow-call' && e.cowId === 'hornless-calf'));
  assert.equal(task.progress().phase, 'unhitch');
  f.runUntil('idle');
  assert.equal(calf.group, f.group);
  assert.equal(calf.transportOwner, 'corral');
  assert.equal(calf.mode, 'confined');
  assert.equal(f.corral.snapshot().escapeEvents, 0);
  assert.equal(f.corral.gateState().gateAmount, 0);
  assert(!calf.source.getObjectByName('牵牛头笼'));
  assert(!calf.source.getObjectByName('贴合肩颈的单牛木轭'));
  assert.equal(task.availability(), '');
  assert(task.start());
  assert(task.stop());
  f.runUntil('idle', 90);
  assert.equal(calf.transportOwner, 'corral');
  assert.equal(f.corral.gateState().gateAmount, 0);
});

for (const fps of [30, 60, 120]) {
  test(`real calf convoy follows continuously at ${fps}fps; searches yield, pause freezes and traffic waits safely`, async () => {
    const f = await fixture();
    f.confine();
    assert(f.task.start());
    f.runUntil('outbound');
    const dt = 1 / fps;
    let continuousFrames = 0,
      pendingFrames = 0,
      trafficChecked = false;
    for (let t = 0; t < 180 && f.task.progress().phase === 'outbound'; t += dt) {
      const leader = f.task.leader.object.position.clone();
      f.tick(dt);
      const s = f.task.progress();
      assert(s.navigation.slices <= 64);
      for (const actor of [f.task.leader, f.task.worker]) {
        assert(
          Math.hypot(actor.collider.x - f.calf.x, actor.collider.z - f.calf.z) >=
            actor.collider.radius + f.calf.radius + 0.08,
          'planning ahead must still preserve actual convoy body clearance',
        );
      }
      if (s.navigation.pending) {
        pendingFrames++;
        const before = JSON.stringify(s);
        f.task.update(0, null);
        assert.equal(JSON.stringify(f.task.progress()), before);
      }
      if (
        f.calf.x < 130 &&
        f.calf.x > 125 &&
        leader.distanceTo(f.task.leader.object.position) > 0.001
      ) {
        assert(f.calf.velocity > 0.15, `unobstructed follow stopped: ${JSON.stringify(s)}`);
        continuousFrames++;
      }
      if (!trafficChecked && leader.x < 140 && leader.x > 138) {
        const away = { x: 130, z: -5, heading: Math.PI, speed: 25 };
        const moving = f.task.leader.object.position.clone();
        for (let i = 0; i < fps / 2; i++) f.tick(dt, away);
        assert(
          moving.distanceTo(f.task.leader.object.position) > 0.1,
          'a fast vehicle going away must not halt the convoy',
        );
        const approaching = { x: 130, z: 5, heading: 0, speed: 12 };
        const yielding = f.task.leader.object.position.clone();
        for (let i = 0; i < fps / 2; i++) f.tick(dt, approaching);
        assert(
          yielding.distanceTo(f.task.leader.object.position) < 0.001,
          'a vehicle on course for the crossing still has priority',
        );
        const car = { x: 132, z: 20, heading: 0, speed: 0 };
        const parked = f.task.leader.object.position.clone();
        for (let i = 0; i < fps; i++) f.tick(dt, car);
        assert(parked.distanceTo(f.task.leader.object.position) < 0.001);
        assert(f.task.progress().blocked);
        trafficChecked = true;
      }
      assert.equal(f.calf.group, f.group);
      assert.equal(f.calf.transportOwner, 'plough');
    }
    assert.equal(f.task.progress().phase, 'assembling', JSON.stringify(f.task.progress()));
    assert(continuousFrames > fps * 3);
    assert(pendingFrames > 1);
    assert(trafficChecked);
  });
}

test('manual finish uses the same return sequence and stale menu actions cannot restart or release the calf early', async () => {
  const f = await fixture();
  f.confine();
  assert(f.task.start());
  f.runUntil('outbound');
  assert.equal(f.corral.gateState().gateAmount, 1, 'departure begins while the guard is closing');
  f.runUntil('ploughing');
  const idleActor = f.zombies.actor('pvz-browncoat');
  const idleStart = idleActor.object.position.clone();
  for (let i = 0; i < 100; i++) f.tick();
  assert(
    idleStart.distanceTo(idleActor.object.position) > 0.1,
    'unrelated zombies keep patrolling during ploughing',
  );
  const before = f.task.progress().remaining;
  assert(before < PLOUGH_SECONDS && before > PLOUGH_SECONDS - 10);
  assert.equal(f.menu.execute(f.target, 'stop-plough').ok, true);
  assert.equal(f.task.progress().phase, 'unhitch');
  assert.equal(f.menu.execute(f.target, 'start-plough').ok, false);
  assert.equal(f.task.stop(), false);
  f.runUntil('returning');
  for (let i = 0; i < 1600 && f.task.progress().workerPhase !== 'idle'; i++) f.tick();
  assert.equal(f.task.progress().workerPhase, 'idle');
  assert(f.task.worker.object.position.x < 121);
  assert.equal(f.task.worker.scripted, false, 'worker can patrol before the calf is returned');
  let workerTravel = 0;
  for (let i = 0; i < 120; i++) {
    const at = f.task.worker.object.position.clone();
    f.tick();
    workerTravel += at.distanceTo(f.task.worker.object.position);
  }
  assert(
    workerTravel > 0.3,
    'Worker actually walks after storing the plough, clear of its collider',
  );
  f.runUntil('idle');
  assert.equal(f.task.progress().remaining, before);
  assert.equal(f.corral.gateState().gateAmount, 0);
  assert.equal(f.calf.transportOwner, 'corral');
});

test('active incremental navigation snapshots stay serializable and isolated', async () => {
  const f = await fixture();
  f.confine();
  for (let i = 0; i < 400 && f.task.availability(); i++) f.tick();
  assert(f.task.start());
  for (let i = 0; i < 10; i++) {
    f.tick();
    const before = f.task.snapshot(),
      copy = f.task.snapshot();
    assert.doesNotThrow(() => JSON.stringify(before));
    copy.history.push('injected');
    copy.task.history.length = 0;
    for (const route of copy.task.routes) {
      assert.equal(typeof route.searchPending, 'boolean');
      route.goal.x = 999;
      if (route.path?.length) route.path[0].x = 999;
    }
    assert.deepEqual(f.task.snapshot(), before);
  }
});
