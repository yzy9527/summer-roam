import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rescueFixture } from './helpers/rescue-fixture.mjs';
import { BULL_PATROL, inBullPatrol } from '../src/animal-meadow.js';
import { CALF_RESCUE, rescueVisible } from '../src/zombie-calf-rescue.js';
import { CREW_PARKING } from '../src/zombie-crew-cart.js';
import { CALF_ESCAPE } from '../src/zombie-corral.js';
import { landscapeHeight } from '../src/world-queries.js';
import { createCorralVoice, RESCUE_VOICE_URLS } from '../src/corral-audio.js';
import { vehicleObstacleGap } from '../src/vehicle-collision.js';

test('bull patrol includes a far end outside both rescue radii; sight checks ignore foliage only by collider semantics', () => {
  assert(inBullPatrol(-33, 25));
  assert(inBullPatrol(-30, 7));
  assert(!inBullPatrol(-20, 25));
  assert(Math.hypot(-33 + 26, 25 - 5) > CALF_RESCUE.threat);
  assert.equal(BULL_PATROL.maxZ, 26);
  assert(!rescueVisible({ x: 0, z: 0 }, { x: 10, z: 0 }, [{ x: 5, z: 0, radius: 0.5 }]));
  assert(rescueVisible({ x: 0, z: 0 }, { x: 10, z: 0 }, [{ x: 5, z: 1, radius: 0.5 }]));
});

test('real calf facing the open gate prepares once; other headings retain 40% draws at ten seconds', async () => {
  const f = await rescueFixture(() => 0.9),
    a = f.animal('hornless-calf');
  f.place(a, 164, 24, Math.PI);
  f.corral.finishDelivery(a);
  a.wait = 600; // Keep the tested heading while the door opens.
  assert(f.corral.setManualGateOpen(true));
  for (let i = 0; i < 40; i++) f.tick();
  assert.equal(f.corral.snapshot().gateAmount, 1);
  assert(f.corral.snapshot().drawIn <= CALF_ESCAPE.interval && f.corral.snapshot().drawIn > 9.5);
  assert.equal(f.corral.snapshot().directedEscapes.length, 1);
  const frozen = JSON.stringify(f.corral.snapshot());
  f.tick(0);
  assert.equal(JSON.stringify(f.corral.snapshot()), frozen);
  for (let i = 0; i < 21; i++) f.tick();
  assert.equal(a.mode, 'escaping');
  const g = await rescueFixture(() => 0.9),
    b = g.animal('hornless-calf');
  g.place(b, 164, 24, 0);
  g.corral.finishDelivery(b);
  b.wait = 600;
  g.corral.setManualGateOpen(true);
  for (let i = 0; i < 240; i++) g.tick();
  assert.equal(b.mode, 'confined');
  assert.equal(g.corral.snapshot().draws, 2);
});

test('same real calf returns to field ownership; long chase has no fifteen-second cutoff and freezes on pause', async () => {
  const f = await rescueFixture();
  const a = f.escaping(-26, -27, { x: 100, z: -27 });
  f.placeGiant(-34, -27, Math.PI / 2);
  f.reportEscape(f.animal('hornless-calf'));
  for (let i = 0; i < 320; i++) f.tick();
  assert(
    ['chasing', 'reaching'].includes(f.rescue.snapshot().phase),
    JSON.stringify(f.rescue.snapshot()),
  );
  assert(f.giant.rig.snapshot().run > 0);
  const frozen = JSON.stringify({ rescue: f.rescue.snapshot(), rig: f.giant.rig.snapshot() });
  f.tick(0);
  assert.equal(
    JSON.stringify({ rescue: f.rescue.snapshot(), rig: f.giant.rig.snapshot() }),
    frozen,
  );
  for (let i = 0; i < 1000; i++) f.tick();
  assert.equal(a.transportOwner, undefined, JSON.stringify(f.rescue.snapshot()));
  assert(!f.corral.animals.includes(a));
  assert.equal(f.rearmed(), 1);
  assert(f.events.some((e) => e.type === 'animal-run' && e.id === 'hornless-calf'));
});

