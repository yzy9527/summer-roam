import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameplayTick } from '../src/gameplay/tick.js';
import { snapshotData, recordPhase, PHASE_HISTORY_LIMIT } from '../src/app/snapshot-data.js';
import { claimAnimal, transferAnimal, releaseAnimal } from '../src/gameplay/animal-ownership.js';

test('ownership handoffs reject a conflicting claim and a stale release', () => {
  const calf = {};
  assert(claimAnimal(calf, 'heist'));
  assert(!claimAnimal(calf, 'plough'));
  assert(!transferAnimal(calf, 'recapture', 'corral'));
  assert(transferAnimal(calf, 'heist', 'corral'));
  assert(!releaseAnimal(calf, 'heist'));
  assert.equal(calf.transportOwner, 'corral');
  assert(transferAnimal(calf, 'corral', 'plough'));
  assert(!transferAnimal(calf, 'plough', 'unknown-task'));
  assert(releaseAnimal(calf, 'plough'));
  assert.equal(calf.transportOwner, undefined);
});
test('nested snapshots are isolated and phase history is bounded', () => {
  const state = { route: [{ x: 1, z: 2 }], history: [], nested: { goals: [[3, 4]] } };
  for (let i = 0; i < 1000; i++) recordPhase(state.history, 'phase-' + i);
  assert.equal(state.history.length, PHASE_HISTORY_LIMIT);
  assert.equal(state.history.at(-1), 'phase-999');
  const data = snapshotData(state);
  data.route[0].x = 99;
  data.nested.goals[0][0] = 99;
  data.history.length = 0;
  assert.equal(state.route[0].x, 1);
  assert.equal(state.nested.goals[0][0], 3);
  assert.equal(state.history.length, PHASE_HISTORY_LIMIT);
});
test('runtime and QA tick preserve handoff order, player/focus separation and pause timing', () => {
  const calls = [];
  const systems = Object.fromEntries(
    [
      'animals',
      'goldfish',
      'zombies',
      'paddy',
      'cart',
      'corral',
      'heist',
      'rescue',
      'campsite',
    ].map((name) => [name, { update: (...args) => calls.push([name, ...args]) }]),
  );
  const tick = createGameplayTick(systems),
    player = { x: 1, z: 2 },
    focus = { x: 100, z: 200 },
    cameraPosition = { x: 101, z: 201 };
  tick({ dt: 0.03, clockDt: 2, player, focus, cameraPosition, timeOfDay: 'night' });
  assert.deepEqual(
    calls.map((c) => c[0]),
    Object.keys(systems),
  );
  assert.deepEqual(calls[0], ['animals', 0.03, player, 'night', 2, focus]);
  assert.deepEqual(calls[3], ['paddy', 0.03, player, cameraPosition]);
  assert.deepEqual(calls[5], ['corral', 0.03, player, 2, 'night']);
  calls.length = 0;
  tick({ dt: 0, clockDt: 0, player });
  assert.deepEqual(calls[0], ['animals', 0, player, 'day', 0, player]);
  assert(calls.every((c) => c[1] === 0));
});
