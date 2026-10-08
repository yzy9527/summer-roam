export function explorationSoundTargets(source, listener, heading = 0) {
  const dx = source.x - listener.x,
    dz = source.z - listener.z,
    distance = Math.hypot(dx, dz);
  return {
    gain: Math.max(0, 1 - distance / 18) ** 2,
    pan:
      distance > 0.001
        ? Math.max(
            -0.85,
            Math.min(0.85, (dx * Math.cos(heading) - dz * Math.sin(heading)) / distance),
          )
        : 0,
  };
}

export function createExplorationAudio({ getEffects }) {
  let playing = false,
    ctx,
    listener = { x: 0, z: 0 },
    heading = 0,
    effectsCount = 0;
  const activeNodes = new Set();
  function stopEffects() {
    for (const node of activeNodes) {
      try {
        node.stop();
      } catch {}
    }
    activeNodes.clear();
  }
  return {
    unlock() {
      if (!ctx) ctx = new AudioContext();
      return ctx.resume().catch(() => {});
    },
    setPlaying(value) {
      playing = value;
      if (!value) {
        stopEffects();
        ctx?.suspend().catch(() => {});
      } else ctx?.resume().catch(() => {});
    },
    sound(kind, position, surface = '草地') {
      const effects = getEffects();
      if (!ctx || !playing || !effects.effects || effects.effectsVolume <= 0) return;
      const spatial = explorationSoundTargets(position, listener, heading);
      if (spatial.gain <= 0) return;
      const duration = ['bark', 'whine'].includes(kind) ? 0.18 : kind === 'jump' ? 0.12 : 0.065;
      const gain = ctx.createGain(),
        pan = ctx.createStereoPanner(),
        filter = ctx.createBiquadFilter();
      pan.pan.value = spatial.pan;
      filter.type = 'lowpass';
      filter.frequency.value = surface === '公路' ? 1800 : 750;
      gain.gain.setValueAtTime(
        effects.effectsVolume *
          spatial.gain *
          (kind === 'bark' ? 0.18 : kind === 'pawstep' ? 0.045 : 0.12),
        ctx.currentTime,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      let node;
      if (['bark', 'whine', 'jump'].includes(kind)) {
        node = ctx.createOscillator();
        node.type = kind === 'bark' ? 'triangle' : 'sine';
        node.frequency.setValueAtTime(
          kind === 'bark' ? 550 : kind === 'whine' ? 720 : 160,
          ctx.currentTime,
        );
        node.frequency.exponentialRampToValueAtTime(
          kind === 'bark' ? 210 : kind === 'whine' ? 460 : 330,
          ctx.currentTime + duration,
        );
      } else {
        node = ctx.createBufferSource();
        const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
        const data = b.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        node.buffer = b;
      }
      node.connect(filter).connect(gain).connect(pan).connect(ctx.destination);
      activeNodes.add(node);
      effectsCount++;
      node.start();
      node.stop(ctx.currentTime + duration);
      node.onended = () => {
        activeNodes.delete(node);
        node.disconnect();
        filter.disconnect();
        gain.disconnect();
        pan.disconnect();
      };
    },
    update(dt, position, viewHeading) {
      listener = position;
      heading = viewHeading;
      if (!getEffects().effects) stopEffects();
    },
    snapshot: () => ({ playing, effectsCount }),
  };
}
