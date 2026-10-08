import * as THREE from 'three';
import { bindCameraPointer } from '../camera-pointer.js';
import { createActionMenu } from '../action-menu.js';
import { createSceneActions, pickActionTarget } from '../scene-actions.js';
export function bindGameInput({
  renderer,
  scene,
  camera,
  getField,
  getState,
  getMode,
  getQA,
  getTimeOfDay,
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
  getCar,
  controlMode,
}) {
  const $ = (id) => document.getElementById(id);
  let drag = null;
  let actionMenu, cameraPointer;
  const sceneActions = createSceneActions({
    getField,
    getCar: getState,
    getTimeOfDay,
    animalTap: (hit) => audio.animalTap(hit),
    animalCall: (hit) => audio.animalCall(hit),
    resetView,
    resetCar: reset,
    selectLight: (beam) => {
      lightControl.select(beam);
      publishLights();
    },
  });
  actionMenu = createActionMenu({
    host: $('game'),
    actions: sceneActions.actions,
    status: sceneActions.status,
    execute: (target, id) => {
      if (getMode() !== 'playing') return { ok: false, message: '请先继续游戏' };
      void audio.unlock();
      return sceneActions.execute(target, id);
    },
    onOpen: clearInput,
    onResult: toast,
  });
  const pointerRay = (e) => {
    const rect = renderer.domElement.getBoundingClientRect(),
      ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    return ray;
  };
  let scenePointer = null;
  const rememberPointer = (event) => {
    scenePointer = { clientX: event.clientX, clientY: event.clientY };
  };
  renderer.domElement.addEventListener('pointermove', rememberPointer);
  renderer.domElement.addEventListener('pointerenter', rememberPointer);
  renderer.domElement.addEventListener('pointerdown', rememberPointer);
  renderer.domElement.addEventListener('pointerup', rememberPointer);
  renderer.domElement.addEventListener('pointerleave', () => {
    scenePointer = null;
  });
  const showActions = (event) => {
    const field = getField();
    if (!field) return;
    actionMenu.show(pickActionTarget(scene, pointerRay(event), field, getCar()), event);
  };
  const keys = {
    KeyW: 'forward',
    ArrowUp: 'forward',
    KeyS: 'backward',
    ArrowDown: 'backward',
    KeyA: 'left',
    ArrowLeft: 'left',
    KeyD: 'right',
    ArrowRight: 'right',
    Space: 'brake',
    ShiftLeft: 'drift',
    ShiftRight: 'drift',
  };
  const held = heldKeys;
  const refresh = () => {
    for (const k in input) input[k] = false;
    for (const key of held) if (keys[key]) input[keys[key]] = true;
  };
  addEventListener('keydown', (e) => {
    if (
      e.target.matches?.('input, textarea, select, [contenteditable="true"]') &&
      e.code !== 'Escape'
    )
      return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (keys[e.code]) e.preventDefault();
    if (e.repeat) return;
    if (actionMenu.open) {
      actionMenu.handleKey(e);
      return;
    }
    if (e.code === 'Escape' && getMode() !== 'intro') {
      held.clear();
      setMode(getMode() === 'paused' ? 'playing' : 'paused');
      return;
    }
    if (getMode() !== 'playing') return;
    if (e.code === 'KeyE') {
      e.preventDefault();
      if (scenePointer && !drag) showActions(scenePointer);
      return;
    }
    if (keys[e.code]) {
      held.add(e.code);
      refresh();
    }
    if (e.code === 'KeyR') {
      held.clear();
      reset();
    }
    if (e.code === 'KeyC') resetView();
    if (e.code === 'KeyL') {
      lightControl.toggle();
      publishLights();
    }
    if (e.code === 'KeyH') {
      if (!lightControl.toggleBeam()) toast('按 L 打开车灯');
      publishLights();
    }
  });
  addEventListener('keyup', (e) => {
    held.delete(e.code);
    refresh();
  });
  const loseFocus = () => {
    held.clear();
    clearInput();
    const ploughCapture =
      qaParams.has('qa') && qaParams.has('capture') && qaParams.has('ploughview');
    if (getMode() === 'playing' && !ploughCapture) setMode('paused');
  };
  addEventListener('blur', loseFocus);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loseFocus();
  });
  cameraPointer = bindCameraPointer(renderer.domElement, {
    isPlaying: () => getMode() === 'playing',
    getInspection: () => getQA()?.inspectionCamera,
    onDrag: (next) => {
      drag = next;
    },
    rotateOrbit(dx, dy) {
      const targetOrbit = orbit;
      targetOrbit.yaw -= dx * 0.006;
      targetOrbit.pitch = THREE.MathUtils.clamp(targetOrbit.pitch + dy * 0.004, 0.13, 0.95);
    },
    onSelect: showActions,
  });
  renderer.domElement.addEventListener(
    'wheel',
    (e) => {
      if (getMode() !== 'playing' || actionMenu.open) return;
      e.preventDefault();
      if (getQA()?.inspectionCamera.zoom(e.deltaY)) return;
      const targetOrbit = orbit;
      targetOrbit.distance = THREE.MathUtils.clamp(
        targetOrbit.distance + e.deltaY * 0.012,
        6.5,
        24,
      );
    },
    { passive: false },
  );
  ui.start.addEventListener('click', () => {
    void audio.unlock();
    void explorationAudio.unlock();
    held.clear();
    setMode('playing');
    toast('左键 / E 选动作 · 数字键选择 · 右键拖动转镜头');
  });
  ui.pause.addEventListener('click', () => {
    held.clear();
    setMode(getMode() === 'paused' ? 'playing' : 'paused');
  });
  $('resume').addEventListener('click', () => {
    void audio.unlock();
    void explorationAudio.unlock();
    held.clear();
    setMode('playing');
  });
  $('reset-pause').addEventListener('click', () => {
    held.clear();
    reset();
    setMode('playing');
  });
  for (const option of ['off', 'low', 'high'])
    $('light-' + option).addEventListener('click', () => {
      lightControl.select(option);
      publishLights();
    });
  publishLights();
  $('game').dataset.control = controlMode;
  return {
    menu: actionMenu,
    pointer: cameraPointer,
    get drag() {
      return drag;
    },
    cancel() {
      drag = null;
      cameraPointer.cancel();
    },
  };
}
