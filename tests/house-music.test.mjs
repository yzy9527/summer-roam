import test from 'node:test';
import assert from 'node:assert/strict';
import { houseMusicTargets, createHouseMusic } from '../src/house-music.js';
import { spawnState } from '../src/drive.js';
import { NOHARA_HOUSE_SITE } from '../src/nohara-house-site.js';
class Media {
  constructor() {
    this.events = {};
    this.paused = true;
    this.currentTime = 0;
    this.readyState = 4;
    this.calls = 0;
  }
  addEventListener(type, fn) {
    (this.events[type] ??= []).push(fn);
  }
  event(type) {
    for (const fn of this.events[type] ?? []) fn();
  }
  play() {
    this.calls++;
    this.paused = false;
    this.event('playing');
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.event('pause');
  }
}
function setup() {
  const param = () => ({
    value: 0,
    cancelScheduledValues() {},
    setValueAtTime(v) {
      this.value = v;
    },
    setTargetAtTime(v) {
      this.value = v;
    },
  });
  const node = () => ({
    gain: param(),
    frequency: param(),
    pan: param(),
    connect(n) {
      return n;
    },
  });
  const context = {
    currentTime: 0,
    createGain: node,
    createBiquadFilter: node,
    createStereoPanner: node,
    createMediaElementSource: node,
  };
  const media = new Media(),
    radio = createHouseMusic(media);
  radio.connect(context, node());
  return { media, radio };
}
test('house music fades monotonically within 25 metres of the house and moves between stereo sides', () => {
  let previous = 0;
  for (let x = 0; x >= -42; x -= 0.25) {
    const t = houseMusicTargets({ x, z: 200 }, 0);
    assert.ok(t.presence >= previous);
    previous = t.presence;
    assert.ok(t.cutoff >= 1400 && t.cutoff <= 5600);
  }
  assert.equal(houseMusicTargets({ x: 0, z: 0 }).presence, 0);
  const left = houseMusicTargets({ x: -37, z: 200 }, 0),
    right = houseMusicTargets({ x: -37, z: 200 }, Math.PI);
  assert.ok(left.pan > 0 && right.pan < 0);
  assert.equal(left.presence, right.presence);
});
test('distant start cannot play house music; leaving pauses and returning keeps progress', async () => {
  const { media, radio } = setup();
  assert.equal(media.calls, 0);
  assert.equal(media.muted, true);
  radio.update({ x: 132, z: 10 }, 0);
  radio.sync({ playing: true, enabled: true, volume: 0.18 });
  await Promise.resolve();
  assert.equal(media.loop, true);
  assert.equal(media.calls, 0);
  assert.equal(media.paused, true);
  assert.equal(media.muted, true);
  assert.equal(radio.snapshot().gain, 0);
  assert.equal(radio.backgroundFactor(), 1);
  radio.update({ x: -37, z: 200 }, 0);
  await Promise.resolve();
  assert.equal(media.calls, 1);
  assert.equal(media.paused, false);
  assert.equal(media.muted, false);
  assert.ok(radio.snapshot().gain > 0);
  assert.ok(radio.backgroundFactor() < 0.3);
  media.currentTime = 42;
  radio.update({ x: 132, z: 10 }, 0);
  assert.equal(media.paused, true);
  assert.equal(media.muted, true);
  assert.equal(radio.snapshot().gain, 0);
  assert.equal(radio.backgroundFactor(), 1);
  radio.update({ x: -37, z: 200 }, 0);
  await Promise.resolve();
  assert.equal(media.currentTime, 42);
  assert.equal(media.calls, 2);
});
test('unknown position and the 25 metre boundary remain paused; turning does not restart playback', async () => {
  const { media, radio } = setup();
  radio.sync({ playing: true, enabled: true, volume: 0.18 });
  assert.equal(media.calls, 0);
  const boundary = { x: NOHARA_HOUSE_SITE.x + NOHARA_HOUSE_SITE.width / 2 + 25, z: 200 };
  radio.update(boundary, 0);
  assert.equal(media.calls, 0);
  radio.update({ ...boundary, x: boundary.x - 0.01 }, 0);
  await Promise.resolve();
  assert.equal(media.calls, 1);
  radio.update({ ...boundary, x: boundary.x - 0.01 }, Math.PI);
  assert.equal(media.calls, 1);
  radio.update(boundary, 0);
  assert.equal(media.paused, true);
  assert.equal(media.muted, true);
  assert.equal(radio.snapshot().gain, 0);
});
test('pause, mute and zero volume stop both audibility and background ducking; resume keeps progress', async () => {
  const { media, radio } = setup();
  radio.update({ x: -37, z: 200 }, 0);
  radio.sync({ playing: true, enabled: true, volume: 0.18 });
  await Promise.resolve();
  media.currentTime = 25;
  for (const options of [
    { playing: false, enabled: true, volume: 0.18 },
    { playing: true, enabled: false, volume: 0.18 },
    { playing: true, enabled: true, volume: 0 },
  ]) {
    radio.sync(options);
    assert.equal(media.paused, true);
    assert.equal(media.muted, true);
    assert.equal(radio.snapshot().gain, 0);
    assert.equal(radio.backgroundFactor(), 1);
    radio.sync({ playing: true, enabled: true, volume: 0.18 });
    await Promise.resolve();
    assert.equal(media.paused, false);
    assert.equal(media.muted, false);
    assert.equal(media.currentTime, 25);
  }
});
test('missing or blocked house audio cannot suppress the normal background music', async () => {
  const { media, radio } = setup();
  media.play = () => Promise.reject(new Error('blocked'));
  radio.update({ x: -37, z: 200 }, 0);
  radio.sync({ playing: true, enabled: true, volume: 0.18 });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(radio.snapshot().gain, 0);
  assert.equal(radio.backgroundFactor(), 1);
  assert.ok(radio.snapshot().error);
  media.event('error');
  assert.equal(radio.backgroundFactor(), 1);
});
test('late rejection after pause cannot alter resumed playback', async () => {
  const { media, radio } = setup();
  let reject;
  media.play = () =>
    new Promise((resolve, r) => {
      reject = r;
    });
  radio.update({ x: -37, z: 200 }, 0);
  radio.sync({ playing: true, enabled: true, volume: 0.18 });
  radio.stop();
  media.play = Media.prototype.play;
  radio.sync({ playing: true, enabled: true, volume: 0.18 });
  reject(new Error('old request'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(media.paused, false);
  assert.equal(radio.snapshot().error, null);
});
test('late playing after leaving the radius is muted and paused, including a pending request', async () => {
  const { media, radio } = setup();
  let resolve;
  media.play = () => {
    media.calls++;
    return new Promise((r) => (resolve = r));
  };
  radio.update({ x: -37, z: 200 }, 0);
  radio.sync({ playing: true, enabled: true, volume: 0.18 });
  assert.equal(radio.snapshot().pending, true);
  radio.update({ x: 132, z: 10 }, 0);
  assert.equal(radio.snapshot().pending, false);
  media.paused = false;
  media.event('playing');
  resolve();
  await Promise.resolve();
  assert.equal(media.paused, true);
  assert.equal(media.muted, true);
  assert.equal(radio.snapshot().gain, 0);
  assert.equal(radio.backgroundFactor(), 1);
});
test('blocked playback is not retried every frame; user retry or reentry can recover', async () => {
  const { media, radio } = setup();
  media.play = () => {
    media.calls++;
    return Promise.reject(new Error('blocked'));
  };
  radio.update({ x: -37, z: 200 }, 0);
  radio.sync({ playing: true, enabled: true, volume: 0.18 });
  await Promise.resolve();
  await Promise.resolve();
  for (let i = 0; i < 10; i++) radio.update({ x: -37, z: 200 }, 0);
  assert.equal(media.calls, 1);
  assert.equal(media.muted, true);
  media.play = Media.prototype.play;
  radio.sync({ playing: true, enabled: true, volume: 0.18 });
  await Promise.resolve();
  assert.equal(media.paused, false);
  assert.equal(media.muted, false);
  radio.update({ x: 132, z: 10 }, 0);
  radio.update({ x: -37, z: 200 }, 0);
  await Promise.resolve();
  assert.equal(media.calls, 3);
  assert.equal(media.paused, false);
});

test('current camp spawn stays outside the house music radius', async () => {
  const { media, radio } = setup();
  radio.update(spawnState(), 0);
  radio.sync({ playing: true, enabled: true, volume: 0.18 });
  await Promise.resolve();
  assert.equal(media.calls, 0);
  assert.equal(media.muted, true);
});
