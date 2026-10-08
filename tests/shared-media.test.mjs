import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAudioResourceCache,
  createSharedMediaPool,
  setAudioSource,
} from '../src/audio/shared-media.js';
import { createSpatialVoice } from '../src/audio/spatial-voice.js';
import { createCalfLiftVoice, CALF_LIFT_URLS } from '../src/calf-lift-voice.js';
import { createPaddyCowVoice } from '../src/paddy-cow-voice.js';

const baseURL = 'https://game.example/game/';
const response = () => ({ ok: true, blob: async () => new Blob(['audio']) });
const flush = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function resources(fetchResource = async () => response()) {
  const created = [],
    revoked = [];
  const cache = createAudioResourceCache({
    baseURL,
    fetchResource,
    createObjectURL(blob) {
      const url = `blob:test-${created.length}`;
      created.push({ blob, url });
      return url;
    },
    revokeObjectURL: (url) => revoked.push(url),
  });
  return { cache, created, revoked };
}
class Media extends EventTarget {
  paused = true;
  currentTime = 0;
  volume = 1;
  muted = false;
  error = null;
  src = '';
  plays = 0;
  loads = 0;
  play() {
    this.plays++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  load() {
    this.loads++;
    this.currentTime = 0;
    this.error = null;
  }
  removeAttribute(name) {
    if (name === 'src') this.src = '';
  }
  emit(type) {
    this.dispatchEvent(new Event(type));
  }
}
function poolWith(fetchResource) {
  const fixture = resources(fetchResource);
  return {
    ...fixture,
    pool: createSharedMediaPool({ resources: fixture.cache, createMedia: () => new Media() }),
  };
}

test('concurrent complete URLs share one promise, one download and one successful object URL', async () => {
  const download = deferred(),
    requests = [];
  const { cache, created } = resources((url) => {
    requests.push(url);
    return download.promise;
  });
  const first = cache.load('./cow.mp3?v=1'),
    second = cache.load('https://game.example/game/cow.mp3?v=1');
  assert.equal(first, second);
  await flush();
  assert.deepEqual(requests, [baseURL + 'cow.mp3?v=1']);
  download.resolve(response());
  assert.equal(await first, await second);
  assert.equal(cache.load('./cow.mp3?v=1'), first);
  assert.equal(created.length, 1);
  await cache.load('./cow.mp3?v=2');
  assert.equal(requests.length, 2, 'different query parameters are different resources');
  cache.dispose();
});

for (const failure of ['network', 'http', 'body', 'empty']) {
  test(`${failure} failure releases the entry so a later request can retry`, async () => {
    let calls = 0;
    const { cache, created } = resources(async () => {
      calls++;
      if (calls > 1) return response();
      if (failure === 'network') throw new Error('offline');
      if (failure === 'http') return { ok: false, status: 503 };
      if (failure === 'empty') return { ok: true, blob: async () => new Blob([]) };
      return {
        ok: true,
        blob: async () => {
          throw new Error('body failed');
        },
      };
    });
    const first = cache.load('cow.mp3');
    assert.equal(cache.load('cow.mp3'), first);
    await assert.rejects(first);
    assert.equal(created.length, 0);
    await cache.load('cow.mp3');
    await cache.load('cow.mp3');
    assert.equal(calls, 2);
    cache.dispose();
  });
}

test('independent players share data while pause, volume, time and native events stay independent', async () => {
  let calls = 0;
  const { pool, created } = poolWith(async () => {
    calls++;
    return response();
  });
  const a = pool.create('cow.mp3'),
    b = pool.create('cow.mp3');
  assert.ok(a instanceof Media && b instanceof Media);
  assert.notEqual(a, b);
  a.volume = 0.1;
  b.volume = 0.3;
  const events = [];
  a.addEventListener('playing', () => events.push('a-playing'));
  b.addEventListener('playing', () => events.push('b-playing'));
  b.addEventListener('ended', () => events.push('b-ended'));
  await Promise.all([a.play(), b.play()]);
  assert.deepEqual(events, [], 'no simulated playing event on download or play resolution');
  a.emit('playing');
  b.emit('playing');
  a.currentTime = 2;
  b.currentTime = 4;
  a.pause();
  assert.equal(b.paused, false);
  assert.equal(b.currentTime, 4);
  assert.equal(b.volume, 0.3);
  b.emit('ended');
  assert.deepEqual(events, ['a-playing', 'b-playing', 'b-ended']);
  await a.play();
  assert.equal(a.currentTime, 2, 'resume keeps the playhead');
  assert.equal(calls, 1);
  assert.equal(created.length, 1);
  assert.equal(a.src, b.src);
  pool.dispose();
});

test('pause immediately rejects a pending play but leaves another player and shared download intact', async () => {
  const download = deferred();
  const { pool } = poolWith(() => download.promise);
  const a = pool.create('cow.mp3'),
    b = pool.create('cow.mp3');
  const cancelled = assert.rejects(a.play(), { name: 'AbortError' });
  const playing = b.play();
  a.pause();
  await cancelled;
  assert.equal(a.plays, 0);
  download.resolve(response());
  await playing;
  assert.equal(a.plays, 0);
  assert.equal(b.plays, 1);
  pool.dispose();
});

test('source switching invalidates old playback and late results cannot overwrite the new source', async () => {
  const downloads = new Map(),
    calls = [];
  const { pool, cache } = poolWith((url) => {
    calls.push(url);
    const download = deferred();
    downloads.set(url, download);
    return download.promise;
  });
  const media = pool.create('a.mp3');
  const cancelled = assert.rejects(media.play(), { name: 'AbortError' });
  await flush();
  setAudioSource(media, 'b.mp3');
  await cancelled;
  const current = media.play();
  await flush();
  downloads.get(baseURL + 'b.mp3').resolve(response());
  await current;
  const bound = media.src;
  downloads.get(baseURL + 'a.mp3').resolve(response());
  await flush();
  assert.equal(media.src, bound);
  assert.equal(media.plays, 1);
  media.currentTime = 3;
  const loads = media.loads;
  setAudioSource(media, 'b.mp3');
  assert.equal(media.currentTime, 3);
  assert.equal(media.loads, loads);
  setAudioSource(media, 'a.mp3');
  await media.play();
  assert.equal(media.src, cache.peek('a.mp3'));
  assert.equal(calls.length, 2, 'switching back reuses successful data');
  pool.dispose();
});

test('music is lazy; a failed prefetch retries on playback and a decode error reuses downloaded data', async () => {
  let calls = 0;
  const { pool } = poolWith(async () => {
    calls++;
    if (calls === 1) throw new Error('offline');
    return response();
  });
  const music = pool.create('music.mp3', { preload: 'none' });
  await flush();
  assert.equal(calls, 0);
  const voice = pool.create('cow.mp3');
  await flush();
  assert.equal(calls, 1);
  await voice.play();
  assert.equal(calls, 2);
  voice.error = { code: 3 };
  await voice.play();
  assert.equal(voice.loads, 1);
  assert.equal(calls, 2, 'decode recovery must not refetch a successful download');
  await music.play();
  assert.equal(calls, 3);
  pool.dispose();
});

test('dispose cancels pending plays, aborts downloads and revokes URLs once without late allocations', async () => {
  const body = deferred();
  let signal;
  const { pool, created, revoked } = poolWith(async (_url, options) => {
    signal = options.signal;
    return { ok: true, blob: () => body.promise };
  });
  const media = pool.create('cow.mp3');
  const cancelled = assert.rejects(media.play(), { name: 'AbortError' });
  await flush();
  pool.dispose();
  pool.dispose();
  await cancelled;
  assert.equal(signal.aborted, true);
  body.resolve(new Blob(['audio']));
  await flush();
  assert.equal(created.length, 0);
  assert.equal(revoked.length, 0);
  assert.equal(media.plays, 0);
  await assert.rejects(media.play(), { name: 'AbortError' });
  assert.throws(() => pool.create('cow.mp3'), { name: 'AbortError' });
  const ready = poolWith();
  const a = ready.pool.create('cow.mp3'),
    b = ready.pool.create('cow.mp3');
  await Promise.all([a.play(), b.play()]);
  ready.pool.dispose();
  ready.pool.dispose();
  assert.deepEqual(ready.revoked, [ready.created[0].url]);
  assert.equal(a.paused, true);
  assert.equal(b.src, '');
});

test('spatial cancellation releases the game slot immediately and never replays on late download', async () => {
  const download = deferred();
  const { pool } = poolWith(() => download.promise);
  const media = pool.create('cow.mp3');
  const voice = createSpatialVoice(media),
    events = [],
    event = { x: 0, z: 0 };
  voice.sync({ enabled: true, volume: 0.2, position: event });
  assert.equal(
    voice.request(event, true, (type) => events.push(type)),
    true,
  );
  assert.equal(voice.snapshot().busy, true);
  voice.sync({ enabled: false, volume: 0.2, position: event });
  assert.deepEqual(events, ['stopped']);
  download.resolve(response());
  await flush();
  assert.equal(voice.snapshot().busy, false);
  assert.equal(media.plays, 0);
  pool.dispose();
});

test('lift dynamic selection and lazy paddy creation use the same successful resource', async (t) => {
  const calls = [];
  const { pool, cache } = poolWith(async (url) => {
    calls.push(url);
    return response();
  });
  const savedRandom = Math.random;
  t.after(() => {
    Math.random = savedRandom;
    pool.dispose();
  });
  const media = pool.create(CALF_LIFT_URLS[0]),
    lift = createCalfLiftVoice(media);
  const event = { x: 0, z: 0 };
  lift.sync({ enabled: true, volume: 0.2, position: event });
  Math.random = () => 0.8;
  assert.equal(lift.request(event, true), true);
  await flush();
  assert.equal(media.src, cache.peek(CALF_LIFT_URLS[1]));
  media.emit('playing');
  lift.stop();
  let creations = 0;
  const paddy = createPaddyCowVoice((_id, url) => {
    creations++;
    return pool.create(url);
  });
  paddy.sync({ enabled: true, volume: 0.2, position: event });
  assert.equal(creations, 0);
  assert.equal(paddy.request({ ...event, cowId: 'hornless-calf' }, true), true);
  await flush();
  assert.equal(creations, 1);
  assert.equal(calls.filter((url) => url.endsWith('/mama.wav')).length, 1);
  paddy.stop();
});
