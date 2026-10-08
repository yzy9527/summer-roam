import * as THREE from 'three';
import { createModelLoader } from './loading/model-loader.js';
import { assetUrl } from './asset-url.js';
import { drivingHeight } from './world-queries.js';

export const CAMPSITE = Object.freeze({ x: 156.5, z: 24, height: 2.1 });

export function createCampsiteCookingSet(gltf, colliders, ground = drivingHeight) {
  const source = gltf.scene;
  const clip = gltf.animations.find((a) => a.name === 'Campfire_Simmer_Loop');
  if (!clip) throw new Error('Campsite cooking set is missing its simmer animation');
  const bounds = new THREE.Box3().setFromObject(source, true);
  const size = bounds.getSize(new THREE.Vector3());
  if (!(size.y > 0)) throw new Error('Campsite cooking set has empty bounds');
  const root = new THREE.Group();
  root.name = 'Zombie campsite cooking fire';
  const scale = CAMPSITE.height / size.y;
  // Keep the source's fire center and all animation target transforms intact.
  const model = new THREE.Group();
  model.scale.setScalar(scale);
  model.position.y = -bounds.min.y * scale;
  model.add(source);
  root.add(model);
  root.position.set(CAMPSITE.x, ground(CAMPSITE.x, CAMPSITE.z), CAMPSITE.z);
  source.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = node.receiveShadow = true;
  });
  const light = new THREE.PointLight('#ffab50', 3, 7, 2);
  light.name = 'Cooking fire glow';
  light.position.set(0, 0.45, 0);
  root.add(light);
  const mixer = new THREE.AnimationMixer(source);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopRepeat, Infinity).play();
  mixer.update(0);
  const collider = {
    x: CAMPSITE.x,
    z: CAMPSITE.z,
    radius:
      Math.hypot(
        Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)),
        Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)),
      ) * scale,
    height: CAMPSITE.height,
    campsite: true,
  };
  colliders.push(collider);
  let elapsed = 0;
  return {
    root,
    update(dt) {
      if (!(dt > 0)) return;
      elapsed += dt;
      mixer.update(dt);
      light.intensity = 3 * (1 + 0.07 * Math.sin(elapsed * 8.3) + 0.04 * Math.sin(elapsed * 13.7));
    },
    snapshot: () => ({
      asset: 'campsite-cooking-set',
      position: root.position.toArray(),
      scale,
      height: CAMPSITE.height,
      radius: collider.radius,
      elapsed,
      animation: clip.name,
      animationTime: action.time,
      duration: clip.duration,
      lightIntensity: light.intensity,
    }),
  };
}

export async function addCampsiteCookingSet(scene, colliders, warnings) {
  try {
    const gltf = await createModelLoader().loadAsync(assetUrl('campsite-cooking-set'));
    const controller = createCampsiteCookingSet(gltf, colliders);
    scene.add(controller.root);
    return controller;
  } catch (error) {
    warnings.push('campsite-cooking-set');
    console.warn('Animated campsite cooking set could not be loaded.', error);
    return null;
  }
}
