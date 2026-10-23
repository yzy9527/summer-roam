// Timings use active game seconds. Only the independent browncoat opts in.
export const COMEDY_ACTIONS = Object.freeze([
  { id: 'reboot', label: 'actions.comedyreboot', duration: 4.8, weight: 3 },
  { id: 'scratch', label: 'actions.comedyscratch', duration: 5.4, weight: 3 },
  { id: 'scare', label: 'actions.comedyscare', duration: 5, weight: 3 },
  { id: 'dance', label: 'actions.comedydance', duration: 7.2, weight: 1 },
  { id: 'trip', label: 'actions.comedytrip', duration: 6.2, weight: 1 },
  { id: 'disco', label: 'actions.comedyDisco', duration: 9.2, weight: 1 },
  { id: 'pursuit', label: 'actions.comedyPursuit', duration: 7.8, weight: 2 },
]);
const clamp = (v) => Math.max(0, Math.min(1, v));
const ease = (v) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};
const pulse = (t, a, b, c, d) => ease((t - a) / (b - a)) * (1 - ease((t - c) / (d - c)));

export function comedyPose(id, t, duration) {
  const amount = ease(t / 0.5) * ease((duration - t) / 0.65);
  const p = {
    amount,
    head: [0, 0, 0],
    spine: [0.1, 0, 0],
    hips: [0, 0, 0],
    left: [0.12, -0.26, 0.34],
    right: [-0.12, -0.26, 0.34],
    jaw: 0.07,
    curl: 0.2,
    steps: 0,
    feet: null,
    speed: 0,
    run: 0,
  };
  if (id === 'reboot') {
    const restart = ease((t - 2.7) / 0.18);
    p.head = [0.22 * (1 - restart), Math.sin(t * 5) * restart * 0.3, 0.55 * (1 - restart)];
    p.spine = [0.18, 0, Math.sin(t * 24) * pulse(t, 2, 2.1, 2.5, 2.7) * 0.08];
    p.jaw = 0.28 * (1 - restart);
  } else if (id === 'scratch') {
    const scratch = pulse(t, 0.4, 0.9, 2.4, 2.9);
    const shrug = pulse(t, 3.4, 3.7, 4.3, 4.8);
    p.right = [-0.09, -0.26 + scratch * 0.64 + shrug * 0.3, 0.34 - scratch * 0.3];
    p.right[1] += Math.sin(t * 18) * 0.025 * scratch;
    p.left = [0.12 + shrug * 0.2, -0.26 + shrug * 0.3, 0.34];
    p.head = [0.1, -0.25 * pulse(t, 2.6, 3, 3.3, 3.7), -scratch * 0.3];
    p.curl = 0.55 * scratch;
  } else if (id === 'scare') {
    const lunge = pulse(t, 0.9, 1.12, 2.7, 3.7);
    const crouch = pulse(t, 0.1, 0.5, 0.85, 1.15);
    p.hips = [0, -crouch * 0.07, 0];
    p.spine = [0.1 + crouch * 0.22 - lunge * 0.15, 0, 0];
    p.left = [0.28, -0.26 + lunge * 0.43, 0.34 + lunge * 0.16];
    p.right = [-0.28, p.left[1], p.left[2]];
    p.head = [0.25 * ease((t - 3) / 0.7), 0, 0];
    p.jaw = 0.07 + lunge * 0.3;
    p.curl = 0.7 * lunge;
  } else if (id === 'dance') {
    const beat = t * Math.PI * 3;
    const dance = pulse(t, 0.4, 0.9, 5.1, 5.6);
    const finish = pulse(t, 5.5, 5.8, 6.3, 6.7);
    p.hips = [Math.sin(beat) * 0.055 * dance, -(1 - Math.cos(beat * 2)) * 0.025 * dance, 0];
    p.spine = [0.1, Math.sin(beat) * 0.22 * dance, Math.sin(beat) * 0.1 * dance];
    p.head = [-0.12 * finish, 0, -Math.sin(beat) * 0.18 * dance];
    p.left = [0.3, -0.1 + Math.sin(beat) * 0.14 * dance + finish * 0.4, 0.3];
    p.right = [-0.3, -0.1 - Math.sin(beat) * 0.14 * dance, 0.3];
    p.steps = dance;
  } else if (id === 'disco') {
    const dancing = pulse(t, 0.65, 1, 7.1, 7.6);
    const beat = (t - 1) * Math.PI * 2;
    const cycle = (((t - 1) % 1) + 1) % 1;
    // Running-man steps lead into hops and finish with a side-to-side groove.
    const airborne = cycle > 0.28 && cycle < 0.7;
    const flight = airborne ? (cycle - 0.28) / 0.42 : 0;
    const hopping = pulse(t, 3.2, 3.6, 6.1, 6.45);
    const height = airborne ? 0.18 * 4 * flight * (1 - flight) * dancing * hopping : 0;
    const compression = pulse(cycle, 0, 0.16, 0.2, 0.28) + pulse(cycle, 0.7, 0.8, 0.86, 1);
    const splay = Math.sin(Math.PI * flight) * 0.1 * dancing * hopping;
    const finish = pulse(t, 7.65, 8, 8.5, 8.85);
    p.hips = [
      Math.sin(beat) * 0.065 * dancing,
      height -
        compression * 0.075 * dancing * hopping -
        (1 - Math.cos(beat * 2)) * 0.025 * dancing * (1 - hopping),
      0,
    ];
    p.spine = [0.12, Math.sin(beat) * 0.32 * dancing, Math.sin(beat) * 0.14 * dancing];
    p.head = [
      Math.sin(beat * 2) * 0.14 * dancing - 0.12 * finish,
      Math.sin(beat) * 0.4 * dancing,
      -Math.sin(beat - 0.4) * 0.3 * dancing,
    ];
    const both = pulse(t, 2.8, 3.2, 5.4, 5.8);
    p.left = [
      0.25 + splay + Math.cos(beat * 0.5) * 0.1 * dancing,
      0.12 + 0.38 * (both + (1 - both) * Math.max(0, Math.sin(beat))) * dancing + finish * 0.32,
      0.12 + Math.sin(beat * 0.7) * 0.22 * dancing,
    ];
    p.right = [
      -0.25 - splay - Math.sin(beat * 0.6 + 1) * 0.1 * dancing,
      0.12 + 0.38 * (both + (1 - both) * Math.max(0, -Math.sin(beat))) * dancing,
      0.12 + Math.sin(beat * 0.8 + 2) * 0.22 * dancing,
    ];
    p.feet = [0, 1].map((i) => {
      const lift = Math.max(0, Math.sin(beat + i * Math.PI)) ** 2 * dancing * (1 - hopping);
      return [
        (i ? -1 : 1) * (splay + (t > 6.3 ? lift * 0.1 : 0)),
        height + lift * 0.12,
        t < 3.6 ? -lift * 0.08 : 0,
      ];
    });
    p.armExtension = [0.88 + Math.sin(beat - 0.4) * 0.1, 0.86 + Math.cos(beat * 0.8 + 0.6) * 0.11];
    p.curl = 0.08;
    p.jaw = 0.15;
  } else if (id === 'pursuit') {
    const reach = pulse(t, 0.2, 0.8, 6.5, 7.25);
    const sprint = pulse(t, 2, 2.6, 5.1, 5.8);
    const grab = pulse(t, 5.7, 6, 6.35, 6.8);
    const stroke = Math.PI * 2 * (0.65 * t + 0.65 * Math.max(0, t - 2.2));
    p.speed = 0.36 * pulse(t, 0.8, 1.1, 5.4, 6) + 1.15 * sprint;
    p.run = sprint;
    p.spine = [
      0.1 + reach * 0.25 + sprint * 0.12 + Math.sin(stroke) * reach * 0.045,
      Math.sin(stroke) * reach * 0.1,
      Math.sin(stroke - 0.4) * reach * 0.07,
    ];
    p.head = [
      reach * (0.38 + Math.sin(stroke * 1.4) * 0.12),
      Math.sin(stroke * 0.8) * reach * 0.34,
      Math.sin(stroke) * reach * 0.24,
    ];
    // A repeated breaststroke-like scramble: reach, sweep wide, fold and reach again.
    for (const [i, side] of ['left', 'right'].entries()) {
      const phase = stroke + (i ? Math.PI + Math.sin(t * 1.7) * 0.3 : 0);
      const wide = (1 - Math.cos(phase)) * 0.5;
      p[side] = [
        (i ? -1 : 1) * (0.12 + wide * 0.23 * reach - grab * 0.05),
        -0.26 + reach * ((i ? 0.3 : 0.36) + Math.cos(phase - 0.4) * (i ? 0.1 : 0.14)),
        0.34 + reach * (Math.sin(phase) * (i ? 0.23 : 0.19) - 0.04) + grab * 0.14,
      ];
    }
    p.curl = 0.4 + Math.max(0, Math.sin(stroke)) * reach * 0.3 + grab * 0.25;
    p.jaw = 0.07 + reach * 0.17;
  } else if (id === 'trip') {
    const fall = pulse(t, 0.7, 1.05, 2.3, 3.4);
    const look = pulse(t, 3.5, 3.8, 4.4, 4.9);
    p.hips = [0, -fall * 0.045, fall * 0.06];
    p.spine = [0.1 + fall * 0.55, 0, Math.sin(t * 13) * fall * 0.1];
    p.left = [0.32, -0.1 + Math.sin(t * 14) * fall * 0.24, 0.4];
    p.right = [-0.32, -0.1 - Math.sin(t * 14) * fall * 0.24, 0.4];
    p.head = [-fall * 0.2, Math.sin((t - 3.5) * 5) * look * 0.45, 0];
    p.steps = fall;
  }
  return p;
}

