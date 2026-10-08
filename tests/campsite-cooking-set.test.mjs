import { loadGLTF, modelURL } from './helpers/model-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  CAMPSITE,
  createCampsiteCookingSet,
  addCampsiteCookingSet,
} from '../src/campsite-cooking-set.js';
import { createCorralModel, CORRAL } from '../src/corral-model.js';
import { drivingHeight, inStream, isRoadSurface, islandDistance } from '../src/world-queries.js';
import { insidePaddy } from '../src/paddy-profile.js';
import { roadPoint } from '../src/world-base.js';
import { ZOMBIE_LAYOUT, zombiePatrolPoint } from '../src/zombie-layout.js';
import { CREW_CART, CREW_PARKING, CREW_DOCK } from '../src/zombie-crew-cart.js';
import { planCartPosePath } from '../src/crew-cart-navigation.js';
import { vehicleObstacleGap } from '../src/vehicle-collision.js';
import { dryAnimalPoint } from '../src/corral-navigation.js';

const load = () => loadGLTF(modelURL('models/campsite-cooking-set.glb'));

test('original GLB is preserved; real fire morphs, soup bubbles and steam animate, loop and freeze on pause', async () => {
  assert.deepEqual(
    readFileSync(new URL('../src/assets/models/campsite-cooking-set.glb', import.meta.url)),
    readFileSync(
      new URL(
        '../assets-source/campsite-cooking-set/Campsite_Cooking_Set_Animated.glb',
        import.meta.url,
      ),
    ),
  );
  const gltf = await load();
  const c = createCampsiteCookingSet(gltf, []);
  const flame = [],
    soup = [];
  gltf.scene.traverse((n) => {
    if (n.morphTargetInfluences && n.name.startsWith('Outer_curled_flame')) flame.push(n);
    if (n.morphTargetInfluences && n.name.startsWith('Visible_bubbling_soup')) soup.push(n);
  });
  assert(flame.length && soup.length);
  const bubble = gltf.scene.getObjectByName('05_Rising_soup_bubble_1');
  const steam = gltf.scene.getObjectByName('09_Steam_curl_1');
  const pose = () => [
    ...flame.flatMap((n) => n.morphTargetInfluences),
    ...soup.flatMap((n) => n.morphTargetInfluences),
    ...bubble.position.toArray(),
    ...bubble.scale.toArray(),
    ...steam.position.toArray(),
    ...steam.quaternion.toArray(),
    ...steam.scale.toArray(),
  ];
  const before = pose();
  const flameBefore = [...flame[0].morphTargetInfluences];
  const soupBefore = [...soup[0].morphTargetInfluences];
  c.update(0.75);
  assert.notDeepEqual(pose(), before);
  assert.notDeepEqual(flame[0].morphTargetInfluences, flameBefore);
  assert.notDeepEqual(soup[0].morphTargetInfluences, soupBefore);
  const snap = c.snapshot(),
    paused = pose();
  c.update(0);
  assert.deepEqual(c.snapshot(), snap);
  assert.deepEqual(pose(), paused);
  c.update(6);
  assert(Math.abs(c.snapshot().animationTime - 0.75) < 1e-7);
  pose().forEach((value, i) => assert(Math.abs(value - paused[i]) < 1e-6));
  const box = new THREE.Box3().setFromObject(c.root, true);
  assert(Math.abs(box.min.y - drivingHeight(CAMPSITE.x, CAMPSITE.z)) < 1e-6);
  assert(Math.abs(box.getSize(new THREE.Vector3()).y - CAMPSITE.height) < 1e-6);
});

test('cooking site stays on dry ground clear of fencing, gate, patrols and cart; shared collision blocks vehicles and navigation', async () => {
  const colliders = [];
  const c = createCampsiteCookingSet(await load(), colliders);
  const fire = colliders[0];
  createCorralModel(new THREE.Scene(), colliders);
  for (const fence of colliders.slice(1))
    assert(Math.hypot(fence.x - fire.x, fence.z - fire.z) > fence.radius + fire.radius + 0.5);
  for (let a = 0; a < Math.PI * 2; a += 0.03) {
    const x = fire.x + Math.cos(a) * fire.radius,
      z = fire.z + Math.sin(a) * fire.radius;
    assert(!inStream(x, z) && !isRoadSurface(x, z));
    assert(!insidePaddy(x, z, roadPoint, 0.3));
    assert(islandDistance(x, z) < -2);
    for (const zombie of ZOMBIE_LAYOUT) {
      const p = zombiePatrolPoint(zombie, a);
      assert(Math.hypot(p.x - fire.x, p.z - fire.z) > zombie.radius + fire.radius + 0.4);
    }
  }
  // Sample the actual delivery/reverse approach with the current cart's full hull.
  const clear = (pose) => {
    const dx = fire.x - pose.x,
      dz = fire.z - pose.z;
    const x = dx * Math.cos(pose.heading) - dz * Math.sin(pose.heading);
    const z = dx * Math.sin(pose.heading) + dz * Math.cos(pose.heading);
    return (
      Math.hypot(
        Math.max(0, Math.abs(x) - CREW_CART.halfWidth),
        Math.max(0, Math.abs(z) - CREW_CART.halfLength),
      ) >
      fire.radius + 0.4
    );
  };
  const stops = [
    CREW_PARKING,
    { x: 160, z: 2, heading: -Math.PI / 2 },
    { x: 146, z: -27, heading: -Math.PI / 2 },
    { x: -26, z: -27, heading: -Math.PI / 2 },
  ];
  const returning = [
    { x: 148, z: -27, heading: Math.PI / 2 },
    { x: 158, z: 3, heading: 0 },
    { x: 169, z: 3, heading: Math.PI },
    { x: CREW_DOCK.x, z: -8, heading: Math.PI },
    { ...CREW_DOCK, reverse: true },
  ];
  for (const route of [stops, returning])
    for (let i = 1; i < route.length; i++) {
      assert(
        planCartPosePath(route[i - 1], route[i], clear, { reverse: !!route[i].reverse }),
        'current crew-cart itinerary must clear the fire',
      );
    }
  assert(vehicleObstacleGap(fire.x, fire.z, 0, fire) < 0);
  assert(!dryAnimalPoint(fire.x, fire.z, 0.7, colliders));
  assert(dryAnimalPoint(CORRAL.x, CORRAL.z - CORRAL.halfZ - 2.2, 0.7, colliders));
  assert.equal(c.snapshot().animation, 'Campfire_Simmer_Loop');
});

test('failed loading omits both the cooking set and its invisible obstacle', async () => {
  const saved = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async () => {
    throw new Error('test unavailable');
  };
  const scene = new THREE.Scene(),
    colliders = [],
    warnings = [];
  try {
    assert.equal(await addCampsiteCookingSet(scene, colliders, warnings), null);
    assert.deepEqual(warnings, ['campsite-cooking-set']);
    assert.equal(scene.children.length, 0);
    assert.equal(colliders.length, 0);
  } finally {
    GLTFLoader.prototype.loadAsync = saved;
  }
});
