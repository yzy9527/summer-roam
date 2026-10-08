import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createResourceQueue } from '../src/loading/resource-queue.js';
import { createModelLoader } from '../src/loading/model-loader.js';
import { publishActors } from '../src/loading/actor-publication.js';
import { createSceneActions, pickActionTarget } from '../src/scene-actions.js';

const turn = () => new Promise((resolve) => setImmediate(resolve));
const response = (value = 1) => ({
  ok: true,
  arrayBuffer: async () => new Uint8Array([value]).buffer,
});

test('downloads are bounded, shared while queued and complete, released after consumption', async () => {
  const pending = new Map(),
    calls = [];
  const queue = createResourceQueue({
    concurrency: 2,
    fetchResource: (url) => {
      calls.push(url);
      return new Promise((resolve) => pending.set(url, resolve));
    },
  });
  const a = queue.load('a'),
    b = queue.load('b'),
    c = queue.load('c');
  assert.equal(queue.load('c'), c);
  assert.equal(queue.load('a'), a);
  await turn();
  assert.deepEqual(calls, ['a', 'b']);
  assert.deepEqual(queue.snapshot(), { active: 2, queued: 1, retained: 3 });
  pending.get('a')(response(4));
  assert.deepEqual(new Uint8Array(await a), new Uint8Array([4]));
  await turn();
  assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.equal(queue.load('a'), a);
  pending.get('b')(response());
  pending.get('c')(response());
  await Promise.all([b, c]);
  await turn();
  queue.release('a');
  queue.release('b');
  queue.release('c');
  assert.deepEqual(queue.snapshot(), { active: 0, queued: 0, retained: 0 });
  const reload = queue.load('a');
  queue.release('a', a);
  assert.equal(queue.load('a'), reload, 'An earlier parser cannot release a newer download');
  await turn();
  pending.get('a')(response());
  await reload;
  assert.deepEqual(calls, ['a', 'b', 'c', 'a']);
});

test('HTTP, network and body failures remove entries and do not block later downloads or retries', async () => {
  const failures = [
    () => ({ ok: false, status: 503 }),
    () => {
      throw new Error('offline');
    },
    () => ({ ok: true, arrayBuffer: () => Promise.reject(new Error('body')) }),
  ];
  for (const fail of failures) {
    let attempts = 0;
    const queue = createResourceQueue({
      concurrency: 1,
      fetchResource: (url) => (url === 'bad' && attempts++ === 0 ? fail() : response()),
    });
    const failed = queue.load('bad'),
      next = queue.load('next');
    await assert.rejects(failed);
    await next;
    await queue.load('bad');
    assert.equal(attempts, 2);
    await turn();
    assert.equal(queue.snapshot().active, 0);
  }
  assert.throws(() => createResourceQueue({ concurrency: 0 }));
});

test('model callers share one download but parse independent scenes and clean up parser failures', async () => {
  let calls = 0;
  const resources = createResourceQueue({
    fetchResource: async () => {
      calls++;
      return response();
    },
  });
  const options = { resources, baseURL: () => 'https://example.test/nested/index.html' };
  const a = createModelLoader(options),
    b = createModelLoader(options);
  for (const loader of [a, b])
    loader.parseAsync = async (bytes, path) => {
      assert.equal(path, 'https://example.test/nested/models/');
      assert.equal(bytes.byteLength, 1);
      return { scene: new THREE.Group() };
    };
  const [first, second] = await Promise.all([
    a.loadAsync('models/shared.glb'),
    b.loadAsync('models/shared.glb'),
  ]);
  assert.equal(calls, 1);
  assert.notEqual(first.scene, second.scene);
  first.scene.position.x = 9;
  assert.equal(second.scene.position.x, 0);
  assert.equal(resources.snapshot().retained, 0);
  a.parseAsync = async () => {
    throw new Error('invalid glb');
  };
  await assert.rejects(a.loadAsync('models/shared.glb'), /invalid glb/);
  assert.equal(resources.snapshot().retained, 0);
  b.parseAsync = async () => ({ scene: new THREE.Group() });
  await b.loadAsync('models/shared.glb');
  assert.equal(calls, 3);
});

test('late actors wait for the live resettable car, then publish visuals and all colliders together', async () => {
  const scene = new THREE.Scene(),
    colliders = [],
    objects = [new THREE.Group(), new THREE.Group()];
  const footprints = [
    { x: 0, z: 0, radius: 1 },
    { x: 20, z: 0, radius: 1 },
  ];
  let car = { x: 0, z: 0, heading: 0 },
    waits = 0;
  await publishActors({
    scene,
    colliders,
    objects,
    footprints,
    getPlayer: () => car,
    wait: async () => {
      assert.equal(scene.children.length, 0);
      assert.equal(colliders.length, 0);
      car = ++waits === 1 ? { x: 20, z: 0, heading: 0 } : { x: 50, z: 0, heading: 0 };
    },
  });
  assert.equal(waits, 2);
  assert.deepEqual(scene.children, objects);
  assert.deepEqual(colliders, footprints);
});

test('selection and unfinished calf actions are safe before background actors arrive', () => {
  const field = { animals: null, calfHeist: null };
  const actions = createSceneActions({ getField: () => field });
  const commands = actions.actions({ type: 'actor', id: 'pvz-gargantuar' });
  assert.ok(commands.length);
  assert.ok(
    commands.filter((c) => ['hold-calf', 'recapture-calf'].includes(c.id)).every((c) => c.reason),
  );
  const scene = new THREE.Scene(),
    mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  scene.add(mesh);
  const ray = { intersectObjects: () => [{ object: mesh, point: new THREE.Vector3() }] };
  assert.equal(pickActionTarget(scene, ray, field).type, 'world');
});
