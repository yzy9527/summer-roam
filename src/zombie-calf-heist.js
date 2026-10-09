import { createHeistCarryPose } from './gameplay/heist/carry-pose.js';
import { createCrewTransitions } from './gameplay/heist/crew-transitions.js';
import { updateDriverParking as tickDriverParking } from './gameplay/heist/driver-parking.js';
import { snapshotData, recordPhase } from './app/snapshot-data.js';
import * as THREE from 'three';
import { CORRAL } from './corral-model.js';
import {
  CREW_CART,
  CREW_DOCK,
  CREW_PARKING_APPROACH,
  CREW_PARKING_ALIGN,
} from './zombie-crew-cart.js';
import { createCalfTransportPose, restoreCalf } from './calf-transport-pose.js';
import { createAnimalAnimation } from './animal-animation.js';
import { ANIMAL_PROFILES } from './animal-profiles.js';
import { drivingHeight } from './world-queries.js';
import { dryAnimalPoint, findAnimalPath, animalPathSearch } from './corral-navigation.js';
import { vehicleObstacleGap } from './vehicle-collision.js';
import { createTaskClearance, separatesCircle } from './task-clearance.js';
import { LOOKOUT_NOTICE_SECONDS } from './zombie-lookout.js';
import { advanceCartPose } from './crew-cart-navigation.js';

import {
  CALF_RENDEZVOUS,
  CALF_CARRY_MODES,
  CALF_TASK_SPEED,
  CALF_THROW,
  GUARD_PAT,
  CALF_HEIST_TRIGGER,
} from './gameplay/heist/config.js';
export {
  CALF_RENDEZVOUS,
  CALF_CARRY_MODES,
  CALF_TASK_SPEED,
  CALF_THROW,
  GUARD_PAT,
  CALF_HEIST_TRIGGER,
} from './gameplay/heist/config.js';

const GIANT = 'pvz-gargantuar',
  DRIVER = 'pvz-conehead';
