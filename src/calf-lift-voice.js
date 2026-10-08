import { assetUrl } from './asset-url.js';
import { createSpatialVoice } from './audio/spatial-voice.js';

export const CALF_LIFT_URLS = [assetUrl('calf-lift-call'), assetUrl('calf-cry')];

// Lift calls remain independent of family/attack behavior and use the shared slot.
export function createCalfLiftVoice(media, canSpeak = () => true) {
  return createSpatialVoice(media, {
    range: 65,
    canSpeak,
    repeatPlaying: true,
    selectSource: () => CALF_LIFT_URLS[Math.random() < 0.5 ? 0 : 1],
  });
}
