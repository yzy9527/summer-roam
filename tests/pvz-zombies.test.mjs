import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createZombieController, addFieldZombies } from '../src/field-zombies.js';
import { ZOMBIE_LAYOUT, zombiePatrolPoint } from '../src/zombie-layout.js';
import { STARTING_PLATFORM } from '../src/road-network.js';
import {
  drivingHeight,
  inStream,
  isRoadSurface,
  islandDistance,
  roadPoint,
} from '../src/world-queries.js';
import { insidePaddy } from '../src/paddy-profile.js';
import { vehicleHitsObstacle } from '../src/vehicle-collision.js';
import { assetUrl } from '../src/asset-url.js';

const originals = ['PvZ_Zombie2.glb', 'PvZ_Zombie.glb', 'PvZ_Zombie_bg.glb'];
function readGLB(path) {
  const bytes = readFileSync(new URL(path, import.meta.url));
  const size = bytes.readUInt32LE(12);
  return {
    bytes,
    json: JSON.parse(bytes.subarray(20, 20 + size)),
    binary: bytes.subarray(20 + size),
  };
}
async function loadSources() {
  const sources = new Map();
  for (const { id } of ZOMBIE_LAYOUT) {
    const { bytes } = readGLB(`../src/assets/models/pvz-zombies/${id}.glb`);
    const loader = new GLTFLoader();
    // Actual geometry/skins, with only image decoding stubbed in Node.
    loader.register((parser) => {
      parser.loadTexture = async () => new THREE.Texture();
      return { name: 'NodeTextures' };
    });
    sources.set(
      id,
      (
        await loader.parseAsync(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
          '',
        )
      ).scene,
    );
  }
  return sources;
}
const vector = (p) => new THREE.Vector3(...p);

test('PvZ material conversion preserves original geometry, rigs and embedded image bytes', () => {
  for (const [i, { id }] of ZOMBIE_LAYOUT.slice(0, originals.length).entries()) {
    const source = readGLB(`../assets-source/PvZ_Zombie/${originals[i]}`);
    const runtime = readGLB(`../src/assets/models/pvz-zombies/${id}.glb`);
    assert.deepEqual(runtime.binary, source.binary);
    // JSON serialization normalizes -0 to 0; both represent the same transform.
    for (const key of ['nodes', 'meshes', 'skins', 'images', 'accessors', 'bufferViews'])
      assert.equal(JSON.stringify(runtime.json[key]), JSON.stringify(source.json[key]));
    assert.equal(source.json.animations?.length ?? 0, 0);
    assert(!runtime.json.extensionsRequired?.includes('KHR_materials_pbrSpecularGlossiness'));
    assert(runtime.json.materials.some((m) => m.pbrMetallicRoughness.baseColorTexture));
  }
});

