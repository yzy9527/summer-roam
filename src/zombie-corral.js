import { transferAnimal } from './gameplay/animal-ownership.js';
import { snapshotData } from './app/snapshot-data.js';
import * as THREE from 'three';
import { CALF_ESCAPE_ROUTE } from './calf-escape-route.js';
import { CORRAL, createCorralModel } from './corral-model.js';
import { createCorralGateControl } from './corral-gate-control.js';
import { clearAnimalSegment, dryAnimalPoint, findAnimalPath } from './corral-navigation.js';
import { ANIMAL_MEADOW, inAnimalMeadow } from './animal-meadow.js';
import { createAnimalSleep } from './animal-sleep.js';
import { createCowBehavior, updateCowBehavior, patCow, cowRetreatTarget } from './cow-behavior.js';
import { drivingHeight } from './world-queries.js';

const GUARD = 'pvz-conehead';
const gateZ = CORRAL.z - CORRAL.halfZ;
const guardianHome = { x: CORRAL.x - CORRAL.gateWidth / 2 - 1.8, z: gateZ - 2.2 };
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const CORRAL_CALF_CALL = { interval: 30, probability: 0.5 };
export const CORRAL_MANUAL_CLOSE = { interval: 5, probability: 0.5 };
export const CALF_ESCAPE = { interval: 10, probability: 0.4, prepare: 1, facingAngle: Math.PI / 4 };

