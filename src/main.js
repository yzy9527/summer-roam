import { createI18n } from './i18n/index.js';
import { message } from './messages.js';
import { bindLanguageSettings, readLanguagePreference } from './app/language-settings.js';
import { connectGameplayAudio } from './app/gameplay-audio.js';
import { bindGameInput } from './app/input.js';
import { bindGameHud } from './app/hud.js';
import { createVehiclePresentation } from './app/vehicle-presentation.js';
import { createVehicleCamera } from './app/vehicle-camera.js';
import { createInteractionAudioHooks } from './animal-interactions.js';
import { createFieldObserver } from './field-observer.js';
import { bullImpactPose } from './bull-impact.js';
import * as THREE from 'three';
import { createDriveAudio } from './audio.js';
import { validateVehicleAsset, assembleVehicle } from './vehicle-runtime.js';
import { VEHICLE_CONFIG } from './vehicle-config.js';
import { applySceneEnvironment } from './materials.js';
import { buildField } from './field-scene.js';
import { createDayNight } from './day-night.js';
import { createVehicleLightControl, createVehicleLights } from './vehicle-lights.js';
import { INITIAL_MODELS } from './loading/model-plan.js';
import { createModelLoader, prefetchModels, yieldSceneWork } from './loading/model-loader.js';
import { regionAt } from './world-queries.js';
import { spawnState, stepDrive } from './drive.js';
import { createExplorationAudio } from './exploration-audio.js';

const $ = (id) => document.getElementById(id);
const ui = {
  start: $('start'),
  intro: $('intro'),
  pause: $('pause'),
  pausePanel: $('pause-panel'),
  dashboard: $('dashboard'),
  speed: $('speed'),
  gear: $('gear'),
  status: $('drive-status'),
  toast: $('toast'),
};
const i18n = createI18n({ initialLocale: readLanguagePreference() });
const language = bindLanguageSettings({ doc: document, i18n });
const audio = createDriveAudio({
  i18n,
  musicButton: $('music-toggle'),
  effectsButton: $('effects-toggle'),
  musicSlider: $('music-volume'),
  effectsSlider: $('effects-volume'),
  status: $('audio-status'),
  ...createInteractionAudioHooks(
    () => field?.animals?.interactions,
    () => state,
  ),
});
const explorationAudio = createExplorationAudio({ getEffects: audio.preferences });
const controlMode = 'car';
const heldKeys = new Set();
const activeDog = () => field?.noharaFamily?.dog;
const focusState = () => state;
const sceneFocus = () => qa?.inspectionCamera.focus ?? focusState();
const input = {
  forward: false,
  backward: false,
  left: false,
  right: false,
  brake: false,
  drift: false,
};
const lightControl = createVehicleLightControl();
let vehicleLights;
let state = spawnState(),
  mode = 'intro',
  renderer,
  scene,
  camera,
  car,
  body,
  wheels = [],
  lastTime = 0,
  toastUntil = 0,
  lastBump = 0;
const orbit = { yaw: 0, pitch: 0.14, distance: 10 };
let inputBindings = null,
  qa = null,
  hud = null,
  lastDriveStatus = '';
let sunLight,
  hemiLight,
  dayNight,
  field,
  lastRegion = '夏日田野';

let bullImpact = null;
const audioFacing = new THREE.Vector3();
const colliders = [];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function makeCar() {
  car = new THREE.Group();
  car.rotation.order = 'YXZ';
  scene.add(car);
  body = new THREE.Group();
  car.add(body);
}

