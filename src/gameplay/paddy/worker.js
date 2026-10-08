import * as THREE from 'three';
export function createPaddyWorker({
  worker,
  leader,
  zombies,
  storage,
  wait: PLOUGH_WAIT,
  parked,
  ground,
  move,
  getEngine,
  getCow,
  getPhase,
  isTied,
  isWorking,
  getHolster,
  getToolCollider,
}) {
  const state = { phase: 'idle', time: 0, carrying: false, toolBlend: 0 };
  function updateWorker(dt) {
    if (!getEngine() || state.phase === 'idle' || state.phase === 'working') return;
    if (state.phase === 'preparing') {
      if (move(worker, { x: storage.x, z: storage.z - 1.1 }, dt, 1.15, 0)) {
        state.carrying = true;
        getEngine().props.plough.visible = true;
        state.toolBlend = Math.min(1, state.toolBlend + dt);
        parked.visible = false;
        if (state.toolBlend === 1) state.phase = 'to-field';
      }
    } else if (state.phase === 'to-field') {
      if (move(worker, PLOUGH_WAIT, dt, 1, PLOUGH_WAIT.heading)) state.phase = 'waiting';
    } else if (state.phase === 'waiting') {
      move(worker, PLOUGH_WAIT, dt, 0, PLOUGH_WAIT.heading);
      if ((getPhase() === 'outbound' && getCow().x < 121) || getPhase() === 'assembling')
        state.phase = 'joining';
    } else if (state.phase === 'joining') {
      if (
        move(worker, getEngine().formation().worker, dt, 1, getEngine().formation().worker.heading)
      )
        state.phase = 'ready';
    } else if (state.phase === 'storing') {
      if (move(worker, { x: storage.x, z: storage.z - 1.1 }, dt, 1, 0)) {
        state.time += dt;
        state.carrying = false;
        getEngine().props.plough.rotation.set(0, 0, 0);
        getEngine().props.plough.position.lerp(
          new THREE.Vector3(storage.x, ground(storage.x, storage.z), storage.z),
          Math.min(1, dt * 4),
        );
        if (state.time > 1.5) {
          getEngine().props.plough.visible = false;
          parked.visible = true;
          state.phase = 'stepping-back';
        }
      }
    } else if (state.phase === 'stepping-back') {
      if (move(worker, { x: storage.x, z: storage.z - 2.5 }, dt, 0.8)) {
        state.phase = 'idle';
        zombies.release(worker.layout.id);
      }
    }
  }
  function storeWorker() {
    if (['idle', 'storing', 'stepping-back'].includes(state.phase)) return;
    state.phase = 'storing';
    state.time = 0;
    state.carrying = true;
    state.toolBlend = 1;
    zombies.take(worker.layout.id);
  }
  function animateTools(dt) {
    if (!getEngine()) return;
    const p = getEngine().props;
    p.halter.visible = p.lead.mesh.visible = isTied();
    p.yoke.visible = p.neckStrap.mesh.visible = p.trace.mesh.visible = isWorking();
    p.whip.mesh.visible = p.handle.visible = state.carrying;
    if (isTied()) {
      leader.rig.workGrip(
        'Left',
        leader.object.localToWorld(
          new THREE.Vector3(0.28, 1.07, -0.1).divideScalar(leader.object.scale.x),
        ),
        dt,
      );
      const hand = leader.rig.gripPoint('Left'),
        nose = p.nose();
      p.lead.update(
        new THREE.QuadraticBezierCurve3(
          hand,
          hand
            .clone()
            .lerp(nose, 0.5)
            .add(new THREE.Vector3(0, -0.18, 0)),
          nose,
        ),
      );
    }
    if (state.carrying) {
      const w = worker.object;
      const handTarget = w.localToWorld(
        new THREE.Vector3(0.25, 1.12, 0.48).divideScalar(w.scale.x),
      );
      p.plough.rotation.set(-0.25, w.rotation.y, 0, 'YXZ');
      const socket = new THREE.Vector3(0.18, 1.08, -0.42).applyEuler(p.plough.rotation);
      const target = handTarget.sub(socket);
      p.plough.position.lerp(target, state.toolBlend);
      p.plough.updateMatrixWorld(true);
      worker.rig.workGrip('Left', p.grip(), dt);
      const right = p.plough.localToWorld(new THREE.Vector3(0.12, 0.82, -0.3));
      worker.rig.workGrip('Right', right, dt);
    }
    getHolster()?.update(state.carrying);
    const toolCollider = getToolCollider();
    if (toolCollider) {
      const at = p.plough.visible ? p.plough.position : parked.position;
      Object.assign(toolCollider, { x: at.x, z: at.z });
    }
  }

  return { state, update: updateWorker, store: storeWorker, animateTools };
}
