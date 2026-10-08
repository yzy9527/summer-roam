import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalfLiftVoice } from '../src/calf-lift-voice.js';
import { createCalfTransportPose } from '../src/calf-transport-pose.js';
import { interactionFixture } from './helpers/interaction-fixture.mjs';

function mediaFixture() {
  const listeners = new Map();
  return {
    currentTime: 0,
    volume: 0,
    plays: 0,
    pauses: 0,
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    play() {
      this.plays++;
      return Promise.resolve();
    },
    pause() {
      this.pauses++;
    },
    emit(type) {
      listeners.get(type)?.();
    },
  };
}

test('lift call locks the shared voice slot, follows actual playback and never resumes a paused cry', async () => {
  const media = mediaFixture(),
    events = [];
  let free = true;
  const voice = createCalfLiftVoice(media, () => free),
    event = { x: 0, z: 0 };
  voice.sync({ enabled: true, volume: 0.22, position: event });
  free = false;
  assert.equal(voice.request(event, true), false);
  free = true;
  assert.equal(
    voice.request(event, true, (type) => events.push(type)),
    true,
  );
  assert.equal(voice.snapshot().started, false);
  assert.equal(voice.request(event, true), false);
  media.emit('playing');
  assert.deepEqual(events, ['playing']);
  voice.sync({ enabled: false, volume: 0.22, position: event });
  assert.deepEqual(events, ['playing', 'stopped']);
  voice.sync({ enabled: true, volume: 0.22, position: event });
  assert.equal(media.plays, 1);
  assert.equal(voice.busy(), false);
  assert.equal(voice.request({ x: 100, z: 0 }, true), false);
  media.play = () => Promise.reject(new Error('blocked'));
  assert.equal(voice.request(event, true), true);
  await Promise.resolve();
  assert.equal(voice.busy(), false);
  media.play = () => {
    media.plays++;
    return Promise.resolve();
  };
  voice.request(event, true);
  media.emit('error');
  assert.equal(voice.busy(), false);
  voice.request(event, true);
  media.emit('ended');
  assert.equal(voice.busy(), false);
});

test('real calf briefly kicks, keeps bone lengths and animates head, blink and tail on the cart', async () => {
  const f = await interactionFixture(() => 0.9),
    a = f.animal('hornless-calf');
  a.source = a.group.children[0];
  a.bindPose = [];
  a.source.traverse((bone) => {
    if (bone.isBone)
      a.bindPose.push({ bone, rotation: bone.quaternion.clone(), position: bone.position.clone() });
  });
  const pose = createCalfTransportPose(a),
    upper = a.source.getObjectByName('FL_Upper');
  pose.update(0.1, true, 1, 'underarm');
  const calm = upper.quaternion.clone();
  pose.startStruggle();
  pose.update(0.5, true, 1, 'underarm');
  assert(pose.snapshot().struggle > 0.8);
  assert(upper.quaternion.angleTo(calm) > 0.02);
  for (let i = 0; i < 20; i++) pose.update(0.1, true, 1, 'underarm');
  assert.equal(pose.snapshot().struggle, 0);
  assert(upper.quaternion.angleTo(calm) < 1e-6);
  let shake = 0,
    blink = 0,
    tail = 0;
  for (let i = 0; i < 150; i++) {
    pose.update(0.05, false);
    const s = pose.snapshot();
    shake = Math.max(shake, Math.abs(s.shake));
    blink = Math.max(blink, s.blink);
    tail = Math.max(tail, Math.abs(s.tail));
    for (const { bone, position } of a.bindPose) assert(bone.position.distanceTo(position) < 1e-9);
  }
  assert(shake > 0.1);
  assert(blink > 0.9);
  assert(tail > 0.12);
  const before = JSON.stringify([
    pose.snapshot(),
    a.bindPose.map(({ bone }) => bone.quaternion.toArray()),
  ]);
  pose.update(0, false);
  assert.equal(
    JSON.stringify([pose.snapshot(), a.bindPose.map(({ bone }) => bone.quaternion.toArray())]),
    before,
  );
});
