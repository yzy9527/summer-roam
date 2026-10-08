// Gameplay time only: no wall-clock callbacks or catch-up when the game resumes.
export function createAnimalSleep(
  animals,
  { busy = () => false, safe = () => true, random = Math.random } = {},
) {
  const records = new Map();
  let night = false;
  function record(a) {
    if (!records.has(a))
      records.set(a, {
        phase: 'awake',
        progress: 0,
        remaining: 0,
        restIn: 0,
        wakes: 0,
        action: null,
      });
    return records.get(a);
  }
  const held = (r) => r.phase !== 'awake';
  function release(a, r) {
    r.phase = 'awake';
    r.progress = 0;
    a.sleepAmount = 0;
    a.target = null;
    a.wait = 1;
    if (a.behavior)
      Object.assign(a.behavior, {
        state: 'idle',
        time: 0,
        down: 0,
        raised: 0,
        escape: null,
        driveTime: 0,
      });
  }
  function wake(a, action = null) {
    const r = record(a);
    r.restIn = a.id === 'reference-wolf' || a.sleepPeriodic ? 45 + random() * 45 : 15;
    if (!held(r)) return false;
    r.phase = 'waking';
    // A physical input may request one response after standing. Repeated touches
    // cannot stack it; pause and day changes discard it rather than replaying sound.
    if (action && !r.action) r.action = action;
    return true;
  }
  return {
    owns: (a) => held(record(a)),
    ready: (a) => !a || !held(record(a)),
    wake,
    rest(a) {
      if (!night || !a?.rig || busy(a) || !safe(a) || !apiReady(a)) return false;
      record(a).restIn = 0;
      return true;
    },
    snapshot: (a) => {
      const r = record(a);
      return {
        phase: r.phase,
        amount: a.sleepAmount ?? 0,
        remaining: r.remaining,
        restIn: r.restIn,
        wakes: r.wakes,
      };
    },
    update(dt, timeOfDay = 'day') {
      if (!(dt > 0)) {
        for (const r of records.values()) r.action = null;
        return;
      }
      const nextNight = timeOfDay === 'night';
      if (nextNight !== night) {
        night = nextNight;
        for (const a of animals) {
          const r = record(a);
          r.action = null;
          r.restIn = night ? 1 + random() * 2 : 0;
          if (!night && held(r)) r.phase = 'waking';
        }
      }
      for (const a of animals) {
        if (!a.rig || !a.behavior) continue;
        const r = record(a);
        if (r.phase === 'awake') {
          r.restIn = Math.max(0, r.restIn - dt);
          if (
            !night ||
            r.restIn > 0 ||
            busy(a) ||
            !safe(a) ||
            a.collisionEscape ||
            a.behavior.driveTime > 0
          )
            continue;
          r.phase = 'lying-down';
          r.progress = 0;
          a.target = null;
          a.velocity = 0;
          a.chargeRun = 0;
          a.recoil = null;
          a.gesture = 0;
          Object.assign(a.behavior, { down: 0, raised: 0, escape: null });
        }
        if (held(r) && r.phase !== 'waking' && !safe(a)) wake(a);
        if (r.phase === 'sleeping' && (a.id === 'reference-wolf' || a.sleepPeriodic)) {
          r.remaining = Math.max(0, r.remaining - dt);
          if (r.remaining <= 0) {
            r.wakes++;
            wake(a);
          }
        }
        if (r.phase === 'lying-down') {
          r.progress = Math.min(1, r.progress + dt / 2.6);
          if (r.progress === 1) {
            r.phase = 'sleeping';
            r.remaining = a.id === 'reference-wolf' || a.sleepPeriodic ? 120 + random() * 120 : 0;
          }
        } else if (r.phase === 'waking') {
          r.progress = Math.max(0, r.progress - dt / 2);
          if (r.progress === 0) {
            const action = r.action;
            r.action = null;
            release(a, r);
            action?.();
          }
        }
        a.sleepAmount = r.progress * r.progress * (3 - 2 * r.progress);
        if (held(r)) {
          a.velocity = 0;
          a.target = null;
          a.behavior.state = r.phase;
        }
      }
    },
  };
  function apiReady(a) {
    return !held(record(a));
  }
}
