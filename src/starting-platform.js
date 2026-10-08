import * as THREE from 'three';
import { STARTING_PLATFORM as P } from './road-network.js';
import { drivingHeight } from './world-queries.js';

export function createStartingPlatform(asphalt) {
  const geometry = new THREE.CircleGeometry(P.radius, 96);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position,
    uv = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i) + P.x,
      z = positions.getZ(i) + P.z;
    positions.setXYZ(i, x, drivingHeight(x, z) + 0.035, z);
    uv.setXY(i, x * 0.23, z * 0.23);
  }
  geometry.computeVertexNormals();
  // Match the road surface while avoiding flicker where the platform overlaps it.
  const material = asphalt.clone();
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  const platform = new THREE.Mesh(geometry, material);
  platform.name = 'Starting platform';
  platform.receiveShadow = true;
  return platform;
}
