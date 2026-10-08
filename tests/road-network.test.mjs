import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldRoadPaths, fieldRoadClearance } from '../src/road-network.js';
import { roadPoint, isRoadSurface, inStream, spawnState, stepDrive } from '../src/drive.js';
import { nearestRoad, ROAD_WIDTH } from '../src/world-base.js';
import { onStartingPlatform } from '../src/road-network.js';

test('road bounds pruning preserves every main-road, perimeter and platform classification', () => {
  for (let z = -12; z <= 212; z += 2)
    for (let x = -40; x <= 170; x += 2) {
      const expected =
        onStartingPlatform(x, z) ||
        nearestRoad(x, z).distance < ROAD_WIDTH / 2 + 0.18 ||
        Math.hypot(x, z) < 7.7 ||
        Math.hypot(x + 26, z - 200) < 8;
      assert.equal(isRoadSurface(x, z), expected, `${x},${z}`);
    }
});
test('field perimeter connects both ends and leaves the middle unpaved', () => {
  assert.equal(fieldRoadPaths.length, 1);
  for (const z of [0, 200])
    for (let x = roadPoint(z).x; x <= 122; x += 0.5) {
      assert(isRoadSurface(x, z));
      assert(!inStream(x, z));
    }
  for (let z = 10; z <= 190; z += 0.5) assert(isRoadSurface(132, z));
  for (let x = 10; x <= 110; x += 5) {
    assert(fieldRoadClearance(x, 104) > 10);
    assert(!isRoadSurface(x, 104));
  }
});
test('car can traverse the far-end left turn lane without water collision', () => {
  const s = { ...spawnState(), x: -26, z: 200, heading: Math.PI / 2 };
  let hits = 0;
  for (let i = 0; i < 120 * 15 && s.x < 115; i++)
    if (stepDrive(s, { forward: true }, 1 / 120)) hits++;
  assert.equal(hits, 0);
  assert(s.x >= 115);
  assert.equal(s.surface, '公路');
});
