import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import * as legacyWorld from '../src/drive.js';
import * as culvert from '../src/culvert-profile.js';
import { probeWorld } from './helpers/world-probe.mjs';

const root = resolve(import.meta.dirname, '../src');
function graphFromEntries() {
  const graph = new Map(),
    external = new Map();
  function visit(file) {
    if (graph.has(file)) return;
    const source = readFileSync(file, 'utf8'),
      deps = [];
    graph.set(file, deps);
    // Current source uses literal ESM imports/re-exports and literal dynamic imports.
    const specs = [
      ...source.matchAll(
        /(?:^\s*(?:import|export)\s+(?:[^;]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\))/gm,
      ),
    ].map((m) => m[1] ?? m[2]);
    external.set(
      file,
      specs.filter((s) => !s.startsWith('.')),
    );
    for (const spec of specs.filter((s) => s.startsWith('.'))) {
      const target = resolve(dirname(file), spec);
      if (target.endsWith('.js') && existsSync(target)) {
        deps.push(target);
        visit(target);
      }
    }
  }
  function visitDirectory(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) visitDirectory(path);
      else if (entry.name.endsWith('.js')) visit(path);
    }
  }
  visitDirectory(root);
  return { graph, external };
}
test('maintained runtime dependency graph has no cycles, including dynamic QA imports', () => {
  const { graph } = graphFromEntries(),
    visited = new Set(),
    active = [];
  function visit(file) {
    assert.ok(
      !active.includes(file),
      `Cycle: ${[...active, file].map((p) => relative(root, p)).join(' -> ')}`,
    );
    if (visited.has(file)) return;
    active.push(file);
    for (const dep of graph.get(file)) visit(dep);
    active.pop();
    visited.add(file);
  }
  for (const file of graph.keys()) {
    assert.ok(
      file.startsWith(root + '/'),
      `Runtime cannot import outside src: ${relative(root, file)}`,
    );
    visit(file);
  }
  assert.ok(
    graph.get(resolve(root, 'main.js')).includes(resolve(root, 'field-qa.js')),
    'dynamic QA entry must be checked',
  );
});
test('world and vehicle simulation layers cannot import rendering, DOM, or reverse scene dependencies', () => {
  const { graph, external } = graphFromEntries();
  const allowed = new Set([
    'world-base.js',
    'world-queries.js',
    'culvert-profile.js',
    'canal-profile.js',
    'road-network.js',
    'nohara-house-site.js',
    'paddy-profile.js',
    'vehicle-config.js',
    'asset-url.js',
    'assets-manifest.js',
    'vehicle-steering.js',
    'vehicle-collision.js',
    'drive.js',
  ]);
  const checked = new Set();
  function visit(file) {
    if (checked.has(file)) return;
    checked.add(file);
    assert.ok(allowed.has(relative(root, file)), `Pure layer depends on ${relative(root, file)}`);
    assert.deepEqual(external.get(file), [], `${relative(root, file)} imports a non-pure package`);
    assert.doesNotMatch(
      readFileSync(file, 'utf8'),
      /\b(?:document|window|WebGLRenderer|GLTFLoader)\b/,
    );
    for (const dep of graph.get(file)) visit(dep);
  }
  for (const name of [
    'world-base.js',
    'world-queries.js',
    'culvert-profile.js',
    'vehicle-collision.js',
    'drive.js',
  ])
    visit(resolve(root, name));
  for (const [file, deps] of graph)
    if (!['main.js', 'field-qa.js'].includes(relative(root, file)))
      assert.ok(
        !deps.includes(resolve(root, 'drive.js')),
        `${relative(root, file)} must consume its owning spatial/collision module`,
      );
});
test('1317 spatial samples and 2640 drive steps exactly preserve phase-one numerical and callback behavior', () => {
  const baseline = JSON.parse(
    readFileSync(new URL('./fixtures/world-baseline-phase1.json', import.meta.url)),
  );
  assert.deepEqual(probeWorld(legacyWorld, culvert), baseline);
});
