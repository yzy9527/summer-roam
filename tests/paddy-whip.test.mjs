import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createPaddyWhip } from '../src/paddy-whip.js';
import { createPaddyCowVoice, PADDY_COW_CALL_URLS } from '../src/paddy-cow-voice.js';
import { readFileSync } from 'node:fs';

test('flexible sections bend and settle, stay constrained and freeze at 30/60/120fps', () => {
  for (const fps of [30, 60, 120]) {
    const whip = createPaddyWhip(),
      root = new Vector3(0, 1.5, 0),
      rump = new Vector3(-0.25, 1, 2);
    let contacted = false,
      bent = false;
    for (let i = 0; i < fps * 3; i++) {
      const time = i / fps;
      whip.update(1 / fps, root, rump, 0, time < 1.35 ? time : null, 0.126);
      const points = whip.snapshot().points.map((p) => new Vector3(...p));
      const length = points.slice(1).reduce((sum, p, j) => sum + p.distanceTo(points[j]), 0);
      assert(Math.abs(length - 2.45) < 0.08, 'no stretch-to-target lash');
      assert(points.every((p) => p.y >= 0.145));
      assert(points[0].distanceTo(root) < 1e-8);
      contacted ||= whip.tip.distanceTo(rump) < 0.045;
      bent ||= points[12].distanceTo(root.clone().lerp(whip.tip, 0.5)) > 0.3;
    }
    assert(contacted && bent);
    assert(whip.tip.y < 0.18, 'released tip settles near the mud');
    const before = whip.snapshot();
    whip.update(0, root.clone().addScalar(5), rump, 1, 0.6, 0.126);
    assert.deepEqual(whip.snapshot(), before);
  }
});

function mediaFixture() {
  const handlers = {};
  return {
    currentTime: 0,
    plays: 0,
    addEventListener: (type, callback) => {
      handlers[type] = callback;
    },
    emit: (type) => handlers[type]?.(),
    play() {
      this.plays++;
      return Promise.resolve();
    },
    pause() {},
  };
}
test('independent cow media obey real playing/ended, busy skip, spatial gates, mute and failed playback without a queue', async () => {
  const media = mediaFixture(),
    states = [],
    event = { cowId: 'golden-cow', x: 105, z: 20 };
  let otherBusy = false;
  const voice = createPaddyCowVoice(
    () => media,
    () => !otherBusy,
  );
  voice.sync({ enabled: true, volume: 0.3, position: null });
  assert.equal(voice.request(event, true), false);
  voice.sync({ enabled: true, volume: 0.3, position: event });
  otherBusy = true;
  assert.equal(voice.request(event, true), false);
  otherBusy = false;
  assert(voice.request(event, true, (state) => states.push(state)));
  assert.deepEqual(states, []);
  assert.equal(voice.request(event, true), false);
  media.emit('playing');
  media.emit('playing');
  assert.deepEqual(states, ['playing']);
  voice.move({ x: 121, z: 20 });
  voice.sync({ enabled: true, volume: 0.3, position: event });
  assert.equal(media.volume, 0.075);
  voice.sync({ enabled: false, volume: 0.3, position: event });
  assert.deepEqual(states, ['playing', 'stopped']);
  voice.sync({ enabled: true, volume: 0.3, position: event });
  assert.equal(media.plays, 1);
  assert.equal(voice.request({ ...event, x: 137 }, true), false);
  media.play = () => Promise.reject(new Error('blocked'));
  assert(voice.request(event, true, (state) => states.push(state)));
  await Promise.resolve();
  assert.equal(voice.snapshot().busy, false);
  assert.equal(states.filter((state) => state === 'playing').length, 1);
  media.play = () => Promise.resolve();
  assert(voice.request(event, true));
  media.emit('playing');
  media.emit('ended');
  assert.equal(voice.snapshot().busy, false);
  assert.match(PADDY_COW_CALL_URLS['golden-cow'], /cow-goes-m.mp3$/);
  assert(
    readFileSync(new URL('../src/assets/audio/cow-goes-m.mp3', import.meta.url)).length > 1000,
  );
});

test('calf whip calls use the selected audio and share busy/mute gates', () => {
  const media = new Map();
  const voice = createPaddyCowVoice((_id, url) => {
    const audio = mediaFixture();
    media.set(url, audio);
    return audio;
  });
  const event = { cowId: 'hornless-calf', x: 105, z: 20 };
  const niulai = { ...event, call: 'calf-lift-call' };
  voice.sync({ enabled: true, volume: 0.3, position: event });
  assert(voice.request(event, true));
  const mamaMedia = [...media.entries()].find(([url]) => url.endsWith('mama.wav'))?.[1];
  assert(mamaMedia);
  assert.equal(voice.request(niulai, true), false, 'no overlapping calls');
  mamaMedia.emit('ended');
  assert(voice.request(niulai, true));
  const niulaiMedia = [...media.entries()].find(([url]) => url.endsWith('niulai.mp3'))?.[1];
  assert(niulaiMedia);
  voice.sync({ enabled: false, volume: 0.3, position: event });
  assert.equal(voice.snapshot().busy, false);
  voice.sync({ enabled: true, volume: 0.3, position: event });
  assert(voice.request(niulai, true));
  assert.equal(media.size, 2, 'reuse both media instances');
  assert.equal(niulaiMedia.plays, 2);
});

test('cow media are created only for the first audible request and then reused', () => {
  const media = mediaFixture(),
    event = { cowId: 'golden-cow', x: 105, z: 20 };
  let mothers = 0,
    bulls = 0;
  const voice = createPaddyCowVoice((id) => {
    if (id === 'golden-cow') {
      mothers++;
      return media;
    }
    bulls++;
    return mediaFixture();
  });
  voice.stop();
  assert.equal(voice.request(event, true), false);
  for (const settings of [
    { enabled: false, volume: 0.3, position: event },
    { enabled: true, volume: 0, position: event },
    { enabled: true, volume: 0.3, position: null },
    { enabled: true, volume: 0.3, position: { x: 0, z: 0 } },
  ]) {
    voice.sync(settings);
    assert.equal(voice.request(event, true), false);
  }
  assert.equal(mothers + bulls, 0);
  assert.deepEqual(voice.snapshot().voices, {});
  voice.sync({ enabled: true, volume: 0.3, position: event });
  assert.equal(voice.request(event, false), false);
  assert.equal(voice.request({ ...event, cowId: 'unknown' }, true), false);
  assert(voice.request(event, true));
  assert.equal(mothers, 1);
  assert.equal(bulls, 0);
  assert.equal(voice.request(event, true), false);
  media.emit('playing');
  media.emit('ended');
  assert(voice.request(event, true));
  assert.equal(mothers, 1);
  assert.equal(bulls, 0);
});
