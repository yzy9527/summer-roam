import { assetUrl } from './asset-url.js';
import { createSpatialVoice } from './audio/spatial-voice.js';

export const LOOKOUT_VOICE_URL = assetUrl('zombie-brains');

// Existing lookout API; playback lifecycle is shared with other spatial voices.
export function createLookoutVoice(media, options) {
  return createSpatialVoice(media, options);
}
