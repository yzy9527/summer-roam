import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from '../../src/asset-url.js';
import { addFieldAnimals } from '../../src/field-animals.js';
import { createZombieController } from '../../src/field-zombies.js';
import { createCrewCart } from '../../src/zombie-crew-cart.js';
import { createZombieCorral } from '../../src/zombie-corral.js';
import { createLeopardMilkVisit } from '../../src/gameplay/milk/visit.js';
import { createGameplayTick } from '../../src/gameplay/tick.js';
import { landscapeHeight } from '../../src/world-queries.js';
import { loadAnimalGeometry } from './animal-geometry.mjs';
import { loadModel } from './model-loader.mjs';

export async function milkFixture() {
  const scene = new THREE.Scene(),
    colliders = [],
    warnings = [];
  const previous = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async (url) => {
    const id = [
      'golden-cow',
      'copper-cow',
      'hornless-calf',
      'reference-wolf',
      'baola-leopard',
    ].find((id) => url === assetUrl(id));
    assert(id, url);
    return { scene: await loadAnimalGeometry(id) };
  };
  let animals;
  try {
    animals = await addFieldAnimals(scene, colliders, warnings);
  } finally {
    GLTFLoader.prototype.loadAsync = previous;
  }
  assert.deepEqual(warnings, []);
  const sources = new Map();
  for (const id of ['pvz-browncoat', 'pvz-conehead', 'pvz-gargantuar'])
    sources.set(id, await loadModel(`models/pvz-zombies/${id}.glb`));
  const zombies = createZombieController(sources, colliders);
  zombies.addGatekeeper();
  scene.add(zombies.root);
  const cart = createCrewCart(await loadModel('models/zombie-crew-cart.glb'), zombies, colliders);
  scene.add(cart.root);
  const corral = createZombieCorral(scene, colliders, cart, zombies, {
    guard: 'pvz-gatekeeper',
    gateSide: 'right',
    random: () => 0.9,
    gateRandom: () => 0.9,
  });
  // Offline fixed-dt tests use a deterministic work budget, not the host CPU's
  // load. Real browser verification measures the production 1.25ms clock budget.
  const milk = createLeopardMilkVisit(scene, colliders, animals, corral, {
    navigationOptions: { now: () => 0 },
  });
  const car = { x: 132, z: 10, speed: 0, heading: 0 };
  const tick = createGameplayTick({ animals, zombies, corral, cart, milk });
  const step = (dt = 1 / 60, mode = 'day') => tick({ dt, player: car, timeOfDay: mode });
  const calf = animals.animal('hornless-calf'),
    leopard = animals.animal('baola-leopard');
  const place = (a, x, z, heading = 0) => {
    Object.assign(a, { x, z, heading, target: null, wait: 600, velocity: 0, motion: 0 });
    a.group.position.set(x, landscapeHeight(x, z) + 0.025, z);
    a.group.rotation.set(0, heading, 0, 'YXZ');
    Object.assign(a.collider, { x, z });
    a.group.updateMatrixWorld(true);
  };
  const confine = () => {
    assert(animals.interactions.reserveTransport(calf));
    place(calf, 162, 24);
    corral.finishDelivery(calf);
  };
  return {
    scene,
    colliders,
    animals,
    zombies,
    corral,
    milk,
    car,
    calf,
    leopard,
    step,
    place,
    confine,
  };
}
