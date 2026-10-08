// Bronze bell strikes with decaying, inharmonic partials.
export function createLookoutBell(ctx, bus) {
  const active = new Set();
  let ringingId = null,
    stoppedRingId = null;
  return {
    play(event, listener) {
      const distance = listener ? Math.hypot(event.x - listener.x, event.z - listener.z) : 0;
      const spatial = Math.max(0, 1 - distance / 100) ** 2;
      if (
        (event.single && event.ringId === stoppedRingId) ||
        spatial <= 0 ||
        (active.size && (!event.single || ringingId !== event.ringId))
      )
        return false;
      ringingId = event.single ? event.ringId : null;
      for (const offset of event.single ? [0] : [0, 0.45])
        for (const [ratio, weight, decay] of [
          [1, 1, 0.9],
          [2.76, 0.35, 0.55],
          [5.4, 0.12, 0.3],
        ]) {
          const oscillator = ctx.createOscillator(),
            gain = ctx.createGain();
          const start = ctx.currentTime + offset;
          oscillator.type = 'sine';
          oscillator.frequency.value = 740 * ratio;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(0.07 * weight * spatial, start + 0.006);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);
          oscillator.connect(gain).connect(bus);
          active.add(oscillator);
          oscillator.onended = () => {
            active.delete(oscillator);
            oscillator.disconnect();
            gain.disconnect();
          };
          oscillator.start(start);
          oscillator.stop(start + decay + 0.02);
        }
      return true;
    },
    stop() {
      stoppedRingId = ringingId;
      for (const oscillator of active) oscillator.stop();
      active.clear();
    },
    snapshot: () => ({ active: active.size }),
  };
}