test('far bull permits real hand contact, same-instance capture and a complete return through the gate', async () => {
  const f = await rescueFixture(() => 0),
    a = f.escaping(-26, -3, { x: -26, z: 5 });
  f.placeGiant(-24.8, -4, 0);
  f.reportEscape(f.animal('hornless-calf'));
  for (let i = 0; i < 160 && f.rescue.snapshot().captures === 0; i++) f.tick();
  assert.equal(f.rescue.snapshot().captures, 1, JSON.stringify(f.rescue.snapshot()));
  assert.equal(a.mode, 'recapture-held');
  assert.equal(a.transportOwner, 'recapture');
  assert(f.rescue.snapshot().handGap < 0.22);
  const original = a.group;
  for (let i = 0; i < 10000 && f.rescue.snapshot().outcome !== 'recaptured'; i++) f.tick();
  assert.equal(f.rescue.snapshot().outcome, 'recaptured', JSON.stringify(f.rescue.snapshot()));
  assert.equal(a.group, original);
  assert.equal(a.mode, 'confined');
  assert.equal(a.transportOwner, 'corral');
  for (
    let i = 0;
    i < 2400 && (f.corral.snapshot().gateAmount > 0 || f.corral.snapshot().recaptureDelivery);
    i++
  )
    f.tick();
  assert.equal(
    f.corral.snapshot().gateAmount,
    0,
    JSON.stringify({ rescue: f.rescue.snapshot(), gate: f.corral.snapshot().gateOperation }),
  );
  assert.equal(a.mode, 'confined', 'Delivery must finish closing before another escape draw');
  assert.equal(f.corral.snapshot().recaptureDelivery, false);
});

test('near bull causes one courage draw, silent defense, and actual horn-mesh contact launches a parabola', async () => {
  const f = await rescueFixture(() => 0.9);
  f.place(f.animal('copper-cow'), -30, 7, Math.PI / 2);
  f.placeGiant(-27, 7, 0);
  let airborne = false,
    peak = 0,
    landed = false;
  for (let i = 0; i < 400; i++) {
    f.tick();
    const s = f.rescue.snapshot();
    if (s.phase === 'airborne') {
      airborne = true;
      peak = Math.max(
        peak,
        f.giant.object.position.y -
          landscapeHeight(f.giant.object.position.x, f.giant.object.position.z),
      );
    }
    if (airborne && s.phase === 'landed') landed = true;
  }
  assert(f.events.some((e) => e.type === 'bull-rescue'));
  assert(airborne, JSON.stringify(f.rescue.snapshot()));
  assert(peak > 1.5);
  assert(landed);
  assert.equal(f.rescue.snapshot().impacts, 1);
});

test('courage is drawn once per pursuit at the exact 50% boundary; held calf is safely released when bull approaches', async () => {
  for (const value of [0.499999, 0.5]) {
    let draws = 0;
    const f = await rescueFixture(() => {
      draws++;
      return value;
    });
    f.escaping();
    f.placeGiant(-24.8, -4, 0);
    f.reportEscape(f.animal('hornless-calf'));
    f.place(f.animal('copper-cow'), -32, 4, 0);
    for (let i = 0; i < 13; i++) f.tick();
    if (value < 0.5) {
      assert.equal(
        f.rescue.snapshot().outcome,
        'bull-retreat',
        JSON.stringify(f.rescue.snapshot()),
      );
      const count = draws;
      for (let i = 0; i < 50; i++) f.tick();
      assert.equal(draws, count);
    } else assert.equal(f.rescue.snapshot().courage, true);
  }
  const f = await rescueFixture(),
    a = f.escaping();
  f.placeGiant(-24.8, -4, 0);
  f.reportEscape(f.animal('hornless-calf'));
  for (let i = 0; i < 80 && f.rescue.snapshot().phase !== 'carrying'; i++) f.tick();
  assert(f.rescue.snapshot().carrying);
  f.place(f.animal('copper-cow'), -34, 4, 0);
  for (let i = 0; i < 25; i++) f.tick();
  assert(!f.rescue.snapshot().carrying, JSON.stringify(f.rescue.snapshot()));
  assert.equal(a.mode, 'escaping');
  assert.equal(a.transportOwner, 'corral');
  assert(Math.abs(a.group.position.y - landscapeHeight(a.x, a.z)) < 0.15);
});

