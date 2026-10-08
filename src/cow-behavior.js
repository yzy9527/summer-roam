const smooth = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
export function createCowBehavior(species = 'cow') {
  return {
    species,
    state: 'idle',
    time: 0,
    duration: 2,
    down: 0,
    raised: 0,
    cooldown: 0,
    pats: 0,
    escape: null,
    alertDown: 0,
    swishTime: 2,
    swishStrength: 1,
    swishSide: 1,
    reactionTime: 10,
    driveTime: 0,
    feedbackCooldown: 0,
  };
}
export function updateCowBehavior(b, dt, moving, random = Math.random) {
  if (dt <= 0) return;
  b.swishTime += dt;
  b.reactionTime = (b.reactionTime ?? 10) + dt;
  b.driveTime = Math.max(0, (b.driveTime || 0) - dt);
  b.feedbackCooldown = Math.max(0, (b.feedbackCooldown || 0) - dt);
  b.cooldown = Math.max(0, b.cooldown - dt);
  if (moving && b.state !== 'alert') {
    b.state = 'walking';
    b.time = 0;
    b.down = 0;
    b.raised = 0;
    return;
  }
  if (b.state === 'walking') {
    b.state = 'idle';
    b.time = 0;
    b.duration = 1.4 + random() * 1.2;
  }
  b.time += dt;
  if (b.state === 'idle' && b.time >= b.duration) {
    b.state = random() < 0.7 ? 'lowering' : 'watching';
    b.time = 0;
    b.duration = b.state === 'lowering' ? 1.6 : 3.5;
  } else if (b.state === 'lowering' && b.time >= b.duration) {
    b.state = b.species === 'cow' ? 'grazing' : 'sniffing';
    b.time = 0;
    b.duration = 3 + random() * 4;
  } else if (['grazing', 'sniffing'].includes(b.state) && b.time >= b.duration) {
    b.state = 'raising';
    b.time = 0;
    b.duration = 1.6;
  } else if ((b.state === 'raising' || b.state === 'watching') && b.time >= b.duration) {
    b.state = 'idle';
    b.time = 0;
    b.duration = 2 + random() * 2;
  }
  if (b.state === 'lowering') b.down = smooth(b.time / b.duration);
  else if (['grazing', 'sniffing'].includes(b.state)) b.down = 1;
  else if (b.state === 'raising') b.down = 1 - smooth(b.time / b.duration);
  else if (b.state === 'alert') b.down = b.alertDown * (1 - smooth((b.time - 0.18) / 0.85));
  else b.down = 0;
  b.raised = b.state === 'watching' ? Math.sin(Math.PI * Math.min(1, b.time / b.duration)) ** 2 : 0;
}
export function patCow(b, target) {
  if (b.cooldown > 0) return false;
  b.reactionTime = 0;
  b.driveTime = target ? 8 : 0;
  b.alertDown = b.down;
  b.state = 'alert';
  b.time = 0;
  b.duration = 1.25;
  b.escape = target;
  b.cooldown = 2.5;
  b.pats++;
  b.swishTime = 0;
  b.swishSide = b.pats % 2 ? 1 : -1;
  b.swishStrength = 0.92 + (b.pats % 3) * 0.06;
  return true;
}
// Prefer retreating away from the touch, but check every point of the proposed path.
export function cowRetreatTarget(animal, source, allowed, distances = [1.6, 1.3, 1, 0.7]) {
  const away = Math.atan2(animal.x - source.x, animal.z - source.z);
  for (const distance of distances)
    for (const offset of [0, 0.5, -0.5, 1, -1, 1.8, -1.8, Math.PI]) {
      const dx = Math.sin(away + offset) * distance,
        dz = Math.cos(away + offset) * distance;
      let safe = true;
      for (let i = 1; i <= 8; i++)
        if (!allowed(animal.x + (dx * i) / 8, animal.z + (dz * i) / 8)) {
          safe = false;
          break;
        }
      if (safe) return { x: animal.x + dx, z: animal.z + dz };
    }
  return null;
}
export function isAnimalTap(start, end) {
  return !!start && !start.moved && Math.hypot(end.x - start.startX, end.y - start.startY) < 6;
}
