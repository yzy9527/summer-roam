import { cowRetreatTarget } from './cow-behavior.js';
// Short feedback during family interaction never queues or changes the audio clock.
export function familyDriveFeedback(a, source, allowed) {
  const b = a.behavior;
  if ((b.feedbackCooldown || 0) > 0) return false;
  b.feedbackCooldown = 1.2;
  b.reactionTime = 0;
  b.swishTime = 0;
  b.swishSide = a.taps % 2 ? 1 : -1;
  b.swishStrength = 1;
  const target = cowRetreatTarget(a, source, allowed, [0.22, 0.14, 0.08]);
  a.recoil = { time: 0, start: { x: a.x, z: a.z }, target };
  return true;
}
export function updateFamilyDrive(a, dt, allowed) {
  const r = a.recoil;
  if (!r || dt <= 0) return false;
  r.time += dt;
  const t = Math.min(1, r.time / 0.7),
    s = t * t * (3 - 2 * t);
  a.velocity = 0;
  if (r.target) {
    const x = r.start.x + (r.target.x - r.start.x) * s,
      z = r.start.z + (r.target.z - r.start.z) * s;
    if (allowed(x, z)) {
      const d = Math.hypot(x - a.x, z - a.z);
      a.x = x;
      a.z = z;
      a.distance += d;
      a.velocity = d / dt;
    } else r.target = null;
  }
  if (t >= 1) {
    a.recoil = null;
    a.velocity = 0;
    return true;
  }
  return false;
}
export function reactionAmount(b) {
  const t = b?.reactionTime ?? 10;
  return t < 1.1 ? Math.sin((Math.PI * Math.max(0, t)) / 1.1) ** 2 : 0;
}
