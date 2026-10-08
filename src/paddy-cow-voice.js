import { assetUrl } from './asset-url.js';
import { createSpatialVoice } from './audio/spatial-voice.js';

export const PADDY_COW_CALL_URLS = {
  'hornless-calf': assetUrl('calf-cry'),
  'golden-cow': assetUrl('mother-cry'),
  'copper-cow': assetUrl('bull-cry'),
};
const CALF_NIULAI_URL = assetUrl('calf-lift-call');

// Independent media instances: no collision/protection callbacks or voice queue.
export function createPaddyCowVoice(createMedia, canSpeak = () => true) {
  const voices = {};
  let emitter = null,
    settings = null;
  const busy = () => Object.values(voices).some((voice) => voice.snapshot().busy);
  return {
    sync(nextSettings) {
      settings = nextSettings;
      for (const voice of Object.values(voices)) voice.sync(settings);
    },
    move(position) {
      if (emitter) {
        emitter.x = position.x;
        emitter.z = position.z;
      }
    },
    request(event, enabled, notify) {
      if (
        !enabled ||
        !settings?.enabled ||
        !settings.position ||
        settings.volume <= 0 ||
        busy() ||
        !canSpeak() ||
        !Object.hasOwn(PADDY_COW_CALL_URLS, event.cowId)
      )
        return false;
      if (Math.hypot(event.x - settings.position.x, event.z - settings.position.z) >= 32)
        return false;
      const niulai = event.cowId === 'hornless-calf' && event.call === 'calf-lift-call';
      const voiceId = niulai ? 'hornless-calf-niulai' : event.cowId;
      const url = niulai ? CALF_NIULAI_URL : PADDY_COW_CALL_URLS[event.cowId];
      if (!voices[voiceId]) {
        voices[voiceId] = createSpatialVoice(createMedia(event.cowId, url), {
          range: 32,
        });
        voices[voiceId].sync(settings);
      }
      emitter = { ...event };
      return voices[voiceId].request(emitter, enabled, notify);
    },
    stop() {
      for (const voice of Object.values(voices)) voice.stop();
    },
    snapshot: () => ({
      busy: busy(),
      voices: Object.fromEntries(
        Object.entries(voices).map(([id, voice]) => [id, voice.snapshot()]),
      ),
    }),
  };
}
