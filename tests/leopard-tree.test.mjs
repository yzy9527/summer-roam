import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from '../src/asset-url.js';
import { addFieldAnimals } from '../src/field-animals.js';
import { addFieldMountain } from '../src/field-mountain.js';
import { createLeopardTreeSite, TREE_VISIT } from '../src/leopard-tree-site.js';
import { createLeopardTree } from '../src/leopard-tree.js';
import { loadAnimalGeometry, loadGLBGeometry } from './helpers/animal-geometry.mjs';

const geometry = (path) => loadGLBGeometry(new URL('../' + path, import.meta.url));
const treeFile = 'src/assets/trees/jabami-anime-tree-v2/jabami-anime-tree-v2.glb';
async function fixture() {
  const scene = new THREE.Scene(),
    colliders = [],
    warnings = [];
  const tree = createLeopardTreeSite(await geometry(treeFile), scene, colliders);
  const previous = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async function (url) {
    if (url === assetUrl('hokage-mountain'))
      return { scene: await geometry('src/assets/models/hokage-mountain.glb') };
    const id = [
      'golden-cow',
      'copper-cow',
      'hornless-calf',
      'reference-wolf',
      'baola-leopard',
    ].find((id) => url === assetUrl(id));
    assert(id, url);
    return { scene: await loadAnimalGeometry(id) };
  };
  let animals;
  try {
    await addFieldMountain(scene, colliders, warnings);
    animals = await addFieldAnimals(scene, colliders, warnings, true, tree);
  } finally {
    GLTFLoader.prototype.loadAsync = previous;
  }
  assert.deepEqual(warnings, []);
  const car = { x: 0, z: 0, heading: 0, speed: 0 };
  const tick = (seconds, mode = 'day', dt = 1 / 60) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) animals.update(dt, car, mode);
  };
  return {
    scene,
    colliders,
    tree,
    animals,
    car,
    tick,
    leopard: () => animals.snapshot().find((a) => a.id === 'baola-leopard'),
  };
}

test('supplied tree is preserved; every contact is on the original trunk and branches, clear of mountain trail', async () => {
  assert.deepEqual(
    readFileSync(new URL('../' + treeFile, import.meta.url)),
    readFileSync(
      new URL(
        '../assets-source/trees/jabami-anime-tree-v2/jabami-anime-tree-v2.glb',
        import.meta.url,
      ),
    ),
  );
  const f = await fixture();
  const ray = new THREE.Raycaster();
  for (let s = 0.35; s < f.tree.length - 0.3; s += 0.1)
    for (const lateral of [-0.21, 0, 0.21]) {
      const p = f.tree.sample(s, lateral);
      // Shared triangle edges can miss a mathematically exact ray because the
      // GLB mesh uses float32 coordinates. Micrometre probes stay on this same
      // contact and independently verify the visible wood on either edge side.
      const offsets = [
        [0, 0, 0],
        [1e-5, 0, 0],
        [-1e-5, 0, 0],
        [0, 1e-5, 0],
        [0, -1e-5, 0],
        [0, 0, 1e-5],
        [0, 0, -1e-5],
      ];
      const onBark = offsets.some((offset) => {
        ray.set(
          p.point
            .clone()
            .addScaledVector(p.normal, 0.03)
            .add(new THREE.Vector3(...offset)),
          p.normal.clone().negate(),
        );
        return ray.intersectObjects(f.tree.wood)[0]?.distance < 0.045;
      });
      assert(
        onBark,
        JSON.stringify({
          s,
          lateral,
          p: p.point.toArray(),
          normal: p.normal.toArray(),
          hit: ray.intersectObjects(f.tree.wood)[0]?.distance,
        }),
      );
    }
  assert.equal(f.tree.snapshot().height, 9.5);
  assert.equal(f.tree.group.children.length, 1, 'no generated limb or ramp');
  assert(f.tree.frame(1.5).forward.y > 0.99, 'vertical trunk climb');
  assert(f.animals.tree.start(f.car), 'real meadow-to-tree path must exist');
});

