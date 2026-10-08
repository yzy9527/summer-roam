import { roadsidePlantAllowed } from './roadside-planting.js';
import { bridgeWindow } from './irrigation-style.js';
import * as THREE from 'three';
import { roadFrame, terrainHeight } from './world-base.js';
import { fieldGroundHeight } from './field-landscape.js';
import { keepLegacyPoint } from './sample-layout.js';

// World-space scenery: open paddies to the east, shaded village banks to the west.
// Batches are local to twenty metre sections so foliage can disappear behind the camera.
function random(seed = 9241) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
const mat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.95, ...extra });
function batch(scene, g, m, points, name, shadow = false) {
  points = points.filter(
    (p) =>
      keepLegacyPoint(p) &&
      !bridgeWindow(p.s, p.d, 0.22) &&
      (!['Wild white daisies', 'Daisy golden centres', 'Daisy stems'].includes(name) ||
        roadsidePlantAllowed(p.x, p.z, 0.18)),
  );
  const mesh = new THREE.InstancedMesh(g, m, points.length),
    dummy = new THREE.Object3D();
  points.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
    dummy.scale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (p.color) mesh.setColorAt(i, new THREE.Color(p.color));
  });
  mesh.name = name;
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return mesh;
}
function at(s, d) {
  const f = roadFrame(s);
  return { s, d, x: f.x + f.nx * d, z: f.z + f.nz * d, heading: f.heading };
}
function mesh(scene, g, m, x, y, z, rotation = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.rotation.y = rotation;
  o.castShadow = true;
  o.receiveShadow = true;
  scene.add(o);
  return o;
}
function petals() {
  const shape = new THREE.Shape();
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * Math.PI * 2,
      r = 0.09 * (0.76 + 0.24 * Math.cos(a * 7)),
      x = Math.cos(a) * r,
      z = Math.sin(a) * r;
    if (!i) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  }
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  return g;
}
export function addSummerDressing(scene, cull, colliders) {
  const rnd = random(),
    flowerGeo = petals(),
    flowerMat = mat('#fffbe1', { side: THREE.DoubleSide }),
    pollenGeo = new THREE.SphereGeometry(0.022, 6, 4),
    pollenMat = mat('#e6b748'),
    stemGeo = new THREE.CylinderGeometry(0.005, 0.007, 1, 4),
    stemMat = mat('#497d36');
  for (let section = 0; section < 10; section++) {
    const flowers = [],
      pollen = [],
      stems = [],
      s0 = section * 20;
    // Advance the historical random sequence without creating retired vegetation.
    for (let i = 0; i < 1700; i++) {
      const s = s0 + rnd() * 20;
      if (s < 4 || s > 196) continue;
      const right = rnd() < 0.68,
        d = right ? -(2.85 + rnd() * 1.1) : 2.8 + rnd() * 1.1;
      if (Math.sin(s * 0.61 + d * 2.3) < -0.75 && rnd() < 0.65) continue;
      rnd();
      rnd();
      rnd();
    }
    // Preserve flower and forest positions after removing the old shrub producer.
    for (let i = 0; i < 24; i++) {
      const s = s0 + rnd() * 20;
      if (s < 4 || s > 195) continue;
      rnd();
      rnd();
      rnd();
      for (let j = 0; j < 130 * 7; j++) rnd();
    }

    for (let i = 0; i < 95; i++) {
      const s = s0 + rnd() * 20;
      if (s < 4 || s > 195) continue;
      const side = rnd() < 0.6 ? -1 : 1,
        p = at(s, side * (2.9 + rnd() * 0.9)),
        y = fieldGroundHeight(p.x, p.z),
        h = 0.4 + rnd() * 0.38,
        a = rnd() * 6.28;
      flowers.push({
        ...p,
        y: y + h,
        rx: (rnd() - 0.5) * 0.5,
        ry: a,
        sx: 0.65 + rnd() * 0.6,
        sz: 0.65 + rnd() * 0.6,
      });
      pollen.push({ ...p, y: y + h + 0.018 });
      stems.push({ ...p, y: y + h * 0.5, sy: h });
    }
    const centre = at(s0 + 10, 0);
    for (const [g, m, pts, name] of [
      [flowerGeo, flowerMat, flowers, 'Wild white daisies'],
      [pollenGeo, pollenMat, pollen, 'Daisy golden centres'],
      [stemGeo, stemMat, stems, 'Daisy stems'],
    ]) {
      const o = batch(scene, g, m, pts, name);
      cull.push({ o, x: centre.x, z: centre.z, distance: name.includes('shrubs') ? 110 : 80 });
    }
  }
  // Preserve unrelated forest variation after moving masonry to the shared corridor.
  for (let s = 8; s < 192; s += 0.52)
    for (let row = 0; row < 2; row++) for (let n = 0; n < 5; n++) rnd();
  // Thin the historical placement without shifting the surviving trees or the
  // random sequence used by other dressing: 120 distant trees and 60 western.
  const forestPoints = [];
  for (let i = 0; i < 380; i++) {
    let x, z;
    if (i < 240) {
      x = -150 + rnd() * 295;
      z = 220 + rnd() * 55;
    } else {
      x = -65 - rnd() * 45;
      z = 25 + rnd() * 200;
    }
    const height = 5 + rnd() * 10,
      y = terrainHeight(x, z),
      ry = rnd() * 6.28,
      rz = (rnd() - 0.5) * 0.08,
      tone = Math.floor(rnd() * 4);
    const keep = i < 240 ? i % 2 === 0 : (i - 240) % 7 < 3;
    if (keep) forestPoints.push({ x, y, z, height, ry, rz, width: 0.86 + tone * 0.07 });
  }
  // Village foundations and a low garden wall ground the houses in their sites.
  for (const [x, z, s] of [
    [-30, 73, 1.3],
    [-31, 94, 1.65],
    [-35, 121, 1.5],
    [-41, 163, 1.3],
  ]) {
    const y = terrainHeight(x, z);
    mesh(scene, new THREE.BoxGeometry(8 * s, 0.22, 8 * s), mat('#899079'), x, y - 0.05, z);
    for (let i = 0; i < 13; i++) {
      const px = x - 4 * s + i * 0.65 * s,
        pz = z - 4.4 * s;
      mesh(
        scene,
        new THREE.BoxGeometry(0.61 * s, 0.45, 0.38),
        mat(i % 3 ? '#92977e' : '#78836e'),
        px,
        terrainHeight(px, pz) + 0.18,
        pz,
      );
    }
    colliders.push({ x, z: z - 4.4 * s, radius: 0.45 });
  }
  return forestPoints;
}
