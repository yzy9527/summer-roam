import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from './asset-url.js';
import {
  MOUNTAIN_SITE,
  MOUNTAIN_BASE,
  mountainHeight,
  mountainWorld,
  mountainSupportHeight,
} from './mountain-profile.js';

export async function addFieldMountain(scene, colliders, warnings) {
  try {
    const root = (await new GLTFLoader().loadAsync(assetUrl('hokage-mountain'))).scene;
    root.name = 'Complete Hokage mountain';
    root.position.set(MOUNTAIN_SITE.x, MOUNTAIN_BASE, MOUNTAIN_SITE.z);
    root.rotation.y = MOUNTAIN_SITE.heading;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = o.receiveShadow = true;
      }
    });
    scene.add(root);
    // Conservative circles prevent driving into the mountain. Only the wolf's
    // checked trail controller may ignore these; ordinary animals still avoid it.
    for (let x = -16; x <= 18; x += 3.5)
      for (let z = -6; z <= 16; z += 3.5) {
        const p = mountainWorld(x, z);
        if ((mountainHeight(p.x, p.z) ?? 0) > 0.45)
          colliders.push({ ...p, radius: 2.3, height: 10, mountain: true });
      }
    for (let x = -12; x <= 12; x += 3.5)
      colliders.push({ ...mountainWorld(x, 0), radius: 2.3, height: 9.4, mountain: true });
    addFootGrass(scene);
    return root;
  } catch (error) {
    warnings.push('hokage-mountain');
    console.warn('Mountain unavailable:', error);
    return null;
  }
}

function addFootGrass(scene) {
  const positions = [],
    colors = [];
  let seed = 75031;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const sites = [
    [-13, -6],
    [-9, -5.4],
    [-4, -5.5],
    [5, -5],
    [11, -5],
    [14, -3],
    [17, 4],
    [-16, 1],
    [-16, 9],
    [6, 15],
    [-8, 14],
    [14, 11],
  ];
  for (const [x, z] of sites) {
    const p = mountainWorld(x, z);
    for (let i = 0; i < 38; i++) {
      const angle = rnd() * Math.PI * 2,
        r = Math.sqrt(rnd()) * 0.55;
      const bx = p.x + Math.cos(angle) * r,
        bz = p.z + Math.sin(angle) * r;
      const y = mountainSupportHeight(bx, bz) + 0.015,
        h = 0.18 + rnd() * 0.26;
      const w = 0.035 + rnd() * 0.04,
        lean = 0.09 + rnd() * 0.1;
      const dx = Math.cos(angle),
        dz = Math.sin(angle);
      const color = new THREE.Color().setHSL(
        0.22 + rnd() * 0.05,
        0.34 + rnd() * 0.15,
        0.25 + rnd() * 0.12,
      );
      const vertices = [
        [bx - dz * w, y, bz + dx * w],
        [bx + dz * w, y, bz - dx * w],
        [bx + dx * lean * 0.45 - dz * w * 0.3, y + h * 0.65, bz + dz * lean * 0.45 + dx * w * 0.3],
        [bx + dx * lean * 0.45 + dz * w * 0.3, y + h * 0.65, bz + dz * lean * 0.45 - dx * w * 0.3],
        [bx + dx * lean, y + h, bz + dz * lean],
      ];
      for (const index of [0, 1, 2, 1, 3, 2, 2, 3, 4]) {
        positions.push(...vertices[index]);
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const grass = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 }),
  );
  grass.name = 'Mountain foot grass tufts';
  grass.receiveShadow = true;
  scene.add(grass);
}