export function createComedy({
  random = Math.random,
  clear,
  settle,
  move = () => true,
  pose,
  finish,
}) {
  let wait = 10 + random() * 10,
    active = null,
    last = null;
  function cancel() {
    if (active) finish();
    active = null;
    wait = 10 + random() * 10;
  }
  function start(id) {
    const action = COMEDY_ACTIONS.find((a) => a.id === id);
    if (!action || active || !clear()) return false;
    active = { ...action, time: 0, settling: true };
    last = id;
    return true;
  }
  return {
    start,
    cancel,
    get active() {
      return !!active;
    },
    update(dt) {
      if (!(dt > 0)) return !!active;
      if (!active) {
        wait -= dt;
        if (wait > 0) return false;
        const options = COMEDY_ACTIONS.filter((a) => a.id !== last);
        let choice = random() * options.reduce((sum, a) => sum + a.weight, 0);
        const action = options.find((a) => (choice -= a.weight) < 0) ?? options.at(-1);
        if (!start(action.id)) {
          wait = 1;
          return false;
        }
      }
      if (!clear()) {
        cancel();
        return false;
      }
      if (active.settling) {
        active.settling = !settle(dt);
        return true;
      }
      active.time = Math.min(active.duration, active.time + dt);
      const p = comedyPose(active.id, active.time, active.duration);
      if (!move(p, dt)) {
        cancel();
        return false;
      }
      pose(p, active.time);
      if (active.time >= active.duration) cancel();
      return true;
    },
    snapshot: () => ({
      wait,
      action: active?.id ?? null,
      time: active?.time ?? 0,
      settling: active?.settling ?? false,
    }),
  };
}
