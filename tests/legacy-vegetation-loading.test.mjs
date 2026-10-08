import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addFieldLandscape } from '../src/field-landscape.js';
import { addSummerDressing } from '../src/summer-dressing.js';
test('loading landscape and dressing never requests or creates retired grass before final cleanup', async () => {
  const oldTexture = THREE.TextureLoader.prototype.loadAsync,
    oldGLTF = GLTFLoader.prototype.loadAsync,
    oldDocument = globalThis.document,
    requests = [];
  THREE.TextureLoader.prototype.loadAsync = async (url) => {
    requests.push(url);
    const texture = new THREE.Texture();
    texture.image = { width: 512, height: 512 };
    return texture;
  };
  GLTFLoader.prototype.loadAsync = async (url) => {
    assert.fail('Unexpected model load: ' + url);
  };
  globalThis.document = { createElement: () => ({}), body: { append() {} } };
  try {
    const scene = new THREE.Scene(),
      cull = [],
      warnings = [];
    await addFieldLandscape(scene, cull, warnings);
    addSummerDressing(scene, cull, []);
    assert.deepEqual(requests, ['./assets/closeup/grass-earth-user.png']);
    assert.deepEqual(warnings, []);
    for (const o of scene.children)
      assert(
        !/Approved (long|short)|Continuous summer shoulder|Unified small-leaf|Distant small-leaf|Concealed plant twigs/.test(
          o.name,
        ),
        o.name,
      );
    assert(scene.getObjectByName('Continuous terrain with actual irrigation depression'));
    assert(scene.getObjectByName('Wild white daisies'));
  } finally {
    THREE.TextureLoader.prototype.loadAsync = oldTexture;
    GLTFLoader.prototype.loadAsync = oldGLTF;
    globalThis.document = oldDocument;
  }
});
