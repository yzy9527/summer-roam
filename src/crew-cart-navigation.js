// Pose paths made from tangent circular arcs and straight lines. Heading is
// measured from +Z; reverse changes travel direction, never the vehicle pose.
export const CREW_TURN_RADIUS = 5.5;
const TAU = Math.PI * 2;
const positive = (a) => ((a % TAU) + TAU) % TAU;
const delta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function advanceCartPose(p, distance, curvature) {
  const heading = p.heading + distance * curvature;
  return Math.abs(curvature) < 1e-8
    ? { x: p.x + Math.sin(p.heading) * distance, z: p.z + Math.cos(p.heading) * distance, heading }
    : {
        x: p.x + (Math.cos(p.heading) - Math.cos(heading)) / curvature,
        z: p.z + (Math.sin(heading) - Math.sin(p.heading)) / curvature,
        heading,
      };
}

function candidates(from, to, reverse, radius) {
  const gear = reverse ? -1 : 1;
  const start = { ...from, heading: from.heading + (reverse ? Math.PI : 0) };
  const end = { ...to, heading: to.heading + (reverse ? Math.PI : 0) };
  const result = [];
  for (const a of [-1, 1])
    for (const b of [-1, 1]) {
      const r1 = a * radius,
        r2 = b * radius;
      const c1 = {
        x: start.x + Math.cos(start.heading) * r1,
        z: start.z - Math.sin(start.heading) * r1,
      };
      const c2 = { x: end.x + Math.cos(end.heading) * r2, z: end.z - Math.sin(end.heading) * r2 };
      const dx = c2.x - c1.x,
        dz = c2.z - c1.z,
        d = Math.hypot(dx, dz);
      if (d < 1e-8 && a === b) {
        const length = positive(a * (end.heading - start.heading)) * radius;
        result.push({
          segments: length > 1e-8 ? [{ length, curvature: (a / radius) * gear, gear }] : [],
          length,
        });
        continue;
      }
      if (d < Math.abs(r2 - r1) - 1e-8 || d < 1e-8) continue;
      const h = Math.atan2(dx, dz) - Math.asin(Math.max(-1, Math.min(1, (r2 - r1) / d)));
      const arcs = [positive(a * (h - start.heading)), positive(b * (end.heading - h))];
      // Floating point noise must not turn a straight segment into a full circle.
      for (let i = 0; i < 2; i++) if (arcs[i] > TAU - 1e-7) arcs[i] = 0;
      const straight = Math.sqrt(Math.max(0, d * d - (r2 - r1) ** 2));
      const segments = [
        { length: arcs[0] * radius, curvature: (a / radius) * gear, gear },
        { length: straight, curvature: 0, gear },
        { length: arcs[1] * radius, curvature: (b / radius) * gear, gear },
      ].filter((s) => s.length > 1e-7);
      result.push({ segments, length: segments.reduce((sum, s) => sum + s.length, 0) });
    }
  if (
    Math.hypot(from.x - to.x, from.z - to.z) < 1e-6 &&
    Math.abs(delta(from.heading, to.heading)) < 1e-6
  )
    result.push({ segments: [], length: 0 });
  return result.sort((a, b) => a.length - b.length);
}

export function planCartPosePath(
  from,
  to,
  allowed,
  { reverse = false, radius = CREW_TURN_RADIUS } = {},
) {
  for (const path of candidates(from, to, reverse, radius)) {
    let pose = { ...from },
      valid = true;
    for (const segment of path.segments) {
      const count = Math.ceil(segment.length / 0.75);
      for (let i = 0; i < count; i++) {
        pose = advanceCartPose(pose, (segment.gear * segment.length) / count, segment.curvature);
        if (!allowed(pose)) {
          valid = false;
          break;
        }
      }
      if (!valid) break;
    }
    if (
      valid &&
      Math.hypot(pose.x - to.x, pose.z - to.z) < 0.001 &&
      Math.abs(delta(pose.heading, to.heading)) < 0.001
    )
      return path.segments.map((s) => ({ ...s, remaining: s.length }));
  }
  return null;
}