test('probability is 30%, uses play time and identical scheduling by day/night; pause freezes the state', async () => {
  const f = await fixture();
  const actor = {
    id: 'baola-leopard',
    rig: {},
    behavior: {},
    x: -20,
    z: 17,
    homeX: -20,
    homeZ: 17,
    heading: 0,
    distance: 0,
  };
  for (const draw of [0.29999, 0.3]) {
    let calls = 0;
    const c = createLeopardTree(
      [actor],
      f.tree,
      () => true,
      () => (++calls === 3 ? draw : 0),
    );
    c.update(0, f.car);
    const before = c.snapshot();
    c.update(0, f.car);
    assert.deepEqual(c.snapshot(), before);
    c.update(TREE_VISIT.intervalMin, f.car);
    assert.equal(c.snapshot().phase, draw < 0.3 ? 'approaching' : 'idle');
    actor.behavior = {};
  }
});

for (const fps of [30, 60, 120])
  test(`${fps}fps: real leopard completes climbing, lookout, sleeping, stepped turn, headfirst descent and a cushioned hop; feet/bones/pause remain valid`, async () => {
    const f = await fixture();
    assert(f.animals.tree.start(f.car));
    const root = f.animals.modelSource('baola-leopard'),
      bones = [];
    root.traverse((o) => {
      if (o.isBone && o.name !== 'Body') bones.push(o);
    });
    const offsets = bones.map((o) => o.position.clone());
    const spine = ['Pelvis', 'Spine_Lower', 'Spine_Upper', 'Chest'].map((name) =>
      root.getObjectByName(name),
    );
    assert(spine.every((bone) => bone?.isBone));
    const spineRest = spine.map((bone) => bone.quaternion.clone().normalize());
    const neck = root.getObjectByName('Neck'),
      head = root.getObjectByName('Head');
    const neckRest = neck.quaternion.clone().normalize(),
      headRest = head.quaternion.clone().normalize();
    let flex = 0,
      ascentTime = 0,
      airborneFrames = 0;
    const phases = new Set();
    let previous,
      maxRotation = 0,
      maxFootError = 0,
      maxTransitionFootError = 0,
      climbingFrames = 0,
      maxHeight = 0;
    for (let i = 0; i < 600 * fps; i++) {
      f.animals.update(1 / fps, f.car, i < 84 * fps ? 'day' : 'night');
      const state = f.animals.tree.snapshot(),
        a = f.leopard();
      phases.add(state.phase);
      if (state.phase === 'mounting')
        spine.forEach((bone, j) => {
          flex = Math.max(flex, spineRest[j].angleTo(bone.quaternion));
        });
      if (state.phase === 'ascending') {
        ascentTime = state.phaseTime;
        assert(ascentTime < 50, JSON.stringify(state));
      }
      if (state.phase === 'descending' && state.phaseTime > 0.1)
        assert(
          new THREE.Vector3(0, 0, 1)
            .applyQuaternion(root.parent.parent.quaternion)
            .dot(f.tree.frame(state.s).forward) < -0.8,
          'head faces down the route',
        );
      if (state.phase === 'jumping' && state.phaseTime > 0.05) {
        airborneFrames++;
        assert(
          a.animation.legs.every((l) => !l.stance),
          'paws release during flight',
        );
      }
      if (state.phase === 'resting' && state.phaseTime > 3) assert(f.animals.tree.requestDescent());
      if (state.phase === 'resting' && state.phaseTime > 0.4) {
        // Tree rest keeps the neck/head near the torso instead of arching back.
        assert(neckRest.angleTo(neck.quaternion) < 0.18, 'relaxed neck on branch');
        assert(headRest.angleTo(head.quaternion) < 0.15, 'head rests forward without a large arch');
      }
      maxHeight = Math.max(maxHeight, a.y - f.tree.group.position.y);
      if (a.animation.tree?.active) {
        climbingFrames++;
        for (const l of a.animation.legs) {
          const error = new THREE.Vector3(...l.foot).distanceTo(
            new THREE.Vector3(...l.solvedTarget),
          );
          const transition = ['mounting', 'turning', 'jump-ready', 'jumping', 'landing'].includes(
            state.phase,
          );
          if (transition) maxTransitionFootError = Math.max(maxTransitionFootError, error);
          else maxFootError = Math.max(maxFootError, error);
        }
        const q = bones.map((o) => o.getWorldQuaternion(new THREE.Quaternion()));
        if (previous)
          for (let k = 0; k < q.length; k++) {
            const change = previous[k].angleTo(q[k]);
            maxRotation = Math.max(maxRotation, change);
          }
        previous = q;
        if (i % (2 * fps) === 0) {
          const before = f.animals.snapshot(),
            visit = f.animals.tree.snapshot();
          f.animals.update(0, f.car, 'day');
          assert.deepEqual(f.animals.snapshot(), before);
          assert.deepEqual(f.animals.tree.snapshot(), visit);
        }
      }
      for (let k = 0; k < bones.length; k++)
        assert(bones[k].position.distanceTo(offsets[k]) < 1e-8, bones[k].name + ' length');
      if (state.visits === 1 && state.phase === 'idle') break;
    }
    for (const phase of [
      'ascending',
      'lookout',
      'branch-walk',
      'lying-down',
      'resting',
      'waking',
      'turning',
      'descending',
      'jump-ready',
      'jumping',
      'landing',
      'returning',
      'idle',
    ])
      assert(phases.has(phase), phase);
    assert(climbingFrames > 8 * fps);
    assert(flex > 0.16, 'spine must actually bend while rearing');
    assert(ascentTime < 35, 'climb must be faster than the old 55-second ascent');
    assert(airborneFrames > 0);
    assert(maxHeight > 2.4);
    assert(maxFootError < 0.06, 'climbing/resting paws reach native contacts: ' + maxFootError);
    assert(
      maxTransitionFootError < 0.15,
      'bounded reaching during rearing/landing: ' + maxTransitionFootError,
    );
    assert(maxRotation < 27 / fps, 'continuous joint rotation: ' + maxRotation);
    assert.equal(f.animals.tree.snapshot().yaw, Math.PI, 'turn finishes before descent');
    assert.equal(f.leopard().animation.tree.active, false);
    assert.equal(f.leopard().animation.gait, 'walk');
  });

