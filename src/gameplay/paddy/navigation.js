import * as THREE from 'three';
import { islandDistance, inStream, isRoadSurface, roadPoint } from '../../world-queries.js';
import { paddyDistance, insidePaddy } from '../../paddy-profile.js';
import { PLOUGH_FIELD } from '../../paddy-plough-site.js';
import { animalPathSearch, clearAnimalSegment } from '../../corral-navigation.js';
import { vehicleObstacleGap } from '../../vehicle-collision.js';
import { snapshotData } from '../../app/snapshot-data.js';
const delta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const point = (a) => (a.group ? a : a.object.position);
const radius = (a) => a.radius ?? a.collider.radius;

// Search generators stay private; diagnostics contain serializable route data.
export function createPaddyNavigation({
  colliders,
  leader,
  getCow,
  getCar,
  getPhase,
  ground,
  onBlocked,
}) {
  const routes = new Map();
  const prepared = new Map();
  const routeKey = (goal) => goal.x + ',' + goal.z;
  const navigation = { slices: 0, pending: 0, milliseconds: 0 };
  const grid = new Map(),
    terrain = new Map();
  function indexObstacles() {
    grid.clear();
    for (const c of colliders) {
      const r = c.radius + 0.2;
      for (let x = Math.floor((c.x - r) / 4); x <= Math.floor((c.x + r) / 4); x++)
        for (let z = Math.floor((c.z - r) / 4); z <= Math.floor((c.z + r) / 4); z++) {
          const key = x + ',' + z;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(c);
        }
    }
  }
  function nearby(x, z, r) {
    const result = [];
    for (let ix = Math.floor((x - r) / 4); ix <= Math.floor((x + r) / 4); ix++)
      for (let iz = Math.floor((z - r) / 4); iz <= Math.floor((z + r) / 4); iz++)
        result.push(...(grid.get(ix + ',' + iz) ?? []));
    return result;
  }
  function terrainAllowed(x, z, r) {
    const key = x + ',' + z + ',' + r;
    if (terrain.has(key)) return terrain.get(key);
    const result = [
      [0, 0],
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ].every(([dx, dz]) => {
      const px = x + dx,
        pz = z + dz;
      return (
        islandDistance(px, pz) <= -2 &&
        !inStream(px, pz) &&
        (!isRoadSurface(px, pz) || (px > 119 && px < 141 && Math.abs(pz - 20) < 2.2)) &&
        (!insidePaddy(px, pz, roadPoint, 0.15) ||
          paddyDistance(PLOUGH_FIELD, px, pz, roadPoint) <= 0.25)
      );
    });
    if (terrain.size > 12000) terrain.clear();
    terrain.set(key, result);
    return result;
  }
  function allowed(a, x, z, snapshot) {
    const r = radius(a),
      from = snapshot?.start ?? point(a),
      vehicle = snapshot ? snapshot.car : getCar();
    if (!terrainAllowed(x, z, r)) return false;
    if (
      vehicle &&
      vehicleObstacleGap(vehicle.x, vehicle.z, vehicle.heading ?? 0, { x, z, radius: r }) < 0.15
    )
      return false;
    return !(snapshot?.colliders ?? nearby(x, z, r + 0.1)).some((c) => {
      const source = c.source ?? c;
      if (source === a.collider || c.ploughTool) return false;
      const d = Math.hypot(x - c.x, z - c.z),
        before = Math.hypot(from.x - c.x, from.z - c.z);
      // Existing contacts may separate, never deepen. A carried implement is
      // checked separately, not confused with an additional free-standing actor.
      const bodyRadius =
        a === leader &&
        source === getCow()?.collider &&
        ['approaching', 'hitching'].includes(getPhase())
          ? 0.35
          : r;
      const limit = bodyRadius + c.radius + 0.1;
      return d < limit && !(before < limit && d >= before - 1e-7);
    });
  }
  function searchRoute(a, state, start, goal) {
    if (!state.search) {
      state.goal = { x: goal.x, z: goal.z };
      // A search spans frames: its cached cells must all describe the same
      // obstacle positions. Live clearance is checked again before each step.
      const snapshot = {
        start: { x: start.x, z: start.z },
        car: getCar() && { ...getCar() },
        colliders: colliders.map((c) => ({ ...c, source: c })),
      };
      state.search = animalPathSearch(
        { x: start.x, z: start.z },
        { ...state.goal },
        (x, z) => allowed(a, x, z, snapshot),
        { step: state.fine ? 0.25 : 0.5, padding: 8 },
      );
    }
    const searchStart = performance.now();
    const searchDeadline = searchStart + Math.max(0, 1.25 - navigation.milliseconds);
    while (navigation.slices < 64 && performance.now() < searchDeadline) {
      navigation.slices++;
      const result = state.search.next();
      if (result.done) {
        state.path = result.value;
        state.search = null;
        // A large flagbearer can fit between bodies but have no safe neighbour
        // on the coarse grid. Retry once on a finer grid under the same budget.
        state.retry = state.path || !state.fine ? 0 : 0.8;
        state.fine = !state.path;
        break;
      }
    }
    navigation.milliseconds += performance.now() - searchStart;
  }
  function prepareRoute(start, goal, dt) {
    const key = routeKey(goal);
    if (!prepared.has(key))
      prepared.set(key, { goal: { ...goal }, path: null, search: null, retry: 0 });
    const state = prepared.get(key);
    state.retry = Math.max(0, state.retry - dt);
    if (!state.path && state.retry === 0) searchRoute(leader, state, start, goal);
  }
  function move(a, goal, dt, speed = 1.05, heading, tracking = false) {
    const from = point(a),
      gap = Math.hypot(goal.x - from.x, goal.z - from.z);
    let state = routes.get(a);
    if (!state) {
      state = { goal: { x: goal.x, z: goal.z }, path: null, search: null, retry: 0, speed: 0 };
      routes.set(a, state);
    }
    if (Math.hypot(state.goal.x - goal.x, state.goal.z - goal.z) > 0.7 && !state.search) {
      state.goal = { x: goal.x, z: goal.z };
      state.path = null;
      state.retry = 0;
      state.fine = false;
    }
    if (a === leader && !state.path && !state.search && prepared.has(routeKey(goal))) {
      Object.assign(state, prepared.get(routeKey(goal)));
      prepared.delete(routeKey(goal));
    }
    state.retry = Math.max(0, state.retry - dt);
    while (
      state.path?.length &&
      Math.hypot(state.path[0].x - from.x, state.path[0].z - from.z) < 0.035
    )
      state.path.shift();
    if (gap <= 0.035) {
      state.path = state.search = null;
      state.retry = 0;
    } else if (
      tracking &&
      gap < 1.5 &&
      clearAnimalSegment(from, goal, (x, z) => allowed(a, x, z))
    ) {
      // A moving follow target is not a completed journey. Refresh the short,
      // visible endpoint every frame instead of waiting at its previous position.
      state.goal = { x: goal.x, z: goal.z };
      state.path = [{ ...state.goal }];
      state.search = null;
      state.retry = 0;
    }
    if (gap > 0.035 && !state.path?.length && state.retry === 0) {
      // Only an unsuccessful search needs backoff. Exhausting a valid route
      // must not force a follower to stand still for another 0.8s.
      searchRoute(a, state, from, goal);
    }
    const next = gap < 0.035 ? null : state.path?.[0];
    const desired = next
      ? Math.atan2(next.x - from.x, next.z - from.z)
      : (heading ?? (a.group ? a.heading : a.object.rotation.y));
    const yaw = a.group ? a.heading : a.object.rotation.y;
    const turn = THREE.MathUtils.clamp(delta(desired, yaw), -dt * 1.8, dt * 1.8);
    const aligned = next && Math.abs(delta(desired, yaw + turn)) < 0.14;
    const nextGap = next ? Math.hypot(next.x - from.x, next.z - from.z) : 0;
    const targetSpeed = aligned ? Math.min(speed, Math.sqrt(3 * nextGap)) : 0;
    state.speed += THREE.MathUtils.clamp(targetSpeed - state.speed, -dt * 1.5, dt * 1.5);
    let step = aligned ? Math.min(state.speed * dt, nextGap) : 0;
    const dest = { x: from.x + Math.sin(desired) * step, z: from.z + Math.cos(desired) * step };
    if (step && !clearAnimalSegment(from, dest, (x, z) => allowed(a, x, z), 0.07)) {
      step = 0;
      state.path = null;
      state.search = null;
      state.speed = 0;
      a.blocked = true;
    } else {
      a.blocked = gap > 0.035 && !next;
    }
    onBlocked(a.blocked);
    if (a.group) {
      if (step) {
        a.x = dest.x;
        a.z = dest.z;
      }
      a.heading = yaw + turn;
      a.clock += dt;
      a.distance += step;
      a.velocity = step / dt;
      a.motion = THREE.MathUtils.damp(a.motion, step > 0 ? 1 : 0, 5, dt);
      a.behavior.down = 0;
      a.behavior.swishTime += dt;
      a.behavior.raised = Math.max(0, a.behavior.raised - dt * 0.22);
      a.group.position.set(a.x, ground(a.x, a.z) + 0.025, a.z);
      a.group.rotation.y = a.heading;
      a.supportHeight = ground;
      Object.assign(a.collider, { x: a.x, z: a.z });
      a.rig.update(dt, a, 0, 0);
    } else {
      if (step) a.object.position.set(dest.x, ground(dest.x, dest.z), dest.z);
      a.object.rotation.y = yaw + turn;
      Object.assign(a.collider, { x: from.x, z: from.z });
      a.rig.update(dt, Math.max(step, Math.abs(turn) * 0.07), ground);
    }
    return gap < 0.035 && (heading === undefined || Math.abs(delta(heading, yaw + turn)) < 0.04);
  }
  return {
    routes,
    prepared,
    navigation,
    allowed,
    move,
    prepareRoute,
    beginFrame() {
      indexObstacles();
      navigation.slices = 0;
      navigation.milliseconds = 0;
    },
    finishFrame() {
      navigation.pending = [...routes.values(), ...prepared.values()].filter(
        (r) => r.search,
      ).length;
    },
    snapshotRoutes() {
      return snapshotData(
        [...routes].map(([actor, { search, ...state }]) => ({
          ...state,
          searchPending: !!search,
          id: actor.layout?.id ?? actor.id,
        })),
      );
    },
  };
}
