import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createBullResponseVoice,
  BULL_PROTECTION_URL,
  BULL_RESPONSE_URLS,
} from '../src/bull-response-voice.js';
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
test('protection original MP3 is shipped unchanged; one response lock through actual playback with no queue', () => {
  assert.equal(BULL_PROTECTION_URL, './assets/audio/g-know.mp3');
  assert.deepEqual(
    fs.readFileSync(new URL('../src/assets/audio/g-know.mp3', import.meta.url)),
    fs.readFileSync(new URL('../assets-source/audio/g-know.mp3', import.meta.url)),
  );
  const media = Object.fromEntries(
    Object.keys(BULL_RESPONSE_URLS).map((mode) => [mode, new Media()]),
  );
  let starts = 0;
  const v = createBullResponseVoice(media, () => starts++);
  assert.equal(v.play('protect', false), false);
  assert.equal(v.play('protect', true), true);
  assert.equal(v.play('revenge', true), false);
  assert.equal(starts, 0);
  media.protect.event('playing');
  media.protect.event('playing');
  assert.equal(starts, 1);
  media.protect.event('ended');
  assert.equal(media.revenge.calls, 0);
  assert.equal(v.play('revenge', true), true);
  v.stop();
  assert.equal(media.revenge.paused, true);
});
test('response playback failure, mute and stale promises release audio without a scene cancellation', async () => {
  const media = { protect: new Media(), revenge: new Media() },
    v = createBullResponseVoice(media);
  let reject;
  media.protect.play = () => new Promise((_, r) => (reject = r));
  v.play('protect', true);
  v.stop();
  v.play('revenge', true);
  reject(new Error('stale'));
  await Promise.resolve();
  assert.equal(v.snapshot().mode, 'revenge');
  v.stop();
  media.protect.play = () => Promise.reject(new Error('blocked'));
  v.play('protect', true);
  await Promise.resolve();
  assert.equal(v.busy(), false);
  v.play('revenge', true);
  media.revenge.event('error');
  assert.equal(v.busy(), false);
});