test('real giant runs with flight phases, planted support, unchanged leg lengths and pause freezing', async () => {
  const f = await rescueFixture();
  f.placeGiant(-26, -27, Math.PI / 2);
  const bones = new Map();
  f.giant.object.traverse((n) => {
    if (n.isBone) bones.set(n.name.replace(/_0\d+$/, ''), n);
  });
  const segments = ['Left', 'Right'].flatMap((side) =>
    [
      ['UpLeg', 'Leg'],
      ['Leg', 'Foot'],
    ].map(([a, b]) => {
      const start = bones.get(`${side}${a}`),
        end = bones.get(`${side}${b}`);
      assert(start && end, `${side}${a} -> ${side}${b}`);
      const distance = () =>
        start
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(end.getWorldPosition(new THREE.Vector3()));
      return { distance, length: distance() };
    }),
  );
  let flight = false,
    maxGap = 0;
  for (let i = 0; i < 360; i++) {
    f.zombies.walk('pvz-gargantuar', { x: 100, z: -27 }, 1 / 60, {
      speed: 3.1,
      run: true,
      car: f.car,
    });
    const s = f.giant.rig.snapshot();
    for (const segment of segments) assert(Math.abs(segment.distance() - segment.length) < 1e-6);
    flight ||= s.legs.every((l) => l.swinging);
    for (const l of s.legs)
      if (!l.swinging)
        maxGap = Math.max(maxGap, Math.hypot(...l.foot.map((v, i) => v - l.planted[i])));
  }
  assert(flight);
  assert(maxGap < 0.025, `support error ${maxGap}`);
  const frozen = JSON.stringify(f.giant.rig.snapshot());
  f.zombies.walk('pvz-gargantuar', { x: 100, z: -27 }, 0, { speed: 3.1, run: true });
  assert.equal(JSON.stringify(f.giant.rig.snapshot()), frozen);
  f.zombies.rebind('pvz-gargantuar');
  assert.equal(f.giant.rig.snapshot().run, 0);
});

test('escape voice uses mama.wav; defense uses cow-moo.mp3, preempts the cry and updates distance without replay', () => {
  const media = Object.fromEntries(
    Object.keys(RESCUE_VOICE_URLS).map((id) => [
      id,
      {
        volume: 0,
        currentTime: 0,
        plays: 0,
        pause() {},
        play() {
          this.plays++;
          return Promise.resolve();
        },
        addEventListener() {},
      },
    ]),
  );
  const voice = createCorralVoice(media);
  voice.sync({ enabled: true, volume: 1, position: { x: 0, z: 0 } });
  assert(
    voice.event({ type: 'animal-run', id: 'hornless-calf', instanceId: 'calf', x: 10, z: 0 }, true),
  );
  assert(voice.snapshot().file.endsWith('mama.wav'));
  const gain = voice.snapshot().gain;
  voice.event({ type: 'animal-position', instanceId: 'calf', x: 30, z: 0 }, true);
  assert(voice.snapshot().gain < gain);
  assert.equal(media['calf-run-mama'].plays, 1);
  assert(
    voice.event({ type: 'bull-rescue', id: 'copper-cow', instanceId: 'bull', x: 10, z: 0 }, true),
  );
  assert(voice.snapshot().file.endsWith('cow-moo.mp3'));
  voice.sync({ enabled: false, volume: 1, position: { x: 0, z: 0 } });
  assert(!voice.busy());
});

test('other zombies alert only on actual sight, once per escape; hearing starts pursuit without instant capture', async () => {
  const f = await rescueFixture();
  const a = f.escaping(-26, -3, { x: 100, z: -3 });
  f.placeGiant(-14, -3);
  const watcher = f.zombies.actor('pvz-browncoat');
  watcher.object.position.set(-28, landscapeHeight(-28, -3), -3);
  watcher.object.rotation.y = Math.PI / 2;
  Object.assign(watcher.collider, { x: -28, z: -3 });
  f.zombies.rebind(watcher.layout.id);
  f.zombies.release(watcher.layout.id);
  watcher.rig.update(0.01, 0, landscapeHeight);
  const wall = { x: -27, z: -3, radius: 0.8 };
  f.colliders.push(wall);
  f.rescue.update(0.05, f.car);
  assert.equal(f.events.filter((e) => e.type === 'zombie-no').length, 0);
  f.colliders.splice(f.colliders.indexOf(wall), 1);
  f.rescue.update(0.05, f.car);
  assert.equal(
    f.events.filter((e) => e.type === 'zombie-no').length,
    1,
    JSON.stringify({
      watcher: { position: watcher.object.position.toArray(), scripted: watcher.scripted },
      calf: { x: a.x, z: a.z, mode: a.mode, outside: a.outside },
      rescue: f.rescue.snapshot(),
      events: f.events,
    }),
  );
  assert(['alert-search', 'chasing'].includes(f.rescue.snapshot().phase));
  assert.equal(f.rescue.snapshot().captures, 0);
  for (let i = 0; i < 30; i++) f.tick();
  assert.equal(f.events.filter((e) => e.type === 'zombie-no').length, 1);
  assert.equal(a.mode, 'escaping');
});

