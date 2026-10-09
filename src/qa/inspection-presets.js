import { MOUNTAIN_SITE, MOUNTAIN_BASE } from '../mountain-profile.js';
import { culvertLayout } from '../culvert-profile.js';
import { bridgeLayout } from '../irrigation-style.js';
import { terrainHeight, roadFrame } from '../world-base.js';
import { drivingHeight } from '../world-queries.js';
import { canalOffset } from '../canal-profile.js';
import { paddyLayout } from '../paddy-profile.js';
import { PLOUGH_FIELD } from '../paddy-plough-site.js';
import { roadPoint } from '../world-base.js';
import { ZOMBIE_LAYOUT } from '../zombie-layout.js';
import * as THREE from 'three';

export function createInspectionPresets({
  views,
  params,
  getPaddyPloughing,
  getWoodenCart,
  getCalfHeist,
  getCalfRescue,
  getLeopardMilk,
  getAnimals,
  getCorral,
  getZombies,
  getState,
  getCampsite,
  bridgeInspection,
}) {
  function updateInspectionPreset(camera) {
    if (views.milk && getLeopardMilk?.()) {
      const milk = getLeopardMilk(),
        a = milk.leopard;
      const audit = document.getElementById('leopard-milk-audit');
      if (audit) audit.textContent = JSON.stringify(milk.snapshot());
      const { x, y, z } = a.group.position;
      if (
        views.milk === 'pen' ||
        ['feeding', 'clearing-calf', 'collecting', 'placing'].includes(milk.snapshot().phase)
      ) {
        const base = drivingHeight(164, 23);
        camera.position.set(169, base + 3.5, 18.5);
        camera.lookAt(164.5, base + 0.75, 23.2);
      } else {
        camera.position.set(x + Math.cos(a.heading) * 5, y + 2.1, z - Math.sin(a.heading) * 5);
        camera.lookAt(x + Math.sin(a.heading) * 0.4, y + 0.55, z + Math.cos(a.heading) * 0.4);
      }
      return true;
    }
    if (
      views.animal ||
      views.vehicle ||
      views.zombie ||
      views.fish ||
      views.cart ||
      views.corral ||
      views.heist ||
      views.tree ||
      views.mountain ||
      views.campfire
    )
      views.plough = null;
    if (params.has('qa') && views.plough) {
      const controller = getPaddyPloughing();
      const plough = controller?.cow;
      const taskAudit = document.getElementById('paddy-plough-audit');
      if (taskAudit && controller && performance.now() - views.ploughAuditAt > 500) {
        taskAudit.textContent = JSON.stringify(controller.snapshot());
        views.ploughAuditAt = performance.now();
      }
      if (views.plough === 'worker' && controller?.worker) {
        const worker = controller.worker.object;
        const { x, y, z } = worker.position,
          heading = worker.rotation.y - 0.6;
        camera.position.set(x + Math.sin(heading) * 4.3, y + 1.6, z + Math.cos(heading) * 4.3);
        camera.lookAt(x, y + 1.0, z);
        return true;
      }
      if (views.plough === 'field') {
        const { x, z } = PLOUGH_FIELD;
        camera.position.set(x + 32, drivingHeight(x, z) + 35, z - 38);
        camera.lookAt(x, drivingHeight(x, z), z);
        return true;
      }
      if (plough) {
        const { x, y, z } = plough.group.position,
          heading = plough.heading;
        const audit = document.getElementById('paddy-plough-audit');
        if (audit && performance.now() - views.ploughAuditAt > 500) {
          audit.textContent = JSON.stringify(controller.snapshot());
          views.ploughAuditAt = performance.now();
        }
        const overview = views.plough === 'overview';
        const d = overview ? 23 : 8;
        camera.position.set(
          x + Math.cos(heading) * d - Math.sin(heading) * 2,
          y + (overview ? 16 : 3.5),
          z - Math.sin(heading) * d - Math.cos(heading) * 2,
        );
        camera.lookAt(x, y + 0.9, z);
        return true;
      }
    }
    const crewCartView = params.get('crewcartview');
    if (
      views.queryEnabled &&
      params.has('qa') &&
      ['front', 'side', 'rear', 'empty'].includes(crewCartView)
    ) {
      const cart = getWoodenCart();
      if (cart) {
        const offset = {
          front: [-7, 3.9, 7.6],
          side: [-9, 3.4, 0],
          rear: [7, 4, -8],
          empty: [-7, 5.2, 7.6],
        }[crewCartView];
        const eye = cart.world(...offset),
          target = cart.world(0, 1.3, 0);
        camera.position.copy(eye);
        camera.lookAt(target.x, target.y, target.z);
        const audit = document.getElementById('wood-cart-audit');
        if (audit) audit.textContent = JSON.stringify(cart.snapshot());
        return true;
      }
    }
    const heist = getCalfHeist()?.snapshot();
    const rescue = getCalfRescue()?.snapshot();
    const rescueAudit = document.getElementById('calf-rescue-audit');
    if (rescueAudit && rescue) rescueAudit.textContent = JSON.stringify(rescue);
    const rescueReport = document.getElementById('calf-rescue-report');
    if (rescueReport && rescue && !rescueReport.hidden)
      rescueReport.textContent = `追逐：${rescue.phase} · 公牛：${rescue.bull?.phase ?? 'idle'} · 抓到：${rescue.captures} · 救援：${rescue.rescues} · 顶飞：${rescue.impacts} · 结果：${rescue.outcome || '进行中'}`;
    if (params.has('qa') && rescueReport && !rescueReport.hidden && rescue && !views.heist) {
      const p = new THREE.Vector3(...rescue.giant);
      if (rescue.calf)
        p.lerp(
          new THREE.Vector3(
            rescue.calf.x,
            drivingHeight(rescue.calf.x, rescue.calf.z),
            rescue.calf.z,
          ),
          0.3,
        );
      const bull = getAnimals()?.animal('copper-cow');
      if (bull && ['warning', 'charging'].includes(rescue.bull?.phase))
        p.lerp(new THREE.Vector3(bull.x, drivingHeight(bull.x, bull.z), bull.z), 0.3);
      const base = drivingHeight(p.x, p.z);
      camera.position.set(p.x + 10, base + 6, p.z - 10);
      camera.lookAt(p.x, base + 1.7, p.z);
      const corralAudit = document.getElementById('corral-audit');
      if (corralAudit) corralAudit.textContent = JSON.stringify(getCorral()?.snapshot());
      return true;
    }
    const audit = document.getElementById('calf-heist-audit');
    if (audit && heist) audit.textContent = JSON.stringify(heist);
    if (views.heist && heist) {
      if (
        heist.lookout &&
        (['tower', 'lookout'].includes(views.heist) || heist.phase === 'lookout-notice')
      ) {
        const { site } = heist.lookout;
        const close = views.heist === 'lookout';
        camera.position.set(site.x - (close ? 7 : 17), close ? 9.5 : 11, site.z + (close ? 3 : 8));
        camera.lookAt(site.x - 0.3, close ? site.deck + 1.2 : 5.5, site.z);
        return true;
      }
      const cart = getWoodenCart()?.snapshot();
      const corral = getCorral()?.snapshot();
      if (cart && heist.herdTurn && heist.herdTurn.stage !== 'ready') {
        const [cx, cy, cz] = cart.position,
          [gx, gy, gz] = heist.giant.position,
          x = (cx + gx) / 2,
          z = (cz + gz) / 2,
          span = Math.max(22, Math.hypot(cx - gx, cz - gz) * 1.1);
        camera.position.set(x - span, Math.max(cy, gy) + span * 0.8, z - span);
        camera.lookAt(x, Math.max(cy, gy) + 1.5, z);
        return true;
      }
      if (
        cart &&
        [
          'face-throw',
          'throw-windup',
          'throw-swing',
          'calf-in-flight',
          'calf-landing',
          'preview-loaded',
        ].includes(heist.phase)
      ) {
        const vehicle = getWoodenCart();
        const eye = vehicle.world(-9, 5.5, 1.5),
          target = vehicle.world(-1.7, 1.5, -2.48);
        camera.position.set(eye.x, eye.y, eye.z);
        camera.lookAt(target.x, target.y, target.z);
        return true;
      }
      const corralAudit = document.getElementById('corral-audit');
      if (corralAudit && corral) corralAudit.textContent = JSON.stringify(corral);
      if (
        heist.guardPat?.guardPosition &&
        ['approach-guard', 'face-guard', 'pat-guard'].includes(heist.phase)
      ) {
        const [x, y, z] = heist.guardPat.guardPosition;
        camera.position.set(x - 3.8, y + 4.4, z + 3.2);
        camera.lookAt(x + 0.3, y + 1.7, z - 0.8);
        return true;
      }
      if (
        corral &&
        [
          'opening-at-corral',
          'closing-corral',
          'driver-dismount',
          'complete',
          'carry-to-corral',
          'face-corral',
          'enter-corral',
          'corral-throw-windup',
          'corral-throw-swing',
          'corral-calf-in-flight',
          'corral-calf-landing',
          'leave-corral',
          'approach-guard',
          'face-guard',
          'pat-guard',
          'delivery-handoff',
        ].includes(heist.phase)
      ) {
        const [x, y, z] = corral.position;
        camera.position.set(x + 11, y + 7, z - 13);
        camera.lookAt(x - 2, y + 1, z - 4);
        return true;
      }
      if (
        cart &&
        [
          'waiting',
          'crew-boarding',
          'outbound',
          'parking-at-herd',
          'close-cart',
          'returning',
          'driver-returning',
          'abort-returning',
          'abort-close-cart',
          'abort-giant-dismount',
        ].includes(heist.phase)
      ) {
        const [x, y, z] = cart.position,
          heading = cart.heading;
        camera.position.set(
          x + Math.sin(heading) * 8 + Math.cos(heading) * 10,
          y + 6,
          z + Math.cos(heading) * 8 - Math.sin(heading) * 10,
        );
        camera.lookAt(x, y + 1.5, z);
        return true;
      }
      const crew = getZombies()?.snapshot().zombies;
      const p =
        heist.calf?.position ??
        crew?.find((a) => a.id === 'pvz-gargantuar')?.position ??
        cart?.position;
      if (p) {
        const heading = crew?.find((a) => a.id === 'pvz-gargantuar')?.heading ?? 0;
        const side = heist.carryMode === 'underarm' ? -4.5 : 3.5;
        camera.position.set(
          p[0] + Math.sin(heading) * 5 + Math.cos(heading) * side,
          p[1] + 2.5,
          p[2] + Math.cos(heading) * 5 - Math.sin(heading) * side,
        );
        camera.lookAt(p[0], p[1] + 0.65, p[2]);
        return true;
      }
    }
    const state = getState(),
      animals = getAnimals();
    const waterView = params.get('waterview');
    if (views.tree && animals?.tree) {
      const visit = animals.tree.snapshot(),
        a = animals.snapshot().find((a) => a.id === 'baola-leopard');
      const audit = document.getElementById('leopard-tree-audit');
      if (audit) audit.textContent = JSON.stringify({ ...visit, animal: a });
      if (views.tree === 'overview' || !a) {
        const [x, y, z] = visit.tree.position;
        camera.position.set(x + 15, y + 8, z + 13);
        camera.lookAt(x - 3, y + 4, z - 2);
      } else {
        camera.position.set(a.x + 4.5, a.y + 1.8, a.z + 2.5);
        camera.lookAt(a.x + 0.1, a.y + 0.55, a.z);
      }
      return true;
    }
    if (views.animal || views.vehicle || views.zombie || views.fish || views.cart || views.corral)
      views.campfire = null;
    if (views.campfire) {
      const campsite = getCampsite()?.snapshot();
      if (campsite) {
        const [x, y, z] = campsite.position;
        const overview = views.campfire === 'overview';
        camera.position.set(
          x - (overview ? 8 : 3.8),
          y + (overview ? 6 : 2.7),
          z - (overview ? 11 : 4.8),
        );
        camera.lookAt(x + (overview ? 3 : 0), y + 0.9, z);
        return true;
      }
    }
    if (params.has('qa') && views.corral) {
      const c = getCorral()?.snapshot();
      if (c) {
        const audit = document.getElementById('corral-audit');
        if (audit) audit.textContent = JSON.stringify(c);
        const a = c.animals.find((a) => a.mode === 'escaping') ?? c.animals[0];
        if (
          (views.corral === 'escape' ||
            (views.corral === 'close' && a && ['unloading', 'leading'].includes(c.phase))) &&
          a
        ) {
          const p = [a.x, drivingHeight(a.x, a.z), a.z];
          camera.position.set(p[0] + 6, p[1] + 3.6, p[2] - 6);
          camera.lookAt(p[0], p[1] + 0.8, p[2]);
        } else {
          const [x, y, z] = c.position;
          camera.position.set(
            x + (views.corral === 'close' ? 8 : 14),
            y + (views.corral === 'close' ? 6 : 12),
            z - (views.corral === 'close' ? 10 : 18),
          );
          camera.lookAt(x, y + 0.7, z - 4);
        }
        return true;
      }
    }
    if (views.animal || views.vehicle || views.zombie || views.fish || views.cart)
      views.mountain = null;
    if (params.has('qa') && views.mountain) {
      const a = animals?.snapshot().find((a) => a.id === 'reference-wolf');
      if (views.mountain === 'wolf' && a) {
        camera.position.set(a.x + 5.5, (a.y ?? drivingHeight(a.x, a.z)) + 3, a.z - 5.5);
        camera.lookAt(a.x, (a.y ?? drivingHeight(a.x, a.z)) + 0.7, a.z);
      } else {
        const view = { front: [34, 14, 13], rear: [-34, 18, -17], side: [8, 15, 38] }[
          views.mountain
        ] ?? [34, 14, 13];
        camera.position.set(
          MOUNTAIN_SITE.x + view[0],
          MOUNTAIN_BASE + view[1],
          MOUNTAIN_SITE.z + view[2],
        );
        camera.lookAt(MOUNTAIN_SITE.x - 2, MOUNTAIN_BASE + 4.3, MOUNTAIN_SITE.z);
      }
      return true;
    }
    if (views.animal || views.vehicle || views.zombie || views.fish) views.cart = null;
    if (params.has('qa') && views.cart) {
      const cart = getWoodenCart()?.snapshot();
      if (cart) {
        const audit = document.getElementById('wood-cart-audit');
        if (audit) audit.textContent = JSON.stringify(cart);
        const [x, y, z] = cart.position;
        const angle = cart.heading + (views.cart === 'rear' ? Math.PI + 0.65 : 0.65);
        camera.position.set(x + Math.sin(angle) * 7.2, y + 3.4, z + Math.cos(angle) * 7.2);
        camera.lookAt(x, y + 1.15, z);
        return true;
      }
    }
    if (views.animal || views.vehicle) views.zombie = views.fish = null;
    if (params.has('qa') && views.zombie) {
      const zombie = getZombies()
        ?.snapshot()
        .zombies.find((z) => z.id === views.zombie);
      if (zombie) {
        if (params.get('zombiegrip') === '1') {
          const hand = getZombies().actor(zombie.id).rig.handPoint();
          const heading = zombie.heading + Math.PI / 2;
          camera.position.set(
            hand.x + Math.sin(heading) * 0.65,
            hand.y + 0.16,
            hand.z + Math.cos(heading) * 0.65,
          );
          camera.lookAt(
            hand.x + Math.sin(zombie.heading) * 0.11,
            hand.y,
            hand.z + Math.cos(zombie.heading) * 0.11,
          );
          return true;
        }
        const [x, y, z] = zombie.position,
          giant = zombie.id === 'pvz-gargantuar';
        const heading = zombie.heading + (params.get('zombieside') === '1' ? Math.PI / 2 : 0.6);
        const distance = giant ? 7.8 : 4.5;
        camera.position.set(
          x + Math.sin(heading) * distance,
          y + (giant ? 2.8 : 1.6),
          z + Math.cos(heading) * distance,
        );
        camera.lookAt(x, y + (giant ? 1.7 : 1.1), z);
      } else {
        const x = ZOMBIE_LAYOUT[1].x,
          z = ZOMBIE_LAYOUT[1].z;
        camera.position.set(x - 18, drivingHeight(x, z) + 8, z + 17);
        camera.lookAt(x + 1, drivingHeight(x, z) + 1.2, z);
      }
      return true;
    }
    if (params.has('qa') && views.fish) {
      const f = roadFrame(16.4),
        x = f.x + f.nx * canalOffset(16.4),
        z = f.z + f.nz * canalOffset(16.4),
        y = terrainHeight(x, z) - 0.48,
        close = views.fish === 'close';
      camera.position.set(x + (close ? 0.8 : 1.4), y + (close ? 1.1 : 2.6), z + (close ? 0.65 : 3));
      camera.lookAt(x, y - 0.08, z + (close ? 0 : -0.1));
      return true;
    }
    if (
      views.queryEnabled &&
      params.has('qa') &&
      ['canal', 'canal-low', 'paddy', 'paddy-low'].includes(waterView)
    ) {
      const low = waterView.endsWith('low');
      if (waterView.startsWith('canal')) {
        const f = roadFrame(16),
          d = canalOffset(16),
          x = f.x + f.nx * d,
          z = f.z + f.nz * d,
          y = terrainHeight(x, z) - 0.48;
        camera.position.set(x + (low ? 0.2 : 1.8), y + (low ? 0.42 : 2.7), z + (low ? 2.2 : 3.4));
        camera.lookAt(x, y - 0.08, z - 1.5);
      } else {
        const p = paddyLayout(roadPoint)[0],
          y = terrainHeight(p.x, p.z);
        camera.position.set(p.x - 8, y + (low ? 0.85 : 5.4), p.z + 7);
        camera.lookAt(p.x - 2, y + 0.05, p.z - (low ? 7 : 1));
      }
      return true;
    }
    if (
      views.queryEnabled &&
      params.has('qa') &&
      ['close', 'overview'].includes(params.get('forestview'))
    ) {
      const audit = document.getElementById('forest-tree-audit');
      if (audit) {
        const { focus: p } = JSON.parse(audit.textContent),
          close = params.get('forestview') === 'close';
        camera.position.set(
          close ? p.x - p.height * 1.45 : -43,
          close ? p.y + p.height * 0.55 : terrainHeight(-43, 160) + 13,
          close ? p.z - p.height * 1.55 : 160,
        );
        camera.lookAt(close ? p.x : -90, close ? p.y + p.height * 0.52 : 11, close ? p.z : 155);
        return true;
      }
    }
    if (
      views.queryEnabled &&
      params.has('qa') &&
      ['front', 'rear', 'overview'].includes(params.get('houseview'))
    ) {
      const view = params.get('houseview'),
        p = { front: [-25, 8, 205], rear: [-69, 12, 218], overview: [-15, 22, 172] }[view];
      camera.position.set(p[0], terrainHeight(p[0], p[2]) + p[1], p[2]);
      camera.lookAt(-48, terrainHeight(-48, 200) + 3, 200);
      return true;
    }

    if (views.queryEnabled && params.has('qa') && params.has('culvertview')) {
      const p = culvertLayout(params.get('culvertview') === 'start' ? 10 : 190),
        across = 2.0,
        along = -3.8;
      camera.position.set(
        p.x + across * Math.cos(p.heading) + along * Math.sin(p.heading),
        p.ground + 1.65,
        p.z - across * Math.sin(p.heading) + along * Math.cos(p.heading),
      );
      camera.lookAt(p.x, p.water + 0.25, p.z);
      return true;
    }

    if (views.queryEnabled && bridgeInspection) {
      const station = Number(params.get('bridge')) || 21,
        b = bridgeLayout(station),
        f = roadFrame(station);
      const along = bridgeInspection === 'above' ? -3.2 : -4.7,
        across = bridgeInspection === 'above' ? 2.4 : 0.65;
      camera.position.set(
        b.p.x + f.nx * across - f.nz * along,
        b.h + (bridgeInspection === 'above' ? 3.25 : 0.7),
        b.p.z + f.nz * across + f.nx * along,
      );
      camera.lookAt(b.p.x, b.h + 0.4, b.p.z);
      return true;
    }

    if (views.animal === 'charge' && animals) {
      const a = animals.snapshot().find((a) => a.id === 'copper-cow');
      if (a) {
        const x = (a.x + state.x) / 2,
          z = (a.z + state.z) / 2,
          span = Math.max(5, Math.hypot(a.x - state.x, a.z - state.z));
        camera.position.set(x + span * 0.65, drivingHeight(x, z) + span * 0.65, z + span * 0.65);
        camera.lookAt(x, drivingHeight(x, z) + 0.7, z);
        return true;
      }
    }
    if (['family', 'bite', 'follow'].includes(views.animal) && animals) {
      const mountain = animals.mountain?.snapshot();
      if (views.animal === 'bite' && mountain?.sheltered) {
        const wolf = animals.snapshot().find((a) => a.id === 'reference-wolf');
        camera.position.set(wolf.x + 4, wolf.y + 2.1, wolf.z + 3.5);
        camera.lookAt(wolf.x, wolf.y + 0.65, wolf.z);
        return true;
      }
      const pair = animals
        .snapshot()
        .filter((a) =>
          [
            views.animal === 'bite'
              ? 'reference-wolf'
              : views.animal === 'follow'
                ? 'copper-cow'
                : 'golden-cow',
            'hornless-calf',
            ...(views.animal === 'bite' ? ['golden-cow'] : []),
          ].includes(a.id),
        );
      if (pair.length >= 2) {
        const minX = Math.min(...pair.map((a) => a.x)),
          maxX = Math.max(...pair.map((a) => a.x)),
          minZ = Math.min(...pair.map((a) => a.z)),
          maxZ = Math.max(...pair.map((a) => a.z)),
          x = (minX + maxX) / 2,
          z = (minZ + maxZ) / 2,
          span = Math.max(4, Math.hypot(maxX - minX, maxZ - minZ));
        camera.position.set(x + span * 1.25, drivingHeight(x, z) + span * 0.6, z + span * 0.6);
        camera.lookAt(x, drivingHeight(x, z) + 0.6, z);
        return true;
      }
    }
    if (views.animal === 'face' && animals) {
      const a = animals.snapshot().find((a) => a.id === views.animalId);
      if (a) {
        const y = a.y ?? drivingHeight(a.x, a.z),
          fx = Math.sin(a.heading),
          fz = Math.cos(a.heading);
        camera.position.set(a.x + fx * 1.8 + fz * 0.08, y + 1.03, a.z + fz * 1.8 - fx * 0.08);
        camera.lookAt(a.x + fx * 0.75, y + 0.96, a.z + fz * 0.75);
        return true;
      }
    }
    if (views.animal && animals) {
      const a = animals.snapshot().find((a) => a.id === views.animalId);
      if (a) {
        const y = a.y ?? drivingHeight(a.x, a.z),
          side = views.animal === 'tail' ? -1 : 1;
        if (params.get('legview') === 'side') {
          camera.position.set(
            a.x + Math.cos(a.heading) * (views.animal === 'sleep' ? 4.2 : 2.7),
            y + (views.animal === 'sleep' ? 0.95 : 0.78),
            a.z - Math.sin(a.heading) * (views.animal === 'sleep' ? 4.2 : 2.7),
          );
          camera.lookAt(a.x, y + (views.animal === 'sleep' ? 0.4 : 0.68), a.z);
          return true;
        }
        camera.position.set(
          a.x + Math.cos(a.heading) * 2.8 + Math.sin(a.heading) * 2.5 * side,
          y + 1.35,
          a.z - Math.sin(a.heading) * 2.8 + Math.cos(a.heading) * 2.5 * side,
        );
        camera.lookAt(a.x, y + 0.72, a.z);
        return true;
      }
    }

    return false;
  }
  return updateInspectionPreset;
}
