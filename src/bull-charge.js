import { assetUrl } from './asset-url.js';
import { inStream, landscapeHeight } from './world-queries.js';
import { vehicleHitsObstacle } from './vehicle-collision.js';
import { VEHICLE_CONFIG } from './vehicle-config.js';
export const BULL_WARNING_URL = assetUrl('bull-cry');
export const BULL_VOICE_URL = assetUrl('bull-cry');
const angle = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// Only this interaction may leave the meadow. Water, scenery and other animals remain solid.
export function bullPointAllowed(x, z, a, obstacles, animals, car, contact = false) {
  if (x < -39 || x > 6 || z < -5 || z > 32) return false;
  for (const [dx, dz] of [
    [0, 0],
    [0.5, 0],
    [-0.5, 0],
    [0, 0.5],
    [0, -0.5],
  ])
    if (inStream(x + dx, z + dz)) return false;
  if (obstacles.some((o) => Math.hypot(x - o.x, z - o.z) < a.radius + o.radius + 0.15))
    return false;
  if (animals.some((b) => b !== a && Math.hypot(x - b.x, z - b.z) < a.radius + b.radius + 0.35))
    return false;
  return (
    !car ||
    !vehicleHitsObstacle(car.x, car.z, car.heading, {
      x,
      z,
      radius: contact ? 0.43 : a.radius + 0.1,
    })
  );
}
export function bullRoute(start, goal, safe) {
  if (!safe(goal.x, goal.z)) return null;
  const clear = (a, b) => {
    const n = Math.max(1, Math.ceil(distance(a, b) / 0.12));
    for (let i = 1; i <= n; i++)
      if (!safe(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n)) return false;
    return true;
  };
  if (clear(start, goal)) return [goal];
  const step = 0.8,
    nx = 57,
    nz = 47,
    nodes = [start, goal];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) nodes.push({ x: -39 + i * step, z: -5 + j * step });
  const valid = nodes.map((p) => safe(p.x, p.z)),
    cost = nodes.map(() => Infinity),
    prev = [],
    open = new Set([0]),
    closed = new Set();
  cost[0] = 0;
  while (open.size) {
    let k = -1,
      best = Infinity;
    for (const i of open) {
      const score = cost[i] + distance(nodes[i], goal);
      if (score < best) {
        k = i;
        best = score;
      }
    }
    if (k === 1) {
      const path = [];
      for (let i = 1; i !== 0; i = prev[i]) path.unshift(nodes[i]);
      const result = [];
      let at = start;
      while (path.length) {
        let far = path.length - 1;
        while (far > 0 && !clear(at, path[far])) far--;
        at = path[far];
        result.push(at);
        path.splice(0, far + 1);
      }
      return result;
    }
    open.delete(k);
    closed.add(k);
    const p = nodes[k],
      ix = Math.round((p.x + 39) / step),
      iz = Math.round((p.z + 5) / step),
      neighbors = [1];
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const x = ix + dx,
          z = iz + dz;
        if (x >= 0 && x < nx && z >= 0 && z < nz) neighbors.push(2 + x * nz + z);
      }
    for (const j of neighbors) {
      if (j === k || closed.has(j) || !valid[j]) continue;
      const d = distance(p, nodes[j]);
      if ((j !== 1 && d > 1.8) || cost[k] + d >= cost[j] || !clear(p, nodes[j])) continue;
      cost[j] = cost[k] + d;
      prev[j] = k;
      open.add(j);
    }
  }
  return null;
}
export function bullHornGap(points, car) {
  const c = Math.cos(car.heading),
    s = Math.sin(car.heading);
  return Math.min(
    ...points.map((p) => {
      const dx = p.x - car.x,
        dz = p.z - car.z,
        x = Math.abs(dx * c - dz * s),
        z = Math.abs(dx * s + dz * c - VEHICLE_CONFIG.collisionCenterZ);
      return Math.hypot(
        Math.max(0, x - 0.83 * VEHICLE_CONFIG.modelScale),
        Math.max(0, z - 1.75 * VEHICLE_CONFIG.modelScale),
      );
    }),
  );
}
export function createBullCharge(
  animals,
  safe,
  onImpact = () => {},
  onStopVoice = () => {},
  clock = {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    now: () => performance.now(),
  },
) {
  const bull = animals.find((a) => a.id === 'copper-cow');
  let phase = 'idle',
    time = 0,
    total = 0,
    voiceTime = 0,
    voiceReleased = true,
    cooldown = 0,
    reason = '',
    origin = null,
    returnGoal = null,
    parked = null,
    path = [],
    contact = null,
    impacts = 0,
    taps = 0,
    returnRetry = 0;
  let launchTimer = null,
    launchReady = false,
    cooldownUntil = 0,
    lastClock = clock.now(),
    mode = 'tap',
    vehicleHits = 0,
    chaseWait = 0;
  const refreshCooldown = () => (cooldown = Math.max(0, (cooldownUntil - clock.now()) / 1000));
  function clearLaunch() {
    if (launchTimer !== null) clock.clearTimeout(launchTimer);
    launchTimer = null;
    launchReady = false;
  }
  function set(next) {
    if (next !== 'warning') clearLaunch();
    phase = next;
    time = 0;
    bull.target = null;
    bull.behavior.escape = null;
    bull.behavior.driveTime = 0;
  }
  function release() {
    set('idle');
    mode = 'tap';
    bull.velocity = 0;
    bull.wait = 2;
    bull.chargePose = 0;
    bull.chargeRun = 0;
    bull.chargePaw = 0;
    bull.collider && (bull.collider.radius = bull.radius);
    Object.assign(bull.behavior, {
      state: 'idle',
      time: 0,
      down: 0,
      raised: 0,
      cooldown: 0,
      reactionTime: 10,
    });
  }
  function returning(why) {
    if (phase === 'idle' || phase === 'returning') return;
    reason = why;
    if (why !== 'complete') {
      voiceReleased = true;
      onStopVoice();
      cooldown = cooldownUntil = 0;
    }
    set('returning');
    path = [];
    returnGoal = null;
    returnRetry = 0;
  }
  function carMoved(car) {
    return (
      parked &&
      (Math.abs(car.speed) > 0.03 ||
        distance(car, parked) > 0.025 ||
        Math.abs(angle(car.heading, parked.heading)) > 0.015)
    );
  }
  function face(goal, dt, rate = 1.8) {
    const error = angle(Math.atan2(goal.x - bull.x, goal.z - bull.z), bull.heading);
    bull.heading += Math.max(-dt * rate, Math.min(dt * rate, error));
    return error;
  }
  function move(dt, speed, car, allowContact = false, reverse = false) {
    const goal = path[0];
    if (!goal) {
      bull.velocity *= Math.exp(-dt * 8);
      return true;
    }
    const d = distance(bull, goal);
    if (d < 0.035) {
      path.shift();
      bull.velocity = 0;
      return !path.length;
    }
    const error = reverse ? 0 : face(goal, dt),
      desired = speed * (Math.abs(error) < 0.15 ? 1 : 0) * Math.min(1, d / 0.8);
    bull.velocity += (desired - bull.velocity) * (1 - Math.exp(-dt * 4));
    const step = Math.abs(error) > 0.15 && !reverse ? 0 : Math.min(d, bull.velocity * dt),
      dx = (goal.x - bull.x) / d,
      dz = (goal.z - bull.z) / d,
      x = bull.x + dx * step,
      z = bull.z + dz * step;
    const samples = Math.max(1, Math.ceil(step / 0.08));
    for (let i = 1; i <= samples; i++)
      if (
        !safe(
          bull.x + (dx * step * i) / samples,
          bull.z + (dz * step * i) / samples,
          bull,
          car,
          allowContact,
        )
      ) {
        bull.velocity = 0;
        return null;
      }
    bull.x = x;
    bull.z = z;
    bull.distance += step;
    return false;
  }
  function plan(car) {
    const points = bull.rig.hornPoints(),
      reach = Math.max(
        bull.rig.contactReach,
        ...points.map(
          (p) => (p.x - bull.x) * Math.sin(bull.heading) + (p.z - bull.z) * Math.cos(bull.heading),
        ),
      );
    if (!Number.isFinite(reach) || reach < 0.45) return false;
    const c = Math.cos(car.heading),
      s = Math.sin(car.heading);
    let best = null;
    for (const [dx, dz, extent] of [
      [c, -s, 0.83 * VEHICLE_CONFIG.modelScale],
      [-c, s, 0.83 * VEHICLE_CONFIG.modelScale],
      [s, c, 1.75 * VEHICLE_CONFIG.modelScale],
      [-s, -c, 1.75 * VEHICLE_CONFIG.modelScale],
    ]) {
      const goal = {
          x: car.x + dx * (extent + reach + 0.025),
          z: car.z + dz * (extent + reach + 0.025),
        },
        route = bullRoute(bull, goal, (x, z) => safe(x, z, bull, car, true));
      if (route) {
        const length = route.reduce((sum, p, i) => sum + distance(i ? route[i - 1] : bull, p), 0);
        if (!best || length < best.length) best = { goal, route, length, dx, dz };
      }
    }
    if (!best) return false;
    contact = best;
    path = best.route;
    return true;
  }
  function responseActive() {
    return mode !== 'tap' && phase !== 'idle';
  }
  function response(car, nextMode) {
    if (!bull?.rig || phase !== 'idle') return false;
    mode = nextMode;
    origin = { x: bull.x, z: bull.z };
    parked = { ...car };
    returnGoal = null;
    contact = null;
    path = [];
    reason = '';
    time = total = voiceTime = 0;
    chaseWait = 0;
    voiceReleased = true;
    cooldown = cooldownUntil = 0;
    bull.recoil = null;
    bull.collisionEscape = false;
    bull.velocity = 0;
    set('warning');
    Object.assign(bull.behavior, { down: 0, raised: 0, reactionTime: 10 });
    return true;
  }
  return {
    responseBusy: responseActive,
    protect(car) {
      return response(car, 'protect');
    },
    vehicleHit(car) {
      if (responseActive()) return { ignored: true, triggered: false };
      // A car collision replaces a mouse-driven attack, without changing tap counts.
      if (bull) {
        reason = 'car-collision';
        voiceReleased = true;
        onStopVoice();
        cooldown = cooldownUntil = 0;
        path = [];
        release();
        bull.homeX = bull.x;
        bull.homeZ = bull.z;
      }
      vehicleHits = Math.min(3, vehicleHits + 1);
      return { ignored: false, triggered: vehicleHits >= 3 && response(car, 'revenge') };
    },
    flee() {
      if (!bull || responseActive()) return;
      reason = 'car-collision';
      voiceReleased = true;
      onStopVoice();
      cooldown = cooldownUntil = 0;
      path = [];
      release();
      bull.homeX = bull.x;
      bull.homeZ = bull.z;
    },
    owns: (a) => a === bull && phase !== 'idle',
    busy: () => phase !== 'idle',
    tap(car) {
      if (responseActive()) return false;
      refreshCooldown();
      if (!bull?.rig) return false;
      taps = Math.min(3, taps + 1);
      if (carMoved(car) && ['idle', 'returning'].includes(phase)) {
        cooldown = cooldownUntil = 0;
        if (!voiceReleased) onStopVoice();
        voiceReleased = true;
      }
      if (taps < 3 || !['idle', 'returning'].includes(phase) || cooldown > 0 || !voiceReleased)
        return false;
      if (Math.abs(car.speed) > 0.03) {
        reason = 'car-moving';
        return false;
      }
      if (phase !== 'returning') origin = { x: bull.x, z: bull.z };
      returnGoal = null;
      parked = { ...car };
      reason = '';
      time = total = voiceTime = 0;
      voiceReleased = false;
      set('pending');
      bull.velocity = 0;
      Object.assign(bull.behavior, { down: 0, raised: 0, reactionTime: 10 });
      return true;
    },
    event(type, currentTime = 0) {
      if (mode !== 'tap') {
        if (type === 'ended' || type === 'cancel') voiceReleased = true;
        return;
      }
      if (type === 'cancel') {
        voiceReleased = true;
        returning('audio-cancelled');
        return;
      }
      if (type === 'playing' && phase === 'pending') {
        set('warning');
        launchTimer = clock.setTimeout(() => {
          launchTimer = null;
          if (phase === 'warning') launchReady = true;
        }, 1000);
      }
      if (type === 'time') voiceTime = currentTime;
      if (type === 'ended') {
        voiceReleased = true;
        voiceTime = Math.max(voiceTime, 6.8);
        onStopVoice();
      }
    },
    snapshot: () => ({
      phase,
      mode,
      vehicleHits,
      time,
      total,
      voiceTime,
      voiceReleased,
      cooldown,
      reason,
      taps,
      impacts,
      origin,
      goal: contact?.goal,
    }),
    update(dt, car) {
      const now = clock.now();
      if (dt <= 0) {
        if (cooldownUntil > 0) cooldownUntil += now - lastClock;
        lastClock = now;
        return;
      }
      lastClock = now;
      refreshCooldown();
      if (mode === 'tap' && carMoved(car)) {
        cooldown = cooldownUntil = 0;
        if (!['idle', 'returning'].includes(phase)) returning('car-moved');
        else {
          if (!voiceReleased) onStopVoice();
          voiceReleased = true;
        }
      }
      if (phase === 'idle') return;
      time += dt;
      total += dt;
      bull.behavior.down = 0;
      bull.behavior.raised = 0;
      bull.behavior.swishTime += dt;
      const lowered = ['warning', 'approaching', 'strike'].includes(phase);
      bull.chargePose ??= 0;
      bull.chargeRun ??= 0;
      bull.chargePose += ((lowered ? 1 : 0) - bull.chargePose) * (1 - Math.exp(-dt * 6));
      bull.chargeRun +=
        ((phase === 'approaching' ? Math.min(1, bull.velocity / 5.5) : 0) - bull.chargeRun) *
        (1 - Math.exp(-dt * 5));
      bull.chargePaw =
        phase === 'warning' && time > 0.12 && time < 0.85
          ? Math.sin((Math.PI * (time - 0.12)) / 0.73) ** 2
          : 0;
      if (phase === 'pending') {
        if (time > 8) returning('audio-timeout');
        return;
      }
      if (phase === 'warning') {
        if (mode !== 'tap') {
          parked = { ...car };
          if (time >= 1) launchReady = true;
        }
        if (time > 14) {
          returning('voice-timeout');
          return;
        }
        face(parked, dt, 4);
        if (launchReady) {
          if (!plan(parked)) {
            returning('no-safe-route');
            return;
          }
          set('approaching');
        }
        return;
      }
      if (phase === 'approaching') {
        if (mode !== 'tap') {
          chaseWait -= dt;
          if (
            chaseWait <= 0 &&
            (distance(car, parked) > 0.35 || Math.abs(angle(car.heading, parked.heading)) > 0.15)
          ) {
            parked = { ...car };
            chaseWait = 0.5;
            if (!plan(parked)) {
              returning('no-safe-route');
              return;
            }
          }
        }
        if (time > 45) {
          returning('approach-timeout');
          return;
        }
        const arrived = move(dt, 5.5, mode === 'tap' ? parked : car, true);
        if (arrived === null) {
          returning('path-blocked');
          return;
        }
        if (arrived) {
          set('strike');
          bull.velocity = 0;
        }
        return;
      }
      if (phase === 'strike') {
        if (
          mode !== 'tap' &&
          (distance(car, parked) > 0.06 || Math.abs(angle(car.heading, parked.heading)) > 0.03)
        ) {
          parked = { ...car };
          if (!plan(parked)) {
            returning('no-safe-route');
            return;
          }
          set('approaching');
          return;
        }
        if (mode !== 'tap') parked = { ...car };
        face(parked, dt);
        const points = bull.rig.hornPoints(),
          gap = bullHornGap(points, parked);
        const ground = landscapeHeight(parked.x, parked.z);
        if (gap <= 0.055 && points.some((p) => p.y > ground + 0.35 && p.y < ground + 1.48)) {
          impacts++;
          if (mode === 'revenge') vehicleHits = 0;
          onImpact({
            heading: bull.heading,
            car: parked,
            impacts,
            mode,
            flip: mode !== 'tap' || impacts > 1,
          });
          set('recoil');
          path = [{ x: bull.x + contact.dx * 0.6, z: bull.z + contact.dz * 0.6 }];
          return;
        }
        if (time > 1.5) {
          returning('contact-unreachable');
          return;
        }
        // Final controlled push follows the actual horn point, never the broad animal collider.
        const step = Math.min(0.18 * dt, Math.max(0, gap - 0.025)),
          x = bull.x + Math.sin(bull.heading) * step,
          z = bull.z + Math.cos(bull.heading) * step;
        if (!safe(x, z, bull, parked, true)) {
          returning('contact-blocked');
          return;
        }
        bull.x = x;
        bull.z = z;
        bull.distance += step;
        bull.velocity = step / dt;
        return;
      }
      if (phase === 'recoil') {
        if (move(dt, 0.45, car, true, true) !== false || time > 2) {
          returning('complete');
          cooldownUntil = clock.now() + 5000;
          cooldown = 5;
        }
        return;
      }
      if (phase === 'returning') {
        if (!path.length) {
          if (distance(bull, returnGoal ?? origin) < 0.06) {
            release();
            return;
          }
          returnRetry -= dt;
          if (returnRetry > 0) return;
          const goals = [origin];
          for (const radius of [0.5, 1, 1.5])
            for (let i = 0; i < 8; i++)
              goals.push({
                x: origin.x + Math.cos((i * Math.PI) / 4) * radius,
                z: origin.z + Math.sin((i * Math.PI) / 4) * radius,
              });
          for (const goal of goals) {
            if (Math.hypot(goal.x - bull.homeX, goal.z - bull.homeZ) > bull.range) continue;
            const route = bullRoute(bull, goal, (x, z) => safe(x, z, bull, car, true));
            if (route) {
              path = route;
              returnGoal = goal;
              break;
            }
          }
          if (!path.length) {
            returnRetry = 1;
            return;
          }
        }
        if (move(dt, 0.85, car, true) === null) {
          path = [];
          returnRetry = 0.5;
        }
      }
    },
  };
}
// Warning hands off to speech without overlap; the scene gates subsequent attacks.
export function createBullVoice(media, hooks, onChange = () => {}, warningMedia = null) {
  let busy = false,
    generation = 0,
    warningBusy = false,
    warningGeneration = 0,
    error = '';
  media.preload = 'auto';
  media.loop = false;
  const stopWarning = () => {
    warningGeneration++;
    warningBusy = false;
    if (warningMedia) {
      warningMedia.pause();
      warningMedia.currentTime = 0;
    }
  };
  if (warningMedia) {
    warningMedia.preload = 'auto';
    warningMedia.loop = false;
    warningMedia.addEventListener('ended', () => {
      stopWarning();
      onChange();
    });
    warningMedia.addEventListener('error', () => {
      stopWarning();
      error = '公牛警告声音暂不可用';
      onChange();
    });
  }
  const stop = () => {
    stopWarning();
    generation++;
    busy = false;
    media.pause();
    media.currentTime = 0;
    onChange();
  };
  media.addEventListener('playing', () => {
    if (busy) hooks.event?.('playing');
    onChange();
  });
  media.addEventListener('timeupdate', () => {
    if (busy) hooks.event?.('time', media.currentTime);
  });
  media.addEventListener('ended', () => {
    if (busy) hooks.event?.('ended');
    onChange();
  });
  media.addEventListener('error', () => {
    if (busy) {
      stop();
      hooks.event?.('cancel');
    }
    error = '公牛声音暂不可用';
    onChange();
  });
  return {
    tap(hit, enabled) {
      if (hit?.id !== 'copper-cow' || !enabled || busy) return false;
      if (hit.taps === 2 && !hit.charge && warningMedia) {
        warningBusy = true;
        error = '';
        const ticket = ++warningGeneration;
        warningMedia.currentTime = 0;
        try {
          Promise.resolve(warningMedia.play()).catch(() => {
            if (ticket !== warningGeneration) return;
            stopWarning();
            error = '公牛警告声音未能播放';
            onChange();
          });
        } catch {
          stopWarning();
          error = '公牛警告声音未能播放';
        }
        onChange();
        return true;
      }
      if (!hit.charge) return false;
      stopWarning();
      busy = true;
      error = '';
      const ticket = ++generation;
      media.currentTime = 0;
      try {
        Promise.resolve(media.play()).catch(() => {
          if (ticket !== generation) return;
          stop();
          error = '公牛声音未能播放';
          hooks.event?.('cancel');
          onChange();
        });
      } catch {
        stop();
        hooks.event?.('cancel');
      }
      onChange();
      return true;
    },
    stop,
    cancel() {
      if (busy) hooks.event?.('cancel');
      stop();
    },
    snapshot: () => ({
      busy,
      time: media.currentTime,
      paused: media.paused,
      error,
      file: BULL_VOICE_URL,
      warning: {
        file: BULL_WARNING_URL,
        busy: warningBusy,
        time: warningMedia?.currentTime ?? 0,
        paused: warningMedia?.paused ?? true,
      },
    }),
  };
}
