import { assetUrl } from './asset-url.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { terrainHeight } from './world-base.js';

export const NOHARA_HOUSE = { x: -48, z: 200, rotation: Math.PI / 2, scale: 1 };
export function prepareNoharaHouse(root) {
  const bounds = new THREE.Box3().setFromObject(root, true),
    center = bounds.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  const group = new THREE.Group();
  group.name = 'Crayon Shin-chan Nohara house';
  group.add(root);
  group.rotation.y = NOHARA_HOUSE.rotation;
  group.scale.setScalar(NOHARA_HOUSE.scale);
  group.updateMatrixWorld(true);
  return group;
}
export async function addNoharaHouse(scene, colliders, warnings) {
  try {
    const root = (await new GLTFLoader().loadAsync(assetUrl('nohara-house'))).scene;
    const group = prepareNoharaHouse(root),
      bounds = new THREE.Box3().setFromObject(group, true),
      size = bounds.getSize(new THREE.Vector3());
    const { x, z } = NOHARA_HOUSE,
      width = size.x + 0.5,
      depth = size.z + 0.5;
    const level = terrainHeight(x, z),
      top = level - 0.025,
      bottom = top - 0.3;
    const foundation = new THREE.Mesh(
      new THREE.BoxGeometry(width, top - bottom, depth),
      new THREE.MeshStandardMaterial({ color: '#a09e89', roughness: 0.96 }),
    );
    foundation.name = 'Nohara house level foundation';
    foundation.position.set(x, (top + bottom) / 2, z);
    foundation.receiveShadow = true;
    foundation.castShadow = true;
    scene.add(foundation);
    group.position.set(x, level, z);
    group.traverse((n) => {
      if (n.isMesh) {
        n.castShadow = !n.material.transparent;
        n.receiveShadow = true;
      }
    });
    scene.add(group);
    // Cover the rectangular house with local collision circles so the entrance stays approachable.
    const columns = Math.ceil(width / 3.5),
      rows = Math.ceil(depth / 3.5),
      dx = width / columns,
      dz = depth / rows;
    for (let i = 0; i < columns; i++)
      for (let j = 0; j < rows; j++)
        colliders.push({
          x: x + (i + 0.5 - columns / 2) * dx,
          z: z + (j + 0.5 - rows / 2) * dz,
          radius: Math.hypot(dx, dz) / 2,
          height:
            level +
            size.y -
            terrainHeight(x + (i + 0.5 - columns / 2) * dx, z + (j + 0.5 - rows / 2) * dz),
        });
    const report = {
      ...NOHARA_HOUSE,
      size: size.toArray(),
      foundation: { width, depth, top, bottom, grassLevel: level, buried: true },
      colliders: columns * rows,
      front: '+X',
      asset: 'crayon_shin-chan_nohara_house.glb',
    };
    const audit = document.createElement('script');
    audit.id = 'nohara-house-audit';
    audit.type = 'application/json';
    audit.textContent = JSON.stringify(report);
    document.body.append(audit);
    return report;
  } catch (error) {
    warnings.push('nohara-house');
    console.warn('Nohara house unavailable.', error);
    return null;
  }
}
