import * as THREE from 'three';
import { dryAnimalPoint, clearAnimalSegment } from './corral-navigation.js';
import { landscapeHeight } from './world-queries.js';
import { inAnimalMeadow, inBullPatrol } from './animal-meadow.js';

export function separatesCircle(from, to, radius, obstacle, margin = 0.12) {
  const limit = radius + obstacle.radius + margin;
  const before = Math.hypot(from.x - obstacle.x, from.z - obstacle.z);
  const after = Math.hypot(to.x - obstacle.x, to.z - obstacle.z);
  const outward = (from.x - obstacle.x) * (to.x - from.x) + (from.z - obstacle.z) * (to.z - from.z);
  // Require separation from the first infinitesimal step, not only at the
  // sampled endpoint; otherwise high frame rates can stall a shallow tangent.
  return before < limit && outward >= -1e-9 && after >= before - 1e-7;
}

function closest(point, lane) {
  const dx = lane.to.x - lane.from.x,
    dz = lane.to.z - lane.from.z;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - lane.from.x) * dx + (point.z - lane.from.z) * dz) /
        Math.max(1e-9, dx * dx + dz * dz),
    ),
  );
  return { x: lane.from.x + dx * t, z: lane.from.z + dz * t };
}

function laneGap(point, radius, lane) {
  const p = closest(point, lane);
  return Math.hypot(point.x - p.x, point.z - p.z) - radius - lane.radius;
}

