import * as THREE from 'three';
import { ANIMAL_PROFILES } from '../../src/animal-profiles.js';
import { createAnimalAnimation } from '../../src/animal-animation.js';
import { createCowBehavior } from '../../src/cow-behavior.js';
import { drivingHeight } from '../../src/world-queries.js';
import { claimAnimal } from '../../src/gameplay/animal-ownership.js';
export function createCorralAnimal(cargo, id = 'copper-cow', ground = drivingHeight) {
  const profile = ANIMAL_PROFILES[id];
  if (!profile) throw new Error('Unsupported corral animal: ' + id);
  const group = cargo.group;
  // attach() preserves the full quaternion. XYZ Euler angles can express a
  // half-turn as X/Z flips with a small Y value; reading only Y reverses the cow.
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion);
  const heading = Math.atan2(forward.x, forward.z);
  group.rotation.set(0, heading, 0, 'YXZ');
  group.updateMatrixWorld(true);
  const a = {
    id,
    instanceId: 'transported-' + id,
    group,
    source: cargo.source,
    scale: group.scale.x,
    x: group.position.x,
    z: group.position.z,
    heading,
    radius: id === 'hornless-calf' ? 0.9 : 1.16,
    speed: id === 'hornless-calf' ? 0.42 : 0.3,
    clock: 0,
    distance: 0,
    velocity: 0,
    motion: 0,
    look: 0,
    taps: 0,
    target: null,
    wait: 1,
    behavior: createCowBehavior(profile.species),
    chargeRun: 0,
    chargePose: 0,
    mode: 'unloading',
    route: [],
    cryIn: 0,
    supportHeight: ground,
  };
  a.rig = createAnimalAnimation(a.source, group, profile);
  if (!a.rig) throw new Error('Transported animal needs a real skinned rig');
  a.collider = { x: a.x, z: a.z, radius: a.radius, height: 1.8, corralAnimal: true };
  return a;
}

export function receiveCorralCargo(
  corral,
  cargo,
  colliders,
  id = 'copper-cow',
  ground = drivingHeight,
) {
  const animal = createCorralAnimal(cargo, id, ground);
  claimAnimal(animal, 'corral');
  corral.animals.push(animal);
  colliders.push(animal.collider);
  return animal;
}
