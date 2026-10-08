import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyLeafMaterial, leafLOD } from '../../../tree-leaf.js';
import { assetUrl } from '../../../asset-url.js';
let sourcePromise;
export async function loadSampleTree() {
  sourcePromise ??= new GLTFLoader()
    .loadAsync(assetUrl('sample-tree-02'))
    .then(({ scene: root }) => {
      root.name = 'Sample directional summer tree';
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.receiveShadow = true;
        if (!o.name.includes('leaf')) return;
        const p = o.geometry.attributes.position,
          n = [];
        for (let i = 0; i < p.count; i++) {
          const v = new THREE.Vector3(
            p.getX(i) / 5.2,
            (p.getY(i) - 7.45) / 3.0,
            p.getZ(i) / 3.9,
          ).normalize();
          n.push(v.x, v.y, v.z);
        }
        o.geometry.setAttribute('canopyNormal', new THREE.Float32BufferAttribute(n, 3));
        applyLeafMaterial(o.material, { normalMix: 0.82, shadowFloor: 0.3 });
      });
      return root;
    })
    .catch((error) => {
      sourcePromise = undefined;
      throw error;
    });
  const root = (await sourcePromise).clone(true);
  const lod = new THREE.LOD();
  lod.name = root.name;
  lod.addLevel(root, 0);
  for (const [distance, stride] of [
    [48, 2],
    [100, 5],
  ]) {
    const group = root.clone(true);
    group.traverse((o) => {
      if (o.isMesh && o.name.includes('leaf')) o.geometry = leafLOD(o.geometry, stride);
    });
    lod.addLevel(group, distance, 0.16);
  }
  return lod;
}
