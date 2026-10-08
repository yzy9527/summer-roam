import { createPaddyWorker } from './gameplay/paddy/worker.js';
import { createPaddyNavigation } from './gameplay/paddy/navigation.js';
import { snapshotData, recordPhase } from './app/snapshot-data.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from './asset-url.js';
import { createPaddyPloughing } from './paddy-ploughing.js';
import { createWhipHolster } from './paddy-whip-holster.js';
import { CORRAL } from './corral-model.js';
import { PLOUGH_FIELD, ploughGround } from './paddy-plough-site.js';
import { paddyDistance } from './paddy-profile.js';
import { drivingHeight, roadPoint } from './world-queries.js';
import { vehicleObstacleGap } from './vehicle-collision.js';

export const PLOUGH_SECONDS = 60 * 5;
const gateZ = CORRAL.z - CORRAL.halfZ;
export const PLOUGH_STORAGE = Object.freeze({ x: 118, z: 12 });
const storage = PLOUGH_STORAGE;
export const PLOUGH_WAIT = Object.freeze({ x: 118, z: 14, heading: 0 });
const outside = { x: CORRAL.x, z: gateZ - 8 };
const point = (a) => (a.group ? a : a.object.position);
const radius = (a) => a.radius ?? a.collider.radius;
const ground = (x, z) =>
  paddyDistance(PLOUGH_FIELD, x, z, roadPoint) < 0 ? ploughGround(x, z) : drivingHeight(x, z);
const returning = new Set([
  'unhitch',
  'returning',
  'return-open',
  'entering',
  'release',
  'leaving',
  'closing',
  'storing',
]);
const labels = {
  idle: '等待小牛入栏',
  waking: '等待小牛站稳',
  gathering: '旗手前往看守旁取牛',
  signal: '旗手正在示意看守开门',
  opening: '等待看守开门',
  approaching: '旗手进栏牵牛',
  hitching: '正在套好牵牛绳',
  exiting: '正在牵牛出栏',
  outbound: '正在前往水田',
  assembling: '正在田边整队',
  harnessing: '正在安装牛轭与耕索',
  ploughing: '正在耕田',
  unhitch: '正在收鞭、抬犁与解索',
  returning: '正在送牛回栏',
  'return-open': '等待看守开门接牛',
  entering: '正在牵牛入栏',
  release: '正在解开牵牛绳',
  leaving: '旗手正在退出牛栏',
  closing: '等待看守关门上锁',
  storing: '正在放回农具',
};

