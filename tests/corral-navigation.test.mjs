import test from 'node:test';
import assert from 'node:assert/strict';
import { animalPathSearch, clearAnimalSegment, findAnimalPath } from '../src/corral-navigation.js';

test('incremental animal search yields during long segments and obstacle detours, preserving safe synchronous routes', () => {
  const start = { x: 0, z: 0 },
    goal = { x: 10, z: 0 };
  const allowed = (x, z) => Math.hypot(x - 5, z) > 2;
  let queries = 0;
  const search = animalPathSearch(
    start,
    goal,
    (x, z) => {
      queries++;
      return allowed(x, z);
    },
    { step: 0.5, padding: 4 },
  );
  let result,
    frames = 0;
  do {
    const previous = queries;
    for (let i = 0; i < 64; i++) {
      result = search.next();
      if (result.done) break;
    }
    assert(queries - previous <= 64);
    frames++;
    assert(frames < 1000);
  } while (!result.done);
  assert(frames > 1);
  assert.deepEqual(result.value, findAnimalPath(start, goal, allowed, { step: 0.5, padding: 4 }));
  let from = start;
  for (const p of result.value) {
    assert(clearAnimalSegment(from, p, allowed));
    from = p;
  }
});

test('incremental search rejects blocked goals and cannot escape an enclosed start', () => {
  const start = { x: 0, z: 0 },
    goal = { x: 4, z: 0 };
  assert.equal(
    findAnimalPath(start, goal, () => false),
    null,
  );
  assert.equal(
    findAnimalPath(start, goal, (x, z) => Math.hypot(x, z) < 0.1 || Math.hypot(x, z) > 1),
    null,
  );
});

test('a finer grid escapes the real flagbearer gap between the calf and giant without crossing either body', () => {
  const start = { x: 153.276464, z: 17.434008 },
    goal = { x: 164, z: 12 };
  const bodies = [
    { x: 150.631484, z: 17.211, radius: 0.825653 },
    { x: 156.226762, z: 17.364656, radius: 1.05 },
  ];
  const allowed = (x, z) =>
    bodies.every((body) => Math.hypot(x - body.x, z - body.z) >= 1.65 + body.radius + 0.1);
  assert.equal(findAnimalPath(start, goal, allowed, { step: 0.5, padding: 8 }), null);
  const path = findAnimalPath(start, goal, allowed, { step: 0.25, padding: 8 });
  assert(path?.length);
  let from = start;
  for (const p of path) {
    assert(clearAnimalSegment(from, p, allowed));
    from = p;
  }
});
