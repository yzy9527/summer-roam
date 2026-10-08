import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import configFactory from '../vite.config.js';
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
    for (const name of releaseAssets)
      assert.deepEqual(
        await readFile(resolve(out, prefix, name.slice(7))),
        await readFile(resolve(root, 'src', name)),
        name,
      );
    assert(
      (await readFile(resolve(out, 'THIRD-PARTY-LICENSES.txt'), 'utf8')).includes('MIT License'),
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
