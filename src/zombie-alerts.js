import { CORRAL } from './corral-model.js';
import { nearestEscapePoint } from './calf-escape-route.js';

export function calfInSight(actor, target, visible, range = 12) {
  const p = actor.object.position;
  const dx = target.x - p.x,
    dz = target.z - p.z,
    d = Math.hypot(dx, dz);
  if (d > range || d < 1e-6) return false;
  const gaze = actor.rig.gazeDirection();
  const length = Math.hypot(gaze.x, gaze.z);
  return (
    length > 1e-6 &&
    (dx * gaze.x + dz * gaze.z) / (d * length) >= Math.SQRT1_2 &&
    visible(p, target)
  );
}

// Sample the actual escape corridor or the remaining terrain with equal weight.
export function chooseGiantPatrolGoal(p, random, allowed, escapeSide = random() < 0.5) {
  // Roll the category once. Rejected terrain must not re-roll its 50% weight.
  const corridor = nearestEscapePoint(p);
  const away = Math.atan2(p.x - CORRAL.x, p.z - CORRAL.z);
  for (let i = 0; i < 24; i++) {
    const heading = away + random() * Math.PI * 2;
    const length = (i < 16 ? 8 : 3) + random() * 12;
    const side = (random() - 0.5) * 10;
    const point = escapeSide
      ? {
          x: corridor.x + corridor.dx * length - corridor.dz * side,
          z: corridor.z + corridor.dz * length + corridor.dx * side,
        }
      : { x: p.x + Math.sin(heading) * length, z: p.z + Math.cos(heading) * length };
    if (nearestEscapePoint(point).distance <= 7 === escapeSide && allowed(point))
      return { ...point, escapeSide };
  }
  return null;
}