test('blocked entry declines a visit; low descent waits for the vehicle without releasing the elevated leopard', async () => {
  const f = await fixture();
  Object.assign(f.car, f.tree.entry);
  assert.equal(f.animals.tree.start(f.car), false);
  f.car.x = 0;
  f.car.z = 0;
  assert(f.animals.tree.start(f.car));
  for (let i = 0; i < 5000 && f.animals.tree.snapshot().phase !== 'resting'; i++)
    f.animals.update(0.05, f.car);
  assert.equal(f.animals.tree.snapshot().phase, 'resting');
  assert(f.animals.tree.requestDescent());
  Object.assign(f.car, f.tree.entry);
  f.tick(150, 'night', 0.05);
  assert.equal(f.animals.tree.snapshot().phase, 'descending');
  const held = f.leopard();
  assert(held.y > f.tree.group.position.y + 0.7);
  f.car.x = 0;
  f.car.z = 0;
  for (let i = 0; i < 10000 && f.animals.tree.snapshot().phase !== 'idle'; i++)
    f.animals.update(0.05, f.car, 'day');
  assert.equal(f.animals.tree.snapshot().phase, 'idle');
});

test('grounded return immediately permits commands and hands off one original leopard without changing home', async () => {
  const f = await fixture(),
    a = f.animals.animal('baola-leopard');
  const home = { x: a.homeX, z: a.homeZ };
  assert(f.animals.tree.start(f.car));
  for (let i = 0; i < 10000 && f.animals.tree.snapshot().phase !== 'returning'; i++) {
    f.animals.update(0.05, f.car, 'day');
    if (f.animals.tree.snapshot().phase === 'resting') f.animals.tree.requestDescent();
  }
  assert.equal(f.animals.tree.snapshot().phase, 'returning');
  assert.equal(a.treeClimb, null);
  for (const command of ['graze', 'turn', 'call', 'rest'])
    assert.equal(f.animals.actionAvailability(a, command), '');
  assert.equal(f.animals.interactions.milkAvailability(a), '');
  const start = { x: a.x, z: a.z };
  assert(f.animals.graze(a.id));
  assert.equal(f.animals.tree.snapshot().phase, 'idle');
  assert.equal(f.animals.tree.owns(a), false);
  f.tick(0.5, 'day', 0.05);
  assert.equal(a.x, start.x);
  assert.equal(a.z, start.z, 'old return no longer moves the leopard');
  assert(f.animals.turn(a.id), 'tree exit supports a safe turn outside the ordinary home circle');
  assert(f.animals.interactions.reserveMilk(a));
  assert.equal(a.transportOwner, 'milk-visit');
  assert.equal(f.animals.tree.owns(a), false);
  assert.deepEqual({ x: a.homeX, z: a.homeZ }, home);
  f.animals.interactions.releaseMilk(a);
});
