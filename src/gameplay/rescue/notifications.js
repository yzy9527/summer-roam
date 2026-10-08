import { calfInSight } from '../../zombie-alerts.js';
import { rescueVisible } from './visibility.js';
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function createRescueNotifications({
  zombies,
  colliders,
  getPlayer,
  getListener,
  emit,
  onAlert,
  hear,
}) {
  const noticed = new WeakMap();
  let notifier = null,
    noticeTime = 0;
  function beginNotice(actor, target, guard = false) {
    if (!actor || notifier || noticed.get(target) === target.escapeEpoch) return false;
    noticed.set(target, target.escapeEpoch);
    notifier = {
      actor,
      target,
      epoch: target.escapeEpoch,
      guard,
      stage: 'facing',
      point: { x: target.x, z: target.z },
      sent: false,
    };
    noticeTime = 0;
    zombies.take(actor.layout.id);
    return true;
  }
  function finishNotice(cancelled = false) {
    if (!notifier) return;
    const n = notifier;
    if (cancelled && !n.sent) noticed.delete(n.target);
    zombies.rebind(n.actor.layout.id);
    if (!n.guard) zombies.release(n.actor.layout.id);
    notifier = null;
  }
  function advanceNotice(dt) {
    if (!notifier) return true;
    const n = notifier,
      actor = n.actor;
    noticeTime += dt;
    if (n.target.escapeEpoch !== n.epoch || n.target.mode !== 'escaping' || !n.target.outside) {
      finishNotice(true);
      return true;
    }
    if (n.stage === 'facing') {
      if (
        !zombies.face(actor.layout.id, n.point, dt, getPlayer(), {
          ignore: (c) => c === n.target.collider,
        })
      ) {
        if (noticeTime > 4) finishNotice(true);
        return !notifier;
      }
      n.stage = 'pointing';
      noticeTime = 0;
      n.sent = true;
      emit({
        type: 'zombie-no',
        id: n.target.id,
        instanceId: actor.layout.id,
        x: actor.object.position.x,
        z: actor.object.position.z,
      });
      if (gap(getListener(), actor.object.position) <= hear)
        onAlert({ target: n.target, epoch: n.epoch, point: { ...n.point } });
    }
    actor.rig.point(n.point, Math.sin(Math.PI * Math.min(1, noticeTime)), dt);
    if (noticeTime >= 1) finishNotice();
    return !notifier;
  }
  function alertOthers(target, dt) {
    if (notifier && !notifier.guard) advanceNotice(dt);
    if (!target || notifier || noticed.get(target) === target.escapeEpoch) return;
    const actor = ['pvz-browncoat', 'pvz-conehead', 'pvz-gatekeeper']
      .map((id) => zombies.actor(id))
      .find(
        (a) =>
          a &&
          !a.scripted &&
          !a.seated &&
          calfInSight(a, target, (from, to) =>
            rescueVisible(from, to, colliders, (c) => c === a.collider || c === target.collider),
          ),
      );
    if (actor) {
      beginNotice(actor, target);
      advanceNotice(dt);
    }
  }
  return {
    beginNotice,
    finishNotice,
    advanceNotice,
    alertOthers,
    hasNoticed: (target) => noticed.get(target) === target.escapeEpoch,
    get current() {
      return notifier;
    },
  };
}
