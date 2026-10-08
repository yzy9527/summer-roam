import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createZombieController } from '../src/field-zombies.js';

function read(path) {
  const bytes = readFileSync(new URL(path, import.meta.url));
  const end = 20 + bytes.readUInt32LE(12);
  return { bytes, json: JSON.parse(bytes.subarray(20, end)), bin: bytes.subarray(end + 8) };
}
function attribute(asset, index) {
  const a = asset.json.accessors[index],
    v = asset.json.bufferViews[a.bufferView];
  const sizes = { 5123: 2, 5125: 4, 5126: 4 };
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return asset.bin.subarray(start, start + a.count * sizes[a.componentType] * components[a.type]);
}
const runtime = () => read('../src/assets/models/pvz-zombies/pvz-flagbearer.glb');
const semantic = (name) => name.replace(/_0\d+$/, '');
async function fixture() {
  const asset = runtime(),
    loader = new GLTFLoader();
  loader.register((parser) => {
    parser.loadTexture = async () => new THREE.Texture();
    return { name: 'NodeTextures' };
  });
  const source = (
    await loader.parseAsync(
      asset.bytes.buffer.slice(asset.bytes.byteOffset, asset.bytes.byteOffset + asset.bytes.length),
      '',
    )
  ).scene;
  const controller = createZombieController(new Map([['pvz-flagbearer', source]]));
  const actor = controller.actor('pvz-flagbearer'),
    bones = new Map();
  let flag;
  actor.source.traverse((node) => {
    if (node.isBone && !bones.has(semantic(node.name))) bones.set(semantic(node.name), node);
    if (node.isSkinnedMesh && node.material.name === 'CHAR_FLAG_ZOMBIE') flag = node;
  });
  return { controller, actor, bones, flag };
}
const position = (bone) => bone.getWorldPosition(new THREE.Vector3());
function clothCenter(flag) {
  const uv = flag.geometry.attributes.uv,
    center = new THREE.Vector3();
  let count = 0;
  for (let i = 0; i < uv.count; i++) {
    if (uv.getY(i) < 0.22 || uv.getY(i) > 0.78) continue;
    center.add(flag.localToWorld(flag.getVertexPosition(i, new THREE.Vector3())));
    count++;
  }
  assert(count > 30);
  return center.divideScalar(count);
}

test('extracts original flag geometry, weights, inverse binds and texture bytes onto the unchanged browncoat', () => {
  const actual = runtime(),
    source = read('../assets-source/pvz-flagbearer/flag-zombie-original.glb');
  const body = read('../src/assets/models/pvz-zombies/pvz-browncoat.glb');
  for (const key of ['meshes', 'nodes', 'skins'])
    assert.equal(actual.json[key].length, body.json[key].length + 1);
  for (let i = 0; i < body.json.meshes.length; i++)
    assert.deepEqual(actual.json.meshes[i], body.json.meshes[i]);
  const from = source.json.meshes.find((m) => m.name.includes('CHAR_FLAG_ZOMBIE')).primitives[0];
  const to = actual.json.meshes.at(-1).primitives[0];
  for (const key of Object.keys(from.attributes))
    assert.deepEqual(
      attribute(actual, to.attributes[key]),
      attribute(source, from.attributes[key]),
    );
  assert.deepEqual(attribute(actual, to.indices), attribute(source, from.indices));
  const originalSkin = source.json.skins[2],
    skin = actual.json.skins.at(-1);
  assert.deepEqual(
    attribute(actual, skin.inverseBindMatrices),
    attribute(source, originalSkin.inverseBindMatrices),
  );
  assert.deepEqual(
    skin.joints.map((i) => semantic(actual.json.nodes[i].name)),
    originalSkin.joints.map((i) => semantic(source.json.nodes[i].name)),
  );
  for (let i = 0; i < 2; i++) {
    const a = actual.json.bufferViews[actual.json.images.at(-2 + i).bufferView];
    const b = source.json.bufferViews[source.json.images[6 + i].bufferView];
    assert.deepEqual(
      actual.bin.subarray(a.byteOffset, a.byteOffset + a.byteLength),
      source.bin.subarray(b.byteOffset, b.byteOffset + b.byteLength),
    );
  }
});

