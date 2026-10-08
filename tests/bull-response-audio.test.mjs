import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveAudio } from '../src/audio.js';
import { createCorralVoice, CORRAL_ANIMAL_URLS } from '../src/corral-audio.js';
class Media extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.paused = true;
    this.currentTime = 0;
    this.calls = 0;
    Media.all.push(this);
  }
  static all = [];
  play() {
    this.calls++;
    this.paused = false;
    return Promise.resolve();
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
test('bull pats use moo while vehicle collision and retaliation keep their original media', (t) => {
  const saved = {
    Audio: globalThis.Audio,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    random: Math.random,
  };
  t.after(() => {
    Object.assign(globalThis, {
      Audio: saved.Audio,
      document: saved.document,
      localStorage: saved.localStorage,
    });
    Math.random = saved.random;
  });
  globalThis.Audio = Media;
  globalThis.document = { createElement: () => new Element(), body: { append() {} } };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  Math.random = () => 0;
  Media.all = [];
  const ui = Object.fromEntries(
    ['musicButton', 'effectsButton', 'musicSlider', 'effectsSlider', 'status'].map((key) => [
      key,
      new Element(),
    ]),
  );
  const audio = createDriveAudio({ ...ui, createMedia: (url) => new Media(url) });
  t.after(() => audio.setPlaying(false));
  const active = () => Media.all.filter((media) => !media.paused);
  audio.setPlaying(true);
  assert.equal(audio.animalTap({ id: 'copper-cow', taps: 1 }), false);
  assert.equal(audio.animalTap({ id: 'copper-cow', taps: 2 }), true);
  const warning = active()[0];
  assert.ok(warning.url.endsWith('cow-moo.mp3'));
  assert.equal(audio.animalTap({ id: 'copper-cow', taps: 3, charge: true }), true);
  const speech = active()[0];
  assert.equal(active().length, 1);
  assert.notEqual(speech, warning);
  assert.ok(speech.url.endsWith('cow-moo.mp3'));
  assert.equal(audio.animalTap({ id: 'copper-cow', taps: 4, charge: true }), false);
  audio.setPlaying(false);
  assert.equal(speech.paused, true);
  audio.setPlaying(true);
  assert.equal(active().length, 0, 'resume does not replay a pat');
  assert.equal(audio.animalCollision({ id: 'copper-cow' }), true);
  const collision = active()[0];
  assert.ok(collision.url.endsWith('cow-moo.mp3'));
  assert.notEqual(collision, speech, 'collision retains its independent media');
  audio.setPlaying(false);
  audio.setPlaying(true);
  assert.equal(audio.animalCollision({ id: 'copper-cow', response: 'revenge' }), true);
  assert.ok(active()[0].url.endsWith('jiaoli.mp3'));
  audio.setPlaying(false);
  const corralMedia = Object.fromEntries(
    Object.entries(CORRAL_ANIMAL_URLS).map(([key, url]) => [key, new Media(url)]),
  );
  const corral = createCorralVoice(corralMedia);
  corral.sync({ enabled: true, volume: 0.22, position: { x: 0, z: 0 } });
  const event = { type: 'animal-tap', id: 'copper-cow', x: 0, z: 0 };
  assert.equal(corral.event(event, true), true);
  assert.ok(corral.snapshot().file.endsWith('cow-moo.mp3'));
  corral.stop();
  assert.equal(corral.event({ ...event, type: 'animal-run' }, true), true);
  assert.ok(corral.snapshot().file.endsWith('niu_angry.mp3'), 'escape cry stays unchanged');
  corral.stop();
});

test('complete maternal cry hands audio to g-know; retaliation honors shared cooldown and calf collision uses mama.wav', async () => {
  const saved = {
    Audio: globalThis.Audio,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    random: Math.random,
  };
  let audit;
  globalThis.Audio = Media;
  globalThis.document = {
    createElement: () => new Element(),
    body: {
      append(e) {
        audit = e;
      },
    },
  };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  Math.random = () => 0;
  try {
    Media.all = [];
    let protection = 0;
    const ui = Object.fromEntries(
      ['musicButton', 'effectsButton', 'musicSlider', 'effectsSlider', 'status'].map((k) => [
        k,
        new Element(),
      ]),
    );
    const audio = createDriveAudio({
      ...ui,
      createMedia: (url) => new Media(url),
      bullCharge: {
        protect() {
          protection++;
          return true;
        },
      },
    });
    audio.setPlaying(true);
    audio.animalCollision({ id: 'golden-cow' });
    assert.equal(protection, 0);
    const mother = Media.all.find((m) => m.url.endsWith('cow-goes-m.mp3')),
      protect = Media.all.find((m) => m.url.endsWith('g-know.mp3'));
    mother.event('playing');
    assert.equal(protection, 0);
    assert.equal(protect.calls, 0);
    mother.event('ended');
    assert.equal(protection, 1);
    assert.equal(protect.calls, 1);
    protect.event('playing');
    assert.equal(JSON.parse(audit.textContent).collisionVoice.cooldown, 5);
    protect.event('ended');
    assert.equal(
      audio.animalCollision({ id: 'copper-cow', response: 'revenge' }),
      false,
      'attack audio stays silent during shared cooldown',
    );
    audio.collisionTick(5);
    assert.equal(audio.animalCollision({ id: 'copper-cow', response: 'revenge' }), true);
    const response = Media.all.filter((m) => m.url.endsWith('jiaoli.mp3')).at(-1);
    response.event('playing');
    audio.setPlaying(false);
    assert.equal(response.paused, true);
    audio.collisionTick(0);
    assert.equal(JSON.parse(audit.textContent).collisionVoice.cooldown, 5);
    audio.setPlaying(true);
    audio.collisionTick(5);
    assert.equal(audio.animalCollision({ id: 'hornless-calf' }), true);
    assert.equal(Media.all.find((m) => m.url.endsWith('/mama.wav')).calls, 1);
    assert.equal(Media.all.find((m) => m.url.endsWith('mama_niulai.wav')).calls, 0);
    audio.setPlaying(false);
  } finally {
    Object.assign(globalThis, {
      Audio: saved.Audio,
      document: saved.document,
      localStorage: saved.localStorage,
    });
    Math.random = saved.random;
  }
});

test('calf finishes before bull follow dialogue, shared locks release on ended or pause; bite never starts follow', async () => {
  const saved = {
    Audio: globalThis.Audio,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    random: Math.random,
  };
  let audit;
  globalThis.Audio = Media;
  globalThis.document = {
    createElement: () => new Element(),
    body: {
      append(e) {
        audit = e;
      },
    },
  };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  Math.random = () => 0;
  try {
    Media.all = [];
    let facing = false,
      turns = 0;
    const ui = Object.fromEntries(
      ['musicButton', 'effectsButton', 'musicSlider', 'effectsSlider', 'status'].map((k) => [
        k,
        new Element(),
      ]),
    );
    const audio = createDriveAudio({
      ...ui,
      createMedia: (url) => new Media(url),
      encounters: {
        follow() {
          facing = true;
          turns++;
          return true;
        },
        stopFollow() {
          facing = false;
        },
      },
    });
    audio.setPlaying(true);
    const calf = Media.all.find((m) => m.url.endsWith('/mama.wav')),
      reply = Media.all.find((m) => m.url.endsWith('g-cow-fllow.mp3'));
    assert.equal(audio.animalCollision({ id: 'hornless-calf' }), true);
    assert.equal(reply.calls, 0);
    calf.event('playing');
    assert.equal(turns, 0);
    audio.collisionTick(6);
    assert.equal(reply.calls, 0);
    assert.equal(audio.animalTap({ id: 'baola-leopard' }), false);
    calf.event('ended');
    assert.equal(turns, 1);
    assert.equal(reply.calls, 1);
    assert.equal(facing, true);
    reply.event('playing');
    assert.equal(JSON.parse(audit.textContent).responseVoice.mode, 'follow');
    assert.equal(audio.animalCollision({ id: 'reference-wolf' }), false);
    reply.event('ended');
    assert.equal(facing, false);
    audio.collisionTick(5);
    audio.animalCollision({ id: 'hornless-calf' });
    calf.event('playing');
    audio.setPlaying(false);
    calf.event('ended');
    assert.equal(turns, 1);
    assert.equal(reply.calls, 1);
    audio.setPlaying(true);
    assert.equal(audio.animalBite(), true);
    calf.event('playing');
    calf.event('ended');
    assert.equal(turns, 1);
    assert.equal(reply.calls, 1);
    audio.collisionTick(5);
    audio.animalCollision({ id: 'hornless-calf' });
    calf.event('playing');
    calf.event('ended');
    reply.event('playing');
    assert.equal(facing, true);
    audio.setPlaying(false);
    assert.equal(facing, false);
    assert.equal(reply.paused, true);
  } finally {
    Object.assign(globalThis, {
      Audio: saved.Audio,
      document: saved.document,
      localStorage: saved.localStorage,
    });
    Math.random = saved.random;
  }
});

test('mother collision cancels an earlier calf collision cry and its pending bull dialogue', () => {
  const saved = {
    Audio: globalThis.Audio,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    random: Math.random,
  };
  globalThis.Audio = Media;
  globalThis.document = { createElement: () => new Element(), body: { append() {} } };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  Math.random = () => 0;
  try {
    Media.all = [];
    let follows = 0;
    const ui = Object.fromEntries(
      ['musicButton', 'effectsButton', 'musicSlider', 'effectsSlider', 'status'].map((k) => [
        k,
        new Element(),
      ]),
    );
    const audio = createDriveAudio({
      ...ui,
      createMedia: (url) => new Media(url),
      encounters: {
        follow() {
          follows++;
          return true;
        },
      },
    });
    audio.setPlaying(true);
    const calf = Media.all.find((m) => m.url.endsWith('/mama.wav'));
    audio.animalCollision({ id: 'hornless-calf' });
    calf.event('playing');
    assert.equal(calf.paused, false);
    audio.animalCollision({ id: 'golden-cow' });
    assert.equal(calf.paused, true);
    calf.event('ended');
    assert.equal(follows, 0);
    audio.setPlaying(false);
  } finally {
    Object.assign(globalThis, {
      Audio: saved.Audio,
      document: saved.document,
      localStorage: saved.localStorage,
    });
    Math.random = saved.random;
  }
});
