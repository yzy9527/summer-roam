import { animalPathSearch, dryAnimalPoint } from '../../corral-navigation.js';
import { vehicleObstacleGap } from '../../vehicle-collision.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Plan against one frozen world; the controller rechecks the live sweep before
// walking. Both grid fallback and path simplification share the frame budget.
export function createRescueExitNavigation(
  colliders,
  giant,
  { now = () => performance.now() } = {},
) {
  let state = null;
  const terrain = new Map();
  let slices = 0,
    milliseconds = 0;
  function* plan(start, goals, calf, car) {
    const radius = giant.collider.radius;
    const limit = radius + calf.radius + 0.12;
    const minimum = Math.min(limit, distance(start, calf));
    const obstacles = colliders
      .filter((c) => c !== giant.collider && c !== calf.collider)
      .map((c) => ({ ...c }));
    const animal = { x: calf.x, z: calf.z };
    const vehicle = car && { ...car };
    const allowed = (x, z) => {
      const key = `${x},${z},${radius}`;
      if (!terrain.has(key)) {
        if (terrain.size >= 4096) terrain.clear();
        terrain.set(key, dryAnimalPoint(x, z, radius, [], null));
      }
      return (
        terrain.get(key) &&
        distance({ x, z }, animal) >= minimum - 1e-7 &&
        !obstacles.some((c) => distance({ x, z }, c) < radius + c.radius + 0.12) &&
        (!vehicle ||
          vehicleObstacleGap(vehicle.x, vehicle.z, vehicle.heading ?? 0, { x, z, radius }) > 0.4)
      );
    };
    // Once contact has separated, no edge may enter it again. Test each edge,
    // not just cells against the original start distance.
    const canStep = (a, b) => {
      const dx = b.x - a.x,
        dz = b.z - a.z;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((animal.x - a.x) * dx + (animal.z - a.z) * dz) / Math.max(dx * dx + dz * dz, 1e-12),
        ),
      );
      return (
        distance({ x: a.x + dx * t, z: a.z + dz * t }, animal) >=
        Math.min(limit, distance(a, animal)) - 1e-7
      );
    };
    const path = [];
    let from = { ...start };
    for (const goal of goals) {
      let segment = null;
      for (const step of [0.75, 0.5, 0.25]) {
        state.step = step;
        segment = yield* animalPathSearch(from, goal, allowed, { step, padding: 8, canStep });
        if (segment) break;
      }
      if (!segment) return null;
      path.push(...segment);
      from = goal;
    }
    return path;
  }
  return {
    reset() {
      state = null;
    },
    update(start, goals, calf, car, dt) {
      slices = milliseconds = 0;
      if (state?.path) return;
      if (state?.retry > 0) {
        state.retry = Math.max(0, state.retry - dt);
        if (state.retry > 0) return;
        state = null;
      }
      if (!state) {
        state = { search: null, path: null, retry: 0, step: 0.75 };
        state.search = plan(
          { x: start.x, z: start.z },
          goals.map((p) => ({ ...p })),
          calf,
          car,
        );
      }
      if (!state.search) return;
      const began = now();
      while (slices < 256 && now() - began < 1) {
        slices++;
        const result = state.search.next();
        if (result.done) {
          state.search = null;
          state.path = result.value;
          state.retry = result.value ? 0 : 0.25;
          break;
        }
      }
      milliseconds = now() - began;
    },
    takePath() {
      const path = state?.path;
      if (path) state = null;
      return path;
    },
    snapshot: () => ({
      pending: !!state?.search,
      ready: !!state?.path,
      retry: state?.retry ?? 0,
      step: state?.step ?? null,
      slices,
      milliseconds,
    }),
  };
}
