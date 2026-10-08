import { roadFrame } from './world-base.js';
import { fieldGroundHeight } from './field-landscape.js';
// Soil, stone roots and camera/vehicle ground now share one physical channel profile.
export function samplePlantHeight(s, d) {
  const f = roadFrame(s);
  return fieldGroundHeight(f.x + f.nx * d, f.z + f.nz * d);
}
export function addSampleBank() {
  return null;
}
