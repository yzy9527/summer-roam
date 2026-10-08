import * as THREE from 'three';
import { encounterRoute } from './animal-encounters.js';
import { inAnimalMeadow } from './animal-meadow.js';
import { landscapeHeight } from './world-queries.js';
import {
  MOUNTAIN_ROUTE,
  MOUNTAIN_GATE,
  mountainSupportHeight,
  mountainNormal,
} from './mountain-profile.js';

export function createWolfMountain(animals, safe, random = () => Math.random()) {
  const wolf = animals.find((a) => a.id === 'reference-wolf');
  let phase = 'idle',
    path = [],
    nextVisit = 45 + random() * 45;
  let sheltered = false,
    mode = 'day',
    drawTime = 0,
    stayTime = 0;
  let draws = 0,
    calls = 0,
    visits = 0,
    blockedTime = 0,
    howling = false;
  let allowedToStart = () => true;
  let running = false,
    visitStay = null,
    departing = [];
  const entry = MOUNTAIN_ROUTE[0];
  const angle = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  function clear(p, q, car, trail) {
    const steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.1));
    for (let i = 0; i <= steps; i++) {
      const x = THREE.MathUtils.lerp(p.x, q.x, i / steps),
        z = THREE.MathUtils.lerp(p.z, q.z, i / steps);
      if (!safe(x, z, wolf, car, trail, departing)) return false;
    }
    return true;
  }
  function resetGround() {
    phase = 'idle';
    sheltered = false;
    path = [];
    howling = false;
    api.onStopHowl?.();
    wolf.supportHeight = null;
    wolf.supportNormal = null;
    wolf.target = null;
    wolf.velocity = 0;
    wolf.chargeRun = 0;
    wolf.wait = 3;
    wolf.homeX = wolf.x;
    wolf.homeZ = wolf.z;
    wolf.howlPose = 0;
    Object.assign(wolf.behavior, { state: 'idle', time: 0, down: 0, raised: 0, escape: null });
    nextVisit = 60 + random() * 45;
  }
  function start(car, { run = false, stay = null, departing: leaving = [] } = {}) {
    if (
      !wolf?.rig ||
      phase !== 'idle' ||
      !allowedToStart() ||
      wolf.collisionEscape ||
      wolf.behavior.driveTime > 0
    )
      return false;
    const route = encounterRoute(wolf, entry, (x, z) => safe(x, z, wolf, car, false, leaving));
    if (!route) return false;
    phase = 'approaching';
    path = route;
    blockedTime = 0;
    running = run;
    visitStay = stay;
    departing = leaving;
    wolf.target = null;
    wolf.velocity = 0;
    wolf.chargeRun = 0;
    wolf.recoil = null;
    Object.assign(wolf.behavior, { state: 'walking', down: 0, raised: 0, escape: null });
    return true;
  }
  function enterTrail() {
    sheltered = true;
    visits++;
    phase = 'ascending';
    wolf.supportHeight = mountainSupportHeight;
    wolf.supportNormal = mountainNormal;
    path = MOUNTAIN_ROUTE.slice(1).map((p) => ({ x: p.x, z: p.z }));
  }
  function descend() {
    howling = false;
    api.onStopHowl?.();
    phase = 'descending';
    path = MOUNTAIN_ROUTE.slice(0, -1)
      .reverse()
      .map((p) => ({ x: p.x, z: p.z }));
  }
  const api = {
    onHowl: null,
    onStopHowl: null,
    setStartGate(gate) {
      allowedToStart = gate;
    },
    start,
    owns: (a) => a === wolf && phase !== 'idle',
    touchLocked: (a) => a === wolf && sheltered,
    cancelApproach() {
      if (phase === 'approaching') resetGround();
    },
    requestDescent() {
      if (phase !== 'summit') return false;
      descend();
      return true;
    },
    event(type) {
      howling = type === 'playing' && phase === 'summit';
    },
    update(dt, car, timeOfDay = 'day', clockDt = dt) {
      if (!wolf?.rig || dt <= 0) return;
      if (mode !== timeOfDay) {
        mode = timeOfDay;
        drawTime = 0;
      }
      if (phase === 'idle') {
        nextVisit -= clockDt;
        if (nextVisit <= 0 && !start(car)) nextVisit = 5;
        wolf.howlPose = THREE.MathUtils.damp(wolf.howlPose ?? 0, 0, 6, dt);
        return;
      }
      wolf.behavior.down = 0;
      wolf.behavior.raised = 0.25;
      wolf.howlPose = THREE.MathUtils.damp(wolf.howlPose ?? 0, howling ? 1 : 0, 5, dt);
      if (phase === 'summit') {
        wolf.velocity = 0;
        wolf.chargeRun = 0;
        wolf.behavior.state = 'watching';
        drawTime += visitStay === null ? clockDt : dt;
        stayTime -= visitStay === null ? clockDt : dt;
        const interval = mode === 'night' ? 20 : 90;
        if (drawTime + 1e-8 >= interval) {
          drawTime = 0;
          draws++;
          if (!howling && random() < 0.4 && api.onHowl?.()) calls++;
        }
        // Stay for several draws. A long stay remains a normal gameplay state.
        if (stayTime <= 0 && !howling && wolf.howlPose < 0.02) descend();
        return;
      }
      while (path.length && Math.hypot(path[0].x - wolf.x, path[0].z - wolf.z) < 1e-5) path.shift();
      if (!path.length) {
        wolf.velocity = 0;
        wolf.chargeRun = 0;
        if (phase === 'approaching') enterTrail();
        else if (phase === 'ascending') {
          phase = 'summit';
          drawTime = 0;
          stayTime = visitStay ?? 240 + random() * 240;
        } else if (phase === 'descending') {
          phase = 'returning';
          path = [{ ...MOUNTAIN_GATE }];
        } else if (phase === 'returning' && inAnimalMeadow(wolf.x, wolf.z)) resetGround();
        return;
      }
      const goal = path[0],
        desired = Math.atan2(goal.x - wolf.x, goal.z - wolf.z);
      const error = angle(desired, wolf.heading);
      wolf.heading += THREE.MathUtils.clamp(error, -dt * 0.85, dt * 0.85);
      const trail = sheltered && phase !== 'returning';
      const speed =
        running && ['approaching', 'ascending'].includes(phase)
          ? (trail ? 1.4 : 3.2) *
            (path.length === 1
              ? Math.max(0.2, Math.min(1, Math.hypot(goal.x - wolf.x, goal.z - wolf.z) / 0.6))
              : 1)
          : trail
            ? 0.48
            : wolf.speed;
      const aligned = Math.abs(error) < 0.12;
      // Follow the checked centreline exactly after turning, avoiding shortcuts
      // over the outer edge of a hairpin or a steep rock face.
      wolf.velocity = THREE.MathUtils.damp(wolf.velocity, aligned ? speed : 0, 5, dt);
      wolf.chargeRun = THREE.MathUtils.damp(
        wolf.chargeRun ?? 0,
        running && ['approaching', 'ascending'].includes(phase)
          ? Math.min(1, wolf.velocity / 1.3)
          : 0,
        5,
        dt,
      );
      const distance = Math.hypot(goal.x - wolf.x, goal.z - wolf.z);
      const step = aligned ? Math.min(distance, wolf.velocity * dt) : 0;
      const next = { x: wolf.x + Math.sin(desired) * step, z: wolf.z + Math.cos(desired) * step };
      if (!clear(wolf, next, car, trail)) {
        wolf.velocity = 0;
        wolf.chargeRun = 0;
        blockedTime += dt;
        if (!sheltered && blockedTime > 5) resetGround();
        return;
      }
      blockedTime = 0;
      if (step > 0) {
        const oldY = trail
          ? mountainSupportHeight(wolf.x, wolf.z)
          : landscapeHeight(wolf.x, wolf.z);
        const newY = trail
          ? mountainSupportHeight(next.x, next.z)
          : landscapeHeight(next.x, next.z);
        wolf.distance += Math.hypot(step, newY - oldY);
        wolf.x = next.x;
        wolf.z = next.z;
      }
      wolf.behavior.state = 'walking';
    },
    snapshot: () => ({
      phase,
      running,
      visitStay,
      sheltered,
      mode,
      interval: mode === 'night' ? 20 : 90,
      drawTime,
      draws,
      calls,
      visits,
      howling,
      stayTime,
      nextVisit,
      blockedTime,
      remaining: path.length,
    }),
  };
  return api;
}
