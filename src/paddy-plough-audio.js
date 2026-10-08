// Original filtered-noise foley. Events come from real foot/whip contact and
// plough travel; no wall-clock loop or delayed playback queue is used.
export function createPaddyPloughAudio(ctx, bus) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.5), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 8264;
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = seed / 2147483648 - 1;
  }
  const sounds = {
    whip: [0.06, 3600],
    'whip-swish': [0.23, 1500],
  };
  const active = new Set();
  let played = 0;
  return {
    play(event, listener) {
      const type = event.type,
        crack = type === 'whip';
      if (!Object.hasOwn(sounds, type) || !listener) return false;
      const distance = Math.hypot(event.x - listener.x, event.z - listener.z);
      const spatial = Math.max(0, 1 - distance / 32) ** 2;
      if (spatial <= 0 || active.size >= 8) return false;
      const source = ctx.createBufferSource(),
        filter = ctx.createBiquadFilter(),
        gain = ctx.createGain();
      const [duration, frequency] = sounds[type];
      source.buffer = buffer;
      filter.type = type.startsWith('whip') ? 'bandpass' : 'lowpass';
      filter.frequency.value = frequency;
      filter.Q.value = crack ? 0.7 : 0.35;
      const start = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(
        Math.max(0.0001, spatial * Math.min(1, event.strength ?? 0.4) * 0.32),
        start + (crack ? 0.002 : 0.025),
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      source.connect(filter).connect(gain).connect(bus);
      active.add(source);
      source.onended = () => {
        active.delete(source);
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
      };
      source.start(start);
      source.stop(start + duration + 0.01);
      played++;
      return true;
    },
    stop() {
      for (const source of active) {
        try {
          source.stop();
        } catch {}
      }
      active.clear();
    },
    snapshot: () => ({ active: active.size, played, synthesized: true, range: 32 }),
  };
}
