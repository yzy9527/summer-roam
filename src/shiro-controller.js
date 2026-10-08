import * as THREE from 'three';
import { createAnimalAnimation, solveCowLeg } from './animal-animation.js';
import { SHIRO_PROFILE } from './animal-profiles.js';
import { actorPointAllowed, clearSegment, actorRoute } from './actor-navigation.js';
import { drivingHeight } from './world-queries.js';
import { aimJoint } from './character-animation.js';
import { NOHARA_HOUSE_SITE } from './nohara-house-site.js';

const X = new THREE.Vector3(1, 0, 0);
// Cover all four sides of the house, rather than a circle at the front door.
export const SHIRO_ROAM = Object.freeze({
  x: NOHARA_HOUSE_SITE.x,
  z: NOHARA_HOUSE_SITE.z,
  halfWidth: NOHARA_HOUSE_SITE.width / 2 + 4,
  halfDepth: NOHARA_HOUSE_SITE.depth / 2 + 4,
});
export function createShiroController(
  actor,
  colliders,
  groundHeight = drivingHeight,
  random = Math.random,
) {
  const { object, source, collider } = actor;
  const bone = (name) => source.getObjectByName(name.replaceAll('.', ''));
  const profile = SHIRO_PROFILE;
  const rig = createAnimalAnimation(source, object, profile);
  if (!rig) throw new Error('小白四足骨骼适配失败');
  const home = { x: SHIRO_ROAM.x, z: SHIRO_ROAM.z },
    range = Math.hypot(SHIRO_ROAM.halfWidth, SHIRO_ROAM.halfDepth);
  const state = {
    x: object.position.x,
    z: object.position.z,
    heading: object.rotation.y,
    scale: 1,
    radius: 0.3,
    collider,
    clock: 0,
    distance: 0,
    velocity: 0,
    chargeRun: 0,
    look: 0,
    gestureType: 0,
    supportHeight: groundHeight,
    behavior: { down: 0, raised: 0, reactionTime: 10, swishTime: 2 },
  };
  const body = source.getObjectByName('Body'),
    head = source.getObjectByName('Head');
  source.updateMatrixWorld(true);
  // Crown attachment in the supplied model's bind pose, rather than the neck joint.
  const crownLocal = head.worldToLocal(object.localToWorld(new THREE.Vector3(0, 0.57, 0.27)));
  const legs = ['Front.L', 'Front.R', 'Hind.L', 'Hind.R'].map((name) => {
    const upper = bone(name + '.Upper'),
      lower = bone(name + '.Lower'),
      paw = bone(name + '.Paw');
    const hip = upper.getWorldPosition(new THREE.Vector3()),
      knee = lower.getWorldPosition(new THREE.Vector3()),
      foot = paw.getWorldPosition(new THREE.Vector3());
    return {
      name,
      upper,
      lower,
      paw,
      l1: hip.distanceTo(knee),
      l2: knee.distanceTo(foot),
      foot: object.worldToLocal(foot),
      footQ: object
        .getWorldQuaternion(new THREE.Quaternion())
        .invert()
        .multiply(paw.getWorldQuaternion(new THREE.Quaternion())),
    };
  });
  let activity = 'idle',
    wait = 2,
    route = [],
    called = false,
    running = false,
    poseAmount = 0,
    poseKind = 'sit',
    greeting = 0,
    footSteps = 0,
    events = [],
    lastSteps = 0,
    blocked = false;
  const allowed = (x, z, car) =>
    Math.abs(x - home.x) <= SHIRO_ROAM.halfWidth &&
    Math.abs(z - home.z) <= SHIRO_ROAM.halfDepth &&
    actorPointAllowed(x, z, state, colliders, car, { home, range, avoidRoad: true });
  function plan(goal, car) {
    route = actorRoute(state, goal, (x, z) => allowed(x, z, car), home, range) ?? [];
    return route.length > 0;
  }
  function settle(kind, duration) {
    activity = kind;
    wait = duration;
    route = [];
    running = false;
  }
  function face(target, dt) {
    const desired = Math.atan2(target.x - state.x, target.z - state.z);
    const error = Math.atan2(Math.sin(desired - state.heading), Math.cos(desired - state.heading));
    state.heading += THREE.MathUtils.clamp(error, -dt * 2.2, dt * 2.2);
    return error;
  }
  function applyPosture() {
    if (poseAmount < 0.001) return;
    const lying = poseKind === 'lie',
      stretching = poseKind === 'stretch';
    body.position.y -= poseAmount * (lying ? 0.105 : stretching ? 0.025 : 0.075);
    body.quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(
        X,
        poseAmount * (lying ? 0 : stretching ? 0.18 : -0.3),
      ),
    );
    head.quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(X, poseAmount * (lying ? 0.16 : -0.08)),
    );
    object.updateMatrixWorld(true);
    for (const leg of legs) {
      const front = leg.name.startsWith('Front');
      const local = leg.foot.clone();
      local.z +=
        poseAmount *
        (stretching ? (front ? 0.1 : -0.02) : lying ? (front ? 0.085 : -0.025) : front ? 0 : 0.055);
      const target = object.localToWorld(local);
      target.y = groundHeight(target.x, target.z) + leg.foot.y;
      const hip = leg.upper.getWorldPosition(new THREE.Vector3());
      const hint = new THREE.Vector3(0, -0.25, front ? -1 : 1).applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        state.heading,
      );
      const knee = solveCowLeg(hip, target, leg.l1, leg.l2, hint);
      aimJoint(leg.upper, leg.lower, knee);
      aimJoint(leg.lower, leg.paw, target);
      const q = object.getWorldQuaternion(new THREE.Quaternion()).multiply(leg.footQ);
      leg.paw.quaternion.copy(
        leg.paw.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q),
      );
      leg.paw.updateWorldMatrix(false, true);
    }
  }
  return {
    state,
    headPoint: () => {
      object.updateMatrixWorld(true);
      return head.localToWorld(crownLocal.clone());
    },
    call(player, car) {
      if (activity === 'pet' || called) return 'busy';
      if (Math.hypot(player.x - state.x, player.z - state.z) > 18) return 'far';
      for (const offset of [0, 0.8, -0.8, 1.6, -1.6, Math.PI]) {
        const angle = Math.atan2(state.x - player.x, state.z - player.z) + offset;
        const goal = { x: player.x + Math.sin(angle) * 1, z: player.z + Math.cos(angle) * 1 };
        if (plan(goal, car)) {
          called = true;
          running = true;
          activity = 'run';
          greeting = 0;
          events.push('bark');
          return 'coming';
        }
      }
      return 'blocked';
    },
    pet(player) {
      if (
        activity === 'pet' ||
        Math.hypot(player.x - state.x, player.z - state.z) > 1.25 ||
        player.jumpPhase !== 'ground'
      )
        return false;
      called = false;
      settle('pet', 2.6);
      greeting = 2.6;
      state.behavior.swishTime = 0;
      events.push('whine');
      return true;
    },
    cancelInteraction() {
      if (activity === 'pet') settle('idle', 1);
    },
    update(dt, player, car) {
      if (!(dt > 0)) return;
      state.clock += dt;
      wait -= dt;
      greeting = Math.max(0, greeting - dt);
      state.behavior.swishTime += dt;
      blocked = false;
      if (activity === 'pet') {
        face(player, dt);
        if (player.petTime > 0 || player.petApproach) wait = Math.max(wait, 0.3);
      }
      if (route.length && poseAmount < 0.04) {
        const goal = route[0],
          distance = Math.hypot(goal.x - state.x, goal.z - state.z);
        if (distance < 0.035) {
          route.shift();
          if (!route.length) {
            if (called) {
              settle('greeting', 2);
              greeting = 2;
              state.behavior.swishTime = 0;
              events.push('bark');
            } else settle('idle', 2 + random() * 3);
            called = false;
          }
        } else {
          const turn = face(goal, dt),
            remaining = route.reduce(
              (n, p, i) =>
                n +
                Math.hypot(
                  p.x - (i ? route[i - 1].x : state.x),
                  p.z - (i ? route[i - 1].z : state.z),
                ),
              0,
            );
          const speed =
            (running ? 1.65 : 0.48) * Math.max(0, Math.cos(turn)) * Math.min(1, remaining / 0.65);
          state.velocity = THREE.MathUtils.damp(state.velocity, speed, 6, dt);
          const step = Math.min(distance, state.velocity * dt);
          const next = {
            x: state.x + ((goal.x - state.x) / distance) * step,
            z: state.z + ((goal.z - state.z) / distance) * step,
          };
          if (clearSegment(state, next, (x, z) => allowed(x, z, car))) {
            state.x = next.x;
            state.z = next.z;
            state.distance += step;
          } else {
            blocked = true;
            settle('waiting', 1);
            called = false;
            state.velocity = 0;
          }
        }
      } else state.velocity = THREE.MathUtils.damp(state.velocity, 0, 12, dt);
      if (!route.length && wait <= 0) {
        if (activity === 'lie') settle('stretch', 1.8);
        else if (['sit', 'stretch', 'pet', 'greeting'].includes(activity)) settle('idle', 1.5);
        else {
          const choice = random();
          if (choice < 0.18) settle('sit', 3 + random() * 3);
          else if (choice < 0.3) settle('lie', 4 + random() * 4);
          else if (choice < 0.48) settle('sniff', 2.5);
          else if (choice < 0.58) settle('watch', 2.5);
          else {
            for (let i = 0; i < 12; i++) {
              const side = Math.floor(random() * 4),
                offset = random() * 2 - 1,
                inset = random() * 1.2;
              const goal =
                side < 2
                  ? {
                      x: home.x + (side === 0 ? 1 : -1) * (SHIRO_ROAM.halfWidth - inset),
                      z: home.z + offset * SHIRO_ROAM.halfDepth,
                    }
                  : {
                      x: home.x + offset * SHIRO_ROAM.halfWidth,
                      z: home.z + (side === 2 ? 1 : -1) * (SHIRO_ROAM.halfDepth - inset),
                    };
              if (plan(goal, car)) {
                running = random() < 0.22;
                activity = running ? 'run' : 'walk';
                break;
              }
            }
            if (!route.length) settle('waiting', 1.5);
          }
        }
      }
      const resting = ['sit', 'lie', 'stretch'].includes(activity);
      if (resting) poseKind = activity;
      poseAmount = THREE.MathUtils.damp(poseAmount, resting ? 1 : 0, 5, dt);
      object.position.set(state.x, groundHeight(state.x, state.z), state.z);
      object.rotation.y = state.heading;
      Object.assign(collider, { x: state.x, z: state.z });
      state.chargeRun = THREE.MathUtils.damp(
        state.chargeRun,
        route.length && running && state.velocity > 0.65 ? 1 : 0,
        7,
        dt,
      );
      state.behavior.down =
        activity === 'sniff' ? Math.sin(Math.PI * Math.min(1, Math.max(0, (2.5 - wait) / 2.5))) : 0;
      state.behavior.raised = ['watch', 'greeting', 'pet'].includes(activity) ? 0.7 : 0;
      state.look =
        activity === 'watch' ? Math.sin(state.clock) * 0.4 : activity === 'greeting' ? 0.25 : 0;
      rig.update(dt, state, 0, activity === 'watch' || greeting > 0 ? 1 : 0);
      applyPosture();
      if (greeting > 0) {
        bone('Tail.01').quaternion.multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1),
            Math.sin(state.clock * 15) * 0.25,
          ),
        );
      }
      const steps = rig.snapshot().legs.reduce((n, leg) => n + leg.steps, 0);
      if (steps > lastSteps) {
        footSteps += steps - lastSteps;
        events.push('pawstep');
      }
      lastSteps = steps;
      object.updateMatrixWorld(true);
    },
    events: () => events.splice(0),
    snapshot: () => ({
      x: state.x,
      z: state.z,
      heading: state.heading,
      activity,
      called,
      blocked,
      velocity: state.velocity,
      poseAmount,
      route: route.map((p) => ({ ...p })),
      footSteps,
      rig: rig.snapshot(),
    }),
  };
}
