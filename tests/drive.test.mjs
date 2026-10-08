import { STARTING_PLATFORM } from '../src/road-network.js';
import { canalOffset } from '../src/canal-profile.js';
import { paddyLift } from '../src/paddy-profile.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  spawnState,
  stepDrive,
  islandDistance,
  nearestRoad,
  roadPoint,
  roadFrame,
  terrainHeight,
  drivingHeight,
  landscapeHeight,
  isRoadSurface,
  inStream,
  ROAD_WIDTH,
} from '../src/drive.js';
const empty = { forward: false, backward: false, left: false, right: false, brake: false };
const advance = (s, i, t, colliders = []) => {
  for (let n = 0; n < t * 120; n++) stepDrive(s, { ...empty, ...i }, 1 / 120, colliders);
};
test('spawn is parked at the original road corner and stationary', () => {
  const s = spawnState();
  assert.equal(s.x, STARTING_PLATFORM.x);
  assert.equal(s.z, STARTING_PLATFORM.z);
  assert.equal(s.heading, STARTING_PLATFORM.heading);
  assert.equal(s.speed, 0);
  assert(islandDistance(s.x, s.z) < -10);
});
test('accelerate, release to coast, then brake', () => {
  const s = spawnState();
  advance(s, { forward: true }, 1);
  assert(s.speed > 5);
  const speed = s.speed;
  advance(s, {}, 0.4);
  assert(s.speed < speed && s.speed > 0);
  advance(s, { brake: true }, 1);
  assert.equal(s.speed, 0);
});
test('reverse steering remains consistent with movement', () => {
  const s = spawnState(),
    h = s.heading;
  advance(s, { backward: true, left: true }, 1);
  assert(s.speed < 0);
  assert(s.heading < h);
});
test('cannot rotate car in place', () => {
  const s = spawnState(),
    h = s.heading;
  advance(s, { left: true }, 1);
  assert.equal(s.heading, h);
});
test('sample world boundary prevents leaving the ground', () => {
  const s = { ...spawnState(), x: 100, z: 220, heading: 0 };
  advance(s, { forward: true }, 10);
  assert(islandDistance(s.x, s.z) <= -2);
});
test('obstacles stop motion gently', () => {
  const s = { ...spawnState(), x: 0, z: 0, heading: 0 };
  advance(s, { forward: true }, 3, [{ x: 0, z: 5, radius: 1 }]);
  assert(s.z < 3.2);
  assert(Number.isFinite(s.speed));
});
test('grass remains freely driveable', () => {
  const s = { ...spawnState(), x: 20, z: 0, heading: 0 };
  advance(s, { forward: true }, 1);
  assert(s.z > 2.5);
  assert.equal(s.surface, '草地');
});
test('forward speed reaches 60 km/h on roads and 30 km/h on grass', () => {
  for (const [x, z, limit] of [
    [132, 20, 60],
    [20, 40, 30],
  ]) {
    const s = { ...spawnState(), x, z, heading: 0 };
    advance(s, { forward: true }, 5);
    assert(Math.abs(s.speed * 3.6 - limit) < 1e-9);
    assert.equal(Math.round(Math.abs(s.speed) * 3.6), limit);
  }
});
test('leaving pavement applies the grass limit and returning permits 60 km/h', () => {
  const s = { ...spawnState(), x: 133.9, z: 40, heading: Math.PI / 2, speed: 60 / 3.6 };
  advance(s, { forward: true }, 1);
  assert.equal(s.surface, '草地');
  assert(Math.abs(s.speed * 3.6 - 30) < 1e-9);
  Object.assign(s, { x: 132, z: 60, heading: 0 });
  advance(s, { forward: true }, 2);
  assert.equal(s.surface, '公路');
  assert(Math.abs(s.speed * 3.6 - 60) < 1e-9);
});
test('continuous terrain and shared driving height across the sample', () => {
  for (let x = -100; x <= 100; x += 5)
    for (let z = -30; z <= 240; z += 5) {
      const h = terrainHeight(x, z);
      assert(Number.isFinite(h));
      assert(Math.abs(terrainHeight(x + 0.05, z) - h) < 0.02);
      assert.equal(drivingHeight(x, z), landscapeHeight(x, z) + paddyLift(x, z, roadPoint));
    }
});
test('road is about 200m, 4.5m wide, and clear of the canal', () => {
  let length = 0;
  for (let i = 1; i <= 400; i++) {
    const a = roadPoint((i - 1) * 0.5),
      b = roadPoint(i * 0.5);
    length += Math.hypot(b.x - a.x, b.z - a.z);
    assert(!inStream(b.x, b.z));
    assert(isRoadSurface(b.x, b.z));
  }
  assert(length > 200 && length < 207);
  assert.equal(ROAD_WIDTH, 4.5);
  for (let z = 20; z < 180; z += 10) {
    const p = roadFrame(z);
    assert(inStream(p.x + p.nx * canalOffset(z), p.z + p.nz * canalOffset(z)));
    assert(!inStream(p.x + p.nx * 6.8, p.z + p.nz * 6.8));
  }
});
test('turnaround areas are paved and remain inside the world', () => {
  for (const [x, z] of [
    [0, 0],
    [-26, 200],
  ])
    for (let a = 0; a < 6.28; a += 0.2) {
      const px = x + Math.cos(a) * 6,
        pz = z + Math.sin(a) * 6;
      assert(isRoadSurface(px, pz));
      assert(islandDistance(px, pz) < -2);
    }
});
test('closed-loop controls drive the entire road forward and back without collision', () => {
  const s = { ...spawnState(), ...roadFrame(5) };
  let hits = 0,
    maxDeviation = 0;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  for (const direction of [1, -1]) {
    if (direction < 0) advance(s, { brake: true }, 1);
    let arrived = false;
    for (let n = 0; n < 120 * 80; n++) {
      const target = roadPoint(Math.max(5, Math.min(195, s.z + direction * 5))),
        desired = Math.atan2(target.x - s.x, target.z - s.z) + (direction < 0 ? Math.PI : 0),
        error = wrap(desired - s.heading) * direction;
      const input = {
        ...empty,
        forward: direction > 0,
        backward: direction < 0,
        left: error > 0.012,
        right: error < -0.012,
      };
      if (stepDrive(s, input, 1 / 120)) hits++;
      maxDeviation = Math.max(maxDeviation, nearestRoad(s.x, s.z).distance);
      if (direction > 0 ? s.z >= 194 : s.z <= 6) {
        arrived = true;
        break;
      }
    }
    assert(arrived, `Did not complete direction ${direction}: ${JSON.stringify(s)}`);
  }
  assert.equal(hits, 0);
  assert(maxDeviation < 0.8, `Deviation ${maxDeviation}`);
});