const vehiclePresentation = createVehiclePresentation({
  getVehicle: () => ({ state, mode, car, body, wheels }),
  getImpact: () => bullImpact,
  setImpact: (value) => {
    bullImpact = value;
  },
  reducedMotion,
});
const vehicleCamera = createVehicleCamera({
  getState: () => state,
  getCamera: () => camera,
  getQA: () => qa,
  getDrag: () => inputBindings?.drag,
  orbit,
  colliders,
});
const updateCar = vehiclePresentation.update;
const updateCamera = vehicleCamera.update;
function clearInput() {
  hud?.closeLights();
  inputBindings?.menu.close();
  heldKeys.clear();
  for (const k in input) input[k] = false;
  inputBindings?.cancel();
}
function toast(text) {
  language.setText(ui.toast, text);
  ui.toast.classList.add('visible');
  toastUntil = performance.now() + 2800;
}
function setMode(next) {
  mode = next;
  audio.setPlaying(next === 'playing');
  explorationAudio.setPlaying(next === 'playing');
  clearInput();
  ui.intro.classList.toggle('hidden', mode !== 'intro');
  ui.pausePanel.classList.toggle('hidden', mode !== 'paused');
  ui.dashboard.classList.toggle('hidden', mode !== 'playing');
  ui.pause.disabled = mode === 'intro';
  ui.pause.textContent = mode === 'paused' ? '▷' : 'Ⅱ';
  ui.pause.setAttribute('aria-label', i18n.t(mode === 'paused' ? 'common.resume' : 'common.pause'));
  hud?.modeChanged();
}
function reset() {
  qa?.resetView();
  bullImpact = null;
  vehiclePresentation.reset();
  orbit.yaw = 0;
  orbit.pitch = 0.14;
  orbit.distance = 10;
  state = spawnState();
  clearInput();
  updateCar(0);
  updateCamera(0, true);
  toast(message('common.resetToast'));
}
function resetView() {
  inputBindings?.cancel();
  qa?.resetView();
  orbit.yaw = 0;
  orbit.pitch = 0.14;
  orbit.distance = 10;
  updateCamera(0, true);
  toast(message('common.cameraToast'));
}
function publishLights() {
  const { mode: lightMode } = lightControl.snapshot();
  vehicleLights?.setMode(lightMode);
  language.setText(
    $('light-status'),
    message('common.lightStatus', {
      beam: message(
        { off: 'common.lightOff', low: 'common.lightLow', high: 'common.lightHigh' }[lightMode],
      ),
    }),
  );
  $('vehicle-light-controls').dataset.beam = lightMode;
  for (const option of ['off', 'low', 'high'])
    $('light-' + option).setAttribute('aria-pressed', String(option === lightMode));
}
function setupInput() {
  inputBindings = bindGameInput({
    i18n,
    hud,
    renderer,
    scene,
    camera,
    getField: () => field,
    getState: () => state,
    getMode: () => mode,
    getQA: () => qa,
    getTimeOfDay: () => dayNight?.snapshot().mode ?? 'day',
    audio,
    explorationAudio,
    lightControl,
    publishLights,
    input,
    heldKeys,
    orbit,
    qaParams,
    ui,
    clearInput,
    setMode,
    reset,
    resetView,
    toast,
    getCar: () => car,
    controlMode,
  });
}
function resize() {
  const w = $('game').clientWidth,
    h = $('game').clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
function animate(time) {
  const rawFrameMs = time - lastTime;
  const dt = Math.min(rawFrameMs / 1000 || 0, 1 / 30);
  lastTime = time;
  if (mode === 'playing') {
    qa?.beforeDrive();
    let hit = null;
    if (bullImpactPose(bullImpact).locked) {
      state.speed = 0;
      delete state.drift;
    } else {
      hit = stepDrive(state, input, dt, colliders, (c) =>
        field?.animals?.collide(c, state, (hit) => audio.animalCollision(hit)),
      );
    }
    audio.collisionTick(Math.max(0, rawFrameMs / 1000 || 0));
    audio.update(state, input, hit);
    audio.musicTick(dt);
    qa?.afterDrive(hit, dt);
    const region = regionAt(state.x, state.z);
    if (region !== lastRegion) {
      lastRegion = region;
      toast(
        region === '日落小镇'
          ? message('common.townArrival')
          : message('common.regionArrival', { region: message('common.region') }),
      );
    }
    if (hit && time - lastBump > 3500) {
      toast(message('common.bumpToast'));
      lastBump = time;
    }
    const speed = String(Math.round(Math.abs(state.speed) * 3.6));
    const gear = state.speed > 0.2 ? 'D' : state.speed < -0.2 ? 'R' : 'N';
    if (ui.speed.textContent !== speed) ui.speed.textContent = speed;
    if (ui.gear.textContent !== gear) ui.gear.textContent = gear;
    const status = input.brake
      ? 'common.braking'
      : state.drift?.active
        ? 'common.drifting'
        : (state.drift?.amount ?? 0) > 0.1
          ? 'common.grip'
          : state.surface === '公路'
            ? region === '日落小镇'
              ? 'common.town'
              : 'common.region'
            : state.surface === '沙滩'
              ? 'common.beach'
              : 'common.grass';
    if (status !== lastDriveStatus) {
      lastDriveStatus = status;
      language.setText(ui.status, message(status));
    }
  }
  updateCar(dt);
  updateCamera(dt);
  camera.getWorldDirection(audioFacing);
  audio.spatialUpdate(
    qa?.inspectionCamera.active ? camera.position : focusState(),
    Math.atan2(audioFacing.x, audioFacing.z),
    focusState(),
  );
  explorationAudio.update(
    mode === 'playing' ? dt : 0,
    focusState(),
    Math.atan2(audioFacing.x, audioFacing.z),
  );
  if (hud.showCompass) $('compass-arrow').style.transform = `rotate(${focusState().heading}rad)`;
  if (time > toastUntil) ui.toast.classList.remove('visible');
  updateAtmosphere();
  field?.update({
    seconds: time * 0.001,
    focus: sceneFocus(),
    dt: mode === 'playing' ? dt : 0,
    cameraPosition: camera.position,
    timeOfDay: dayNight?.snapshot().mode ?? 'day',
    clockDt: mode === 'playing' ? Math.max(0, rawFrameMs / 1000 || 0) : 0,
    player: state,
  });
  if (mode === 'playing')
    for (const event of activeDog()?.events() ?? [])
      explorationAudio.sound(event, activeDog().state);
  dayNight?.update(Math.max(0, rawFrameMs / 1000 || 0), time * 0.001);
  renderer.render(scene, camera);
  observer.recordFrame(time, rawFrameMs, dt);
}
function updateAtmosphere() {
  const focus = sceneFocus();
  sunLight.position.set(focus.x - 30, 62, focus.z - 38);
  sunLight.target.position.set(focus.x, 0, focus.z);
  sunLight.target.updateMatrixWorld();
}
function fail(error) {
  console.error(error);
  $('error-panel').classList.remove('hidden');
  ui.intro.classList.add('hidden');
  ui.dashboard.classList.add('hidden');
  language.setText($('error-message'), message('common.errorWebGL'));
}
const observer = createFieldObserver({
  readGame: () => ({
    mode,
    ...state,
    controlMode,
    player: null,
    shiro: activeDog()?.snapshot(),
    explorationAudio: explorationAudio.snapshot(),
    camera: {
      ...orbit,
      position: camera?.position.toArray(),
      quaternion: camera?.quaternion.toArray(),
      inspection: qa?.inspectionCamera.active ?? false,
    },
    input: { ...input },
    timeOfDay: dayNight?.snapshot(),
    headlights: { ...lightControl.snapshot(), ...vehicleLights?.snapshot() },
  }),
  getRenderer: () => renderer,
  getWheels: () => wheels,
  getField: () => field,
  getImpact: () => bullImpact,
});
const qaParams = new URLSearchParams(location.search);
hud = bindGameHud({
  doc: document,
  i18n,
  getMode: () => mode,
  setMode,
  getTimeOfDay: () => dayNight?.snapshot().mode ?? 'day',
  onResume: () => {
    void audio.unlock();
    void explorationAudio.unlock();
  },
});
language.setText(ui.start, message('common.loading'));
language.setText(ui.status, message('common.departing'));
publishLights();
i18n.subscribe(() => {
  ui.pause.setAttribute('aria-label', i18n.t(mode === 'paused' ? 'common.resume' : 'common.pause'));
  field?.refreshSigns();
});
try {
  if (qaParams.has('qa')) {
    const { createFieldQA } = await import('./field-qa.js');
    qa = createFieldQA({
      i18n,
      params: qaParams,
      getState: () => state,
      getAnimals: () => field?.animals,
      getZombies: () => field?.zombies,
      getWoodenCart: () => field?.woodenCart,
      getCorral: () => field?.corral,
      getCalfHeist: () => field?.calfHeist,
      getCalfRescue: () => field?.calfRescue,
      getLeopardMilk: () => field?.leopardMilk,
      getPaddyPloughing: () => field?.paddyPloughing,
      advanceCalfHeist: (seconds = 10) => field?.advanceCalfHeist(seconds, state),
      getCampsite: () => field?.campsite,
      input,
      colliders,
      orbit,
      audio,
      clearInput,
      setMode,
      reset,
      refreshCar: () => updateCar(0),
      refreshCamera: () => updateCamera(0, true),
      setImpact: (impact) => {
        bullImpact = impact;
      },
      snapshot: observer.snapshot,
    });
  }
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  $('world').appendChild(renderer.domElement);
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    setMode('paused');
    $('error-panel').classList.remove('hidden');
  });
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#bad7e4');
  scene.fog = new THREE.Fog('#a4c9e6', 500, 2800);
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2400);
  hemiLight = new THREE.HemisphereLight('#b3d9fa', '#6c715c', 1.15);
  scene.add(hemiLight);
  const sun = new THREE.DirectionalLight('#fff1cf', 3.0);
  sunLight = sun;
  sun.position.set(-70, 115, 80);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -30,
    right: 30,
    top: 30,
    bottom: -30,
    near: 1,
    far: 300,
  });
  sun.shadow.normalBias = 0.045;
  sun.shadow.bias = -0.0003;
  scene.add(sun);
  prefetchModels(INITIAL_MODELS);
  applySceneEnvironment(renderer, scene);
  await yieldSceneWork();
  makeCar();
  resize();
  updateCar(0);
  updateCamera(0, true);
  setupInput();
  addEventListener('resize', resize);
  // Start rendering immediately; asset failures leave driving available with a message.
  renderer.setAnimationLoop(animate);
  const vehicleLoader = createModelLoader();
  const loadVehicle = async (url) =>
    validateVehicleAsset((await vehicleLoader.loadAsync(url)).scene);
  // Begin the car alongside scenery, retaining the original base-asset fallback.
  const vehicleReady = loadVehicle(VEHICLE_CONFIG.model)
    .then((asset) => ({ asset, fallback: false }))
    .catch(async (primaryError) => {
      console.warn('09 final asset unavailable; loading 09 base asset', primaryError);
      const asset = await loadVehicle(VEHICLE_CONFIG.fallbackModel);
      return { asset, fallback: true };
    })
    .catch((error) => ({ error }));
  field = await buildField(scene, renderer, colliders, {
    progressive: true,
    signText: (key) => i18n.t(key),
    getPlayer: () => state,
  });
  updateCamera(0, true);
  dayNight = createDayNight({
    scene,
    renderer,
    sunLight,
    hemiLight,
    sky: field.sky,
    reducedMotion,
  });
  $('time-toggle').disabled = false;
  $('time-toggle').addEventListener('click', () => {
    const timeOfDay = dayNight.snapshot().mode === 'day' ? 'night' : 'day';
    dayNight.setMode(timeOfDay);
    audio.setTimeOfDay(timeOfDay);
    lightControl.setTimeOfDay(timeOfDay);
    publishLights();
    $('game').dataset.timeOfDay = timeOfDay;
    hud.refreshTime();
    toast(timeOfDay === 'night' ? message('common.nightToast') : message('common.dayToast'));
  });
  try {
    const result = await vehicleReady;
    if (result.error) throw result.error;
    const { asset } = result;
    if (result.fallback) field.warnings.push('09 base fallback');
    scene.remove(car);
    ({ car, body, wheels } = assembleVehicle(asset));
    scene.add(car);
    asset.traverse((n) => {
      if (n.isMesh) {
        n.castShadow = !n.material?.transparent;
        n.receiveShadow = !n.material?.name?.includes('orange enamel');
      }
    });
    vehicleLights = createVehicleLights(car, body);
    publishLights();
    updateCar(0);
    updateCamera(0, true);
  } catch (error) {
    console.error('09 vehicle failed to load', error);
    field.warnings.push('surf-car-09');
  }

  observer.start();
  ui.start.disabled = false;
  language.setText(ui.start, message('common.start'));
  window.__seaside = {
    snapshot: observer.snapshot,
    explorationSnapshot: () => ({
      controlMode,
      ...field.noharaFamily?.snapshot(),
      camera: { ...orbit },
      audio: explorationAudio.snapshot(),
    }),
  };
  performance.mark('drive-ready');
  toast(field.warnings.length ? message('common.partialScenery') : message('common.driveReady'));
  void field
    .loadBackground()
    .then(() => {
      connectGameplayAudio({
        field,
        audio,
        getState: () => state,
        setImpact: (impact) => {
          bullImpact = impact;
        },
      });
      performance.mark('world-ready');
      qa?.mount();
      if (field.warnings.length) toast(message('common.partialScenery'));
    })
    .catch((error) => {
      field.loading.actors = 'failed';
      console.error('Background characters failed to initialize', error);
      toast(message('common.partialActors'));
    });
} catch (error) {
  fail(error);
}
