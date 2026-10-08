import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addFieldAnimals } from '../src/field-animals.js';
import { addFieldMountain } from '../src/field-mountain.js';
import { createWolfHowlVoice } from '../src/wolf-howl-voice.js';
import {
  MOUNTAIN_SITE,
  MOUNTAIN_BASE,
  MOUNTAIN_ROUTE,
  MOUNTAIN_SUMMIT,
  mountainHeight,
  mountainSupportHeight,
  mountainWorld,
} from '../src/mountain-profile.js';
import { landscapeHeight } from '../src/world-queries.js';

async function geometry(file) {
  const bytes = readFileSync(new URL('../src/assets/models/' + file, import.meta.url));
  const length = bytes.readUInt32LE(12),
    json = JSON.parse(bytes.subarray(20, 20 + length));
  json.buffers[0].uri =
    'data:application/octet-stream;base64,' + bytes.subarray(28 + length).toString('base64');
  for (const m of json.materials) {
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
  }
  delete json.images;
  delete json.textures;
  delete json.samplers;
  globalThis.ProgressEvent ??= class {
    constructor(type, values) {
      Object.assign(this, values);
    }
  };
  return (await new GLTFLoader().parseAsync(JSON.stringify(json), '')).scene;
}
async function fixture(t) {
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async (url) => {
    const file = url.endsWith('hokage-mountain.glb')
      ? 'hokage-mountain.glb'
      : /models\/(.*\.glb)/.exec(url)[1];
    return { scene: await geometry(file) };
  });
  t.mock.method(Math, 'random', () => 0.1);
  const scene = new THREE.Scene(),
    colliders = [],
    warnings = [];
  await addFieldMountain(scene, colliders, warnings);
  const field = await addFieldAnimals(scene, colliders, warnings, true);
  assert.deepEqual(warnings, []);
  const car = { x: 0, z: 0, heading: 0 };
  const wolf = () => field.snapshot().find((a) => a.id === 'reference-wolf');
  const tick = (dt = 1 / 30, mode = 'day', clockDt = dt) => field.update(dt, car, mode, clockDt);
  const until = (phase, max = 6000) => {
    for (let i = 0; i < max && field.mountain.snapshot().phase !== phase; i++) tick();
    assert.equal(field.mountain.snapshot().phase, phase, JSON.stringify(field.mountain.snapshot()));
  };
  const pat = () => {
    const w = wolf();
    return field.pat(
      new THREE.Raycaster(new THREE.Vector3(w.x, w.y + 4, w.z), new THREE.Vector3(0, -1, 0)),
      car,
    );
  };
  return { field, scene, colliders, car, wolf, tick, until, pat };
}

test('actual exported mountain preserves a substantial sculpted face, has a closed back, and agrees with support triangles', async () => {
  const root = await geometry('hokage-mountain.glb');
  root.position.set(MOUNTAIN_SITE.x, MOUNTAIN_BASE, MOUNTAIN_SITE.z);
  root.rotation.y = MOUNTAIN_SITE.heading;
  root.updateMatrixWorld(true);
  let count = 0,
    body,
    sculpture;
  root.traverse((n) => {
    if (n.isMesh) {
      count++;
      if (n.name.startsWith('Completed')) body = n;
      if (n.name.endsWith('mat_200')) sculpture = n;
    }
  });
  assert.equal(count, 3);
  assert.ok(
    new THREE.Box3().setFromObject(sculpture).getSize(new THREE.Vector3()).z > 8,
    'retain the real six-face carving',
  );
  const faceBottom = new THREE.Box3().setFromObject(sculpture).min.y;
  for (const x of [-3, -1, 1, 3, 5]) {
    const front = mountainWorld(x, 0.43);
    const hit = new THREE.Raycaster(
      new THREE.Vector3(front.x, 20, front.z),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(body)[0];
    assert.ok(hit.point.y < faceBottom, 'completed summit must not cover the carved faces');
  }
  const edgeCounts = new Map();
  const pos = body.geometry.attributes.position,
    indices = body.geometry.index;
  const key = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => v.toFixed(4)).join(',');
  for (let i = 0; i < indices.count; i += 3) {
    const v = [0, 1, 2].map((j) => key(indices.getX(i + j)));
    for (let j = 0; j < 3; j++) {
      const edge = [v[j], v[(j + 1) % 3]].sort().join('|');
      edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1);
    }
  }
  assert.ok(
    [...edgeCounts.values()].every((n) => n === 2),
    'completed mountain is a closed surface',
  );
  for (let i = 10; i < MOUNTAIN_ROUTE.length; i += 13) {
    const p = MOUNTAIN_ROUTE[i];
    const hit = new THREE.Raycaster(
      new THREE.Vector3(p.x + 0.2, 20, p.z),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(body)[0];
    assert.ok(hit);
    assert.ok(Math.abs(hit.point.y - MOUNTAIN_BASE - mountainHeight(p.x + 0.2, p.z)) < 2e-5);
  }
  let maxGrade = 0;
  for (let i = 1; i < MOUNTAIN_ROUTE.length; i++) {
    const a = MOUNTAIN_ROUTE[i - 1],
      b = MOUNTAIN_ROUTE[i];
    maxGrade = Math.max(
      maxGrade,
      Math.abs(mountainHeight(b.x, b.z) - mountainHeight(a.x, a.z)) /
        Math.hypot(b.x - a.x, b.z - a.z),
    );
  }
  assert.ok(maxGrade < Math.tan((25 * Math.PI) / 180), `route grade ${maxGrade}`);
  const entry = MOUNTAIN_ROUTE[0];
  assert.ok(
    Math.abs(mountainSupportHeight(entry.x, entry.z) - landscapeHeight(entry.x, entry.z)) < 1e-6,
  );
});

