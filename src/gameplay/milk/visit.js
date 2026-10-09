import * as THREE from 'three';
import { CORRAL } from '../../corral-model.js';
import { dryAnimalPoint } from '../../corral-navigation.js';
import { landscapeHeight } from '../../world-queries.js';
import { recordPhase, snapshotData } from '../../app/snapshot-data.js';
import { createMilkBucket, MILK_BUCKET } from './bucket.js';
import { createMilkNavigation } from './navigation.js';

export const MILK_VISIT = Object.freeze({
  station: Object.freeze({ x: -20, z: 22 }),
  speed: 4.5,
  cooldown: 30,
  drinkSeconds: 5,
  windupSeconds: 0.65,
  flightSeconds: 1.1,
  landingSeconds: 0.65,
  leapHeight: 2.7,
});
const clamp = (v, lo = 0, hi = 1) => THREE.MathUtils.clamp(v, lo, hi);
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Owns this visit, not the calf's captivity or the leopard's autonomous life.
// All transfers retain the original two skins and the one visible pail.
export function createLeopardMilkVisit(
  scene,
  colliders,
  animals,
  corral,
  { ground = landscapeHeight, station = MILK_VISIT.station, navigationOptions } = {},
) {
  const leopard = animals.animal('baola-leopard');
  if (!leopard?.rig || !corral) return null;
  const bucket = createMilkBucket(scene);
  const bucketBody = {
    x: station.x,
    z: station.z,
    radius: MILK_BUCKET.radius,
    height: MILK_BUCKET.grip,
    milkBucket: true,
  };
  colliders.push(bucketBody);
  const navigation = createMilkNavigation(
    colliders,
    ground,
    (c) => c === bucketBody || c === landingBody,
    navigationOptions,
  );
  const history = ['idle'];
  let phase = 'idle',
    time = 0,
    elapsed = 0,
    cooldown = 0,
    stalled = 0,
    visits = 0,
    delivered = 0;
  let calf = null,
    loan = false,
    carried = false,
    inside = false,
    cancelled = false;
  let home = null,
    homeGoal = null,
    journey = [],
    site = null,
    landingBody = null,
    jump = null;
  let bucketAt = { ...station },
    drinkTime = 0,
    contactTime = 0,
    result = null;
  let sound = () => false,
    dialogue = null,
    voiceGeneration = 0;
  const voiceHistory = [];
  const outbound = () => [
    { x: -26, z: -27 },
    { x: 168, z: -27 },
    { x: 170.4, z: 24.2 },
  ];
  function returnRoute(from) {
    const route = [];
    if (from.x > 120) route.push({ x: 168, z: -27 });
    if (from.x >= -17 || from.z < -15) route.push({ x: -26, z: -27 });
    if (gap(from, station) > 5) route.push({ x: station.x, z: station.z - 2.5 });
    return route;
  }
  function stopVoice() {
    voiceGeneration++;
    sound({ type: 'milk-voice-stop' });
    leopard.vocalPose = 0;
    if (calf) calf.vocalPose = 0;
    dialogue = null;
  }
  function line(name) {
    set(name);
    dialogue = { line: name, requested: false, playing: false, outcome: null };
  }
  function updateVoice(dt) {
    const current = dialogue,
      actor = phase === 'question' ? calf : leopard;
    if (!current.requested) {
      current.requested = true;
      const token = ++voiceGeneration;
      const accepted = sound(
        { type: 'milk-voice', line: current.line, x: actor.x, z: actor.z },
        (event) => {
          if (token !== voiceGeneration || dialogue !== current) return;
          current.playing = event === 'playing';
          if (event !== 'playing') current.outcome = event;
          voiceHistory.push({ line: current.line, event });
          if (voiceHistory.length > 12) voiceHistory.shift();
          if (!current.playing) actor.vocalPose = 0;
        },
      );
      if (!accepted) current.outcome = 'skipped';
    }
    actor.vocalPose = THREE.MathUtils.damp(
      actor.vocalPose ?? 0,
      current.playing ? 0.5 + 0.35 * Math.sin(actor.clock * 13) ** 2 : 0,
      14,
      dt,
    );
    // Failed or missing media events cannot hold the two animals indefinitely.
    if (!current.outcome && time > (current.playing ? 20 : 8)) {
      stopVoice();
      set('clearing-calf');
    } else if (current.outcome) {
      if (phase === 'question' && current.outcome === 'ended') line('answer');
      else {
        stopVoice();
        set('clearing-calf');
      }
    }
  }
  bucket.root.position.set(station.x, ground(station.x, station.z) + 0.025, station.z);
  bucket.setFill(1);

  function set(next) {
    phase = next;
    time = contactTime = stalled = 0;
    leopard.velocity = leopard.chargeRun = 0;
    navigation.clear(leopard);
    recordPhase(history, next);
  }
  function releaseCalf() {
    if (!loan) return;
    corral.finishMilk(calf);
    navigation.clear(calf);
    loan = false;
    calf.vocalPose = 0;
  }
  function placeBucket(at) {
    bucketAt = { ...at };
    carried = false;
    bucket.root.position.set(at.x, ground(at.x, at.z) + 0.025, at.z);
    bucket.root.rotation.set(0, 0, 0);
    Object.assign(bucketBody, { x: at.x, z: at.z, radius: MILK_BUCKET.radius });
  }
  function renderActor(a, dt, chew = 0) {
    a.clock += dt;
    a.behavior.swishTime = (a.behavior.swishTime ?? 2) + dt;
    a.group.updateMatrixWorld(true);
    a.rig.update(dt, a, chew, 0);
    a.group.updateMatrixWorld(true);
  }
  function attachBucket() {
    const mouth = leopard.rig.contactPoint();
    bucket.root.position.copy(mouth).add(new THREE.Vector3(0, -MILK_BUCKET.grip, 0));
    bucket.root.rotation.set(0, leopard.heading, 0);
    bucket.root.updateMatrixWorld(true);
    Object.assign(bucketBody, { x: mouth.x, z: mouth.z, radius: 0 });
  }
  function groundPose(a, dt, down = 0) {
    a.behavior.down = THREE.MathUtils.damp(a.behavior.down ?? 0, down, 7, dt);
    a.behavior.raised = 0;
    a.group.position.set(a.x, ground(a.x, a.z) + 0.025, a.z);
    a.group.rotation.set(0, a.heading, 0, 'YXZ');
    Object.assign(a.collider, { x: a.x, z: a.z });
  }
  function groundGrip(at) {
    return new THREE.Vector3(at.x, ground(at.x, at.z) + 0.025 + MILK_BUCKET.grip, at.z);
  }
  function reach(a, target, heading, dt, car) {
    const mouth = a.rig.contactPoint();
    // Physical head lowering and body approach, rather than moving the pail
    // into a remote mouth. Recheck the real bind-surface contact every frame.
    a.behavior.down = clamp((a.behavior.down ?? 0) + (mouth.y - target.y) * dt * 4, 0, 1.15);
    const offset = mouth
      .clone()
      .sub(a.group.position)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), heading - a.heading);
    const goal = { x: target.x - offset.x, z: target.z - offset.z };
    const arrived = navigation.move(a, goal, dt, car, 0.65, heading);
    return arrived && mouth.distanceTo(target) < 0.045;
  }
  function releaseLanding() {
    if (landingBody) {
      const i = colliders.indexOf(landingBody);
      if (i >= 0) colliders.splice(i, 1);
      landingBody = null;
    }
  }
  function trajectory(t, from, to) {
    const p = new THREE.Vector3(from.x, ground(from.x, from.z) + 0.025, from.z).lerp(
      new THREE.Vector3(to.x, ground(to.x, to.z) + 0.025, to.z),
      t,
    );
    p.y += MILK_VISIT.leapHeight * 4 * t * (1 - t);
    return p;
  }
  function jumpClear(from, to, car) {
    const future = car && {
      ...car,
      x: car.x + Math.sin(car.heading ?? 0) * (car.speed ?? 0) * MILK_VISIT.flightSeconds,
      z: car.z + Math.cos(car.heading ?? 0) * (car.speed ?? 0) * MILK_VISIT.flightSeconds,
    };
    for (let i = 0; i <= 100; i++) {
      const p = trajectory(i / 100, from, to);
      const ignore = (c) =>
        c === leopard.collider ||
        c === bucketBody ||
        c === landingBody ||
        (c.corral && !c.corralGate && p.y - 0.12 > ground(c.x, c.z) + c.height + 0.1);
      if (
        !dryAnimalPoint(p.x, p.z, leopard.radius, colliders, car, ignore) ||
        (future && !dryAnimalPoint(p.x, p.z, leopard.radius, colliders, future, ignore))
      )
        return false;
    }
    return true;
  }
  function chooseSite(car) {
    for (const z of [24.2, 21.8, 23]) {
      const candidate = {
        outer: { x: CORRAL.x + CORRAL.halfX + 2.4, z },
        inner: { x: CORRAL.x + CORRAL.halfX - 2.4, z },
      };
      if (jumpClear(candidate.outer, candidate.inner, car)) return candidate;
    }
    return null;
  }
  function startJump(out, car) {
    const from = out ? site.inner : site.outer,
      to = out ? site.outer : site.inner;
    if (!jumpClear(from, to, car)) return false;
    jump = { from, to, out };
    landingBody = {
      ...to,
      radius: leopard.radius + 0.1,
      height: leopard.collider.height,
      milkLanding: true,
    };
    colliders.push(landingBody);
    leopard.milkJump = { phase: 'windup', progress: 0, ground };
    set(out ? 'windup-out' : 'windup-in');
    return true;
  }
  function beginReturn() {
    stopVoice();
    if (!carried && gap(bucketAt, station) > 0.1) {
      set(loan ? 'clearing-calf' : 'collecting');
      return;
    }
    releaseCalf();
    if (inside) {
      site = null;
      set('exiting');
    } else {
      journey = returnRoute(leopard);
      set('returning-bucket');
    }
  }
  function abort(reason) {
    if (cancelled) return;
    cancelled = true;
    result = reason;
    // Flight and landing retain their controller until all four paws recover.
    if (leopard.milkJump) return;
    beginReturn();
  }
  function targetValid() {
    const gate = corral.gateState();
    return (
      corral.animals.includes(calf) &&
      !calf.outside &&
      (loan
        ? calf.transportOwner === 'milk-visit' && calf.mode === 'milk-feeding'
        : calf.transportOwner === 'corral' && calf.mode === 'confined') &&
      gate.gateAmount === 0 &&
      gate.gateOperation.requested !== true
    );
  }
  const api = {
    leopard,
    bucket,
    connectAudio(fn) {
      sound = fn ?? (() => false);
    },
    availability() {
      if (phase !== 'idle') return '豹拉正在送奶或返回';
      if (cooldown > 0) return `牛奶补充中，还需${Math.ceil(cooldown)}秒`;
      const reason = animals.interactions.milkAvailability(leopard);
      if (reason) return reason;
      const target = corral.animals.find((a) => a.id === 'hornless-calf');
      return corral.milkAvailability(target);
    },
    start() {
      if (api.availability() || !animals.interactions.reserveMilk(leopard)) return false;
      calf = corral.animals.find((a) => a.id === 'hornless-calf');
      home = { x: leopard.homeX, z: leopard.homeZ };
      homeGoal = null;
      cancelled = carried = inside = loan = false;
      drinkTime = 0;
      result = null;
      site = null;
      stopVoice();
      navigation.clear(leopard, true);
      navigation.clear(calf, true);
      voiceHistory.length = 0;
      visits++;
      set('waking');
      return true;
    },
    cancel() {
      if (phase === 'idle' || cancelled) return false;
      abort('cancelled');
      return true;
    },
    status() {
      if (phase === 'idle')
        return cooldown > 0 ? `牛奶补充中：${Math.ceil(cooldown)}秒` : '牛奶已备好';
      if (cancelled) return '正在带奶桶安全返回';
      if (phase === 'feeding') return '小牛正在喝牛奶';
      if (phase === 'question') return '小牛：还有吗？';
      if (phase === 'answer') return '豹拉：满足你的胃，它会治愈悲伤的';
      if (/windup|jumping|landing/.test(phase)) return '豹拉正在跃过围栏';
      if (/returning|putting-back/.test(phase)) return '豹拉正在归还奶桶';
      return '豹拉正在给小牛送奶';
    },
    update(dt, car, clockDt = dt) {
      if (!(dt > 0)) return;
      elapsed += clockDt;
      if (phase === 'idle') {
        const before = cooldown;
        cooldown = Math.max(0, cooldown - clockDt);
        if (before > 0 && cooldown === 0) bucket.setFill(1);
        return;
      }
      const travelBefore = leopard.distance + (loan ? calf.distance : 0),
        milkBefore = drinkTime;
      navigation.beginFrame();
      time += dt;
      leopard.group.visible = true;
      leopard.behavior.state = 'walking';
      if (!cancelled && !targetValid()) abort('calf-unavailable');
      if (!cancelled && stalled > 90 && !leopard.milkJump) abort('blocked');
      if (phase === 'waking') {
        if (animals.interactions.sleep.ready(leopard)) set('taking');
      } else if (phase === 'taking') {
        if (reach(leopard, groundGrip(station), 0, dt, car)) {
          contactTime += dt;
          if (contactTime >= 0.15) {
            carried = true;
            journey = outbound();
            set('approaching');
          }
        } else contactTime = 0;
        navigation.prepare(leopard, outbound(), car, station);
      } else if (phase === 'approaching' || phase === 'returning-bucket') {
        groundPose(leopard, dt);
        if (journey.length) {
          if (navigation.move(leopard, journey, dt, car, MILK_VISIT.speed)) journey = [];
        } else if (phase === 'returning-bucket') set('putting-back');
        else {
          site ??= chooseSite(car);
          if (site && navigation.move(leopard, site.outer, dt, car, 1.4, -Math.PI / 2)) {
            if (!startJump(false, car)) site = null;
          }
        }
      } else if (/^(windup|jumping|landing)-(in|out)$/.test(phase)) {
        if (jump.out) navigation.prepare(leopard, returnRoute(jump.to), car, jump.to);
        const state = leopard.milkJump;
        if (phase.startsWith('windup')) {
          state.progress = clamp(time / MILK_VISIT.windupSeconds);
          if (state.progress === 1) {
            if (!jumpClear(jump.from, jump.to, car)) {
              delete leopard.milkJump;
              releaseLanding();
              if (cancelled) beginReturn();
              else set(jump.out ? 'exiting' : 'approaching');
            } else {
              state.phase = 'flight';
              state.progress = 0;
              set(jump.out ? 'jumping-out' : 'jumping-in');
            }
          }
        } else if (phase.startsWith('jumping')) {
          state.progress = clamp(time / MILK_VISIT.flightSeconds);
          const p = trajectory(state.progress, jump.from, jump.to);
          const step = gap(leopard, p);
          leopard.x = p.x;
          leopard.z = p.z;
          leopard.distance += step;
          leopard.group.position.copy(p);
          Object.assign(leopard.collider, { x: p.x, z: p.z, baseY: p.y });
          if (state.progress === 1) {
            inside = !jump.out;
            state.phase = 'landing';
            state.progress = 0;
            set(jump.out ? 'landing-out' : 'landing-in');
          }
        } else {
          state.progress = clamp(time / MILK_VISIT.landingSeconds);
          if (state.progress === 1) {
            delete leopard.milkJump;
            delete leopard.collider.baseY;
            releaseLanding();
            if (jump.out) beginReturn();
            else if (cancelled) beginReturn();
            else if (!corral.reserveMilk(calf)) abort('calf-unavailable');
            else {
              loan = true;
              set('placing');
            }
          }
        }
      } else if (phase === 'placing' || phase === 'putting-back') {
        if (phase === 'placing' && corral.milkReady(calf)) {
          groundPose(calf, dt);
          navigation.move(calf, { x: 162.8, z: 23.2 }, dt, car, 0.6, Math.PI / 2);
        }
        const at = phase === 'placing' ? { x: 164.3, z: 23.2 } : station;
        const heading = phase === 'placing' ? -Math.PI / 2 : 0;
        if (reach(leopard, groundGrip(at), heading, dt, car)) {
          contactTime += dt;
          if (contactTime >= 0.2) {
            placeBucket(at);
            if (phase === 'placing') set('retreating');
            else set('returning-home');
          }
        } else contactTime = 0;
      } else if (phase === 'retreating') {
        groundPose(leopard, dt);
        if (navigation.move(leopard, { x: 165.6, z: 24.5 }, dt, car, 0.7, (-3 * Math.PI) / 4))
          set('feeding');
      } else if (phase === 'feeding') {
        groundPose(leopard, dt);
        const point = new THREE.Vector3(
          bucketAt.x,
          ground(bucketAt.x, bucketAt.z) + 0.29,
          bucketAt.z,
        );
        if (reach(calf, point, Math.PI / 2, dt, car)) {
          drinkTime = Math.min(MILK_VISIT.drinkSeconds, drinkTime + dt);
          bucket.setFill(1 - drinkTime / MILK_VISIT.drinkSeconds);
          if (drinkTime >= MILK_VISIT.drinkSeconds) {
            delivered++;
            result = 'fed';
            line('question');
          }
        }
      } else if (phase === 'question' || phase === 'answer') {
        groundPose(leopard, dt);
        groundPose(calf, dt);
        updateVoice(dt);
      } else if (phase === 'clearing-calf') {
        groundPose(calf, dt);
        navigation.move(calf, { x: 162.8, z: 23.2 }, dt, car, 0.6, Math.PI / 2);
        if (reach(leopard, groundGrip(bucketAt), -Math.PI / 2, dt, car)) set('collecting');
      } else if (phase === 'collecting') {
        if (reach(leopard, groundGrip(bucketAt), -Math.PI / 2, dt, car)) {
          contactTime += dt;
          if (contactTime >= 0.15) {
            carried = true;
            releaseCalf();
            site = null;
            set('exiting');
          }
        } else contactTime = 0;
      } else if (phase === 'exiting') {
        groundPose(leopard, dt);
        site ??= chooseSite(car);
        if (site && navigation.move(leopard, site.inner, dt, car, 0.7, Math.PI / 2))
          if (!startJump(true, car)) site = null;
      } else if (phase === 'returning-home') {
        groundPose(leopard, dt);
        if (!homeGoal || !navigation.allowed(leopard, homeGoal.x, homeGoal.z, car)) {
          const candidates = [home];
          for (const r of [1.5, 2.5])
            for (let i = 0; i < 8; i++)
              candidates.push({
                x: home.x + Math.sin((i * Math.PI) / 4) * r,
                z: home.z + Math.cos((i * Math.PI) / 4) * r,
              });
          homeGoal = candidates.find((p) => navigation.allowed(leopard, p.x, p.z, car)) ?? null;
        }
        if (homeGoal && navigation.move(leopard, homeGoal, dt, car, 0.8)) {
          groundPose(leopard, dt);
          animals.interactions.releaseMilk(leopard);
          cooldown = MILK_VISIT.cooldown;
          stopVoice();
          set('idle');
        }
      }
      if (phase !== 'idle') {
        stalled =
          leopard.distance + (loan ? calf.distance : 0) > travelBefore + 0.0001 ||
          drinkTime > milkBefore
            ? 0
            : stalled + dt;
        renderActor(leopard, dt);
        if (carried) attachBucket();
        if (loan)
          renderActor(calf, dt, phase === 'feeding' ? 0.5 + 0.2 * Math.sin(calf.clock * 5) : 0);
      }
    },
    snapshot: () =>
      snapshotData({
        phase,
        time,
        elapsed,
        stalled,
        cooldown,
        visits,
        delivered,
        cancelled,
        result,
        inside,
        carried,
        milk: bucket.fill,
        station,
        bucket: bucket.root.position.toArray(),
        grip: bucket.gripPoint().toArray(),
        mouth: leopard.rig.contactPoint().toArray(),
        leopard: {
          x: leopard.x,
          z: leopard.z,
          y: leopard.group.position.y,
          owner: leopard.transportOwner,
        },
        calf: calf ? { x: calf.x, z: calf.z, owner: calf.transportOwner, mode: calf.mode } : null,
        jump: leopard.milkJump
          ? { phase: leopard.milkJump.phase, progress: leopard.milkJump.progress }
          : null,
        navigation: navigation.snapshot(),
        dialogue,
        voiceHistory,
        history,
      }),
  };
  return api;
}
