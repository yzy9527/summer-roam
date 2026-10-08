import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { pickActionTarget, createSceneActions } from '../src/scene-actions.js';
import { rescueFixture } from './helpers/rescue-fixture.mjs';

test('ray selection uses the nearest visible geometry, never touches/reserves animals and rejects scenery occlusion', async () => {
  const f = await rescueFixture(() => 0.9, { withHeist: true }),
    calf = f.animal('hornless-calf');
  f.place(calf, -25, 10, 0);
  const field = {
    animals: { animal: f.animal },
    corral: f.corral,
    zombies: f.zombies,
    woodenCart: f.cart,
  };
  const ray = new THREE.Raycaster(new THREE.Vector3(-25, 12, 10), new THREE.Vector3(0, -1, 0));
  const before = JSON.stringify(f.heist.snapshot()),
    taps = calf.taps;
  const hit = pickActionTarget(f.scene, ray, field, null);
  assert.equal(hit.animal, calf);
  assert.equal(calf.taps, taps);
  assert.equal(calf.transportOwner, undefined);
  assert.equal(JSON.stringify(f.heist.snapshot()), before);
  const blocker = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 4), new THREE.MeshBasicMaterial());
  blocker.position.set(-25, 5, 10);
  f.scene.add(blocker);
  assert.equal(pickActionTarget(f.scene, ray, field, null).type, 'world');
  blocker.visible = false;
  assert.equal(pickActionTarget(f.scene, ray, field, null).animal, calf);
  calf.group.visible = false;
  assert.equal(pickActionTarget(f.scene, ray, field, null).type, 'world');
});

test('menu command rechecks actual controller ownership after opening and cannot start a stale enabled action', async () => {
  const f = await rescueFixture(() => 0.9, { withHeist: true });
  const field = {
    animals: { animal: f.animal },
    corral: f.corral,
    zombies: f.zombies,
    woodenCart: f.cart,
    calfHeist: f.heist,
    calfRescue: f.rescue,
  };
  const registry = createSceneActions({
    getField: () => field,
    getCar: () => f.car,
    getTimeOfDay: () => 'day',
  });
  const target = { type: 'actor', id: 'pvz-gargantuar', name: '大僵尸' };
  assert.equal(registry.actions(target).find((a) => a.id === 'hold-calf').reason, '');
  assert(f.interactions.reserveFamily());
  const rejected = registry.execute(target, 'hold-calf');
  assert.equal(rejected.ok, false);
  assert.match(rejected.message, /互动/);
  assert.equal(f.heist.snapshot().phase, 'waiting');
  f.interactions.familyEvent('cancel');
  assert.equal(registry.execute(target, 'hold-calf').ok, true);
  assert.equal(f.heist.snapshot().manualTask, 'hold');
  assert.equal(registry.execute({ type: 'cart', name: '木车' }, 'capture-calf').ok, false);
  assert.match(registry.status(target), /走向小牛/);
});

test('each target exposes only its own actions; animal calls cannot touch or command vehicles', () => {
  let taps = 0,
    calls = 0;
  const animals = Object.fromEntries(
    ['golden-cow', 'copper-cow', 'hornless-calf', 'reference-wolf', 'baola-leopard'].map((id) => [
      id,
      { id, x: 1, z: 2 },
    ]),
  );
  const field = {
    animals: {
      animal: (id) => animals[id],
      actionAvailability: () => '',
      sleep: { ready: () => true },
      mountain: { snapshot: () => ({ phase: 'idle' }) },
      tree: { snapshot: () => ({ phase: 'idle' }) },
    },
    corral: { animals: [], snapshot: () => ({ controlled: false }) },
    calfHeist: {
      manualAvailability: () => '',
      snapshot: () => ({ phase: 'waiting', carryMode: 'underarm' }),
    },
    calfRescue: { manualAvailability: () => '', snapshot: () => ({ phase: 'idle' }) },
  };
  const registry = createSceneActions({
    getField: () => field,
    getCar: () => ({}),
    getTimeOfDay: () => 'day',
    animalTap: () => taps++,
    animalCall: (hit) => {
      calls++;
      assert.equal(hit.id, 'hornless-calf');
      return true;
    },
  });
  const ids = (target) => registry.actions(target).map((a) => a.id);
  for (const animal of Object.values(animals)) {
    const target = { type: 'animal', animal };
    assert(ids(target).includes('call'));
    assert(ids(target).includes('tap'));
    assert(ids(target).every((id) => !/calf|car|light|camera|gate|rescue|heist/.test(id)));
    assert.equal(registry.execute(target, 'reset-car').ok, false);
    assert.equal(registry.execute(target, 'capture-calf').ok, false);
  }
  assert.equal(
    registry.execute({ type: 'animal', animal: animals['hornless-calf'] }, 'call').ok,
    true,
  );
  assert.equal(calls, 1);
  assert.equal(taps, 0);
  assert.deepEqual(ids({ type: 'world' }), []);
  assert.deepEqual(ids({ type: 'actor', id: 'pvz-conehead' }), []);
  assert.deepEqual(ids({ type: 'cart' }), ['capture-calf']);
  assert.deepEqual(ids({ type: 'actor', id: 'pvz-gargantuar' }), [
    'hold-calf',
    'put-down',
    'recapture-calf',
    'carry-mode',
  ]);
  assert.deepEqual(ids({ type: 'gate' }), ['open-gate', 'close-gate']);
  assert.deepEqual(ids({ type: 'actor', id: 'pvz-gatekeeper' }), ['guard-close']);
  assert.deepEqual(ids({ type: 'vehicle' }), [
    'camera',
    'light-off',
    'light-low',
    'light-high',
    'reset-car',
  ]);
});