// The corral lends the original animal until the gate is closed again. Only
// this task updates its locomotion while borrowed; the field engine is used
// solely after every participant has physically reached the working formation.
export function createPaddyTask(
  scene,
  colliders,
  zombies,
  animals,
  corral,
  ploughSource,
  { random = Math.random } = {},
) {
  const leader = zombies.actor('pvz-flagbearer');
  const worker = zombies.addPloughman({ x: storage.x, z: storage.z - 3 });
  const parked = ploughSource.clone(true);
  parked.position.set(storage.x, ground(storage.x, storage.z), storage.z);
  scene.add(parked);
  let phase = 'idle',
    time = 0,
    remaining = PLOUGH_SECONDS,
    cow = null,
    engine = null,
    toolCollider = null,
    holster = null;
  let sound = () => false,
    car = null,
    cancel = false,
    tied = false,
    blocked = false;
  let leg = 0;
  let working = false;
  let noticePoint = null,
    leaderReleased = false;
  const trails = new Map();
  const navigator = createPaddyNavigation({
    colliders,
    leader,
    getCow: () => cow,
    getCar: () => car,
    getPhase: () => phase,
    ground,
    onBlocked: (value) => {
      blocked ||= value;
    },
  });
  const { routes, prepared, navigation, allowed, move, prepareRoute } = navigator;
  const workerFlow = createPaddyWorker({
    worker,
    leader,
    zombies,
    storage,
    wait: PLOUGH_WAIT,
    parked,
    ground,
    move,
    getEngine: () => engine,
    getCow: () => cow,
    getPhase: () => phase,
    isTied: () => tied,
    isWorking: () => working,
    getHolster: () => holster,
    getToolCollider: () => toolCollider,
  });
  const { update: updateWorker, store: storeWorker, animateTools } = workerFlow;
  const history = [];
  const setPhase = (next) => {
    phase = next;
    time = 0;
    routes.clear();
    // Field work may end far from the entry. Its old outbound trail would
    // put the calf's follow goal across the leader when heading back south.
    if (next === 'returning') trails.clear();
    if (next !== 'outbound') prepared.clear();
    navigation.pending = 0;
    leg = 0;
    recordPhase(history, next);
  };
  function follow(a, target, spacing, dt) {
    const p = point(target),
      q = point(a);
    let trail = trails.get(target);
    if (!trail) {
      trail = [
        { x: q.x, z: q.z },
        { x: p.x, z: p.z },
      ];
      trails.set(target, trail);
    }
    if (Math.hypot(p.x - trail.at(-1).x, p.z - trail.at(-1).z) > 0.025)
      trail.push({ x: p.x, z: p.z });
    // Follow the route actually cleared by the preceding body. A radial target
    // cuts inside corners and can land on a bystander, deadlocking the convoy.
    function trailPoint(distance, trim = false) {
      let end = { x: p.x, z: p.z },
        left = distance;
      for (let i = trail.length - 1; i >= 0; i--) {
        const start = trail[i],
          length = Math.hypot(end.x - start.x, end.z - start.z);
        if (length >= left) {
          const result = {
            x: end.x + ((start.x - end.x) * left) / length,
            z: end.z + ((start.z - end.z) * left) / length,
          };
          if (trim && i > 1) trail.splice(0, i - 1);
          return result;
        }
        left -= length;
        end = start;
      }
      return trail[0];
    }
    let goal = trailPoint(spacing);
    if (!allowed(a, goal.x, goal.z)) {
      // Patrols may enter a previously cleared trail. Pick a nearby safe follow
      // point rather than endlessly searching to an occupied destination.
      const minimum = radius(a) + radius(target) + 0.15;
      const candidates = [-0.2, -0.4, -0.8, 0.2, 0.4, 0.8, 1.6, 2.4].map((offset) =>
        trailPoint(Math.max(minimum, spacing + offset)),
      );
      const dx = p.x - goal.x,
        dz = p.z - goal.z,
        length = Math.hypot(dx, dz) || 1;
      for (const side of [0.4, -0.4, 0.8, -0.8])
        candidates.push({ x: goal.x + (dz * side) / length, z: goal.z - (dx * side) / length });
      // A tight detour can fold the trail back inside the leader's body.
      // Try reachable points behind him at actual body separation as well.
      const behind = Math.atan2(q.x - p.x, q.z - p.z);
      for (const offset of [0, 0.3, -0.3, 0.6, -0.6])
        candidates.push({
          x: p.x + Math.sin(behind + offset) * Math.max(minimum, spacing),
          z: p.z + Math.cos(behind + offset) * Math.max(minimum, spacing),
        });
      goal = candidates.find((candidate) => allowed(a, candidate.x, candidate.z)) ?? goal;
    }
    trailPoint(spacing + 5, true);
    const gap = Math.hypot(goal.x - q.x, goal.z - q.z);
    return move(a, goal, dt, Math.min(1.05, gap * 3), undefined, true);
  }
  function convoy(goal, dt) {
    const lp = point(leader),
      distance = Math.hypot(lp.x - cow.x, lp.z - cow.z);
    const crossing = lp.x > 118 && lp.x < 144;
    // Yield only to a vehicle occupying, or approaching, the crossing.
    // A fast car going away or driving elsewhere must not stop the task.
    const traffic =
      crossing &&
      car &&
      Array.from({ length: 13 }, (_, i) => i / 12).some((t) => {
        const speed = THREE.MathUtils.clamp(car.speed ?? 0, -12, 24);
        const x = car.x + Math.sin(car.heading ?? 0) * speed * t * 1.2;
        const z = car.z + Math.cos(car.heading ?? 0) * speed * t * 1.2;
        return vehicleObstacleGap(x, z, car.heading ?? 0, { x: 130, z: 20, radius: 2.5 }) < 0.4;
      });
    if (traffic && routes.has(leader)) routes.get(leader).speed = 0;
    const arrived =
      move(
        leader,
        goal,
        dt,
        traffic ? 0 : 1.05 * THREE.MathUtils.smoothstep(4.2 - distance, 0, 0.8),
      ) && Math.hypot(lp.x - goal.x, lp.z - goal.z) < 0.05;
    if (traffic) blocked = true;
    follow(cow, leader, 2.85, dt);
    return arrived && distance < 3.1;
  }
  function availability() {
    if (phase !== 'idle') return '耕田任务正在进行';
    const a = animals.animal('hornless-calf');
    return (
      corral.ploughAvailability(a) ||
      (leader.scripted || leader.seated ? '旗手正忙' : '') ||
      (worker.scripted || worker.seated ? '扶犁工正忙' : '')
    );
  }
  function cleanup() {
    holster?.dispose();
    holster = null;
    engine?.dispose();
    engine = null;
    toolCollider = null;
    cow = null;
    blocked = false;
    tied = workerFlow.state.carrying = working = false;
    parked.visible = true;
    zombies.release(leader.layout.id);
    zombies.release(worker.layout.id);
    workerFlow.state.phase = 'idle';
    setPhase('idle');
  }
  const api = {
    progress: () =>
      snapshotData({
        phase,
        remaining,
        blocked,
        carrying: workerFlow.state.carrying,
        workerPhase: workerFlow.state.phase,
        holster: holster?.snapshot(),
        history: [...history],
        positions: [
          cow && [cow.x, cow.z],
          leader.object.position.toArray(),
          worker.object.position.toArray(),
        ],
        routes: navigator.snapshotRoutes(),
        navigation: { ...navigation },
      }),
    get cow() {
      return cow;
    },
    leader,
    worker,
    availability,
    start() {
      if (availability()) return false;
      const a = animals.animal('hornless-calf');
      if (!corral.reservePlough(a)) return false;
      cow = a;
      remaining = PLOUGH_SECONDS;
      cancel = false;
      tied = workerFlow.state.carrying = working = false;
      zombies.take(leader.layout.id);
      zombies.take(worker.layout.id);
      workerFlow.state.phase = 'preparing';
      workerFlow.state.toolBlend = 0;
      leaderReleased = false;
      const guard = zombies.actor('pvz-gatekeeper').object.position;
      noticePoint = {
        x: Math.min(guard.x - 3, CORRAL.x - CORRAL.gateWidth / 2 - 4.8),
        z: Math.min(guard.z - 2.5, gateZ - 4.7),
      };
      trails.clear();
      prepared.clear();
      setPhase('waking');
      return true;
    },
    stop() {
      if (phase === 'idle' || returning.has(phase)) return false;
      cancel = true;
      if (phase === 'ploughing') {
        engine.stop();
        working = false;
        setPhase('unhitch');
      } else if (engine) storeWorker();
      return true;
    },
    connectAudio(fn) {
      sound = fn;
      engine?.connectAudio(fn);
    },
    status() {
      return phase === 'idle'
        ? availability() || '小牛已入栏，可以开始耕田'
        : `${blocked ? '通道受阻，等待通行 · ' : ''}${labels[phase]}${phase === 'ploughing' ? ` · 剩余 ${Math.ceil(remaining)} 秒` : ''}`;
    },
    snapshot() {
      return snapshotData({
        ...engine?.snapshot(),
        phase,
        remaining,
        cancel,
        tied,
        carrying: workerFlow.state.carrying,
        blocked,
        history: [...history],
        active: phase !== 'idle',
        canStop: phase !== 'idle' && !returning.has(phase),
        calfId: cow?.instanceId,
        task: api.progress(),
      });
    },
    update(dt, player, camera) {
      car = player;
      if (!(dt > 0) || phase === 'idle') return;
      dt = Math.min(dt, 0.1);
      blocked = false;
      navigator.beginFrame();
      if (phase === 'ploughing') {
        engine.props.whip.mesh.visible = engine.props.handle.visible = true;
        engine.update(dt, car, camera);
        const s = engine.progress();
        blocked = s.blocked;
        if (!s.blocked) remaining = Math.max(0, remaining - dt);
        if (!remaining || cancel) {
          engine.stop();
          working = false;
          setPhase('unhitch');
        }
        return;
      }
      time += dt;
      const gate = corral.gateState();
      if (phase === 'waking') {
        if (!engine) {
          engine = createPaddyPloughing(scene, colliders, zombies, cow.source, {
            existingCow: cow,
            cowId: cow.id,
            cowScale: cow.scale,
            ploughSource,
            random,
          });
          engine.connectAudio(sound);
          engine.props.plough.position.set(storage.x, ground(storage.x, storage.z), storage.z);
          engine.props.plough.visible = false;
          holster = createWhipHolster(
            engine.props.plough.parent,
            worker,
            engine.props.whip,
            engine.props.handle,
          );
          toolCollider = colliders.find((c) => c.ploughing && c !== cow.collider && !c.zombie);
          if (toolCollider) toolCollider.ploughTool = true;
        }
        if (cancel) {
          storeWorker();
          setPhase('closing');
        } else if (corral.ploughReady(cow)) setPhase('gathering');
      } else if (phase === 'gathering') {
        if (cancel) {
          storeWorker();
          setPhase('closing');
          return;
        }
        const readyCow = move(cow, { x: CORRAL.x, z: CORRAL.z + 0.5 }, dt, 0.42, Math.PI);
        const l = move(leader, noticePoint, dt);
        if (l && readyCow) {
          if (cancel) setPhase('closing');
          else {
            setPhase('signal');
          }
        }
      } else if (phase === 'signal') {
        if (cancel) {
          storeWorker();
          setPhase('closing');
          return;
        }
        const guard = zombies.actor('pvz-gatekeeper').object.position;
        move(
          leader,
          point(leader),
          dt,
          0,
          Math.atan2(guard.x - leader.object.position.x, guard.z - leader.object.position.z),
        );
        move(cow, cow, dt);
        leader.rig.workGrip(
          'Left',
          leader.object.localToWorld(
            new THREE.Vector3(0.35, 1.45, 0.4).divideScalar(leader.object.scale.x),
          ),
          dt,
        );
        if (time > 1) {
          corral.prepareGate(true);
          setPhase('opening');
        }
      } else if (phase === 'opening') {
        const aligned = move(leader, { x: CORRAL.x, z: gateZ - 6.2 }, dt);
        if (
          aligned &&
          gate.gateAmount > 0.99 &&
          ['idle', 'returning'].includes(gate.gateOperation.stage)
        )
          setPhase('approaching');
      } else if (phase === 'approaching') {
        const target = { x: CORRAL.x, z: Math.max(gateZ + 0.4, cow.z - 1.35) };
        if (move(leader, target, dt, 0.8)) setPhase('hitching');
        move(cow, { x: cow.x, z: cow.z }, dt);
      } else if (phase === 'hitching') {
        move(leader, point(leader), dt);
        move(cow, cow, dt);
        const nose = engine.props.nose();
        leader.rig.workGrip('Left', nose, dt);
        if (time > 1.1 && leader.rig.gripPoint('Left').distanceTo(nose) < 0.22) {
          tied = true;
          setPhase('exiting');
        }
      } else if (phase === 'exiting') {
        if (convoy({ x: CORRAL.x, z: gateZ - 8.5 }, dt) && cow.z < gateZ - 3) {
          corral.prepareGate(false);
          setPhase(cancel ? 'returning' : 'outbound');
        }
      } else if (phase === 'outbound') {
        const formation = engine.formation();
        const goals = [{ x: 144, z: 16 }, { x: 118, z: 20 }, formation.leader];
        const arrived = convoy(goals[leg], dt);
        // Use spare budget while walking for the next leg, avoiding a new
        // planning stop when the convoy reaches a road-crossing waypoint.
        if (leg + 1 < goals.length) prepareRoute(goals[leg], goals[leg + 1], dt);
        if (arrived && ++leg === goals.length) setPhase('assembling');
        if (cancel) {
          storeWorker();
          setPhase('returning');
        }
      } else if (phase === 'assembling') {
        if (workerFlow.state.phase === 'idle') {
          workerFlow.state.phase = 'preparing';
          zombies.take(worker.layout.id);
        }
        const formation = engine.formation();
        const c = move(cow, formation.cow, dt, 0.65, formation.cow.heading);
        const w = workerFlow.state.phase === 'ready';
        const l = move(leader, formation.leader, dt, 1, formation.leader.heading);
        if (c && w && l) {
          workerFlow.state.carrying = false;
          workerFlow.state.toolBlend = 0;
          setPhase('harnessing');
        }
        if (cancel) {
          storeWorker();
          setPhase('returning');
        }
      } else if (phase === 'harnessing') {
        const form = engine.formation();
        move(cow, form.cow, dt, 0, form.cow.heading);
        move(leader, form.leader, dt, 0, form.leader.heading);
        move(worker, form.worker, dt, 0, form.worker.heading);
        // Smooth lowering before the field engine takes over at identical roots.
        const target = engine.toolTarget();
        engine.props.plough.position.lerp(
          new THREE.Vector3(target.x, ground(target.x, target.z), target.z),
          Math.min(1, dt * 5),
        );
        engine.props.plough.rotation.set(0, target.heading, 0, 'YXZ');
        engine.props.plough.updateMatrixWorld(true);
        worker.rig.workGrip('Left', engine.props.grip(), dt);
        if (time > 1.5) {
          working = true;
          workerFlow.state.phase = 'working';
          engine.begin();
          setPhase(cancel ? 'unhitch' : 'ploughing');
        }
      } else if (phase === 'unhitch') {
        move(cow, cow, dt);
        move(leader, point(leader), dt);
        move(worker, point(worker), dt);
        workerFlow.state.carrying = true;
        workerFlow.state.toolBlend = Math.min(1, time / 1.2);
        if (time > 1.5) {
          storeWorker();
          setPhase('returning');
        }
      } else if (phase === 'returning') {
        const goals = cow.x < 141 ? [{ x: 118, z: 20 }, { x: 144, z: 16 }, outside] : [outside];
        // Keep the selected return itinerary stable as the convoy crosses the road.
        const goal = leg === 0 && cow.x < 141 ? goals[0] : leg === 1 ? { x: 144, z: 16 } : outside;
        if (convoy(goal, dt) && (goal === outside || ++leg >= 3)) {
          corral.prepareGate(true);
          setPhase('return-open');
        }
      } else if (phase === 'return-open') {
        move(leader, point(leader), dt);
        move(cow, cow, dt);
        if (gate.gateAmount > 0.99 && ['idle', 'returning'].includes(gate.gateOperation.stage))
          setPhase('entering');
      } else if (phase === 'entering') {
        // Leader clears the centre for the calf; the worker stays at the field.
        const l = move(leader, { x: CORRAL.x - 1.9, z: CORRAL.z + 0.5 }, dt, 0.9);
        if (leader.object.position.z > gateZ + 1)
          move(cow, { x: CORRAL.x + 2.5, z: CORRAL.z + 1.7 }, dt, 0.8);
        else follow(cow, leader, 2.85, dt);
        if (l && Math.hypot(cow.x - CORRAL.x - 2.5, cow.z - CORRAL.z - 1.7) < 0.05)
          setPhase('release');
      } else if (phase === 'release') {
        move(cow, cow, dt);
        move(leader, point(leader), dt);
        if (time > 1) {
          tied = false;
          setPhase('leaving');
        }
      } else if (phase === 'leaving') {
        move(cow, cow, dt);
        if (move(leader, outside, dt)) {
          corral.prepareGate(false);
          zombies.release(leader.layout.id);
          leaderReleased = true;
          setPhase('closing');
        }
      } else if (phase === 'closing') {
        move(cow, cow, dt);
        if (!leaderReleased) {
          zombies.release(leader.layout.id);
          leaderReleased = true;
        }
        corral.prepareGate(false);
        if (
          gate.gateAmount === 0 &&
          ['idle', 'returning'].includes(gate.gateOperation.stage) &&
          corral.finishPlough(cow)
        ) {
          tied = false;
          storeWorker();
          setPhase('storing');
        }
      } else if (phase === 'storing') {
        if (workerFlow.state.phase === 'idle') cleanup();
      }
      updateWorker(dt);
      animateTools(dt);
      navigator.finishFrame();
    },
  };
  return api;
}

export async function addPaddyTask(scene, colliders, zombies, warnings, animals, corral) {
  if (!corral || !zombies?.actor('pvz-flagbearer')) return null;
  try {
    const asset = await new GLTFLoader().loadAsync(assetUrl('paddy-plough'));
    return createPaddyTask(scene, colliders, zombies, animals, corral, asset.scene);
  } catch (error) {
    warnings.push('paddy-ploughing');
    console.warn('耕田农具未能加载', error);
    return null;
  }
}
