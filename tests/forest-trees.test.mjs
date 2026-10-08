import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addSummerDressing } from '../src/summer-dressing.js';
import {
  addForestTrees,
  loadForestTreeAssets,
  FOREST_ASSET_ID,
  FOREST_LOD_DISTANCES,
} from '../src/forest-trees.js';
import { assetUrl } from '../src/asset-url.js';

test('approved anime tree keeps bark, tuft shading and complete instanced trees across LOD moves', async () => {
  const bytes = readFileSync(
      new URL('../src/assets/trees/anime-tree/anime-tree.glb', import.meta.url),
    ),
    loader = new GLTFLoader();
  // Geometry integration uses the actual GLB. Browser acceptance checks image
  // decoding and rendering still require visual acceptance outside Node.
  loader.register((parser) => {
    parser.loadTexture = async () => new THREE.Texture();
    return { name: 'NodeGeometryOnly' };
  });
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  const referenceBytes = readFileSync(
    new URL('../src/assets/trees/sample-tree-02/sample-tree-02.glb', import.meta.url),
  );
  const reference = await loader.parseAsync(
    referenceBytes.buffer.slice(
      referenceBytes.byteOffset,
      referenceBytes.byteOffset + referenceBytes.byteLength,
    ),
    '',
  );
  let referenceLeaf;
  reference.scene.traverse((o) => {
    if (o.isMesh && o.name.includes('leaf')) referenceLeaf = o;
  });
  function meanPigment(mesh) {
    const attr = mesh.geometry.attributes.color,
      mean = new THREE.Vector3();
    for (let i = 0; i < attr.count; i++)
      mean.add(new THREE.Vector3(attr.getX(i), attr.getY(i), attr.getZ(i)));
    return mean.divideScalar(attr.count);
  }
  const roadsidePigment = meanPigment(referenceLeaf);
  const original = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async (url) => {
    assert.equal(url, assetUrl(FOREST_ASSET_ID));
    return gltf;
  };
  try {
    const variants = await loadForestTreeAssets();
    assert.equal(variants.length, 1);
    assert(Math.abs(variants[0].height - 5.95) < 1e-5);
    assert(
      Math.abs(variants[0].base) < 0.05,
      'only the shallow root tips sit below the root origin',
    );
    assert.deepEqual(FOREST_LOD_DISTANCES, [28, 85]);
    for (const variant of variants) {
      const triangles = variant.levels.map((group) => {
        assert.equal(group.children.length, 2);
        const leaf = group.children.find((o) => o.name.includes('_leaf'));
        const wood = group.children.find((o) => o.name.includes('_wood'));
        assert(wood.material.map, 'hand-painted bark texture survives runtime import');
        assert(wood.geometry.attributes.uv);
        assert.equal(wood.material.metalness, 0);
        assert(Math.abs(wood.material.roughness - 0.92) < 1e-5);
        assert.equal(leaf.material.vertexColors, true);
        assert(leaf.geometry.attributes.color);
        assert(
          meanPigment(leaf).distanceTo(roadsidePigment) < 0.065,
          'forest pigment stays close to the actual roadside tree',
        );
        assert.equal(
          leaf.material.emissive.getHex(),
          0,
          'leaves must respond to scene light without emission',
        );
        assert(
          Math.abs(leaf.material.roughness - 0.94) < 1e-5,
          'matte response matches roadside leaves',
        );
        assert.equal(leaf.material.map, null, 'opaque geometry leaves require no cutout texture');
        assert.equal(leaf.material.transparent, false);
        assert.equal(leaf.material.alphaTest, 0);
        const n = leaf.geometry.attributes.normal;
        for (let i = 0; i < n.count; i++) {
          const normal = new THREE.Vector3().fromBufferAttribute(n, i);
          assert(normal.toArray().every(Number.isFinite));
          assert(Math.abs(normal.length() - 1) < 1e-6);
        }
        return group.children.reduce((sum, o) => sum + o.geometry.index.count / 3, 0);
      });
      assert(triangles[0] > triangles[1] && triangles[1] > triangles[2]);
      assert.equal(triangles[0], 139996, 'near LOD preserves the approved model');
      assert(triangles[1] < 40000);
      assert(triangles[2] < 9000);
    }
    const scene = new THREE.Scene(),
      points = addSummerDressing(scene, [], []),
      forest = addForestTrees(scene, variants, points);
    assert.equal(points.length, 180);
    assert(points.slice(0, 120).every((p) => p.z >= 220 && p.z <= 275));
    assert(points.slice(120).every((p) => p.x <= -65 && p.x >= -110));
    assert(!scene.getObjectByName('Village forest and distant conifer belt'));
    const batches = scene.children.filter((o) => o.name.startsWith('Layered forest'));
    assert.equal(batches.length, 6, 'bounded draws instead of individual tree objects');
    assert(batches.filter((o) => o.name.includes(' far ')).every((o) => !o.castShadow));
    for (const camera of [
      new THREE.Vector3(0, 4, 0),
      new THREE.Vector3(-100, 8, 100),
      new THREE.Vector3(0, 10, 500),
    ]) {
      forest.update(camera);
      for (const kind of ['leaves', 'wood']) {
        assert.equal(
          batches.filter((o) => o.name.endsWith(kind)).reduce((n, o) => n + o.count, 0),
          180,
          'each tree has exactly one crown and trunk in the active LOD',
        );
      }
      for (const o of batches.filter((o) => o.count)) {
        assert(o.boundingSphere && Number.isFinite(o.boundingSphere.radius));
        for (let i = 0; i < o.count; i++) {
          const m = new THREE.Matrix4();
          o.getMatrixAt(i, m);
          assert(m.elements.every(Number.isFinite));
          assert(
            points.some(
              (p) => Math.abs(p.x - m.elements[12]) < 1e-4 && Math.abs(p.z - m.elements[14]) < 1e-4,
            ),
          );
        }
      }
    }
    const boundaryScene = new THREE.Scene();
    const boundaryPoints = [27, 28, 84, 85].map((x) => ({
      x,
      y: 0,
      z: 0,
      height: 5.95,
      width: 1,
      ry: 0,
      rz: 0,
    }));
    const boundaryForest = addForestTrees(boundaryScene, variants, boundaryPoints);
    assert.deepEqual(
      ['near', 'mid', 'far'].map(
        (level) => boundaryScene.children.find((o) => o.name.includes(` ${level} `)).count,
      ),
      [1, 2, 1],
    );
    boundaryForest.update(new THREE.Vector3(100, 0, 0));
    assert.equal(
      boundaryScene.children
        .filter((o) => o.name.endsWith('leaves'))
        .reduce((n, o) => n + o.count, 0),
      4,
    );
  } finally {
    GLTFLoader.prototype.loadAsync = original;
  }
});
