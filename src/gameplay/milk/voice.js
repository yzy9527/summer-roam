import { assetUrl } from '../../asset-url.js';
import { createSpatialVoice } from '../../audio/spatial-voice.js';

export const MILK_VOICE_URLS = Object.freeze({
  question: assetUrl('milk-question'),
  answer: assetUrl('milk-answer'),
});

// One slot for the whole conversation; only a natural end advances to the reply.
export function createMilkVoice(media, canSpeak = () => true) {
  const voice = createSpatialVoice(media, {
    range: 65,
    completionEvents: true,
    canSpeak,
    selectSource: (event) => MILK_VOICE_URLS[event.line],
  });
  return {
    ...voice,
    request(event, enabled, notify) {
      return Object.hasOwn(MILK_VOICE_URLS, event.line) && voice.request(event, enabled, notify);
    },
  };
}