test('a sleeping bull wakes before defense; charging and parabola freeze exactly with zero dt', async () => {
  const f = await rescueFixture();
  const bull = f.animal('copper-cow');
  f.place(bull, -30, 7, Math.PI / 2);
  f.placeGiant(-27, 7);
  for (let i = 0; i < 80; i++) f.interactions.update(0.05, f.car, 'night', 0.05);
  assert(!f.interactions.sleep.ready(bull));
  f.rescue.update(0.05, f.car);
  assert.equal(f.rescue.snapshot().bull.phase, 'idle');
  assert.equal(f.events.filter((e) => e.type === 'bull-rescue').length, 0);
  f.placeGiant(-27, 7);
  let sawFlight = false;
  for (let i = 0; i < 200; i++) {
    if (f.rescue.snapshot().bull.phase === 'idle') f.placeGiant(-27, 7);
    f.interactions.update(0.05, f.car, 'night', 0.05);
    f.zombies.update(0.05, f.car);
    f.rescue.update(0.05, f.car);
    const s = f.rescue.snapshot();
    if (s.bull.phase !== 'idle') assert(f.interactions.sleep.ready(bull));
    if (['charging'].includes(s.bull.phase) || s.phase === 'airborne') {
      const frozen = JSON.stringify({ s, rig: f.giant.rig.snapshot(), cow: bull.rig.snapshot() });
      f.rescue.update(0, f.car);
      assert.equal(
        JSON.stringify({
          s: f.rescue.snapshot(),
          rig: f.giant.rig.snapshot(),
          cow: bull.rig.snapshot(),
        }),
        frozen,
      );
    }
    sawFlight ||= s.phase === 'airborne';
  }
  assert(f.events.some((e) => e.type === 'bull-rescue'));
  assert(sawFlight);
});

test('pursuit respects a parked player car while the calf continues home', async () => {
  const f = await rescueFixture();
  f.escaping(-26, -27, { x: 100, z: -27 });
  f.placeGiant(-34, -27, Math.PI / 2);
  f.reportEscape(f.animal('hornless-calf'));
  Object.assign(f.car, { x: -30, z: -27, heading: Math.PI / 2 });
  for (let i = 0; i < 180; i++) {
    f.tick();
    assert(vehicleObstacleGap(f.car.x, f.car.z, f.car.heading, f.giant.collider) > 0.15);
  }
  assert.equal(f.rescue.snapshot().captures, 0);
});

test('the real heist crew waits during bull defense and can take over ordinary patrol afterward', async () => {
  const f = await rescueFixture(() => 0.9, { withHeist: true });
  f.place(f.animal('golden-cow'), -25, 4);
  f.place(f.animal('copper-cow'), -30, 7, Math.PI / 2);
  f.place(f.animal('hornless-calf'), -25, 15.8);
  f.placeGiant(-27, 7);
  assert.equal(f.cart.root.position.x, CREW_PARKING.x);
  for (let i = 0; i < 100; i++) {
    f.tick();
    assert.equal(f.heist.snapshot().phase, 'waiting');
  }
  assert.equal(f.rescue.snapshot().impacts, 1);
  for (let i = 0; i < 600 && f.heist.snapshot().phase === 'waiting'; i++) f.tick();
  assert.equal(f.heist.snapshot().phase, 'crew-boarding');
  assert.equal(f.rescue.snapshot().phase, 'idle');
  assert.equal(f.rescue.snapshot().bull.phase, 'idle');
});
