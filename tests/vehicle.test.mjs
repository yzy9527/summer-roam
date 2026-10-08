import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Matrix4, Vector3, Quaternion } from 'three';
import { VEHICLE_CONFIG } from '../src/vehicle-config.js';
import { spawnState, stepDrive } from '../src/drive.js';
const data = readFileSync(new URL('../src/assets/models/surf-car-09.glb', import.meta.url));
const jsonLength = data.readUInt32LE(12),
  g = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
const binary = data.subarray(28 + jsonLength);
function matrix(node) {
  return node.matrix
    ? new Matrix4().fromArray(node.matrix)
    : new Matrix4().compose(
        new Vector3().fromArray(node.translation || [0, 0, 0]),
        new Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
        new Vector3().fromArray(node.scale || [1, 1, 1]),
      );
}
function positions(node, parentMatrix = new Matrix4()) {
  const transform = parentMatrix.clone().multiply(matrix(node)),
    points = [];
  for (const primitive of g.meshes[node.mesh]?.primitives || []) {
    const acc = g.accessors[primitive.attributes.POSITION],
      view = g.bufferViews[acc.bufferView];
    assert.equal(acc.componentType, 5126);
    for (let i = 0; i < acc.count; i++) {
      const offset = (view.byteOffset || 0) + (acc.byteOffset || 0) + i * (view.byteStride || 12);
      points.push(
        new Vector3(
          binary.readFloatLE(offset),
          binary.readFloatLE(offset + 4),
          binary.readFloatLE(offset + 8),
        ).applyMatrix4(transform),
      );
    }
  }
  for (const child of node.children || []) points.push(...positions(g.nodes[child], transform));
  return points;
}
test('09 GLB wheel roots are independent, unrotated and centred on exported tyres', () => {
  const rootNodes = g.scenes[g.scene || 0].nodes;
  for (const name of ['wheel_FL', 'wheel_FR', 'wheel_BL', 'wheel_BR']) {
    const index = g.nodes.findIndex((n) => n.name === name),
      node = g.nodes[index];
    assert(index >= 0);
    assert(rootNodes.includes(index));
    assert.deepEqual(node.rotation || [0, 0, 0, 1], [0, 0, 0, 1]);
    assert.deepEqual(node.scale || [1, 1, 1], [1, 1, 1]);
    assert.equal(node.extras.radius, VEHICLE_CONFIG.sourceWheelRadius);
    assert(
      Math.abs(node.translation[1] * VEHICLE_CONFIG.modelScale - VEHICLE_CONFIG.wheelRadius) < 1e-6,
    );
    const points = positions({ ...node, translation: [0, 0, 0] }).map((p) =>
      p.multiplyScalar(VEHICLE_CONFIG.modelScale),
    );
    const min = Math.min(...points.map((p) => p.y)),
      max = Math.max(...points.map((p) => p.y));
    assert(Math.abs(min + VEHICLE_CONFIG.wheelRadius) < 1e-5);
    assert(Math.abs(max - VEHICLE_CONFIG.wheelRadius) < 1e-5);
    assert(points.every((p) => Math.hypot(p.y, p.z) <= VEHICLE_CONFIG.wheelRadius + 1e-5));
    assert(points.every((p) => Math.abs(p.x) < 0.14));
    assert.equal(node.translation[2] > 0, name.includes('_F'));
    assert.equal(node.translation[0] < 0, name.endsWith('L'));
  }
});
test('rolling distance follows the exported radius while driving response stays unchanged', () => {
  const s = spawnState();
  stepDrive(s, { forward: true }, 0.1);
  assert(Math.abs(s.speed - 0.56) < 1e-10);
  assert(Math.abs(s.wheelRoll - (s.speed * 0.1) / VEHICLE_CONFIG.wheelRadius) < 1e-10);
  assert.equal(s.heading, spawnState().heading);
});
test('09 uses native geometry and distinct exported surface responses', () => {
  assert.equal(g.images?.length || 0, 0);
  const materials = g.materials;
  const find = (s) => materials.find((m) => m.name.includes(s)).pbrMetallicRoughness;
  assert(find('orange enamel').roughnessFactor < 0.45);
  assert(find('Matte graphite').roughnessFactor > 0.8);
  assert(find('Blue grey glass').roughnessFactor < 0.25);
  assert(find('Satin silver').metallicFactor > 0.6);
  assert(g.nodes.some((n) => n.name === 'Cream rounded roof'));
  assert(
    !g.nodes.some((n) =>
      /luggage|travel bag|rack|handle sewn|pocket|surfboard|tail fin|board securing/i.test(
        n.name || '',
      ),
    ),
  );
});
