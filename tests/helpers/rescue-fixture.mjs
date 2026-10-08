import { loadModel } from './model-loader.mjs';

import * as THREE from 'three';

import { interactionFixture } from './interaction-fixture.mjs';
import { createZombieController } from '../../src/field-zombies.js';
import { createCrewCart } from '../../src/zombie-crew-cart.js';
import { createZombieCorral } from '../../src/zombie-corral.js';
import { createZombieCalfRescue } from '../../src/zombie-calf-rescue.js';
import { createZombieCalfHeist } from '../../src/zombie-calf-heist.js';
import { landscapeHeight } from '../../src/world-queries.js';

export async function rescueFixture(
  random = () => 0.9,
  { withHeist = false, withFlag = false } = {},
) {
  const f = await interactionFixture(() => 0.9),
    scene = new THREE.Scene(),
    colliders = f.animals.map((a) => a.collider);
  for (const a of f.animals) {
    scene.add(a.group);
    a.source = a.group.children[0];
    a.bindPose = [];
    a.source.traverse((n) => {
      if (n.isBone)
        a.bindPose.push({ bone: n, rotation: n.quaternion.clone(), position: n.position.clone() });
    });
    a.supportHeight = landscapeHeight;
  }
  const load = (path) => loadModel('models/' + path);
  const sources = new Map();
  for (const id of [
    'pvz-browncoat',
    'pvz-conehead',
    'pvz-gargantuar',
    ...(withFlag ? ['pvz-flagbearer'] : []),
  ])
    sources.set(id, await load(`pvz-zombies/${id}.glb`));
  const zombies = createZombieController(sources, colliders);
  zombies.addGatekeeper();
  scene.add(zombies.root);
  const giant = zombies.actor('pvz-gargantuar');
  giant.collider.radius = 1.05;
  const cart = createCrewCart(await load('zombie-crew-cart.glb'), zombies, colliders);
  scene.add(cart.root);
  const corral = createZombieCorral(scene, colliders, cart, zombies, {
    externalDelivery: true,
    guard: 'pvz-gatekeeper',
    gateSide: 'right',
    random,
    gateRandom: () => 0.9,
  });
  let rearmed = 0;
  const fieldAnimals = {
    animal: f.animal,
    interactions: f.interactions,
    transportAvailable: (id) => f.interactions.canReserveTransport(f.animal(id)),
    reserveTransport: (id) => (f.interactions.reserveTransport(f.animal(id)) ? f.animal(id) : null),
    releaseTransport: (id) => f.interactions.releaseTransport(f.animal(id)),
  };
  const heist = withHeist
    ? createZombieCalfHeist(scene, colliders, cart, zombies, fieldAnimals, corral, {
        ground: landscapeHeight,
      })
    : { snapshot: () => ({ phase: 'complete' }), rearm: () => rearmed++ };
  const rescue = createZombieCalfRescue(scene, colliders, zombies, fieldAnimals, corral, heist, {
    random,
    ground: landscapeHeight,
  });
  const car = { x: 132, z: 10, heading: 0, speed: 0 };
  const events = [];
  rescue.connectAudio((e) => events.push(e));
  corral.connectAudio((e) => events.push(e));
  function place(a, x, z, heading = 0) {
    a.x = x;
    a.z = z;
    a.heading = heading;
    a.target = null;
    a.wait = 600;
    a.group.position.set(x, landscapeHeight(x, z) + 0.025, z);
    a.group.rotation.set(0, heading, 0, 'YXZ');
    Object.assign(a.collider, { x, z });
    a.group.updateMatrixWorld(true);
  }
  function placeGiant(x, z, heading = 0) {
    giant.object.position.set(x, landscapeHeight(x, z), z);
    giant.object.rotation.set(0, heading, 0, 'YXZ');
    Object.assign(giant.collider, { x, z });
    zombies.rebind('pvz-gargantuar');
    zombies.release('pvz-gargantuar');
  }
  place(f.animal('golden-cow'), -20, 15);
  place(f.animal('reference-wolf'), -34, 15);
  place(f.animal('copper-cow'), -33, 25);
  function escaping(x = -26, z = -3, end = { x: -26, z: 5 }) {
    const calf = f.animal('hornless-calf');
    place(calf, x, z, Math.atan2(end.x - x, end.z - z));
    corral.finishDelivery(calf);
    Object.assign(calf, {
      mode: 'escaping',
      outside: true,
      escapeEpoch: 1,
      route: [{ ...end }],
      routeGoal: 'home',
      home: end,
      cryIn: 0,
    });
    return calf;
  }
  function reportEscape(target) {
    const actor = zombies.actor('pvz-browncoat');
    const x = target.x + 4,
      z = target.z + 4;
    actor.object.position.set(x, landscapeHeight(x, z), z);
    actor.object.rotation.set(0, Math.atan2(target.x - x, target.z - z), 0, 'YXZ');
    Object.assign(actor.collider, { x, z });
    zombies.rebind(actor.layout.id);
    actor.rig.update(0.01, 0, landscapeHeight);
    zombies.release(actor.layout.id);
    rescue.update(0.05, car);
    return actor;
  }
  function tick(dt = 0.05) {
    f.interactions.update(dt, car, 'day', dt);
    zombies.update(dt, car);
    corral.update(dt, car, dt, 'day');
    if (withHeist) heist.update(dt, car);
    rescue.update(dt, car);
  }
  return {
    ...f,
    scene,
    load,
    fieldAnimals,
    colliders,
    zombies,
    giant,
    cart,
    corral,
    rescue,
    heist,
    car,
    events,
    tick,
    place,
    placeGiant,
    escaping,
    reportEscape,
    rearmed: () => rearmed,
  };
}
