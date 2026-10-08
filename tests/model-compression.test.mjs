import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { compressGLB, readGLB, verifyGLBEquivalence } from '../scripts/compress-glb.mjs';
import { createModelLoader } from '../src/loading/model-loader.js';

async function parse(bytes) {
  const loader = createModelLoader();
  // Node has no image decoder; real images are checked byte for byte separately.
  loader.register((parser) => {
    parser.loadTexture = async () => new THREE.Texture();
    return { name: 'NodeTextures' };
  });
  return loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    '',
  );
}
function describe(gltf) {
  const nodes = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((node) => {
    const result = { name: node.name, type: node.type, matrix: node.matrixWorld.toArray() };
    if (node.isMesh) {
      result.index = node.geometry.index?.array;
      result.attributes = Object.fromEntries(
        Object.entries(node.geometry.attributes).map(([name, value]) => [name, value.array]),
      );
      result.morphs = Object.fromEntries(
        Object.entries(node.geometry.morphAttributes).map(([name, values]) => [
          name,
          values.map((value) => value.array),
        ]),
      );
      result.influences = node.morphTargetInfluences;
      result.material = (Array.isArray(node.material) ? node.material : [node.material]).map(
        (m) => [m.name, m.color?.toArray(), m.roughness, m.metalness],
      );
    }
    if (node.isSkinnedMesh)
      result.skin = {
        bones: node.skeleton.bones.map((bone) => bone.name),
        inverse: node.skeleton.boneInverses.map((matrix) => matrix.toArray()),
      };
    nodes.push(result);
  });
  return {
    nodes,
    animations: gltf.animations.map((clip) => ({
      name: clip.name,
      duration: clip.duration,
      tracks: clip.tracks.map((track) => ({
        name: track.name,
        times: track.times,
        values: track.values,
      })),
    })),
  };
}

test('real skinned/morph/animated/textured models parse identically after deterministic lossless encoding', async () => {
  for (const path of [
    'models/hornless-calf/hornless-calf-rigged.glb',
    'models/shinchan/Shiro_Rigged.glb',
    'trees/jabami-anime-tree-v2/jabami-anime-tree-v2.glb',
    'models/campsite-cooking-set.glb',
  ]) {
    const source = await readFile(new URL('../src/assets/' + path, import.meta.url)),
      saved = Buffer.from(source);
    const published = await compressGLB(source);
    assert.deepEqual(source, saved, 'Source bytes remain untouched');
    assert.ok(published.length < source.length);
    assert.deepEqual(
      await compressGLB(source),
      published,
      'Stable encoding and asset cache version',
    );
    await verifyGLBEquivalence(source, published);
    const [original, compressed] = await Promise.all([parse(source), parse(published)]);
    assert.deepEqual(describe(compressed), describe(original), path);
    const json = readGLB(published).json;
    assert.ok(json.extensionsRequired.includes('EXT_meshopt_compression'));
    for (const view of json.bufferViews) {
      const e = view.extensions?.EXT_meshopt_compression;
      if (!e) continue;
      assert.equal(view.byteLength, e.count * e.byteStride);
      if (view.byteStride) assert.equal(view.byteStride, e.byteStride);
      assert.equal(e.filter, 'NONE');
      assert.notEqual(e.mode, 'TRIANGLES', 'Index ordering remains byte-exact');
    }
  }
});

test('release verification rejects altered buffer-view metadata as well as binary data', async () => {
  const source = await readFile(
    new URL('../src/assets/models/hornless-calf/hornless-calf-rigged.glb', import.meta.url),
  );
  const published = await compressGLB(source);
  const corrupted = Buffer.from(published),
    { json, binary } = readGLB(corrupted);
  const image = json.images[0],
    view = json.bufferViews[image.bufferView];
  binary[view.byteOffset] ^= 1;
  await assert.rejects(verifyGLBEquivalence(source, corrupted), /Buffer view.*changed/);
  const metadata = Buffer.from(published);
  const text = metadata.subarray(20, 20 + metadata.readUInt32LE(12)).toString();
  const changed = text.replace('"target":34962', '"target":34963');
  assert.notEqual(changed, text);
  metadata.write(changed, 20);
  await assert.rejects(verifyGLBEquivalence(source, metadata), /metadata changed/);
});
