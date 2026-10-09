import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMilkVoice, MILK_VOICE_URLS } from '../src/gameplay/milk/voice.js';
import { milkFixture } from './helpers/milk-fixture.mjs';

class Media extends EventTarget {
  currentTime = 0;
  plays = 0;
  pauses = 0;
  play() {
    this.plays++;
    return Promise.resolve();
  }
  pause() {
    this.pauses++;
  }
  emit(type) {
    this.dispatchEvent(new Event(type));
  }
}
const settings = { enabled: true, volume: 0.22, position: { x: 164, z: 23 } };
const event = { x: 164, z: 23, line: 'question' };
const until = (f, predicate, seconds = 300) => {
  for (let i = 0; i < seconds / 0.05; i++) {
    f.step(0.05);
    if (predicate(f.milk.snapshot())) return;
  }
  assert.fail(JSON.stringify(f.milk.snapshot()));
};

test('one spatial milk slot selects supplied originals and distinguishes natural end from interruption', async () => {
  const media = new Media(),
    voice = createMilkVoice(media),
    calls = [];
  voice.sync(settings);
  assert(voice.request(event, true, (type) => calls.push(type)));
  assert.equal(media.src, MILK_VOICE_URLS.question);
  assert(!voice.request({ ...event, line: 'answer' }, true));
  media.emit('playing');
  media.emit('playing');
  media.emit('ended');
  assert.deepEqual(calls, ['playing', 'ended']);
  assert(voice.request({ ...event, line: 'answer' }, true, (type) => calls.push(type)));
  assert.equal(media.src, MILK_VOICE_URLS.answer);
  media.emit('playing');
  voice.sync({ ...settings, enabled: false });
  voice.sync(settings);
  assert.deepEqual(calls, ['playing', 'ended', 'playing', 'stopped']);
  assert.equal(media.plays, 2, 'unmuting does not replay');
  assert(!voice.request({ ...event, x: 300 }, true));
  assert(!voice.request({ ...event, line: 'unknown' }, true));
  let rejectOld;
  media.play = () =>
    new Promise((resolve, reject) => {
      rejectOld = reject;
    });
  assert(voice.request(event, true));
  voice.stop();
  media.play = () => Promise.resolve();
  assert(voice.request({ ...event, line: 'answer' }, true));
  rejectOld(new Error('stale'));
  await Promise.resolve();
  assert(voice.busy(), 'stale failure cannot release the answer');
  media.emit('error');
  assert(!voice.busy());
  media.play = () => Promise.reject(new Error('blocked'));
  assert(voice.request(event, true));
  await Promise.resolve();
  assert(!voice.busy());
  for (const file of ['haiyouma.mp3', 'manzu.mp3'])
    assert.deepEqual(
      readFileSync(new URL(`../src/assets/audio/${file}`, import.meta.url)),
      readFileSync(new URL(`../assets-source/audio/${file}`, import.meta.url)),
    );
});

test('real skins drink first, ask and answer on media events, then collect the original empty pail', async () => {
  const f = await milkFixture(),
    media = new Media(),
    voice = createMilkVoice(media);
  voice.sync(settings);
  const lines = [];
  f.milk.connectAudio((request, notify) => {
    if (request.type === 'milk-voice-stop') {
      voice.stop();
      return false;
    }
    lines.push(request.line);
    return voice.request(request, true, notify);
  });
  f.confine();
  assert(f.milk.start());
  until(f, (s) => s.phase === 'question');
  assert.equal(f.milk.snapshot().milk, 0);
  assert.equal(f.milk.snapshot().carried, false);
  assert.equal(lines.length, 0, 'nothing is requested during drinking');
  f.step(0.05);
  media.emit('playing');
  for (let i = 0; i < 40; i++) f.step(0.05);
  assert.equal(f.milk.snapshot().phase, 'question', 'no guessed duration');
  assert(f.calf.vocalPose > 0.2);
  assert.equal(f.leopard.vocalPose ?? 0, 0);
  const before = f.milk.snapshot();
  f.step(0);
  assert.deepEqual(f.milk.snapshot(), before);
  media.emit('ended');
  f.step(0.05);
  assert.equal(f.milk.snapshot().phase, 'answer');
  assert.equal(f.calf.vocalPose, 0);
  f.step(0.05);
  media.emit('playing');
  for (let i = 0; i < 100; i++) f.step(0.05);
  assert.equal(f.milk.snapshot().phase, 'answer');
  assert.equal(f.milk.snapshot().carried, false, 'answer must finish before pickup');
  assert(f.leopard.vocalPose > 0.2);
  media.emit('ended');
  until(f, (s) => s.carried && s.inside, 30);
  assert.deepEqual(lines, ['question', 'answer']);
  assert.equal(f.calf.transportOwner, 'corral');
  assert.equal(f.leopard.vocalPose, 0);
  until(f, (s) => s.phase === 'idle');
  assert.equal(f.milk.snapshot().result, 'fed');
  assert.equal(f.milk.snapshot().milk, 0);
  assert.equal(f.milk.bucket.root.position.x, -20);
});

test('interrupted question does not queue an answer and cancellation ignores stale media callbacks', async () => {
  const f = await milkFixture();
  let notify;
  const lines = [];
  f.milk.connectAudio((event, callback) => {
    if (event.type === 'milk-voice-stop') return false;
    lines.push(event.line);
    notify = callback;
    return true;
  });
  f.confine();
  f.milk.start();
  until(f, (s) => s.phase === 'question');
  f.step(0.05);
  notify('playing');
  notify('stopped');
  f.step(0);
  assert.equal(f.milk.snapshot().phase, 'question', 'pause freezes progression');
  f.step(0.05);
  assert.equal(f.milk.snapshot().phase, 'clearing-calf');
  notify('ended');
  assert.deepEqual(lines, ['question']);
  assert.equal(f.calf.vocalPose, 0);
  assert(f.milk.cancel());
  until(f, (s) => s.phase === 'idle');
  assert.equal(f.leopard.transportOwner, undefined);
  assert.equal(f.calf.transportOwner, 'corral');
});
