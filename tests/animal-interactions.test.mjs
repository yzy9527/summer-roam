import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAnimalInteractions,
  createInteractionAudioHooks,
} from '../src/animal-interactions.js';
import { createDriveAudio } from '../src/audio.js';
import { interactionFixture } from './helpers/interaction-fixture.mjs';

class Media extends EventTarget {
  static all = [];
  paused = true;
  currentTime = 0;
  calls = 0;
  constructor(url) {
    super();
    this.url = url;
    Media.all.push(this);
  }
  play() {
    this.calls++;
    this.paused = false;
    return this.fail ? Promise.reject(new Error('test media failure')) : Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  event(type) {
    this.dispatchEvent(new Event(type));
  }
}
class Element extends EventTarget {
  value = 0;
  textContent = '';
  setAttribute() {}
}
class AudioParam {
  value = 0;
  cancelScheduledValues() {}
  setTargetAtTime(value) {
    this.value = value;
  }
  setValueAtTime(value) {
    this.value = value;
  }
  exponentialRampToValueAtTime(value) {
    this.value = value;
  }
}
class AudioNode {
  gain = new AudioParam();
  frequency = new AudioParam();
  Q = new AudioParam();
  pan = new AudioParam();
  threshold = new AudioParam();
  ratio = new AudioParam();
  connect(node) {
    return node;
  }
  start() {}
  stop() {}
  disconnect() {}
}
class AudioContext extends EventTarget {
  currentTime = 0;
  sampleRate = 8000;
  state = 'suspended';
  destination = new AudioNode();
  createDynamicsCompressor = () => new AudioNode();
  createGain = () => new AudioNode();
  createMediaElementSource = () => new AudioNode();
  createBiquadFilter = () => new AudioNode();
  createStereoPanner = () => new AudioNode();
  createOscillator = () => new AudioNode();
  createBufferSource = () => new AudioNode();
  createBuffer(channels, length) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  async resume() {
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {
    this.state = 'closed';
  }
}
function audioFixture(t, f) {
  const saved = {
    Audio: globalThis.Audio,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    window: globalThis.window,
    random: Math.random,
  };
  t.after(() => {
    Object.assign(globalThis, {
      Audio: saved.Audio,
      document: saved.document,
      localStorage: saved.localStorage,
      window: saved.window,
    });
    Math.random = saved.random;
  });
  Media.all = [];
  globalThis.Audio = Media;
  globalThis.window = { AudioContext };
  globalThis.document = { createElement: () => new Element(), body: { append() {} } };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  Math.random = () => 0;
  const ui = Object.fromEntries(
    ['musicButton', 'effectsButton', 'musicSlider', 'effectsSlider', 'status'].map((k) => [
      k,
      new Element(),
    ]),
  );
  const audio = createDriveAudio({
    ...ui,
    ...createInteractionAudioHooks(
      () => f.interactions,
      () => f.car,
    ),
  });
  let bites = 0,
    impacts = 0;
  f.interactions.connectAudio(audio, {
    getCar: () => f.car,
    onBite: () => bites++,
    onImpact: () => impacts++,
  });
  audio.setPlaying(true);
  t.after(() => audio.setPlaying(false));
  return {
    audio,
    ui,
    media: (suffix) => Media.all.find((m) => m.url.endsWith(suffix)),
    get bites() {
      return bites;
    },
    get impacts() {
      return impacts;
    },
  };
}
function exclusive(f) {
  for (const a of f.animals)
    assert.ok(f.interactions.ownersOf(a).length <= 1, `${a.id}: ${f.interactions.ownersOf(a)}`);
}

test('compatibility controller commands share family/wolf gates and release on vehicle interruptions', async () => {
  const f = await interactionFixture();
  const calf = f.animal('hornless-calf'),
    wolf = f.animal('reference-wolf'),
    mother = f.animal('golden-cow'),
    bull = f.animal('copper-cow');
  assert.equal(f.family.reserve(), true);
  assert.equal(f.encounters.tap(f.car), false);
  assert.deepEqual(f.interactions.ownersOf(calf), ['family']);
  f.interactions.vehicleContact(mother, f.car);
  assert.equal(f.family.busy(), false);
  assert.equal(f.encounters.tap({ x: 0, z: 0, heading: 0 }), true);
  assert.equal(f.family.reserve(), false);
  exclusive(f);
  assert.equal(f.encounters.follow(), true);
  assert.equal(f.charge.tap(f.car), false, 'follow holds bull and does not increment taps');
  assert.equal(f.charge.snapshot().taps, 0);
  f.interactions.vehicleContact(bull, f.car);
  assert.equal(f.encounters.busy(), false);
  assert.equal(f.encounters.snapshot().talking, false);
  assert.equal(f.charge.snapshot().vehicleHits, 1);
  exclusive(f);
  assert.equal(f.family.reserve(), true);
  f.family.event('cancel');
  assert.deepEqual(f.interactions.ownersOf(wolf), []);
});

test('busy or invalid protection requests preserve follow; successful handoff releases it before initializing warning', async () => {
  const f = await interactionFixture(),
    bull = f.animal('copper-cow');
  assert.equal(f.encounters.follow(), true);
  bull.rig = null;
  assert.equal(f.charge.protect(f.car), false);
  assert.equal(f.encounters.snapshot().talking, true);
  // Restore the actual rig and verify the old next-frame settle cannot reset warning state.
  const g = await interactionFixture();
  assert.equal(g.encounters.follow(), true);
  g.animal('copper-cow').behavior.state = 'talking';
  assert.equal(g.charge.protect(g.car), true);
  assert.equal(g.encounters.snapshot().talking, false);
  assert.equal(g.charge.snapshot().phase, 'warning');
  exclusive(g);
  const before = g.charge.snapshot();
  assert.equal(g.charge.protect(g.car), false);
  assert.deepEqual(g.charge.snapshot(), before);
  // A busy charge supplied by a controller rejects without issuing stopFollow.
  let stops = 0;
  const owner = { owns: () => false };
  const q = createAnimalInteractions({
    animals: [{ id: 'copper-cow', rig: {} }],
    family: { ...owner, reserve: () => false },
    charge: {
      ...owner,
      busy: () => true,
      tap: () => false,
      protect: () => assert.fail('busy request'),
      vehicleHit: () => {},
    },
    encounters: {
      owns: () => true,
      busy: () => false,
      tap: () => false,
      follow: () => true,
      stopFollow: () => stops++,
    },
  });
  assert.equal(q.requestProtection({}), false);
  assert.equal(stops, 0);
});

test('real controllers protect only after maternal natural ended and continue despite response failure/mute/pause', async (t) => {
  const f = await interactionFixture(),
    a = audioFixture(t, f),
    mother = a.media('cow-goes-m.mp3'),
    response = a.media('g-know.mp3');
  a.audio.animalCollision({ id: 'golden-cow' });
  mother.event('playing');
  assert.equal(f.charge.snapshot().phase, 'idle');
  mother.event('ended');
  assert.equal(f.charge.snapshot().mode, 'protect');
  assert.equal(f.charge.snapshot().phase, 'warning');
  assert.equal(response.calls, 1);
  response.event('error');
  assert.equal(f.charge.snapshot().mode, 'protect');
  a.audio.setPlaying(false);
  const frozen = f.charge.snapshot();
  f.tick(0);
  assert.deepEqual(f.charge.snapshot(), frozen);
  a.audio.setPlaying(true);
  f.tick(0.1);
  assert.ok(f.charge.snapshot().time > frozen.time);
  assert.equal(response.calls, 1, 'resume does not replay response');
  exclusive(f);
});

test('mother failure and interrupted cry never start protection or a delayed reply', async (t) => {
  const f = await interactionFixture(),
    a = audioFixture(t, f),
    mother = a.media('cow-goes-m.mp3');
  mother.fail = true;
  assert.equal(a.audio.animalCollision({ id: 'golden-cow' }), true);
  await Promise.resolve();
  await Promise.resolve();
  mother.event('ended');
  assert.equal(f.charge.snapshot().phase, 'idle');
  mother.fail = false;
  assert.equal(a.audio.animalCollision({ id: 'golden-cow' }), true);
  mother.event('playing');
  a.audio.setPlaying(false);
  mother.event('ended');
  assert.equal(f.charge.snapshot().phase, 'idle');
});

test('calf tap and collision media remain separate, family error/mute releases ownership, and clicks retain feedback timing', async (t) => {
  const f = await interactionFixture(),
    a = audioFixture(t, f),
    voice = a.media('mama_niulai.wav'),
    cry = a.media('/mama.wav'),
    calf = f.animal('hornless-calf');
  assert.equal(a.audio.animalTap({ id: calf.id, taps: 4 }), true);
  assert.equal(voice.calls, 1);
  assert.equal(cry.calls, 0);
  assert.equal(f.family.snapshot().phase, 'pending');
  voice.event('playing');
  voice.currentTime = 5.2;
  voice.event('timeupdate');
  assert.equal(f.family.snapshot().voiceTime, 5.2);
  f.interactions.tapFeedback(calf, { x: calf.x + 1, z: calf.z }, f.car);
  const frozen = f.family.snapshot();
  f.tick(0);
  assert.deepEqual(f.family.snapshot(), frozen);
  f.tick(0.1);
  assert.equal(f.family.snapshot().voiceTime, 5.2, 'feedback does not reset media timing');
  voice.event('error');
  assert.equal(f.family.busy(), false);
  assert.equal(calf.recoil, null);
  exclusive(f);
  assert.equal(a.audio.animalTap({ id: calf.id, taps: 5 }), true);
  voice.event('playing');
  a.ui.effectsButton.dispatchEvent(new Event('click'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.family.busy(), false);
  a.ui.effectsButton.dispatchEvent(new Event('click'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(a.ui.status.textContent, '音乐与音效保持轻声，可分别调节');
  assert.equal(voice.calls, 2, 'unmute does not replay');
  assert.equal(a.audio.animalCollision({ id: calf.id }), true);
  assert.equal(cry.calls, 1);
});

test('tap charge cancels on media failure, while revenge owns bull independently of sound', async (t) => {
  const f = await interactionFixture(),
    a = audioFixture(t, f),
    bull = f.animal('copper-cow'),
    voice = a.media('cow-moo.mp3');
  for (let taps = 1; taps <= 3; taps++) {
    const triggered = f.interactions.requestBullTap(bull, f.car);
    a.audio.animalTap({ id: bull.id, taps, ...(triggered ? { charge: true } : {}) });
  }
  assert.equal(f.charge.snapshot().phase, 'pending');
  voice.event('playing');
  assert.equal(f.charge.snapshot().phase, 'warning');
  voice.event('error');
  assert.equal(f.charge.snapshot().phase, 'returning');
  f.interactions.vehicleContact(bull, f.car);
  f.interactions.vehicleContact(bull, f.car);
  const hit = f.interactions.vehicleContact(bull, f.car);
  assert.equal(hit.triggered, true);
  assert.equal(f.charge.snapshot().mode, 'revenge');
  a.audio.setPlaying(false);
  const before = f.charge.snapshot();
  f.tick(0);
  assert.deepEqual(f.charge.snapshot(), before);
  a.audio.setPlaying(true);
  f.tick(0.1);
  assert.equal(f.charge.snapshot().mode, 'revenge');
  assert.ok(f.charge.snapshot().time > before.time);
  exclusive(f);
});

test('wolf ownership, gallop and cooldown freeze on pause; collision clears chase without starting family', async (t) => {
  const f = await interactionFixture(),
    a = audioFixture(t, f);
  f.car = { x: 0, z: 0, heading: 0, speed: 0 };
  assert.equal(a.audio.animalTap({ id: 'reference-wolf', taps: 1 }), true);
  assert.equal(f.encounters.snapshot().phase, 'approaching');
  for (let i = 0; i < 80; i++) f.tick();
  const before = f.encounters.snapshot();
  f.tick(0);
  assert.deepEqual(f.encounters.snapshot(), before);
  a.audio.setPlaying(false);
  assert.equal(f.encounters.busy(), true, 'pause freezes an action that is independent of media');
  f.tick(0);
  assert.deepEqual(f.encounters.snapshot(), before);
  a.audio.setPlaying(true);
  f.tick();
  exclusive(f);
  f.interactions.vehicleContact(f.animal('golden-cow'), f.car);
  assert.equal(f.encounters.busy(), false);
  assert.equal(f.encounters.snapshot().cooldown, 10);
  assert.equal(f.family.busy(), false);
  assert.equal(f.animal('reference-wolf').chargeRun, 0);
  f.tick(0);
  assert.equal(f.encounters.snapshot().cooldown, 10);
  assert.equal(a.audio.animalTap({ id: 'reference-wolf', taps: 2 }), false);
});

test('follow natural end and pause release bull through live hooks; protection does not reset new warning on next update', async (t) => {
  const f = await interactionFixture(),
    a = audioFixture(t, f),
    cry = a.media('/mama.wav'),
    follow = a.media('g-cow-fllow.mp3');
  a.audio.animalCollision({ id: 'hornless-calf' });
  cry.event('playing');
  assert.equal(f.encounters.snapshot().talking, false);
  cry.event('ended');
  assert.equal(f.encounters.snapshot().talking, true);
  follow.event('playing');
  assert.equal(f.charge.tap(f.car), false);
  follow.event('ended');
  assert.equal(f.encounters.snapshot().talking, false);
  exclusive(f);
  a.audio.collisionTick(6);
  assert.equal(a.audio.animalCollision({ id: 'hornless-calf' }), true);
  cry.event('playing');
  cry.event('ended');
  follow.event('playing');
  assert.equal(f.encounters.snapshot().talking, true);
  a.audio.setPlaying(false);
  assert.equal(f.encounters.snapshot().talking, false);
  assert.deepEqual(f.interactions.ownersOf(f.animal('copper-cow')), []);
  a.audio.setPlaying(true);
  assert.equal(f.encounters.snapshot().talking, false, 'resume never replays follow');
  assert.equal(follow.calls, 2);
  assert.equal(f.encounters.follow(), true);
  assert.equal(f.charge.protect(f.car), true);
  f.tick(0.1);
  assert.equal(f.charge.snapshot().phase, 'warning');
  assert.ok(f.animal('copper-cow').chargePose > 0);
});

test('actual bite cry holds mother until natural end; failure and mute release waiting actors without chase', async (t) => {
  const f = await interactionFixture(),
    a = audioFixture(t, f),
    cry = a.media('/mama.wav');
  f.car = { x: 0, z: 0, heading: 0, speed: 0 };
  let escapes = 0;
  f.encounters.onEscape = () => {
    escapes++;
    return true;
  };
  const bite = () => {
    assert.equal(a.audio.animalTap({ id: 'reference-wolf', taps: 1 }), true);
    for (let i = 0; i < 2000 && f.encounters.snapshot().phase !== 'calling'; i++) f.tick();
    assert.equal(f.encounters.snapshot().phase, 'calling', JSON.stringify(f.encounters.snapshot()));
    exclusive(f);
  };
  bite();
  assert.equal(escapes, 0);
  cry.event('playing');
  assert.equal(escapes, 0);
  cry.event('ended');
  assert.equal(escapes, 1);
  assert.equal(f.encounters.snapshot().phase, 'chasing');
  assert.deepEqual(f.interactions.ownersOf(f.animal('reference-wolf')), []);
  assert.deepEqual(f.interactions.ownersOf(f.animal('golden-cow')), ['encounters']);
  f.encounters.cancel();
  f.tick(10);
  // Reset positions so a second real contact is reachable in this isolated fixture.
  Object.assign(f.animal('reference-wolf'), { x: -29, z: 16 });
  Object.assign(f.animal('hornless-calf'), { x: -22, z: 10 });
  bite();
  cry.event('playing');
  a.ui.effectsButton.dispatchEvent(new Event('click'));
  assert.equal(f.encounters.busy(), false);
  assert.equal(escapes, 1);
  cry.event('ended');
  assert.equal(escapes, 1);
  exclusive(f);
});