test('actual wolf walks up and down with support IK, ignores mountain taps and freezes while paused', async (t) => {
  const f = await fixture(t);
  assert.equal(f.field.mountain.start(f.car), true);
  f.until('ascending');
  const taps = f.wolf().taps;
  assert.equal(f.pat(), false);
  assert.equal(f.wolf().taps, taps);
  assert.equal(f.field.interactions.requestWolf(f.car), false);
  let maxError = 0,
    steps = 0,
    maxY = 0;
  for (let i = 0; i < 6000 && f.field.mountain.snapshot().phase !== 'summit'; i++) {
    f.tick();
    const w = f.wolf();
    maxY = Math.max(maxY, w.y);
    for (const leg of w.animation.legs) {
      assert.ok(leg.foot.every(Number.isFinite));
      if (w.animation.activity > 0.99)
        maxError = Math.max(
          maxError,
          new THREE.Vector3(...leg.foot).distanceTo(new THREE.Vector3(...leg.target)),
        );
      steps = Math.max(steps, leg.steps);
    }
  }
  assert.equal(f.field.mountain.snapshot().phase, 'summit');
  assert.ok(maxY > 9.5);
  assert.ok(steps > 30);
  assert.ok(maxError < 0.065, `slope IK error ${maxError}`);
  assert.ok(Math.hypot(f.wolf().x - MOUNTAIN_SUMMIT.x, f.wolf().z - MOUNTAIN_SUMMIT.z) < 0.001);
  assert.equal(f.pat(), false);
  assert.equal(f.wolf().taps, taps);
  const before = { w: f.wolf(), m: f.field.mountain.snapshot() };
  f.tick(0, 'night', 100);
  assert.deepEqual({ w: f.wolf(), m: f.field.mountain.snapshot() }, before);
  assert.equal(f.field.mountain.requestDescent(), true);
  assert.equal(f.pat(), false);
  f.until('idle');
  assert.equal(f.wolf().touchLocked, false);
  assert.ok(f.wolf().y < 1);
  assert.equal(f.pat(), true);
  assert.equal(f.wolf().taps, taps + 1);
});

