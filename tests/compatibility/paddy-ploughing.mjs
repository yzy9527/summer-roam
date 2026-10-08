import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from '../../src/asset-url.js';
import { createPaddyPloughing } from '../../src/paddy-ploughing.js';
const missingRig = '缺少旗手或完整耕牛骨骼';
export async function addPaddyPloughing(scene, colliders, zombies, warnings, animals) {
  const leader = zombies?.actor('pvz-flagbearer');
  if (!leader) return null;
  const home = {
    position: leader.object.position.clone(),
    heading: leader.object.rotation.y,
    scripted: leader.scripted,
    collider: { ...leader.collider },
  };
  try {
    // Clone the loaded skin, sharing geometry/textures with the meadow instance.
    // Parsing the same 14 MiB cow a second time delays the start screen.
    const cow = animals?.modelSource('golden-cow');
    if (!cow) throw new Error(missingRig);
    const plough = await new GLTFLoader().loadAsync(assetUrl('paddy-plough'));
    return createPaddyPloughing(scene, colliders, zombies, cow, {
      ploughSource: plough.scene,
    });
  } catch (error) {
    // Do not leave a static cow or a half-initialized worker after a rig/load
    // failure. Restore the original flagbearer's patrol and collision state.
    scene.getObjectByName('僵尸牵牛犁田队伍')?.removeFromParent();
    zombies.removePloughman();
    for (let i = colliders.length - 1; i >= 0; i--)
      if (colliders[i].ploughing && colliders[i] !== leader.collider) colliders.splice(i, 1);
    leader.object.position.copy(home.position);
    leader.object.rotation.y = home.heading;
    leader.scripted = home.scripted;
    delete leader.collider.ploughing;
    Object.assign(leader.collider, home.collider);
    zombies.rebind(leader.layout.id);
    warnings.push('paddy-ploughing');
    console.warn('耕田队伍未能加载完整模型', error);
    return null;
  }
}
