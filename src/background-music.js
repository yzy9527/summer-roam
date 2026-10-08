import { assetUrl } from './asset-url.js';

export const MUSIC_URL = assetUrl('music');
export const NIGHT_MUSIC_URL = assetUrl('night-music');
export const MUSIC_TRANSITION_SECONDS = 2;

// Two independent playheads let a day/night change fade without reloading a track.
export function createBackgroundMusic(media, publish = () => {}) {
  const tracks = Object.fromEntries(
    Object.entries(media).map(([mode, audio]) => {
      audio.loop = true;
      audio.preload = 'none';
      audio.volume = 0;
      audio.muted = true;
      return [mode, { audio, gain: null, pending: false, request: 0, started: false, error: '' }];
    }),
  );
  let ctx, bus;
  let mode = 'day',
    mix = 0,
    wanted = false,
    volume = 0,
    factor = 1;
  const amount = (key) => (key === 'night' ? mix : 1 - mix);
  const targetMode = () => (tracks[mode].error ? (mode === 'day' ? 'night' : 'day') : mode);
  const needed = (key) => wanted && (amount(key) > 0 || key === targetMode());

  function pause(track) {
    track.audio.muted = true;
    const active = track.pending || !track.audio.paused;
    track.pending = false;
    track.started = false;
    track.request++;
    if (active) track.audio.pause();
  }
  function gains() {
    if (!ctx) return;
    for (const [key, track] of Object.entries(tracks)) {
      track.audio.muted = !needed(key) || !!track.error;
      track.gain.gain.setValueAtTime(wanted && track.started ? amount(key) : 0, ctx.currentTime);
    }
  }
  function level() {
    if (!ctx) return;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    if (wanted) bus.gain.setTargetAtTime(volume * factor, ctx.currentTime, 0.12);
    else bus.gain.setValueAtTime(0, ctx.currentTime);
  }
  function playback() {
    for (const [key, track] of Object.entries(tracks)) {
      if (!needed(key)) {
        if (track.pending || !track.audio.paused) pause(track);
        continue;
      }
      if (track.pending || !track.audio.paused || track.error) continue;
      track.pending = true;
      const request = ++track.request;
      Promise.resolve()
        .then(() => {
          if (request !== track.request || !needed(key)) return;
          return track.audio.play();
        })
        .then(() => {
          if (request !== track.request) return;
          track.pending = false;
          gains();
          publish();
        })
        .catch((error) => {
          if (request !== track.request) return;
          track.pending = false;
          track.error = error.name === 'AbortError' ? '' : '点击音乐按钮即可恢复播放';
          track.started = false;
          gains();
          publish();
        });
    }
    gains();
  }
  for (const [key, track] of Object.entries(tracks)) {
    track.audio.addEventListener('playing', () => {
      if (!needed(key)) pause(track);
      else {
        track.started = true;
        track.error = '';
      }
      gains();
      publish();
    });
    track.audio.addEventListener('pause', () => {
      track.started = false;
      gains();
      publish();
    });
    track.audio.addEventListener('error', () => {
      track.error = '音乐暂未加载，仍可继续驾驶';
      pause(track);
      gains();
      publish();
    });
    for (const event of ['loadedmetadata', 'canplay']) track.audio.addEventListener(event, publish);
  }
  return {
    connect(context, destination) {
      ctx = context;
      bus = ctx.createGain();
      bus.gain.value = 0;
      bus.connect(destination);
      for (const track of Object.values(tracks)) {
        track.gain = ctx.createGain();
        track.gain.gain.value = 0;
        ctx.createMediaElementSource(track.audio).connect(track.gain).connect(bus);
        track.audio.volume = 1;
      }
    },
    sync(options) {
      volume = options.volume;
      wanted = !!(ctx && options.playing && options.enabled && volume > 0);
      if (wanted) for (const track of Object.values(tracks)) track.error = '';
      level();
      playback();
      publish();
    },
    setTimeOfDay(next) {
      if (!tracks[next] || next === mode) return;
      mode = next;
      tracks[mode].error = '';
      playback();
      publish();
    },
    update(dt, backgroundFactor = factor) {
      if (factor !== backgroundFactor) {
        factor = backgroundFactor;
        level();
      }
      const target = targetMode(),
        track = tracks[target];
      // Keep the outgoing music until the incoming file actually starts.
      if (wanted && dt > 0 && track.started && !track.audio.paused) {
        const step = Math.min(dt, 0.25) / MUSIC_TRANSITION_SECONDS;
        mix = target === 'night' ? Math.min(1, mix + step) : Math.max(0, mix - step);
      }
      playback();
    },
    stop() {
      wanted = false;
      for (const track of Object.values(tracks)) pause(track);
      level();
      gains();
    },
    snapshot() {
      const track = tracks[mode];
      return {
        file: mode === 'night' ? NIGHT_MUSIC_URL : MUSIC_URL,
        timeOfDay: mode,
        nightMix: mix,
        readyState: track.audio.readyState,
        paused: track.audio.paused,
        time: track.audio.currentTime,
        gain: bus?.gain.value || 0,
        error: track.error || track.audio.error?.code || null,
        tracks: Object.fromEntries(
          Object.entries(tracks).map(([key, t]) => [
            key,
            {
              file: key === 'night' ? NIGHT_MUSIC_URL : MUSIC_URL,
              paused: t.audio.paused,
              pending: t.pending,
              time: t.audio.currentTime,
              gain: t.gain?.gain.value || 0,
              error: t.error || t.audio.error?.code || null,
            },
          ]),
        ),
      };
    },
  };
}