test('summit stays across several rounds: day 90s, night 20s; reset on switch, skip busy, no queue or paused catch-up', async (t) => {
  const f = await fixture(t);
  f.field.mountain.start(f.car);
  f.until('summit');
  for (let i = 0; i < 90; i++) f.tick(1 / 30, 'day', 0);
  const neutral = f.wolf().animation;
  f.field.mountain.event('playing');
  for (let i = 0; i < 60; i++) f.tick(1 / 30, 'day', 0);
  const howl = f.wolf().animation;
  const rotationChange = (a, b) => new THREE.Quaternion(...a).angleTo(new THREE.Quaternion(...b));
  assert.ok(rotationChange(neutral.head, howl.head) > 0.45, 'actual head lifts during howl');
  assert.ok(rotationChange(neutral.jaw, howl.jaw) > 0.15, 'actual jaw opens during howl');
  f.field.mountain.event('ended');
  for (let i = 0; i < 90; i++) f.tick(1 / 30, 'day', 0);
  // The existing idle head sway spans 0.05 radians between two clock samples.
  assert.ok(rotationChange(neutral.head, f.wolf().animation.head) < 0.051);
  assert.ok(rotationChange(neutral.jaw, f.wolf().animation.jaw) < 0.01);
  let requests = 0;
  f.field.mountain.onHowl = () => {
    requests++;
    return true;
  };
  f.tick(1 / 30, 'day', 89);
  assert.equal(requests, 0);
  f.tick(1 / 30, 'day', 1);
  assert.equal(requests, 1);
  f.tick(1 / 30, 'day', 89);
  assert.equal(requests, 1);
  f.tick(1 / 30, 'night', 19);
  assert.equal(requests, 1);
  f.tick(0, 'night', 100);
  assert.equal(requests, 1);
  f.tick(1 / 30, 'night', 1);
  assert.equal(requests, 2);
  f.field.mountain.event('playing');
  f.tick(1 / 30, 'night', 20);
  assert.equal(requests, 2);
  f.field.mountain.event('ended');
  f.tick(1 / 30, 'night', 0.1);
  assert.equal(requests, 2);
  t.mock.method(Math, 'random', () => 0.4);
  f.tick(1 / 30, 'night', 20);
  assert.equal(requests, 2, '40% boundary rejects');
  assert.equal(f.field.mountain.snapshot().phase, 'summit');
});

test('controller yields to wolf encounter ownership and waits for a blocked trail without moving through the car', async (t) => {
  const f = await fixture(t);
  t.mock.method(Math, 'random', () => 0.5);
  assert.equal(f.field.encounters.tap(f.car), true);
  assert.equal(f.field.mountain.start(f.car), false);
  f.field.encounters.cancel();
  assert.equal(f.field.mountain.start(f.car), true);
  f.until('ascending');
  const w = f.wolf();
  Object.assign(f.car, { x: w.x, z: w.z });
  for (let i = 0; i < 90; i++) f.tick();
  assert.equal(f.wolf().x, w.x);
  assert.equal(f.wolf().z, w.z);
  assert.ok(f.field.mountain.snapshot().blockedTime > 2);
  Object.assign(f.car, { x: 0, z: 0 });
  f.until('summit');
  assert.ok(f.colliders.some((c) => c.mountain));
});

test('touch splits at exactly 50%, preserves direct summit stay, and runs rather than walks to the mountain', async (t) => {
  const f = await fixture(t);
  let rolls = 0;
  t.mock.method(Math, 'random', () => {
    rolls++;
    return 0.499999;
  });
  assert.equal(f.field.interactions.requestWolf(f.car), true);
  assert.equal(rolls, 1, 'one branch draw');
  assert.equal(f.field.encounters.busy(), false);
  assert.equal(f.field.mountain.snapshot().running, true);
  let gallop = false;
  let maxFootError = 0;
  for (let i = 0; i < 6000 && f.field.mountain.snapshot().phase !== 'summit'; i++) {
    f.tick();
    gallop ||= f.wolf().animation.gait === 'gallop';
    const animation = f.wolf().animation;
    for (const leg of animation.legs) {
      assert.ok(leg.foot.every(Number.isFinite));
      if (animation.activity > 0.99)
        maxFootError = Math.max(
          maxFootError,
          Math.hypot(...leg.foot.map((v, j) => v - leg.target[j])),
        );
    }
  }
  assert.ok(gallop);
  assert.ok(maxFootError < 0.065, `running mountain IK error ${maxFootError}`);
  assert.equal(f.field.mountain.snapshot().phase, 'summit');
  assert.ok(f.field.mountain.snapshot().stayTime >= 240);
});

