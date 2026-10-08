import { assetUrl } from './asset-url.js';
import * as THREE from 'three';
import { terrainHeight } from './world-base.js';
const fade = (s) => Math.sin(Math.PI * Math.max(0, Math.min(1, (s - 12) / 2))) ** 2;
export async function loadCloseupTexture() {
  const map = await new THREE.TextureLoader().loadAsync(assetUrl('ground'));
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}
export function sampleWater() {
  const v = [],
    uv = [],
    idx = [],
    n = 80;
  for (let j = 0; j <= n; j++) {
    const z = 12 + (2 * j) / n;
    for (const side of [-1, 1]) {
      const width = 0.425 + 0.009 * fade(z) * Math.sin((z - 12) * 8 + side * 1.6);
      v.push(-4.6 + side * width, terrainHeight(-4.6, z) - 0.19, z);
      uv.push((side + 1) / 2, j / n);
    }
  }
  for (let j = 0; j < n; j++) {
    const a = j * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.MeshPhongMaterial({
    color: '#79b1b4',
    specular: '#bfcbc5',
    shininess: 45,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  m.name = '03 shallow water / static fine ripples';
  const o = new THREE.Mesh(g, m);
  o.name = '03 independent shallow water';
  o.receiveShadow = true;
  return o;
}
