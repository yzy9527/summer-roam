import { assetUrl } from './asset-url.js';
export const CALF_VOICE_URL = assetUrl('calf-call');

// The fourth visible tap unlocks speech; busy includes a pending play() request.
// Nothing is queued. End, failure, pause or mute releases the single playback slot.
export function createCalfVoice(media, onChange = () => {}, hooks = {}) {
  let busy = false,
    generation = 0,
    requests = 0,
    plays = 0,
    error = '';
  media.loop = false;
  media.preload = 'auto';
  const release = () => {
    busy = false;
    onChange();
  };
  media.addEventListener('ended', () => {
    hooks.event?.('ended');
    release();
  });
  media.addEventListener('error', () => {
    generation++;
    error = '小牛声音暂不可用';
    hooks.event?.('cancel');
    release();
  });
  media.addEventListener('playing', () => {
    if (busy) hooks.event?.('playing');
    onChange();
  });
  media.addEventListener('timeupdate', () => {
    if (busy) hooks.event?.('time', media.currentTime);
  });
  return {
    tap(hit, enabled) {
      if (
        hit?.id !== 'hornless-calf' ||
        hit.taps < 4 ||
        !enabled ||
        busy ||
        hooks.reserve?.() === false
      )
        return false;
      busy = true;
      error = '';
      const ticket = ++generation;
      requests++;
      media.currentTime = 0;
      onChange();
      try {
        Promise.resolve(media.play()).then(
          () => {
            if (ticket !== generation) return;
            plays++;
            onChange();
          },
          () => {
            if (ticket !== generation) return;
            error = '小牛声音未能播放，请再次拍击';
            hooks.event?.('cancel');
            release();
          },
        );
      } catch {
        if (ticket === generation) {
          error = '小牛声音未能播放，请再次拍击';
          hooks.event?.('cancel');
          release();
        }
      }
      return true;
    },
    stop() {
      hooks.event?.('cancel');
      if (!busy && media.paused) return;
      generation++;
      media.pause();
      media.currentTime = 0;
      release();
    },
    snapshot: () => ({
      file: CALF_VOICE_URL,
      busy,
      requests,
      plays,
      paused: media.paused,
      time: media.currentTime,
      error,
    }),
  };
}
