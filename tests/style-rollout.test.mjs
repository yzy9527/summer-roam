import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BRIDGE_STATIONS,
  bridgeLayout,
  bridgeWindow,
  corridorMasonryPlacements,
  corridorColliders,
  addUnifiedIrrigation,
} from '../src/irrigation-style.js';
import { canalOffset, canalWidth } from '../src/canal-profile.js';
import { roadFrame } from '../src/drive.js';
import { normalizeFieldTree, FIELD_TREE_REFERENCE_HEIGHT, leafLOD } from '../src/field-trees.js';
test('all four crossings share thick stone decks while adapting to the original water width', () => {
  assert.deepEqual(BRIDGE_STATIONS, [21, 34, 114, 174]);
  for (const s of BRIDGE_STATIONS) {
    const b = bridgeLayout(s);
    assert.equal(b.waterWidth, canalWidth(s));
    assert.equal(b.decks.length, 4);
    assert(b.span > b.waterWidth + 0.9);
    for (const q of b.decks) assert.equal(q.sy, 0.26);
    assert(bridgeWindow(s, canalOffset(s)));
    assert(!bridgeWindow(s, 0));
  }
});
test('corridor masonry covers both banks, clears bridges, and leaves the full road open', () => {
  const points = corridorMasonryPlacements();
  assert(points.length > 900);
  for (const s of [40, 80, 120, 160, 185])
    for (const side of [-1, 1])
      assert(
        points.some((p) => Math.abs(p.s - s) < 2 && Math.sign(p.d - canalOffset(p.s)) === side),
      );
  for (const c of corridorColliders(points)) {
    const f = roadFrame(c.s);
    const distance = Math.abs((c.x - f.x) * f.nx + (c.z - f.z) * f.nz);
    assert(distance - c.radius - 0.88 > 2.25);
    assert(Number.isFinite(c.height));
  }
});
test('shared irrigation registers actual colliders and visible section culling separately', () => {
  const scene = new THREE.Scene(),
    colliders = [],
    cull = [];
  const report = addUnifiedIrrigation(scene, colliders, cull);
  assert.equal(colliders.length, report.collisionBodies);
  assert(cull.length > 30);
  assert(
    cull.every(
      (p) =>
        (p.o.isGroup || p.o.isInstancedMesh || p.o.geometry.isInstancedBufferGeometry) &&
        Number.isFinite(p.distance),
    ),
  );
  assert.equal(
    scene.children.filter((o) => o.name.startsWith('Unified deep grey stone bridge')).length,
    4,
  );
});
test('tree normalization preserves established field heights and LOD keeps complete leaves', () => {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(4, 10, 3)));
  normalizeFieldTree(root);
  const b = new THREE.Box3().setFromObject(root, true);
  assert(Math.abs(b.min.y) < 1e-9);
  assert(Math.abs(b.getSize(new THREE.Vector3()).y - FIELD_TREE_REFERENCE_HEIGHT) < 1e-9);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(180).fill(0), 3));
  g.setIndex(Array.from({ length: 180 }, (_, i) => i % 60));
  const lod = leafLOD(g, 3);
  assert.equal(lod.index.count, 72);
  assert.deepEqual(
    Array.from(lod.index.array).slice(18, 36),
    Array.from(g.index.array).slice(54, 72),
  );
});
test('stone crossings retain flat continuous decks, connected rails, and an open water passage', () => {
  const scene = new THREE.Scene();
  addUnifiedIrrigation(scene, [], []);
  for (const s of BRIDGE_STATIONS) {
    const b = bridgeLayout(s),
      deck = scene.children.find((o) => o.name === 'Unified deep grey stone bridge ' + s);
    deck.geometry.computeBoundingBox();
    const bounds = deck.geometry.boundingBox;
    assert(
      Math.abs(bounds.max.y - bounds.min.y - 0.26) < 0.002,
      'retain structural slab thickness',
    );
    const top = deck.geometry.attributes.position;
    let flatTop = 0;
    for (let i = 0; i < top.count; i++) if (Math.abs(top.getY(i) - 0.13) < 1e-5) flatTop++;
    assert(flatTop > 50, 'large level plane rather than pillowy slabs');
    const posts = scene.children.filter((o) => o.name === 'Weathered stone railing post ' + s),
      rails = scene.children.filter((o) => o.name === 'Weathered stone horizontal rail ' + s);
    assert.equal(posts.length, 6);
    assert.equal(rails.length, 4);
    for (const post of posts) {
      post.geometry.computeBoundingBox();
      const box = post.geometry.boundingBox,
        base = post.position.y + box.min.y,
        cap = post.position.y + box.max.y;
      assert(Math.abs(base - (b.h + 0.215)) < 0.002, 'pillar seated on deck');
      const upper = rails.filter((r) => Math.abs(r.position.y - (b.h + 0.725)) < 0.001);
      assert(
        upper.every((r) => cap > r.position.y + 0.03 && cap - r.position.y - 0.03 < 0.06),
        'cap projects naturally above top rail',
      );
    }
    for (const foot of scene.children.filter(
      (o) => o.name === 'Embedded stone bridge foundation ' + s,
    )) {
      const f = roadFrame(s),
        d = Math.abs((foot.position.x - b.p.x) * f.nx + (foot.position.z - b.p.z) * f.nz);
      foot.geometry.computeBoundingBox();
      assert(
        d - foot.geometry.boundingBox.max.x >= b.waterWidth / 2 - 0.002,
        'abutments do not block channel',
      );
    }
    assert.notEqual(
      deck.material[2].color.getHex(),
      deck.material[4].color.getHex(),
      'top and side have distinct stone tones',
    );
    assert(deck.material.every((m) => m.roughness >= 0.98 && m.metalness === 0));
  }
});