const smooth = (t) => t * t * t * (10 + t * (-15 + 6 * t));
const turn = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function createZombieCalfHeist(
  scene,
  colliders,
  cart,
  zombies,
  fieldAnimals,
  corral,
  { ground = drivingHeight, carryMode = 'underarm', lookout = null } = {},
) {
  if (!CALF_CARRY_MODES[carryMode]) throw new Error('Unknown calf carry mode');
  const frame = () => CALF_CARRY_MODES[carryMode];
  const throwSideOffset = () =>
    Math.max(4.25, CREW_CART.halfWidth + Math.hypot(frame().x, frame().z) + 1.07);
  let sound = () => false,
    signalSound = () => false,
    signalSpeaking = false,
    signalEvent = null,
    signalGeneration = 0,
    liftFeedback = false,
    liftEvents = 0;
  const giant = zombies.actor(GIANT),
    driver = zombies.actor(DRIVER);
  // The pole is its own skin. Leave it at home rather than swinging it through
  // the calf or vehicle; the imported editable GLB is never altered.
  giant.source.traverse((n) => {
    if (n.isMesh && n.material?.name?.includes('ELECTRIC_POLE')) n.visible = false;
  });
  const pole = giant.source.getObjectByName('Object_434');
  if (pole) pole.visible = false;
  giant.collider.radius = 1.05;
  let phase = 'waiting',
    time = 0,
    elapsed = 0,
    goal = null,
    calf = null,
    pose = null;
  const home = { x: cart.root.position.x, z: cart.root.position.z, heading: cart.root.rotation.y };
  let outbound = [],
    returning = [],
    isolatedFor = 0,
    cooldown = 0,
    abortReason = '',
    aborting = false,
    abortRequested = false,
    parking = null,
    parkingRetry = 0,
    releasedCalf = null;
  let pickup = null,
    releaseTarget = null,
    carry = false,
    phaseHistory = ['waiting'];
  const walkStates = new Map();
  // Both boarding actors share this display-frame budget. A per-actor slice
  // leaves time for the other crew member even when the first route is complex.
  let boardingSearchMs = 0,
    boardingSearchSlices = 0;
  const { transitions, transitionPose, updateTransition } = createCrewTransitions({
    scene,
    zombies,
    ground,
  });
  let boardingCrew = [],
    lastWalker = null,
    transferStart = null,
    transferHeading = null;
  let throwStart = null,
    throwHands = null,
    throwDestination = 'cart';
  let driverParking = null,
    herdTurn = null,
    giantReleased = false,
    guard = null,
    patContact = false,
    patEvents = 0,
    patGap = null;
  const local = (x, y, z) =>
    giant.object.localToWorld(new THREE.Vector3(x / 0.7, y / 0.7, z / 0.7));
  const carryController = createHeistCarryPose({
    giant,
    getCalf: () => calf,
    getPose: () => pose,
    getMode: () => carryMode,
  });
  const { syncCalf, throwPose, hold, updatePose, carryPose, heldHeading, heldPosition } =
    carryController;
  const ignoreOwn = (c) => c === giant.collider || c === calf?.collider;
  const clearance = createTaskClearance(colliders, zombies, fieldAnimals, {
    exclude: [GIANT, DRIVER, 'hornless-calf'],
  });
  function clearWalkPath(actor, target, radius = actor.collider.radius) {
    const from = actor.object.position;
    const dx = target.x - from.x,
      dz = target.z - from.z;
    const length = Math.hypot(dx, dz),
      fraction = Math.min(1, 4 / Math.max(length, 1e-9));
    clearance.request(
      from,
      { x: from.x + dx * fraction, z: from.z + dz * fraction },
      radius,
      player,
      actor.layout.id + '-walk',
    );
    // A blocked destination (seat entrance or pickup pose) also needs room.
    if (length > 4) clearance.request(target, target, radius, player, actor.layout.id + '-goal');
  }
  function clearCartPath() {
    const vehicle = cart.snapshot(),
      direction = vehicle.gear ?? 1;
    // The yield controller adds 0.35m activation / 0.5m destination margins.
    // The wider rubber-tyre footprint needs only a small extra request margin;
    // duplicating a large buffer needlessly pushes nearby parents toward the calf.
    clearance.request(
      cart.world(0, 0, -CREW_CART.halfLength),
      cart.world(0, 0, CREW_CART.halfLength),
      CREW_CART.halfWidth + 0.05,
      player,
      'cart-body',
    );
    clearance.request(
      cart.world(0, 0, direction * CREW_CART.halfLength),
      cart.world(0, 0, direction * (CREW_CART.halfLength + 3)),
      CREW_CART.halfWidth + 0.05,
      player,
      'cart-ahead',
    );
  }
  function setPhase(next) {
    phase = next;
    time = 0;
    for (const actor of walkStates.keys())
      if ((next !== 'pat-guard' || actor !== giant) && (!driverParking || actor !== driver))
        walkStates.delete(actor);
    lastWalker = null;
    goal = null;
    recordPhase(phaseHistory, next);
    liftFeedback = false;
  }
  function separation() {
    const target = fieldAnimals.animal('hornless-calf'),
      mother = fieldAnimals.animal('golden-cow'),
      bull = fieldAnimals.animal('copper-cow');
    if (!target || !mother || !bull) return null;
    return {
      mother: Math.hypot(target.x - mother.x, target.z - mother.z),
      bull: Math.hypot(target.x - bull.x, target.z - bull.z),
    };
  }
  const isolated = (s) =>
    s && s.mother > CALF_HEIST_TRIGGER.distance && s.bull > CALF_HEIST_TRIGGER.distance;
  const available = () => fieldAnimals.transportAvailable('hornless-calf');
  // Free patrol may be temporarily owned by the calf rescue controller.
  let rescueCrewAvailable = () => true;
  const crewFree = () => rescueCrewAvailable();
  function notifyLookout() {
    if (!lookout) {
      depart();
      return true;
    }
    if (!lookout.ring('notice')) return false;
    isolatedFor = 0;
    setPhase('lookout-notice');
    return true;
  }
  function depart() {
    driverParking = null;
    herdTurn = null;
    giantReleased = false;
    guard = null;
    throwDestination = 'cart';
    patContact = false;
    zombies.take(GIANT);
    zombies.take(DRIVER);
    isolatedFor = 0;
    abortReason = '';
    aborting = abortRequested = false;
    parking = null;
    parkingRetry = 0;
    outbound = [
      { x: 160, z: home.z, heading: home.heading },
      { x: 146, z: -27, heading: -Math.PI / 2 },
      { ...CALF_RENDEZVOUS },
    ];
    returning = [
      { x: 148, z: -27, heading: Math.PI / 2 },
      { x: 158, z: 3, heading: 0 },
      { x: 169, z: 3, heading: Math.PI },
      { x: CREW_DOCK.x, z: -8, heading: Math.PI },
      { ...CREW_DOCK, reverse: true },
    ];
    setPhase('crew-boarding');
    boardingCrew = [
      { actor: driver, stage: 'approach', edgeX: -2.9, stepX: -0.8, z: CREW_CART.driverEntryZ },
      { actor: giant, stage: 'approach', edgeX: -3.15, stepX: -0.9, z: -0.65 },
    ];
    cart.stop();
    cart.boards.visible = true;
  }
  function releaseCalf() {
    if (!calf) return;
    releasedCalf = calf;
    restoreCalf(calf);
    calf.rig = createAnimalAnimation(calf.source, calf.group, ANIMAL_PROFILES[calf.id]);
    fieldAnimals.releaseTransport(calf.id);
    calf = pose = pickup = null;
  }
  function requestAbort(reason) {
    if (abortRequested || aborting) return;
    abortRequested = true;
    abortReason = reason;
    isolatedFor = 0;
    cart.stop();
    if (herdTurn?.goal) {
      herdTurn.route.unshift(herdTurn.goal);
      herdTurn.goal = null;
    }
    releaseCalf();
  }
  function beginAbort() {
    // Finish boarding/dismounting transitions before moving the empty cart.
    if (['crew-boarding', 'herd-dismount'].includes(phase)) return;
    abortRequested = false;
    aborting = true;
    if (giant.seated) {
      cart.setGateOpen(false);
      setPhase('abort-close-cart');
    } else {
      cart.boards.visible = !herdTurn || herdTurn.stage === 'ready';
      transitionPose(giant, () => zombies.rebind(GIANT));
      setPhase('return-to-seat');
    }
  }
  function herdDeparture() {
    const x = cart.root.position.x;
    return [
      { x, z: -16, heading: 0, reverse: true },
      { x: x + (x < -28 ? 11 : -11), z: -16, heading: Math.PI },
      { x: -26, z: -27, heading: Math.PI / 2 },
      { x: 148, z: -27, heading: Math.PI / 2 },
    ];
  }
  function returnToBay() {
    return [
      // Turn around below the patrol area before reversing up to the bay.
      { ...CREW_PARKING_APPROACH, z: CREW_PARKING_APPROACH.z - 7.5 },
      { ...CREW_PARKING_APPROACH, reverse: true },
      { ...CREW_PARKING_ALIGN },
      { ...home, reverse: true },
    ];
  }
  function startDriverParking() {
    if (driverParking) return;
    cart.setGateOpen(false);
    driverParking = { stage: 'closing-tailgate', route: returnToBay(), goal: null, retry: 0 };
  }
  function updateDriverParking(dt) {
    tickDriverParking(driverParking, dt, {
      cart,
      zombies,
      driver,
      player,
      clearCartPath,
      transitionPose,
      walk,
      walkStates,
    });
  }
  function returnEmpty() {
    const { x, z } = cart.root.position,
      heading = cart.root.rotation.y;
    // An early cancellation can stop on the southward departure arc, where
    // an immediate loop back to the bay crosses the road. Continue straight
    // into the same lower turnaround area before planning the return arcs.
    const clearDeparture =
      x > 0 && z < -1 && z > -12 && Math.cos(heading) < -0.5
        ? [{ x: x + Math.sin(heading) * 10, z: z + Math.cos(heading) * 10, heading }]
        : [];
    returning = [
      ...(herdTurn?.stage === 'ready'
        ? [{ x: 148, z: CALF_RENDEZVOUS.z, heading: Math.PI / 2 }]
        : x < 0
          ? herdDeparture()
          : clearDeparture),
      ...returnToBay(),
    ];
    setPhase('abort-returning');
  }
  function startHerdTurn() {
    // Three 60-degree arcs turn the vehicle within the outer approach area,
    // then restore the arrival line with its nose pointing toward camp.
    let at = { ...CALF_RENDEZVOUS };
    const route = [1, -1, 1].map((gear) => {
      at = advanceCartPose(
        at,
        (gear * CREW_CART.turnRadius * Math.PI) / 3,
        -gear / CREW_CART.turnRadius,
      );
      return { ...at, reverse: gear < 0 };
    });
    herdTurn = { stage: 'clearing', route, goal: null, retry: 0 };
    cart.boards.visible = false;
    cart.setGateOpen(false);
  }
  function updateHerdTurn(dt) {
    const task = herdTurn;
    if (!task || task.stage === 'ready') return;
    task.retry = Math.max(0, task.retry - dt);
    // Keep all boarding and loading operations outside the moving car's sweep.
    if (task.stage === 'clearing') {
      if (
        Math.hypot(
          giant.object.position.x - CALF_RENDEZVOUS.x,
          giant.object.position.z - CALF_RENDEZVOUS.z,
        ) < 13 ||
        !cart.snapshot().cargoEnclosed
      )
        return;
      task.stage = 'turning';
    }
    clearCartPath();
    if (task.goal && cart.snapshot().blocked && task.retry === 0) {
      task.route.unshift(task.goal);
      task.goal = null;
      cart.stop();
      task.retry = 1;
    }
    if (!task.goal && task.route.length && task.retry === 0) {
      const stop = task.route[0];
      if (cart.routeTo(stop, player, { speed: CREW_CART.positioningSpeed, reverse: stop.reverse }))
        task.goal = task.route.shift();
      task.retry = 1;
    }
    if (task.goal && cart.arrived()) task.goal = null;
    if (!task.goal && !task.route.length && cart.arrived()) {
      task.stage = 'ready';
      parking = { x: cart.root.position.x, z: cart.root.position.z, heading: cart.root.rotation.y };
    }
  }
  function calfBoundsClear(at, heading, ignoreCart = false) {
    // Carrying clearance includes the full suspended calf, not just the feet.
    const f = frame();
    const center = {
      x: at.x + Math.cos(heading) * f.x + Math.sin(heading) * f.z,
      z: at.z - Math.sin(heading) * f.x + Math.cos(heading) * f.z,
    };
    if (!ignoreCart) {
      const sweeping = phase === 'carry-to-cart',
        p = cart.root.worldToLocal(
          new THREE.Vector3(
            sweeping ? at.x : center.x,
            cart.root.position.y,
            sweeping ? at.z : center.z,
          ),
        ),
        clearance = sweeping ? Math.hypot(f.x, f.z) + 0.97 : 0.97;
      if (
        Math.hypot(
          Math.max(0, Math.abs(p.x) - CREW_CART.halfWidth),
          Math.max(0, Math.abs(p.z) - CREW_CART.halfLength),
        ) < clearance
      )
        return false;
    }
    return dryAnimalPoint(
      center.x,
      center.z,
      0.85,
      colliders,
      player,
      (c) => ignoreOwn(c) || c.woodenCart,
    );
  }
  function searchBoardingRoute(actor, target, navigation, ignore) {
    if (
      navigation.search &&
      Math.hypot(
        actor.object.position.x - navigation.searchStart.x,
        actor.object.position.z - navigation.searchStart.z,
      ) > 0.1
    )
      navigation.search = null;
    if (!navigation.search) {
      const start = { x: actor.object.position.x, z: actor.object.position.z },
        vehicle = player && { ...player },
        radius = actor.collider.radius,
        margin = actor.scripted ? 0.12 : 0.25,
        obstacles = colliders.filter((c) => !ignore(c)).map((c) => ({ ...c }));
      // Cached search cells must describe one obstacle snapshot across frames.
      // canStand supplies the existing terrain rules; movement below still
      // checks the live colliders and player vehicle before every actual step.
      const allowed = (x, z) =>
        zombies.canStand(actor.layout.id, { x, z }, null, { ignore: () => true }) &&
        (!vehicle ||
          vehicleObstacleGap(vehicle.x, vehicle.z, vehicle.heading ?? 0, { x, z, radius }) > 0.4) &&
        !obstacles.some(
          (c) =>
            !((c.zombie || c.animal) && separatesCircle(start, { x, z }, radius, c, margin)) &&
            Math.hypot(x - c.x, z - c.z) < radius + c.radius + margin,
        );
      navigation.search = animalPathSearch(start, { x: target.x, z: target.z }, allowed, {
        step: 0.35,
        padding: 9,
      });
      navigation.searchStart = start;
    }
    const started = performance.now(),
      deadline = started + Math.max(0, Math.min(1, 2 - boardingSearchMs));
    let actorSlices = 0;
    while (actorSlices < 256 && boardingSearchSlices < 512 && performance.now() < deadline) {
      actorSlices++;
      boardingSearchSlices++;
      const result = navigation.search.next();
      if (result.done) {
        navigation.route = result.value ?? [];
        navigation.search = null;
        navigation.retry = 1;
        break;
      }
    }
    boardingSearchMs += performance.now() - started;
  }
  function walk(
    actor,
    target,
    dt,
    { boarding = false, carried = false, facingHeading, maxSpeed = Infinity } = {},
  ) {
    let navigation = walkStates.get(actor);
    if (!navigation) {
      navigation = { route: [], goal: null, retry: 0 };
      walkStates.set(actor, navigation);
    }
    lastWalker = actor;
    clearWalkPath(actor, target, carried ? actor.collider.radius + 1.2 : actor.collider.radius);
    if (
      !navigation.goal ||
      Math.hypot(target.x - navigation.goal.x, target.z - navigation.goal.z) > 0.1
    ) {
      navigation.route = [];
      navigation.search = null;
      navigation.goal = { x: target.x, z: target.z };
    }
    const ignore = (c) =>
      c === actor.collider ||
      c === calf?.collider ||
      c === releasedCalf?.collider ||
      (boarding && c.woodenCart);
    const separating = (x, z) => {
      if (!releasedCalf) return true;
      const current = Math.hypot(
          actor.object.position.x - releasedCalf.x,
          actor.object.position.z - releasedCalf.z,
        ),
        next = Math.hypot(x - releasedCalf.x, z - releasedCalf.z),
        margin = actor.collider.radius + releasedCalf.radius + 0.22;
      return next >= margin || (current < margin && next >= current - 1e-6);
    };
    const routeHeading =
      facingHeading ??
      Math.atan2(target.x - actor.object.position.x, target.z - actor.object.position.z);
    const allowed = (x, z) =>
      zombies.canStand(actor.layout.id, { x, z }, player, { ignore }) &&
      separating(x, z) &&
      (!carried || calfBoundsClear({ x, z }, routeHeading, boarding)) &&
      // Around the herd reserve the whole turning sweep of the held calf.
      // Ramp and corral passages use the sampled body/facing clearance instead.
      (!carried ||
        phase !== 'carry-to-cart' ||
        boarding ||
        facingHeading !== undefined ||
        dryAnimalPoint(
          x,
          z,
          Math.hypot(frame().x, frame().z) + 0.85,
          colliders,
          player,
          (c) => ignore(c) || c.woodenCart || c.corral,
        )) &&
      !colliders.some(
        (c) =>
          !ignore(c) &&
          !(
            (c.zombie || c.animal) &&
            separatesCircle(actor.object.position, { x, z }, actor.collider.radius, c)
          ) &&
          Math.hypot(x - c.x, z - c.z) < actor.collider.radius + c.radius + 0.12,
      );
    navigation.retry = Math.max(0, navigation.retry - dt);
    const d = Math.hypot(actor.object.position.x - target.x, actor.object.position.z - target.z);
    if (d < 0.035) return true;
    if (!navigation.route.length && navigation.retry === 0) {
      if (phase === 'crew-boarding') searchBoardingRoute(actor, target, navigation, ignore);
      else {
        navigation.route =
          findAnimalPath(actor.object.position, target, allowed, {
            step: 0.35,
            padding: carried && phase === 'carry-to-cart' ? 16 : 9,
          }) ?? [];
        navigation.retry = 1;
      }
    }
    if (!navigation.route.length) return false;
    const p = actor.object.position,
      next = navigation.route[0],
      heading = facingHeading ?? Math.atan2(next.x - p.x, next.z - p.z),
      moveHeading = Math.atan2(next.x - p.x, next.z - p.z);
    const running =
      actor === giant && !boarding && ['seek-calf', 'manual-approach'].includes(phase);
    const speed = Math.min(
      maxSpeed,
      d * 2 + 0.2,
      boarding
        ? CALF_TASK_SPEED.steps
        : carried
          ? CALF_TASK_SPEED.carry
          : running
            ? CALF_TASK_SPEED.run
            : CALF_TASK_SPEED.walk,
    );
    if (carried) {
      const error = turn(heading, actor.object.rotation.y);
      const yaw = THREE.MathUtils.clamp(error, -dt * 1.8, dt * 1.8);
      const distance = Math.hypot(next.x - p.x, next.z - p.z);
      const step =
        Math.abs(error - yaw) < 0.12
          ? Math.min(distance, speed * dt * Math.max(0, Math.cos(error)))
          : 0;
      const at = { x: p.x + Math.sin(moveHeading) * step, z: p.z + Math.cos(moveHeading) * step };
      if (
        ![0, 0.5, 1].every((t) =>
          calfBoundsClear(
            { x: p.x + (at.x - p.x) * t, z: p.z + (at.z - p.z) * t },
            actor.object.rotation.y + yaw * t,
            boarding,
          ),
        )
      ) {
        if (navigation.retry === 0) navigation.route = [];
        return false;
      }
    }
    const support = boarding
      ? (x, z) => {
          const p = cart.root.worldToLocal(new THREE.Vector3(x, cart.root.position.y, z));
          return (
            ground(x, z) +
            (boarding === 'rear'
              ? THREE.MathUtils.clamp((p.z + 6.55) / 3.15, 0, 1)
              : THREE.MathUtils.clamp((p.x + 3.05) / 1.7, 0, 1)) *
              0.551
          );
        }
      : ground;
    if (
      zombies.walk(actor.layout.id, next, dt, {
        speed,
        run: running,
        alignBeforeMove: true,
        facingHeading,
        car: player,
        ground: support,
        ignore: (c) =>
          c === calf?.collider ||
          (c === releasedCalf?.collider &&
            separating(actor.object.position.x, actor.object.position.z)) ||
          (boarding && c.woodenCart),
      })
    )
      navigation.route.shift();
    if (actor.blocked && navigation.retry === 0) navigation.route = [];
    return (
      Math.hypot(actor.object.position.x - target.x, actor.object.position.z - target.z) < 0.035
    );
  }
  const throwSpot = () => cart.world(-throwSideOffset(), 0, CREW_CART.calfZ);
  const throwHeading = () => cart.root.rotation.y + Math.PI / 2;
  const corralEntry = () => ({
    x: CORRAL.x + (carryMode === 'underarm' ? 0.54 : 0),
    z: CORRAL.z - CORRAL.halfZ + 0.65,
  });
  function throwTarget() {
    if (throwDestination === 'cart') return worldCalfTarget();
    const x = CORRAL.x,
      z = CORRAL.z + 0.65;
    return { position: new THREE.Vector3(x, ground(x, z) + 0.025, z), heading: 0 };
  }
  function throwClear() {
    if (throwDestination === 'cart' && Math.abs(cart.snapshot().speed) > 0.02) return false;
    if (throwDestination === 'corral' && corral.snapshot().gateAmount < 0.99) return false;
    const start = local(
        frame().x,
        frame().height + (carryMode === 'underarm' ? 0.5 : 0.06),
        frame().z + (carryMode === 'underarm' ? 0.55 : 0.08),
      ),
      target = throwTarget().position;
    for (let i = 0; i <= 24; i++) {
      const t = i / 24,
        p = start.clone().lerp(target, t);
      if (
        colliders.some(
          (c) =>
            !ignoreOwn(c) &&
            !(throwDestination === 'cart' && c.woodenCart) &&
            Math.hypot(p.x - c.x, p.z - c.z) < 0.85 + c.radius + 0.12,
        )
      )
        return false;
    }
    return true;
  }
  const rearBottom = () => cart.world(carryMode === 'underarm' ? -0.08 : 0, 0, -6.65);
  const rearTop = () =>
    cart.world(
      carryMode === 'underarm' ? -0.08 : 0,
      0.551,
      carryMode === 'underarm' ? CREW_CART.calfZ + frame().x : -3.55,
    );
  const rampHeading = () => cart.root.rotation.y;
  function rearGround(x, z) {
    const at = cart.root.worldToLocal(new THREE.Vector3(x, cart.root.position.y, z));
    return ground(x, z) + THREE.MathUtils.clamp((at.z + 6.55) / 3.15, 0, 1) * 0.551;
  }
  function liftReaction() {
    if (liftFeedback || time < 0.3) return;
    liftFeedback = true;
    liftEvents++;
    pose.startStruggle();
    const liftedPose = pose;
    sound(
      {
        type: 'calf-lift',
        id: calf.id,
        instanceId: 'transported-' + calf.id,
        x: calf.x,
        z: calf.z,
      },
      (event) => liftedPose.setCalling(event === 'playing'),
    );
  }
  function faceCarrying(
    heading,
    dt,
    ignoreCart = false,
    support = ignoreCart ? rearGround : ground,
  ) {
    const at = giant.object.position,
      yaw = THREE.MathUtils.clamp(turn(heading, giant.object.rotation.y), -dt * 1.8, dt * 1.8);
    if (
      ![0, 0.5, 1].every((t) => calfBoundsClear(at, giant.object.rotation.y + yaw * t, ignoreCart))
    )
      return false;
    return zombies.face(
      GIANT,
      { x: at.x + Math.sin(heading), z: at.z + Math.cos(heading) },
      dt,
      player,
      {
        ignore: (c) => ignoreOwn(c) || (ignoreCart && c.woodenCart),
        ground: support,
      },
    );
  }
  function worldCalfTarget() {
    const p = cart.world(0, 0.551, CREW_CART.calfZ);
    return { position: p, heading: cart.root.rotation.y + Math.PI / 2 };
  }
  function startDismount(next) {
    cart.boards.visible = true;
    const standing = cart.world(-0.9, 0.551, -0.65);
    transitionPose(giant, () => cart.releaseGiant({ x: standing.x, y: standing.y, z: standing.z }));
    setPhase(next);
  }
  let player = null;
  let preview = false;
  let manualTask = null,
    manualStops = [],
    manualCancel = false,
    manualAge = 0;
  function manualAvailability(target = fieldAnimals.animal('hornless-calf')) {
    if (!target || target !== fieldAnimals.animal('hornless-calf')) return '只能操作当前小牛';
    if (!['waiting', 'complete'].includes(phase) || !crewFree() || giant.seated)
      return '大僵尸正在执行其他任务';
    if (cooldown > 0) return '抓牛任务冷却中';
    if (!available()) return '小牛正在休息或参与其他互动';
    return lookout?.ringAvailability() ?? '';
  }
  function beginManualLower() {
    const target = heldPosition(0.025);
    target.y = ground(target.x, target.z) + 0.025;
    if (!dryAnimalPoint(target.x, target.z, calf.radius, colliders, player, ignoreOwn))
      return false;
    releaseTarget = target;
    transferStart = calf.group.position.clone();
    setPhase('manual-lower');
    return true;
  }
  function leaveManual() {
    releaseCalf();
    manualStops = [];
    setPhase('manual-leave');
  }
  function previewCarry() {
    if (!['waiting', 'preview-ready', 'preview-hold'].includes(phase)) return false;
    preview = true;
    zombies.take(GIANT);
    zombies.take(DRIVER);
    setPhase('preview-ready');
    return true;
  }
  function previewThrow() {
    if (!['waiting', 'preview-hold', 'preview-loaded'].includes(phase) || !crewFree()) return false;
    calf ??= fieldAnimals.reserveTransport('hornless-calf');
    if (!calf) return false;
    preview = true;
    throwDestination = 'cart';
    cart.stop();
    cart.cargo = null;
    cart.setGateOpen(false);
    zombies.take(GIANT);
    scene.attach(calf.group);
    const index = colliders.indexOf(calf.collider);
    if (index >= 0) colliders.splice(index, 1);
    const at = throwSpot();
    giant.object.position.set(at.x, ground(at.x, at.z), at.z);
    giant.object.rotation.set(0, throwHeading(), 0, 'YXZ');
    Object.assign(giant.collider, { x: at.x, z: at.z });
    zombies.rebind(GIANT);
    restoreCalf(calf);
    pose = createCalfTransportPose(calf);
    carry = true;
    carryPose(0.01);
    setPhase('throw-windup');
    return true;
  }
  function previewDelivery() {
    if (!['waiting', 'preview-loaded'].includes(phase) || !crewFree()) return false;
    calf ??= fieldAnimals.reserveTransport('hornless-calf');
    if (!calf) return false;
    preview = false;
    driverParking = null;
    giantReleased = false;
    guard = null;
    patContact = false;
    cart.stop();
    cart.root.position.set(CREW_DOCK.x, ground(CREW_DOCK.x, CREW_DOCK.z), CREW_DOCK.z);
    cart.root.rotation.set(0, CREW_DOCK.heading, 0, 'YXZ');
    cart.root.updateMatrixWorld(true);
    scene.attach(calf.group);
    restoreCalf(calf);
    const target = worldCalfTarget();
    calf.group.position.copy(target.position);
    calf.group.rotation.set(0, target.heading, 0, 'YXZ');
    cart.root.attach(calf.group);
    cart.cargo = calf;
    carry = false;
    pose = createCalfTransportPose(calf);
    const index = colliders.indexOf(calf.collider);
    if (index >= 0) colliders.splice(index, 1);
    zombies.take(GIANT);
    zombies.take(DRIVER);
    cart.mountDriver();
    cart.mountGiant();
    cart.setGateOpen(true);
    corral.prepareGate(true);
    setPhase('opening-at-corral');
    syncCalf();
    return true;
  }
  const api = {
    previewCarry,
    previewThrow,
    previewDelivery,
    manualAvailability,
    alarmAvailability() {
      if (!lookout) return '瞭望员尚未就绪';
      if (!['waiting', 'complete'].includes(phase) || !crewFree()) return '抓牛任务进行中';
      return manualAvailability();
    },
    alertManual() {
      if (this.alarmAvailability()) return false;
      return this.startManual();
    },
    startManual(target = fieldAnimals.animal('hornless-calf')) {
      if (manualAvailability(target)) return false;
      preview = false;
      manualTask = 'capture';
      manualCancel = false;
      calf = pose = pickup = null;
      return notifyLookout();
    },
    holdManual(target = fieldAnimals.animal('hornless-calf')) {
      if (manualAvailability(target)) return false;
      calf = fieldAnimals.reserveTransport(target.id);
      if (!calf) return false;
      preview = false;
      manualTask = 'hold';
      manualAge = 0;
      manualCancel = false;
      pose = pickup = null;
      aborting = abortRequested = false;
      releasedCalf = null;
      zombies.take(GIANT);
      zombies.rebind(GIANT);
      const at = giant.object.position;
      manualStops =
        at.x > 120 && calf.x < 0
          ? [
              { x: 164, z: -27 },
              { x: -37, z: -27 },
            ]
          : at.x < 0 && calf.x > 120
            ? [
                { x: -37, z: -27 },
                { x: 164, z: -27 },
              ]
            : [];
      setPhase('manual-approach');
      return true;
    },
    putDownManual() {
      if (manualTask !== 'hold' || phase !== 'manual-hold') return false;
      return beginManualLower();
    },
    cancelManual() {
      if (!manualTask || manualCancel || aborting || abortRequested) return false;
      if (manualTask === 'capture') {
        if (carry || cart.cargo || driverParking || phase === 'calf-in-flight') return false;
        if (phase === 'lookout-notice') {
          lookout?.cancelNotice();
          manualTask = null;
          setPhase('waiting');
        } else requestAbort('manual-cancel');
      } else manualCancel = true;
      return true;
    },
    connectRescueCrewAvailability(check) {
      rescueCrewAvailable = check;
    },
    connectAudio(listener) {
      sound = listener;
    },
    connectGateSignalAudio(listener) {
      signalSound = listener;
    },
    connectLookoutAudio(listener) {
      lookout?.connectAudio(listener);
    },
    setCarryMode(mode) {
      if (phase !== 'waiting' || !crewFree() || !CALF_CARRY_MODES[mode]) return false;
      carryMode = mode;
      return true;
    },
    rearm() {
      if (phase !== 'complete' || fieldAnimals.animal('hornless-calf')?.transportOwner)
        return false;
      calf = pose = pickup = null;
      isolatedFor = 0;
      cooldown = CALF_HEIST_TRIGGER.cooldown;
      setPhase('waiting');
      return true;
    },
    start() {
      if (
        phase !== 'waiting' ||
        cooldown > 0 ||
        !crewFree() ||
        !available() ||
        !isolated(separation()) ||
        isolatedFor < CALF_HEIST_TRIGGER.duration
      )
        return false;
      manualTask = null;
      return notifyLookout();
    },
    update(dt, car) {
      player = car;
      if (!(dt > 0)) {
        lookout?.silence();
        signalSound({ type: 'gate-signal-stop' });
        return;
      }
      dt = Math.min(dt, 0.1);
      boardingSearchMs = boardingSearchSlices = 0;
      time += dt;
      elapsed += dt;
      if (signalEvent) {
        signalEvent.x = giant.object.position.x;
        signalEvent.z = giant.object.position.z;
      }
      if (signalSpeaking && giantReleased && !giant.scripted)
        giant.rig.speak(0.4 + 0.6 * Math.sin(elapsed * 14) ** 2, dt);
      clearance.update(dt, player);
      cooldown = Math.max(0, cooldown - dt);
      parkingRetry = Math.max(0, parkingRetry - dt);
      if (
        releasedCalf &&
        Math.hypot(
          giant.object.position.x - releasedCalf.x,
          giant.object.position.z - releasedCalf.z,
        ) >=
          giant.collider.radius + releasedCalf.radius + 0.22
      )
        releasedCalf = null;
      const s = separation();
      if (
        phase === 'lookout-notice' &&
        ((!manualTask && !isolated(s)) || !available() || !crewFree())
      ) {
        lookout?.cancelNotice();
        setPhase('waiting');
        manualTask = null;
        isolatedFor = 0;
      }
      lookout?.update(dt, {
        noticing: phase === 'lookout-notice',
        time,
        target: fieldAnimals.animal('hornless-calf'),
        camp: home,
      });

      if (manualTask === 'hold') {
        manualAge += dt;
        if (manualAge > 600 && !carry) manualCancel = true;
        if (
          manualCancel &&
          ['manual-approach', 'seek-calf', 'face-calf', 'crouch-and-grip'].includes(phase)
        )
          leaveManual();
        if (phase === 'manual-approach') {
          if (!manualStops.length) setPhase('seek-calf');
          else if (walk(giant, manualStops[0], dt)) manualStops.shift();
          return;
        }
        if (phase === 'manual-hold') {
          carryPose(dt);
          if (manualCancel) beginManualLower();
          return;
        }
        if (phase === 'manual-lower') {
          // Do not release over a vehicle/animal that moved underneath the calf.
          if (
            !dryAnimalPoint(
              releaseTarget.x,
              releaseTarget.z,
              calf.radius,
              colliders,
              player,
              ignoreOwn,
            )
          ) {
            time = Math.max(0, time - dt);
            hold(dt, frame().squat * smooth(Math.min(1, time / 1.9)));
            return;
          }
          const t = smooth(Math.min(1, time / 1.9));
          calf.group.position.copy(transferStart).lerp(releaseTarget, t);
          updatePose(dt, true, 1 - t);
          hold(dt, frame().squat * t);
          syncCalf();
          if (t === 1) {
            restoreCalf(calf);
            carry = false;
            if (!colliders.includes(calf.collider)) colliders.push(calf.collider);
            setPhase('manual-release');
          }
          return;
        }
        if (phase === 'manual-release') {
          const t = smooth(Math.min(1, time / 1.2));
          hold(dt, frame().squat * (1 - t), 1 - t);
          if (t === 1) leaveManual();
          return;
        }
        if (phase === 'manual-leave') {
          if (!manualStops.length) {
            const p = giant.object.position;
            const away = releasedCalf
              ? Math.atan2(p.x - releasedCalf.x, p.z - releasedCalf.z)
              : giant.object.rotation.y;
            for (const offset of [0, 0.6, -0.6, 1.2, -1.2, Math.PI]) {
              const target = {
                x: p.x + Math.sin(away + offset) * 3,
                z: p.z + Math.cos(away + offset) * 3,
              };
              if (zombies.canStand(GIANT, target, player)) {
                manualStops = [target];
                break;
              }
            }
          }
          if (manualStops.length && walk(giant, manualStops[0], dt)) {
            zombies.rebind(GIANT);
            zombies.release(GIANT);
            manualTask = null;
            manualCancel = false;
            cooldown = CALF_HEIST_TRIGGER.cooldown;
            setPhase('waiting');
          }
          return;
        }
      }
      if (phase === 'lookout-notice') {
        if (time < LOOKOUT_NOTICE_SECONDS) return;
        depart();
      }
      const beforePickup = [
        'crew-boarding',
        'outbound',
        'parking-at-herd',
        'herd-dismount',
        'seek-calf',
        'face-calf',
        'crouch-and-grip',
      ].includes(phase);
      if (
        !preview &&
        !manualTask &&
        !aborting &&
        beforePickup &&
        (!s || Math.min(s.mother, s.bull) <= CALF_HEIST_TRIGGER.reunion)
      )
        requestAbort('reunited');
      if (!preview && !aborting && phase === 'outbound' && time > 300)
        requestAbort('outbound-timeout');
      if (
        !preview &&
        manualTask !== 'hold' &&
        !aborting &&
        ['parking-at-herd', 'herd-dismount', 'seek-calf', 'face-calf', 'crouch-and-grip'].includes(
          phase,
        )
      ) {
        if (!manualTask && !isolated(s)) requestAbort('no-longer-isolated');
        else if (!calf && !available()) requestAbort('calf-busy');
        else if (time > 90) requestAbort('pickup-timeout');
      }
      if (transitions.size) {
        for (const tr of transitions.values())
          if (updateTransition(tr, dt)) zombies.rebind?.(tr.actor.layout.id);
        if (phase !== 'crew-boarding' && (!driverParking || giant.transitioning)) return;
      }
      updateDriverParking(dt);
      updateHerdTurn(dt);
      if (abortRequested) beginAbort();
      if (phase === 'preview-ready') {
        calf ??= fieldAnimals.reserveTransport('hornless-calf');
        if (!calf) return;
        restoreCalf(calf);
        scene.attach(calf.group);
        calf.group.position.set(164, ground(164, -11) + 0.025, -11);
        calf.group.rotation.set(0, 0, 0, 'YXZ');
        calf.group.visible = true;
        calf.heading = 0;
        syncCalf();
        const f = frame();
        zombies.restore(GIANT);
        giant.object.position.set(calf.x - f.x, ground(calf.x - f.x, calf.z - f.z), calf.z - f.z);
        giant.object.rotation.set(0, 0, 0, 'YXZ');
        Object.assign(giant.collider, { x: giant.object.position.x, z: giant.object.position.z });
        zombies.rebind(GIANT);
        pose = createCalfTransportPose(calf);
        carry = false;
        setPhase('crouch-and-grip');
      }
      if (phase === 'preview-hold') {
        carryPose(dt);
        return;
      }
      if (phase === 'waiting') {
        isolatedFor =
          cooldown === 0 && crewFree() && available() && isolated(s) ? isolatedFor + dt : 0;
        if (isolatedFor + 1e-9 >= CALF_HEIST_TRIGGER.duration) {
          notifyLookout();
          if (phase === 'lookout-notice' || phase === 'waiting') return;
        } else return;
      }
      if (phase === 'crew-boarding') {
        for (const member of boardingCrew) {
          const { actor } = member;
          if (member.stage === 'approach') {
            if (walk(actor, cart.world(member.edgeX, 0, member.z), dt)) {
              member.stage = 'step';
              walkStates.delete(actor);
            }
          } else if (member.stage === 'step') {
            if (walk(actor, cart.world(member.stepX, 0.551, member.z), dt, { boarding: true })) {
              transitionPose(actor, () =>
                actor === driver ? cart.mountDriver() : cart.mountGiant(),
              );
              member.stage = 'seating';
            }
          } else if (member.stage === 'seating' && !actor.transitioning && actor.seated) {
            member.stage = 'ready';
          }
        }
        if (boardingCrew.every((member) => member.stage === 'ready')) setPhase('outbound');
      } else if (['outbound', 'returning', 'abort-returning', 'driver-returning'].includes(phase)) {
        if (cart.snapshot().blocked || !goal) clearCartPath();
        cart.boards.visible = false;
        const stops = phase === 'outbound' ? outbound : returning;
        if (goal && cart.snapshot().blocked && parkingRetry === 0) {
          stops.unshift(goal);
          goal = null;
          cart.stop();
          parkingRetry = 2;
        }
        if (!goal && stops.length) {
          if (parkingRetry === 0) {
            const stop = stops[0];
            let planned = cart.routeTo(stop, player, { reverse: !!stop.reverse });
            // Cancellation may stop halfway around the departure arc. Try a
            // checked reverse path when a forward loop cannot fit there.
            if (!planned && phase === 'abort-returning')
              planned = cart.routeTo(stop, player, { reverse: !stop.reverse });
            if (planned) goal = stops.shift();
            parkingRetry = 1;
          }
        }
        if (goal && cart.arrived()) goal = null;
        if (!goal && !stops.length && cart.arrived()) {
          if (phase === 'outbound') setPhase('parking-at-herd');
          else if (phase === 'driver-returning') {
            cart.boards.visible = true;
            const at = cart.world(-0.8, 0.551, CREW_CART.driverEntryZ);
            transitionPose(driver, () => cart.releaseDriver({ x: at.x, y: at.y, z: at.z }));
            setPhase('driver-dismount');
          } else if (phase === 'abort-returning') {
            startDismount('abort-giant-dismount');
          } else {
            cart.setGateOpen(true);
            corral.prepareGate(true);
            setPhase('opening-at-corral');
          }
        }
      } else if (phase === 'parking-at-herd') {
        clearCartPath();
        const entry = cart.world(-3.15, 0, -0.65);
        if (
          cart.arrived() &&
          cart.canDrivePose(CALF_RENDEZVOUS, player) &&
          zombies.canStand(GIANT, entry, player, { ignore: (c) => c.woodenCart })
        ) {
          parking = { ...CALF_RENDEZVOUS };
          startDismount('herd-dismount');
        }
      } else if (phase === 'herd-dismount') {
        if (walk(giant, cart.world(-3.15, 0, -0.65), dt, { boarding: true })) {
          startHerdTurn();
          setPhase(abortRequested ? 'return-to-seat' : 'seek-calf');
        }
      } else if (phase === 'seek-calf') {
        calf ??= fieldAnimals.reserveTransport('hornless-calf');
        if (!calf) return;
        calf.group.visible = true;
        if (!pose) {
          pose = createCalfTransportPose(calf);
          const f = frame(),
            heading = calf.heading - f.yaw;
          pickup = {
            x: calf.x - Math.cos(heading) * f.x - Math.sin(heading) * f.z,
            z: calf.z + Math.sin(heading) * f.x - Math.cos(heading) * f.z,
            heading,
          };
        }
        if (walk(giant, pickup, dt)) setPhase('face-calf');
      } else if (phase === 'face-calf') {
        clearWalkPath(giant, pickup);
        if (
          zombies.face(
            GIANT,
            {
              x: giant.object.position.x + Math.sin(pickup.heading),
              z: giant.object.position.z + Math.cos(pickup.heading),
            },
            dt,
            player,
            {
              ignore: (c) => c === calf.collider,
            },
          )
        ) {
          setPhase('crouch-and-grip');
        }
      } else if (phase === 'crouch-and-grip') {
        const t = smooth(Math.min(1, time / 1.5));
        restoreCalf(calf);
        const targets = pose.supports(carryMode);
        const neutral = giant.rig.hands(carryMode);
        giant.rig.hold(
          targets.map((p, i) => neutral[i].lerp(p, t)),
          frame().squat * t,
          dt,
          1,
          carryMode,
          t,
        );
        carryController.measureHands(targets);
        if (t === 1 && carryController.handGaps.every((d) => d < 0.09)) {
          const i = colliders.indexOf(calf.collider);
          if (i >= 0) colliders.splice(i, 1);
          carry = true;
          transferStart = calf.group.position.clone();
          transferHeading = calf.group.rotation.y;
          setPhase('lift-calf');
        }
      } else if (phase === 'lift-calf') {
        const t = smooth(Math.min(1, time / 1.9));
        calf.group.position.copy(transferStart).lerp(heldPosition(), t);
        calf.group.rotation.y = transferHeading + turn(heldHeading(), transferHeading) * t;
        liftReaction();
        updatePose(dt, true, t);
        hold(dt, frame().squat * (1 - t));
        syncCalf();
        if (t === 1)
          setPhase(
            preview ? 'preview-hold' : manualTask === 'hold' ? 'manual-hold' : 'carry-to-cart',
          );
      } else if (phase === 'carry-to-cart') {
        if (!herdTurn || herdTurn.stage === 'ready') {
          const p = throwSpot();
          walk(giant, p, dt, { carried: true });
          carryPose(dt);
          if (Math.hypot(giant.object.position.x - p.x, giant.object.position.z - p.z) < 0.035)
            setPhase('face-throw');
        } else {
          // A manually selected calf can be close to the drop-off point.
          // Carry it clear first so waiting for the turn cannot deadlock it.
          if (herdTurn.stage === 'clearing')
            walk(giant, { x: CALF_RENDEZVOUS.x, z: CALF_RENDEZVOUS.z + 15 }, dt, {
              carried: true,
            });
          carryPose(dt);
        }
      } else if (phase === 'face-throw') {
        if (faceCarrying(throwHeading(), dt, true, ground)) setPhase('throw-windup');
        carryPose(dt);
      } else if (['throw-windup', 'corral-throw-windup'].includes(phase)) {
        if (!throwClear()) {
          time -= dt;
          return;
        }
        const t = smooth(Math.min(1, time / CALF_THROW.windup));
        throwPose(dt, t);
        if (t === 1) setPhase(throwDestination === 'cart' ? 'throw-swing' : 'corral-throw-swing');
      } else if (['throw-swing', 'corral-throw-swing'].includes(phase)) {
        const t = smooth(Math.min(1, time / CALF_THROW.swing));
        throwPose(dt, t, true);
        if (t === 1) {
          throwStart = calf.group.position.clone();
          throwHands = pose.supports(carryMode);
          transferHeading = calf.group.rotation.y;
          carry = false;
          setPhase(throwDestination === 'cart' ? 'calf-in-flight' : 'corral-calf-in-flight');
        }
      } else if (['calf-in-flight', 'corral-calf-in-flight'].includes(phase)) {
        const t = Math.min(1, time / CALF_THROW.flight),
          target = throwTarget();
        calf.group.position.copy(throwStart).lerp(target.position, t);
        calf.group.position.y += 4 * CALF_THROW.arc * t * (1 - t);
        calf.group.rotation.set(
          -0.12 * Math.sin(Math.PI * t),
          transferHeading + turn(target.heading, transferHeading) * smooth(t),
          0,
          'YXZ',
        );
        updatePose(dt, true, 1 - smooth(t));
        const follow = 1 - smooth(Math.min(1, time / 0.5));
        giant.rig.hold(throwHands, 0, dt, follow, carryMode, 0, {
          lean: 0.22 * follow,
          palmPitch: -0.5,
        });
        syncCalf();
        if (t === 1) {
          calf.group.rotation.set(0, target.heading, 0, 'YXZ');
          restoreCalf(calf);
          if (throwDestination === 'cart') {
            cart.root.attach(calf.group);
            cart.cargo = calf;
          }
          setPhase(throwDestination === 'cart' ? 'calf-landing' : 'corral-calf-landing');
        }
      } else if (['calf-landing', 'corral-calf-landing'].includes(phase)) {
        updatePose(dt, false);
        pose.land(Math.min(1, time / CALF_THROW.settle));
        if (time >= CALF_THROW.settle) {
          throwStart = throwHands = null;
          if (throwDestination === 'corral') {
            calf.heading = calf.group.rotation.y;
            calf.rig = createAnimalAnimation(calf.source, calf.group, ANIMAL_PROFILES[calf.id]);
            corral.finishDelivery(calf, { awaitSignal: true });
            setPhase('leave-corral');
          } else {
            setPhase(preview ? 'preview-loaded' : 'return-to-seat');
            cart.boards.visible = true;
          }
        }
      } else if (phase === 'return-to-seat') {
        if (herdTurn && herdTurn.stage !== 'ready') {
          walk(giant, { x: CALF_RENDEZVOUS.x, z: CALF_RENDEZVOUS.z + 15 }, dt);
        } else {
          cart.boards.visible = true;
          if (walk(giant, cart.world(-3.15, 0, -0.65), dt)) setPhase('giant-reboarding');
        }
      } else if (phase === 'giant-reboarding') {
        if (walk(giant, cart.world(-0.9, 0.551, -0.65), dt, { boarding: true })) {
          transitionPose(giant, () => cart.mountGiant());
          cart.setGateOpen(false);
          setPhase('close-cart');
        }
      } else if (phase === 'close-cart') {
        if (cart.snapshot().gateAmount < 0.005) {
          if (aborting) returnEmpty();
          else {
            if (!herdTurn) returning.unshift(...herdDeparture().slice(0, 2));
            setPhase('returning');
          }
        }
      } else if (phase === 'abort-close-cart') {
        if (cart.snapshot().gateAmount < 0.005) returnEmpty();
      } else if (phase === 'abort-giant-dismount') {
        if (walk(giant, cart.world(-3.15, 0, -0.65), dt, { boarding: true })) {
          zombies.release(GIANT);
          const at = cart.world(-0.8, 0.551, CREW_CART.driverEntryZ);
          transitionPose(driver, () => cart.releaseDriver({ x: at.x, y: at.y, z: at.z }));
          setPhase('driver-dismount');
        }
      } else if (phase === 'opening-at-corral') {
        // The guard opens the corral while the giant dismounts and unloads.
        if (cart.snapshot().gateAmount > 0.99) startDismount('corral-dismount');
      } else if (phase === 'corral-dismount') {
        if (walk(giant, cart.world(-3.15, 0, -0.65), dt, { boarding: true })) {
          cart.boards.visible = false;
          setPhase('approach-loaded-calf');
        }
      } else if (phase === 'approach-loaded-calf') {
        if (walk(giant, rearBottom(), dt)) setPhase('walk-to-loaded-calf');
      } else if (phase === 'walk-to-loaded-calf') {
        if (walk(giant, rearTop(), dt, { boarding: 'rear', facingHeading: rampHeading() }))
          setPhase('face-loaded-calf');
      } else if (phase === 'face-loaded-calf') {
        if (
          zombies.face(
            GIANT,
            carryMode === 'underarm'
              ? cart.world(2, 0, CREW_CART.calfZ + frame().x)
              : cart.world(0, 0, -2.48),
            dt,
            player,
            { ignore: (c) => c.woodenCart, ground: rearGround },
          )
        )
          setPhase('grip-loaded-calf');
      } else if (phase === 'grip-loaded-calf') {
        const t = carryMode === 'underarm' ? smooth(Math.min(1, time / 1.5)) : 1;
        hold(dt, (carryMode === 'underarm' ? frame().squat : 0.7) * t, t);
        if (time > 1.5 && carryController.handGaps.every((d) => d < 0.1)) {
          scene.attach(calf.group);
          cart.cargo = null;
          transferStart = calf.group.position.clone();
          transferHeading = calf.group.rotation.y;
          carry = true;
          setPhase('lift-from-cart');
        }
      } else if (phase === 'lift-from-cart') {
        const t = smooth(Math.min(1, time / 2.6)),
          target = heldPosition();
        calf.group.position.copy(transferStart).lerp(target, t);
        calf.group.rotation.y = transferHeading + turn(heldHeading(), transferHeading) * t;
        liftReaction();
        updatePose(dt, true, t);
        hold(dt, frame().squat * (1 - t));
        syncCalf();
        if (t === 1) setPhase('carry-down-ramp');
      } else if (phase === 'carry-down-ramp') {
        if (
          walk(giant, rearBottom(), dt, {
            boarding: 'rear',
            carried: true,
          })
        )
          setPhase('clear-cart-rear');
        carryPose(dt);
      } else if (phase === 'clear-cart-rear') {
        // Walk forward off the broad ramp before turning with the held calf.
        if (
          walk(giant, cart.world(carryMode === 'underarm' ? -0.08 : 0, 0, -7.8), dt, {
            boarding: 'rear',
            carried: true,
          })
        ) {
          startDriverParking();
          setPhase('carry-to-corral');
        }
        carryPose(dt);
      } else if (phase === 'carry-to-corral') {
        const target = { ...corralEntry(), z: CORRAL.z - CORRAL.halfZ - 1.5 };
        const arrived = walk(giant, target, dt, { carried: true });
        carryPose(dt);
        if (arrived) setPhase('face-corral');
      } else if (phase === 'face-corral') {
        if (faceCarrying(0, dt) && corral.snapshot().gateAmount > 0.99) setPhase('enter-corral');
        carryPose(dt);
      } else if (phase === 'enter-corral') {
        const arrived = walk(giant, corralEntry(), dt, { carried: true, facingHeading: 0 });
        carryPose(dt);
        if (arrived) {
          throwDestination = 'corral';
          setPhase('corral-throw-windup');
        }
      } else if (phase === 'leave-corral') {
        // Keep the exit clear of the calf and of the open door's swept leaf.
        guard ??= corral.beginGuardGreeting();
        const exitZ = guard
          ? Math.min(CORRAL.z - CORRAL.halfZ - 3.6, guard.object.position.z - 1.9)
          : CORRAL.z - CORRAL.halfZ - 4.2;
        if (guard && walk(giant, { x: corralEntry().x, z: exitZ }, dt)) setPhase('approach-guard');
      } else if (phase === 'approach-guard') {
        guard ??= corral.beginGuardGreeting();
        if (!guard) return;
        zombies.take(guard.layout.id);
        const p = guard.object.position;
        walk(giant, { x: p.x - 3.5, z: p.z - 1.9 }, dt, { maxSpeed: 1 });
        zombies.face(guard.layout.id, giant.object.position, dt, player);
        if (giant.rig.canPatHead(guard.rig.headTopPoint())) {
          patContact = false;
          setPhase('pat-guard');
        }
      } else if (phase === 'pat-guard') {
        const p = guard.object.position;
        walk(giant, { x: p.x - 3.5, z: p.z - 1.9 }, dt, { maxSpeed: 1 });
        const reaching = time < GUARD_PAT.reach;
        const tapping = time >= GUARD_PAT.reach && time < GUARD_PAT.reach + GUARD_PAT.tap;
        const retracting = time >= GUARD_PAT.reach + GUARD_PAT.tap;
        const progress = THREE.MathUtils.clamp((time - GUARD_PAT.reach) / GUARD_PAT.tap, 0, 1);
        const reaction = tapping && patContact ? Math.sin(progress * Math.PI) : 0;
        guard.rig.acknowledgePat(reaction, dt);
        const crown = guard.rig.headTopPoint();
        const target = crown.clone();
        target.y += reaching
          ? 0.4 * (1 - smooth(THREE.MathUtils.clamp((time / GUARD_PAT.reach - 0.65) / 0.35, 0, 1)))
          : 0;
        if (retracting)
          target.y +=
            0.25 *
            smooth(Math.min(1, (time - GUARD_PAT.reach - GUARD_PAT.tap) / GUARD_PAT.retract));
        const reach = reaching
          ? smooth(Math.min(1, time / (GUARD_PAT.reach * 0.65)))
          : retracting
            ? 1 - smooth(Math.min(1, (time - GUARD_PAT.reach - GUARD_PAT.tap) / GUARD_PAT.retract))
            : 1;
        giant.rig.patHead(
          target,
          reach,
          dt,
          signalSpeaking ? 0.4 + 0.6 * Math.sin(elapsed * 14) ** 2 : 0,
        );
        patGap = giant.rig.patPalmPoint().distanceTo(crown);
        if (tapping && !patContact && patGap < 0.08) {
          patContact = true;
          patEvents++;
          const generation = ++signalGeneration;
          signalEvent = {
            type: 'gate-signal-brains',
            x: giant.object.position.x,
            z: giant.object.position.z,
          };
          signalSound(signalEvent, (event) => {
            if (signalGeneration === generation) signalSpeaking = event === 'playing';
          });
        }
        if (time >= GUARD_PAT.reach + GUARD_PAT.tap + GUARD_PAT.retract) {
          if (!patContact) {
            setPhase('approach-guard');
            return;
          }
          guard.rig.acknowledgePat(0, dt);
          if (corral.finishGuardGreeting()) {
            // Continue the leftward gait on the local patrol without resetting the rig.
            giant.phase = Math.PI / 2;
            zombies.release(GIANT);
            giantReleased = true;
            setPhase('delivery-handoff');
          }
        }
      } else if (phase === 'delivery-handoff') {
        if (
          driverParking?.stage === 'complete' &&
          corral.snapshot().gateAmount === 0 &&
          corral.snapshot().gateOperation.stage === 'idle'
        ) {
          manualTask = null;
          setPhase('complete');
        }
      }
      if (
        phase === 'driver-dismount' &&
        walk(driver, cart.world(-3.15, 0, CREW_CART.driverEntryZ), dt, { boarding: true })
      ) {
        cart.boards.visible = false;
        zombies.release(DRIVER);
        if (aborting) {
          aborting = abortRequested = false;
          manualTask = null;
          cooldown = CALF_HEIST_TRIGGER.cooldown;
          parking = null;
          herdTurn = null;
          setPhase('waiting');
        } else {
          manualTask = null;
          setPhase('complete');
        }
      }
      if (calf && cart.cargo === calf) {
        if (phase !== 'calf-landing') updatePose(dt, false);
        syncCalf();
      }
    },
    crewAvailable: () => ['waiting', 'complete'].includes(phase),
    giantAvailable: () =>
      (giantReleased && phase === 'delivery-handoff') ||
      ['waiting', 'complete', 'driver-returning', 'driver-dismount'].includes(phase),
    snapshot: () =>
      snapshotData({
        phase,
        manualTask,
        manualCancel,
        giant: { position: giant.object.position.toArray(), blocked: giant.blocked },
        lookout: lookout?.snapshot() ?? null,
        carryMode,
        carryFrame: frame(),
        liftEvents,
        expression: pose?.snapshot() ?? null,
        time,
        elapsed,
        trigger: {
          ...CALF_HEIST_TRIGGER,
          distances: separation(),
          isolatedFor,
          cooldown,
          eligible: available(),
          abortReason,
          aborting,
          abortRequested,
        },
        parking,
        herdTurn: herdTurn ? { ...herdTurn, route: [...herdTurn.route] } : null,
        clearance: clearance.snapshot(),
        driverParking: driverParking ? { ...driverParking, route: [...driverParking.route] } : null,
        giantReleased,
        guardPat: {
          side: 'left',
          contact: patContact,
          events: patEvents,
          gap: patGap,
          guardPosition: guard?.object.position.toArray() ?? null,
        },
        carrying: carry,
        handGaps: carryController.handGaps,
        pickup,
        route: walkStates.get(lastWalker)?.route ?? [],
        goal: goal ?? walkStates.get(lastWalker)?.goal ?? null,
        boarding: Object.fromEntries(
          boardingCrew.map(({ actor, stage }) => [actor.layout.id, stage]),
        ),
        history: phaseHistory,
        calf: calf
          ? {
              id: calf.id,
              position: calf.group.getWorldPosition(new THREE.Vector3()).toArray(),
              owner: calf.transportOwner,
            }
          : null,
      }),
  };
  return api;
}