// A short lease keeps one updater per character. Ordinary patrol resumes at the
// new position after the task has passed; no input, sound or tap is generated.
export function createTaskClearance(colliders, zombies, animals, { exclude = [] } = {}) {
  const leases = new Map(),
    requests = new Map();
  const residents = ['golden-cow', 'copper-cow', 'hornless-calf', 'reference-wolf', 'baola-leopard']
    .map((id) => animals.animal(id))
    .filter(Boolean);
  for (const animal of residents) animal.collider.animal ??= animal.id;
  const dynamic = (c) => c.zombie || c.animal || c.woodenCart;
  function point(entry) {
    return entry.animal ?? entry.actor.object.position;
  }
  function allowed(entry, from, to, car) {
    const radius = entry.collider.radius;
    if (
      entry.animal &&
      !(entry.animal.id === 'copper-cow' ? inBullPatrol(to.x, to.z) : inAnimalMeadow(to.x, to.z))
    )
      return false;
    return dryAnimalPoint(
      to.x,
      to.z,
      radius,
      colliders,
      car,
      (c) => c === entry.collider || (dynamic(c) && separatesCircle(from, to, radius, c)),
    );
  }
  function destination(entry, lane, car) {
    const from = point(entry),
      p = closest(from, lane);
    const away = Math.atan2(from.x - p.x, from.z - p.z);
    for (const distance of [1, 2, 3, 4, 6])
      for (const offset of [
        0,
        0.5,
        -0.5,
        1,
        -1,
        Math.PI / 2,
        -Math.PI / 2,
        Math.PI * 0.75,
        -Math.PI * 0.75,
        Math.PI,
      ]) {
        const target = {
          x: from.x + Math.sin(away + offset) * distance,
          z: from.z + Math.cos(away + offset) * distance,
        };
        if (laneGap(target, entry.collider.radius, lane) < 0.5) continue;
        if (
          [...leases.values()].some(
            (other) =>
              other.collider !== entry.collider &&
              Math.hypot(target.x - other.target.x, target.z - other.target.z) <
                entry.collider.radius + other.collider.radius + 0.35,
          )
        )
          continue;
        if (clearAnimalSegment(from, target, (x, z) => allowed(entry, from, { x, z }, car), 0.08))
          return target;
      }
    return null;
  }
  function release(entry) {
    leases.delete(entry.collider);
    delete entry.collider.taskYield;
    if (entry.animal) animals.releaseYield(entry.animal.id);
    else zombies.release(entry.actor.layout.id);
  }
  return {
    request(from, to, radius, car, key = null) {
      if (key && (requests.get(key) ?? 0) > 0) return;
      if (key) requests.set(key, 0.6);
      const lane = { from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, radius };
      for (const collider of colliders) {
        if (laneGap(collider, collider.radius, lane) > 0.35) continue;
        const existing = leases.get(collider);
        if (existing) {
          existing.hold = 4;
          existing.lane = lane;
          if (laneGap(existing.target, collider.radius, lane) < 0.2) {
            const target = destination(existing, lane, car);
            if (target) existing.target = target;
          }
          continue;
        }
        const animal = residents.find((a) => a.collider === collider);
        const actor = collider.zombie ? zombies.actor(collider.zombie) : null;
        if (exclude.includes(animal?.id ?? actor?.layout.id)) continue;
        if (animal && !animals.transportAvailable(animal.id)) {
          animals.wakeForYield?.(animal.id);
          continue;
        }
        if (actor && (actor.scripted || actor.seated || actor.transitioning)) continue;
        if (!animal && !actor) continue;
        const entry = { animal, actor, collider, lane, hold: 4, age: 0 };
        entry.target = destination(entry, lane, car);
        if (!entry.target) continue;
        if (animal) {
          if (!animals.reserveYield?.(animal.id)) continue;
        } else zombies.take(actor.layout.id);
        collider.taskYield = true;
        leases.set(collider, entry);
      }
    },
    update(dt, car) {
      if (!(dt > 0)) return;
      for (const [key, remaining] of requests) requests.set(key, Math.max(0, remaining - dt));
      for (const entry of leases.values()) {
        entry.hold -= dt;
        entry.age += dt;
        const p = point(entry),
          target = entry.target;
        const previous = { x: p.x, z: p.z };
        const distance = Math.hypot(target.x - p.x, target.z - p.z);
        if (distance < 0.06) {
          if (entry.animal) {
            entry.animal.velocity = entry.animal.motion = 0;
            entry.animal.clock += dt;
            entry.animal.rig.update(dt, entry.animal, 0, 0);
          }
          if (entry.hold <= 0) release(entry);
          continue;
        }
        if (entry.age > 15) {
          release(entry);
          continue;
        }
        if (entry.actor) {
          zombies.walk(entry.actor.layout.id, target, dt, {
            speed: 0.8,
            alignBeforeMove: true,
            car,
          });
        } else {
          const a = entry.animal,
            desired = Math.atan2(target.x - a.x, target.z - a.z);
          const error = Math.atan2(Math.sin(desired - a.heading), Math.cos(desired - a.heading));
          a.heading += THREE.MathUtils.clamp(error, -dt * 1.3, dt * 1.3);
          const step = Math.abs(error) < 0.12 ? Math.min(distance, 0.8 * dt) : 0;
          const next = { x: a.x + Math.sin(a.heading) * step, z: a.z + Math.cos(a.heading) * step };
          if (allowed(entry, a, next, car)) {
            a.x = next.x;
            a.z = next.z;
            a.distance += step;
            a.velocity = step / dt;
          } else a.velocity = 0;
          a.clock += dt;
          a.motion = a.velocity > 0 ? 1 : 0;
          a.group.position.set(a.x, landscapeHeight(a.x, a.z) + 0.025, a.z);
          a.group.rotation.set(0, a.heading, 0, 'YXZ');
          Object.assign(a.collider, { x: a.x, z: a.z });
          a.rig.update(dt, a, 0, 0);
        }
        const turnError = entry.animal
          ? Math.atan2(target.x - previous.x, target.z - previous.z) - entry.animal.heading
          : 0;
        const blocked = entry.actor
          ? entry.actor.blocked
          : entry.animal.velocity === 0 &&
            Math.abs(Math.atan2(Math.sin(turnError), Math.cos(turnError))) < 0.12;
        entry.stalled = blocked ? (entry.stalled ?? 0) + dt : 0;
        if (entry.stalled > 1) {
          const next = destination(entry, entry.lane, car);
          if (next) entry.target = next;
          entry.stalled = 0;
        }
      }
    },
    snapshot: () =>
      [...leases.values()].map((e) => ({
        id: e.animal?.id ?? e.actor.layout.id,
        target: { ...e.target },
        position: { x: point(e).x, z: point(e).z },
        hold: e.hold,
      })),
  };
}
