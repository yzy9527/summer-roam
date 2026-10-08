import * as THREE from 'three';
import { roadPoint } from './world-base.js';
import { paddyLayout } from './paddy-profile.js';
import { roundedPaddyBankGeometry as paddyBankGeometry } from './paddy-geometry.js';
export { roundedPaddyBankGeometry as paddyBankGeometry } from './paddy-geometry.js';
export function addPaddyBanks(scene, cull, { prototype = false } = {}) {
  const fields = paddyLayout(roadPoint).filter((p) => !prototype || (p.col === 0 && p.row < 2));
  for (const p of fields) {
    const soil = new THREE.Mesh(
      paddyBankGeometry(p),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
    );
    soil.name = 'Rounded paddy berm ' + p.row + ' ' + p.col;
    soil.receiveShadow = true;
    scene.add(soil);
  }
  const report = {
    fields: fields.length,
    shortGrassInstances: 0,
    roundedOutline: true,
    grassHeight: [0, 0],
    edgeHeight: [0.084, 0.1],
    actualGround: true,
    noGrassShadow: true,
  };
  if (typeof document !== 'undefined') {
    const e = document.createElement('script');
    e.id = 'paddy-banks-audit';
    e.type = 'application/json';
    e.textContent = JSON.stringify(report);
    document.body.append(e);
  }
  return report;
}
