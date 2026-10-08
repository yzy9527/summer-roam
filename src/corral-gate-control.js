import * as THREE from 'three';
import { CORRAL } from './corral-model.js';
import { vehicleObstacleGap } from './vehicle-collision.js';

const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const MANUAL_GATE_OPEN_SECONDS = 2;

// One operator owns the complete approach, turn, reach, swing and latch action.
export function createCorralGateControl(
  model,
  zombies,
  colliders,
  {
    operator,
    home,
    routeTo,
    walkRoute,
    getCar,
    canClose,
    sound,
    beforeClose = () => true,
    cancelCloseNotice = () => {},
  },
) {
  const actor = zombies.actor(operator);
  let amount = 0,
    open = false,
    requested = null,
    stage = 'idle';
  let route = [],
    retryIn = 0,
    time = 0,
    reach = 0,
    started = null;
  let manualStart = 0,
    manualElapsed = 0,
    manualDuration = MANUAL_GATE_OPEN_SECONDS,
    returnAfterManual = false;
  function anchor(at = amount, front = 0.72) {
    return model.operatorPoint(at, front);
  }
  function swingClear(next, includeOperator = false) {
    const hinge = model.gate.position;
    const samples = Math.max(2, Math.ceil((Math.abs(next - amount) * Math.PI) / 2 / 0.04));
    for (let j = 0; j <= samples; j++) {
      const angle = ((amount + ((next - amount) * j) / samples) * Math.PI) / 2;
      const dx = (model.gate.scale.x < 0 ? -1 : 1) * Math.cos(angle),
        dz = -Math.sin(angle);
      for (const c of colliders) {
        if (c.corral || (!includeOperator && c === actor.collider)) continue;
        // An interrupted operator releases the existing leaf immediately.
        // Check his destination clearance; all other bodies retain the full sweep.
        if (c === actor.collider && stage !== 'idle' && j < samples) continue;
        const along = THREE.MathUtils.clamp(
          (c.x - hinge.x) * dx + (c.z - hinge.z) * dz,
          0,
          CORRAL.gateWidth,
        );
        if (Math.hypot(c.x - hinge.x - along * dx, c.z - hinge.z - along * dz) < c.radius + 0.29)
          return false;
      }
      const car = getCar();
      if (car)
        for (let i = 0; i <= 12; i++) {
          const along = (CORRAL.gateWidth * i) / 12;
          if (
            vehicleObstacleGap(car.x, car.z, car.heading ?? 0, {
              x: hinge.x + along * dx,
              z: hinge.z + along * dz,
              radius: 0.17,
            }) < 0.12
          )
            return false;
        }
    }
    return true;
  }
  function resetStage(next) {
    stage = next;
    time = 0;
    if (next === 'idle') zombies.release(operator);
    else if (next !== 'manual-opening') zombies.take(operator);
  }
  function faceError() {
    const p = actor.object.position,
      hand = model.handPoint();
    return angleDelta(Math.atan2(hand.x - p.x, hand.z - p.z), actor.object.rotation.y);
  }
  const api = {
    get amount() {
      return amount;
    },
    get open() {
      return open;
    },
    get target() {
      return requested ?? open;
    },
    get settled() {
      return stage === 'idle' || stage === 'returning';
    },
    get closePending() {
      return requested === false && started !== false;
    },
    manual(next) {
      cancelCloseNotice();
      const goal = next ? 1 : 0;
      if (goal !== amount && ((!next && !canClose()) || !swingClear(goal, true))) return false;
      const interrupted = stage === 'manual-opening' ? returnAfterManual : stage !== 'idle';
      open = next;
      requested = started = null;
      reach = retryIn = 0;
      route = [];
      model.setLatched(next ? 0 : 1);
      actor.rig.reach(model.handPoint(), 0, 0.1);
      if (next && amount < 1) {
        manualStart = amount;
        manualElapsed = 0;
        manualDuration = MANUAL_GATE_OPEN_SECONDS * (1 - amount);
        returnAfterManual = interrupted;
        requested = true;
        resetStage('manual-opening');
      } else {
        amount = goal;
        model.setAmount(amount);
        resetStage(interrupted ? 'returning' : 'idle');
      }
      sound(next ? 'gate-open' : 'gate-close');
      if (!next) sound('gate-latch');
      return true;
    },
    request(next) {
      if (next) cancelCloseNotice();
      if (requested === next) return true;
      if (((next && amount === 1) || (!next && amount === 0)) && requested === null) return true;
      const atHandle = ['reaching', 'unlatching', 'swinging', 'latching', 'stepping-back'].includes(
        stage,
      );
      requested = next;
      started = null;
      route = [];
      retryIn = 0;
      resetStage(atHandle ? 'reaching' : next ? 'approaching' : 'checking-escape');
      return true;
    },
    update(dt) {
      if (!(dt > 0) || stage === 'idle') return;
      time += dt;
      retryIn = Math.max(0, retryIn - dt);
      if (stage === 'checking-escape') {
        if (beforeClose(dt)) resetStage('approaching');
      } else if (stage === 'manual-opening') {
        const progress = Math.min(1, (manualElapsed + dt) / manualDuration);
        const next =
          progress === 1
            ? 1
            : Math.min(
                1 - Number.EPSILON,
                manualStart + (1 - manualStart) * progress ** 2 * (3 - 2 * progress),
              );
        if (!swingClear(next)) return;
        manualElapsed += dt;
        amount = next;
        model.setAmount(amount);
        if (progress === 1) {
          requested = null;
          resetStage(returnAfterManual ? 'returning' : 'idle');
        }
      } else if (stage === 'approaching') {
        const goal = anchor(amount, 1.35);
        if (
          !route.length &&
          Math.hypot(actor.object.position.x - goal.x, actor.object.position.z - goal.z) > 0.08 &&
          retryIn === 0
        ) {
          route = routeTo(goal);
          retryIn = 1;
        }
        if (route.length) walkRoute(route, dt);
        if (Math.hypot(actor.object.position.x - goal.x, actor.object.position.z - goal.z) < 0.08)
          resetStage('facing');
      } else if (stage === 'facing') {
        if (zombies.face(operator, model.handPoint(), dt, getCar())) resetStage('reaching');
      } else if (stage === 'reaching') {
        reach = Math.min(1, reach + dt * 2);
        const arrived = zombies.handleGate(
          operator,
          anchor(),
          model.handPoint(),
          dt,
          getCar(),
          reach,
        );
        if (arrived && reach === 1) resetStage('unlatching');
      } else if (stage === 'unlatching') {
        zombies.handleGate(operator, anchor(), model.handPoint(), dt, getCar(), 1);
        model.setLatched(requested ? Math.max(0, 1 - time / 0.45) : 0);
        if (time > 0.45) resetStage('swinging');
      } else if (stage === 'swinging') {
        const goal = requested ? 1 : 0;
        const next = THREE.MathUtils.clamp(amount + (requested ? 1 : -1) * dt * 0.18, 0, 1);
        if ((!requested && !canClose()) || !swingClear(next)) {
          zombies.handleGate(operator, anchor(), model.handPoint(), dt, getCar(), 1);
          return;
        }
        // The operator follows the ring from the front, always looking at it.
        // Check operator and leaf in the same proposed pose. Checking the
        // operator against the old leaf incorrectly blocks the return swing.
        model.setAmount(next);
        const arrived = zombies.handleGate(
          operator,
          anchor(next),
          model.handPoint(),
          dt,
          getCar(),
          1,
        );
        if (arrived && Math.abs(faceError()) < 0.08) {
          if (started !== requested) {
            started = requested;
            open = requested;
            sound(requested ? 'gate-open' : 'gate-close');
          }
          amount = next;
          if (amount === goal) resetStage('latching');
        } else model.setAmount(amount);
      } else if (stage === 'latching') {
        zombies.handleGate(operator, anchor(), model.handPoint(), dt, getCar(), 1);
        model.setLatched(open ? 0 : Math.min(1, time / 0.45));
        if (time > 0.45) {
          if (!open) sound('gate-latch');
          resetStage('stepping-back');
        }
      } else if (stage === 'stepping-back') {
        reach = Math.max(0, reach - dt * 2);
        if (
          zombies.handleGate(operator, anchor(amount, 1.35), model.handPoint(), dt, getCar(), reach)
        ) {
          requested = null;
          started = null;
          route = routeTo(home);
          resetStage('returning');
        }
      } else if (stage === 'returning') {
        if (
          !route.length &&
          Math.hypot(actor.object.position.x - home.x, actor.object.position.z - home.z) > 0.12 &&
          retryIn === 0
        ) {
          route = routeTo(home);
          retryIn = 1;
        }
        if (route.length) walkRoute(route, dt);
        if (Math.hypot(actor.object.position.x - home.x, actor.object.position.z - home.z) < 0.12)
          resetStage('idle');
      }
    },
    snapshot: () => ({
      operator,
      stage,
      requested,
      reach,
      facingError: faceError(),
      handTarget: model.handPoint().toArray(),
      hand: actor.rig.handPoint().toArray(),
      handGap: actor.rig.handPoint().distanceTo(model.handPoint()),
    }),
  };
  return api;
}
