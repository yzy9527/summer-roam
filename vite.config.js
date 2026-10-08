import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { releaseAssets } from './scripts/release-assets.mjs';
import { compressGLB, MODEL_ENCODING_VERSION } from './scripts/compress-glb.mjs';

const root = import.meta.dirname;
const source = resolve(root, 'src'),
  defaultOut = resolve(root, 'dist');
const digest = createHash('sha256');
digest.update(MODEL_ENCODING_VERSION);
for (const name of [...releaseAssets].sort())
  digest.update(name).update(readFileSync(resolve(source, name)));
const assetVersion = digest.digest('hex').slice(0, 16);
const assetPrefix = `./assets/runtime-${assetVersion}/`;

export default defineConfig(({ command }) => {
  let outputDirectory = defaultOut;
  return {
    root: source,
    base: './',
    publicDir: false,
    assetsInclude: ['**/*.glb'],
    define: {
      __RUNTIME_ASSET_PREFIX__: JSON.stringify(command === 'build' ? assetPrefix : './assets/'),
    },
    server: { port: 5173 },
    preview: { port: 4173 },
    build: {
      outDir: defaultOut,
      emptyOutDir: true,
      sourcemap: false,
      minify: true,
      cssMinify: true,
      assetsInlineLimit: 0,
      rolldownOptions: {
        output: { codeSplitting: { groups: [{ name: 'three', test: /node_modules\/three\// }] } },
      },
    },
    plugins: [
      {
        name: 'game-release-assets',
        configResolved(config) {
          outputDirectory = resolve(config.root, config.build.outDir);
        },
        apply: 'build',
        enforce: 'pre',
        async closeBundle() {
          for (const name of releaseAssets) {
            const dest = resolve(
              outputDirectory,
              `assets/runtime-${assetVersion}`,
              name.slice('assets/'.length),
            );
            await mkdir(dirname(dest), { recursive: true });
            if (name.endsWith('.glb'))
              await writeFile(dest, await compressGLB(readFileSync(resolve(source, name))));
            else await cp(resolve(source, name), dest);
          }
          await writeFile(
            resolve(outputDirectory, 'THIRD-PARTY-LICENSES.txt'),
            await import('node:fs/promises').then((fs) =>
              Promise.all([
                fs.readFile(resolve(root, 'node_modules/three/LICENSE'), 'utf8'),
                fs.readFile(resolve(root, 'node_modules/meshoptimizer/LICENSE.md'), 'utf8'),
              ]).then((licenses) => licenses.join('\n\n')),
            ),
          );
        },
      },
    ],
  };
});
