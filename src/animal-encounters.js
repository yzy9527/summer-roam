import { ANIMAL_MEADOW } from './animal-meadow.js';
const angle = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
// Both actors are held while approaching; route edges retain scenery/car clearance.
export function encounterRoute(a, goal, clearPoint, bounds = ANIMAL_MEADOW) {
  const clear = (p, q) => {
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.15));
    for (let i = 0; i <= n; i++)
      if (!clearPoint(p.x + ((q.x - p.x) * i) / n, p.z + ((q.z - p.z) * i) / n)) return false;
    return true;
  };
  const start = { x: a.x, z: a.z };
  if (clear(start, goal)) return [goal];
  const nodes = [start, goal];
  for (let x = bounds.minX; x <= bounds.maxX; x += 0.6)
    for (let z = bounds.minZ; z <= bounds.maxZ; z += 0.6)
      if (clearPoint(x, z)) nodes.push({ x, z });
  const costs = nodes.map(() => Infinity),
    prev = [],
    open = new Set([0]);
  costs[0] = 0;
  while (open.size) {
    let best = -1,
      value = Infinity;
    for (const i of open) {
      const score = costs[i] + Math.hypot(nodes[i].x - goal.x, nodes[i].z - goal.z);
      if (score < value) {
        best = i;
        value = score;
      }
    }
    if (best === 1) {
      const path = [];
      for (let i = 1; i !== 0; i = prev[i]) path.unshift(nodes[i]);
      return path;
    }
    open.delete(best);
    for (let j = 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[j].x - nodes[best].x, nodes[j].z - nodes[best].z);
      if (d > 1.1 && j !== 1) continue;
      if (costs[best] + d >= costs[j] || !clear(nodes[best], nodes[j])) continue;
      costs[j] = costs[best] + d;
      prev[j] = best;
      open.add(j);
    }
  }
  return null;
}
export function createAnimalEncounters(animals, safe, { family, charge }) {
  const wolf = animals.find((a) => a.id === 'reference-wolf'),
    calf = animals.find((a) => a.id === 'hornless-calf'),
    bull = animals.find((a) => a.id === 'copper-cow'),
    mother = animals.find((a) => a.id === 'golden-cow'),
    pair = [wolf, calf];
  let phase = 'idle',
    elapsed = 0,
    cooldown = 0,
    path = [],
    reason = '',
    bites = 0,
    talking = false,
    talkingBite = false,
    lastCar = null,
    chasePlan = 0;
  function settle(a) {
    a.target = null;
    a.velocity = 0;
    a.wait = 2;
    a.homeX = a.x;
    a.homeZ = a.z;
    delete a.familyLook;
    delete a.bitePose;
    a.chargeRun = 0;
    Object.assign(a.behavior, {
      state: 'idle',
      time: 0,
      escape: null,
      driveTime: 0,
      down: 0,
      raised: 0,
    });
  }
  function cancel(why = 'cancelled') {
    if (phase !== 'idle') {
      const held = [wolf, calf, mother].filter((a) => a && api.owns(a));
      phase = 'idle';
      reason = why;
      cooldown = 10;
      for (const a of held) {
        settle(a);
        a.familySeparation = true;
      }
    }
  }
  function face(a, b, dt) {
    const desired = Math.atan2(b.x - a.x, b.z - a.z);
    a.heading += Math.max(-dt * 0.9, Math.min(dt * 0.9, angle(desired, a.heading)));
    a.familyLook = angle(desired, a.heading);
    a.behavior.down = 0;
    a.behavior.raised = 0.4;
  }
  function allowed(x, z, car) {
    return (
      safe(x, z, wolf, car, pair) &&
      Math.hypot(x - calf.x, z - calf.z) >= (wolf.rig.contactReach + calf.rig.contactReach) * 0.94
    );
  }
  function chase(dt, car) {
    face(mother, wolf, dt);
    const d = Math.hypot(wolf.x - mother.x, wolf.z - mother.z),
      gap = mother.radius + wolf.radius + 0.7;
    chasePlan -= dt;
    if (d <= gap) {
      mother.velocity = 0;
      mother.chargeRun = 0;
      path = [];
      return;
    }
    const clear = (x, z) => safe(x, z, mother, car, [mother]);
    if (chasePlan <= 0) {
      const goal = {
        x: Math.max(
          ANIMAL_MEADOW.minX + 0.1,
          Math.min(ANIMAL_MEADOW.maxX - 0.1, wolf.x + ((mother.x - wolf.x) / d) * gap),
        ),
        z: Math.max(
          ANIMAL_MEADOW.minZ + 0.1,
          Math.min(ANIMAL_MEADOW.maxZ - 0.1, wolf.z + ((mother.z - wolf.z) / d) * gap),
        ),
      };
      path = encounterRoute(mother, goal, clear) ?? [];
      chasePlan = 0.5;
    }
    while (path.length && Math.hypot(path[0].x - mother.x, path[0].z - mother.z) < 0.04)
      path.shift();
    const goal = path[0];
    if (!goal) {
      mother.velocity = 0;
      mother.chargeRun = 0;
      return;
    }
    face(mother, goal, dt);
    const error = angle(Math.atan2(goal.x - mother.x, goal.z - mother.z), mother.heading),
      distance = Math.hypot(goal.x - mother.x, goal.z - mother.z),
      speed = 2.7 * Math.max(0, Math.cos(error)) * Math.min(1, distance / 0.6);
    mother.velocity += (speed - mother.velocity) * (1 - Math.exp(-dt * 5));
    const step = Math.min(distance, mother.velocity * dt),
      x = mother.x + Math.sin(mother.heading) * step,
      z = mother.z + Math.cos(mother.heading) * step,
      samples = Math.max(1, Math.ceil(step / 0.1));
    for (let i = 1; i <= samples; i++)
      if (
        !clear(mother.x + ((x - mother.x) * i) / samples, mother.z + ((z - mother.z) * i) / samples)
      ) {
        path = [];
        mother.velocity = mother.chargeRun = 0;
        chasePlan = 0;
        return;
      }
    mother.x = x;
    mother.z = z;
    mother.distance += step;
    mother.velocity = step / dt;
    mother.chargeRun +=
      (Math.min(1, mother.velocity / 1.8) - mother.chargeRun) * (1 - Math.exp(-dt * 5));
    mother.behavior.state = 'walking';
  }
  const api = {
    onBite: null,
    onEscape: null,
    atMountain: () => false,
    escapeActive: () => true,
    canStart: () => !!wolf?.rig && phase === 'idle' && cooldown <= 0 && !wolf.collisionEscape,
    busy: () => phase !== 'idle',
    owns: (a) =>
      (phase !== 'idle' &&
        (a === mother ||
          (a === wolf && phase !== 'chasing') ||
          (a === calf && ['approaching', 'nibbling'].includes(phase)))) ||
      (talking && a === bull),
    available: (a) => !api.owns(a),
    follow() {
      if (!bull?.rig || !calf?.rig || charge.busy() || talking) return false;
      talking = true;
      bull.target = null;
      bull.velocity = 0;
      bull.behavior.escape = null;
      return true;
    },
    stopFollow() {
      if (talking) {
        talking = false;
        settle(bull);
      }
    },
    cancel,
    biteVoiceEvent(type) {
      if (phase !== 'calling') return;
      if (type === 'playing') talkingBite = true;
      else if (type === 'ended' && talkingBite) {
        phase = 'chasing';
        elapsed = 0;
        path = [];
        chasePlan = 0;
        if (!api.onEscape?.(lastCar, calf)) cancel('no-mountain-route');
      } else if (['cancel', 'error'].includes(type)) cancel('voice-interrupted');
    },
    tap(car) {
      if (
        !api.canStart() ||
        !calf?.rig ||
        !mother?.rig ||
        family.busy() ||
        mother.collisionEscape ||
        calf.collisionEscape
      )
        return false;
      const dx = wolf.x - calf.x,
        dz = wolf.z - calf.z,
        d = Math.hypot(dx, dz),
        gap = wolf.rig.contactReach + calf.rig.contactReach + 0.025;
      if (d < gap) return false;
      const goal = { x: calf.x + (dx / d) * gap, z: calf.z + (dz / d) * gap };
      path = encounterRoute(wolf, goal, (x, z) => allowed(x, z, car));
      if (!path) {
        reason = 'no-safe-route';
        return false;
      }
      phase = 'approaching';
      elapsed = 0;
      reason = '';
      lastCar = car;
      wolf.chargeRun = 0;
      for (const a of pair) {
        a.target = null;
        a.velocity = 0;
        a.collisionEscape = false;
        a.behavior.escape = null;
        a.behavior.driveTime = 0;
        a.behavior.down = 0;
        a.behavior.state = 'walking';
      }
      settle(mother);
      mother.behavior.state = 'watching';
      return true;
    },
    snapshot: () => ({ phase, elapsed, cooldown, bites, reason, talking }),
    update(dt, car) {
      if (dt <= 0) return;
      lastCar = car;
      cooldown = Math.max(0, cooldown - dt);
      if (talking) {
        if (charge.busy()) api.stopFollow();
        else face(bull, calf, dt);
      }
      if (phase === 'idle') return;
      elapsed += dt;
      if (elapsed > (phase === 'chasing' ? 120 : 30)) {
        cancel('timeout');
        return;
      }
      if (phase === 'calling') return;
      if (phase === 'chasing') {
        if (!api.escapeActive()) {
          cancel('escape-interrupted');
          return;
        }
        if (api.atMountain()) {
          cancel('complete');
          return;
        }
        chase(dt, car);
        return;
      }
      face(calf, wolf, dt);
      if (phase === 'approaching') {
        const goal = path[0];
        if (goal) {
          const d = Math.hypot(goal.x - wolf.x, goal.z - wolf.z);
          if (d < 0.035) {
            path.shift();
            wolf.velocity = 0;
            wolf.chargeRun = 0;
            return;
          }
          face(wolf, goal, dt);
          const error = angle(Math.atan2(goal.x - wolf.x, goal.z - wolf.z), wolf.heading);
          const speed = 3.2 * Math.max(0, Math.cos(error)) * Math.min(1, d / 0.55);
          wolf.velocity += (speed - wolf.velocity) * (1 - Math.exp(-dt * 5));
          const step = Math.min(d, wolf.velocity * dt);
          wolf.chargeRun +=
            (Math.min(1, wolf.velocity / 2) - wolf.chargeRun) * (1 - Math.exp(-dt * 5));
          const x = wolf.x + Math.sin(wolf.heading) * step,
            z = wolf.z + Math.cos(wolf.heading) * step;
          if (!allowed(x, z, car)) {
            cancel('path-blocked');
            return;
          }
          wolf.x = x;
          wolf.z = z;
          wolf.distance += step;
          wolf.velocity = step / dt;
          return;
        }
        wolf.velocity = 0;
        wolf.chargeRun = 0;
        face(wolf, calf, dt);
        wolf.behavior.raised = 1.2;
        wolf.behavior.down = 0;
        calf.behavior.raised = 0;
        calf.behavior.down = 0.18;
        if (wolf.rig.contactPoint().distanceTo(calf.rig.contactPoint()) < 0.2) {
          phase = 'nibbling';
          elapsed = 0;
        }
      }
      if (phase === 'nibbling') {
        if (!allowed(wolf.x, wolf.z, car)) {
          cancel('contact-blocked');
          return;
        }
        face(wolf, calf, dt);
        wolf.behavior.raised = 1.2;
        wolf.behavior.down = 0;
        calf.behavior.raised = 0;
        calf.behavior.down = 0.18;
        wolf.bitePose = Math.sin(Math.PI * Math.min(1, elapsed / 0.55));
        if (elapsed >= 0.55) {
          bites++;
          if (api.onEscape) {
            phase = 'calling';
            elapsed = 0;
            talkingBite = false;
            settle(wolf);
            settle(calf);
            wolf.familySeparation = calf.familySeparation = true;
          } else cancel('complete');
          api.onBite?.(calf, wolf);
        }
      }
    },
  };
  return api;
}
