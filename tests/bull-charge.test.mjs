import { loadAnimalGeometry as loadGeometry } from './helpers/animal-geometry.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';

import { createAnimalAnimation } from '../src/animal-animation.js';
import { createCowBehavior } from '../src/cow-behavior.js';
import { ANIMAL_PROFILES } from '../src/animal-profiles.js';
import {
  createBullCharge,
  bullPointAllowed,
  bullHornGap,
  bullRoute,
  createBullVoice,
} from '../src/bull-charge.js';
import { bullImpactPose } from '../src/bull-impact.js';
import { landscapeHeight } from '../src/drive.js';

function fakeClock() {
  let now = 0,
    id = 0;
  const jobs = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      jobs.set(++id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      jobs.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, job] of jobs)
        if (now + 1e-6 >= job.at) {
          jobs.delete(id);
          job.fn();
        }
    },
  };
}
async function fixture(x = -9, z = 5) {
  const root = await loadGeometry('copper-cow'),
    group = new THREE.Group(),
    bounds = new THREE.Box3().setFromObject(root, true),
    center = bounds.getCenter(new THREE.Vector3());
  root.position.set(-center.x, -bounds.min.y, -center.z);
  group.add(root);
  group.scale.setScalar(0.4875);
  group.position.set(x, landscapeHeight(x, z) + 0.025, z);
  group.rotation.y = Math.PI / 2;
  const a = {
    id: 'copper-cow',
    x,
    z,
    homeX: x,
    homeZ: z,
    heading: Math.PI / 2,
    radius: 1.4,
    scale: 0.4875,
    speed: 0.28,
    clock: 0,
    distance: 0,
    velocity: 0,
    look: 0,
    behavior: createCowBehavior(),
    group,
  };
  a.rig = createAnimalAnimation(root, group, ANIMAL_PROFILES[a.id]);
  const car = { x: 0, z: 5, heading: 0, speed: 0 },
    hits = [],
    clock = fakeClock();
  const f = createBullCharge(
    [a],
    (x, z, a, c, contact) => bullPointAllowed(x, z, a, [], [a], c, contact),
    (hit) =>
      hits.push({
        hit,
        gap: bullHornGap(a.rig.hornPoints(), car),
        points: a.rig.hornPoints().map((p) => p.toArray()),
      }),
    () => {},
    clock,
  );
  const tick = () => {
    clock.advance(1000 / 60);
    f.update(1 / 60, car);
    a.clock += 1 / 60;
    group.position.set(a.x, landscapeHeight(a.x, a.z) + 0.025, a.z);
    group.rotation.y = a.heading;
    a.rig.update(1 / 60, a, 0, 0);
  };
  return { a, car, f, tick, hits, clock };
}
function trigger(f, car) {
  assert.equal(f.tap(car), false);
  assert.equal(f.tap(car), false);
  assert.equal(f.tap(car), true);
  f.event('playing');
}
test('actual bull horns contact car once and bull returns to the original point', async () => {
  const { a, car, f, tick, hits } = await fixture();
  assert.equal(a.rig.hornPoints().length, 2);
  trigger(f, car);
  for (let i = 0; i < 60; i++) tick();
  f.event('time', 4.8);
  for (let i = 0; i < 3000 && f.busy(); i++) tick();
  assert.equal(hits.length, 1, JSON.stringify({ state: f.snapshot(), hits }));
  assert.ok(hits[0].gap <= 0.055);
  assert.equal(f.snapshot().reason, 'complete');
  assert.equal(f.busy(), false);
  assert.ok(Math.hypot(a.x + 9, a.z - 5) < 0.06);
  assert.equal(a.chargePose, 0);
});
test('third tap, real media timing, pause freeze, busy taps, and moving-car cancellation', async () => {
  for (const stage of ['pending', 'warning', 'approaching', 'strike']) {
    const { a, car, f, tick, hits } = await fixture();
    if (stage === 'pending') {
      assert.equal(f.tap(car), false);
      assert.equal(f.tap(car), false);
      assert.equal(f.tap(car), true);
    } else trigger(f, car);
    if (!['pending', 'warning'].includes(stage)) {
      f.event('time', 4.8);
      for (let i = 0; i < 2000 && f.snapshot().phase !== stage; i++) tick();
      assert.equal(f.snapshot().phase, stage);
    }
    const snapshot = f.snapshot();
    f.update(0, car);
    assert.deepEqual(f.snapshot(), snapshot);
    assert.equal(f.tap(car), false);
    car.speed = 0.1;
    tick();
    for (let i = 0; i < 2400 && f.busy(); i++) tick();
    assert.equal(hits.length, 0);
    assert.equal(f.busy(), false);
    assert.ok(Math.hypot(a.x + 9, a.z - 5) < 0.06);
  }
});
test('real start-to-car route avoids water and blocked route cancels without impact', async () => {
  const { a, car, f, tick, hits } = await fixture(-28, 8);
  trigger(f, car);
  f.event('time', 5);
  for (let i = 0; i < 6000 && f.busy(); i++) tick();
  assert.equal(hits.length, 1, JSON.stringify(f.snapshot()));
  assert.equal(f.snapshot().reason, 'complete');
  assert.ok(Math.hypot(a.x + 28, a.z - 8) < 0.06);
  const clock = fakeClock(),
    blocked = createBullCharge(
      [a],
      () => false,
      () => assert.fail('blocked impact'),
      () => {},
      clock,
    );
  trigger(blocked, car);
  blocked.event('time', 5);
  clock.advance(1000);
  for (let i = 0; i < 100; i++) blocked.update(0.1, car);
  assert.equal(blocked.snapshot().reason, 'no-safe-route');
  assert.equal(blocked.busy(), false);
});
test('grid route detours around obstacles and rejects enclosed goals', () => {
  const safe = (x, z) => !(x > -6 && x < -4 && z > -1 && z < 8);
  const route = bullRoute({ x: -9, z: 4 }, { x: 0, z: 4 }, safe);
  assert.ok(route.length > 1);
  assert.equal(
    bullRoute({ x: -9, z: 4 }, { x: 0, z: 4 }, () => false),
    null,
  );
});
class Media extends EventTarget {
  constructor() {
    super();
    this.paused = true;
    this.currentTime = 0;
    this.calls = 0;
  }
  play() {
    this.calls++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
test('bull voice uses unmodified asset, one playback through ended, and stops without replay', async () => {
  assert.deepEqual(
    fs.readFileSync(new URL('../assets-source/audio/cow-moo.mp3', import.meta.url)),
    fs.readFileSync(new URL('../src/assets/audio/cow-moo.mp3', import.meta.url)),
  );
  const media = new Media(),
    events = [],
    v = createBullVoice(media, { event: (...e) => events.push(e) }),
    hit = { id: 'copper-cow', charge: true };
  assert.equal(v.tap(hit, false), false);
  assert.equal(v.tap(hit, true), true);
  assert.equal(v.tap(hit, true), false);
  media.dispatchEvent(new Event('playing'));
  media.currentTime = 4.8;
  media.dispatchEvent(new Event('timeupdate'));
  media.dispatchEvent(new Event('ended'));
  assert.equal(v.tap(hit, true), false);
  v.stop();
  assert.equal(v.tap(hit, true), true);
  v.cancel();
  assert.equal(v.snapshot().busy, false);
  assert.equal(media.calls, 2);
  assert.ok(events.some((e) => e[0] === 'cancel'));
});

test('actual bull sprints at 20km/h with gathered flight and planted stance targets', async () => {
  const { a, car, f, tick } = await fixture(-28, 8);
  trigger(f, car);
  f.event('time', 5);
  let peak = 0,
    running = 0,
    air = 0,
    previous = null;
  for (let i = 0; i < 1500 && f.busy(); i++) {
    tick();
    peak = Math.max(peak, a.velocity);
    const pose = a.rig.snapshot();
    if (pose.gait === 'gallop') {
      running++;
      if (pose.legs.every((l) => !l.stance)) air++;
      for (const leg of pose.legs) {
        const before = previous?.legs.find((l) => l.name === leg.name);
        if (leg.stance && before?.stance) {
          assert.ok(
            Math.hypot(...leg.target.map((v, i) => v - before.target[i])) < 1e-6,
            'support target slides',
          );
          assert.ok(
            Math.hypot(...leg.foot.map((v, i) => v - leg.target[i])) < 0.012,
            `actual planted hoof misses target at frame ${i}: ${JSON.stringify(leg)}`,
          );
          assert.ok(
            Math.hypot(...leg.foot.map((v, i) => v - before.foot[i])) < 0.025,
            'actual planted hoof slides',
          );
        }
        assert.ok(leg.foot.every(Number.isFinite));
      }
    }
    previous = pose;
  }
  assert.ok(peak >= 5.4 && peak <= 5.51, `sprint speed ${peak}`);
  assert.ok(running > 30 && air > 5);
  const frozen = a.rig.snapshot();
  a.rig.update(0, a, 0, 0);
  assert.deepEqual(a.rig.snapshot(), frozen);
});
test('audio rejection releases pending playback and stale rejection cannot cancel a new request', async () => {
  const media = new Media(),
    events = [];
  let rejectFirst;
  media.play = () =>
    new Promise((resolve, reject) => {
      rejectFirst = reject;
    });
  const v = createBullVoice(media, { event: (type) => events.push(type) }),
    hit = { id: 'copper-cow', charge: true };
  v.tap(hit, true);
  v.stop();
  media.play = () => Promise.resolve();
  v.tap(hit, true);
  rejectFirst(new Error('stale'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(v.snapshot().busy, true);
  assert.equal(events.length, 0);
  v.stop();
  media.play = () => Promise.reject(new Error('blocked'));
  v.tap(hit, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(v.snapshot().busy, false);
  assert.ok(events.includes('cancel'));
});

test('charge starts one second after real playing; later single taps wait for voice and five-second cooldown after completed recoil', async () => {
  const { car, f, tick, hits } = await fixture();
  assert.equal(f.tap(car), false);
  assert.equal(f.tap(car), false);
  assert.equal(f.tap(car), true);
  for (let i = 0; i < 60; i++) tick();
  assert.equal(f.snapshot().phase, 'pending');
  f.event('playing');
  for (let i = 0; i < 59; i++) tick();
  assert.equal(f.snapshot().phase, 'warning');
  for (let i = 0; i < 2; i++) tick();
  assert.equal(f.snapshot().phase, 'approaching');
  for (let i = 0; i < 1500 && !hits.length; i++) tick();
  assert.equal(hits.length, 1);
  assert.equal(f.snapshot().cooldown, 0);
  assert.equal(hits[0].hit.flip, false);
  f.event('ended');
  assert.equal(f.tap(car), false);
  for (let i = 0; i < 150; i++) tick();
  assert.ok(f.snapshot().cooldown > 0);
  assert.equal(f.tap(car), false);
  for (let i = 0; i < 310; i++) tick();
  assert.equal(f.tap(car), true, 'one tap retriggers after voice and cooldown, even during return');
  f.event('cancel');
});
test('car movement clears attack and cooldown; parking and one new tap can restart, without queued replay', async () => {
  const { car, f, tick } = await fixture();
  trigger(f, car);
  car.speed = 0.15;
  tick();
  assert.ok(['idle', 'returning'].includes(f.snapshot().phase));
  assert.equal(f.snapshot().reason, 'car-moved');
  assert.equal(f.snapshot().voiceReleased, true);
  assert.equal(f.tap(car), false);
  car.speed = 0;
  car.x += 0.1;
  tick();
  assert.equal(f.tap(car), true);
  assert.equal(f.snapshot().phase, 'pending');
  f.event('cancel');
});
test('completed return still waits for the natural voice end before accepting the next tap', async () => {
  const { car, f, tick } = await fixture();
  trigger(f, car);
  for (let i = 0; i < 3000 && f.busy(); i++) tick();
  assert.equal(f.snapshot().phase, 'idle');
  assert.equal(f.tap(car), false);
  f.event('ended');
  assert.equal(f.tap(car), true);
  f.event('cancel');
});

test('second tap plays moo warning, third immediately switches without overlap or stale failure', async () => {
  assert.deepEqual(
    fs.readFileSync(new URL('../assets-source/audio/cow-moo.mp3', import.meta.url)),
    fs.readFileSync(new URL('../src/assets/audio/cow-moo.mp3', import.meta.url)),
  );
  const speech = new Media(),
    warning = new Media(),
    events = [];
  let rejectWarning;
  warning.play = () => {
    warning.calls++;
    warning.paused = false;
    return new Promise((resolve, reject) => {
      rejectWarning = reject;
    });
  };
  const v = createBullVoice(speech, { event: (type) => events.push(type) }, () => {}, warning);
  assert.equal(v.tap({ id: 'copper-cow', taps: 1 }, true), false);
  assert.equal(v.tap({ id: 'copper-cow', taps: 2 }, true), true);
  assert.equal(warning.calls, 1);
  assert.equal(speech.calls, 0);
  assert.equal(v.tap({ id: 'copper-cow', taps: 3, charge: true }, true), true);
  assert.equal(warning.paused, true);
  assert.equal(speech.paused, false);
  rejectWarning(new Error('old warning interrupted'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(v.snapshot().busy, true);
  assert.equal(events.length, 0);
  v.cancel();
  assert.equal(speech.paused, true);
  assert.equal(warning.paused, true);
});

test('wall timer launches even with no audio progress and low frame rate; cancel clears stale timer', async () => {
  const { car, f, clock, tick } = await fixture();
  tick();
  trigger(f, car);
  clock.advance(999);
  f.update(0.001, car);
  assert.equal(f.snapshot().phase, 'warning');
  f.event('playing');
  clock.advance(1);
  f.update(0.001, car);
  assert.equal(f.snapshot().voiceTime, 0);
  assert.equal(f.snapshot().phase, 'approaching');
  f.event('cancel');
  clock.advance(10000);
  f.update(0.01, car);
  assert.notEqual(f.snapshot().phase, 'approaching');
});
test('later successful hits flip and cancelled attempts do not count', async () => {
  const { car, f, tick, hits } = await fixture();
  trigger(f, car);
  for (let i = 0; i < 3000 && f.busy(); i++) tick();
  f.event('ended');
  assert.equal(hits[0].hit.flip, false);
  assert.equal(f.tap(car), true);
  f.event('playing');
  f.event('cancel');
  for (let i = 0; i < 3000 && f.busy(); i++) tick();
  assert.equal(f.snapshot().impacts, 1);
  assert.equal(f.tap(car), true);
  f.event('playing');
  for (let i = 0; i < 3000 && f.busy(); i++) tick();
  assert.equal(hits.length, 2);
  assert.equal(hits[1].hit.flip, true);
  assert.equal(hits[1].hit.impacts, 2);
});
test('whole-car flip holds upside down and restores continuous upright pose', () => {
  assert.equal(bullImpactPose({ time: 0.3, flip: false }).roll, 0);
  const hit = { flip: true, side: -1 };
  for (let t = 0; t <= 3.8; t += 0.01) {
    const p = bullImpactPose({ ...hit, time: t });
    assert.ok(Number.isFinite(p.roll) && p.lift >= 0);
  }
  const upside = bullImpactPose({ ...hit, time: 1.8 });
  assert.equal(upside.roll, -Math.PI);
  assert.ok(upside.lift > 1.45);
  assert.equal(upside.locked, true);
  const restored = bullImpactPose({ ...hit, time: 3.7 });
  assert.ok(Math.abs(restored.roll) < 1e-12);
  assert.ok(Math.abs(restored.shift) < 1e-12);
  assert.equal(restored.lift, 0);
  assert.equal(restored.locked, false);
  assert.equal(restored.done, true);
});

test('five-second cooldown uses wall time and freezes while paused', async () => {
  const { car, f, tick, clock, hits } = await fixture();
  trigger(f, car);
  for (let i = 0; i < 2000 && f.snapshot().phase !== 'returning'; i++) tick();
  assert.equal(hits.length, 1);
  assert.equal(f.snapshot().cooldown, 5);
  f.event('ended');
  clock.advance(3000);
  f.update(0, car);
  assert.equal(f.snapshot().cooldown, 5);
  clock.advance(4999);
  f.update(0.001, car);
  assert.equal(f.tap(car), false);
  clock.advance(1);
  f.update(0.001, car);
  assert.equal(f.tap(car), true);
  f.event('cancel');
});

test('three vehicle hits cause a first-impact flip; busy collisions ignored and each successful flip requires three new hits', async () => {
  const { car, f, tick, hits } = await fixture();
  assert.deepEqual(f.vehicleHit(car), { ignored: false, triggered: false });
  assert.equal(f.vehicleHit(car).triggered, false);
  assert.equal(f.snapshot().vehicleHits, 2);
  assert.equal(f.snapshot().taps, 0);
  assert.equal(f.vehicleHit(car).triggered, true);
  assert.equal(f.snapshot().mode, 'revenge');
  assert.equal(f.vehicleHit(car).ignored, true);
  assert.equal(f.snapshot().vehicleHits, 3);
  assert.equal(f.tap(car), false);
  const frozen = f.snapshot();
  f.update(0, car);
  assert.deepEqual(f.snapshot(), frozen);
  f.event('cancel');
  assert.equal(f.snapshot().phase, 'warning', 'mute/pause cancels media only');
  for (let i = 0; i < 3000 && f.busy(); i++) tick();
  assert.equal(hits.length, 1, JSON.stringify(f.snapshot()));
  assert.equal(hits[0].hit.flip, true);
  assert.equal(hits[0].hit.mode, 'revenge');
  assert.equal(f.snapshot().vehicleHits, 0);
  assert.equal(f.vehicleHit(car).triggered, false);
  assert.equal(f.vehicleHit(car).triggered, false);
  assert.equal(f.vehicleHit(car).triggered, true);
  for (let i = 0; i < 3000 && f.busy(); i++) tick();
  assert.equal(hits.length, 2);
  assert.equal(f.snapshot().vehicleHits, 0);
});
test('protection follows moving car, flips on first contact and leaves vehicle-hit count independent', async () => {
  const { car, f, tick, hits } = await fixture();
  f.vehicleHit(car);
  assert.equal(f.protect(car), true);
  assert.equal(f.protect(car), false);
  assert.equal(f.snapshot().vehicleHits, 1);
  car.speed = 0.2;
  for (let i = 0; i < 80; i++) {
    car.z += 0.005;
    tick();
  }
  car.speed = 0;
  assert.notEqual(f.snapshot().reason, 'car-moved');
  for (let i = 0; i < 3000 && f.busy(); i++) tick();
  assert.equal(hits.length, 1, JSON.stringify(f.snapshot()));
  assert.equal(hits[0].hit.mode, 'protect');
  assert.equal(hits[0].hit.flip, true);
  assert.equal(f.snapshot().vehicleHits, 1);
});
test('blocked retaliation preserves three-hit threshold for a later real retry', async () => {
  const { a, car, clock } = await fixture();
  const f = createBullCharge(
    [a],
    () => false,
    () => assert.fail('blocked impact'),
    () => {},
    clock,
  );
  f.vehicleHit(car);
  f.vehicleHit(car);
  assert.equal(f.vehicleHit(car).triggered, true);
  for (let i = 0; i < 20; i++) f.update(0.1, car);
  assert.equal(f.snapshot().reason, 'no-safe-route');
  assert.equal(f.busy(), false);
  assert.equal(f.snapshot().vehicleHits, 3);
  assert.equal(f.vehicleHit(car).triggered, true);
});
