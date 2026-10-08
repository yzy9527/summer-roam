import { createInspectionPresets } from './qa/inspection-presets.js';
import { mountainSupportHeight } from './mountain-profile.js';

import { roadFrame } from './world-base.js';
import { drivingHeight } from './world-queries.js';
import { stepDrive } from './drive.js';
import { VEHICLE_CONFIG } from './vehicle-config.js';

import * as THREE from 'three';
import { createInspectionCamera } from './inspection-camera.js';
import { ANIMAL_LAYOUT, animalPointAllowed } from './field-animals.js';
import { createAnimalAnimation } from './animal-animation.js';
import { ANIMAL_PROFILES } from './animal-profiles.js';
import { restoreCalf } from './calf-transport-pose.js';
import { landscapeHeight } from './world-queries.js';

// Owns inspection state only. Gameplay owns input, camera, audio and the replaceable drive state.
// getState/getAnimals stay live across reset and asynchronous scene loading.
export function createFieldQA({
  params,
  getState,
  getAnimals,
  getZombies = () => null,
  getWoodenCart = () => null,
  getCorral = () => null,
  getCalfHeist = () => null,
  getCalfRescue = () => null,
  getPaddyPloughing = () => null,
  advanceCalfHeist = () => {},
  getCampsite = () => null,
  input,
  colliders,
  orbit,
  audio,
  clearInput,
  setMode,
  reset,
  refreshCar,
  refreshCamera,
  setImpact,
  snapshot,
}) {
  const $ = (id) => document.getElementById(id);
  const inspectionCamera = createInspectionCamera((x, z) =>
    Math.max(drivingHeight(x, z), mountainSupportHeight(x, z)),
  );
  // Store each preset's exact focus point before applying manual camera input.
  const inspectionView = {
    position: new THREE.Vector3(),
    target: new THREE.Vector3(),
    lookAt(x, y, z) {
      this.target.set(x, y, z);
    },
  };
  const views = {
    queryEnabled: true,
    vehicle: false,
    animal: false,
    animalId: 'golden-cow',
    qaRun: null,
    driftRun: null,
    report: undefined,
    fish: params.get('fishview'),
    zombie: params.get('zombieview'),
    plough: params.get('ploughview'),
    ploughAuditAt: 0,
    perfAuditAt: 0,
    cart: params.get('cartview'),
    corral: params.get('corralview'),
    heist: params.has('lookoutview') ? 'tower' : params.has('heistview'),
    campfire: params.get('campfireview'),
    mountain: params.get('mountainview'),
    tree: params.get('treeview'),
    treeAdvance: 0,
  };

  const bridgeInspection = ['side', 'above'].includes(params.get('bridgeview'))
    ? params.get('bridgeview')
    : null;
  const api = {
    place(distance, reverse = false) {
      const state = getState();
      if (views.driftRun) clearInput();
      views.driftRun = null;
      delete state.drift;
      resetView();
      const p = roadFrame(distance);
      Object.assign(state, {
        x: p.x,
        z: p.z,
        heading: p.heading + (reverse ? Math.PI : 0),
        speed: 0,
        steer: 0,
        bump: 0,
      });
      orbit.yaw = 0;
      orbit.pitch = 0.14;
      orbit.distance = 10;
      refreshCar();
      refreshCamera();
    },
    step: () => stepDrive(getState(), input, 1 / 60, colliders),
  };

  function mount() {
    window.__fieldQA = api;
    const treeAudit = document.createElement('script');
    treeAudit.type = 'application/json';
    treeAudit.id = 'leopard-tree-audit';
    document.body?.append(treeAudit);
    const corralAudit = document.createElement('script');
    corralAudit.type = 'application/json';
    corralAudit.id = 'corral-audit';
    const cartAudit = document.createElement('script');
    cartAudit.type = 'application/json';
    cartAudit.id = 'wood-cart-audit';
    const tools = document.createElement('div');
    tools.className = params.has('heistview') ? 'qa-controls qa-heist' : 'qa-controls';
    for (const [label, d] of [
      ['起点', 0],
      ['水渠样段', 12],
      ['样段末端', 24],
      ['样段返程', 24],
      ['弯道', 62],
      ['住宅', 118],
      ['返程', 190],
    ]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => {
        if (label === '起点') reset();
        else api.place(d, label.includes('返程'));
        setMode('playing');
      };
      tools.append(b);
    }
    for (const [label, yaw] of [
      ['车辆前侧', Math.PI + 0.6],
      ['车辆侧面', Math.PI / 2],
      ['车辆后侧', 0.65],
    ]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => {
        views.animal = false;
        views.vehicle = true;
        orbit.yaw = yaw;
        orbit.pitch = 0.35;
        orbit.distance = 5.8;
        refreshCamera();
      };
      tools.append(b);
    }
    const animalCheck = document.createElement('button');
    animalCheck.textContent = '金牛动作样板';
    animalCheck.onclick = () => {
      views.animalId = 'golden-cow';
      views.tree = null;
      views.animal = true;
      views.vehicle = false;
      setMode('playing');
      refreshCamera();
    };
    tools.append(animalCheck);
    const mountain = document.createElement('button');
    mountain.textContent = '狼登山观察';
    mountain.onclick = () => {
      views.animal = views.vehicle = false;
      views.zombie = views.fish = views.cart = null;
      views.mountain = 'wolf';
      void audio.unlock();
      getAnimals()?.mountain?.start(getState());
      setMode('playing');
      refreshCamera();
    };
    tools.append(mountain);
    for (const [id, label] of [
      ['golden-cow', '金牛'],
      ['copper-cow', '棕牛'],
      ['hornless-calf', '小牛'],
      ['reference-wolf', '狼'],
      ['baola-leopard', '豹拉'],
    ]) {
      const b = document.createElement('button');
      b.textContent = label + '动作';
      b.onclick = () => {
        views.animalId = id;
        views.animal = 'tail';
        views.vehicle = false;
        setMode('playing');
        refreshCamera();
      };
      tools.append(b);
    }
    const nearCharge = document.createElement('button');
    nearCharge.textContent = '公牛近车检查';
    nearCharge.onclick = () => {
      const state = getState();
      const a = getAnimals()
        .snapshot()
        .find((a) => a.id === 'copper-cow');
      if (!a || getAnimals().charge.busy()) return;
      Object.assign(state, { x: a.x + 5, z: a.z - 1, heading: 0, speed: 0, steer: 0, bump: 0 });
      views.animal = 'charge';
      views.vehicle = false;
      void audio.unlock();
      setMode('playing');
      refreshCar();
      refreshCamera();
    };
    tools.append(nearCharge);
    const chargeCheck = document.createElement('button');
    chargeCheck.textContent = '公牛顶车观察';
    chargeCheck.onclick = () => {
      views.animal = 'charge';
      views.vehicle = false;
      setMode('playing');
      refreshCamera();
    };
    tools.append(chargeCheck);
    for (const [id, label] of [
      ['copper-cow', '公牛'],
      ['golden-cow', '母牛'],
      ['hornless-calf', '小牛'],
      ['reference-wolf', '狼'],
      ['baola-leopard', '豹'],
    ]) {
      const b = document.createElement('button');
      b.textContent = label + '碰撞检查';
      b.onclick = () => {
        const state = getState();
        const a = getAnimals()
          .snapshot()
          .find((a) => a.id === id);
        if (!a) return;
        clearInput();
        Object.assign(state, {
          x:
            a.x +
            a.radius +
            VEHICLE_CONFIG.collisionHalfLength +
            VEHICLE_CONFIG.collisionCenterZ +
            0.005,
          z: a.z,
          heading: -Math.PI / 2,
          speed: 2,
          steer: 0,
          bump: 0,
        });
        views.animalId = id;
        views.animal = 'tail';
        views.vehicle = false;
        void audio.unlock();
        setMode('playing');
        let accepted = false;
        const actualHits = [];
        const hit = stepDrive(state, {}, 1 / 60, colliders, (c) => {
          accepted = getAnimals().collide(c, state, (h) => {
            actualHits.push(h.id);
            audio.animalCollision(h);
          });
        });
        state.speed = 0;
        refreshCar();
        refreshCamera();
        $('qa-report').textContent = JSON.stringify(
          {
            collision: hit,
            accepted,
            animal: id,
            actualHits,
            audio: JSON.parse(document.getElementById('audio-audit').textContent).collisionVoice,
            charge: getAnimals().charge.snapshot(),
          },
          null,
          1,
        );
      };
      tools.append(b);
    }
    for (const [id, label] of [
      ['reference-wolf', '狼触摸互动检查'],
      ['baola-leopard', '豹叫声检查'],
    ]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => {
        api.place(5);
        views.animalId = id;
        views.animal = id === 'reference-wolf' ? 'bite' : 'tail';
        void audio.unlock();
        setMode('playing');
        const accepted = audio.animalTap({ id, taps: 1 });
        $('qa-report').textContent = JSON.stringify(
          {
            accepted,
            encounters: getAnimals().encounters.snapshot(),
            mountain: getAnimals().mountain?.snapshot(),
            audio: JSON.parse($('audio-audit').textContent),
          },
          null,
          1,
        );
      };
      tools.append(b);
    }
    const followCheck = document.createElement('button');
    followCheck.textContent = '公牛回应小牛观察';
    followCheck.onclick = () => {
      views.animal = 'follow';
      views.vehicle = false;
      setMode('playing');
      refreshCamera();
    };
    tools.append(followCheck);
    const escapeCheck = document.createElement('button');
    escapeCheck.textContent = '撞牛倒车脱困检查';
    escapeCheck.onclick = () => {
      const state = getState();
      if (getAnimals().charge.busy()) return;
      const a = getAnimals()
        .snapshot()
        .find((a) => a.id === 'copper-cow');
      if (!a) return;
      clearInput();
      Object.assign(state, {
        x:
          a.x +
          a.radius +
          VEHICLE_CONFIG.collisionHalfLength +
          VEHICLE_CONFIG.collisionCenterZ -
          0.2,
        z: a.z,
        heading: -Math.PI / 2,
        speed: 0,
        steer: 0,
        bump: 0,
      });
      const start = { x: state.x, z: state.z };
      let collisions = 0;
      setMode('playing');
      for (let i = 0; i < 120; i++)
        stepDrive(state, { backward: true }, 1 / 120, colliders, () => collisions++);
      state.speed = 0;
      views.animal = 'charge';
      views.vehicle = false;
      refreshCar();
      refreshCamera();
      $('qa-report').textContent = JSON.stringify(
        {
          check: 'reverse-out-of-overlap',
          start,
          end: { x: state.x, z: state.z },
          distance: Math.hypot(state.x - start.x, state.z - start.z),
          collisions,
          vehicleHits: getAnimals().charge.snapshot().vehicleHits,
        },
        null,
        1,
      );
    };
    tools.append(escapeCheck);
    for (const [label, action] of [
      ['当前动物睡姿检查', 'rest'],
      ['当前动物起身检查', 'wake'],
    ]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => {
        views.tree = null;
        views.animal = 'sleep';
        views.vehicle = false;
        views.mountain = null;
        setMode('playing');
        getAnimals()?.[action]?.(views.animalId);
        refreshCamera();
      };
      tools.append(b);
    }
    for (const [label, action] of [
      ['豹爬树观察', 'start'],
      ['豹下树检查', 'requestDescent'],
      ['豹树与假山位置', 'overview'],
      ['豹动作推进0.1秒', 'step'],
      ['豹动作下一阶段', 'next'],
    ]) {
      const button = document.createElement('button');
      button.textContent = label;
      button.onclick = async () => {
        const advance = ++views.treeAdvance;
        views.tree = action === 'overview' ? 'overview' : 'leopard';
        views.animal = views.vehicle = false;
        views.mountain = views.zombie = views.cart = views.corral = views.campfire = null;
        if (action === 'step' || action === 'next') {
          const animals = getAnimals();
          const initial = animals?.tree?.snapshot().phase;
          if (action === 'next' && initial === 'resting') animals.tree.requestDescent();
          setMode('paused');
          $('pause-panel')?.classList.add('hidden');
          button.disabled = true;
          const count = action === 'step' ? 6 : 7200;
          try {
            for (let i = 0; i < count && advance === views.treeAdvance; i++) {
              animals?.update(1 / 60, getState(), $('time-night')?.checked ? 'night' : 'day');
              if (action === 'next' && animals?.tree?.snapshot().phase !== initial) break;
              if (i % 6 === 5) {
                refreshCamera();
                await new Promise(requestAnimationFrame);
              }
            }
          } finally {
            button.disabled = false;
            button.focus?.();
          }
        } else {
          if (action !== 'overview') getAnimals()?.tree?.[action]?.(getState());
          setMode('playing');
        }
        refreshCamera();
      };
      tools.append(button);
    }
    const familyCheck = document.createElement('button');
    familyCheck.textContent = '母子互动观察';
    familyCheck.onclick = () => {
      views.animal = 'family';
      views.vehicle = false;
      setMode('playing');
      refreshCamera();
    };
    tools.append(familyCheck);
    const grazeCheck = document.createElement('button');
    grazeCheck.textContent = '当前动物低头检查';
    grazeCheck.onclick = () => {
      views.tree = null;
      views.animal = true;
      views.vehicle = false;
      setMode('playing');
      getAnimals().graze(views.animalId);
    };
    tools.append(grazeCheck);
    const turnCheck = document.createElement('button');
    turnCheck.textContent = '当前动物转弯检查';
    turnCheck.onclick = () => {
      views.animal = 'tail';
      views.vehicle = false;
      setMode('playing');
      getAnimals().turn(views.animalId);
    };
    tools.append(turnCheck);
    const steerCheck = document.createElement('button');
    steerCheck.textContent = '车辆转向检查';
    steerCheck.onclick = () => {
      const state = getState();
      state.steer = state.steer > 0.9 ? -1 : 1;
      input.left = state.steer > 0;
      input.right = state.steer < 0;
      refreshCar();
    };
    tools.append(steerCheck);
    for (const [label, side] of [
      ['左漂移检查', 1],
      ['右漂移检查', -1],
    ]) {
      const check = document.createElement('button');
      check.textContent = label;
      check.onclick = () => {
        reset();
        setMode('playing');
        Object.assign(getState(), { x: 20, z: 0, heading: 0, speed: 8, steer: side });
        views.qaRun = null;
        views.driftRun = { side, seconds: 0, maxSlip: 0, collisions: 0, phase: 'drifting' };
        refreshCar();
        refreshCamera();
      };
      tools.append(check);
    }
    const flipCheck = document.createElement('button');
    flipCheck.textContent = '车辆翻车检查';
    flipCheck.onclick = () => {
      const state = getState();
      state.speed = 0;
      setImpact({ time: 0, side: 1, along: 0, flip: true, impacts: 2 });
      setMode('playing');
    };
    tools.append(flipCheck);
    for (const [label, near] of [
      ['房屋音乐远处', false],
      ['房屋音乐门前', true],
    ]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => {
        const state = getState();
        clearInput();
        views.animal = false;
        views.vehicle = false;
        const p = roadFrame(100);
        Object.assign(state, {
          x: near ? -37 : p.x,
          z: near ? 200 : p.z,
          heading: 0,
          speed: 0,
          steer: 0,
          bump: 0,
        });
        orbit.yaw = 0;
        void audio.unlock();
        setMode('playing');
        refreshCar();
        refreshCamera();
      };
      tools.append(b);
    }
    const houseTurn = document.createElement('button');
    houseTurn.textContent = '房屋音乐转身';
    houseTurn.onclick = () => {
      orbit.yaw += Math.PI;
      refreshCamera();
    };
    tools.append(houseTurn);
    views.report = document.createElement('pre');
    views.report.className = 'qa-report';
    views.report.id = 'qa-report';
    const perf = document.createElement('button');
    perf.textContent = '性能快照';
    perf.onclick = () => {
      views.report.textContent = JSON.stringify(snapshot(), null, 1);
    };
    tools.append(perf);
    const fish = document.createElement('button');
    fish.textContent = '金鱼游动观察';
    fish.onclick = () => {
      views.animal = views.vehicle = false;
      views.zombie = null;
      views.fish = views.fish === 'close' ? 'overview' : 'close';
      setMode('playing');
      refreshCamera();
    };
    tools.append(fish);
    const zombies = document.createElement('button');
    zombies.textContent = '僵尸走路观察';
    zombies.onclick = () => {
      views.zombie =
        views.zombie === 'overview'
          ? 'pvz-browncoat'
          : views.zombie === 'pvz-browncoat'
            ? 'pvz-conehead'
            : views.zombie === 'pvz-conehead'
              ? 'pvz-gargantuar'
              : views.zombie === 'pvz-gargantuar'
                ? 'pvz-flagbearer'
                : 'overview';
      views.fish = null;
      views.animal = false;
      views.tree = null;
      views.vehicle = false;
      setMode('playing');
      refreshCamera();
    };
    tools.append(zombies);
    const plough = document.createElement('button');
    plough.textContent = '僵尸牵牛犁田观察';
    plough.onclick = () => {
      const next = views.plough === 'close' ? 'overview' : 'close';
      resetView();
      views.plough = next;
      setMode('playing');
      refreshCamera();
    };
    tools.append(plough);
    for (const [label, view] of [
      ['扶犁工田边观察', 'worker'],
      ['长田全景', 'field'],
    ]) {
      const button = document.createElement('button');
      button.textContent = label;
      button.onclick = () => {
        resetView();
        views.plough = view;
        refreshCamera();
      };
      tools.append(button);
    }
    for (const [label, action] of [
      ['开始耕田检查', () => getPaddyPloughing()?.start()],
      ['结束耕田检查', () => getPaddyPloughing()?.stop()],
      [
        '耕田流程推进10秒',
        async () => {
          for (let i = 0; i < 100; i++) {
            await advanceCalfHeist(0.1);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        },
      ],
    ]) {
      const button = document.createElement('button');
      button.textContent = label;
      button.onclick = async () => {
        if (button.disabled) return;
        button.disabled = true;
        resetView();
        views.plough = 'overview';
        setMode('paused');
        document.getElementById('pause-panel')?.classList.add('hidden');
        try {
          await action();
        } finally {
          button.disabled = false;
          refreshCamera();
        }
      };
      tools.append(button);
    }
    const ploughAudit = document.createElement('script');
    ploughAudit.type = 'application/json';
    ploughAudit.id = 'paddy-plough-audit';
    tools.append(ploughAudit);
    const cart = document.createElement('button');
    cart.textContent = '僵尸运牛木车观察';
    cart.onclick = () => {
      views.cart = views.cart === 'rear' ? 'front' : 'rear';
      views.animal = views.vehicle = false;
      views.zombie = views.fish = null;
      setMode('playing');
      refreshCamera();
    };
    tools.append(cart);
    const gate = document.createElement('button');
    gate.textContent = '木车后栏板开合';
    gate.onclick = () => {
      const controller = getWoodenCart();
      if (!controller) return;
      controller.setCruising?.(false);
      const open = !controller.snapshot().gateOpen;
      if (controller.setGateOpen(open)) {
        if (!open) controller.setCruising?.(true);
        views.report.textContent = open ? '后栏板打开，木车保持停车。' : '后栏板关闭后继续行驶。';
      } else views.report.textContent = '木车正在减速，请停车后再点击开合。';
      views.cart = 'rear';
      views.animal = views.vehicle = false;
      views.zombie = views.fish = null;
      setMode('playing');
      refreshCamera();
    };
    tools.append(gate);
    const heistAudit = document.createElement('script');
    heistAudit.type = 'application/json';
    heistAudit.id = 'calf-heist-audit';
    const rescueAudit = document.createElement('script');
    rescueAudit.type = 'application/json';
    rescueAudit.id = 'calf-rescue-audit';
    const rescueReport = document.createElement('p');
    rescueReport.id = 'calf-rescue-report';
    rescueReport.className = 'qa-report';
    rescueReport.hidden = true;
    const pauseForThrowInspection = () => {
      setMode('paused');
      // Keep the frozen pose visible; the normal pause button still resumes play.
      document.getElementById('pause-panel')?.classList.add('hidden');
    };
    const advanceDeliveryTo = async (phase) => {
      for (let i = 0; i < 1200 && getCalfHeist()?.snapshot().phase !== phase; i++) {
        await advanceCalfHeist(0.1);
        if (i % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    function inspectRescue(near) {
      const field = getAnimals(),
        c = getCorral(),
        z = getZombies(),
        r = getCalfRescue();
      const a = field?.animal('hornless-calf');
      if (
        !a ||
        !c ||
        !r ||
        r.snapshot().phase !== 'idle' ||
        !['waiting', 'complete'].includes(getCalfHeist()?.snapshot().phase) ||
        !field.interactions.reserveTransport(a)
      ) {
        views.report.textContent = '请刷新场景，在小牛空闲时布置追逐检查。';
        return;
      }
      const place = (animal, x, zPos, heading = 0) => {
        animal.target = null;
        animal.wait = 600;
        animal.velocity = animal.motion = 0;
        animal.x = x;
        animal.z = zPos;
        animal.heading = heading;
        animal.group.position.set(x, landscapeHeight(x, zPos) + 0.025, zPos);
        animal.group.rotation.set(0, heading, 0, 'YXZ');
        Object.assign(animal.collider, { x, z: zPos });
      };
      place(field.animal('golden-cow'), -20, 15);
      place(field.animal('reference-wolf'), -34, 15);
      place(field.animal('copper-cow'), near ? -30 : -33, near ? 7 : 25, Math.PI / 2);
      restoreCalf(a);
      place(a, -26, -3, 0);
      a.rig = createAnimalAnimation(a.source, a.group, ANIMAL_PROFILES[a.id]);
      c.finishDelivery(a);
      Object.assign(a, {
        mode: 'escaping',
        outside: true,
        escapeEpoch: (a.escapeEpoch ?? 0) + 1,
        route: [{ x: -26, z: 5 }],
        routeGoal: 'home',
        home: { x: -26, z: 5 },
        cryIn: 0,
      });
      const giant = z.actor('pvz-gargantuar');
      giant.object.position.set(-24.8, landscapeHeight(-24.8, -4), -4);
      giant.object.rotation.set(0, 0, 0, 'YXZ');
      Object.assign(giant.collider, { x: -24.8, z: -4 });
      z.rebind('pvz-gargantuar');
      z.release('pvz-gargantuar');
      const observer = z.actor('pvz-browncoat');
      observer.object.position.set(-22, landscapeHeight(-22, 1), 1);
      observer.object.rotation.set(0, (Math.PI * 3) / 4, 0, 'YXZ');
      Object.assign(observer.collider, { x: -22, z: 1 });
      z.rebind(observer.layout.id);
      observer.rig.update(0.01, 0, landscapeHeight);
      z.release(observer.layout.id);
      Object.assign(getState(), { x: -22, z: -6, heading: 0, speed: 0, steer: 0 });
      clearInput();
      refreshCar();
      views.corral = 'escape';
      rescueReport.hidden = false;
      views.report.textContent = '';
    }
    function reviewCalfIsolation(lone) {
      const field = getAnimals(),
        h = getCalfHeist()?.snapshot();
      if (
        !field ||
        !h ||
        h.carrying ||
        ![
          'waiting',
          'lookout-notice',
          'crew-boarding',
          'outbound',
          'parking-at-herd',
          'opening-at-herd',
          'herd-dismount',
          'seek-calf',
          'face-calf',
          'crouch-and-grip',
        ].includes(h.phase)
      )
        return;
      const cows = ANIMAL_LAYOUT.slice(0, 3).map((a) => field.animal(a.id));
      if (cows.some((a) => !a || (field.interactions.owns(a) && a.transportOwner !== 'heist')))
        return;
      const obstacles = colliders.filter((c) => !cows.some((a) => a.collider === c));
      const residents = ANIMAL_LAYOUT.map((a) => field.animal(a.id)).filter(Boolean);
      const placements = cows.map((a, i) => ({
        a,
        x: ANIMAL_LAYOUT[i].x,
        z: lone && i === 2 ? 15.8 : ANIMAL_LAYOUT[i].z,
      }));
      if (
        placements.some(
          ({ a, x, z }) => !animalPointAllowed(x, z, a, obstacles, residents, getState(), cows),
        )
      ) {
        views.report.textContent = '检查位置被车辆或场景占用，请移开后重试。';
        return;
      }
      for (const { a, x, z } of placements) {
        restoreCalf(a);
        Object.assign(a, { x, z, target: null, velocity: 0, motion: 0, wait: 600 });
        a.group.position.set(x, landscapeHeight(x, z) + 0.025, z);
        Object.assign(a.collider, { x, z });
        a.rig = createAnimalAnimation(a.source, a.group, ANIMAL_PROFILES[a.id]);
      }
      views.report.textContent = lone
        ? '小牛离开两头成年牛，连续4秒后触发；检查期间三牛暂留原地。'
        : '小牛回到牛群，抱起前应取消抓捕。';
    }
    for (const [label, action] of [
      ['公牛近路线救援检查', () => inspectRescue(true)],
      ['公牛远路线追回检查', () => inspectRescue(false)],
      [
        '公牛顶飞接触检查',
        () => {
          inspectRescue(true);
          const z = getZombies(),
            giant = z?.actor('pvz-gargantuar');
          if (!giant || getCalfRescue()?.snapshot().phase !== 'idle') return;
          giant.object.position.set(-27, landscapeHeight(-27, 7), 7);
          giant.object.rotation.set(0, 0, 0, 'YXZ');
          Object.assign(giant.collider, { x: -27, z: 7 });
          z.rebind('pvz-gargantuar');
          z.release('pvz-gargantuar');
        },
      ],
      [
        '追逐推进10秒',
        async () => {
          for (let i = 0; i < 20; i++) {
            advanceCalfHeist(0.5);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        },
      ],
      ['追逐推进0.1秒', () => advanceCalfHeist(0.1)],
      ['搬牛流程观察', () => {}],
      ['瞭望塔观察', () => {}],
      ['瞭望员近景', () => {}],
      ['小牛落单触发检查', () => reviewCalfIsolation(true)],
      ['小牛回到牛群检查', () => reviewCalfIsolation(false)],
      ['牛群落单观察', () => {}],
      ['只看抱牛 / 重播', () => getCalfHeist()?.previewCarry()],
      ['抛牛装车 / 重播', () => getCalfHeist()?.previewThrow()],
      [
        '切换抱法（出发前）',
        () => {
          const h = getCalfHeist();
          if (!h?.setCarryMode(h.snapshot().carryMode === 'underarm' ? 'two-hand' : 'underarm'))
            views.report.textContent = '已出发，抱法下次出发前选择。';
        },
      ],
      ['搬牛流程推进10秒', () => advanceCalfHeist(10)],
      ['卸牛抛入栏 / 拍头检查', () => getCalfHeist()?.previewDelivery()],
      ['卸牛推进到抛牛', () => advanceDeliveryTo('corral-throw-windup')],
      ['卸牛推进到拍头', () => advanceDeliveryTo('pat-guard')],
      ['搬牛流程推进1秒', () => advanceCalfHeist(1)],
      ['抛牛动作逐帧0.1秒', () => advanceCalfHeist(0.1)],
    ]) {
      const button = document.createElement('button');
      button.textContent = label;
      button.className = 'heist-button';
      button.onclick = () => {
        const inspection = label.startsWith('卸牛') || label === '抛牛动作逐帧0.1秒';
        if (inspection) pauseForThrowInspection();
        else setMode('playing');
        const pending = action();
        if (pending?.finally) {
          button.disabled = true;
          pending.finally(() => {
            button.disabled = false;
            if (inspection) pauseForThrowInspection();
          });
        }
        if (label === '抛牛装车 / 重播' || label === '卸牛抛入栏 / 拍头检查')
          pauseForThrowInspection();
        if (label === '抛牛动作逐帧0.1秒' && !pending?.finally) pauseForThrowInspection();
        if (
          label.includes('路线') ||
          label.startsWith('追逐推进') ||
          label === '公牛顶飞接触检查'
        ) {
          views.heist = false;
          views.animal = views.vehicle = false;
          views.zombie = views.cart = views.fish = null;
          views.corral = 'escape';
          setMode('playing');
          refreshCamera();
          return;
        }
        tools.className = 'qa-controls qa-heist';
        views.heist =
          label === '瞭望塔观察'
            ? 'tower'
            : label === '瞭望员近景'
              ? 'lookout'
              : label.startsWith('搬牛流程推进') || label === '抛牛动作逐帧0.1秒'
                ? views.heist
                : label !== '牛群落单观察';
        views.cart = views.corral = views.zombie = null;
        views.animal = label === '牛群落单观察' ? 'family' : false;
        views.vehicle = false;
        refreshCamera();
      };
      tools.append(button);
    }

    for (const [label, action] of [
      [
        '围栏小牛叫声检查',
        () => {
          const field = getAnimals(),
            c = getCorral(),
            a = field?.animal('hornless-calf');
          if (
            !c ||
            !a ||
            getCalfHeist()?.snapshot().phase !== 'waiting' ||
            !field.interactions.reserveTransport(a)
          ) {
            views.report.textContent = '请在小牛空闲、抓捕尚未出发时检查。';
            return;
          }
          restoreCalf(a);
          Object.assign(a, { x: 164, z: 24, target: null, velocity: 0, motion: 0, wait: 600 });
          a.group.position.set(a.x, landscapeHeight(a.x, a.z) + 0.025, a.z);
          Object.assign(a.collider, { x: a.x, z: a.z });
          a.rig = createAnimalAnimation(a.source, a.group, ANIMAL_PROFILES[a.id]);
          c.finishDelivery(a);
          Object.assign(getState(), { x: 132, z: 23, heading: 0, speed: 0, steer: 0 });
          clearInput();
          refreshCar();
          tools.className = 'qa-controls';
          views.corral = 'close';
          views.report.textContent = '同一小牛直接交给围栏；每30秒独立抽50%，靠近车辆可听到。';
        },
      ],
      ['围栏叫声推进30秒', () => advanceCalfHeist(30)],
      [
        '围栏与牵牛观察',
        () => {
          views.corral = views.corral === 'close' ? 'overview' : 'close';
        },
      ],
      [
        '围栏门开合',
        () => {
          const c = getCorral();
          if (c && !c.setManualGateOpen(!c.snapshot().gateRequested))
            views.report.textContent = c.snapshot().controlled
              ? '正在送小牛入栏，请稍候。'
              : '门边有东西挡住了，请移开后再试。';
        },
      ],
      ['僵尸关围栏门', () => getCorral()?.requestGuardClose()],
      [
        '逃跑动物观察',
        () => {
          views.corral = 'escape';
        },
      ],
    ]) {
      const b = document.createElement('button');
      b.textContent = label;
      if (label === '围栏小牛叫声检查') b.className = 'heist-button';
      b.onclick = () => {
        action();
        views.animal = views.vehicle = false;
        views.heist = false;
        views.cart = views.zombie = views.fish = null;
        views.corral ||= 'close';
        setMode('playing');
        refreshCamera();
      };
      tools.append(b);
    }
    const drive = document.createElement('button');
    drive.textContent = '往返驾驶检查';
    drive.onclick = () => {
      api.place(5);
      setMode('playing');
      views.qaRun = {
        phase: 'outward',
        collisions: 0,
        maxDeviation: 0,
        started: performance.now(),
      };
      views.report.textContent = '正在使用原驾驶物理往返检查…';
    };
    tools.append(drive);
    const sample = document.createElement('button');
    sample.textContent = '水渠往返检查';
    sample.onclick = () => {
      api.place(3);
      setMode('playing');
      views.qaRun = {
        phase: 'outward',
        start: 3,
        end: 28,
        collisions: 0,
        maxDeviation: 0,
        started: performance.now(),
      };
      views.report.textContent = '正在检查水渠样段前后衔接…';
    };
    tools.append(sample);
    const hide = document.createElement('button');
    hide.textContent = '隐藏验收工具';
    hide.onclick = () => {
      tools.remove();
      views.report.remove();
    };
    tools.append(hide);
    const corralButtons = new Set([
      '围栏小牛叫声检查',
      '围栏叫声推进30秒',
      '围栏与牵牛观察',
      '围栏门开合',
      '僵尸关围栏门',
      '逃跑动物观察',
    ]);
    const treeButtons = new Set([
      '豹爬树观察',
      '豹下树检查',
      '豹树与假山位置',
      '豹动作推进0.1秒',
      '豹动作下一阶段',
    ]);
    if (params.has('treeview'))
      for (const button of tools.children)
        if (!treeButtons.has(button.textContent) && button.textContent !== '隐藏验收工具')
          button.style.display = 'none';
    for (const button of tools.children) {
      if (['性能快照', '隐藏验收工具'].includes(button.textContent) || !button.onclick) continue;
      const action = button.onclick;
      button.onclick = (...args) => {
        inspectionCamera.reset();
        views.queryEnabled = false;
        if (!corralButtons.has(button.textContent)) views.corral = null;
        if (!treeButtons.has(button.textContent)) {
          views.tree = null;
          views.treeAdvance++;
        }
        return action(...args);
      };
    }
    $('game').append(
      tools,
      views.report,
      cartAudit,
      corralAudit,
      heistAudit,
      rescueAudit,
      rescueReport,
    );
    const state = getState();
    if (params.has('view')) {
      api.place(Number(params.get('view')), params.has('reverse'));
      setMode('playing');
    }
    // URL presets apply only on initial entry, until the user selects another view or resets.
    views.queryEnabled = true;
    views.fish = params.get('fishview');
    views.zombie = params.get('zombieview');
    views.cart = params.get('cartview');
    views.corral = params.get('corralview');
    views.campfire = params.get('campfireview');
    views.mountain = params.get('mountainview');
    if (params.has('paddyview')) {
      Object.assign(state, { x: 8, z: 7.075, heading: Math.PI / 2, speed: 0, steer: 0 });
      refreshCar();
      refreshCamera();
    }
    if (params.has('carview')) {
      views.vehicle = true;
      orbit.yaw =
        { front: Math.PI + 0.6, side: Math.PI / 2, rear: 0.65 }[params.get('carview')] ?? 0.65;
      orbit.pitch = 0.35;
      orbit.distance = 5.8;
      refreshCamera();
    }
    if (params.has('animalview')) {
      views.animalId = params.get('animal') || 'golden-cow';
      views.animal = ['tail', 'family', 'charge', 'face'].includes(params.get('animalview'))
        ? params.get('animalview')
        : true;
      views.vehicle = false;
      setMode('playing');
      refreshCamera();
    }
    if (params.has('capture')) {
      tools.style.display = 'none';
      views.report.style.display = 'none';
    }
    views.tree = params.get('treeview');
    if (views.tree) {
      if (views.tree === 'leopard') getAnimals()?.tree?.start(getState());
      setMode('playing');
      refreshCamera();
    }
    if (views.mountain) {
      if (views.mountain === 'wolf') getAnimals()?.mountain?.start(getState());
      setMode('playing');
      refreshCamera();
    }
    if (
      views.zombie ||
      views.cart ||
      views.campfire ||
      views.corral ||
      params.has('crewcartview')
    ) {
      setMode('playing');
      refreshCamera();
    }
  }
  function updateInspectionCamera(camera) {
    // Explicit capture diagnostics: publish frame data through the existing DOM
    // report so a running scene can be measured without opening/focusing tools.
    if (params.has('perf') && views.report && performance.now() - views.perfAuditAt > 500) {
      const { mode, performance: frames, renderCalls, triangles, viewport } = snapshot();
      views.report.textContent = JSON.stringify({
        mode,
        performance: frames,
        renderCalls,
        triangles,
        viewport,
      });
      views.perfAuditAt = performance.now();
    }
    if (!updateInspectionPreset(inspectionView)) {
      inspectionCamera.reset();
      return false;
    }
    inspectionCamera.update(camera, inspectionView.position, inspectionView.target);
    return true;
  }
  const updateInspectionPreset = createInspectionPresets({
    views,
    params,
    getPaddyPloughing,
    getWoodenCart,
    getCalfHeist,
    getCalfRescue,
    getAnimals,
    getCorral,
    getZombies,
    getState,
    getCampsite,
    bridgeInspection,
  });
  function beforeDrive() {
    const state = getState();
    if (views.driftRun) {
      const turning = views.driftRun.seconds < 1.1;
      Object.assign(input, {
        forward: views.driftRun.seconds < 2.7,
        backward: false,
        left: turning && views.driftRun.side > 0,
        right: turning && views.driftRun.side < 0,
        drift: turning,
        brake: views.driftRun.seconds >= 2.7,
      });
    }
    if (views.qaRun) {
      const direction = views.qaRun.phase === 'return' ? -1 : 1,
        target = roadFrame(
          Math.max(
            views.qaRun.start ?? 5,
            Math.min(views.qaRun.end ?? 195, state.z + direction * 5),
          ),
        ),
        desired =
          Math.atan2(target.x - state.x, target.z - state.z) + (direction < 0 ? Math.PI : 0),
        error =
          Math.atan2(Math.sin(desired - state.heading), Math.cos(desired - state.heading)) *
          direction;
      Object.assign(input, {
        forward: views.qaRun.phase === 'outward',
        backward: views.qaRun.phase === 'return',
        left: error > 0.012,
        right: error < -0.012,
        brake: views.qaRun.phase === 'braking',
      });
    }
  }
  function afterDrive(hit, dt = 0) {
    const state = getState();
    if (views.driftRun) {
      views.driftRun.seconds += dt;
      views.driftRun.maxSlip = Math.max(
        views.driftRun.maxSlip,
        Math.abs(state.drift?.slipAngle ?? 0),
      );
      if (hit) views.driftRun.collisions++;
      views.driftRun.phase =
        views.driftRun.seconds < 1.1
          ? 'drifting'
          : views.driftRun.seconds < 2.7
            ? 'recovering'
            : 'braking';
      views.report.textContent = JSON.stringify(
        { ...views.driftRun, drift: state.drift, speed: state.speed },
        null,
        1,
      );
      if (views.driftRun.seconds > 2.7 && Math.abs(state.speed) < 0.05) {
        api.lastDriftRun = { ...views.driftRun, phase: 'complete', recovered: !state.drift };
        views.report.textContent = JSON.stringify(api.lastDriftRun, null, 1);
        views.driftRun = null;
        clearInput();
      }
    }
    if (views.qaRun) {
      if (hit) views.qaRun.collisions++;
      views.qaRun.maxDeviation = Math.max(
        views.qaRun.maxDeviation,
        Math.abs(state.x - roadFrame(state.z).x),
      );
      if (views.qaRun.phase === 'outward' && state.z >= (views.qaRun.end ?? 195) - 1)
        views.qaRun.phase = 'braking';
      if (views.qaRun.phase === 'braking' && Math.abs(state.speed) < 0.05)
        views.qaRun.phase = 'return';
      if (views.qaRun.phase === 'return' && state.z <= (views.qaRun.start ?? 5) + 1) {
        views.qaRun.phase = 'complete';
        const result = {
          ...views.qaRun,
          elapsedSeconds: (performance.now() - views.qaRun.started) / 1000,
        };
        views.qaRun = null;
        clearInput();
        state.speed = 0;
        views.report.textContent = JSON.stringify(result, null, 1);
        api.lastRun = result;
      }
    }
  }

  function applyVehicleCamera(cameraTarget, lookTarget, angle, pitch, distance) {
    if (!views.vehicle) return;
    const state = getState(),
      d = distance * Math.cos(pitch);
    cameraTarget.set(
      state.x - Math.sin(angle) * d,
      drivingHeight(state.x, state.z) + 0.9 + distance * Math.sin(pitch),
      state.z - Math.cos(angle) * d,
    );
    lookTarget.set(state.x, drivingHeight(state.x, state.z) + 1.02, state.z);
  }
  function resetView() {
    views.treeAdvance++;
    inspectionCamera.reset();
    views.queryEnabled = false;
    views.heist = false;
    views.plough = null;
    if (views.driftRun) clearInput();
    views.driftRun = null;
    views.animal = false;
    views.tree = null;
    views.mountain = null;
    views.fish = null;
    views.vehicle = false;
    views.zombie = null;
    views.cart = null;
    views.corral = null;
    views.campfire = null;
  }
  return {
    mount,
    updateInspectionCamera,
    inspectionCamera,
    applyVehicleCamera,
    beforeDrive,
    afterDrive,
    resetView,
  };
}
