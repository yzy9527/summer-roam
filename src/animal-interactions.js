import { claimAnimal, releaseAnimal } from './gameplay/animal-ownership.js';
import { ANIMAL_PROFILES } from './animal-profiles.js';
import { familyDriveFeedback, updateFamilyDrive } from './animal-drive.js';
import { createAnimalSleep } from './animal-sleep.js';

// Controllers remain the state/ownership source. This layer only routes commands.
// Capture original commands so compatibility methods use the same gates without recursion.
export function createAnimalInteractions(
  { animals, family, charge, encounters, mountain = null, tree = null, sleepSafe = () => true },
  random = () => Math.random(),
) {
  const bull = animals.find((a) => a.id === 'copper-cow');
  const wolf = animals.find((a) => a.id === 'reference-wolf');
  const calf = animals.find((a) => a.id === 'hornless-calf');
  const mother = animals.find((a) => a.id === 'golden-cow');
  const commands = {
    reserveFamily: family.reserve,
    bullTap: charge.tap,
    protect: charge.protect,
    vehicleHit: charge.vehicleHit,
    wolfTap: encounters.tap,
    follow: encounters.follow,
    stopFollow: encounters.stopFollow,
  };
  const api = {
    sleep: createAnimalSleep(
      animals.filter((a) => ANIMAL_PROFILES[a.id]?.sleep),
      {
        busy: (a) =>
          !!a.transportOwner ||
          family.owns(a) ||
          charge.owns(a) ||
          encounters.owns(a) ||
          !!mountain?.owns(a) ||
          !!tree?.owns(a) ||
          (a.behavior.state === 'alert' && a.behavior.time < a.behavior.duration),
        safe: sleepSafe,
        random,
      },
    ),
    canReserveTransport(a) {
      return !!a?.rig && !!a.behavior && !api.owns(a) && a.behavior.state !== 'alert';
    },
    milkAvailability(a) {
      if (!a?.rig || a.id !== 'baola-leopard') return '豹拉尚未就绪';
      if (
        a.transportOwner ||
        family.owns(a) ||
        charge.owns(a) ||
        encounters.owns(a) ||
        mountain?.owns(a)
      )
        return '豹拉正在参与其他任务';
      if (tree?.owns(a) && !tree.interruptible?.(a)) return '请先让豹拉安全下树';
      if (a.behavior.state === 'alert' || a.behavior.driveTime > 0) return '豹拉正在退让';
      return '';
    },
    reserveMilk(a) {
      if (api.milkAvailability(a)) return false;
      tree?.interruptReturn?.(a);
      if (!claimAnimal(a, 'milk-visit')) return false;
      api.sleep.wake(a);
      a.target = a.recoil = null;
      a.velocity = a.motion = a.chargeRun = 0;
      a.gesture = 0;
      return true;
    },
    releaseMilk(a) {
      if (!releaseAnimal(a, 'milk-visit')) return false;
      a.target = a.recoil = null;
      a.velocity = a.motion = a.chargeRun = 0;
      a.wait = 3;
      Object.assign(a.behavior, {
        state: 'idle',
        time: 0,
        down: 0,
        raised: 0,
        escape: null,
        driveTime: 0,
      });
      return true;
    },
    interruptGroundReturn: (a) => tree?.interruptReturn?.(a) ?? false,
    commandOwned: (a) => api.owns(a) && !tree?.interruptible?.(a),
    reserveYield(a) {
      if (!api.canReserveTransport(a) || !api.sleep.ready(a)) return false;
      if (!claimAnimal(a, 'task-yield')) return false;
      a.target = a.recoil = null;
      a.velocity = a.motion = 0;
      Object.assign(a.behavior, { state: 'walking', down: 0, raised: 0, time: 0, driveTime: 0 });
      return true;
    },
    releaseYield(a) {
      if (!releaseAnimal(a, 'task-yield')) return false;
      a.target = null;
      a.velocity = a.motion = 0;
      a.wait = 4;
      if (Math.hypot(a.x - a.homeX, a.z - a.homeZ) > a.range) {
        a.homeX = a.x;
        a.homeZ = a.z;
      }
      Object.assign(a.behavior, { state: 'idle', time: 0, escape: null, driveTime: 0 });
      return true;
    },
    reserveTransport(a) {
      if (!api.canReserveTransport(a)) return false;
      if (!claimAnimal(a, 'heist')) return false;
      return true;
    },
    releaseTransport(a) {
      if (!releaseAnimal(a, 'heist')) return false;
      a.target = a.recoil = null;
      a.velocity = a.motion = 0;
      a.wait = 2;
      a.collisionEscape = false;
      Object.assign(a.behavior, { state: 'idle', time: 0, escape: null, driveTime: 0 });
      return true;
    },
    reserveDefense(a) {
      if (!a?.rig || a.id !== 'copper-cow' || !api.sleep.ready(a) || api.owns(a)) return false;
      if (!claimAnimal(a, 'rescue-defense')) return false;
      a.target = a.recoil = null;
      a.velocity = a.motion = 0;
      return true;
    },
    releaseDefense(a) {
      if (!releaseAnimal(a, 'rescue-defense')) return false;
      a.velocity = a.chargeRun = a.chargePose = a.chargePaw = 0;
      a.collider.radius = a.radius;
      a.wait = 2;
      Object.assign(a.behavior, { state: 'idle', time: 0, down: 0, raised: 0 });
      return true;
    },
    returnFromCorral(a) {
      if (!['corral', 'recapture'].includes(a?.transportOwner)) return false;
      if (!releaseAnimal(a, a.transportOwner)) return false;
      delete a.collider.corralAnimal;
      a.target = a.recoil = null;
      a.velocity = a.motion = a.chargeRun = a.chargePose = 0;
      a.wait = 2;
      a.homeX = a.x;
      a.homeZ = a.z;
      Object.assign(a.behavior, { state: 'idle', time: 0, down: 0, escape: null, driveTime: 0 });
      return true;
    },
    ownersOf(a) {
      return [
        ['family', family],
        ['charge', charge],
        ['encounters', encounters],
        ['sleep', api.sleep],
        ...(mountain ? [['mountain', mountain]] : []),
        ...(tree ? [['tree', tree]] : []),
      ]
        .filter(([, controller]) => controller.owns(a))
        .map(([name]) => name);
    },
    owns: (a) =>
      !!a.transportOwner ||
      api.sleep.owns(a) ||
      family.owns(a) ||
      charge.owns(a) ||
      encounters.owns(a) ||
      !!mountain?.owns(a) ||
      !!tree?.owns(a),
    reserveFamily: () =>
      !calf?.transportOwner &&
      api.sleep.ready(calf) &&
      api.sleep.ready(mother) &&
      !encounters.busy() &&
      commands.reserveFamily(),
    familyEvent: (type, time) => family.event(type, time),
    requestBullTap: (a, car) =>
      a?.id === 'copper-cow' &&
      !a.transportOwner &&
      api.sleep.ready(a) &&
      !encounters.owns(a) &&
      commands.bullTap(car),
    bullEvent: (type, time) => charge.event(type, time),
    requestProtection(car) {
      if (charge.busy() || !bull?.rig || bull.transportOwner || !api.sleep.ready(bull))
        return false;
      // The old encounter update released follow on the next frame. Release before
      // starting charge so its freshly initialized warning pose is never overwritten.
      if (encounters.owns(bull)) commands.stopFollow();
      return commands.protect(car);
    },
    requestWolf(car) {
      if (
        calf?.transportOwner ||
        !api.sleep.ready(wolf) ||
        mountain?.owns(wolf) ||
        family.busy() ||
        !(encounters.canStart?.() ?? !encounters.busy())
      )
        return false;
      if (mountain && random() < 0.5) return mountain.start(car, { run: true });
      if (!api.sleep.ready(calf) || !api.sleep.ready(mother)) return false;
      return commands.wolfTap(car);
    },
    wolfAvailable: () => api.sleep.ready(wolf) && !encounters.busy(),
    biteVoiceEvent: (type) => encounters.biteVoiceEvent(type),
    requestFollow: () =>
      !calf?.transportOwner &&
      api.sleep.ready(bull) &&
      api.sleep.ready(calf) &&
      !charge.busy() &&
      commands.follow(),
    stopFollow: () => commands.stopFollow(),
    vehicleContact(a, car) {
      if (a.transportOwner) return { ignored: true };
      if (!api.sleep.ready(a)) return { ignored: true };
      if (tree?.touchLocked(a)) return { ignored: true };
      if (tree?.owns(a)) tree.cancelApproach();
      if (mountain?.touchLocked(a)) return { ignored: true };
      if (mountain?.owns(a)) mountain.cancelApproach();
      if (encounters.owns(a) || ['golden-cow', 'copper-cow', 'hornless-calf'].includes(a.id))
        encounters.cancel('vehicle-contact');
      if (encounters.owns(a)) commands.stopFollow();
      if (family.owns(a)) family.event('cancel');
      return a.id === 'copper-cow' ? commands.vehicleHit(car) : null;
    },
    tapFeedback(a, source, car) {
      if (a.transportOwner) return true;
      if (charge.owns(a) || encounters.owns(a) || mountain?.owns(a) || tree?.owns(a)) return true;
      if (!family.owns(a)) return false;
      familyDriveFeedback(a, source, (x, z) => family.feedbackAllowed(a, x, z, car));
      return true;
    },
    update(dt, car, timeOfDay, clockDt) {
      // Preserve controller and feedback order, including pause dt=0.
      api.sleep.update(dt, timeOfDay);
      family.update(dt, car);
      charge.update(dt, car);
      encounters.update(dt, car);
      mountain?.update(dt, car, timeOfDay, clockDt);
      tree?.update(dt, car);
      for (const a of animals)
        if (family.owns(a)) {
          const b = a.behavior;
          if (dt > 0) {
            b.swishTime += dt;
            b.reactionTime = (b.reactionTime ?? 10) + dt;
            b.feedbackCooldown = Math.max(0, (b.feedbackCooldown || 0) - dt);
          }
          if (updateFamilyDrive(a, dt, (x, z) => family.feedbackAllowed(a, x, z, car)))
            family.displaced();
        }
    },
    connectAudio(audio, { getCar, onBite, onImpact }) {
      encounters.onBite = (calf, wolf) => {
        onBite(calf, wolf, getCar());
        if (!audio.animalBite()) encounters.biteVoiceEvent('cancel');
      };
      if (mountain) {
        mountain.onHowl = () => audio.wolfHowl();
        mountain.onStopHowl = () => audio.stopWolfHowl();
      }
      charge.onStopVoice = () => audio.stopBull();
      charge.onImpact = (hit) => {
        onImpact(hit);
        audio.impact();
      };
    },
  };
  const leopard = animals.find((a) => a.id === 'baola-leopard');
  if (tree?.available(leopard)) leopard.sleepPeriodic = true;
  tree?.setStartGate(
    () =>
      api.sleep.ready(leopard) &&
      !leopard?.transportOwner &&
      !family.owns(leopard) &&
      !charge.owns(leopard) &&
      !encounters.owns(leopard) &&
      !mountain?.owns(leopard),
  );
  if (tree) tree.onWakeRequest = () => api.sleep.wake(leopard);
  mountain?.setStartGate(() => {
    return (
      api.sleep.ready(wolf) && !encounters.owns(wolf) && !family.owns(wolf) && !charge.owns(wolf)
    );
  });
  encounters.onEscape = (car, calf) =>
    mountain?.start(car, { run: true, stay: 5, departing: [calf] }) ?? false;
  encounters.atMountain = () => !!mountain?.touchLocked(wolf);
  if (mountain) encounters.escapeActive = () => mountain.owns(wolf);
  api.mountainEvent = (type) => mountain?.event(type);
  // Keep controller identity, callbacks, snapshots and legacy method names.
  family.reserve = api.reserveFamily;
  charge.tap = (car) => api.requestBullTap(bull, car);
  charge.protect = api.requestProtection;
  charge.vehicleHit = (car) => (bull ? api.vehicleContact(bull, car) : commands.vehicleHit(car));
  encounters.tap = api.requestWolf;
  encounters.follow = api.requestFollow;
  encounters.stopFollow = api.stopFollow;
  return api;
}

// Audio is constructed before the scene loads; these hooks resolve live objects
// after loading and after resetting the car, retaining the original unavailable defaults.
export function createInteractionAudioHooks(getInteractions, getCar) {
  return {
    wolfMountain: { event: (type) => getInteractions()?.mountainEvent(type) },
    calfFamily: {
      reserve: () => getInteractions()?.reserveFamily() ?? false,
      event: (type, time) => getInteractions()?.familyEvent(type, time),
    },
    encounters: {
      biteVoiceEvent: (type) => getInteractions()?.biteVoiceEvent(type),
      tap: () => getInteractions()?.requestWolf(getCar()) ?? false,
      follow: () => getInteractions()?.requestFollow() ?? false,
      stopFollow: () => getInteractions()?.stopFollow(),
      available: () => getInteractions()?.wolfAvailable() ?? true,
    },
    bullCharge: {
      protect: () => getInteractions()?.requestProtection(getCar()) ?? false,
      event: (type, time) => getInteractions()?.bullEvent(type, time),
    },
  };
}
