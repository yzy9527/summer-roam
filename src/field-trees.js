import { leafLOD } from './tree-leaf.js';
export { leafLOD } from './tree-leaf.js';
import * as THREE from 'three';
import { loadSampleTree } from './assets/trees/sample-tree-02/load-tree.js';
export const FIELD_TREE_REFERENCE_HEIGHT = 6.369708925485611;
export function normalizeFieldTree(root) {
  const bounds = new THREE.Box3().setFromObject(root, true),
    factor = FIELD_TREE_REFERENCE_HEIGHT / bounds.getSize(new THREE.Vector3()).y;
  root.scale.multiplyScalar(factor);
  root.updateMatrixWorld(true);
  root.position.y -= new THREE.Box3().setFromObject(root, true).min.y;
  root.updateMatrixWorld(true);
  return factor;
}

// Distant wood keeps connected surfaces via vertex clustering, not missing triangles.
function woodLOD(source, cell) {
  const points = [],
    uvs = [],
    counts = [],
    bins = new Map(),
    remap = [],
    p = source.attributes.position,
    uv = source.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const xyz = [p.getX(i), p.getY(i), p.getZ(i)],
      key = xyz.map((v) => Math.round(v / cell)).join(',');
    let id = bins.get(key);
    if (id === undefined) {
      id = points.length;
      bins.set(key, id);
      points.push([0, 0, 0]);
      uvs.push([0, 0]);
      counts.push(0);
    }
    xyz.forEach((v, k) => (points[id][k] += v));
    if (uv) {
      uvs[id][0] += uv.getX(i);
      uvs[id][1] += uv.getY(i);
    }
    counts[id]++;
    remap.push(id);
  }
  const faces = [],
    seen = new Set();
  for (let i = 0; i < source.index.count; i += 3) {
    const tri = [0, 1, 2].map((k) => remap[source.index.getX(i + k)]);
    if (new Set(tri).size < 3) continue;
    const key = tri
      .slice()
      .sort((a, b) => a - b)
      .join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push(...tri);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      points.flatMap((v, i) => v.map((n) => n / counts[i])),
      3,
    ),
  );
  if (uv)
    g.setAttribute(
      'uv',
      new THREE.Float32BufferAttribute(
        uvs.flatMap((v, i) => v.map((n) => n / counts[i])),
        2,
      ),
    );
  g.setIndex(faces);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
function instanceLeafMaterial(source) {
  const m = source.clone(),
    hook = source.onBeforeCompile;
  m.onBeforeCompile = (s) => {
    hook(s);
    s.vertexShader = s.vertexShader.replace(
      'vCanopyViewNormal = normalMatrix * canopyNormal;',
      `vec3 treeNormal=canopyNormal;\n#ifdef USE_INSTANCING\ntreeNormal=mat3(instanceMatrix)*treeNormal;\n#endif\nvCanopyViewNormal=normalMatrix*treeNormal;`,
    );
  };
  m.customProgramCacheKey = () => source.customProgramCacheKey() + '-instance-normal';
  return m;
}
export async function loadFieldTreeAssets() {
  const approved = await loadSampleTree(),
    root = approved.levels[0].object;
  normalizeFieldTree(root);
  const parts = [];
  root.traverse((o) => {
    if (o.isMesh) {
      const leaf = o.name.includes('leaf');
      parts.push({
        source: o,
        leaf,
        mid: leaf ? leafLOD(o.geometry, 7) : woodLOD(o.geometry, 0.055),
        far: leaf ? leafLOD(o.geometry, 60) : woodLOD(o.geometry, 0.14),
      });
    }
  });
  function simplified(level) {
    const group = new THREE.Group();
    for (const p of parts) {
      const mesh = new THREE.Mesh(p[level], p.source.material);
      mesh.matrix.copy(p.source.matrixWorld);
      mesh.matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.castShadow = level === 'mid';
      mesh.receiveShadow = level === 'mid';
      group.add(mesh);
    }
    return group;
  }
  function create() {
    const lod = new THREE.LOD();
    lod.name = 'Unified_directional_tree';
    lod.addLevel(root.clone(true), 0);
    lod.addLevel(simplified('mid'), 45, 0.12);
    lod.addLevel(simplified('far'), 125, 0.15);
    return lod;
  }
  function belt(scene, points) {
    for (const p of parts) {
      const g = p.far.clone();
      g.applyMatrix4(p.source.matrixWorld);
      const field = g.getAttribute('canopyNormal');
      if (p.leaf && field) {
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(p.source.matrixWorld),
          values = [];
        for (let i = 0; i < field.count; i++) {
          const v = new THREE.Vector3()
            .fromBufferAttribute(field, i)
            .applyMatrix3(normalMatrix)
            .normalize();
          values.push(v.x, v.y, v.z);
        }
        g.setAttribute('canopyNormal', new THREE.Float32BufferAttribute(values, 3));
      }
      const m = p.leaf ? instanceLeafMaterial(p.source.material) : p.source.material,
        o = new THREE.InstancedMesh(g, m, points.length),
        dummy = new THREE.Object3D();
      points.forEach((pt, i) => {
        dummy.position.set(pt.x, pt.y, pt.z);
        dummy.rotation.y = pt.ry;
        dummy.scale.setScalar(pt.scale);
        dummy.updateMatrix();
        o.setMatrixAt(i, dummy.matrix);
      });
      o.name = 'Approved_Tree_Distant_Belt';
      o.castShadow = false;
      o.receiveShadow = false;
      o.computeBoundingSphere();
      scene.add(o);
    }
  }
  const stats = parts.map((p) => ({
    name: p.source.name,
    full: p.source.geometry.index.count / 3,
    mid: p.mid.index.count / 3,
    far: p.far.index.count / 3,
  }));
  return { create, belt, stats, referenceHeight: FIELD_TREE_REFERENCE_HEIGHT };
}
