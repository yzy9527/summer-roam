import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCalfVoice, CALF_VOICE_URL } from '../src/animal-voice.js';

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
  end() {
    this.paused = true;
    this.dispatchEvent(new Event('ended'));
  }
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('only calf tap four and later starts speech, and source WAV is shipped unchanged', async () => {
  const media = new Media(),
    voice = createCalfVoice(media);
  for (let taps = 1; taps <= 3; taps++)
    assert.equal(voice.tap({ id: 'hornless-calf', taps }, true), false);
  for (const id of ['golden-cow', 'copper-cow', 'reference-wolf'])
    assert.equal(voice.tap({ id, taps: 9 }, true), false);
  assert.equal(media.calls, 0);
  assert.equal(voice.tap({ id: 'hornless-calf', taps: 4 }, true), true);
  await tick();
  assert.equal(voice.snapshot().plays, 1);
  assert.equal(CALF_VOICE_URL, './assets/audio/mama_niulai.wav');
  assert.deepEqual(
    fs.readFileSync(new URL('../src/assets/audio/mama_niulai.wav', import.meta.url)),
    fs.readFileSync(new URL('../assets-source/audio/mama_niulai.wav', import.meta.url)),
  );
});

test('rapid taps neither overlap nor restart nor queue; a new tap after ended can play', async () => {
  const media = new Media(),
    voice = createCalfVoice(media);
  voice.tap({ id: 'hornless-calf', taps: 4 }, true);
  await tick();
  media.currentTime = 3;
  for (let taps = 5; taps < 15; taps++)
    assert.equal(voice.tap({ id: 'hornless-calf', taps }, true), false);
  assert.equal(media.calls, 1);
  assert.equal(media.currentTime, 3);
  media.end();
  await tick();
  assert.equal(media.calls, 1);
  assert.equal(voice.snapshot().busy, false);
  assert.equal(voice.tap({ id: 'hornless-calf', taps: 15 }, true), true);
  assert.equal(media.currentTime, 0);
  await tick();
  assert.equal(voice.snapshot().plays, 2);
});

test('pending play is locked, pause/mute stops it, and stale completion cannot affect new playback', async () => {
  const media = new Media(),
    voice = createCalfVoice(media);
  let resolve;
  media.play = function () {
    this.calls++;
    this.paused = false;
    return new Promise((r) => {
      resolve = r;
    });
  };
  assert.equal(voice.tap({ id: 'hornless-calf', taps: 4 }, true), true);
  const oldResolve = resolve;
  assert.equal(voice.tap({ id: 'hornless-calf', taps: 5 }, true), false);
  voice.stop();
  assert.equal(media.paused, true);
  assert.equal(voice.snapshot().busy, false);
  assert.equal(voice.tap({ id: 'hornless-calf', taps: 6 }, false), false);
  voice.tap({ id: 'hornless-calf', taps: 7 }, true);
  oldResolve();
  await tick();
  assert.equal(voice.snapshot().busy, true);
  assert.equal(voice.snapshot().plays, 0);
  resolve();
  await tick();
  assert.equal(voice.snapshot().plays, 1);
});

test('play failures and media errors release the lock without auto retry', async () => {
  const media = new Media(),
    voice = createCalfVoice(media);
  media.play = () => Promise.reject(new Error('autoplay denied'));
  voice.tap({ id: 'hornless-calf', taps: 4 }, true);
  await tick();
  assert.equal(voice.snapshot().busy, false);
  assert.ok(voice.snapshot().error);
  media.play = () => {
    throw new Error('unavailable');
  };
  voice.tap({ id: 'hornless-calf', taps: 5 }, true);
  assert.equal(voice.snapshot().busy, false);
  media.play = () => Promise.resolve();
  voice.tap({ id: 'hornless-calf', taps: 6 }, true);
  await tick();
  media.dispatchEvent(new Event('error'));
  assert.equal(voice.snapshot().busy, false);
  assert.equal(voice.snapshot().requests, 3);
});

test('family reservation gates playback after audio ends and lifecycle follows actual media events', async () => {
  const media = new Media();
  let locked = false;
  const events = [];
  const voice = createCalfVoice(media, () => {}, {
    reserve: () => {
      if (locked) return false;
      locked = true;
      return true;
    },
    event: (type, time) => {
      events.push([type, time]);
      if (type === 'cancel') locked = false;
    },
  });
  assert.equal(voice.tap({ id: 'hornless-calf', taps: 4 }, true), true);
  await Promise.resolve();
  assert.equal(events.length, 0);
  media.dispatchEvent(new Event('playing'));
  media.currentTime = 5;
  media.dispatchEvent(new Event('timeupdate'));
  assert.deepEqual(events, [
    ['playing', undefined],
    ['time', 5],
  ]);
  media.dispatchEvent(new Event('ended'));
  assert.equal(voice.tap({ id: 'hornless-calf', taps: 5 }, true), false);
  voice.stop();
  assert.equal(locked, false);
  assert.equal(voice.tap({ id: 'hornless-calf', taps: 6 }, true), true);
});
