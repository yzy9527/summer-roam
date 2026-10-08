import { assetUrl } from './asset-url.js';
export const WOLF_HOWL_URL = assetUrl('wolf-cry');

// Probability and day/night timing belong to the mountain controller. The media
// slot reserves before play(), and only real playing drives the howl pose.
export function createWolfHowlVoice(media, event = () => {}, changed = () => {}) {
  let busy = false,
    generation = 0,
    plays = 0,
    requests = 0;
  media.loop = false;
  media.preload = 'auto';
  const release = (type) => {
    busy = false;
    event(type);
    changed();
  };
  media.addEventListener('playing', () => {
    if (busy) {
      plays++;
      event('playing');
      changed();
    }
  });
  media.addEventListener('ended', () => {
    if (busy) {
      generation++;
      release('ended');
    }
  });
  media.addEventListener('error', () => {
    if (busy) {
      generation++;
      media.pause();
      release('cancel');
    }
  });
  return {
    busy: () => busy,
    request(enabled) {
      if (!enabled || busy) return false;
      busy = true;
      requests++;
      const ticket = ++generation;
      media.currentTime = 0;
      changed();
      const failed = () => {
        if (ticket === generation) {
          generation++;
          media.pause();
          release('cancel');
        }
      };
      try {
        Promise.resolve(media.play()).catch(failed);
      } catch {
        failed();
      }
      return true;
    },
    stop() {
      if (!busy) return;
      generation++;
      media.pause();
      media.currentTime = 0;
      release('cancel');
    },
    snapshot: () => ({ busy, plays, requests, time: media.currentTime, paused: media.paused }),
  };
}
