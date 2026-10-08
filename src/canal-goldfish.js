import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { assetUrl } from './asset-url.js';
import { roadFrame, terrainHeight } from './world-base.js';
import { canalOffset, waterLevel } from './canal-profile.js';

export const GOLDFISH_LAYOUT = Object.freeze(
  [14.6, 15.5, 16.4, 17.3, 18.2].map((station, i) => ({
    station,
    phase: i * 2.399,
    rate: 0.23 + i * 0.017,
    scale: 1.05 + (i % 3) * 0.13,
    redWhite: i === 1 || i === 4,
  })),
);

// Independent small territories keep full fish silhouettes apart, inside the deep central bed.
export function goldfishPose(layout, seconds) {
  const a = seconds * layout.rate + layout.phase;
  const s = layout.station + 0.29 * Math.sin(a),
    d = 0.19 * Math.cos(a) + 0.05 * Math.sin(a * 2 + layout.phase);
  const frame = roadFrame(s),
    offset = canalOffset(s) + d,
    x = frame.x + frame.nx * offset,
    z = frame.z + frame.nz * offset;
  return {
    x,
    z,
    y: terrainHeight(x, z) + waterLevel(s) - 0.082 + 0.006 * Math.sin(a * 1.3),
    station: s,
    lateral: d,
  };
}

export function createGoldfishController(source, night = { value: 0 }) {
  const root = new THREE.Group();
  root.name = 'Five swimming canal goldfish';
  let elapsed = 0;
  const axisZ = new THREE.Vector3(0, 0, 1),
    axisX = new THREE.Vector3(1, 0, 0);
  const fish = GOLDFISH_LAYOUT.map((layout, i) => {
    const object = clone(source);
    object.name = `Canal goldfish ${i + 1} ${layout.redWhite ? 'red white' : 'gold'}`;
    object.scale.setScalar(layout.scale);
    object.traverse((mesh) => {
      if (!mesh.isMesh) return;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // Tiny animated skins use a fixed, inexpensive draw budget.
      mesh.material = mesh.material.clone();
      mesh.material.side = THREE.DoubleSide;
      mesh.material.roughness = 0.7;
      mesh.material.onBeforeCompile = (shader) => {
        shader.uniforms.uFishNight = night;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uFishNight;')
          .replace(
            '#include <tonemapping_fragment>',
            '#include <tonemapping_fragment>\ngl_FragColor.rgb=mix(gl_FragColor.rgb,diffuseColor.rgb*.94,.8*(1.-uFishNight));',
          );
      };
      mesh.material.customProgramCacheKey = () => 'painted-aquatic-goldfish-v1';
      if (layout.redWhite) {
        mesh.geometry = mesh.geometry.clone();
        const color = mesh.geometry.attributes.color,
          position = mesh.geometry.attributes.position;
        for (let v = 0; v < color.count; v++) {
          // Preserve dark eyes, gills and eye highlights; repaint broad body and fin pigments.
          const r = color.getX(v),
            g = color.getY(v);
          if (r < 0.68 || g > 0.79) continue;
          const x = position.getX(v),
            y = position.getY(v),
            z = position.getZ(v),
            patch = Math.sin(z * 91 + x * 78) + Math.cos(y * 105 - z * 41);
          const c = patch > 0.15 ? [0.92, 0.12, 0.035] : [0.92, 0.86, 0.69];
          color.setXYZ(v, ...c);
        }
      }
    });
    const bones = {};
    for (const name of ['Body', 'Tail', 'Tail_Mid', 'Tail_Tip', 'Fin_L', 'Fin_R', 'Dorsal']) {
      const bone = object.getObjectByName(name);
      if (!bone?.isBone) throw new Error(`Missing goldfish bone: ${name}`);
      bones[name] = { bone, rest: bone.quaternion.clone() };
    }
    root.add(object);
    return { object, bones, layout };
  });
  // Blender bones use local Y along the bone. Local Z bends the tail sideways;
  // rotating around local Y would only twist the membrane along its length.
  function rotate(entry, angle, axis = axisZ) {
    entry.bone.quaternion
      .copy(entry.rest)
      .multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
  }
  function pose() {
    for (const { object, bones, layout } of fish) {
      const p = goldfishPose(layout, elapsed),
        next = goldfishPose(layout, elapsed + 0.02),
        wave = elapsed * 7.6 + layout.phase;
      object.position.set(p.x, p.y, p.z);
      object.rotation.set(0, Math.atan2(next.x - p.x, next.z - p.z), 0);
      rotate(bones.Body, Math.sin(wave) * 0.025);
      rotate(bones.Tail, Math.sin(wave - 0.3) * 0.16);
      rotate(bones.Tail_Mid, Math.sin(wave - 0.7) * 0.22);
      rotate(bones.Tail_Tip, Math.sin(wave - 1.1) * 0.27);
      rotate(bones.Fin_L, Math.sin(wave * 0.65) * 0.22, axisX);
      rotate(bones.Fin_R, -Math.sin(wave * 0.65 + 0.8) * 0.22, axisX);
      rotate(bones.Dorsal, Math.sin(wave - 0.4) * 0.07, axisX);
    }
    root.updateMatrixWorld(true);
  }
  pose();
  return {
    root,
    update(dt) {
      if (!(dt > 0)) return;
      elapsed += Math.min(dt, 0.1);
      pose();
    },
    snapshot: () => ({
      elapsed,
      fish: fish.map(({ object, bones }) => ({
        name: object.name,
        position: object.position.toArray(),
        heading: object.rotation.y,
        tailRotations: ['Tail', 'Tail_Mid', 'Tail_Tip'].map((name) =>
          bones[name].bone.quaternion.toArray(),
        ),
      })),
    }),
  };
}

export async function addCanalGoldfish(scene, warnings, night) {
  try {
    const gltf = await new GLTFLoader().loadAsync(assetUrl('canal-goldfish'));
    const controller = createGoldfishController(gltf.scene, night);
    scene.add(controller.root);
    return controller;
  } catch (error) {
    warnings.push('canal-goldfish');
    console.warn('Swimming goldfish could not be loaded.', error);
    return null;
  }
}
