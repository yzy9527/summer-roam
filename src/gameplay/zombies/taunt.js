import * as THREE from 'three';
import { animalPathSearch } from '../../corral-navigation.js';
import { message } from '../../messages.js';

const SMALL = 'pvz-browncoat',
  GIANT = 'pvz-gargantuar';
const smooth = (t) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function tauntPose(time, hurt = false) {
  const wave = Math.sin(time * (hurt ? 13 : 6));
  return {
    amount: 1,
    hips: [0, hurt ? -0.035 : 0, 0],
    head: [hurt ? 0.28 : -0.12, wave * (hurt ? 0.2 : 0.3), wave * 0.12],
    spine: [hurt ? 0.2 : -0.06, 0, wave * 0.045],
    left: hurt ? [0.08, 0.32, 0.12] : [0.27, -0.04 + wave * 0.07, 0.32],
    right: hurt ? [-0.08, 0.32, 0.12] : [-0.22, 0.12 + wave * 0.13, 0.38],
    jaw: hurt ? 0.2 : 0.13,
    curl: hurt ? 0.15 : 0.6,
    steps: 0,
  };
}

// One short two-actor lease. Other giant tasks check socialOwner before starting.
export function createZombieTaunt(
  zombies,
  ground,
  externalFree = () => true,
  idlePatrol = () => false,
) {
  const small = zombies.actor(SMALL),
    giant = zombies.actor(GIANT);
  let phase = 'idle',
    time = 0,
    age = 0,
    cooldown = 0,
    contacts = 0;
  let goal = null,
    route = [],
    search = null,
    blocked = 0,
    retreat = null,
    outcome = '';
  const busy = () => phase !== 'idle';
  function set(next) {
    phase = next;
    time = 0;
    blocked = 0;
  }
  function release(actor) {
    if (actor?.socialOwner !== 'taunt') return;
    actor.rig.finishComedy(ground);
    delete actor.socialOwner;
    zombies.release(actor.layout.id);
  }
  function finish(result) {
    release(small);
    release(giant);
    outcome = result;
    search = null;
    route = [];
    goal = null;
    cooldown = result === 'complete' ? 60 : 3;
    set('idle');
  }
  function availability() {
    if (!small || !giant || giant.collider.radius > 1.2) return message('actions.tauntNotReady');
    if (
      !externalFree() ||
      busy() ||
      small.scripted ||
      (giant.scripted && !idlePatrol()) ||
      small.seated ||
      giant.seated ||
      small.socialOwner ||
      giant.socialOwner ||
      zombies.comedyAvailability()
    )
      return message('actions.tauntBusy');
    if (cooldown > 0) return message('actions.tauntCooldown');
    if (gap(small.object.position, giant.object.position) > 24)
      return message('actions.tauntTooFar');
    return '';
  }
  function allowed(x, z, car) {
    return zombies.canStand(SMALL, { x, z }, car);
  }
  function plan(car) {
    search = animalPathSearch(small.object.position, goal, (x, z) => allowed(x, z, car), {
      step: 0.5,
      padding: 4,
    });
    route = [];
  }
  function chooseGoal(car) {
    const crown = small.object.worldToLocal(small.rig.headTopPoint());
    for (const radius of [1.9, 1.93, 1.96])
      for (const side of [Math.PI / 2, 1.35, 1.75, 1.2, 1.9]) {
        const angle = giant.object.rotation.y + side;
        const p = {
          x: giant.object.position.x + Math.sin(angle) * radius,
          z: giant.object.position.z + Math.cos(angle) * radius,
        };
        if (!allowed(p.x, p.z, car)) continue;
        const predicted = crown
          .clone()
          .multiplyScalar(small.layout.scale)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle + Math.PI)
          .add(new THREE.Vector3(p.x, ground(p.x, p.z), p.z));
        if (!giant.rig.canPatHead(predicted)) continue;
        goal = p;
        return true;
      }
    return false;
  }
  function navigate(dt, car, backwards = false) {
    if (search) {
      // Bound planning work per display frame, including obstacle samples.
      for (let i = 0; i < 80; i++) {
        const result = search.next();
        if (!result.done) continue;
        search = null;
        route = result.value ?? [];
        if (!route.length) finish('blocked');
        break;
      }
      return false;
    }
    if (!route.length) return true;
    const target = route[0];
    const arrived = zombies.walk(SMALL, target, dt, {
      speed: backwards ? 0.75 : 1.8,
      run: !backwards,
      car,
      alignBeforeMove: !backwards,
      ...(backwards
        ? {
            facingHeading: Math.atan2(
              giant.object.position.x - small.object.position.x,
              giant.object.position.z - small.object.position.z,
            ),
          }
        : {}),
    });
    blocked = small.blocked ? blocked + dt : 0;
    if (arrived) route.shift();
    if (blocked > 0.8) {
      plan(car);
      blocked = 0;
    }
    return !route.length && !search;
  }
  return {
    availability,
    start(car) {
      if (availability()) return false;
      small.socialOwner = giant.socialOwner = 'taunt';
      zombies.take(SMALL);
      zombies.take(GIANT);
      // Freeze the giant's existing step before selecting its reachable hand side.
      age = 0;
      contacts = 0;
      outcome = '';
      set('settle-giant');
      return true;
    },
    cancel() {
      if (!busy()) return false;
      finish('cancelled');
      return true;
    },
    get active() {
      return busy();
    },
    update(dt, car) {
      if (!(dt > 0)) return;
      cooldown = Math.max(0, cooldown - dt);
      if (!busy()) return;
      time += dt;
      age += dt;
      if (age > 45 || (['approach', 'settle-giant'].includes(phase) && time > 25)) {
        finish('timeout');
        return;
      }
      if (phase === 'settle-giant') {
        const bigReady = giant.rig.settleComedy(dt, ground);
        const smallReady = small.rig.settleComedy(dt, ground);
        if (bigReady && smallReady) {
          if (!chooseGoal(car)) {
            finish('no-space');
            return;
          }
          plan(car);
          set('approach');
        }
        return;
      }
      if (phase === 'approach') {
        giant.rig.socialLook(dt, 0.45, 0.02);
        if (navigate(dt, car)) set('face');
      } else if (phase === 'face') {
        giant.rig.socialLook(dt, 0.65, 0.04);
        if (
          zombies.face(SMALL, giant.object.position, dt, car) &&
          small.rig.settleComedy(dt, ground)
        )
          set('taunting');
        if (time > 5) finish('blocked');
      } else if (phase === 'taunting') {
        giant.rig.socialLook(dt, 0.7, 0.03);
        small.rig.comedy(tauntPose(time), time);
        if (time > 2.6) set('stare');
      } else if (phase === 'stare') {
        giant.rig.socialLook(dt, 0.9, 0.1);
        small.rig.comedy(tauntPose(time + 2.6), time);
        if (time > 0.8) {
          small.rig.finishComedy();
          set('windup');
        }
      } else if (
        phase === 'windup' ||
        phase === 'tap' ||
        phase === 'recoil' ||
        phase === 'retract'
      ) {
        const isRecoil = phase === 'recoil',
          isRetract = phase === 'retract';
        giant.rig.socialLook(dt, 0.85, 0.07);
        if (isRecoil) small.rig.acknowledgePat(Math.sin(Math.PI * Math.min(1, time / 0.5)), dt);
        else if (isRetract) small.rig.comedy(tauntPose(time, true), time);
        else small.rig.socialLook(dt, 0, 0);
        const crown = small.rig.headTopPoint(),
          target = crown.clone();
        let reach = 1;
        if (phase === 'windup') {
          const t = smooth(time / 0.55);
          target.y += 0.32 * (1 - t);
          reach = smooth(time / 0.35);
        }
        if (isRetract) {
          const t = smooth(time / 0.5);
          target.y += t * 0.3;
          reach = 1 - t;
        }
        giant.rig.patHead(target, reach, dt);
        if (phase === 'windup' && time >= 0.55) set('tap');
        else if (phase === 'tap') {
          if (giant.rig.patPalmPoint().distanceTo(crown) < 0.08) {
            contacts++;
            set('recoil');
          } else if (time > 0.6) finish('missed');
        } else if (isRecoil && time >= 0.5) set('retract');
        else if (isRetract && time >= 0.5) {
          release(giant);
          const from = small.object.position,
            away = from.clone().sub(giant.object.position).setY(0).normalize();
          retreat = from.clone().addScaledVector(away, 1.5);
          goal = { x: retreat.x, z: retreat.z };
          plan(car);
          set('retreat');
        }
      } else if (phase === 'retreat') {
        const arrived = navigate(dt, car, true);
        if (busy()) small.rig.comedy(tauntPose(time, true), time, true);
        if (arrived) finish('complete');
        else if (time > 7) finish('complete');
      }
    },
    snapshot: () => ({
      active: busy(),
      phase,
      time,
      age,
      cooldown,
      contacts,
      outcome,
      goal: goal ? { ...goal } : null,
    }),
  };
}
