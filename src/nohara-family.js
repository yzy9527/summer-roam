import { publishActors } from './loading/actor-publication.js';
import * as THREE from 'three';
import { createModelLoader } from './loading/model-loader.js';
import { assetUrl } from './asset-url.js';
import { NOHARA_HOUSE_SITE } from './nohara-house-site.js';
import { terrainHeight } from './world-base.js';
import { createShiroController } from './shiro-controller.js';

// Only Shiro remains active; retired human rigs are kept in local-archive/.
export async function addNoharaFamily(scene, colliders, warnings, { getPlayer } = {}) {
  const site = NOHARA_HOUSE_SITE;
  const z = site.z + 0.85;
  let shiro = null;
  try {
    const gltf = await createModelLoader().loadAsync(assetUrl('shiro'));
    const source = gltf.scene;
    source.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(source, true);
    const center = bounds.getCenter(new THREE.Vector3());
    source.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
    const actor = new THREE.Group();
    actor.name = '小白';
    actor.add(source);
    const x = site.x + site.width / 2 + 1.6;
    actor.position.set(x, terrainHeight(x, z), z);
    actor.rotation.y = Math.PI / 2;
    source.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      if (node.isSkinnedMesh) node.frustumCulled = false;
    });
    const collider = { x, z, radius: 0.4, height: bounds.max.y - bounds.min.y, character: 'shiro' };
    await publishActors({ scene, colliders, objects: [actor], footprints: [collider], getPlayer });
    shiro = { object: actor, source, collider, clips: gltf.animations };
  } catch (error) {
    warnings.push('shiro');
    console.warn('小白 model unavailable.', error);
  }
  const dog = shiro ? createShiroController(shiro, colliders) : null;
  if (dog) dog.state.collider.radius = dog.state.radius;
  return {
    player: null,
    dog,
    update(dt, focus, car) {
      dog?.update(dt, focus, car);
    },
    snapshot: () => ({
      playerAsset: null,
      player: null,
      shiro: dog?.snapshot(),
    }),
  };
}
