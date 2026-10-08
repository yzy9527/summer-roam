// Visibility is ground-level scenery/character clearance, not foliage opacity.
export function rescueVisible(from, to, colliders, ignore = () => false) {
  const dx = to.x - from.x,
    dz = to.z - from.z,
    length2 = dx * dx + dz * dz;
  if (length2 < 1e-9) return true;
  return !colliders.some((c) => {
    if (ignore(c) || !c.radius) return false;
    const t = ((c.x - from.x) * dx + (c.z - from.z) * dz) / length2;
    return t > 0 && t < 1 && Math.hypot(c.x - from.x - dx * t, c.z - from.z - dz * t) < c.radius;
  });
}
