import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCowCollisionVoice, COW_COLLISION_URLS } from '../src/cow-collision-voice.js';
class Media extends EventTarget {
  paused = true;
  currentTime = 0;
  calls = 0;
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
function setup(random = () => 0) {
  const media = Object.fromEntries(Object.keys(COW_COLLISION_URLS).map((id) => [id, new Media()]));
  return { media, voice: createCowCollisionVoice(media, () => {}, random) };
}
test('correct original audio files and exact 40 percent threshold; silent hits do not cool down', () => {
  assert.equal(COW_COLLISION_URLS['hornless-calf'], './assets/audio/mama.wav');
  for (const url of Object.values(COW_COLLISION_URLS))
    assert.deepEqual(
      fs.readFileSync(new URL('../src/' + url, import.meta.url)),
      fs.readFileSync(new URL('../assets-source/audio/' + url.split('/').at(-1), import.meta.url)),
    );
  let value = 0.4;
  const { voice } = setup(() => value);
  assert.equal(voice.hit({ id: 'copper-cow' }, true), false);
  assert.equal(voice.snapshot().cooldown, 0);
  value = 0.39999;
  assert.equal(voice.hit({ id: 'unknown-animal' }, true), false);
  assert.equal(voice.hit({ id: 'copper-cow' }, false), false);
  assert.equal(voice.hit({ id: 'copper-cow' }, true), true);
});
test('shared pending lock, actual playing cooldown, long sound and no queued restart', () => {
  const { voice, media } = setup(),
    bull = media['copper-cow'];
  voice.hit({ id: 'copper-cow' }, true);
  assert.equal(voice.snapshot().cooldown, 0);
  assert.equal(voice.hit({ id: 'golden-cow' }, true), false);
  bull.event('playing');
  assert.equal(voice.snapshot().cooldown, 5);
  voice.update(2);
  voice.update(0);
  assert.equal(voice.snapshot().cooldown, 3);
  bull.event('ended');
  assert.equal(voice.hit({ id: 'golden-cow' }, true), false);
  voice.update(3);
  assert.equal(media['golden-cow'].calls, 0);
  assert.equal(voice.hit({ id: 'hornless-calf' }, true), true);
  media['hornless-calf'].event('playing');
  voice.update(6);
  assert.equal(voice.hit({ id: 'golden-cow' }, true), false);
  media['hornless-calf'].event('ended');
  assert.equal(voice.hit({ id: 'golden-cow' }, true), true);
});
test('stop preserves cooldown and stale rejected requests cannot release new playback', async () => {
  const { voice, media } = setup();
  let reject;
  media['copper-cow'].play = () => new Promise((_, r) => (reject = r));
  voice.hit({ id: 'copper-cow' }, true);
  voice.stop();
  voice.hit({ id: 'golden-cow' }, true);
  reject(new Error('old'));
  await Promise.resolve();
  assert.equal(voice.snapshot().id, 'golden-cow');
  media['golden-cow'].event('playing');
  voice.stop();
  assert.equal(voice.snapshot().cooldown, 5);
  assert.equal(voice.snapshot().busy, false);
  voice.update(5);
  media['hornless-calf'].play = () => Promise.reject(new Error('denied'));
  voice.hit({ id: 'hornless-calf' }, true);
  await Promise.resolve();
  assert.equal(voice.snapshot().busy, false);
  assert.equal(voice.snapshot().cooldown, 0);
  voice.hit({ id: 'golden-cow' }, true);
  media['golden-cow'].event('error');
  assert.equal(voice.snapshot().busy, false);
});

test('mother natural ended after actual playing always protects once; stopped or failed voices never protect', async () => {
  const media = Object.fromEntries(Object.keys(COW_COLLISION_URLS).map((id) => [id, new Media()]));
  let value = 0.39,
    rolls = 0,
    protects = 0;
  const voice = createCowCollisionVoice(
    media,
    () => {},
    () => {
      rolls++;
      return value;
    },
    { protect: () => protects++ },
  );
  voice.hit({ id: 'golden-cow' }, true);
  assert.equal(protects, 0);
  assert.equal(rolls, 1);
  media['golden-cow'].event('playing');
  assert.equal(protects, 0);
  assert.equal(rolls, 1);
  media['golden-cow'].event('playing');
  assert.equal(protects, 0);
  media['golden-cow'].event('ended');
  assert.equal(protects, 1);
  media['golden-cow'].event('ended');
  assert.equal(protects, 1);
  voice.update(5);
  value = 0;
  voice.hit({ id: 'golden-cow' }, true);
  media['golden-cow'].event('playing');
  voice.stop();
  media['golden-cow'].event('ended');
  assert.equal(protects, 1);
  voice.update(5);
  value = 0.4;
  assert.equal(voice.hit({ id: 'golden-cow' }, true), false);
  assert.equal(protects, 1);
  value = 0;
  media['golden-cow'].play = () => Promise.reject(new Error('blocked'));
  voice.hit({ id: 'golden-cow' }, true);
  await Promise.resolve();
  assert.equal(protects, 1);
});
test('wolf waits ten seconds and complete playback; leopard tap shares the five-second slot', () => {
  const media = Object.fromEntries(
    [...Object.keys(COW_COLLISION_URLS), 'leopard-tap'].map((id) => [id, new Media()]),
  );
  const voice = createCowCollisionVoice(
    media,
    () => {},
    () => 0,
  );
  assert.equal(voice.hit({ id: 'reference-wolf' }, true), true);
  media['reference-wolf'].event('playing');
  voice.update(7.16);
  media['reference-wolf'].event('ended');
  assert.equal(voice.hit({ id: 'reference-wolf' }, true), false);
  assert.equal(voice.tap(true), true);
  media['leopard-tap'].event('playing');
  media['leopard-tap'].event('ended');
  voice.update(5);
  assert.equal(voice.hit({ id: 'reference-wolf' }, true), true);
  media['reference-wolf'].event('playing');
  voice.update(11);
  assert.equal(voice.hit({ id: 'reference-wolf' }, true), false);
  media['reference-wolf'].event('ended');
  assert.equal(voice.hit({ id: 'reference-wolf' }, true), true);
});
test('calf reply rolls thirty percent on playing and only follows natural ended; bite never calls bull', () => {
  const media = Object.fromEntries(Object.keys(COW_COLLISION_URLS).map((id) => [id, new Media()]));
  let draws = [],
    follows = 0;
  const voice = createCowCollisionVoice(
      media,
      () => {},
      () => draws.shift() ?? 0,
      { follow: () => follows++ },
    ),
    calf = media['hornless-calf'];
  draws = [0, 0.2999];
  voice.hit({ id: 'hornless-calf' }, true);
  assert.equal(follows, 0);
  calf.event('playing');
  calf.event('playing');
  assert.equal(follows, 0);
  calf.event('ended');
  assert.equal(follows, 1);
  voice.update(5);
  draws = [0, 0.3];
  voice.hit({ id: 'hornless-calf' }, true);
  calf.event('playing');
  calf.event('ended');
  assert.equal(follows, 1);
  voice.update(5);
  draws = [0, 0];
  voice.hit({ id: 'hornless-calf' }, true);
  calf.event('playing');
  voice.stop();
  calf.event('ended');
  assert.equal(follows, 1);
  voice.bite(true);
  calf.event('playing');
  calf.event('ended');
  assert.equal(follows, 1);
});

test('bite reports actual playback and natural end, while interrupted, failed and unstarted cries cancel chase', async () => {
  const calf = new Media(),
    events = [];
  const voice = createCowCollisionVoice(
    { 'hornless-calf': calf },
    () => {},
    () => 0,
    {
      biteEvent: (event) => events.push(event),
    },
  );
  voice.bite(true);
  assert.deepEqual(events, []);
  calf.event('playing');
  assert.deepEqual(events, ['playing']);
  calf.event('ended');
  assert.deepEqual(events, ['playing', 'ended']);
  voice.bite(true);
  calf.event('playing');
  voice.stop();
  calf.event('ended');
  assert.deepEqual(events.slice(-2), ['playing', 'cancel']);
  voice.bite(true);
  calf.event('ended');
  assert.equal(events.at(-1), 'cancel', 'ended without playing cannot start chase');
  voice.bite(true);
  calf.event('error');
  assert.equal(events.at(-1), 'error');
  assert.equal(voice.busy(), false);
});
