import { roadsidePlantAllowed } from './roadside-planting.js';
import * as THREE from 'three';
import { roadFrame } from './world-base.js';
import { fieldGroundHeight } from './field-landscape.js';
import { canalWidth, waterLevel } from './canal-profile.js';
import { loadSampleTree } from './assets/trees/sample-tree-02/load-tree.js';
import { SAMPLE } from './sample-layout.js';
import { masonryPlacements } from './irrigation-style.js';
import { samplePlantHeight } from './sample-bank.js';

const random =
  (seed = 10221) =>
  () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
const material = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.96, ...extra });
function point(s, d) {
  const f = roadFrame(s);
  return { x: f.x + f.nx * d, z: f.z + f.nz * d, heading: f.heading };
}
function batch(scene, g, m, points, name, shadow = false) {
  const o = new THREE.InstancedMesh(g, m, points.length),
    dummy = new THREE.Object3D();
  o.name = name;
  points.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
    dummy.scale.set(p.sx || 1, p.sy || 1, p.sz || 1);
    dummy.updateMatrix();
    o.setMatrixAt(i, dummy.matrix);
    if (p.color) o.setColorAt(i, new THREE.Color(p.color));
  });
  o.castShadow = shadow;
  o.receiveShadow = true;
  o.computeBoundingSphere();
  scene.add(o);
  return o;
}
export { masonryPlacements, masonryColliders } from './irrigation-style.js';
export async function addEnvironmentSample(scene, colliders, warnings) {
  const rnd = random();
  // Consume the established local random sequence so approved planting stays in place.
  const rockSets = masonryPlacements(rnd);
  // A few flowers accent sunlit clumps, not a uniform dotted border.
  const flowers = [],
    centres = [],
    stems = [],
    flowerGeo = new THREE.CircleGeometry(0.045, 7);
  flowerGeo.rotateX(-Math.PI / 2);
  for (const [s, d] of [
    [11.4, -3.15],
    [17.7, -5.67],
    [24.8, -5.65],
    [28.2, -3.35],
  ])
    for (let i = 0; i < 18; i++) {
      const ss = s + (rnd() - 0.5) * 0.8,
        dd = d + (rnd() - 0.5) * 0.5,
        q = point(ss, dd),
        height = 0.18 + rnd() * 0.16,
        y = samplePlantHeight(ss, dd);
      if (!roadsidePlantAllowed(q.x, q.z, 0.06)) continue;
      flowers.push({ ...q, y: y + height, ry: rnd() * 6.28 });
      centres.push({ ...q, y: y + height + 0.005 });
      stems.push({ ...q, y: y + height / 2, sy: height });
    }
  batch(
    scene,
    flowerGeo,
    material('#f2eecb', { side: THREE.DoubleSide }),
    flowers,
    'Sample small cream flowers',
  );
  batch(
    scene,
    new THREE.SphereGeometry(0.011, 5, 3),
    material('#d5b044'),
    centres,
    'Sample flower centres',
  );
  batch(
    scene,
    new THREE.CylinderGeometry(0.003, 0.003, 1, 4),
    material('#5d7b38'),
    stems,
    'Sample flower stems',
  );
  try {
    const tree = await loadSampleTree(),
      q = point(SAMPLE.treeS, SAMPLE.treeD);
    tree.position.set(q.x, fieldGroundHeight(q.x, q.z) - 0.015, q.z);
    tree.rotation.y = q.heading + 0.12;
    scene.add(tree);
    colliders.push({ x: q.x, z: q.z, radius: 0.52, height: 10.7 });
  } catch (e) {
    warnings.push('sample directional tree');
    console.warn(e);
  }
  const audit = {
    range: [10, 30],
    transition: [8, 33],
    canalWidth: canalWidth(21),
    waterDrop: -waterLevel(21),
    bridgeS: 21,
    treeS: SAMPLE.treeS,
    treeD: SAMPLE.treeD,
    treeAsset: 'sample-tree-02',
    bankVisualOnly: false,
    stoneCount: rockSets.reduce((n, a) => n + a.length, 0),
    legacyVegetation: false,
    shrubSprays: 0,
    shrubLeaves: 0,
    stoneCollisionBodies: rockSets.flat().length + 1,
    newReflection: false,
  };
  const el = document.createElement('script');
  el.id = 'environment-sample-audit';
  el.type = 'application/json';
  el.textContent = JSON.stringify(audit);
  document.body.append(el);
}
