import { createZombieCorral as createCurrentCorral } from '../../src/zombie-corral.js';
import { receiveCorralCargo } from '../helpers/corral-animal.mjs';
import { createLegacyCorralDelivery } from './corral-delivery.js';
export function createZombieCorral(scene, colliders, cart, zombies, options = {}) {
  const api = createCurrentCorral(scene, colliders, cart, zombies, {
    externalDelivery: false,
    ...options,
    legacyDeliveryFactory: createLegacyCorralDelivery,
  });
  const animals = api.animals,
    model = api.model,
    GUARD = options.guard ?? 'pvz-conehead';
  const touch = api.touch,
    requestGuardClose = api.requestGuardClose;
  const manualGate = (open) => api.setManualGateOpen(open);
  const gateController = {
    get target() {
      return api.snapshot().gateRequested;
    },
  };
  function visibleHit(ray) {
    scene.updateMatrixWorld(true);
    for (const a of animals)
      a.group.traverse((n) => {
        if (n.isSkinnedMesh) {
          n.skeleton.update();
          n.computeBoundingSphere();
          n.computeBoundingBox();
        }
      });
    return ray.intersectObjects(scene.children, true).find(
      (h) =>
        h.object.visible &&
        h.object.material?.opacity !== 0 &&
        !h.object.isSprite &&
        (() => {
          let n = h.object;
          while (n) {
            if (!n.visible) return false;
            n = n.parent;
          }
          return true;
        })(),
    );
  }
  api.receive = (cargo, id) => receiveCorralCargo(api, cargo, colliders, id, options.ground);
  Object.assign(api, {
    pat(ray) {
      const hit = visibleHit(ray);
      if (!hit) return false;
      let n = hit.object;
      while (n) {
        if (n === model.gate) {
          manualGate(!gateController.target);
          return true;
        }
        if (n === zombies.actor(GUARD)?.object) return requestGuardClose();
        const a = animals.find((a) => a.group === n);
        if (a) {
          touch(a, hit.point);
          return true;
        }
        n = n.parent;
      }
      return false;
    },
  });
  return api;
}
