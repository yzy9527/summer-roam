import * as THREE from 'three';
import { CALF_RESCUE } from './config.js';
import { dryAnimalPoint, clearAnimalSegment, findAnimalPath } from '../../corral-navigation.js';
import { snapshotData } from '../../app/snapshot-data.js';
const GIANT = 'pvz-gargantuar';
const angle = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function createBullDefense({
  bull,
  giant,
  zombies,
  interactions,
  colliders,
  ground,
  getPhase,
  emit,
  onThreat,
  launch,
}) {
  let bullPhase = 'idle',
    bullTime = 0,
    bullOrigin = null,
    bullRoute = [],
    bullRetry = 0,
    previousHorns = [];
  function bullSafe(x, z, car, contact = false) {
    if (x < -39 || x > -17 || z < -5 || z > 32) return false;
    return dryAnimalPoint(
      x,
      z,
      contact ? 0.43 : bull.radius,
      colliders,
      car,
      (c) => c === bull.collider || (contact && c === giant.collider),
    );
  }
  function poseBull(dt) {
    bull.clock += dt;
    bull.motion = THREE.MathUtils.damp(bull.motion ?? 0, bull.velocity > 0.01 ? 1 : 0, 4, dt);
    bull.group.position.set(bull.x, ground(bull.x, bull.z) + 0.025, bull.z);
    bull.group.rotation.y = bull.heading;
    Object.assign(bull.collider, {
      x: bull.x,
      z: bull.z,
      radius: bullPhase === 'charging' ? 0.43 : bull.radius,
    });
    bull.rig.update(dt, bull, 0, 0);
    emit({ type: 'animal-position', id: bull.id, instanceId: bull.id, x: bull.x, z: bull.z });
  }
  function startDefense() {
    if (!bull || bullPhase !== 'idle' || bullDefenseCooldown > 0) return;
    if (!interactions.sleep.ready(bull)) {
      interactions.sleep.wake(bull);
      return;
    }
    if (!interactions.reserveDefense(bull)) return;
    if (getPhase() === 'idle') zombies.take(GIANT);
    bullOrigin = { x: bull.x, z: bull.z };
    bullPhase = 'warning';
    bullTime = 0;
    bullRoute = [];
    bullRetry = 0;
    bull.chargePose = 1;
    bull.chargeRun = 0;
    previousHorns = [];
    emit({ type: 'bull-rescue', id: bull.id, instanceId: bull.id, x: bull.x, z: bull.z });
    onThreat();
  }
  let bullDefenseCooldown = 0;
  function bullReturn() {
    bullPhase = 'returning';
    bullRoute = [];
    bullRetry = 0;
    bullTime = 0;
    bull.chargePose = 0;
  }
  function hornContact() {
    const horns = bull.rig.hornPoints();
    if (gap(bull, giant.object.position) > 3.5) {
      previousHorns = horns.map((p) => p.clone());
      return false;
    }
    giant.source.traverse((n) => {
      if (n.isSkinnedMesh && n.visible) {
        n.skeleton.update();
        n.computeBoundingSphere();
        n.computeBoundingBox();
      }
    });
    giant.object.updateMatrixWorld(true);
    const meshes = [];
    giant.source.traverse((n) => {
      if (n.isMesh && n.visible && !n.material?.name?.includes('ELECTRIC_POLE')) meshes.push(n);
    });
    const heading = new THREE.Vector3(Math.sin(bull.heading), 0, Math.cos(bull.heading));
    const touched = horns.some((p, i) => {
      const from = (previousHorns[i] ?? p).clone().addScaledVector(heading, -0.18);
      const delta = p.clone().addScaledVector(heading, 0.12).sub(from);
      const ray = new THREE.Raycaster(from, delta.clone().normalize(), 0, delta.length());
      return ray.intersectObjects(meshes, false).length > 0;
    });
    previousHorns = horns.map((p) => p.clone());
    return touched;
  }
  function updateBull(dt, car) {
    bullDefenseCooldown = Math.max(0, bullDefenseCooldown - dt);
    if (!bull || bullPhase === 'idle') return;
    bullTime += dt;
    bullRetry = Math.max(0, bullRetry - dt);
    const goal =
      bullPhase === 'returning'
        ? bullOrigin
        : { x: giant.object.position.x, z: giant.object.position.z };
    const error = angle(Math.atan2(goal.x - bull.x, goal.z - bull.z), bull.heading);
    bull.heading += THREE.MathUtils.clamp(error, -dt * 3, dt * 3);
    if (bullPhase === 'warning') {
      bull.velocity = 0;
      if (bullTime >= CALF_RESCUE.bullWindup) {
        bullPhase = 'charging';
        bullTime = 0;
      }
    } else {
      const contact = bullPhase === 'charging';
      if (
        contact &&
        (gap(giant.object.position, bullOrigin) > CALF_RESCUE.bullLimit ||
          bullTime > 8 ||
          ['airborne', 'landed'].includes(getPhase()))
      )
        bullReturn();
      else {
        if (bullRetry === 0) {
          bullRoute =
            findAnimalPath(bull, goal, (x, z) => bullSafe(x, z, car, contact), {
              step: 0.5,
              padding: 6,
            }) ?? [];
          bullRetry = 0.4;
        }
        const target = bullRoute[0];
        const speed = contact ? CALF_RESCUE.bullSpeed : 1.1;
        bull.velocity = THREE.MathUtils.damp(
          bull.velocity,
          target && Math.abs(error) < 0.4 ? speed : 0,
          4,
          dt,
        );
        if (target) {
          const length = gap(bull, target),
            step = Math.min(length, bull.velocity * dt);
          const next = {
            x: bull.x + ((target.x - bull.x) * step) / Math.max(length, 1e-9),
            z: bull.z + ((target.z - bull.z) * step) / Math.max(length, 1e-9),
          };
          if (clearAnimalSegment(bull, next, (x, z) => bullSafe(x, z, car, contact), 0.08)) {
            bull.x = next.x;
            bull.z = next.z;
            bull.distance += step;
          } else {
            bull.velocity = 0;
            bullRoute = [];
          }
          if (length < 0.05) bullRoute.shift();
        }
        bull.chargeRun = THREE.MathUtils.clamp(bull.velocity / 2.2, 0, 1);
        if (!contact && gap(bull, bullOrigin) < 0.15) {
          interactions.releaseDefense(bull);
          bullPhase = 'idle';
          bullDefenseCooldown = 5;
        } else if (contact && bullTime > 2 && !bullRoute.length) bullReturn();
      }
    }
    if (bullPhase !== 'idle') {
      poseBull(dt);
      if (bullPhase === 'charging' && hornContact() && launch(car)) bullReturn();
    }
  }
  return {
    start: startDefense,
    update: updateBull,
    get phase() {
      return bullPhase;
    },
    snapshot() {
      return bull
        ? snapshotData({
            phase: bullPhase,
            time: bullTime,
            cooldown: bullDefenseCooldown,
            distance: gap(giant.object.position, bull),
            origin: bullOrigin,
          })
        : null;
    },
  };
}
