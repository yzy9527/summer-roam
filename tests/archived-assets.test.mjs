import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { ASSETS } from '../src/assets-manifest.js';
import { ANIMAL_LAYOUT } from '../src/field-animals.js';
import { ANIMAL_PROFILES } from '../src/animal-profiles.js';
const root = resolve(import.meta.dirname, '..');
test('retired assets do not return to registration, production or current source chain', () => {
  const retired = [
    'reference-snake',
    'summer-tree-01',
    'sample-tree-01',
    'retro-car',
    'country-house',
  ];
  for (const path of Object.values(ASSETS))
    for (const id of retired) assert.ok(!path.includes(id), path);
  for (const path of [
    'assets-source/reference-snake',
    'assets-source/trees/summer-tree-01',
    'src/assets/reviews',
    'src/vendor',
    'src/assets/models/retro-car.glb',
    'src/assets/models/summer-tree.glb',
    'src/assets/models/country-house.glb',
  ])
    assert.equal(existsSync(resolve(root, path)), false, path);
  assert.equal(ANIMAL_PROFILES['reference-snake'], undefined);
  assert.deepEqual(
    ANIMAL_LAYOUT.map((a) => a.id).sort(),
    ['golden-cow', 'copper-cow', 'hornless-calf', 'reference-wolf', 'baola-leopard'].sort(),
  );
  for (const name of readdirSync(resolve(root, 'src')))
    assert.ok(!/preview|review/.test(name), name);
});
test('current animals retain editable static and rigged sources plus actual runtime assets', () => {
  for (const { id } of ANIMAL_LAYOUT) {
    for (const name of [`${id}.blend`, `${id}-rigged.blend`, 'build.py', 'rig.py', 'README.md'])
      assert.ok(existsSync(resolve(root, 'assets-source', id, name)), `${id}/${name}`);
    assert.ok(existsSync(resolve(root, 'src/assets', ASSETS[id])));
    assert.equal(
      existsSync(resolve(root, 'src/assets/models', id, `${id}.glb`)),
      false,
      'static GLB is a reproducible intermediate',
    );
  }
  for (const path of [
    'assets-source/animals/rig.py',
    'assets-source/animals/rig-profiles.json',
    'assets-source/trees/sample-tree-02/build.py',
    'assets-source/trees/sample-tree-02/sample-tree-02.blend',
    'assets-source/surf-car-09/surf-car-09.blend',
    'assets-source/surf-car-09/surf-car-09-base.blend',
    'assets-source/surf-car-09/build_surf_car.py',
    'assets-source/studies/reference-house.blend',
    'assets-source/build_reference_house.py',
    'assets-source/crayon_shin-chan_nohara_house.glb',
    'assets-source/nohara-house/convert.mjs',
  ])
    assert.ok(existsSync(resolve(root, path)), path);
  assert.match(
    readFileSync(resolve(root, 'assets-source/animals/rig.py'), 'utf8'),
    /open_mainfile.*\.blend/,
  );
});
