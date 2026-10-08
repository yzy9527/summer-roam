import { assetUrl } from './asset-url.js';

export const CORRAL_NO_URL = assetUrl('zombie-no');
export const CORRAL_ANIMAL_URLS = {
  'bull-tap': assetUrl('bull-cry'),
  'copper-cow': assetUrl('bull-warning'),
  'golden-cow': assetUrl('mother-cry'),
  'hornless-calf': assetUrl('calf-call'),
  'baola-leopard': assetUrl('leopard-tap'),
};
export const MANUAL_ANIMAL_CALL_URLS = { 'reference-wolf': assetUrl('wolf-cry') };
export const CORRAL_CALF_CALL_URLS = {
  'calf-confined-niulai': assetUrl('calf-lift-call'),
  'calf-confined-mama': assetUrl('calf-cry'),
};
export const RESCUE_VOICE_URLS = {
  'calf-run-mama': assetUrl('calf-cry'),
  'bull-rescue': assetUrl('bull-cry'),
};
export const CORRAL_VOICE_RANGE = 65;

// Voice-only corral events never call the original attack/family controllers.
export function createCorralVoice(
  media,
  canSpeak = () => true,
  random = Math.random,
  now = Date.now,
) {
  const callTimes = new Map();
  let active = null,
    generation = 0,
    started = false,
    requests = 0,
    position = null,
    volume = 0;
  function stop() {
    generation++;
    if (active) {
      active.media.pause();
      active.media.currentTime = 0;
    }
    active = null;
    started = false;
  }
  for (const audio of Object.values(media)) {
    audio.addEventListener('playing', () => {
      if (active?.media === audio) started = true;
    });
    for (const type of ['ended', 'error'])
      audio.addEventListener(type, () => {
        if (active?.media === audio) stop();
      });
  }
  function distanceTo(event) {
    const listener = event.type === 'animal-call' ? (event.listener ?? position) : position;
    return listener ? Math.hypot(event.x - listener.x, event.z - listener.z) : 0;
  }
  function gain(event) {
    return volume * Math.max(0, 1 - distanceTo(event) / CORRAL_VOICE_RANGE) ** 2;
  }
  return {
    busy: () => !!active,
    stop,
    sync({ enabled, volume: nextVolume, position: nextPosition }) {
      volume = nextVolume;
      position = nextPosition;
      if (!enabled || volume <= 0) stop();
      else if (active) {
        active.media.volume = gain(active.event);
        if (active.media.volume <= 0) stop();
      }
    },
    event(event, enabled) {
      if (event.type === 'animal-position') {
        if (active?.event.instanceId === event.instanceId) {
          active.event = { ...active.event, x: event.x, z: event.z };
          active.media.volume = gain(active.event);
        }
        return false;
      }
      if (event.type === 'animal-stop') {
        if (active?.event.instanceId === event.instanceId) stop();
        return false;
      }
      const key =
        event.type === 'animal-tap' && event.id === 'copper-cow'
          ? 'bull-tap'
          : event.type === 'bull-rescue'
            ? 'bull-rescue'
            : event.type === 'animal-run' && event.id === 'hornless-calf'
              ? 'calf-run-mama'
              : event.type === 'zombie-no'
                ? 'zombie-no'
                : event.type === 'calf-confined-call'
                  ? Object.keys(CORRAL_CALF_CALL_URLS)[random() < 0.5 ? 0 : 1]
                  : event.id;
      if (event.type === 'zombie-no' && active && active.event.type !== 'zombie-no') stop();
      if (event.type === 'bull-rescue' && active) stop();
      if (event.id === 'reference-wolf' && !['zombie-no', 'animal-call'].includes(event.type))
        return false;
      const audio = media[key];
      if (!enabled || active || !audio || !canSpeak() || gain(event) <= 0) return false;
      const callId = event.instanceId ?? event.id;
      if (event.type === 'animal-call' && now() - (callTimes.get(callId) ?? -Infinity) < 3000)
        return false;
      const token = ++generation;
      active = { media: audio, event, key };
      requests++;
      started = false;
      audio.volume = gain(event);
      audio.currentTime = 0;
      try {
        const pending = audio.play();
        pending?.catch(() => {
          if (token === generation) stop();
        });
      } catch {
        if (token === generation) stop();
        return false;
      }
      if (event.type === 'animal-call') callTimes.set(callId, now());
      return true;
    },
    snapshot: () => ({
      busy: !!active,
      started,
      requests,
      id: active?.event.id ?? null,
      type: active?.event.type ?? null,
      file: active
        ? (MANUAL_ANIMAL_CALL_URLS[active.key] ??
          RESCUE_VOICE_URLS[active.key] ??
          CORRAL_CALF_CALL_URLS[active.key] ??
          CORRAL_ANIMAL_URLS[active.key] ??
          CORRAL_NO_URL)
        : null,
      distance: active ? distanceTo(active.event) : null,
      gain: active?.media.volume ?? 0,
      time: active?.media.currentTime ?? 0,
    }),
  };
}