test('local bank support height agrees with visible terrain and keeps paved lane untouched', () => {
  for (let s = 10; s <= 33; s += 0.25) {
    const f = roadFrame(s);
    for (let d = -8; d <= -2.7; d += 0.05) {
      const x = f.x + f.nx * d,
        z = f.z + f.nz * d;
      assert.equal(drivingHeight(x, z), landscapeHeight(x, z));
    }
    for (const d of [-2.25, 0, 2.25]) {
      const x = f.x + f.nx * d,
        z = f.z + f.nz * d;
      assert(Math.abs(drivingHeight(x, z) - terrainHeight(x, z)) < 1e-8);
    }
  }
});

test('vehicle collision reports the actual obstacle only for a moving impact and preserves boolean result', () => {
  const s = { ...spawnState(), x: -22, z: 3, heading: 0, speed: 2 },
    c = { x: -22, z: 5.55, radius: 1 },
    hits = [];
  assert.equal(
    stepDrive(s, empty, 1 / 60, [c], (hit) => hits.push(hit)),
    true,
  );
  assert.deepEqual(hits, [c]);
  const stopped = { ...s, speed: 0 };
  stepDrive(stopped, empty, 1 / 60, [c], () => assert.fail('stationary contact'));
  stepDrive(s, empty, 0, [c], () => assert.fail('paused contact'));
});

test('car can reverse out of an animal overlap after bull collider expands, without a new collision event', () => {
  const s = { ...spawnState(), x: -28, z: 8, heading: -Math.PI / 2, speed: 0 },
    bull = { x: -30, z: 8, radius: 0.43 };
  assert.equal(stepDrive(s, empty, 1 / 60, [bull]), false);
  bull.radius = 1.1;
  const x = s.x;
  for (let i = 0; i < 120; i++)
    stepDrive(s, { ...empty, backward: true }, 1 / 120, [bull], () =>
      assert.fail('escape must not count as a new hit'),
    );
  assert.ok(s.x > x + 1, 'reverse must actually move away');
});
test('existing animal overlap blocks deeper pushing but permits escape for front, rear, side and deeply embedded contact', () => {
  for (const heading of [0, Math.PI / 2, -Math.PI / 2, Math.PI])
    for (const separation of [0.4, 2]) {
      const c = {
        x: -28 + Math.sin(heading) * separation,
        z: 8 + Math.cos(heading) * separation,
        radius: 1.1,
      };
      const inward = { ...spawnState(), x: -28, z: 8, heading, speed: 0 };
      advance(inward, { forward: true }, 0.2, [c]);
      assert.ok(Math.hypot(inward.x + 28, inward.z - 8) < 1e-7, 'cannot push deeper');
      const outward = { ...spawnState(), x: -28, z: 8, heading, speed: 0 };
      advance(outward, { backward: true }, 1, [c]);
      assert.ok(Math.hypot(outward.x + 28, outward.z - 8) > 1, 'must be able to leave overlap');
    }
});
test('escape still checks a second obstacle behind the car', () => {
  const s = { ...spawnState(), x: -28, z: 8, heading: 0, speed: 0 },
    front = { x: -28, z: 10, radius: 1.1 },
    rear = { x: -28, z: 4, radius: 0.7 };
  advance(s, { backward: true }, 2, [front, rear]);
  assert.ok(s.z < 7);
  assert.ok(s.z > 6.2, 'cannot escape through the rear obstacle');
});
