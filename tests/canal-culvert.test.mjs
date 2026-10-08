import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  culvertLayout,
  culvertGroundHeight,
  CULVERT_STATIONS,
  addCanalCulvert,
} from '../src/canal-culvert.js';
import { waterLevel, canalBankTop } from '../src/canal-profile.js';
import { fieldGroundHeight } from '../src/field-landscape.js';
import { roadFrame, isRoadSurface, terrainHeight } from '../src/drive.js';
test('flush inlet keeps a submerged floor and clear gap above the water', () => {
  for (const station of CULVERT_STATIONS) {
    const p = culvertLayout(station);
    assert(p.bed < p.water - 0.12);
    assert(p.spring > p.water + 0.05);
    assert(Math.abs(p.rise - (p.width / 2 + 0.2) * (Math.SQRT2 - 1)) < 1e-8);
    assert.equal(p.bankTop, p.ground + canalBankTop(station));
    assert.equal(p.water, p.ground + waterLevel(station));
    for (let t = 0; t <= p.tailStart; t += 0.1)
      for (const d of [-0.5, 0, 0.5]) {
        const x = p.x + d * Math.cos(p.heading) + t * Math.sin(p.heading),
          z = p.z - d * Math.sin(p.heading) + t * Math.cos(p.heading);
        assert(fieldGroundHeight(x, z) < p.water - 0.12);
      }
    assert.equal(culvertGroundHeight(p.x + 2, p.z + 2, 4), 4);
    for (const s of [8, 10, 190, 192, 196]) {
      const f = roadFrame(s);
      assert(isRoadSurface(f.x, f.z));
    }
  }
});
test('both entrances have flush soft stone lids and water contained under restored grass', () => {
  const scene = new THREE.Scene(),
    colliders = [],
    cull = [];
  const report = addCanalCulvert(
    scene,
    colliders,
    cull,
    null,
    (color) => new THREE.MeshStandardMaterial({ color }),
  );
  assert.equal(report.ends.length, 2);
  assert.equal(cull.length, 2);
  for (const p of report.ends) {
    const group = scene.getObjectByName('Flush stone canal inlet ' + p.station),
      water = group.getObjectByName('Continuous water inside flush inlet'),
      cover = group.getObjectByName('Continuous restored grass behind flush inlet');
    assert(cover);
    assert(water.material.userData.canalFlow);
    const a = water.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const z = water.position.z - a.getY(i);
      assert(z <= p.tailStart + 0.011);
    }
    group.traverse((o) => {
      if (o.isMesh)
        for (const n of o.geometry.attributes.position.array) assert(Number.isFinite(n));
    });
    for (const lid of group.children.filter(
      (o) => o.name === 'Ground flush rounded stone lintel',
    )) {
      lid.geometry.computeBoundingBox();
      assert(lid.geometry.boundingBox.max.y + lid.position.y <= p.top + 0.001);
      assert(lid.geometry.boundingBox.max.y + lid.position.y > p.bankTop + 0.1);
    }
    assert(!group.getObjectByName('Rounded arch keystone'));
  }
  assert.equal(colliders.length, 4);
});
test('channel ends return to level dry terrain beyond the entrance', () => {
  for (const station of CULVERT_STATIONS) {
    const p = culvertLayout(station);
    for (const along of [p.length, 2, 4, 6]) {
      const x = p.x + along * Math.sin(p.heading),
        z = p.z + along * Math.cos(p.heading);
      assert(Math.abs(fieldGroundHeight(x, z) - terrainHeight(x, z)) < 1e-6);
    }
    const f = roadFrame(station === 10 ? 6 : 194),
      x = f.x + f.nx * -6.975,
      z = f.z + f.nz * -6.975;
    assert(Math.abs(fieldGroundHeight(x, z) - terrainHeight(x, z)) < 1e-6);
  }
});
