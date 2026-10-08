import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { releaseAssets } from './release-assets.mjs';
import { RELEASE_BUDGET } from './release-policy.mjs';
const root = resolve(import.meta.dirname, '..'),
  out = resolve(process.argv[2] ?? resolve(root, 'dist'));
async function files(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)],
      ),
    )
  ).flat();
}
assert.equal(new Set(releaseAssets).size, releaseAssets.length, 'Duplicate registered resource');
for (const name of releaseAssets)
  assert.match(name, /^assets\/(?!.*\.\.)(?!.*\\)[a-zA-Z0-9_ /.-]+$/);
const paths = await files(out),
  names = paths.map((p) => relative(out, p).split(sep).join('/'));
const html = await readFile(resolve(out, 'index.html'), 'utf8');
const digest = createHash('sha256');
for (const name of [...releaseAssets].sort())
  digest.update(name).update(await readFile(resolve(root, 'src', name)));
const version = digest.digest('hex').slice(0, 16);
for (const name of releaseAssets) {
  const deployed = resolve(out, `assets/runtime-${version}`, name.slice(7));
  assert.deepEqual(
    await readFile(deployed),
    await readFile(resolve(root, 'src', name)),
    `Changed or missing resource: ${name}`,
  );
}
const registered = releaseAssets.map((name) => `assets/runtime-${version}/` + name.slice(7));
assert.deepEqual(
  names.filter((name) => name.startsWith('assets/runtime-')).sort(),
  registered.sort(),
  'Unregistered runtime resource or wrong version',
);
for (const name of names) {
  assert.ok(
    !/(?:^|\/)(?:reviews|vendor|tests|node_modules|assets-source)(?:\/|$)/.test(name),
    `Development folder in release: ${name}`,
  );
  assert.ok(
    !/preview|review|runtime-before|reference-snake|\.blend$|\.py$|\.map$/.test(name),
    `Non-release file: ${name}`,
  );
  assert.ok(
    ['.html', '.js', '.css', '.svg', '.png', '.glb', '.mp3', '.wav', '.txt', '.md'].includes(
      extname(name),
    ),
    `Unexpected file: ${name}`,
  );
  if (/\.(glb|png|mp3|wav|md)$/.test(name))
    assert.ok(registered.includes(name), `Unregistered published asset: ${name}`);
  if (name.endsWith('.html')) assert.equal(name, 'index.html');
  if (name.endsWith('.js')) {
    const code = await readFile(resolve(out, name), 'utf8');
    assert.ok(!code.includes('sourceMappingURL'), 'Source map exposed');
    assert.ok(!code.includes('./assets/models/'), 'Unversioned model URL');
  }
}
for (const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g))
  assert.ok(names.includes(match[1].slice(2)), `Missing HTML dependency: ${match[1]}`);
const bytes = (await Promise.all(paths.map((p) => stat(p)))).reduce((sum, s) => sum + s.size, 0);
const codeBytes = (
  await Promise.all(paths.filter((p) => /\.(js|css)$/.test(p)).map((p) => stat(p)))
).reduce((sum, s) => sum + s.size, 0);
assert.ok(names.length <= RELEASE_BUDGET.files, `Release file budget exceeded: ${names.length}`);
assert.ok(bytes <= RELEASE_BUDGET.totalBytes, `Release byte budget exceeded: ${bytes}`);
assert.ok(codeBytes <= RELEASE_BUDGET.codeBytes, `JS/CSS byte budget exceeded: ${codeBytes}`);
console.log(
  `Release verified: ${names.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB; JS/CSS ${(codeBytes / 1024).toFixed(1)} KiB. Upload dist contents.`,
);
