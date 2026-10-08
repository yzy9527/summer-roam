import { loadAnimalGeometry } from './animal-geometry.mjs';

import * as THREE from 'three';

import { ANIMAL_LAYOUT } from '../../src/field-animals.js';
import { ANIMAL_PROFILES } from '../../src/animal-profiles.js';
import { createAnimalAnimation } from '../../src/animal-animation.js';
import { createCowBehavior } from '../../src/cow-behavior.js';
import { createCowFamily } from '../../src/cow-family.js';
import { createBullCharge } from '../../src/bull-charge.js';
import { createAnimalEncounters } from '../../src/animal-encounters.js';
import { createAnimalInteractions } from '../../src/animal-interactions.js';
import { landscapeHeight } from '../../src/world-queries.js';

export async function interactionFixture(random = () => 0) {
  globalThis.ProgressEvent ??= class {
    constructor(type, values) {
      Object.assign(this, values);
    }
  };
  const animals = [];
  for (const config of ANIMAL_LAYOUT.filter((a) => a.id !== 'baola-leopard')) {
    const root = await loadAnimalGeometry(config.id);
    const box = new THREE.Box3().setFromObject(root, true),
      size = box.getSize(new THREE.Vector3()),
      center = box.getCenter(new THREE.Vector3()),
      group = new THREE.Group();
    root.position.set(-center.x, -box.min.y, -center.z);
    group.add(root);
    group.scale.setScalar(config.scale);
    group.position.set(config.x, landscapeHeight(config.x, config.z) + 0.025, config.z);
    group.rotation.y = -Math.PI / 2;
    const a = {
      ...config,
      homeX: config.x,
      homeZ: config.z,
      heading: -Math.PI / 2,
      radius: Math.max(0.7, (Math.hypot(size.x, size.z) * config.scale) / 2),
      group,
      clock: 0,
      distance: 0,
      velocity: 0,
      look: 0,
      taps: 0,
      wait: 0,
      behavior: createCowBehavior(ANIMAL_PROFILES[config.id].species),
    };
    a.collider = { x: a.x, z: a.z, radius: a.radius };
    a.rig = createAnimalAnimation(root, group, ANIMAL_PROFILES[a.id]);
    animals.push(a);
  }
  let now = 0,
    id = 0;
  const timers = new Map();
  const clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      timers.set(++id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  // Gate/ownership tests isolate coordination from path availability. Existing real-GLB
  // rollout tests separately enforce full meadow/scenery/car route constraints.
  const safe = () => true;
  const family = createCowFamily(animals, safe);
  const charge = createBullCharge(
    animals,
    safe,
    (hit) => charge.onImpact?.(hit),
    () => charge.onStopVoice?.(),
    clock,
  );
  const encounters = createAnimalEncounters(animals, safe, { family, charge }, random);
  const interactions = createAnimalInteractions({ animals, family, charge, encounters });
  let car = { x: -23, z: 7, heading: 0, speed: 0 };
  function tick(dt = 1 / 60) {
    now += dt * 1000;
    for (const [id, t] of [...timers])
      if (t.at <= now) {
        timers.delete(id);
        t.fn();
      }
    interactions.update(dt, car);
    for (const a of animals) {
      a.clock += dt;
      a.group.position.set(a.x, landscapeHeight(a.x, a.z) + 0.025, a.z);
      a.group.rotation.y = a.heading;
      a.rig.update(dt, a, 0, 0);
    }
  }
  return {
    animals,
    family,
    charge,
    encounters,
    interactions,
    tick,
    get car() {
      return car;
    },
    set car(value) {
      car = value;
    },
    animal: (id) => animals.find((a) => a.id === id),
  };
}
