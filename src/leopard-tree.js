import * as THREE from 'three';
import { animalPathSearch } from './corral-navigation.js';
import { landscapeHeight } from './world-queries.js';
import { TREE_VISIT } from './leopard-tree-site.js';

const angle = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const ease = (t) => t * t * (3 - 2 * t);
// One state source holds the same leopard through ground travel, climbing,
// lookout/rest and safe descent. Day/night changes never restart a visit.
export function createLeopardTree(animals, tree, safe, random = Math.random) {
  const a = animals.find((a) => a.id === 'baola-leopard');
  let phase = 'idle',
    path = [],
    search = null,
    retry = 0,
    nextVisit = drawInterval(),
    phaseTime = 0;
  let s = 0.55,
    rest = 0,
    restTime = 0,
    blocked = 0,
    visits = 0,
    draws = 0;
  let gate = () => true,
    home = null,
    direction = 1,
    yaw = 0,
    jump = null;
  function drawInterval() {
    return TREE_VISIT.intervalMin + random() * (TREE_VISIT.intervalMax - TREE_VISIT.intervalMin);
  }
  function clear(p, q, car, entry = false) {
    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.1));
    for (let i = 0; i <= n; i++)
      if (!safe(p.x + ((q.x - p.x) * i) / n, p.z + ((q.z - p.z) * i) / n, a, car, entry))
        return false;
    return true;
  }
  function setPhase(value) {
    phase = value;
    phaseTime = 0;
    a.velocity = 0;
  }
  function release() {
    setPhase('idle');
    path = [];
    search = null;
    a.target = null;
    a.velocity = 0;
    a.treeClimb = null;
    a.supportHeight = a.supportNormal = null;
    a.sleepAmount = 0;
    a.wait = 2;
    a.sleepPeriodic = true;
    Object.assign(a.behavior, {
      state: 'idle',
      time: 0,
      down: 0,
      raised: 0,
      driveTime: 0,
      escape: null,
    });
    nextVisit = drawInterval();
  }
  function route(goal, car, entry = false) {
    const allowed = safe.snapshot?.(a, car, entry) ?? ((x, z) => safe(x, z, a, car, entry));
    return animalPathSearch({ x: a.x, z: a.z }, goal, allowed, { step: 0.6, padding: 5 });
  }
  function start(car) {
    if (api.interruptible(a)) api.interruptReturn(a);
    if (
      !a?.rig ||
      !tree ||
      phase !== 'idle' ||
      !gate() ||
      a.collisionEscape ||
      a.behavior.driveTime > 0 ||
      a.behavior.state === 'alert'
    )
      return false;
    // The controlled approach reaches the bark; other obstacles retain their margins.
    if (!safe(tree.entry.x, tree.entry.z, a, car, true)) return false;
    home = { x: a.homeX, z: a.homeZ };
    path = [];
    search = route(tree.entry, car, true);
    retry = 0;
    delete a.treeExit;
    blocked = 0;
    s = 0.55;
    rest = 0;
    direction = 1;
    yaw = 0;
    jump = null;
    a.target = null;
    a.recoil = null;
    a.chargeRun = 0;
    a.gesture = 0;
    Object.assign(a.behavior, { down: 0, raised: 0.35, escape: null, driveTime: 0 });
    setPhase('approaching');
    return true;
  }
  function onBranch() {
    a.supportHeight = tree.height;
    a.supportNormal = tree.normal;
    a.treeClimb = {
      ...a.treeClimb,
      tree,
      s,
      rest,
      direction,
      yaw,
      phase,
      phaseTime,
      mount: 1,
      blockedStep: a.treeClimb?.blockedStep ?? false,
    };
  }
  function groundStep(dt, car) {
    if (!path.length) return true;
    const p = path[0],
      d = Math.hypot(p.x - a.x, p.z - a.z);
    if (d < 0.05) {
      path.shift();
      return !path.length;
    }
    const desired = Math.atan2(p.x - a.x, p.z - a.z),
      error = angle(desired, a.heading);
    a.heading += THREE.MathUtils.clamp(error, -dt * 0.85, dt * 0.85);
    const speed = Math.abs(error) < 0.2 ? 0.45 * Math.min(1, d / 0.35) : 0;
    a.velocity = THREE.MathUtils.damp(a.velocity, speed, 4, dt);
    const step = Math.min(d, a.velocity * dt);
    const next = { x: a.x + Math.sin(a.heading) * step, z: a.z + Math.cos(a.heading) * step };
    if (!clear(a, next, car, true)) {
      a.velocity = 0;
      blocked += dt;
      if (blocked > 1) {
        path = [];
        search = route(phase === 'approaching' ? tree.entry : home, car, true);
        blocked = 0;
      }
      return false;
    }
    a.x = next.x;
    a.z = next.z;
    a.distance += step;
    blocked = 0;
    return false;
  }
  const api = {
    setStartGate: (fn) => {
      gate = fn;
    },
    onWakeRequest: null,
    available: (actor) => !!tree && actor === a,
    owns: (actor) => actor === a && phase !== 'idle',
    interruptible: (actor) => actor === a && phase === 'returning' && !a.treeClimb,
    interruptReturn(actor) {
      if (!api.interruptible(actor)) return false;
      release();
      a.treeExit = true;
      return true;
    },
    resumeReturn(actor) {
      if (actor !== a || phase !== 'idle' || !a.treeExit) return false;
      path = [];
      search = null;
      retry = 0;
      setPhase('returning');
      return true;
    },
    touchLocked: (actor) => actor === a && !['idle', 'approaching', 'returning'].includes(phase),
    start,
    cancelApproach() {
      if (phase === 'approaching') {
        path = [];
        search = null;
        setPhase('returning');
      }
    },
    requestDescent() {
      if (['lookout', 'resting', 'lying-down'].includes(phase)) {
        setPhase('waking');
        return true;
      }
      return false;
    },
    snapshot: () => ({
      phase,
      nextVisit,
      phaseTime,
      s,
      rest,
      remaining: restTime,
      direction,
      yaw,
      visits,
      draws,
      sheltered: api.touchLocked(a),
      tree: tree?.snapshot(),
    }),
    update(dt, car) {
      if (!a?.rig || !tree || !(dt > 0)) return;
      if (phase === 'idle') {
        nextVisit -= dt;
        if (nextVisit <= 0) {
          if (!gate()) {
            api.onWakeRequest?.();
            nextVisit = 3;
            return;
          }
          draws++;
          nextVisit = drawInterval();
          if (random() < TREE_VISIT.chance) start(car);
        }
        return;
      }
      phaseTime += dt;
      a.target = null;
      a.behavior.state = phase;
      if (phase === 'approaching' || phase === 'returning') {
        retry = Math.max(0, retry - dt);
        if (!path.length && retry === 0) {
          search ??= route(phase === 'approaching' ? tree.entry : home, car, true);
          const began = performance.now();
          for (let slices = 0; slices < 96 && performance.now() - began < 1.25; slices++) {
            const result = search.next();
            if (result.done) {
              path = result.value ?? [];
              search = null;
              if (!path.length) retry = 0.4;
              break;
            }
          }
        }
        if (!path.length && phase === 'approaching') {
          if (phaseTime > 120) {
            search = null;
            setPhase('returning');
          }
          return;
        }
        if (!path.length && phase === 'returning') {
          if (Math.hypot(a.x - home.x, a.z - home.z) < 0.12) release();
          else a.velocity = 0;
          return;
        }
        if (groundStep(dt, car)) {
          if (phase === 'returning') {
            delete a.treeExit;
            release();
            return;
          }
          setPhase('inspecting');
        }
        if (phase === 'approaching' && phaseTime > 120) {
          path = [];
          search = null;
          setPhase('returning');
        }
        return;
      }
      if (phase === 'inspecting') {
        const desired = tree.entryHeading;
        a.heading += THREE.MathUtils.clamp(angle(desired, a.heading), -dt * 0.85, dt * 0.85);
        a.behavior.down = phaseTime < 1.3 ? 0.3 * Math.sin((Math.PI * phaseTime) / 1.3) : 0;
        a.behavior.raised = 0.4;
        if (phaseTime > 2.4 && Math.abs(angle(desired, a.heading)) < 0.04) {
          setPhase('mounting');
          onBranch();
          a.treeClimb.mount = 0;
          visits++;
        }
        return;
      }
      onBranch();
      if (phase === 'mounting') {
        if (a.treeClimb.blockedStep) phaseTime -= dt;
        a.treeClimb.phaseTime = phaseTime;
        a.treeClimb.mount = ease(Math.min(1, phaseTime / 1.8));
        if (phaseTime >= 1.8) setPhase('ascending');
        return;
      }
      if (phase === 'turning') {
        // The fork supports a deliberate multi-step turn. Stop advancing yaw
        // when a planted limb needs to change grip before the body can follow.
        if (!a.treeClimb.blockedStep) yaw = Math.min(Math.PI, yaw + dt * 0.65);
        a.treeClimb.yaw = yaw;
        if (yaw === Math.PI && a.treeClimb.settled) {
          direction = -1;
          setPhase('descending');
        }
        return;
      }
      if (phase === 'jump-ready') {
        const outward = new THREE.Vector3(
          -Math.sin(tree.entryHeading),
          0,
          -Math.cos(tree.entryHeading),
        );
        const end = new THREE.Vector3(tree.entry.x, 0, tree.entry.z).addScaledVector(outward, 0.6);
        end.y = landscapeHeight(end.x, end.z) + 0.025;
        const start = a.group.position.clone();
        // Sample the whole horizontal sweep with the animal's full radius;
        // low obstacles, other animals and vehicles all retain their margins.
        const futureCar = car
          ? {
              ...car,
              x: car.x + Math.sin(car.heading ?? 0) * (car.speed ?? 0) * 0.7,
              z: car.z + Math.cos(car.heading ?? 0) * (car.speed ?? 0) * 0.7,
            }
          : car;
        if (!clear(start, end, car, true) || !clear(start, end, futureCar, true)) {
          phaseTime = 0;
          return;
        }
        if (phaseTime >= 0.45) {
          const heading = Math.atan2(outward.x, outward.z);
          jump = {
            start,
            end,
            startQ: a.group.quaternion.clone(),
            endQ: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading),
          };
          a.heading = heading;
          setPhase('jumping');
        }
        return;
      }
      if (phase === 'jumping' || phase === 'landing') {
        const t = phase === 'jumping' ? Math.min(1, phaseTime / 0.58) : 1;
        // A short release, rather than blending all four planted paws downward.
        const point = jump.start.clone().lerp(jump.end, t);
        point.y = jump.start.y + (jump.end.y - jump.start.y) * t * t + 0.12 * 4 * t * (1 - t);
        a.treeClimb.position = point;
        a.treeClimb.orientation = jump.startQ.clone().slerp(jump.endQ, ease(t));
        a.treeClimb.jumpT = t;
        a.treeClimb.landing = phase === 'landing' ? Math.min(1, phaseTime / 0.65) : 0;
        a.x = point.x;
        a.z = point.z;
        if (phase === 'jumping' && t === 1) setPhase('landing');
        else if (phase === 'landing' && phaseTime >= 0.65) {
          a.treeClimb = null;
          a.supportHeight = a.supportNormal = null;
          path = [];
          setPhase('returning');
        }
        return;
      }
      if (phase === 'ascending' || phase === 'branch-walk' || phase === 'descending') {
        const goal =
          phase === 'ascending' ? tree.restS - 0.65 : phase === 'branch-walk' ? tree.restS : 1.1;
        direction = phase === 'descending' ? -1 : 1;
        const speed = a.treeClimb.blockedStep
          ? 0
          : (direction < 0 ? 0.38 : 0.5) * (a.treeClimb.swinging ? 0.2 : 1);
        const nextS = s + direction * Math.min(Math.abs(goal - s), speed * dt);
        const p = tree.sample(nextS).point;
        // Elevated travel ignores this tree alone. Ground vehicles/actors still
        // block the low entry; a blocked descent waits on the branch, never drops.
        if (p.y - tree.group.position.y < 1.25 && !safe(p.x, p.z, a, car, true)) {
          a.velocity = 0;
          return;
        }
        const step = Math.abs(nextS - s);
        s = nextS;
        a.distance += step;
        a.velocity = step / dt;
        a.x = p.x;
        a.z = p.z;
        const f = tree.frame(s);
        a.heading = Math.atan2(f.forward.x, f.forward.z);
        if (Math.abs(goal - s) < 1e-6) {
          if (phase === 'ascending') setPhase('lookout');
          else if (phase === 'branch-walk') setPhase('lying-down');
          else {
            setPhase('jump-ready');
          }
        }
      } else if (phase === 'lookout' && phaseTime >= 5) setPhase('branch-walk');
      else if (phase === 'lying-down') {
        rest = ease(Math.min(1, phaseTime / 3));
        if (phaseTime >= 3) {
          restTime = TREE_VISIT.restMin + random() * (TREE_VISIT.restMax - TREE_VISIT.restMin);
          setPhase('resting');
        }
      } else if (phase === 'resting') {
        restTime -= dt;
        if (restTime <= 0) setPhase('waking');
      } else if (phase === 'waking') {
        rest = 1 - ease(Math.min(1, phaseTime / 2.5));
        if (phaseTime >= 2.5) {
          rest = 0;
          setPhase('turning');
        }
      }
      if (a.treeClimb) Object.assign(a.treeClimb, { s, rest, direction });
    },
  };
  return api;
}
