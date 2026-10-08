import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLookoutVoice, LOOKOUT_VOICE_URL } from '../src/lookout-voice.js';

function mediaFixture() {
  const handlers = {};
  return {
    currentTime: 0,
    volume: 0,
    plays: 0,
    addEventListener(type, handler) {
      handlers[type] = handler;
    },
    emit(type) {
      handlers[type]?.();
    },
    play() {
      this.plays++;
      return Promise.resolve();
    },
    pause() {},
  };
}
const event = { x: 146, z: 23 };
test('alarm voice locks before playing, follows real playback, attenuates and never replays after mute or pause', () => {
  const media = mediaFixture(),
    voice = createLookoutVoice(media),
    events = [];
  voice.sync({ enabled: true, volume: 0.22, position: event });
  assert(voice.request(event, true, (type) => events.push(type)));
  assert.equal(voice.snapshot().started, false);
  assert.equal(voice.request(event, true), false);
  media.emit('playing');
  media.emit('playing');
  assert.deepEqual(events, ['playing']);
  media.currentTime = 0.4;
  voice.sync({ enabled: true, volume: 0.22, position: { x: 196, z: 23 } });
  assert.equal(media.volume, 0.055);
  assert.equal(voice.snapshot().time, 0.4);
  voice.sync({ enabled: false, volume: 0.22, position: event });
  assert.deepEqual(events, ['playing', 'stopped']);
  voice.sync({ enabled: true, volume: 0.22, position: event });
  assert.equal(media.plays, 1);
  assert.equal(voice.snapshot().busy, false);
  assert.equal(voice.request({ x: 246, z: 23 }, true), false);
  assert.equal(voice.request(event, false), false);
  assert(voice.request(event, true));
  media.emit('ended');
  assert.equal(voice.snapshot().busy, false);
});
test('failed and stale play promises release only their own request, with no queued retry', async () => {
  const media = mediaFixture(),
    voice = createLookoutVoice(media);
  voice.sync({ enabled: true, volume: 0.22, position: event });
  let rejectOld;
  media.play = () =>
    new Promise((resolve, reject) => {
      rejectOld = reject;
    });
  assert(voice.request(event, true));
  voice.stop();
  media.play = () => Promise.resolve();
  assert(voice.request(event, true));
  rejectOld(new Error('cancelled'));
  await Promise.resolve();
  assert.equal(voice.snapshot().busy, true);
  media.emit('error');
  assert.equal(voice.snapshot().busy, false);
  media.play = () => Promise.reject(new Error('blocked'));
  assert(voice.request(event, true));
  await Promise.resolve();
  assert.equal(voice.snapshot().busy, false);
  media.play = () => {
    throw new Error('failed');
  };
  assert.equal(voice.request(event, true), false);
  assert.equal(voice.snapshot().busy, false);
});
test('the Brains source and registered runtime recording exist and retain their format', () => {
  assert.match(LOOKOUT_VOICE_URL, /pvz-brains\.mp3$/);
  assert.equal(
    readFileSync(new URL('../assets-source/audio/pvz-brains.ogg', import.meta.url))
      .subarray(0, 4)
      .toString(),
    'OggS',
  );
  assert(
    readFileSync(new URL('../src/assets/audio/pvz-brains.mp3', import.meta.url)).length > 1000,
  );
});
