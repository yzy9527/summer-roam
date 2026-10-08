export const CALF_RENDEZVOUS = Object.freeze({ x: -26, z: -27, heading: -Math.PI / 2 });

export const CALF_CARRY_MODES = Object.freeze({
  'two-hand': Object.freeze({ x: 0, z: 1.25, height: 1.18, yaw: Math.PI / 2, squat: 0.9 }),
  underarm: Object.freeze({ x: -1.08, z: 0.08, height: 1.12, yaw: 0, squat: 0.85 }),
});
export const CALF_TASK_SPEED = Object.freeze({ walk: 2.4, carry: 1.9, steps: 1.1, run: 3.1 });
export const CALF_THROW = Object.freeze({
  windup: 0.4,
  swing: 0.3,
  flight: 0.7,
  settle: 0.4,
  arc: 1.05,
});
export const GUARD_PAT = Object.freeze({ reach: 0.22, tap: 0.22, retract: 0.4 });
export const CALF_HEIST_TRIGGER = Object.freeze({
  distance: 10,
  duration: 4,
  reunion: 7,
  cooldown: 30,
});
