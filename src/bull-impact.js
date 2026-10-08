// Visual impulse for the whole assembled car. Driving coordinates stay stable.
export function bullImpactPose(hit) {
  if (!hit) return { roll: 0, lift: 0, shift: 0, locked: false, done: true };
  const t = hit.time,
    side = Math.sign(hit.side) || 1;
  if (!hit.flip) return { roll: 0, lift: 0, shift: 0, locked: false, done: t >= 0.65 };
  const ease = (x) => {
    x = Math.max(0, Math.min(1, x));
    return x * x * (3 - 2 * x);
  };
  const progress = t < 0.8 ? ease(t / 0.8) : t < 2.8 ? 1 : 1 - ease((t - 2.8) / 0.9);
  const roll = side * Math.PI * progress;
  // Rotate about the body's mid-height, keeping the roof above the ground upside down.
  const halfHeight = 0.73;
  return {
    roll,
    lift: halfHeight * (1 - Math.cos(roll)) + 0.12 * Math.sin(Math.PI * progress),
    shift: side * (0.52 * progress - halfHeight * Math.sin(roll)),
    locked: t < 3.7,
    done: t >= 3.7,
  };
}
