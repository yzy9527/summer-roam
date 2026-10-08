import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS } from '../src/assets-manifest.js';
import { assetUrl } from '../src/asset-url.js';
import { releaseAssets } from '../scripts/release-assets.mjs';
import config from '../vite.config.js';
import { normalizeFieldTree } from '../src/field-trees.js';
const root = resolve(import.meta.dirname, '..');
test('registration covers every current runtime binary, with unique paths and required credits', () => {
  assert.equal(new Set(Object.values(ASSETS)).size, Object.keys(ASSETS).length);
  assert.deepEqual(
    releaseAssets,
    Object.values(ASSETS).map((p) => 'assets/' + p),
  );
  for (const path of Object.values(ASSETS)) {
    assert.doesNotMatch(path, /\.\.|^\/|\\/);
    assert.ok(existsSync(resolve(root, 'src/assets', path)), path);
    assert.ok(readFileSync(resolve(root, 'src/assets', path)).length > 0);
  }
  assert.match(ASSETS['nohara-credits'], /CREDITS\.md$/);
  assert.match(ASSETS['audio-credits'], /CREDITS\.md$/);
  function sources(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? sources(resolve(dir, e.name))
        : e.name.endsWith('.js')
          ? [resolve(dir, e.name)]
          : [],
    );
  }
  for (const file of sources(resolve(root, 'src'))) {
    if (file === resolve(root, 'src/asset-url.js')) continue;
    // Permit JS module imports; all data loads, including synchronous TextureLoader.load,
    // must use the registry. Diagnostic strings without ./ are intentionally allowed.
    assert.doesNotMatch(readFileSync(file, 'utf8'), /['"`]\.\/assets\/(?![^'"`]*\.js['"`])/, file);
  }
  const buildImports = readFileSync(resolve(root, 'scripts/release-assets.mjs'), 'utf8');
  assert.doesNotMatch(buildImports, /audio\.js|field-animals|vehicle-config|bull-charge/);
});
test('URL resolution rejects unknown and inherited names and supports root and nested deployments', () => {
  for (const id of ['missing', 'toString', 'constructor', '__proto__'])
    assert.throws(() => assetUrl(id), /Unregistered asset/);
  for (const base of ['https://example.test/', 'https://example.test/game/']) {
    assert.equal(
      new URL(assetUrl('golden-cow'), base).pathname,
      new URL('assets/models/golden-cow/golden-cow-rigged.glb', base).pathname,
    );
    assert.equal(
      new URL(assetUrl('sample-tree-02', './assets/runtime-test/'), base).pathname,
      new URL('assets/runtime-test/trees/sample-tree-02/sample-tree-02.glb', base).pathname,
    );
  }
});
test('development and build use explicit different prefixes; only build copies versioned assets', () => {
  const dev = config({ command: 'serve' }),
    build = config({ command: 'build' });
  assert.equal(JSON.parse(dev.define.__RUNTIME_ASSET_PREFIX__), './assets/');
  assert.match(
    JSON.parse(build.define.__RUNTIME_ASSET_PREFIX__),
    /^\.\/assets\/runtime-[a-f0-9]{16}\/$/,
  );
  assert.equal(build.plugins[0].apply, 'build');
  assert.equal(build.plugins[0].transform, undefined, 'arbitrary strings are never rewritten');
});
test('tree loads retry after failure, share concurrent success, and keep caller transforms independent', async () => {
  const original = GLTFLoader.prototype.loadAsync;
  let calls = 0;
  GLTFLoader.prototype.loadAsync = async (url) => {
    assert.equal(url, assetUrl('sample-tree-02'));
    calls++;
    if (calls === 1) throw new Error('first request fails');
    const scene = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 8.65, 1),
      new THREE.MeshStandardMaterial(),
    );
    mesh.name = 'wood';
    scene.add(mesh);
    return { scene };
  };
  try {
    const { loadSampleTree } = await import(
      '../src/assets/trees/sample-tree-02/load-tree.js?retry-test'
    );
    await assert.rejects(loadSampleTree(), /first request fails/);
    const [a, b] = await Promise.all([loadSampleTree(), loadSampleTree()]);
    assert.equal(calls, 2);
    const before = new THREE.Box3().setFromObject(b, true).getSize(new THREE.Vector3()).toArray();
    normalizeFieldTree(a.levels[0].object);
    a.position.set(3, 4, 5);
    a.scale.setScalar(2);
    assert.deepEqual(
      new THREE.Box3().setFromObject(b, true).getSize(new THREE.Vector3()).toArray(),
      before,
    );
    assert.deepEqual(b.position.toArray(), [0, 0, 0]);
    assert.notEqual(a.levels[0].object, b.levels[0].object);
  } finally {
    GLTFLoader.prototype.loadAsync = original;
  }
});