test('all actual PvZ skins walk with alternating planted shoes, synchronized heads and continuous turns', async () => {
  const sources = await loadSources(),
    colliders = [];
  const controller = createZombieController(sources, colliders);
  const start = controller.snapshot();
  const stats = Object.fromEntries(
    ZOMBIE_LAYOUT.map(({ id }) => [
      id,
      {
        leftSteps: 0,
        rightSteps: 0,
        maxPlantError: 0,
        maxSoleGap: 0,
        minSoleGap: Infinity,
        maxJointAngle: 0,
        maxLift: { Left: 0, Right: 0 },
      },
    ]),
  );
  let previous = start;
  const boneRest = new Map();
  controller.root.traverse((bone) => {
    if (bone.isBone) boneRest.set(bone, bone.position.clone());
  });
  for (let frame = 0; frame < 60 * 65; frame++) {
    controller.update(1 / 60, { ...STARTING_PLATFORM });
    const current = controller.snapshot();
    for (const [index, actor] of current.zombies.entries()) {
      const old = previous.zombies[index],
        stat = stats[actor.id];
      const object = controller.root.children[index];
      const [x, , z] = actor.position;
      assert.equal(actor.blocked, false);
      assert(x > STARTING_PLATFORM.x + STARTING_PLATFORM.radius + 10);
      assert(
        islandDistance(x, z) < -2 &&
          !inStream(x, z) &&
          !isRoadSurface(x, z) &&
          !insidePaddy(x, z, roadPoint, 0.3),
      );
      assert(
        actor.legs.some((leg) => !leg.swinging),
        'a shuffling zombie always has a supporting foot',
      );
      for (const [i, leg] of actor.legs.entries()) {
        const prior = old.legs[i];
        assert(leg.foot.every(Number.isFinite));
        if (leg.swinging && !prior.swinging)
          stat[leg.side === 'Left' ? 'leftSteps' : 'rightSteps']++;
        if (!leg.swinging) {
          stat.maxPlantError = Math.max(
            stat.maxPlantError,
            vector(leg.foot).distanceTo(vector(leg.planted)),
          );
          if (!prior.swinging) {
            assert.deepEqual(leg.planted, prior.planted, 'stance target remains in world space');
            assert.equal(leg.heading, prior.heading, 'planted shoe does not rotate with the body');
          }
        } else {
          const offset = start.zombies[index].legs[i].foot[1] - start.zombies[index].position[1];
          stat.maxLift[leg.side] = Math.max(
            stat.maxLift[leg.side],
            leg.foot[1] - drivingHeight(leg.foot[0], leg.foot[2]) - offset,
          );
        }
      }
      for (const [name, rotation] of Object.entries(actor.joints)) {
        const q = new THREE.Quaternion(...rotation).normalize();
        const prior = new THREE.Quaternion(...old.joints[name]).normalize();
        stat.maxJointAngle = Math.max(stat.maxJointAngle, q.angleTo(prior));
      }
      if (frame % 120 === 0) {
        const heads = [];
        object.traverse((bone) => {
          if (!bone.isBone) return;
          if (/^Head_0\d+$/.test(bone.name)) heads.push(bone.getWorldPosition(new THREE.Vector3()));
          if (/^(Left|Right)(Leg|Foot)_0\d+$/.test(bone.name))
            assert(bone.position.distanceTo(boneRest.get(bone)) < 1e-8, 'IK never lengthens a leg');
        });
        assert.equal(heads.length, actor.copies);
        for (const head of heads)
          assert(
            head.distanceTo(heads[0]) < 1e-4,
            'every head/cone skin follows the same skeleton',
          );
        const gap = new THREE.Box3().setFromObject(object, true).min.y - drivingHeight(x, z);
        stat.maxSoleGap = Math.max(stat.maxSoleGap, gap);
        stat.minSoleGap = Math.min(stat.minSoleGap, gap);
      }
      assert.equal(colliders[index].x, x);
      assert.equal(colliders[index].z, z);
      for (const other of current.zombies.filter((zombie) => zombie !== actor))
        assert(
          Math.hypot(x - other.position[0], z - other.position[2]) >
            actor.radius + other.radius + 0.25,
        );
    }
    previous = current;
  }
  for (const stat of Object.values(stats)) {
    assert(stat.leftSteps > 15 && stat.rightSteps > 15);
    assert(stat.maxPlantError < 0.02, `plant error ${stat.maxPlantError}`);
    assert(
      stat.minSoleGap > -0.006 && stat.maxSoleGap < 0.02,
      `sole gap ${stat.minSoleGap}..${stat.maxSoleGap}`,
    );
    assert(stat.maxJointAngle < 0.12, `joint jump ${stat.maxJointAngle}`);
  }
  assert(
    stats['pvz-browncoat'].maxLift.Left > stats['pvz-browncoat'].maxLift.Right * 1.5,
    'one shoe drags lower than the other',
  );
  assert.notDeepEqual(previous.zombies[0].joints, start.zombies[0].joints);
  const frozen = controller.snapshot();
  for (let i = 0; i < 120; i++) controller.update(0, { x: 0, z: 0 });
  assert.deepEqual(controller.snapshot(), frozen);
  mkdirSync(new URL('../output/pvz-zombies/', import.meta.url), { recursive: true });
  writeFileSync(
    new URL('../output/pvz-zombies/geometry-validation.json', import.meta.url),
    JSON.stringify({ simulatedSeconds: 65, frameRate: 60, stats, pauseFrozen: true }, null, 2),
  );
});

test('patrol stops before the car or an obstacle and resumes with matching moving colliders', async () => {
  const sources = await loadSources(),
    colliders = [];
  const controller = createZombieController(sources, colliders);
  controller.update(1 / 60, { x: 132, z: 10 });
  const first = controller.snapshot().zombies[0];
  const car = { x: first.position[0], z: first.position[2], heading: first.heading };
  assert(vehicleHitsObstacle(car.x, car.z, car.heading, colliders[0]));
  for (let i = 0; i < 60; i++) controller.update(1 / 60, car);
  const stopped = controller.snapshot().zombies[0];
  assert(stopped.blocked);
  assert.deepEqual(stopped.position, first.position);
  assert.deepEqual(stopped.joints, first.joints);
  assert.deepEqual(stopped.legs, first.legs);
  controller.update(1 / 60, { x: 132, z: 10 });
  const resumed = controller.snapshot().zombies[0];
  assert(!resumed.blocked);
  assert.notDeepEqual(resumed.position, first.position);
  const point = zombiePatrolPoint(ZOMBIE_LAYOUT[0], ZOMBIE_LAYOUT[0].phase + 0.05);
  colliders.push({ ...point, radius: 1 });
  controller.update(1 / 60, { x: 132, z: 10 });
  assert(controller.snapshot().zombies[0].blocked);
});

test('loader uses registered paths and reports a missing GLB without substituting a static model', async () => {
  const sources = await loadSources(),
    originalLoad = GLTFLoader.prototype.loadAsync;
  const scene = new THREE.Scene(),
    colliders = [],
    warnings = [];
  GLTFLoader.prototype.loadAsync = async (url) => {
    const layout = ZOMBIE_LAYOUT.find(({ id }) => assetUrl(id) === url);
    assert(layout);
    if (layout.id === 'pvz-conehead') throw new Error('fixture: missing conehead');
    return { scene: sources.get(layout.id) };
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const controller = await addFieldZombies(scene, colliders, warnings);
    assert.equal(controller.snapshot().zombies.length, ZOMBIE_LAYOUT.length - 1);
    assert.deepEqual(warnings, ['pvz-conehead']);
    assert.equal(scene.children[0], controller.root);
    assert.equal(colliders.length, ZOMBIE_LAYOUT.length - 1);
  } finally {
    GLTFLoader.prototype.loadAsync = originalLoad;
    console.warn = originalWarn;
  }
});
