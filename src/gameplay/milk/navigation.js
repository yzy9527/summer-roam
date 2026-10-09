import * as THREE from 'three';
import { animalPathSearch, dryAnimalPoint, clearAnimalSegment } from '../../corral-navigation.js';
import { vehicleObstacleGap } from '../../vehicle-collision.js';

const delta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const points = (goal) => (Array.isArray(goal) ? goal : [goal]);
const keyOf = (goal) =>
  points(goal)
    .map((p) => `${p.x},${p.z}`)
    .join(';');

// Local queries and terrain caching serve both the live sweep and immutable searches.
export function createMilkNavigation(
  colliders,
  ground,
  ignore = () => false,
  { now = () => performance.now() } = {},
) {
  const routes = new Map(),
    prepared = new Map(),
    terrain = new Map(),
    diagnostics = new Map();
  let grid = new Map(),
    slices = 0,
    milliseconds = 0;
  function index(list) {
    const result = new Map();
    for (const c of list) {
      for (
        let x = Math.floor((c.x - c.radius - 0.12) / 4);
        x <= Math.floor((c.x + c.radius + 0.12) / 4);
        x++
      )
        for (
          let z = Math.floor((c.z - c.radius - 0.12) / 4);
          z <= Math.floor((c.z + c.radius + 0.12) / 4);
          z++
        ) {
          const key = `${x},${z}`;
          if (!result.has(key)) result.set(key, []);
          result.get(key).push(c);
        }
    }
    return result;
  }
  function nearby(x, z, r, source) {
    const found = new Set();
    for (let ix = Math.floor((x - r) / 4); ix <= Math.floor((x + r) / 4); ix++)
      for (let iz = Math.floor((z - r) / 4); iz <= Math.floor((z + r) / 4); iz++)
        for (const c of source.get(`${ix},${iz}`) ?? []) found.add(c);
    return found;
  }
  function allowed(a, x, z, car, snapshot) {
    const key = `${x},${z},${a.radius}`;
    if (!terrain.has(key)) {
      if (terrain.size >= 12000) terrain.clear();
      terrain.set(key, dryAnimalPoint(x, z, a.radius, [], null));
    }
    if (!terrain.get(key)) return false;
    const from = snapshot?.start ?? a;
    for (const c of nearby(x, z, a.radius, snapshot?.grid ?? grid)) {
      if ((c.source ?? c) === a.collider || ignore(c.source ?? c)) continue;
      const limit = a.radius + c.radius + 0.12;
      const before = distance(from, c),
        after = Math.hypot(x - c.x, z - c.z);
      if (after < limit && !(before < limit && after >= before - 1e-7)) return false;
    }
    return (
      !car || vehicleObstacleGap(car.x, car.z, car.heading ?? 0, { x, z, radius: a.radius }) > 0.15
    );
  }
  function createState(a, goal, start = a) {
    return {
      goal: points(goal).map((p) => ({ ...p })),
      planGoals: points(goal).map((p) => ({ ...p })),
      planIndex: 0,
      complete: false,
      start: { x: start.x, z: start.z },
      path: null,
      search: null,
      retry: 0,
      speed: a.velocity ?? 0,
      fine: false,
    };
  }
  function* plan(a, state, car) {
    const snapshot = {
      start: { ...state.start },
      grid: index(colliders.map((c) => ({ ...c, source: c }))),
    };
    const vehicle = car && { ...car };
    let from = state.planIndex ? state.planGoals[state.planIndex - 1] : snapshot.start;
    for (let i = state.planIndex; i < state.planGoals.length; i++) {
      const goal = state.planGoals[i];
      const segment = yield* animalPathSearch(
        from,
        goal,
        (x, z) => allowed(a, x, z, vehicle, snapshot),
        { step: state.fine ? 0.25 : distance(from, goal) > 12 ? 1 : 0.5, padding: 7 },
      );
      if (!segment) return null;
      state.path ??= [];
      state.path.push(...segment.map((p) => ({ ...p, leg: i })));
      state.planIndex = i + 1;
      from = goal;
    }
    return true;
  }
  function advance(a, state, car) {
    if (state.complete || state.retry > 0) return;
    state.search ??= plan(a, state, car);
    const start = now();
    while (slices < 96 && milliseconds + now() - start < 1.25) {
      slices++;
      const result = state.search.next();
      if (result.done) {
        state.complete = !!result.value;
        state.search = null;
        state.retry = result.value ? 0 : 0.4;
        state.fine = !result.value;
        break;
      }
    }
    milliseconds += now() - start;
  }
  function prepare(a, goal, car, start = a) {
    const key = `${a.id}:${keyOf(goal)}`;
    let state = prepared.get(key);
    if (!state) {
      state = createState(a, goal, start);
      prepared.set(key, state);
    }
    advance(a, state, car);
  }
  function move(a, goal, dt, car, speed = 0.8, heading) {
    const goals = points(goal),
      final = goals.at(-1);
    let state = routes.get(a);
    if (
      !state ||
      state.goal.length !== goals.length ||
      state.goal.some((p, i) => distance(p, goals[i]) > 0.15)
    ) {
      const key = `${a.id}:${keyOf(goal)}`;
      state = prepared.get(key) ?? createState(a, goal);
      prepared.delete(key);
      state.speed = a.velocity ?? 0;
      routes.set(a, state);
    }
    if (state.complete && state.path?.length)
      Object.assign(state.path[state.path.length - 1], final);
    state.goal = goals.map((p) => ({ ...p }));
    const gap = distance(a, final);
    state.retry = Math.max(0, state.retry - dt);
    while (state.path?.length && distance(a, state.path[0]) < 0.04) state.path.shift();
    if (gap > 0.04 && !state.path?.length && !state.search && state.retry === 0) {
      // Bounded local direct checks avoid even one frame of planning at the bucket.
      if (
        goals.length === 1 &&
        gap < 4 &&
        clearAnimalSegment(a, final, (x, z) => allowed(a, x, z, car), 0.12)
      ) {
        state.path = [{ ...final }];
        state.search = null;
        state.complete = true;
      } else {
        if (state.complete) {
          state.complete = false;
          state.planGoals = [{ ...final }];
          state.planIndex = 0;
        }
        if (state.planIndex === 0) state.start = { x: a.x, z: a.z };
      }
    }
    if (gap > 0.04 && state.retry === 0) advance(a, state, car);
    // Cut a corner only through a checked short chord; never smooth across forbidden terrain.
    if (
      state.path?.length > 1 &&
      !state.path[0].steering &&
      distance(a, state.path[0]) < Math.min(3, speed * 0.65 + 0.4)
    ) {
      const corner = state.path[0],
        following = state.path[1],
        length = distance(corner, following);
      const blend = Math.min(1, 2 / Math.max(0.001, length));
      const ahead = {
        x: corner.x + (following.x - corner.x) * blend,
        z: corner.z + (following.z - corner.z) * blend,
        steering: true,
        leg: following.leg,
      };
      if (clearAnimalSegment(a, ahead, (x, z) => allowed(a, x, z, car), 0.1)) {
        state.path.shift();
        state.path.unshift(ahead);
      }
    }
    const next = gap <= 0.04 ? null : state.path?.[0];
    const desired = next ? Math.atan2(next.x - a.x, next.z - a.z) : (heading ?? a.heading);
    const error = delta(desired, a.heading);
    a.heading += THREE.MathUtils.clamp(error, -dt * 2, dt * 2);
    const remainingTurn = Math.abs(delta(desired, a.heading));
    const aligned = remainingTurn < 0.12;
    const continuous = state.path?.length > 1 && !aligned && remainingTurn < 0.65;
    const remaining = next ? distance(a, next) : 0;
    const targetSpeed =
      next && (aligned || continuous)
        ? Math.min(
            speed,
            state.path.length > 1 ? speed : Math.sqrt(5 * remaining),
            continuous ? 1.2 / Math.max(0.3, remainingTurn) : speed,
          )
        : 0;
    state.speed += THREE.MathUtils.clamp(targetSpeed - state.speed, -dt * 3, dt * 3);
    let step = next && (aligned || continuous) ? Math.min(remaining, state.speed * dt) : 0;
    const dest = { x: a.x + Math.sin(a.heading) * step, z: a.z + Math.cos(a.heading) * step };
    let waiting = next
      ? step
        ? null
        : 'turning'
      : gap > 0.04
        ? state.search
          ? 'planning'
          : 'blocked'
        : 'contact';
    if (step && !clearAnimalSegment(a, dest, (x, z) => allowed(a, x, z, car), 0.06)) {
      step = state.speed = 0;
      // Generated bends are expendable. A newly occupied bend must not become
      // a mandatory destination in every retry; retain only unpassed route goals.
      state.planGoals = state.planGoals.slice(next.leg ?? 0).map((p) => ({ ...p }));
      state.planIndex = 0;
      state.complete = false;
      state.start = { x: a.x, z: a.z };
      state.path = state.search = null;
      state.retry = 0.15;
      waiting = 'blocked';
    }
    if (step) {
      a.x = dest.x;
      a.z = dest.z;
    }
    const stats = diagnostics.get(a) ?? { still: 0, maxStill: 0, planning: 0 };
    stats.waiting = waiting;
    stats.still = step ? 0 : stats.still + dt;
    stats.maxStill = Math.max(stats.maxStill, stats.still);
    stats.planning += waiting === 'planning' ? dt : 0;
    diagnostics.set(a, stats);
    a.velocity = step / dt;
    a.distance += step;
    a.chargeRun = THREE.MathUtils.damp(
      a.chargeRun ?? 0,
      a.velocity > 0.8 && speed > 1 ? Math.min(1, a.velocity / 2) : 0,
      9,
      dt,
    );
    a.motion = THREE.MathUtils.damp(a.motion ?? 0, step > 0 ? 1 : 0, 7, dt);
    a.blocked = waiting === 'blocked';
    a.group.position.set(a.x, ground(a.x, a.z) + 0.025, a.z);
    a.group.rotation.set(0, a.heading, 0, 'YXZ');
    Object.assign(a.collider, { x: a.x, z: a.z });
    return gap <= 0.04 && (heading === undefined || Math.abs(delta(heading, a.heading)) < 0.04);
  }
  grid = index(colliders);
  return {
    move,
    allowed,
    prepare,
    clear(a, all = false) {
      routes.delete(a);
      if (all) {
        for (const key of prepared.keys()) if (key.startsWith(`${a.id}:`)) prepared.delete(key);
        diagnostics.delete(a);
      }
    },
    beginFrame() {
      grid = index(colliders);
      slices = milliseconds = 0;
    },
    snapshot: () => ({
      slices,
      milliseconds,
      pending: [...routes.values(), ...prepared.values()].filter((r) => r.search).length,
      actors: [...diagnostics].map(([a, stats]) => ({ id: a.id, ...stats })),
    }),
  };
}
