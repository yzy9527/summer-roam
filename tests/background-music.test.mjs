import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBackgroundMusic, NIGHT_MUSIC_URL } from '../src/background-music.js';

class Media {
  events = {};
  paused = true;
  currentTime = 0;
  readyState = 4;
  calls = 0;
  addEventListener(event, callback) {
    (this.events[event] ??= []).push(callback);
  }
  emit(event) {
    for (const callback of this.events[event] ?? []) callback();
  }
  play() {
    this.calls++;
    this.paused = false;
    this.emit('playing');
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.emit('pause');
  }
}
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
function setup() {
  const media = { day: new Media(), night: new Media() };
  const node = () => ({
    gain: {
      value: 0,
      cancelScheduledValues() {},
      setValueAtTime(v) {
        this.value = v;
      },
      setTargetAtTime(v) {
        this.value = v;
      },
    },
    connect(next) {
      return next;
    },
  });
  const music = createBackgroundMusic(media);
  music.connect({ currentTime: 0, createGain: node, createMediaElementSource: node }, node());
  const start = () => music.sync({ playing: true, enabled: true, volume: 0.18 });
  const tick = (seconds) => {
    for (let i = 0; i < seconds * 60; i++) music.update(1 / 60);
  };
  return { media, music, start, tick };
}

test('day/night fades wait for playback, last two seconds and stop the outgoing track', async () => {
  const { media, music, start, tick } = setup();
  start();
  await flush();
  assert.equal(media.night.calls, 0);
  assert.equal(music.snapshot().tracks.day.gain, 1);
  media.night.play = function () {
    this.calls++;
    return Promise.resolve();
  };
  music.setTimeOfDay('night');
  await flush();
  tick(2);
  assert.equal(music.snapshot().nightMix, 0);
  assert.equal(media.day.paused, false);
  media.night.paused = false;
  media.night.emit('playing');
  tick(1);
  assert.ok(Math.abs(music.snapshot().nightMix - 0.5) < 1e-8);
  const gains = music.snapshot().tracks;
  assert.ok(Math.abs(gains.day.gain + gains.night.gain - 1) < 1e-8);
  tick(1.1);
  assert.equal(music.snapshot().nightMix, 1);
  assert.equal(media.day.paused, true);
  assert.equal(media.night.paused, false);
  assert.equal(music.snapshot().file, NIGHT_MUSIC_URL);
});

test('pause freezes a partial transition and resume preserves both playheads', async () => {
  const { media, music, start, tick } = setup();
  start();
  await flush();
  music.setTimeOfDay('night');
  await flush();
  tick(0.5);
  media.day.currentTime = 12;
  media.night.currentTime = 3;
  const mix = music.snapshot().nightMix;
  music.stop();
  tick(2);
  assert.equal(music.snapshot().nightMix, mix);
  assert.equal(music.snapshot().gain, 0);
  assert.equal(media.day.paused, true);
  assert.equal(media.night.paused, true);
  start();
  await flush();
  tick(2);
  assert.equal(music.snapshot().nightMix, 1);
  assert.equal(media.day.currentTime, 12);
  assert.equal(media.night.currentTime, 3);
});

test('rapid toggles and late playing cannot restart an inactive track', async () => {
  const { media, music, start, tick } = setup();
  start();
  await flush();
  let resolve;
  media.night.play = function () {
    this.calls++;
    return new Promise((r) => {
      resolve = r;
    });
  };
  music.setTimeOfDay('night');
  await flush();
  music.setTimeOfDay('day');
  media.night.paused = false;
  media.night.emit('playing');
  resolve();
  await flush();
  tick(1);
  assert.equal(media.night.paused, true);
  assert.equal(media.night.muted, true);
  assert.equal(music.snapshot().tracks.night.pending, false);
  assert.equal(music.snapshot().nightMix, 0);
  assert.equal(media.day.calls, 1);
  media.night.play = Media.prototype.play;
  music.setTimeOfDay('night');
  await flush();
  tick(0.5);
  const mix = music.snapshot().nightMix;
  music.setTimeOfDay('day');
  await flush();
  tick(0.25);
  assert.ok(music.snapshot().nightMix < mix);
});

test('blocked incoming music keeps day playback, does not retry every frame and can recover', async () => {
  const { media, music, start, tick } = setup();
  start();
  await flush();
  media.night.play = function () {
    this.calls++;
    return Promise.reject(new Error('blocked'));
  };
  music.setTimeOfDay('night');
  await flush();
  tick(3);
  assert.equal(media.night.calls, 1);
  assert.equal(media.day.paused, false);
  assert.equal(music.snapshot().tracks.day.gain, 1);
  assert.ok(music.snapshot().error);
  media.night.play = Media.prototype.play;
  start();
  await flush();
  tick(3);
  assert.equal(media.night.calls, 2);
  assert.equal(music.snapshot().nightMix, 1);
  assert.equal(music.snapshot().error, null);
});

test('both tracks share house ducking, volume and mute controls', async () => {
  const { media, music, start, tick } = setup();
  start();
  await flush();
  music.setTimeOfDay('night');
  await flush();
  tick(1);
  music.update(0, 0.15);
  assert.ok(Math.abs(music.snapshot().gain - 0.027) < 1e-8);
  for (const options of [
    { playing: true, enabled: false, volume: 0.18 },
    { playing: true, enabled: true, volume: 0 },
    { playing: false, enabled: true, volume: 0.18 },
  ]) {
    music.sync(options);
    assert.equal(music.snapshot().gain, 0);
    assert.ok(Object.values(media).every((t) => t.paused && t.muted));
    start();
    await flush();
  }
});

test('night audio ships unchanged with attribution and visible credits', async () => {
  assert.deepEqual(
    await readFile('src/assets/audio/dream-culture.mp3'),
    await readFile('assets-source/audio/dream-culture.mp3'),
  );
  const credits = await readFile('src/assets/audio/CREDITS.md', 'utf8');
  const html = await readFile('src/index.html', 'utf8');
  assert.match(credits, /Dream Culture/);
  assert.match(html, /Dream Culture/);
  assert.match(html, /USUAN1300046/);
});
