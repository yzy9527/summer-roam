import { assetUrl } from './asset-url.js';
import { NOHARA_HOUSE_SITE } from './nohara-house-site.js';
export const HOUSE_MUSIC_URL = assetUrl('house-music');
// A radio inside the ground-floor living room, close to the front window.
export const HOUSE_MUSIC_SOURCE = { x: NOHARA_HOUSE_SITE.x + 4, z: NOHARA_HOUSE_SITE.z };
export function houseMusicTargets(position, heading = 0) {
  const s = NOHARA_HOUSE_SITE;
  const distance = Math.hypot(
    Math.max(0, Math.abs(position.x - s.x) - s.width / 2),
    Math.max(0, Math.abs(position.z - s.z) - s.depth / 2),
  );
  const t = Math.max(0, Math.min(1, 1 - distance / 25)),
    presence = t * t * (3 - 2 * t);
  const dx = HOUSE_MUSIC_SOURCE.x - position.x,
    dz = HOUSE_MUSIC_SOURCE.z - position.z,
    length = Math.hypot(dx, dz);
  const pan =
    length > 0.01
      ? Math.max(-0.85, Math.min(0.85, (-dx * Math.cos(heading) + dz * Math.sin(heading)) / length))
      : 0;
  return { distance, presence, pan, cutoff: 1400 + presence * 4200 };
}
export function createHouseMusic(media, publish = () => {}) {
  media.loop = true;
  media.preload = 'none';
  media.volume = 0;
  media.muted = true;
  let ctx,
    gain,
    filter,
    panner,
    wanted = false,
    pending = false,
    request = 0,
    error = '',
    volume = 0,
    targets = { distance: Infinity, presence: 0, pan: 0, cutoff: 1400 };
  function ramp(param, value, time = 0.25) {
    if (!ctx || !param) return;
    param.cancelScheduledValues(ctx.currentTime);
    param.setTargetAtTime(value, ctx.currentTime, time);
  }
  function audible() {
    return inRange() && !media.paused && !error;
  }
  function inRange() {
    return !!(ctx && wanted && volume > 0 && targets.presence > 0);
  }
  function mix() {
    // Pause and mute outside the radius; silence must not depend on browser gain routing.
    media.muted = !inRange() || !!error;
    if (!inRange() && gain) {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(0, ctx.currentTime);
    } else ramp(gain?.gain, audible() ? volume * targets.presence : 0, 0.35);
    ramp(filter?.frequency, targets.cutoff, 0.3);
    ramp(panner?.pan, targets.pan, 0.15);
  }
  for (const event of ['playing', 'pause', 'canplay', 'loadedmetadata'])
    media.addEventListener(event, () => {
      if (event === 'playing') {
        if (!inRange()) {
          pause();
          return;
        }
        error = '';
      }
      mix();
      publish();
    });
  media.addEventListener('error', () => {
    error = '屋内音乐暂未加载';
    pending = false;
    mix();
    publish();
  });
  function pause() {
    media.muted = true;
    const active = pending || !media.paused;
    pending = false;
    request++;
    if (active) media.pause();
    mix();
  }
  function stop() {
    wanted = false;
    pause();
  }
  function playback() {
    if (!inRange()) {
      if (pending || !media.paused) pause();
      else mix();
      return;
    }
    mix();
    if (media.paused && !pending && !error) {
      pending = true;
      const id = ++request;
      media
        .play()
        .then(() => {
          if (id !== request) return;
          pending = false;
          mix();
          publish();
        })
        .catch((e) => {
          if (id !== request) return;
          pending = false;
          if (e.name !== 'AbortError') error = '点击音乐按钮即可恢复屋内音乐';
          mix();
          publish();
        });
    }
  }
  return {
    connect(context, destination) {
      ctx = context;
      gain = ctx.createGain();
      gain.gain.value = 0;
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1400;
      panner = ctx.createStereoPanner();
      ctx
        .createMediaElementSource(media)
        .connect(filter)
        .connect(panner)
        .connect(gain)
        .connect(destination);
      media.volume = 1;
    },
    sync(options) {
      volume = options.volume;
      const next = !!(ctx && options.playing && options.enabled && volume > 0);
      if (!next) {
        stop();
        return;
      }
      wanted = true;
      error = '';
      playback();
    },
    update(position, heading) {
      const wasInRange = targets.presence > 0;
      targets = houseMusicTargets(position, heading);
      if (!wasInRange && targets.presence > 0) error = '';
      playback();
    },
    stop,
    backgroundFactor() {
      return 1 - (audible() ? 0.85 * targets.presence : 0);
    },
    snapshot() {
      return {
        file: HOUSE_MUSIC_URL,
        source: HOUSE_MUSIC_SOURCE,
        loop: media.loop,
        paused: media.paused,
        muted: media.muted,
        pending,
        time: media.currentTime,
        readyState: media.readyState,
        enabled: wanted,
        volume,
        gain: gain?.gain.value || 0,
        ...targets,
        error: error || media.error?.code || null,
      };
    },
  };
}
