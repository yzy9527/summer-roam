import { message } from './messages.js';
import { COMEDY_ACTIONS } from './gameplay/zombies/comedy.js';
const ANIMAL_NAMES = {
  'golden-cow': message('actions.mother'),
  'copper-cow': message('actions.bull'),
  'hornless-calf': message('actions.calf'),
  'reference-wolf': message('actions.wolf'),
  'baola-leopard': message('actions.leopard'),
};

function visible(node) {
  for (let n = node; n; n = n.parent) if (!n.visible) return false;
  const materials = Array.isArray(node.material) ? node.material : [node.material];
  return !node.isSprite && materials.some((m) => m && m.visible !== false && m.opacity !== 0);
}

// Selection never calls pat(), reserves an animal or changes a controller phase.
export function pickActionTarget(scene, ray, field, car) {
  scene.updateMatrixWorld(true);
  scene.traverseVisible((n) => {
    if (n.isSkinnedMesh) {
      n.skeleton.update();
      n.computeBoundingSphere();
      n.computeBoundingBox();
    }
  });
  const hit = ray.intersectObjects(scene.children, true).find((h) => visible(h.object));
  if (!hit) return { type: 'world', name: message('actions.field') };
  const animals = Object.keys(ANIMAL_NAMES)
    .map((id) => field?.animals?.animal(id))
    .filter(Boolean);
  const confined = field?.corral?.animals ?? [];
  for (let n = hit.object; n; n = n.parent) {
    const animal = [...confined, ...animals].find((a) => a.group === n);
    if (animal)
      return { type: 'animal', animal, name: ANIMAL_NAMES[animal.id], point: hit.point.clone() };
    if (n === field?.corral?.model.gate) return { type: 'gate', name: message('actions.gate') };
    for (const [id, name] of [
      ['pvz-browncoat', message('actions.browncoat')],
      ['pvz-flagbearer', message('actions.flagbearer')],
      ['pvz-ploughman', message('actions.ploughman')],
      ['pvz-gargantuar', message('actions.giant')],
      ['pvz-conehead', message('actions.conehead')],
      ['pvz-gatekeeper', message('actions.gatekeeper')],
      ['pvz-lookout', message('actions.lookout')],
    ])
      if (n === field?.zombies?.actor(id)?.object) return { type: 'actor', id, name };
    if (n === field?.woodenCart?.root) return { type: 'cart', name: message('actions.cart') };
    if (n === car) return { type: 'vehicle', name: message('actions.car') };
  }
  return { type: 'world', name: message('actions.field') };
}

