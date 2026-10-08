import { assetUrl } from './asset-url.js';
export const COW_COLLISION_URLS = {
  'copper-cow': assetUrl('bull-cry'),
  'golden-cow': assetUrl('mother-cry'),
  'hornless-calf': assetUrl('calf-cry'),
  'reference-wolf': assetUrl('wolf-cry'),
  'baola-leopard': assetUrl('leopard-cry'),
};
export const LEOPARD_TAP_URL = assetUrl('leopard-tap');
// Reserve before play. Wolf has its own ten-second gate as well as the shared slot.
export function createCowCollisionVoice(
  mediaById,
  onChange = () => {},
  random = Math.random,
  hooks = {},
) {
  let active = null,
    generation = 0,
    cooldown = 0,
    wolfCooldown = 0,
    requests = 0,
    plays = 0,
    error = '';
  const release = (event = 'cancel') => {
    const bite = active?.bite;
    active = null;
    if (bite) hooks.biteEvent?.(event);
    onChange();
  };
  for (const [id, media] of Object.entries(mediaById)) {
    media.loop = false;
    media.preload = 'auto';
    media.addEventListener('playing', () => {
      if (active?.id !== id || active.started) return;
      active.started = true;
      cooldown = 5;
      if (id === 'reference-wolf') wolfCooldown = 10;
      plays++;
      if (id === 'hornless-calf' && !active.bite) active.reply = random() < 0.3;
      if (active.bite) hooks.biteEvent?.('playing');
      onChange();
    });
    media.addEventListener('ended', () => {
      if (active?.id === id) {
        const reply = active.started && active.reply,
          protect = active.started && id === 'golden-cow';
        generation++;
        release(active.started ? 'ended' : 'cancel');
        if (protect) hooks.protect?.();
        else if (reply) hooks.follow?.();
      }
    });
    media.addEventListener('error', () => {
      if (active?.id === id) {
        generation++;
        media.pause();
        error = '动物叫声暂不可用';
        release('error');
      }
    });
  }
  function play(id, enabled, bite = false) {
    const media = mediaById[id];
    if (
      !media ||
      !enabled ||
      active ||
      (!bite && (cooldown > 0 || (id === 'reference-wolf' && wolfCooldown > 0) || random() >= 0.4))
    )
      return false;
    active = { id, started: false, bite };
    error = '';
    requests++;
    const ticket = ++generation;
    media.currentTime = 0;
    onChange();
    const fail = () => {
      if (ticket !== generation) return;
      generation++;
      media.pause();
      error = '动物叫声未能播放';
      release('error');
    };
    try {
      Promise.resolve(media.play()).catch(fail);
    } catch {
      fail();
    }
    return true;
  }
  return {
    hit: (hit, enabled) => play(hit?.id, enabled),
    tap: (enabled) => play('leopard-tap', enabled),
    bite(enabled) {
      this.stop();
      return play('hornless-calf', enabled, true);
    },
    update(dt) {
      if (dt > 0) {
        cooldown = Math.max(0, cooldown - dt);
        wolfCooldown = Math.max(0, wolfCooldown - dt);
      }
    },
    stop() {
      generation++;
      if (active) {
        const media = mediaById[active.id];
        media.pause();
        media.currentTime = 0;
        release();
      }
    },
    ready: () => !active && cooldown <= 0,
    startCooldown() {
      cooldown = 5;
      onChange();
    },
    busy: () => !!active,
    snapshot: () => ({
      busy: !!active,
      id: active?.id ?? null,
      started: active?.started ?? false,
      replyPending: !!active?.reply,
      cooldown,
      wolfCooldown,
      requests,
      plays,
      time: active ? mediaById[active.id].currentTime : 0,
      error,
    }),
  };
}