export function createZombieCorral(
  scene,
  colliders,
  cart,
  zombies,
  {
    random = Math.random,
    callRandom = Math.random,
    gateRandom = Math.random,
    ground = drivingHeight,
    externalDelivery = true,
    legacyDeliveryFactory = null,
    guard = GUARD,
    gateSide = 'left',
  } = {},
) {
  if (!externalDelivery && !legacyDeliveryFactory)
    throw new Error('Legacy delivery requires the compatibility adapter');
  const GUARD = guard;
  const operator = zombies.actor(GUARD);
  if (!operator.patrolHome) {
    operator.patrolHome = { ...guardianHome };
    operator.layout = { ...operator.layout, ...guardianHome, patrolX: 0.6, patrolZ: 0.6 };
  }
  const model = createCorralModel(scene, colliders, ground, { side: gateSide }),
    animals = [];
  const sleep = createAnimalSleep(animals, {
    busy: (a) => !['confined', 'home'].includes(a.mode) || controlled,
    safe: (a) => !car || Math.hypot(a.x - car.x, a.z - car.z) >= a.radius + 1.7,
    random,
  });
  let phase = externalDelivery ? 'external' : 'arriving',
    elapsed = 0,
    phaseTime = 0,
    gateOpen = false,
    gateAmount = 0,
    controlled = true;
  let firstDraw = true,
    drawIn = 30,
    draws = 0,
    escapeEvents = 0,
    closeIn = null,
    closePending = false;
  let recaptureDelivery = false;
  let ploughLoan = null;
  let deliveryAwaitSignal = false,
    guardGreeting = false;
  let manualCloseActive = false,
    manualCloseIn = null,
    manualCloseDraws = 0,
    manualCloseNotices = 0,
    manualGateClicks = 0,
    manualGateClick = null;
  let car = null;
  const listeners = { sound: () => {} };
  let pursuit = null;
  const directedEscapes = new Map();
  const calfCalls = new WeakMap();
  function updateCalfCalls(timerDt) {
    for (const a of animals) {
      if (a.id !== 'hornless-calf') continue;
      let call = calfCalls.get(a);
      if (!call) {
        call = { in: CORRAL_CALF_CALL.interval, draws: 0, calls: 0, confined: false };
        calfCalls.set(a, call);
      }
      if (a.mode !== 'confined') {
        if (call.confined) emit('animal-stop', a);
        call.in = CORRAL_CALF_CALL.interval;
        call.confined = false;
        continue;
      }
      call.confined = true;
      if (controlled || gateAmount !== 0 || !gateController.settled) continue;
      call.in -= timerDt;
      while (call.in <= 1e-8) {
        call.in += CORRAL_CALF_CALL.interval;
        call.draws++;
        const selected = callRandom() < CORRAL_CALF_CALL.probability;
        if (selected && !sleep.owns(a)) {
          call.calls++;
          emit('calf-confined-call', a);
        }
      }
    }
  }
  function allowed(a, x, z, extra = () => false, margin = 0) {
    return dryAnimalPoint(
      x,
      z,
      a.radius + margin,
      colliders,
      car,
      (c) => c === a.collider || extra(c),
    );
  }
  function inside(a, x, z) {
    return (
      x >= CORRAL.x - CORRAL.halfX + a.radius + 0.3 &&
      x <= CORRAL.x + CORRAL.halfX - a.radius - 0.3 &&
      z >= gateZ + a.radius + 0.3 &&
      z <= CORRAL.z + CORRAL.halfZ - a.radius - 0.3 &&
      allowed(a, x, z)
    );
  }
  function emit(type, a = null) {
    listeners.sound({
      type,
      id: a?.id,
      instanceId: a?.instanceId,
      x: a?.x ?? CORRAL.x,
      z: a?.z ?? gateZ,
    });
  }
  function setPhase(next) {
    phase = next;
    phaseTime = 0;
  }
  function setGate(open, automatic = false) {
    if (guardGreeting) return false;
    if (controlled && !automatic) return false;
    closeIn = null;
    manualCloseIn = null;
    if (open) manualCloseActive = false;
    const accepted = gateController.request(open);
    closePending = gateController.closePending;
    return accepted;
  }
  function manualGate(open) {
    manualGateClicks++;
    manualGateClick = controlled ? 'busy' : 'blocked';
    if (controlled || !gateController.manual(open)) return false;
    gateAmount = gateController.amount;
    gateOpen = gateController.open;
    closePending = false;
    closeIn = null;
    manualCloseActive = open;
    manualCloseIn = open && gateAmount === 1 ? CORRAL_MANUAL_CLOSE.interval : null;
    manualCloseDraws = manualCloseNotices = 0;
    manualGateClick = open ? 'opened' : 'closed';
    return true;
  }
  function updateManualClose(timerDt) {
    if (manualCloseIn === null) return;
    manualCloseIn -= timerDt;
    while (manualCloseIn <= 1e-8) {
      manualCloseIn += CORRAL_MANUAL_CLOSE.interval;
      manualCloseDraws++;
      if (gateRandom() < CORRAL_MANUAL_CLOSE.probability) {
        manualCloseNotices++;
        requestGuardClose();
        break;
      }
    }
  }
  function safeGateClose() {
    // The swept leaf, not just its final position, must stay clear of bodies.
    const hinge = { x: model.gate.position.x, z: gateZ };
    return !animals.some(
      (a) =>
        Math.hypot(a.x - hinge.x, a.z - hinge.z) < CORRAL.gateWidth + a.radius + 0.12 &&
        a.z < gateZ + a.radius + 0.35 &&
        a.x < CORRAL.x + CORRAL.gateWidth / 2 + a.radius,
    );
  }
  function plan(a, goal, { step = 1, padding = 8, ignore } = {}) {
    const route = findAnimalPath(a, goal, (x, z) => allowed(a, x, z, ignore, 0.08), {
      step,
      padding,
    });
    if (route) a.route = route;
    return !!route;
  }
  function moveAnimal(a, dt, speed, reverse = false, ignore = () => false) {
    const goal = a.route[0];
    if (!goal) {
      a.velocity = THREE.MathUtils.damp(a.velocity, 0, 8, dt);
      a.chargeRun = 0;
      return true;
    }
    const dx = goal.x - a.x,
      dz = goal.z - a.z,
      distance = Math.hypot(dx, dz);
    if (distance < 0.1) {
      a.route.shift();
      a.velocity = 0;
      return !a.route.length;
    }
    const desired = Math.atan2(dx, dz) + (reverse ? Math.PI : 0),
      error = angleDifference(desired, a.heading);
    a.heading += THREE.MathUtils.clamp(error, -dt * 1.4, dt * 1.4);
    const aligned = Math.abs(angleDifference(desired, a.heading)) < 0.12;
    const targetSpeed = aligned ? speed * Math.min(1, distance / 0.7) : 0;
    a.velocity = THREE.MathUtils.damp(a.velocity, targetSpeed, 3, dt);
    if (!aligned) a.velocity = 0;
    const step = Math.min(distance, a.velocity * dt);
    const direction = reverse ? -1 : 1;
    const next = {
      x: a.x + Math.sin(a.heading) * direction * step,
      z: a.z + Math.cos(a.heading) * direction * step,
    };
    if (
      step > 1e-8 &&
      !clearAnimalSegment(
        a,
        next,
        (x, z) => (a.mode === 'confined' ? inside(a, x, z) : allowed(a, x, z, ignore)),
        0.08,
      )
    ) {
      a.velocity = 0;
      a.chargeRun = 0;
      a.blocked = true;
      return false;
    }
    a.blocked = false;
    a.distance += step;
    a.x = next.x;
    a.z = next.z;
    a.chargeRun = a.mode === 'escaping' ? THREE.MathUtils.clamp(a.velocity / 3.2, 0, 1) : 0;
    return false;
  }
  function updatePose(a, dt) {
    a.clock += dt;
    if (!sleep.owns(a)) updateCowBehavior(a.behavior, dt, a.velocity > 0.015, random);
    if (legacyDelivery) legacyDelivery.prepareLeadPose(a);
    else delete a.familyLook;
    a.motion = THREE.MathUtils.damp(a.motion, a.velocity > 0.015 ? 1 : 0, 4, dt);
    // Keep a reach reserve over the undulating return route while galloping.
    // Hoof targets still use the actual terrain; lower the torso, never stretch legs.
    a.group.position.set(a.x, a.supportHeight(a.x, a.z) + 0.025 - 0.05 * a.chargeRun, a.z);
    a.group.rotation.y = a.heading;
    Object.assign(a.collider, { x: a.x, z: a.z });
    a.rig.update(dt, a, 0, 0);
    const legs = a.rig.snapshot().legs;
    if (a.velocity > 0.04 && a.lastSwing) {
      const landed = legs.some((leg, i) => a.lastSwing[i] && !leg.swinging);
      if (landed) emit('hoof-step', a);
    }
    a.lastSwing = legs.map((leg) => leg.swinging);
    if (pursuit) emit('animal-position', a);
  }
  function zombieRoute(id, target) {
    const actor = zombies.actor(id);
    if (!actor || actor.seated) return [];
    const pointAllowed = (x, z) => zombies.canStand(id, { x, z }, car);
    return (
      findAnimalPath(actor.object.position, target, pointAllowed, { step: 0.75, padding: 8 }) ??
      findAnimalPath(actor.object.position, target, pointAllowed, { step: 0.25, padding: 8 }) ??
      []
    );
  }
  function walkZombie(id, route, dt, options = {}) {
    if (!route.length) return true;
    if (zombies.walk(id, route[0], dt, { car, ...options })) route.shift();
    const actor = zombies.actor(id);
    actor.corralReplanIn = Math.max(0, (actor.corralReplanIn ?? 0) - dt);
    if (actor.blocked && route.length && actor.corralReplanIn === 0) {
      actor.corralReplanIn = 1;
      const next = zombieRoute(id, route.at(-1));
      if (next.length) route.splice(0, route.length, ...next);
    }
    return !route.length;
  }
  function escaped(a) {
    a.outside = true;
    a.escapeEpoch = (a.escapeEpoch ?? 0) + 1;
    escapeEvents++;
    a.cryIn = 0;
    if (!pursuit) legacyDelivery?.notifyEscape(a);
    // Multiple animals escaping together never postpone the three-second close.
    if (!manualCloseActive && closeIn === null && !closePending) closeIn = 3;
  }
  function chooseHome(a) {
    for (const p of [
      { x: -26, z: 5 },
      { x: -30, z: 3 },
      { x: -20, z: 6 },
      { x: -29, z: 12 },
    ])
      if (allowed(a, p.x, p.z)) return p;
    return null;
  }
  function drawEscape() {
    draws++;
    for (const a of animals)
      if (a.mode === 'confined' && !directedEscapes.has(a) && random() < CALF_ESCAPE.probability) {
        if (!sleep.wake(a, () => startEscape(a))) startEscape(a);
      }
  }
  function startEscape(a) {
    if (!gateOpen || gateAmount < 0.99 || a.mode !== 'confined') return false;
    if (!plan(a, { x: CORRAL.x, z: gateZ - 2.2 }, { step: 0.5, padding: 5 })) return false;
    a.mode = 'escaping';
    a.outside = false;
    a.home = chooseHome(a);
    a.routeGoal = 'exit';
    a.target = null;
    a.behavior.down = 0;
    a.behavior.state = 'walking';
    directedEscapes.delete(a);
    return true;
  }
  function sampleFacingEscape() {
    for (const a of animals) {
      if (a.id !== 'hornless-calf' || a.mode !== 'confined') continue;
      const sample = () => {
        if (!gateOpen || gateAmount < 0.99 || a.mode !== 'confined') return;
        const toward = Math.atan2(CORRAL.x - a.x, gateZ - a.z);
        if (Math.abs(angleDifference(toward, a.heading)) <= CALF_ESCAPE.facingAngle)
          directedEscapes.set(a, CALF_ESCAPE.prepare);
      };
      if (!sleep.wake(a, sample)) sample();
    }
  }
  function requestGuardClose() {
    if (controlled) return false;
    return setGate(false);
  }
  function touch(a, source) {
    if (a.mode === 'recapture-held' || ['plough', 'milk-visit'].includes(a.transportOwner)) return;
    a.taps++;
    if (sleep.wake(a, () => touchResponse(a, source))) return;
    touchResponse(a, source);
  }
  function touchResponse(a, source) {
    const target =
      a.mode === 'confined'
        ? cowRetreatTarget(a, source, (x, z) => inside(a, x, z), [0.8, 0.5, 0.25])
        : null;
    if (patCow(a.behavior, target)) {
      a.target = null;
      a.wait = 1.1;
    }
    // Sound-only: this never calls the meadow attack/family/encounter controllers.
    if (a.id !== 'reference-wolf') emit('animal-tap', a);
  }
  const gateController = createCorralGateControl(model, zombies, colliders, {
    operator: GUARD,
    home: guardianHome,
    routeTo: (target) => zombieRoute(GUARD, target),
    walkRoute: (route, dt) => walkZombie(GUARD, route, dt, { speed: 0.7 }),
    getCar: () => car,
    canClose: safeGateClose,
    beforeClose: (dt) => pursuit?.beforeGuardClose?.(GUARD, dt) ?? true,
    cancelCloseNotice: () => pursuit?.cancelGuardNotice?.(GUARD),
    sound(type) {
      if (type === 'gate-open' || type === 'gate-close') {
        drawIn = 30;
        firstDraw = true;
      }
      emit(type);
    },
  });
  const legacyDelivery = externalDelivery
    ? null
    : legacyDeliveryFactory({
        scene,
        cart,
        zombies,
        ground,
        emit,
        guard: GUARD,
        getPhase: () => phase,
        getPhaseTime: () => phaseTime,
        setPhase,
        setGate,
        gateController,
        receive: (cargo) => api.receive(cargo),
        allowed,
        inside,
        zombieRoute,
        walkZombie,
        moveAnimal,
        updatePose,
        releaseControl: () => {
          controlled = false;
        },
      });
  const api = {
    model,
    animals,
    rope: legacyDelivery?.rope ?? null,
    ramp: legacyDelivery?.ramp ?? null,
    connectPursuit(controller) {
      pursuit = controller;
    },
    gateState: () => ({ gateAmount, gateOperation: gateController.snapshot() }),
    milkAvailability(a) {
      if (
        !a ||
        !animals.includes(a) ||
        a.id !== 'hornless-calf' ||
        a.mode !== 'confined' ||
        a.transportOwner !== 'corral'
      )
        return '需要一头已经关入围栏的小牛';
      if (
        controlled ||
        recaptureDelivery ||
        deliveryAwaitSignal ||
        ploughLoan ||
        gateAmount !== 0 ||
        !gateController.settled
      )
        return '等待小牛入栏、看守关好门';
      return '';
    },
    reserveMilk(a) {
      if (this.milkAvailability(a) || !transferAnimal(a, 'corral', 'milk-visit')) return false;
      directedEscapes.delete(a);
      a.mode = 'milk-feeding';
      a.route = [];
      a.target = null;
      a.velocity = a.motion = a.chargeRun = 0;
      emit('animal-stop', a);
      sleep.wake(a);
      return true;
    },
    milkReady: (a) => a?.transportOwner === 'milk-visit' && sleep.ready(a),
    finishMilk(a) {
      if (!animals.includes(a) || !transferAnimal(a, 'milk-visit', 'corral')) return false;
      a.mode = 'confined';
      a.route = [];
      a.target = null;
      a.wait = 1;
      a.velocity = a.motion = a.chargeRun = 0;
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
    ploughAvailability(a) {
      if (!a || !animals.includes(a) || a.id !== 'hornless-calf' || a.mode !== 'confined')
        return '先将小牛抓回牛栏';
      if (
        controlled ||
        recaptureDelivery ||
        deliveryAwaitSignal ||
        ploughLoan ||
        gateAmount !== 0 ||
        !gateController.settled
      )
        return '等待小牛入栏、看守关好门';
      return '';
    },
    reservePlough(a) {
      if (this.ploughAvailability(a) || !transferAnimal(a, 'corral', 'plough')) return false;
      ploughLoan = a;
      controlled = true;
      directedEscapes.delete(a);
      closeIn = manualCloseIn = null;
      manualCloseActive = false;
      a.mode = 'plough-reserved';
      a.route = [];
      a.velocity = 0;
      emit('animal-stop', a);
      sleep.wake(a);
      return true;
    },
    ploughReady(a) {
      return ploughLoan === a && sleep.ready(a);
    },
    finishPlough(a) {
      if (ploughLoan !== a || gateAmount !== 0 || !gateController.settled) return false;
      ploughLoan = null;
      this.finishDelivery(a);
      controlled = false;
      firstDraw = true;
      drawIn = CALF_ESCAPE.interval;
      return true;
    },
    claimEscapingCalf(a) {
      if (!animals.includes(a) || a.id !== 'hornless-calf' || a.mode !== 'escaping' || !a.outside)
        return false;
      if (!transferAnimal(a, 'corral', 'recapture')) return false;
      a.mode = 'recapture-held';
      recaptureDelivery = true;
      a.velocity = a.motion = a.chargeRun = 0;
      emit('animal-stop', a);
      return true;
    },
    resumeEscape(a) {
      if (!animals.includes(a)) return false;
      recaptureDelivery = false;
      transferAnimal(a, a.transportOwner, 'corral');
      a.mode = 'escaping';
      a.outside = true;
      a.velocity = a.motion = a.chargeRun = 0;
      a.cryIn = 0;
      a.planWait = 0;
      a.home = chooseHome(a);
      // Resume the saved, safe corridor rather than walking through the road.
      a.route = [];
      a.routeGoal = a.z >= -15 && a.x < -17 ? 'west' : a.x < 120 ? 'south' : 'exit';
      a.supportHeight = ground;
      return true;
    },
    returnHome(a) {
      if (!pursuit?.returnHome(a)) return false;
      animals.splice(animals.indexOf(a), 1);
      return true;
    },
    connectAudio(fn) {
      listeners.sound = fn;
    },
    setGateOpen: (open) => setGate(open),
    setManualGateOpen: manualGate,
    prepareGate: (open) => setGate(open, true),
    finishDelivery(a, { awaitSignal = false } = {}) {
      transferAnimal(a, a.transportOwner, 'corral');
      directedEscapes.delete(a);
      a.instanceId = 'transported-' + a.id;
      a.mode = 'confined';
      a.route = [];
      a.velocity = a.motion = 0;
      a.wait = 0.5;
      a.speed = a.id === 'hornless-calf' ? 0.42 : 0.3;
      a.blocked = a.outside = false;
      a.routeGoal = a.target = a.home = null;
      a.planWait = 0;
      a.lastSwing = null;
      Object.assign(a.behavior, createCowBehavior(a.behavior.species), { pats: a.behavior.pats });
      a.chargeRun = a.chargePose = 0;
      a.supportHeight = ground;
      a.collider.corralAnimal = true;
      if (!animals.includes(a)) animals.push(a);
      if (!colliders.includes(a.collider)) colliders.push(a.collider);
      deliveryAwaitSignal = awaitSignal;
      controlled = awaitSignal;
      setPhase('ready');
    },
    beginGuardGreeting() {
      if (!deliveryAwaitSignal || gateAmount < 0.99 || gateController.snapshot().stage !== 'idle')
        return null;
      guardGreeting = true;
      zombies.take(GUARD);
      return zombies.actor(GUARD);
    },
    finishGuardGreeting() {
      if (!guardGreeting) return false;
      guardGreeting = deliveryAwaitSignal = controlled = false;
      return requestGuardClose();
    },
    requestGuardClose,
    touch,
    update(dt, player, clockDt = dt, timeOfDay = 'day') {
      car = player;
      sleep.update(dt, timeOfDay);
      if (!(dt > 0)) return;
      dt = Math.min(dt, 0.1);
      const timerDt = Math.max(0, clockDt);
      elapsed += timerDt;
      phaseTime += dt;
      updateManualClose(timerDt);
      if (closeIn !== null) {
        closeIn = Math.max(0, closeIn - timerDt);
        if (closeIn === 0) {
          closeIn = null;
          requestGuardClose();
        }
      }
      if (!guardGreeting) gateController.update(dt);
      gateAmount = gateController.amount;
      gateOpen = gateController.open;
      closePending = gateController.closePending;
      if (
        manualCloseActive &&
        manualCloseIn === null &&
        manualCloseNotices === 0 &&
        gateAmount === 1 &&
        gateController.target &&
        gateController.settled
      )
        manualCloseIn = CORRAL_MANUAL_CLOSE.interval;
      if (gateAmount === 0 && !gateController.target && gateController.settled) {
        if (!animals.some((a) => a.mode === 'recapture-held')) recaptureDelivery = false;
        manualCloseActive = false;
        manualCloseIn = null;
      }
      const a = animals[0];
      const legacyHandled = legacyDelivery?.update(dt, car, gateAmount, a);
      if (!legacyHandled) for (const animal of animals) updateAnimal(animal, dt, timerDt);
      updateCalfCalls(timerDt);
      if (!controlled && !recaptureDelivery && gateOpen && gateAmount > 0.99 && !closePending) {
        if (firstDraw) {
          firstDraw = false;
          drawIn = pursuit ? CALF_ESCAPE.interval : 30;
          sampleFacingEscape();
          drawEscape();
        } else {
          drawIn -= timerDt;
          if (drawIn <= 0) {
            drawIn += pursuit ? CALF_ESCAPE.interval : 30;
            drawEscape();
          }
        }
      }
      for (const [calf, remaining] of directedEscapes) {
        if (!gateOpen || gateAmount < 0.99 || calf.mode !== 'confined')
          directedEscapes.delete(calf);
        else if (!sleep.owns(calf)) {
          calf.wait = Math.max(calf.wait, 0.2);
          calf.route = [];
          const next = remaining - dt;
          directedEscapes.set(calf, Math.max(0, next));
          if (next <= 0) startEscape(calf);
        }
      }

      legacyDelivery?.updateChase(dt, timerDt, car);
    },
    snapshot: () =>
      snapshotData({
        phase,
        elapsed,
        gateOpen,
        gateAmount,
        gateRequested: gateController.target,
        gateOperation: gateController.snapshot(),
        controlled,
        ploughLoan: !!ploughLoan,
        deliveryAwaitSignal,
        guardGreeting,
        recaptureDelivery,
        drawIn,
        directedEscapes: [...directedEscapes].map(([a, remaining]) => ({ id: a.id, remaining })),
        draws,
        closeIn,
        closePending,
        manualGate: {
          active: manualCloseActive,
          drawIn: manualCloseIn,
          draws: manualCloseDraws,
          notices: manualCloseNotices,
          clicks: manualGateClicks,
          lastClick: manualGateClick,
        },
        chase: legacyDelivery?.chaseSnapshot() ?? { mode: 'idle', time: 0 },
        escapeEvents,
        ropeVisible: legacyDelivery?.rope.visible ?? false,
        driverRoute: legacyDelivery?.driverRoute ?? [],
        crew: zombies.snapshot().zombies.map(({ id, position, blocked }) => ({
          id,
          position,
          blocked,
        })),
        position: [CORRAL.x, ground(CORRAL.x, CORRAL.z), CORRAL.z],
        animals: animals.map((a) => ({
          id: a.id,
          instanceId: a.instanceId,
          confinedCall: calfCalls.has(a) ? { ...calfCalls.get(a) } : null,
          sleep: sleep.snapshot(a),
          mode: a.mode,
          x: a.x,
          z: a.z,
          taps: a.taps,
          velocity: a.velocity,
          blocked: !!a.blocked,
          outside: !!a.outside,
          routeGoal: a.routeGoal,
          route: a.route,
          animation: a.rig.snapshot(),
        })),
      }),
  };
  function updateAnimal(a, dt, timerDt) {
    if (a.mode === 'recapture-held' || ['plough', 'milk-visit'].includes(a.transportOwner)) return;
    if (sleep.owns(a)) {
      a.route = [];
      a.velocity = 0;
      updatePose(a, dt);
      return;
    }
    if (a.mode === 'confined' || a.mode === 'home') {
      const pointAllowed = (x, z) =>
        a.mode === 'confined' ? inside(a, x, z) : inAnimalMeadow(x, z) && allowed(a, x, z);
      a.wait -= dt;
      if (a.behavior.escape && a.behavior.time >= 0.35) {
        if (pointAllowed(a.behavior.escape.x, a.behavior.escape.z)) a.route = [a.behavior.escape];
        a.behavior.escape = null;
      }
      if (a.route.some((p) => !pointAllowed(p.x, p.z))) a.route = [];
      if (!a.route.length && a.wait <= 0) {
        for (let i = 0; i < 12; i++) {
          const center =
            a.mode === 'confined'
              ? CORRAL
              : { x: (ANIMAL_MEADOW.minX + ANIMAL_MEADOW.maxX) / 2, z: 8 };
          const p = { x: center.x + (random() - 0.5) * 5, z: center.z + (random() - 0.5) * 3 };
          if (pointAllowed(p.x, p.z) && clearAnimalSegment(a, p, pointAllowed)) {
            a.route = [p];
            break;
          }
        }
        a.wait = 3 + random() * 4;
      }
      const wasMoving = a.route.length > 0;
      const arrived = moveAnimal(a, dt, a.speed * (a.behavior.driveTime > 0 ? 1.6 : 1));
      if (wasMoving && arrived) a.wait = Math.max(a.wait, 1);
      if (a.blocked) {
        a.route = [];
        a.wait = Math.min(a.wait, 0.5);
      }
    } else if (a.mode === 'escaping') {
      if (!a.outside && a.z < gateZ - a.radius) {
        escaped(a);
      }
      if (!gateOpen && !a.outside) {
        a.mode = 'confined';
        a.route = [];
        a.velocity = 0;
        a.chargeRun = 0;
      } else {
        a.planWait = Math.max(0, (a.planWait ?? 0) - timerDt);
        if (moveAnimal(a, dt, a.id === 'hornless-calf' ? 2.8 : 3.2) && a.planWait === 0) {
          if (a.routeGoal === 'exit' && a.home) {
            // Route below the road endpoint and rice paddies, then back into the meadow.
            if (plan(a, CALF_ESCAPE_ROUTE[1], { step: 2, padding: 12 })) a.routeGoal = 'south';
            else {
              a.blocked = true;
              a.planWait = 2;
            }
          } else if (a.routeGoal === 'south') {
            if (plan(a, CALF_ESCAPE_ROUTE[2], { step: 2, padding: 8 })) a.routeGoal = 'west';
            else {
              a.blocked = true;
              a.planWait = 2;
            }
          } else if (a.routeGoal === 'west') {
            a.home = chooseHome(a);
            if (a.home && plan(a, a.home, { step: 1, padding: 8 })) a.routeGoal = 'home';
            else {
              a.blocked = true;
              a.planWait = 2;
            }
          } else if (a.routeGoal === 'home') {
            a.mode = 'home';
            a.chargeRun = 0;
            a.velocity = 0;
            emit('animal-stop', a);
            api.returnHome(a);
          }
        }
        if (a.blocked) {
          a.replanIn = (a.replanIn ?? 0) - timerDt;
          if (a.replanIn <= 0 && a.route.length) {
            a.replanIn = 2;
            plan(a, a.route.at(-1), { step: 2, padding: 12 });
          }
        }
        if (a.outside && a.mode === 'escaping' && a.id !== 'reference-wolf') {
          a.cryIn -= timerDt;
          if (a.cryIn <= 0) {
            emit('animal-run', a);
            a.cryIn = 6;
          }
        }
      }
    }
    updatePose(a, dt);
  }
  return api;
}
