import { createCalfLiftVoice, CALF_LIFT_URLS } from './calf-lift-voice.js';
import { createWolfHowlVoice, WOLF_HOWL_URL } from './wolf-howl-voice.js';
import {
  createCorralVoice,
  CORRAL_NO_URL,
  MANUAL_ANIMAL_CALL_URLS,
  CORRAL_ANIMAL_URLS,
  CORRAL_CALF_CALL_URLS,
  RESCUE_VOICE_URLS,
} from './corral-audio.js';
import { createBackgroundMusic, MUSIC_URL, NIGHT_MUSIC_URL } from './background-music.js';
import { createHouseMusic, HOUSE_MUSIC_URL } from './house-music.js';
import { createBullResponseVoice, BULL_RESPONSE_URLS } from './bull-response-voice.js';
import {
  createCowCollisionVoice,
  COW_COLLISION_URLS,
  LEOPARD_TAP_URL,
} from './cow-collision-voice.js';
import { createBullVoice, BULL_VOICE_URL, BULL_WARNING_URL } from './bull-charge.js';
import { createCalfVoice, CALF_VOICE_URL } from './animal-voice.js';
import { createLookoutBell } from './lookout-bell.js';
import { createPaddyCowVoice } from './paddy-cow-voice.js';
import { createPaddyPloughAudio } from './paddy-plough-audio.js';
import { createLookoutVoice, LOOKOUT_VOICE_URL } from './lookout-voice.js';
// Original, softly filtered vehicle synthesis. No third-party vehicle recordings.
export { MUSIC_URL, NIGHT_MUSIC_URL };
export function vehicleTargets(state, input) {
  const speed = Math.min(1, Math.abs(state.speed || 0) / 18),
    throttle = !!(input.forward || input.backward);
  return {
    frequency: 52 + speed * 48 + (throttle ? 10 : 0),
    engine: state.engineOff ? 0 : 0.036 + speed * 0.025 + (throttle ? 0.012 : 0),
    rolling: state.engineOff ? 0 : speed * 0.027 * (state.surface === '公路' ? 1 : 1.18),
    brake:
      !state.engineOff && input.brake && Math.abs(state.speed) > 1
        ? Math.min(0.025, speed * 0.025)
        : 0,
  };
}
export function createDriveAudio({
  musicButton,
  effectsButton,
  musicSlider,
  effectsSlider,
  status,
  calfFamily = {},
  bullCharge = {},
  encounters = {},
  wolfMountain = {},
}) {
  let dialogueFactor = 1;
  let prefs = { music: true, effects: true, musicVolume: 0.18, effectsVolume: 0.22 };
  try {
    const saved = JSON.parse(localStorage.getItem('field-audio') || '{}');
    for (const k of ['music', 'effects']) if (typeof saved[k] === 'boolean') prefs[k] = saved[k];
    for (const k of ['musicVolume', 'effectsVolume'])
      if (Number.isFinite(saved[k])) prefs[k] = Math.max(0, Math.min(0.35, saved[k]));
  } catch {}
  const calfMedia = new Audio(CALF_VOICE_URL),
    calfVoice = createCalfVoice(calfMedia, () => publish(), calfFamily);
  const bullMedia = new Audio(BULL_VOICE_URL),
    bullWarningMedia = new Audio(BULL_WARNING_URL),
    bullVoice = createBullVoice(bullMedia, bullCharge, () => publish(), bullWarningMedia);
  const collisionMedia = Object.fromEntries(
      Object.entries({ ...COW_COLLISION_URLS, 'leopard-tap': LEOPARD_TAP_URL }).map(([id, url]) => [
        id,
        new Audio(url),
      ]),
    ),
    collisionVoice = createCowCollisionVoice(collisionMedia, () => publish(), Math.random, {
      biteEvent: (type) => encounters.biteVoiceEvent?.(type),
      protect() {
        if (playing && bullCharge.protect?.()) playResponse('protect', true);
      },
      follow() {
        if (playing && encounters.follow?.()) {
          if (!playResponse('follow', true)) encounters.stopFollow?.();
        }
      },
    });
  const responseMedia = Object.fromEntries(
      Object.entries(BULL_RESPONSE_URLS).map(([mode, url]) => [mode, new Audio(url)]),
    ),
    responseVoice = createBullResponseVoice(
      responseMedia,
      () => collisionVoice.startCooldown(),
      () => publish(),
      (mode) => {
        if (mode === 'follow') encounters.stopFollow?.();
      },
    );
  const howlMedia = new Audio(WOLF_HOWL_URL);
  const howlVoice = createWolfHowlVoice(
    howlMedia,
    (type) => wolfMountain.event?.(type),
    () => publish(),
  );
  const corralMedia = Object.fromEntries(
    Object.entries({
      'zombie-no': CORRAL_NO_URL,
      ...CORRAL_ANIMAL_URLS,
      ...MANUAL_ANIMAL_CALL_URLS,
      ...CORRAL_CALF_CALL_URLS,
      ...RESCUE_VOICE_URLS,
    }).map(([id, url]) => [id, new Audio(url)]),
  );
  const corralVoice = createCorralVoice(
    corralMedia,
    () =>
      !liftVoice.busy() &&
      !howlVoice.busy() &&
      !responseVoice.busy() &&
      !collisionVoice.busy() &&
      !calfVoice.snapshot().busy &&
      !bullVoice.snapshot().busy &&
      !bullVoice.snapshot().warning.busy,
  );
  const liftVoice = createCalfLiftVoice(
    new Audio(CALF_LIFT_URLS[0]),
    () =>
      !corralVoice.busy() &&
      !howlVoice.busy() &&
      !responseVoice.busy() &&
      !collisionVoice.busy() &&
      !calfVoice.snapshot().busy &&
      !bullVoice.snapshot().busy &&
      !bullVoice.snapshot().warning.busy,
  );
  let effectsPosition = null,
    corralListenerPosition = null;
  const music = createBackgroundMusic(
    { day: new Audio(MUSIC_URL), night: new Audio(NIGHT_MUSIC_URL) },
    () => {
      paint();
      publish();
    },
  );
  const lookoutVoice = createLookoutVoice(new Audio(LOOKOUT_VOICE_URL));
  const gateSignalVoice = createLookoutVoice(new Audio(LOOKOUT_VOICE_URL));
  const paddyCowVoice = createPaddyCowVoice(
    (_id, url) => new Audio(url),
    () =>
      !corralVoice.busy() &&
      !liftVoice.busy() &&
      !howlVoice.busy() &&
      !responseVoice.busy() &&
      !collisionVoice.busy() &&
      !calfVoice.snapshot().busy &&
      !bullVoice.snapshot().busy &&
      !bullVoice.snapshot().warning.busy &&
      !lookoutVoice.snapshot().busy &&
      !gateSignalVoice.snapshot().busy,
  );
  const houseMusic = createHouseMusic(new Audio(HOUSE_MUSIC_URL), () => publish());
  let ctx,
    fxBus,
    lookoutBell,
    paddyPloughAudio,
    engineGain,
    rollingGain,
    brakeGain,
    oscillators = [],
    playing = false,
    unlocked = false,
    lastHit = -Infinity,
    error = '',
    lastAudit = 0;
  const audit = document.createElement('script');
  audit.id = 'audio-audit';
  audit.type = 'application/json';
  document.body.append(audit);
  const ramp = (param, value, t = 0.15) => {
    if (!ctx) return;
    param.cancelScheduledValues(ctx.currentTime);
    param.setTargetAtTime(value, ctx.currentTime, t);
  };
  function save() {
    try {
      localStorage.setItem('field-audio', JSON.stringify(prefs));
    } catch {}
  }
  function paint() {
    musicButton.textContent = '音乐：' + (prefs.music ? '开' : '关');
    effectsButton.textContent = '音效：' + (prefs.effects ? '开' : '关');
    musicButton.setAttribute('aria-pressed', String(prefs.music));
    effectsButton.setAttribute('aria-pressed', String(prefs.effects));
    musicSlider.value = Math.round(prefs.musicVolume * 100);
    effectsSlider.value = Math.round(prefs.effectsVolume * 100);
    status.textContent = error || music.snapshot().error || '音乐与音效保持轻声，可分别调节';
  }
  function publish() {
    audit.textContent = JSON.stringify({
      unlocked,
      playing,
      context: ctx?.state || 'not-started',
      music: {
        ...music.snapshot(),
        enabled: prefs.music,
        volume: prefs.musicVolume,
      },
      houseMusic: houseMusic.snapshot(),
      corralVoice: corralVoice.snapshot(),
      calfLiftVoice: liftVoice.snapshot(),
      lookoutBell: lookoutBell?.snapshot() ?? { active: 0 },
      paddyPlough: paddyPloughAudio?.snapshot() ?? { active: 0 },
      paddyCowVoice: paddyCowVoice.snapshot(),
      lookoutVoice: lookoutVoice.snapshot(),
      gateSignalVoice: gateSignalVoice.snapshot(),
      effects: {
        enabled: prefs.effects,
        volume: prefs.effectsVolume,
        gain: fxBus?.gain.value || 0,
        engine: engineGain?.gain.value || 0,
        rolling: rollingGain?.gain.value || 0,
        brake: brakeGain?.gain.value || 0,
      },
      howlVoice: howlVoice.snapshot(),
      responseVoice: responseVoice.snapshot(),
      collisionVoice: collisionVoice.snapshot(),
      calfVoice: calfVoice.snapshot(),
      bullVoice: bullVoice.snapshot(),
      error,
    });
  }
  function noise() {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    let seed = 3781;
    const data = b.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = ((seed / 4294967296) * 2 - 1) * 0.65;
    }
    return b;
  }
  function noiseLayer(buffer, freq, q) {
    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter(),
      gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    filter.Q.value = q;
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(fxBus);
    source.start();
    return gain;
  }
  async function unlock() {
    try {
      if (!ctx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) throw new Error('Audio unavailable');
        ctx = new AudioContext();
        ctx.addEventListener('statechange', publish);
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.ratio.value = 3;
        compressor.connect(ctx.destination);
        fxBus = ctx.createGain();
        fxBus.gain.value = 0;
        fxBus.connect(compressor);
        lookoutBell = createLookoutBell(ctx, fxBus);
        paddyPloughAudio = createPaddyPloughAudio(ctx, fxBus);
        music.connect(ctx, compressor);
        houseMusic.connect(ctx, compressor);
        engineGain = ctx.createGain();
        engineGain.gain.value = 0;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        engineGain.connect(filter).connect(fxBus);
        for (const [multiple, weight] of [
          [1, 1],
          [2, 0.22],
        ]) {
          const o = ctx.createOscillator(),
            g = ctx.createGain();
          o.type = multiple === 1 ? 'sine' : 'triangle';
          o.frequency.value = 52 * multiple;
          g.gain.value = weight;
          o.connect(g).connect(engineGain);
          o.start();
          oscillators.push({ o, multiple });
        }
        const buffer = noise();
        rollingGain = noiseLayer(buffer, 460, 0.4);
        brakeGain = noiseLayer(buffer, 700, 0.35);
      }
      await ctx.resume();
      unlocked = true;
      apply();
      if (!playing) await ctx.suspend();
    } catch (e) {
      music.stop();
      houseMusic.stop();
      ctx?.close().catch(() => {});
      ctx = null;
      fxBus = null;
      lookoutBell?.stop();
      lookoutBell = null;
      paddyPloughAudio?.stop();
      paddyCowVoice.stop();
      paddyPloughAudio = null;
      engineGain = null;
      rollingGain = null;
      brakeGain = null;
      oscillators = [];
      unlocked = false;
      error = '声音暂不可用，仍可继续驾驶';
      console.warn('Audio initialization failed', e);
      paint();
      publish();
    }
  }
  function apply() {
    paddyCowVoice.sync({
      enabled: unlocked && playing && prefs.effects,
      volume: prefs.effectsVolume,
      position: effectsPosition,
    });
    liftVoice.sync({
      enabled: unlocked && playing && prefs.effects,
      volume: prefs.effectsVolume,
      position: effectsPosition,
    });
    corralVoice.sync({
      enabled: unlocked && playing && prefs.effects,
      volume: prefs.effectsVolume,
      position: corralListenerPosition,
    });
    for (const media of Object.values(responseMedia)) media.volume = prefs.effectsVolume;
    if (!prefs.effects || !playing || prefs.effectsVolume <= 0) howlVoice.stop();
    howlMedia.volume = prefs.effectsVolume;
    if (!prefs.effects || !playing || prefs.effectsVolume <= 0) responseVoice.stop();
    for (const media of Object.values(collisionMedia)) media.volume = prefs.effectsVolume;
    if (!prefs.effects || !playing || prefs.effectsVolume <= 0) collisionVoice.stop();
    bullWarningMedia.volume = prefs.effectsVolume;
    bullMedia.volume = prefs.effectsVolume;
    if (!prefs.effects || !playing || prefs.effectsVolume <= 0) bullVoice.cancel();
    calfMedia.volume = prefs.effectsVolume;
    if (!prefs.effects || !playing || prefs.effectsVolume <= 0) calfVoice.stop();
    if (!prefs.effects || !playing || prefs.effectsVolume <= 0) {
      lookoutBell?.stop();
      paddyPloughAudio?.stop();
      paddyCowVoice.stop();
      lookoutVoice.stop();
      gateSignalVoice.stop();
    }
    ramp(fxBus?.gain, prefs.effects && playing ? prefs.effectsVolume : 0, 0.12);
    houseMusic.sync({
      playing: unlocked && playing,
      enabled: prefs.music,
      volume: prefs.musicVolume * dialogueFactor,
    });
    music.sync({
      playing: unlocked && playing,
      enabled: prefs.music,
      volume: prefs.musicVolume * dialogueFactor,
    });
    music.update(0, houseMusic.backgroundFactor());
    paint();
    publish();
  }
  function setPlaying(value) {
    playing = value;
    if (!value) {
      corralVoice.stop();
      liftVoice.stop();
      howlVoice.stop();
      responseVoice.stop();
      collisionVoice.stop();
      bullVoice.cancel();
      calfVoice.stop();
      lookoutBell?.stop();
      paddyPloughAudio?.stop();
      paddyCowVoice.stop();
      lookoutVoice.stop();
      gateSignalVoice.stop();
      music.stop();
      houseMusic.stop();
      if (ctx) ctx.suspend().catch(() => {});
    } else if (unlocked) {
      ctx
        .resume()
        .then(apply)
        .catch(() => {});
    }
    publish();
  }
  function playResponse(mode, handoff = false) {
    const enabled =
      playing &&
      prefs.effects &&
      prefs.effectsVolume > 0 &&
      (handoff || collisionVoice.ready()) &&
      !corralVoice.busy() &&
      !liftVoice.busy() &&
      !responseVoice.busy() &&
      !howlVoice.busy();
    // Finish the initiating cry before handing the shared slot to the bull.
    if (enabled) {
      collisionVoice.stop();
      calfVoice.stop();
      bullVoice.cancel();
      for (const media of Object.values(responseMedia)) media.volume = prefs.effectsVolume;
    }
    return responseVoice.play(mode, enabled);
  }
  function bump() {
    if (!ctx || !playing || !prefs.effects || ctx.currentTime - lastHit < 1.2) return;
    lastHit = ctx.currentTime;
    const o = ctx.createOscillator(),
      gain = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(92, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(44, ctx.currentTime + 0.14);
    gain.gain.setValueAtTime(0.045, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    o.connect(gain).connect(fxBus);
    o.start();
    o.stop(ctx.currentTime + 0.2);
    o.onended = () => {
      o.disconnect();
      gain.disconnect();
    };
  }
  function update(state, input, hit = false) {
    music.update(0, houseMusic.backgroundFactor());
    if (ctx && playing) {
      const target = vehicleTargets(state, input);
      for (const { o, multiple } of oscillators)
        ramp(o.frequency, target.frequency * multiple, 0.22);
      ramp(engineGain.gain, target.engine, 0.18);
      ramp(rollingGain.gain, target.rolling, 0.25);
      ramp(brakeGain.gain, target.brake, 0.12);
      if (hit) bump();
    }
    if (performance.now() - lastAudit > 500) {
      lastAudit = performance.now();
      publish();
    }
  }
  musicButton.addEventListener('click', () => {
    prefs.music = !prefs.music;
    save();
    if (!unlocked) void unlock();
    else apply();
  });
  effectsButton.addEventListener('click', () => {
    prefs.effects = !prefs.effects;
    save();
    if (!prefs.effects) {
      corralVoice.stop();
      liftVoice.stop();
      howlVoice.stop();
      responseVoice.stop();
      collisionVoice.stop();
      calfVoice.stop();
      bullVoice.cancel();
    }
    if (!unlocked) void unlock();
    else apply();
  });
  for (const [slider, key] of [
    [musicSlider, 'musicVolume'],
    [effectsSlider, 'effectsVolume'],
  ])
    slider.addEventListener('input', () => {
      prefs[key] = Math.min(0.35, Math.max(0, Number(slider.value) / 100));
      save();
      apply();
    });
  paint();
  publish();
  return {
    preferences: () => ({ ...prefs }),
    dialogue(active) {
      const next = active ? 0.55 : 1;
      if (next !== dialogueFactor) {
        dialogueFactor = next;
        apply();
      }
    },
    unlock,
    setPlaying,
    update,
    setTimeOfDay: (mode) => music.setTimeOfDay(mode),
    musicTick: (dt) => music.update(dt, houseMusic.backgroundFactor()),
    spatialUpdate(position, heading, corralPosition = position) {
      effectsPosition = position;
      paddyCowVoice.sync({
        enabled: unlocked && playing && prefs.effects,
        volume: prefs.effectsVolume,
        position,
      });
      corralListenerPosition = corralPosition;
      liftVoice.sync({
        enabled: unlocked && playing && prefs.effects,
        volume: prefs.effectsVolume,
        position,
      });
      corralVoice.sync({
        enabled: unlocked && playing && prefs.effects,
        volume: prefs.effectsVolume,
        position: corralListenerPosition,
      });
      lookoutVoice.sync({
        enabled: unlocked && playing && prefs.effects,
        volume: prefs.effectsVolume,
        position,
      });
      gateSignalVoice.sync({
        enabled: unlocked && playing && prefs.effects,
        volume: prefs.effectsVolume,
        position,
      });
      houseMusic.update(position, heading);
      music.update(0, houseMusic.backgroundFactor());
    },
    impact: bump,
    paddyPloughSound(event, notify) {
      if (event.type === 'cow-stop') {
        paddyCowVoice.stop();
        return false;
      }
      if (event.type === 'cow-position') {
        paddyCowVoice.move(event);
        return false;
      }
      if (event.type === 'cow-call')
        return paddyCowVoice.request(
          event,
          !!ctx && unlocked && playing && prefs.effects && prefs.effectsVolume > 0,
          notify,
        );
      if (!ctx || !unlocked || !playing || !prefs.effects || prefs.effectsVolume <= 0) return false;
      return paddyPloughAudio?.play(event, effectsPosition) ?? false;
    },
    lookoutSound(event, notify) {
      if (event.type === 'lookout-voice-stop') {
        lookoutVoice.stop();
        return false;
      }
      if (event.type === 'lookout-cancel') {
        lookoutBell?.stop();
        lookoutVoice.stop();
        return false;
      }
      if (!ctx || !unlocked || !playing || !prefs.effects || prefs.effectsVolume <= 0) return false;
      const accepted =
        event.type === 'lookout-voice'
          ? lookoutVoice.request(event, true, notify)
          : (lookoutBell?.play(event, effectsPosition) ?? false);
      publish();
      return accepted;
    },
    calfLiftSound(event, onPlayback) {
      return liftVoice.request(
        event,
        unlocked && playing && prefs.effects && prefs.effectsVolume > 0,
        onPlayback,
      );
    },
    gateSignalSound(event, notify) {
      if (event.type === 'gate-signal-stop') {
        gateSignalVoice.stop();
        return false;
      }
      return gateSignalVoice.request(
        event,
        unlocked && playing && prefs.effects && prefs.effectsVolume > 0,
        notify,
      );
    },
    animalCall(hit) {
      const accepted = corralVoice.event(
        { ...hit, type: 'animal-call', listener: effectsPosition },
        unlocked && playing && prefs.effects && prefs.effectsVolume > 0,
      );
      publish();
      return accepted;
    },
    corralSound(event) {
      const enabled = unlocked && playing && prefs.effects && prefs.effectsVolume > 0;
      if (
        [
          'zombie-no',
          'animal-position',
          'animal-tap',
          'animal-run',
          'animal-stop',
          'calf-confined-call',
          'bull-rescue',
        ].includes(event.type)
      ) {
        corralVoice.event(event, enabled);
        publish();
        return;
      }
      if (!ctx || !enabled) return;
      const distance = effectsPosition
        ? Math.hypot(event.x - effectsPosition.x, event.z - effectsPosition.z)
        : 0;
      const spatial = Math.max(0, 1 - distance / 55) ** 2;
      if (spatial <= 0) return;
      const duration =
        event.type === 'gate-open' ? 0.65 : event.type === 'gate-close' ? 0.45 : 0.11;
      const o = ctx.createOscillator(),
        gain = ctx.createGain();
      const creak = event.type === 'gate-open';
      o.type = creak ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(
        creak ? 165 : event.type === 'gate-latch' ? 420 : 105,
        ctx.currentTime,
      );
      o.frequency.exponentialRampToValueAtTime(creak ? 85 : 48, ctx.currentTime + duration);
      gain.gain.setValueAtTime(0.035 * spatial, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
      o.connect(gain).connect(fxBus);
      o.start();
      o.stop(ctx.currentTime + duration);
      o.onended = () => {
        o.disconnect();
        gain.disconnect();
      };
    },
    stopBull: () => bullVoice.stop(),
    stopWolfHowl: () => howlVoice.stop(),
    wolfHowl() {
      const bull = bullVoice.snapshot();
      howlMedia.volume = prefs.effectsVolume;
      return howlVoice.request(
        unlocked &&
          playing &&
          prefs.effects &&
          prefs.effectsVolume > 0 &&
          !collisionVoice.busy() &&
          !corralVoice.busy() &&
          !liftVoice.busy() &&
          !responseVoice.busy() &&
          !calfVoice.snapshot().busy &&
          !bull.busy &&
          !bull.warning.busy,
      );
    },
    collisionTick: (dt) => collisionVoice.update(dt),
    animalCollision(hit) {
      if (corralVoice.busy() || liftVoice.busy()) return false;
      if (
        responseVoice.snapshot().mode === 'follow' &&
        ['copper-cow', 'golden-cow'].includes(hit.id)
      )
        responseVoice.stop();
      if (hit.id === 'golden-cow' && collisionVoice.snapshot().id === 'hornless-calf')
        collisionVoice.stop();
      if (hit.response) return playResponse(hit.response);
      if (howlVoice.busy()) return false;
      if (responseVoice.busy()) return false;
      if (hit.id === 'copper-cow') bullVoice.cancel();
      if (hit.id === 'golden-cow' || hit.id === 'hornless-calf') calfVoice.stop();
      for (const media of Object.values(collisionMedia)) media.volume = prefs.effectsVolume;
      const bull = bullVoice.snapshot();
      return collisionVoice.hit(
        hit,
        playing &&
          prefs.effects &&
          prefs.effectsVolume > 0 &&
          !calfVoice.snapshot().busy &&
          !bull.busy &&
          !bull.warning.busy,
      );
    },
    animalBite() {
      if (corralVoice.busy() || liftVoice.busy()) return false;
      if (!playing) return false;
      howlVoice.stop();
      responseVoice.stop();
      calfVoice.stop();
      bullVoice.cancel();
      for (const media of Object.values(collisionMedia)) media.volume = prefs.effectsVolume;
      return collisionVoice.bite(prefs.effects && prefs.effectsVolume > 0);
    },
    animalTap(hit) {
      if (corralVoice.busy() || liftVoice.busy()) {
        if (hit.charge) bullCharge.event?.('cancel');
        return false;
      }
      if (howlVoice.busy() || collisionVoice.busy() || responseVoice.busy()) {
        if (hit.charge) bullCharge.event?.('cancel');
        return false;
      }
      const oldBull = bullVoice.snapshot(),
        free = !calfVoice.snapshot().busy && !oldBull.busy && !oldBull.warning.busy;
      if (hit?.id === 'reference-wolf') return playing && free && encounters.tap?.();
      if (hit?.id === 'baola-leopard') {
        collisionMedia['leopard-tap'].volume = prefs.effectsVolume;
        return collisionVoice.tap(playing && prefs.effects && prefs.effectsVolume > 0 && free);
      }
      if (hit?.id === 'copper-cow') {
        bullWarningMedia.volume = prefs.effectsVolume;
        bullMedia.volume = prefs.effectsVolume;
        const accepted = bullVoice.tap(hit, playing && prefs.effects && prefs.effectsVolume > 0);
        if (hit.charge && !accepted) bullCharge.event?.('cancel');
        return accepted;
      }
      calfMedia.volume = prefs.effectsVolume;
      return calfVoice.tap(hit, playing && prefs.effects && prefs.effectsVolume > 0);
    },
  };
}