export function createSceneActions({
  getField,
  getCar,
  getTimeOfDay,
  animalTap,
  animalCall,
  resetView,
  resetCar,
  selectLight,
}) {
  function actions(target) {
    const field = getField(),
      result = [];
    const add = (id, label, run, reason = '', group = message('actions.current'), detail = '') =>
      result.push({ id, label, run, reason, group, detail });
    if (!field) return [];
    const a = target?.animal,
      meadow = field.animals,
      corral = field.corral;
    if (a) {
      const confined = corral?.animals.includes(a);
      const valid = confined || meadow.animal(a.id) === a;
      if (!valid) return [];
      const unavailable = (action) => meadow.actionAvailability(a, action);
      const held =
        a.mode === 'recapture-held' || ['plough', 'milk-visit'].includes(a.transportOwner);
      add(
        'tap',
        a.id === 'reference-wolf' ? message('actions.touch') : message('actions.tap'),
        () => {
          if (corral?.animals.includes(a)) {
            corral.touch(a, target.point);
            return true;
          }
          return meadow.touch(a, target.point, getCar(), animalTap);
        },
        confined
          ? held
            ? a.transportOwner === 'milk-visit'
              ? message('reason.drinking')
              : a.transportOwner === 'plough'
                ? message('reason.ploughing')
                : message('reason.held')
            : ''
          : unavailable('tap'),
        message('actions.current'),
        a.id === 'reference-wolf' ? message('actions.touchDetail') : message('actions.tapDetail'),
      );
      add(
        'call',
        a.id === 'reference-wolf' ? message('actions.howl') : message('actions.call'),
        () => animalCall({ id: a.id, instanceId: a.instanceId ?? a.id, x: a.x, z: a.z }),
        confined
          ? held
            ? a.transportOwner === 'milk-visit'
              ? message('reason.drinking')
              : a.transportOwner === 'plough'
                ? message('reason.ploughing')
                : message('reason.held')
            : ''
          : unavailable('call'),
        message('actions.current'),
        message('actions.callDetail'),
      );
      if (a.id === 'baola-leopard' && field.leopardMilk) {
        const milk = field.leopardMilk,
          state = milk.snapshot();
        const active = state.phase !== 'idle';
        add(
          'milk',
          active ? message('actions.cancelMilk') : message('actions.milk'),
          () => (active ? milk.cancel() : milk.start(getCar())),
          active ? (state.cancelled ? message('reason.safeMilkReturn') : '') : milk.availability(),
          message('actions.current'),
          message('actions.milkDetail'),
        );
      }
      if (!confined && !a.transportOwner) {
        add(
          'graze',
          ['reference-wolf', 'baola-leopard'].includes(a.id)
            ? message('actions.sniff')
            : message('actions.graze'),
          () => meadow.graze(a.id),
          unavailable('graze'),
        );
        add('turn', message('actions.turn'), () => meadow.turn(a.id), unavailable('turn'));
        const asleep = !meadow.sleep.ready(a);
        add(
          asleep ? 'wake' : 'rest',
          asleep ? message('actions.wake') : message('actions.rest'),
          () => (asleep ? meadow.wake(a.id) : meadow.rest(a.id)),
          asleep
            ? unavailable('wake')
            : getTimeOfDay() !== 'night'
              ? message('reason.nightOnly')
              : unavailable('rest'),
        );
        if (a.id === 'reference-wolf') {
          const descent = meadow.mountain?.snapshot().phase === 'summit';
          add(
            'mountain',
            descent ? message('actions.descendMountain') : message('actions.climbMountain'),
            () => (descent ? meadow.mountain.requestDescent() : meadow.mountain?.start(getCar())),
            descent ? '' : unavailable('mountain'),
          );
        }
        if (a.id === 'baola-leopard') {
          const descent = ['lookout', 'lying-down', 'resting'].includes(
            meadow.tree?.snapshot().phase,
          );
          add(
            'tree',
            descent ? message('actions.descendTree') : message('actions.climbTree'),
            () => (descent ? meadow.tree.requestDescent() : meadow.tree?.start(getCar())),
            descent ? '' : unavailable('tree'),
          );
        }
      }
    }
    if (target?.type === 'gate') {
      const gate = corral.snapshot();
      add(
        'open-gate',
        message('actions.openGate'),
        () => corral.setManualGateOpen(true),
        gate.controlled ? message('reason.delivering') : '',
      );
      add(
        'close-gate',
        message('actions.closeGate'),
        () => corral.setManualGateOpen(false),
        gate.controlled ? message('reason.delivering') : '',
      );
    }
    if (target?.id === 'pvz-browncoat') {
      for (const action of COMEDY_ACTIONS)
        add(
          'comedy-' + action.id,
          message(action.label),
          () => field.zombies.performComedy(action.id, getCar()),
          field.zombies?.comedyAvailability() ?? message('actions.comedyNotReady'),
        );
      const taunting = field.zombies?.tauntState?.().active;
      add(
        taunting ? 'cancel-taunt' : 'taunt',
        message(taunting ? 'actions.cancelTaunt' : 'actions.taunt'),
        () => (taunting ? field.zombies.cancelTaunt() : field.zombies.startTaunt(getCar())),
        taunting ? '' : (field.zombies?.tauntAvailability?.() ?? message('actions.tauntNotReady')),
      );
    }
    if (target?.id === 'pvz-ploughman') {
      const task = field.paddyPloughing,
        state = task?.snapshot();
      if (!state?.active)
        add(
          'start-plough',
          message('actions.startPlough'),
          () => task.start(),
          task?.availability() ?? message('reason.ploughNotReady'),
        );
      else
        add(
          'stop-plough',
          state.phase === 'ploughing'
            ? message('actions.endPlough')
            : message('actions.cancelPlough'),
          () => task.stop(),
          state.canStop ? '' : message('reason.ploughReturning'),
        );
    }
    if (target?.id === 'pvz-gatekeeper')
      add('guard-close', message('actions.guardClose'), () => corral?.requestGuardClose());
    if (target?.id === 'pvz-lookout') {
      const lookout = field.lookout,
        heist = field.calfHeist;
      add(
        'ring-bell',
        message('actions.ring'),
        () => lookout.ring(),
        lookout && heist ? lookout.ringAvailability() : message('reason.lookoutNotReady'),
        message('actions.current'),
        message('actions.ringDetail'),
      );
      add(
        'calf-alarm',
        message('actions.alarm'),
        () => heist.alertManual(),
        heist ? heist.alarmAvailability() : message('reason.heistNotReady'),
        message('actions.current'),
        message('actions.alarmDetail'),
      );
    }
    const giant = target?.id === 'pvz-gargantuar',
      cart = target?.type === 'cart';
    if (giant || cart) {
      const h = field.calfHeist,
        r = field.calfRescue,
        calf = meadow?.animal('hornless-calf');
      const hs = h?.snapshot(),
        rs = r?.snapshot();
      const reason = h ? h.manualAvailability(calf) : message('reason.heistNotReady');
      const group = message('actions.calfGroup');
      if (giant) {
        add(
          'hold-calf',
          message('actions.hold'),
          () => h.holdManual(calf),
          reason,
          group,
          message('actions.holdDetail'),
        );
        add(
          'put-down',
          message('actions.lower'),
          () => h.putDownManual(),
          hs?.phase === 'manual-hold' ? '' : message('reason.holdFirst'),
          group,
        );
      }
      if (cart)
        add(
          'capture-calf',
          message('actions.capture'),
          () => h.startManual(calf),
          reason,
          group,
          message('actions.captureDetail'),
        );
      if (giant) {
        add(
          'recapture-calf',
          message('actions.recapture'),
          () => r.startManual(calf),
          r ? r.manualAvailability(calf) : message('reason.rescueNotReady'),
          group,
          message('actions.recaptureDetail'),
        );
        const mode = hs?.carryMode === 'underarm' ? 'two-hand' : 'underarm';
        add(
          'carry-mode',
          mode === 'two-hand' ? message('actions.twoHand') : message('actions.underarm'),
          () => h.setCarryMode(mode),
          h && hs.phase === 'waiting' && reason?.code !== 'reason.giantBusy'
            ? ''
            : message('reason.carryBeforeTask'),
          group,
        );
      }
      if (
        hs?.manualTask &&
        ((giant && hs.manualTask === 'hold') || (cart && hs.manualTask === 'capture'))
      )
        add(
          'cancel-heist',
          message('actions.cancelHeist'),
          () => h.cancelManual(),
          hs.manualCancel || hs.trigger.aborting || hs.trigger.abortRequested
            ? message('reason.finishing')
            : hs.manualTask === 'capture' && (hs.carrying || field.woodenCart?.cargo)
              ? message('reason.cargoLoaded')
              : '',
          group,
        );
      if (giant && rs?.manual)
        add(
          'cancel-rescue',
          message('actions.cancelRescue'),
          () => r.cancelManual(),
          ['dropping', 'fleeing', 'airborne', 'landed', 'leaving'].includes(rs.phase)
            ? message('reason.finishing')
            : '',
          group,
        );
    }
    if (target?.type === 'vehicle') {
      const group = message('actions.carGroup');
      add(
        'camera',
        message('actions.camera'),
        () => {
          resetView();
          return true;
        },
        '',
        group,
      );
      for (const [id, label] of [
        ['off', message('actions.lightOff')],
        ['low', message('actions.lightLow')],
        ['high', message('actions.lightHigh')],
      ])
        add(
          'light-' + id,
          label,
          () => {
            selectLight(id);
            return true;
          },
          '',
          group,
        );
      add(
        'reset-car',
        message('actions.resetCar'),
        () => {
          resetCar();
          return true;
        },
        '',
        group,
      );
    }
    return result;
  }
  return {
    actions,
    status(target) {
      if (target?.id === 'pvz-browncoat') {
        const state = getField()?.zombies?.tauntState?.();
        if (state?.active) return message('actions.tauntRunning');
        if (['no-space', 'blocked', 'timeout', 'missed'].includes(state?.outcome))
          return message('actions.tauntBlocked');
        return '';
      }
      if (target?.animal?.id === 'baola-leopard') return getField()?.leopardMilk?.status() ?? '';
      if (target?.id === 'pvz-flagbearer' || target?.id === 'pvz-ploughman')
        return getField()?.paddyPloughing?.status() ?? '';
      if (target?.id === 'pvz-lookout') {
        const mode = getField()?.lookout?.snapshot().ringMode;
        return mode === 'notice'
          ? message('tasks.ringCrew')
          : mode
            ? message('reason.ringing')
            : '';
      }
      if (target?.type !== 'cart' && target?.id !== 'pvz-gargantuar') return '';
      const field = getField(),
        h = field?.calfHeist?.snapshot(),
        r = field?.calfRescue?.snapshot();
      if (h?.manualTask) {
        if (h.manualCancel || h.trigger.aborting || h.trigger.abortRequested)
          return message('tasks.finishingCapture');
        const phases = {
          'manual-approach': message('tasks.approachCalf'),
          'seek-calf': message('tasks.seekCalf'),
          'face-calf': message('tasks.faceCalf'),
          'crouch-and-grip': message('tasks.grip'),
          'lift-calf': message('tasks.lift'),
          'manual-hold': message('tasks.hold'),
          'manual-lower': message('tasks.lower'),
          'manual-release': message('tasks.release'),
          'manual-leave': message('tasks.leaveCalf'),
          'lookout-notice': message('tasks.lookoutNotice'),
          'crew-boarding': message('tasks.crewBoarding'),
        };
        return (
          phases[h.phase] ?? (h.carrying ? message('tasks.carry') : message('tasks.transport'))
        );
      }
      if (r?.manual) return r.carrying ? message('tasks.rescueCarry') : message('tasks.rescue');
      return '';
    },
    execute(target, id) {
      const action = actions(target).find((a) => a.id === id);
      if (!action) return { ok: false, message: message('actions.unavailable') };
      if (action.reason) return { ok: false, message: action.reason };
      const ok = !!action.run();
      const started =
        [
          'start-plough',
          'stop-plough',
          'ring-bell',
          'calf-alarm',
          'hold-calf',
          'capture-calf',
          'recapture-calf',
          'put-down',
          'cancel-heist',
          'cancel-rescue',
          'milk',
          'taunt',
        ].includes(id) || id.startsWith('comedy-');
      return {
        ok,
        message: ok
          ? message(started ? 'actions.started' : 'actions.executed', { action: action.label })
          : id === 'call'
            ? message('actions.callFailed')
            : message('actions.failed'),
      };
    },
  };
}
