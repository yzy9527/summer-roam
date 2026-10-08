import * as THREE from 'three';
import { VEHICLE_CONFIG } from './vehicle-config.js';

export function createVehicleLightControl() {
  let mode = 'off',
    remembered = 'low',
    timeOfDay = 'day';
  return {
    select(next) {
      if (!['off', 'low', 'high'].includes(next)) return;
      mode = next;
      if (next !== 'off') remembered = next;
    },
    toggle() {
      this.select(mode === 'off' ? remembered : 'off');
    },
    toggleBeam() {
      if (mode === 'off') return false;
      this.select(mode === 'low' ? 'high' : 'low');
      return true;
    },
    setTimeOfDay(next) {
      if (!['day', 'night'].includes(next) || next === timeOfDay) return;
      timeOfDay = next;
      this.select(next === 'night' ? 'low' : 'off');
    },
    snapshot: () => ({ mode, remembered, timeOfDay }),
  };
}

const HEADLIGHT_BEAMS = Object.freeze({
  low: { distance: 28, angle: 0.48, intensity: 180, aimDistance: 18, aimHeight: -0.1 },
  high: { distance: 65, angle: 0.27, intensity: 1000, aimDistance: 55, aimHeight: 0.4 },
});

// Attach after assembly: the whole rig follows slopes, steering and vehicle impacts.
export function createVehicleLights(car, body) {
  const rig = new THREE.Group();
  rig.name = 'Vehicle headlights';
  car.add(rig);
  const scale = VEHICLE_CONFIG.modelScale;
  const lenses = new Map(),
    originals = new Map();
  let lensCount = 0;
  body.traverse((node) => {
    if (!node.isMesh) return;
    const source = Array.isArray(node.material) ? node.material : [node.material];
    const materials = source.map((material) => {
      const front = material.name === 'Headlight glass',
        rear = material.name === 'Red rear lenses';
      if (!front && !rear) return material;
      lensCount++;
      if (!lenses.has(material))
        lenses.set(material, {
          material: material.clone(),
          front,
          color: material.emissive.clone(),
          intensity: material.emissiveIntensity,
        });
      return lenses.get(material).material;
    });
    if (!materials.some((material, index) => material !== source[index])) return;
    originals.set(node, node.material);
    node.material = Array.isArray(node.material) ? materials : materials[0];
  });
  // The two lamps overlap at driving distances. One combined beam preserves
  // occlusion without rendering this dense countryside into two shadow maps.
  const light = new THREE.SpotLight('#fff1d6', 0);
  light.position.set(0, 0.855 * scale, 1.83 * scale);
  light.penumbra = 0.65;
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.camera.near = 0.1;
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.025;
  const target = new THREE.Object3D();
  light.target = target;
  rig.add(light, target);
  let mode = null;
  function setMode(next) {
    if (!['off', 'low', 'high'].includes(next) || mode === next) return;
    mode = next;
    const beam = HEADLIGHT_BEAMS[next];
    light.visible = !!beam;
    light.intensity = beam ? beam.intensity * 2 : 0;
    if (beam) {
      light.distance = beam.distance;
      light.angle = beam.angle;
      light.target.position.set(0, beam.aimHeight, beam.aimDistance);
    }
    for (const lens of lenses.values()) {
      lens.material.emissive.copy(lens.color);
      lens.material.emissiveIntensity = lens.intensity;
      if (beam) {
        lens.material.emissive.set(lens.front ? '#fff1d6' : '#ff2420');
        lens.material.emissiveIntensity = lens.front ? (next === 'high' ? 3 : 1.8) : 0.8;
      }
    }
  }
  setMode('off');
  return {
    setMode,
    snapshot: () => ({ mode, lights: 1, lenses: lensCount, shadows: light.castShadow }),
    dispose() {
      car.remove(rig);
      light.dispose();
      for (const [node, material] of originals) node.material = material;
      for (const lens of lenses.values()) lens.material.dispose();
      originals.clear();
      lenses.clear();
    },
  };
}
