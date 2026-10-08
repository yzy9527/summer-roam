import test from 'node:test';
import assert from 'node:assert/strict';
import { createCorralVoice, MANUAL_ANIMAL_CALL_URLS } from '../src/corral-audio.js';
class Media {
  volume = 0;
  currentTime = 0;
  plays = 0;
  listeners = {};
  fail = false;
  addEventListener(type, cb) {
    (this.listeners[type] ??= []).push(cb);
  }
  emit(type) {
    for (const cb of this.listeners[type] ?? []) cb();
  }
  pause() {}
  play() {
    this.plays++;
    return this.fail ? Promise.reject(new Error('blocked')) : Promise.resolve();
  }
}
test('explicit animal calls share the voice lock, distance, mute and cooldown; wolves do not start automatic calls', async () => {
  const wolf = new Media(),
    calf = new Media();
  let free = true,
    time = 0;
  const voice = createCorralVoice(
    { 'reference-wolf': wolf, 'hornless-calf': calf },
    () => free,
    () => 0.9,
    () => time,
  );
  const sync = (enabled) => voice.sync({ enabled, volume: 0.2, position: { x: 0, z: 0 } });
  const event = { type: 'animal-call', id: 'reference-wolf', instanceId: 'wild-wolf', x: 1, z: 0 };
  sync(true);
  assert(!voice.event({ ...event, type: 'animal-tap' }, true));
  assert(!voice.event(event, false));
  free = false;
  assert(!voice.event(event, true));
  free = true;
  assert(!voice.event({ ...event, x: 70 }, true));
  assert(voice.event(event, true));
  assert.equal(voice.snapshot().file, MANUAL_ANIMAL_CALL_URLS['reference-wolf']);
  assert(!voice.event({ ...event, id: 'hornless-calf' }, true));
  wolf.emit('playing');
  assert(voice.snapshot().started);
  wolf.emit('ended');
  assert(!voice.busy());
  assert(!voice.event(event, true));
  time = 3000;
  assert(voice.event(event, true));
  sync(false);
  assert(!voice.busy());
  sync(true);
  time = 6000;
  wolf.fail = true;
  assert(voice.event(event, true));
  await Promise.resolve();
  assert(!voice.busy());
  time = 9000;
  wolf.fail = false;
  assert(voice.event(event, true));
  wolf.emit('error');
  assert(!voice.busy());
  assert.equal(wolf.plays, 4);
  assert.equal(calf.plays, 0);
});
