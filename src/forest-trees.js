import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from './asset-url.js';

const LEVELS = ['near', 'mid', 'far'];
export const FOREST_ASSET_ID = 'anime-tree';
export const FOREST_LOD_DISTANCES = [28, 85];
let sourcePromise;

// Opaque curved leaves retain the approved model's tuft normals and COLOR_0.
// Its matte pigment responds to scene light, matching the roadside trees.
export function prepareForestLeaf(mesh) {
  if (!mesh.geometry.attributes.color || !mesh.geometry.attributes.normal)
    throw new Error('Anime foliage is missing pigment or tuft normals');
  const material = mesh.material.clone();
  material.transparent = false;
  material.opacity = 1;
  material.alphaTest = 0;
  material.side = THREE.DoubleSide;
  material.depthWrite = true;
  mesh.material = material;
}

export async function loadForestTreeAssets() {
  sourcePromise ??= new GLTFLoader()
    .loadAsync(assetUrl(FOREST_ASSET_ID))
    .then(({ scene }) => {
      scene.updateMatrixWorld(true);
      const variants = ['Anime'].map((name) => {
        const levels = LEVELS.map((level) => {
          const group = new THREE.Group();
          scene.traverse((o) => {
            if (!o.isMesh || !o.name.startsWith(`${name}_${level}_`)) return;
            const part = o.clone();
            part.geometry = o.geometry.clone();
            part.geometry.applyMatrix4(o.matrixWorld);
            part.position.set(0, 0, 0);
            part.quaternion.identity();
            part.scale.setScalar(1);
            if (part.name.includes('_leaf')) prepareForestLeaf(part);
            group.add(part);
          });
          if (group.children.length !== 2)
            throw new Error(`Missing forest parts: ${name}/${level}`);
          return group;
        });
        const bounds = new THREE.Box3().setFromObject(levels[0]);
        return { name, levels, height: bounds.max.y - bounds.min.y, base: bounds.min.y };
      });
      return variants;
    })
    .catch((error) => {
      sourcePromise = undefined;
      throw error;
    });
  return sourcePromise;
}

export function addForestTrees(scene, variants, points) {
  const records = points.map((p, i) => {
    const variant = i % variants.length,
      scale = p.height / variants[variant].height,
      dummy = new THREE.Object3D();
    dummy.position.set(p.x, p.y - variants[variant].base * scale, p.z);
    dummy.rotation.set(0, p.ry, p.rz);
    dummy.scale.set(scale * p.width, scale, scale * p.width);
    dummy.updateMatrix();
    return { ...p, variant, matrix: dummy.matrix.clone() };
  });
  const batches = variants.map((variant, v) => {
    const capacity = records.filter((p) => p.variant === v).length;
    return variant.levels.map((group, level) =>
      group.children.map((part) => {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, capacity);
        mesh.name = `Layered forest ${variant.name} ${LEVELS[level]} ${part.name.includes('_leaf') ? 'leaves' : 'wood'}`;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.castShadow = level < 2;
        mesh.receiveShadow = true;
        scene.add(mesh);
        return mesh;
      }),
    );
  });
  const last = new THREE.Vector3(Infinity, Infinity, Infinity);
  function update(position) {
    if (last.distanceToSquared(position) < 16) return;
    last.copy(position);
    const counts = variants.map(() => [0, 0, 0]);
    for (const p of records) {
      const distance = Math.hypot(position.x - p.x, position.z - p.z),
        level = distance < FOREST_LOD_DISTANCES[0] ? 0 : distance < FOREST_LOD_DISTANCES[1] ? 1 : 2,
        index = counts[p.variant][level]++;
      for (const mesh of batches[p.variant][level]) mesh.setMatrixAt(index, p.matrix);
    }
    batches.forEach((levels, v) =>
      levels.forEach((parts, l) =>
        parts.forEach((mesh) => {
          mesh.count = counts[v][l];
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.count) {
            mesh.computeBoundingBox();
            mesh.computeBoundingSphere();
          }
        }),
      ),
    );
  }
  update(new THREE.Vector3(0, 0, 0));
  // Inspection selects a western-edge tree to keep its silhouette unobstructed.
  const focus = records.filter((p) => p.z < 165 && p.z > 70).sort((a, b) => a.x - b.x)[0];
  return { update, focus, count: records.length, variants: variants.map((v) => v.name) };
}