test('real skinned flag stays upright, fist closed, arm extended, cloth behind at 30/60/120 fps; stopped wind and pause work', async () => {
  for (const fps of [30, 60, 120]) {
    const { controller, actor, bones, flag } = await fixture();
    assert.equal(flag.geometry.attributes.position.count, 315);
    const right = ['RightArm', 'RightForeArm', 'RightHand'].map((name) => bones.get(name));
    const l1 = position(right[0]).distanceTo(position(right[1]));
    const l2 = position(right[1]).distanceTo(position(right[2]));
    for (let frame = 0; frame < fps * 3; frame++) {
      controller.update(1 / fps, { x: 132, z: 10 });
      if (frame % 10) continue;
      const shaft = bones.get('RightHand_Prop_01');
      const direction = new THREE.Vector3(0, 1, 0).applyQuaternion(
        shaft.getWorldQuaternion(new THREE.Quaternion()),
      );
      assert(direction.y > 0.999999, 'shaft remains vertical through body sway and turning');
      const arm = position(right[2]).sub(position(right[0]));
      assert(Math.abs(arm.y) < 1e-6, 'right arm is horizontal');
      assert(arm.length() > (l1 + l2) * 0.99, 'right arm extends without changing bone lengths');
      assert(Math.abs(position(right[0]).distanceTo(position(right[1])) - l1) < 1e-6);
      assert(Math.abs(position(right[1]).distanceTo(position(right[2])) - l2) < 1e-6);
      for (const finger of ['Index', 'Ring']) {
        const tip = bones.get(`RightHand${finger}3`).localToWorld(new THREE.Vector3(0.042, 0, 0));
        assert(tip.distanceTo(position(right[2])) < 0.2, 'fingers curl into a fist');
      }
      const thumbTip = bones.get('RightHandThumb3').localToWorld(new THREE.Vector3(0.052, 0, 0));
      const localThumb = right[2].worldToLocal(thumbTip);
      assert(
        Math.abs(localThumb.y) < 0.065,
        'thumb opposes the fingers instead of sticking above the fist',
      );
      assert(
        localThumb.x > 0.1 && localThumb.x < 0.17,
        'thumb pad closes around the pole in the palm',
      );
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
        actor.object.getWorldQuaternion(new THREE.Quaternion()),
      );
      assert(
        clothCenter(flag).sub(position(shaft)).dot(forward) < -0.12,
        'fabric trails behind the upright pole',
      );
      const bounds = new THREE.Box3().setFromObject(flag, true);
      assert(bounds.min.toArray().every(Number.isFinite));
      assert(bounds.min.y > actor.object.position.y + 0.5, 'flag stays clear of the ground');
      assert(
        bounds.getSize(new THREE.Vector3()).length() < 2,
        'inverse binds keep the flag at its original size',
      );
    }
    const car = {
      x: actor.object.position.x,
      z: actor.object.position.z,
      heading: actor.object.rotation.y,
    };
    const stoppedPosition = actor.object.position.clone();
    const before = clothCenter(flag);
    for (let frame = 0; frame < fps; frame++) controller.update(1 / fps, car);
    assert(actor.blocked);
    assert.deepEqual(actor.object.position, stoppedPosition);
    assert(clothCenter(flag).distanceTo(before) > 0.003, 'fabric flutters while feet are stopped');
    const frozen = [];
    actor.source.traverse((n) => {
      if (n.isBone) frozen.push([n, n.position.clone(), n.quaternion.clone()]);
    });
    const cloth = clothCenter(flag);
    for (let frame = 0; frame < fps; frame++) controller.update(0, car);
    for (const [bone, p, q] of frozen) {
      assert.deepEqual(bone.position, p);
      assert.deepEqual(bone.quaternion.toArray(), q.toArray());
    }
    assert.deepEqual(clothCenter(flag), cloth);
  }
});
