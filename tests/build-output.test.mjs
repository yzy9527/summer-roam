import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import configFactory from '../vite.config.js';
import { verifyGLBEquivalence } from '../scripts/compress-glb.mjs';
import { releaseAssets } from '../scripts/release-assets.mjs';

test('release plugin copies its registered binaries and license into the resolved custom outDir', async () => {
  const out = await mkdtemp(join(tmpdir(), 'seaside-build-output-'));
  try {
    const root = resolve(import.meta.dirname, '..');
    const config = configFactory({ command: 'build' });
    const plugin = config.plugins.find((p) => p.name === 'game-release-assets');
    plugin.configResolved({ root, build: { outDir: out } });
    await plugin.closeBundle();
    const prefix = JSON.parse(config.define.__RUNTIME_ASSET_PREFIX__);
    let originalModelBytes = 0,
      publishedModelBytes = 0;
    for (const name of releaseAssets) {
      const published = await readFile(resolve(out, prefix, name.slice(7))),
        original = await readFile(resolve(root, 'src', name));
      if (name.endsWith('.glb')) {
        await verifyGLBEquivalence(original, published);
        originalModelBytes += original.length;
        publishedModelBytes += published.length;
      } else assert.deepEqual(published, original, name);
    }
    assert(publishedModelBytes < originalModelBytes * 0.7, 'Lossless model reduction exceeds 30%');
    assert(
      (await readFile(resolve(out, 'THIRD-PARTY-LICENSES.txt'), 'utf8')).includes('MIT License'),
    );
    assert(
      (await readFile(resolve(out, 'THIRD-PARTY-LICENSES.txt'), 'utf8')).includes(
        'Arseny Kapoulkine',
      ),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