test('actual bite waits for cry end, mother gallops after wolf, and escape summit waits five game seconds before safe return', async (t) => {
  const f = await fixture(t);
  t.mock.method(Math, 'random', () => 0.5);
  let bites = 0;
  f.field.interactions.connectAudio(
    { animalBite: () => true, stopWolfHowl() {} },
    {
      getCar: () => f.car,
      onBite(calf, wolf, car) {
        bites++;
        f.field.biteReaction(calf, wolf, car);
      },
      onImpact() {},
    },
  );
  assert.equal(f.field.interactions.requestWolf(f.car), true);
  assert.equal(f.field.mountain.snapshot().phase, 'idle');
  for (let i = 0; i < 1800 && f.field.encounters.snapshot().phase !== 'calling'; i++) f.tick();
  assert.equal(f.field.encounters.snapshot().phase, 'calling');
  assert.equal(bites, 1);
  const mother = () => f.field.snapshot().find((a) => a.id === 'golden-cow');
  const origin = mother();
  f.field.interactions.biteVoiceEvent('playing');
  for (let i = 0; i < 90; i++) f.tick();
  assert.equal(mother().x, origin.x);
  assert.equal(mother().z, origin.z);
  assert.equal(f.field.interactions.requestWolf(f.car), false);
  f.field.interactions.biteVoiceEvent('ended');
  assert.equal(f.field.mountain.snapshot().phase, 'approaching');
  assert.equal(f.field.mountain.snapshot().visitStay, 5);
  let chaseGallop = false,
    wolfGallop = false;
  const before = {
    e: f.field.encounters.snapshot(),
    m: f.field.mountain.snapshot(),
    a: f.field.snapshot(),
  };
  f.tick(0, 'day', 100);
  assert.deepEqual(
    { e: f.field.encounters.snapshot(), m: f.field.mountain.snapshot(), a: f.field.snapshot() },
    before,
  );
  for (let i = 0; i < 6000 && f.field.mountain.snapshot().phase !== 'summit'; i++) {
    f.tick();
    chaseGallop ||= mother().animation.gait === 'gallop';
    wolfGallop ||= f.wolf().animation.gait === 'gallop';
  }
  assert.equal(
    f.field.mountain.snapshot().phase,
    'summit',
    JSON.stringify(f.field.mountain.snapshot()),
  );
  assert.ok(chaseGallop, 'mother uses actual gallop');
  assert.ok(wolfGallop);
  assert.ok(Math.hypot(mother().x - origin.x, mother().z - origin.z) > 1);
  assert.equal(f.field.encounters.snapshot().reason, 'complete');
  assert.equal(f.field.mountain.snapshot().stayTime, 5);
  // Accelerated time-of-day must not shorten the five-second escape hold.
  for (let i = 0; i < 149; i++) f.tick(1 / 30, 'day', 1);
  assert.equal(f.field.mountain.snapshot().phase, 'summit');
  assert.equal(
    f.field.mountain.snapshot().draws,
    0,
    'short escape stay cannot be extended by a howl',
  );
  const frozen = f.field.mountain.snapshot();
  f.tick(0, 'night', 100);
  assert.deepEqual(f.field.mountain.snapshot(), frozen);
  f.tick(1 / 30, 'day', 1);
  f.tick(1 / 30, 'day', 1);
  assert.equal(f.field.mountain.snapshot().phase, 'descending');
  f.until('idle');
  assert.equal(f.wolf().touchLocked, false);
  assert.ok(f.wolf().y < 1);
});

test('howl voice reserves pending playback, follows actual media events and releases failures/obsolete promises', async () => {
  class Media extends EventTarget {
    currentTime = 0;
    paused = true;
    calls = 0;
    play() {
      this.calls++;
      this.paused = false;
      return this.promise ?? Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
    event(type) {
      this.dispatchEvent(new Event(type));
    }
  }
  const media = new Media(),
    events = [],
    voice = createWolfHowlVoice(media, (e) => events.push(e));
  let reject;
  media.promise = new Promise((resolve, r) => {
    reject = r;
  });
  assert.equal(voice.request(true), true);
  assert.equal(voice.request(true), false);
  assert.equal(events.length, 0);
  media.event('playing');
  assert.deepEqual(events, ['playing']);
  voice.stop();
  assert.equal(voice.busy(), false);
  media.promise = Promise.resolve();
  assert.equal(voice.request(true), true);
  reject(new Error('old request'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(voice.busy(), true);
  media.event('ended');
  assert.equal(voice.busy(), false);
  assert.equal(voice.request(false), false);
  media.promise = Promise.reject(new Error('unavailable'));
  voice.request(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(voice.busy(), false);
});
