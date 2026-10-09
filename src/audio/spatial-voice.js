import { setAudioSource } from './shared-media.js';

/**
 * A single spatial media slot. Reserve before play(); stale failures cannot
 * release a newer request. Business probabilities and cooldowns stay outside.
 */
export function createSpatialVoice(
  media,
  {
    range = 100,
    canSpeak = () => true,
    selectSource,
    repeatPlaying = false,
    completionEvents = false,
  } = {},
) {
  media.loop = false;
  media.preload = 'auto';
  let active = null,
    generation = 0,
    started = false,
    requests = 0,
    position = null,
    volume = 0;
  function gain(event) {
    const distance = position ? Math.hypot(event.x - position.x, event.z - position.z) : 0;
    return volume * Math.max(0, 1 - distance / range) ** 2;
  }
  function stop(reason = 'stopped') {
    generation++;
    const previous = active;
    active = null;
    started = false;
    media.pause();
    media.currentTime = 0;
    previous?.notify(reason);
  }
  media.addEventListener('playing', () => {
    if (!active || (started && !repeatPlaying)) return;
    started = true;
    active.notify('playing');
  });
  for (const type of ['ended', 'error'])
    media.addEventListener(type, () =>
      stop(type === 'ended' && completionEvents ? 'ended' : 'stopped'),
    );
  return {
    busy: () => !!active,
    stop,
    sync({ enabled, volume: nextVolume, position: nextPosition }) {
      volume = nextVolume;
      position = nextPosition;
      if (!enabled || volume <= 0) stop();
      else if (active) {
        media.volume = gain(active.event);
        if (media.volume <= 0) stop();
      }
    },
    request(event, enabled, notify = () => {}) {
      if (!enabled || active || !canSpeak() || gain(event) <= 0) return false;
      const token = ++generation;
      active = { event, notify };
      started = false;
      requests++;
      if (selectSource) setAudioSource(media, selectSource(event));
      media.volume = gain(event);
      media.currentTime = 0;
      try {
        media.play()?.catch(() => {
          if (generation === token) stop();
        });
      } catch {
        if (generation === token) stop();
        return false;
      }
      return true;
    },
    snapshot: () => ({ busy: !!active, started, requests, time: active ? media.currentTime : 0 }),
  };
}
