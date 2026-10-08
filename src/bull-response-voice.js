import { assetUrl } from './asset-url.js';
export const BULL_PROTECTION_URL = assetUrl('bull-protect');
export const BULL_RESPONSE_URLS = {
  protect: BULL_PROTECTION_URL,
  revenge: assetUrl('bull-charge'),
  follow: assetUrl('bull-follow'),
};
// Response movement is independent of media success, mute, and pause cancellation.
export function createBullResponseVoice(
  mediaByMode,
  onPlaying = () => {},
  onChange = () => {},
  onStop = () => {},
) {
  let active = null,
    generation = 0,
    plays = 0,
    error = '';
  for (const [mode, media] of Object.entries(mediaByMode)) {
    media.loop = false;
    media.preload = 'auto';
    media.addEventListener('playing', () => {
      if (active?.mode !== mode || active.started) return;
      active.started = true;
      plays++;
      onPlaying(mode);
      onChange();
    });
    media.addEventListener('ended', () => {
      if (active?.mode === mode) {
        generation++;
        active = null;
        onStop(mode);
        onChange();
      }
    });
    media.addEventListener('error', () => {
      if (active?.mode === mode) {
        generation++;
        media.pause();
        active = null;
        onStop(mode);
        error = '公牛反击声音暂不可用';
        onChange();
      }
    });
  }
  return {
    play(mode, enabled) {
      const media = mediaByMode[mode];
      if (!media || !enabled || active) return false;
      active = { mode, started: false };
      error = '';
      media.currentTime = 0;
      const ticket = ++generation;
      onChange();
      const fail = () => {
        if (ticket !== generation) return;
        generation++;
        media.pause();
        active = null;
        onStop(mode);
        error = '公牛反击声音未能播放';
        onChange();
      };
      try {
        Promise.resolve(media.play()).catch(fail);
      } catch {
        fail();
      }
      return true;
    },
    stop() {
      generation++;
      if (active) {
        const media = mediaByMode[active.mode];
        media.pause();
        media.currentTime = 0;
        const mode = active.mode;
        active = null;
        onStop(mode);
        onChange();
      }
    },
    busy: () => !!active,
    snapshot: () => ({
      mode: active?.mode ?? null,
      busy: !!active,
      started: active?.started ?? false,
      plays,
      file: active ? BULL_RESPONSE_URLS[active.mode] : null,
      time: active ? mediaByMode[active.mode].currentTime : 0,
      error,
    }),
  };
}
