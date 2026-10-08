import { createBullDefense } from './gameplay/rescue/bull-defense.js';
import { createRescueNotifications } from './gameplay/rescue/notifications.js';
import { rescueVisible } from './gameplay/rescue/visibility.js';
import { snapshotData, recordPhase } from './app/snapshot-data.js';
import * as THREE from 'three';
import { chooseGiantPatrolGoal } from './zombie-alerts.js';
import { dryAnimalPoint, clearAnimalSegment, findAnimalPath } from './corral-navigation.js';
import { drivingHeight } from './world-queries.js';
import { createCalfTransportPose, restoreCalf } from './calf-transport-pose.js';
import { createAnimalAnimation } from './animal-animation.js';
import { ANIMAL_PROFILES } from './animal-profiles.js';

import { CALF_RESCUE } from './gameplay/rescue/config.js';
export { CALF_RESCUE } from './gameplay/rescue/config.js';
const GIANT = 'pvz-gargantuar';
const angle = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const ease = (t) => t * t * (3 - 2 * t);

export { rescueVisible } from './gameplay/rescue/visibility.js';
export function createZombieCalfRescue(
  scene,
  colliders,
  zombies,
  fieldAnimals,
  corral,
  heist,
  { random = Math.random, ground = drivingHeight } = {},
) {
  const giant = zombies.actor(GIANT),
    bull = fieldAnimals.animal('copper-cow');
  const interactions = fieldAnimals.interactions;
  let phase = 'idle',
    time = 0,
    elapsed = 0,
    cooldown = 0,
    calf = null,
    pose = null;
  let lostFor = 0,
    courage = null,
    route = [],
    routeGoal = null,
    retry = 0;
  let chaseAge = 0;
  let patrolStops = [],
    patrolAge = 0,
    patrolSide = null;
  let carrying = false,
    transfer = null,
    delivery = [],
    flight = null,
    handGap = null;
  let patrolIn = 0,
    patrolGoal = null;
  let sound = () => {},
    outcome = '',
    captures = 0,
    rescues = 0,
    impacts = 0;
  let player = null;
  let pendingAlert = null;
  let manual = false,
    searchStops = [],
    searchAge = 0;
  const history = [];
  const defense = createBullDefense({
    bull,
    giant,
    zombies,
    interactions,
    colliders,
    ground,
    getPhase: () => phase,
    emit: (event) => sound(event),
    onThreat() {
      if (carrying) drop('bull-rescue');
      else if (!['fleeing', 'airborne', 'landed', 'dropping'].includes(phase))
        abandon('bull-rescue');
    },
    launch,
  });
  const startDefense = defense.start;
  const updateBull = defense.update;
  const position = () => giant.object.position;
  const notifications = createRescueNotifications({
    zombies,
    colliders,
    getPlayer: () => player,
    getListener: position,
    emit: (event) => sound(event),
    onAlert: (alert) => {
      pendingAlert = alert;
    },
    hear: CALF_RESCUE.hear,
  });
  const { beginNotice, finishNotice, advanceNotice, alertOthers } = notifications;
  const freeCrew = () =>
    (heist?.giantAvailable?.() ??
      heist?.crewAvailable?.() ??
      ['waiting', 'complete'].includes(heist?.snapshot().phase ?? 'complete')) &&
    !giant.seated;
  const line = (to, owner) =>
    rescueVisible(
      position(),
      to,
      colliders,
      (c) =>
        c === giant.collider || c === owner?.collider || (owner === bull && c === calf?.collider),
    );
  function set(next) {
    phase = next;
    time = 0;
    route = [];
    routeGoal = null;
    retry = 0;
    recordPhase(history, next);
  }
  const heldHeading = () => giant.object.rotation.y;
  const heldPosition = (height = 1.12) =>
    giant.object.localToWorld(new THREE.Vector3(-1.08 / 0.7, height / 0.7, 0.08 / 0.7));
  function syncCalf() {
    calf.group.updateMatrixWorld(true);
    const p = calf.group.getWorldPosition(new THREE.Vector3());
    calf.x = p.x;
    calf.z = p.z;
    calf.heading = heldHeading();
    Object.assign(calf.collider, { x: p.x, z: p.z });
  }
  function hold(dt, height = 1.12, squat = 0, reach = 1) {
    calf.group.position.copy(heldPosition(height));
    calf.group.rotation.set(0, heldHeading(), 0, 'YXZ');
    pose.update(dt, true, reach, 'underarm');
    giant.rig.hold(pose.supports('underarm'), squat, dt, reach, 'underarm');
    handGap = giant.rig.hands('underarm')[0].distanceTo(pose.supports('underarm')[0]);
    syncCalf();
  }
  function rebuildCalf() {
    restoreCalf(calf);
    calf.heading = calf.group.rotation.y;
    calf.rig = createAnimalAnimation(calf.source, calf.group, ANIMAL_PROFILES[calf.id]);
    calf.supportHeight = ground;
  }
  function giantAllowed(x, z, car, heading = giant.object.rotation.y, held = carrying) {
    if (
      ['fleeing', 'leaving'].includes(phase) &&
      calf &&
      gap(position(), calf) < giant.collider.radius + calf.radius + 0.12 &&
      gap({ x, z }, calf) < gap(position(), calf) - 1e-6
    )
      return false;
    const separatingBull =
      bull &&
      phase === 'fleeing' &&
      gap(position(), bull) < giant.collider.radius + bull.collider.radius + 0.12 &&
      gap({ x, z }, bull) >= gap(position(), bull) - 1e-6;
    const ignore = (c) =>
      c === giant.collider ||
      (separatingBull && c === bull.collider) ||
      ([
        'manual-search',
        'alert-search',
        'chasing',
        'reaching',
        'lifting',
        'dropping',
        'fleeing',
        'leaving',
      ].includes(phase) &&
        c === calf?.collider) ||
      (held && c === calf?.collider);
    if (!dryAnimalPoint(x, z, giant.collider.radius, colliders, car, ignore)) return false;
    if (!held) return true;
    return dryAnimalPoint(
      x - Math.cos(heading) * 1.08 + Math.sin(heading) * 0.08,
      z + Math.sin(heading) * 1.08 + Math.cos(heading) * 0.08,
      calf.radius,
      colliders,
      car,
      ignore,
    );
  }
  function moveGiant(goal, dt, car, speed, { run = false, heading } = {}) {
    retry = Math.max(0, retry - dt);
    const desired = heading ?? Math.atan2(goal.x - position().x, goal.z - position().z);
    if (
      carrying &&
      ![0, 0.5, 1].every((t) =>
        giantAllowed(
          position().x,
          position().z,
          car,
          giant.object.rotation.y + angle(desired, giant.object.rotation.y) * t,
          true,
        ),
      )
    ) {
      giant.blocked = true;
      return false;
    }
    const movedGoal = !routeGoal || gap(goal, routeGoal) > 0.8;
    if ((movedGoal || !route.length || giant.blocked) && retry === 0) {
      routeGoal = { ...goal };
      route =
        findAnimalPath(position(), goal, (x, z) => giantAllowed(x, z, car, desired), {
          step: carrying ? 0.5 : 0.75,
          padding: 8,
        }) ?? [];
      retry = 0.5;
    }
    if (!route.length) {
      giant.rig.stopRunning();
      return gap(position(), goal) < 0.05;
    }
    const target = route[0];
    const previewLength = gap(position(), target);
    const previewStep = Math.min(previewLength, speed * dt);
    const preview = {
      x: position().x + ((target.x - position().x) * previewStep) / Math.max(previewLength, 1e-9),
      z: position().z + ((target.z - position().z) * previewStep) / Math.max(previewLength, 1e-9),
    };
    const allow = (c) =>
      (c === calf?.collider &&
        (carrying ||
          ['alert-search', 'chasing', 'reaching', 'fleeing', 'leaving'].includes(phase))) ||
      (phase === 'fleeing' &&
        c === bull?.collider &&
        gap(position(), bull) < giant.collider.radius + bull.collider.radius + 0.12 &&
        gap(target, bull) >= gap(position(), bull));
    if (
      !clearAnimalSegment(
        position(),
        preview,
        (x, z) =>
          giantAllowed(
            x,
            z,
            car,
            heading ?? Math.atan2(target.x - position().x, target.z - position().z),
          ),
        0.08,
      )
    ) {
      route = [];
      giant.rig.stopRunning();
      giant.blocked = true;
      return false;
    }
    if (
      zombies.walk(GIANT, target, dt, {
        speed,
        car,
        ignore: allow,
        run,
        alignBeforeMove: carrying,
        ground,
        facingHeading: heading,
      })
    )
      route.shift();
    return gap(position(), goal) < 0.05;
  }
  function abandon(reason) {
    outcome = reason;
    cooldown = CALF_RESCUE.cooldown;
    set('fleeing');
    courage = null;
  }
  function finish() {
    giant.object.rotation.set(0, giant.object.rotation.y, 0, 'YXZ');
    zombies.rebind(GIANT);
    zombies.release(GIANT);
    calf = pose = flight = transfer = null;
    carrying = false;
    manual = false;
    searchStops = [];
    patrolGoal = null;
    patrolStops = [];
    patrolIn = 2;
    set('idle');
  }
  function drop(reason) {
    if (!carrying) {
      abandon(reason);
      return;
    }
    // The calf must have a clear landing before the grip can be released.
    const target = heldPosition(0.025);
    target.y = ground(target.x, target.z) + 0.025;
    if (
      !dryAnimalPoint(
        target.x,
        target.z,
        calf.radius,
        colliders,
        player,
        (c) => c === calf.collider || c === giant.collider,
      )
    )
      return;
    transfer = { start: calf.group.position.clone(), target, reason };
    set('dropping');
  }
  function respondToAlert() {
    if (!pendingAlert) return;
    const a = pendingAlert;
    if (a.target.mode !== 'escaping' || !a.target.outside || a.target.escapeEpoch !== a.epoch) {
      pendingAlert = null;
      return;
    }
    if (phase !== 'idle' || defense.phase !== 'idle' || cooldown > 0 || !freeCrew()) return;
    calf = a.target;
    searchAge = 0;
    searchStops = [a.point];
    patrolStops = [];
    patrolGoal = null;
    courage = null;
    lostFor = chaseAge = 0;
    pendingAlert = null;
    zombies.take(GIANT);
    zombies.rebind(GIANT);
    set('alert-search');
  }
  function launch(car) {
    if (carrying || phase === 'dropping' || ['airborne', 'landed'].includes(phase)) return false;
    const from = position().clone(),
      heading = Math.atan2(from.x - bull.x, from.z - bull.z);
    let target = null;
    for (const distance of [8, 7, 6, 4, 2]) {
      const p = {
        x: from.x + Math.sin(heading) * distance,
        z: from.z + Math.cos(heading) * distance,
      };
      if (
        clearAnimalSegment(from, p, (x, z) =>
          dryAnimalPoint(
            x,
            z,
            giant.collider.radius,
            colliders,
            car,
            (c) => c === giant.collider || c === bull.collider,
          ),
        )
      ) {
        target = new THREE.Vector3(p.x, ground(p.x, p.z), p.z);
        break;
      }
    }
    if (!target) {
      abandon('blocked-flight');
      return false;
    }
    zombies.take(GIANT);
    flight = { from, target, yaw: giant.object.rotation.y };
    carrying = false;
    impacts++;
    rescues++;
    outcome = 'bull-launched';
    cooldown = CALF_RESCUE.cooldown;
    set('airborne');
    sound({ type: 'bull-impact', x: from.x, z: from.z });
    return true;
  }
  const api = {
    beforeGuardClose(id, dt) {
      if (notifications.current?.guard && notifications.current.actor.layout.id === id)
        return advanceNotice(dt);
      const escaped = corral.animals.find(
        (a) => a.id === 'hornless-calf' && a.mode === 'escaping' && a.outside,
      );
      if (!escaped || notifications.hasNoticed(escaped) || notifications.current) return true;
      if (!beginNotice(zombies.actor(id), escaped, true)) return true;
      return advanceNotice(dt);
    },
    cancelGuardNotice(id) {
      if (notifications.current?.guard && notifications.current.actor.layout.id === id)
        finishNotice(true);
    },
    manualAvailability(target) {
      if (phase !== 'idle' || defense.phase !== 'idle' || !freeCrew())
        return '大僵尸正在执行其他任务';
      if (cooldown > 0) return '追回任务冷却中';
      if (
        !target ||
        !corral.animals.includes(target) ||
        target.id !== 'hornless-calf' ||
        target.mode !== 'escaping' ||
        !target.outside
      )
        return '需要一头已逃出围栏的小牛';
      return '';
    },
    startManual(target) {
      if (api.manualAvailability(target)) return false;
      calf = target;
      manual = true;
      searchAge = 0;
      courage = null;
      lostFor = chaseAge = 0;
      patrolStops = [];
      patrolGoal = null;
      zombies.take(GIANT);
      zombies.rebind(GIANT);
      searchStops =
        position().x > 120 && calf.x < 0
          ? [
              { x: 168, z: -27 },
              { x: -26, z: -27 },
            ]
          : position().x < 0 && calf.x > 120
            ? [
                { x: -26, z: -27 },
                { x: 155, z: -27 },
              ]
            : [];
      set('manual-search');
      return true;
    },
    cancelManual() {
      if (!manual || ['dropping', 'fleeing', 'airborne', 'landed', 'leaving'].includes(phase))
        return false;
      if (carrying) {
        drop('manual-cancel');
        return phase === 'dropping';
      }
      abandon('manual-cancel');
      return true;
    },
    connectAudio(listener) {
      sound = listener;
    },
    returnHome(a) {
      if (!interactions.returnFromCorral(a)) return false;
      if (calf === a && !carrying) {
        outcome = 'home';
        cooldown = CALF_RESCUE.cooldown;
        if (phase !== 'idle') abandon('home');
      }
      heist?.rearm?.();
      return true;
    },
    update(dt, car) {
      if (!(dt > 0)) return;
      player = car;
      dt = Math.min(dt, 0.1);
      elapsed += dt;
      time += dt;
      cooldown = Math.max(0, cooldown - dt);
      const escaped = corral.animals.find(
        (a) => a.id === 'hornless-calf' && a.mode === 'escaping' && a.outside,
      );
      alertOthers(escaped, dt);
      respondToAlert();
      if (!freeCrew()) {
        if (phase === 'idle') {
          patrolGoal = null;
          patrolSide = null;
          patrolStops = [];
          route = [];
          routeGoal = null;
        }
        return;
      }
      if (phase === 'alert-search') {
        searchAge += dt;
        if (!calf || calf.mode !== 'escaping' || !calf.outside) abandon('target-lost');
        else if (gap(position(), calf) < 25 && line(calf, calf)) set('chasing');
        else if (searchAge > 25) abandon('target-lost');
        else if (searchStops.length) {
          if (moveGiant(searchStops[0], dt, car, CALF_RESCUE.sprint, { run: true }))
            searchStops.shift();
        } else {
          lostFor += dt;
          if (lostFor > 5) abandon('target-lost');
        }
      }
      if (phase === 'manual-search') {
        searchAge += dt;
        if (!calf || calf.mode !== 'escaping' || !calf.outside || searchAge > 600)
          abandon('target-lost');
        else {
          if (searchStops.length) {
            if (moveGiant(searchStops[0], dt, car, CALF_RESCUE.sprint, { run: true }))
              searchStops.shift();
          } else if (gap(position(), calf) <= CALF_RESCUE.notice && line(calf, calf)) {
            set('chasing');
          } else moveGiant({ x: calf.x, z: calf.z }, dt, car, CALF_RESCUE.sprint, { run: true });
        }
      }
      if (
        bull &&
        defense.phase === 'idle' &&
        !giant.seated &&
        gap(position(), bull) <= CALF_RESCUE.defense &&
        line(bull, bull)
      ) {
        // An ordinary wandering giant can also trespass on the bull's territory.
        if (!giant.scripted || patrolGoal || phase !== 'idle') {
          startDefense();
        }
      }
      if (phase === 'idle') {
        if (defense.phase === 'idle' && (!giant.scripted || patrolGoal)) {
          patrolIn -= dt;
          if (!patrolGoal && patrolIn <= 0) {
            patrolSide ??= random() < 0.5;
            patrolGoal = chooseGiantPatrolGoal(
              position(),
              random,
              (p) => giantAllowed(p.x, p.z, car),
              patrolSide,
            );
            patrolAge = 0;
            patrolStops = patrolGoal ? [patrolGoal] : [];
            if (!patrolGoal) patrolIn = 3;
          }
          if (patrolGoal) {
            patrolAge += dt;
            if (!patrolStops.length) patrolStops = [patrolGoal];
            if (moveGiant(patrolStops[0], dt, car, 0.65)) {
              patrolStops.shift();
              patrolAge = 0;
            }
            if (!patrolStops.length || (giant.blocked && patrolAge > 10)) {
              patrolGoal = null;
              patrolSide = null;
              patrolStops = [];
              patrolIn = 3;
              zombies.release(GIANT);
            }
          }
        }
      }
      if (
        ['chasing', 'reaching', 'lifting', 'carrying', 'gate-wait'].includes(phase) &&
        bull &&
        line(bull, bull) &&
        gap(position(), bull) <= CALF_RESCUE.threat
      ) {
        if (carrying) drop('bull-threat');
        else if (courage === null) {
          courage = random() >= CALF_RESCUE.retreatProbability;
          if (!courage) abandon('bull-retreat');
        }
      }
      if (phase === 'chasing') {
        chaseAge += dt;
        if (!calf || calf.mode !== 'escaping') abandon('target-lost');
        else {
          lostFor = line(calf, calf) && gap(position(), calf) < 25 ? 0 : lostFor + dt;
          if (lostFor > 5) abandon('target-lost');
          else {
            const cycle = chaseAge % (CALF_RESCUE.sprintSeconds + CALF_RESCUE.followSeconds);
            const speed =
              cycle < CALF_RESCUE.sprintSeconds ? CALF_RESCUE.sprint : CALF_RESCUE.follow;
            const heading = calf.heading;
            const goal = {
              x: calf.x + Math.cos(heading) * 1.08 - Math.sin(heading) * 0.08,
              z: calf.z - Math.sin(heading) * 1.08 - Math.cos(heading) * 0.08,
            };
            moveGiant(goal, dt, car, speed, { run: true });
            if (gap(position(), goal) < 1.6) {
              pose = createCalfTransportPose(calf);
              set('reaching');
            }
          }
        }
      } else if (phase === 'reaching') {
        chaseAge += dt;
        if (calf.mode !== 'escaping' || gap(position(), calf) > 2.6) {
          pose = null;
          set('chasing');
        } else {
          const heading = calf.heading;
          const goal = {
            x: calf.x + Math.cos(heading) * 1.08 - Math.sin(heading) * 0.08,
            z: calf.z - Math.sin(heading) * 1.08 - Math.cos(heading) * 0.08,
          };
          const sprinting = chaseAge % 20 < 10;
          moveGiant(goal, dt, car, sprinting ? CALF_RESCUE.sprint : CALF_RESCUE.follow, {
            run: true,
            heading,
          });
          const reach = Math.min(1, time / CALF_RESCUE.grabSeconds);
          giant.rig.hold(pose.supports('underarm'), 0.35, dt, reach, 'underarm');
          handGap = giant.rig.hands('underarm')[0].distanceTo(pose.supports('underarm')[0]);
          if (time >= CALF_RESCUE.grabSeconds && handGap < 0.22 && corral.claimEscapingCalf(calf)) {
            carrying = true;
            captures++;
            transfer = { start: calf.group.position.clone() };
            pose.startStruggle();
            set('lifting');
          } else if (time > 1.2) {
            pose = null;
            set('chasing');
          }
        }
      } else if (phase === 'lifting') {
        const t = ease(Math.min(1, time / 0.9));
        const p = heldPosition();
        calf.group.position.copy(transfer.start).lerp(p, t);
        calf.group.rotation.y = calf.heading + angle(heldHeading(), calf.heading) * t;
        pose.update(dt, true, t, 'underarm');
        giant.rig.hold(pose.supports('underarm'), 0.35 * (1 - t), dt, 1, 'underarm');
        syncCalf();
        if (t === 1) {
          delivery =
            position().x < 120
              ? [
                  { x: -26, z: -27 },
                  { x: 155, z: -27 },
                  { x: 168, z: 13 },
                ]
              : [{ x: 168, z: 13 }];
          set('carrying');
        }
      } else if (phase === 'carrying') {
        const goal = delivery[0];
        if (goal && moveGiant(goal, dt, car, CALF_RESCUE.carry, { heading: goal.heading }))
          delivery.shift();
        hold(dt);
        if (!delivery.length) {
          corral.prepareGate(true);
          set('gate-wait');
        }
      } else if (phase === 'gate-wait') {
        hold(dt);
        if (corral.snapshot().gateAmount >= 0.99) {
          delivery = [
            { x: 164.54, z: 14 },
            { x: 164.54, z: 22.5 },
          ];
          set('entering');
        }
      } else if (phase === 'entering') {
        if (moveGiant(delivery[0], dt, car, CALF_RESCUE.carry)) {
          delivery.shift();
          if (!delivery.length) drop('recaptured');
        }
        if (phase === 'entering') hold(dt);
      } else if (phase === 'dropping') {
        const t = ease(Math.min(1, time / CALF_RESCUE.dropSeconds));
        calf.group.position.copy(transfer.start).lerp(transfer.target, t);
        pose.update(dt, true, 1 - t, 'underarm');
        giant.rig.hold(pose.supports('underarm'), 0.6 * t, dt, 1, 'underarm');
        syncCalf();
        if (t === 1) {
          carrying = false;
          rebuildCalf();
          outcome = transfer.reason;
          if (outcome === 'recaptured') {
            corral.finishDelivery(calf);
            set('leaving');
          } else {
            rescues++;
            corral.resumeEscape(calf);
            abandon(outcome);
          }
        }
      } else if (phase === 'leaving') {
        if (moveGiant({ x: 158, z: 16 }, dt, car, CALF_RESCUE.walk)) {
          corral.prepareGate(false);
          cooldown = CALF_RESCUE.cooldown;
          finish();
        }
      } else if (phase === 'fleeing') {
        if (!routeGoal || giant.blocked || gap(position(), routeGoal) < 0.2) {
          const away = bull ? Math.atan2(position().x - bull.x, position().z - bull.z) : 0;
          routeGoal = null;
          for (const offset of [0, 0.6, -0.6, 1.2, -1.2]) {
            const p = {
              x: position().x + Math.sin(away + offset) * 10,
              z: position().z + Math.cos(away + offset) * 10,
            };
            if (giantAllowed(p.x, p.z, car)) {
              routeGoal = p;
              route = [];
              retry = 0;
              break;
            }
          }
        }
        if (routeGoal) moveGiant(routeGoal, dt, car, CALF_RESCUE.flee, { run: true });
        if (time > 8 && defense.phase !== 'charging' && defense.phase !== 'warning') finish();
      } else if (phase === 'airborne') {
        const t = Math.min(1, time / CALF_RESCUE.flightSeconds);
        const next = flight.from.clone().lerp(flight.target, t);
        next.y += 4 * CALF_RESCUE.flightHeight * t * (1 - t);
        giant.object.position.copy(next);
        giant.object.rotation.set(-0.7 * Math.sin(Math.PI * t), flight.yaw, 0, 'YXZ');
        Object.assign(giant.collider, { x: next.x, z: next.z });
        if (t === 1) {
          giant.object.rotation.x = 0;
          zombies.rebind(GIANT);
          set('landed');
        }
      } else if (phase === 'landed') {
        giant.rig.stumble(dt, Math.sin(Math.PI * Math.min(1, time / CALF_RESCUE.landingSeconds)));
        if (time >= CALF_RESCUE.landingSeconds) set('fleeing');
      }
      if (
        carrying &&
        !['dropping', 'entering'].includes(phase) &&
        bull &&
        gap(position(), bull) <= CALF_RESCUE.defense
      )
        drop('bull-rescue');
      updateBull(dt, car);
    },
    snapshot: () =>
      snapshotData({
        phase,
        manual,
        time,
        elapsed,
        cooldown,
        outcome,
        courage,
        carrying,
        alert: notifications.current
          ? {
              actor: notifications.current.actor.layout.id,
              stage: notifications.current.stage,
              guard: notifications.current.guard,
              point: { ...notifications.current.point },
              sent: notifications.current.sent,
            }
          : null,
        pendingAlert: pendingAlert
          ? { epoch: pendingAlert.epoch, point: { ...pendingAlert.point } }
          : null,
        patrolGoal: patrolGoal ? { ...patrolGoal } : null,
        lostFor,
        captures,
        rescues,
        impacts,
        handGap,
        route: route.map((p) => ({ ...p })),
        history: [...history],
        giant: position().toArray(),
        calf: calf ? { x: calf.x, z: calf.z, mode: calf.mode, owner: calf.transportOwner } : null,
        bull: defense.snapshot(),
      }),
  };
  corral.connectPursuit(api);
  heist?.connectRescueCrewAvailability?.(() => phase === 'idle' && defense.phase === 'idle');
  return api;
}
