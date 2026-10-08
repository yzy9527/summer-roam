// One interaction owns both cows until comfort finishes; media time drives the reply.
import { ANIMAL_MEADOW } from './animal-meadow.js';
const angle = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export function createCowFamily(animals, safe) {
  const calf = animals.find((a) => a.id === 'hornless-calf'),
    mother = animals.find((a) => a.id === 'golden-cow');
  let phase = 'idle',
    elapsed = 0,
    voiceTime = 0,
    reason = '',
    paths = new Map();
  const pair = [calf, mother].filter(Boolean);
  function release(why = 'complete') {
    reason = why;
    phase = 'idle';
    paths.clear();
    for (const a of pair) {
      delete a.familyLook;
      a.recoil = null;
      a.target = null;
      a.velocity = 0;
      a.wait = 2;
      Object.assign(a.behavior, { state: 'idle', time: 0, escape: null });
      a.homeX = a.x;
      a.homeZ = a.z;
      a.familySeparation =
        !!calf &&
        !!mother &&
        Math.hypot(calf.x - mother.x, calf.z - mother.z) < calf.radius + mother.radius + 0.4;
    }
  }
  function face(a, b, dt) {
    const desired = Math.atan2(b.x - a.x, b.z - a.z),
      error = angle(desired, a.heading);
    a.heading += Math.max(-dt * 0.65, Math.min(dt * 0.65, error));
    a.familyLook = angle(desired, a.heading);
    a.behavior.down += (0 - a.behavior.down) * (1 - Math.exp(-dt * 2));
    a.behavior.raised += (0.6 - a.behavior.raised) * (1 - Math.exp(-dt * 2));
  }
  // Visibility graph on a meadow grid, with every edge sampled for full body clearance.
  function route(a, goal, car) {
    const clear = (p, q) => {
      const n = Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.15);
      for (let i = 0; i <= n; i++)
        if (
          !safe(
            p.x + ((q.x - p.x) * i) / (n || 1),
            p.z + ((q.z - p.z) * i) / (n || 1),
            a,
            car,
            pair,
          )
        )
          return false;
      return true;
    };
    const start = { x: a.x, z: a.z };
    if (clear(start, goal)) return [goal];
    const nodes = [start, goal];
    for (let x = ANIMAL_MEADOW.minX; x <= ANIMAL_MEADOW.maxX; x += 0.6)
      for (let z = ANIMAL_MEADOW.minZ; z <= ANIMAL_MEADOW.maxZ; z += 0.6)
        if (safe(x, z, a, car, pair)) nodes.push({ x, z });
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
          value = score;
          best = i;
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
  function plan(car) {
    const dx = calf.x - mother.x,
      dz = calf.z - mother.z,
      d = Math.hypot(dx, dz),
      ux = dx / d,
      uz = dz / d;
    const reach = (a) => a.rig?.contactReach ?? a.radius * 0.85;
    const gap = reach(calf) + reach(mother) + 0.035;
    if (d < gap - 0.1) return false;
    for (const t of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const mx = mother.x + dx * t,
        mz = mother.z + dz * t;
      const g = { x: mx - (ux * gap) / 2, z: mz - (uz * gap) / 2 },
        c = { x: mx + (ux * gap) / 2, z: mz + (uz * gap) / 2 };
      const gp = route(mother, g, car),
        cp = route(calf, c, car);
      if (gp && cp) {
        paths.set(mother, gp);
        paths.set(calf, cp);
        return true;
      }
    }
    return false;
  }
  return {
    feedbackAllowed(a, x, z, car) {
      const other = a === calf ? mother : calf;
      return (
        safe(x, z, a, car, pair) &&
        Math.hypot(x - other.x, z - other.z) >=
          (calf.rig.contactReach + mother.rig.contactReach) * 0.96
      );
    },
    displaced() {
      if (phase === 'approaching' || phase === 'comfort') {
        phase = 'planning';
        elapsed = 0;
      }
    },
    busy: () => phase !== 'idle',
    owns: (a) => phase !== 'idle' && pair.includes(a),
    reserve() {
      if (phase !== 'idle' || !calf?.rig || !mother?.rig) return false;
      phase = 'pending';
      elapsed = 0;
      voiceTime = 0;
      reason = '';
      for (const a of pair) {
        a.target = null;
        a.velocity = 0;
        a.behavior.escape = null;
      }
      return true;
    },
    event(type, time = 0) {
      if (type === 'cancel') {
        if (phase !== 'idle') release('cancelled');
        return;
      }
      if (type === 'playing' && phase === 'pending') {
        phase = 'calling';
        elapsed = 0;
      }
      if (type === 'time' && phase === 'calling') voiceTime = time;
      if (type === 'ended' && phase === 'calling') {
        phase = 'planning';
        elapsed = 0;
      }
    },
    snapshot: () => ({ phase, busy: phase !== 'idle', elapsed, voiceTime, reason }),
    update(dt, car) {
      if (phase === 'idle' || dt <= 0) return;
      elapsed += dt;
      if (phase === 'pending') {
        if (elapsed > 8) release('audio-timeout');
        return;
      }
      if (phase === 'calling') {
        if (!calf.recoil) face(calf, mother, dt);
        if (voiceTime >= 5 && !mother.recoil) face(mother, calf, dt);
        return;
      }
      if (pair.some((a) => a.recoil)) return;
      if (phase === 'planning') {
        if (!plan(car)) {
          release('no-safe-route');
          return;
        }
        phase = 'approaching';
        elapsed = 0;
      }
      if (phase === 'approaching') {
        if (elapsed > 40) {
          release('approach-timeout');
          return;
        }
        let arrived = true;
        for (const a of pair) {
          const path = paths.get(a),
            goal = path?.[0];
          if (!goal) continue;
          arrived = false;
          const dx = goal.x - a.x,
            dz = goal.z - a.z,
            d = Math.hypot(dx, dz);
          if (d < 0.025) {
            path.shift();
            continue;
          }
          const error = angle(Math.atan2(dx, dz), a.heading);
          a.heading += Math.max(-dt * 0.65, Math.min(dt * 0.65, error));
          const step = Math.min(
            d,
            a.speed * dt * Math.max(0, Math.cos(error)) * Math.min(1, d / 0.18),
          );
          const x = a.x + Math.sin(a.heading) * step,
            z = a.z + Math.cos(a.heading) * step;
          const other = a === calf ? mother : calf;
          if (
            !safe(x, z, a, car, pair) ||
            Math.hypot(x - other.x, z - other.z) <
              (calf.rig.contactReach + mother.rig.contactReach) * 0.96
          ) {
            release('path-blocked');
            return;
          }
          a.x = x;
          a.z = z;
          a.distance += step;
          a.velocity = step / dt;
          a.familyLook = 0;
          a.behavior.down = 0;
          a.behavior.raised *= Math.exp(-dt * 2);
        }
        if (arrived) {
          phase = 'comfort';
          elapsed = 0;
        }
      }
      if (phase === 'comfort') {
        for (const a of pair)
          if (!safe(a.x, a.z, a, car, pair)) {
            release('comfort-blocked');
            return;
          }
        face(calf, mother, dt);
        face(mother, calf, dt);
        mother.behavior.down = 0.12 * Math.sin(Math.PI * Math.min(1, elapsed / 2.4));
        mother.behavior.raised = 0;
        calf.behavior.raised = 0.45;
        if (elapsed >= 2.4) release();
      }
    },
  };
}
