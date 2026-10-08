import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createFieldQA } from '../src/field-qa.js';
import { createFieldObserver } from '../src/field-observer.js';
import { spawnState, roadFrame, drivingHeight } from '../src/drive.js';
import { ANIMAL_LAYOUT } from '../src/field-animals.js';
import { VEHICLE_CONFIG } from '../src/vehicle-config.js';

// Captured before extraction, not generated from the module under test.
const contract = JSON.parse(
  readFileSync(new URL('./fixtures/field-qa-contract.json', import.meta.url)),
);
function fixture(t, query = 'qa=1', woodenCart = null, corral = null, plough = null) {
  const old = Object.fromEntries(
    ['document', 'window', 'innerWidth', 'innerHeight'].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  t.after(() => {
    for (const [k, d] of Object.entries(old)) {
      if (d) Object.defineProperty(globalThis, k, d);
      else delete globalThis[k];
    }
  });
  const nodes = new Map();
  class Element {
    children = [];
    style = {};
    textContent = '';
    removed = false;
    append(...children) {
      this.children.push(...children);
      for (const n of children) if (n.id) nodes.set(n.id, n);
    }
    remove() {
      this.removed = true;
    }
  }
  nodes.set('game', new Element());
  globalThis.document = {
    createElement: () => new Element(),
    getElementById: (id) => nodes.get(id),
  };
  globalThis.window = {};
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 720;
  let state = spawnState(),
    mode = 'intro',
    impact = null;
  const input = { forward: false, backward: false, left: false, right: false, brake: false };
  const orbit = { yaw: 0, pitch: 0.14, distance: 10 };
  const animals = {
    snapshot: () => ANIMAL_LAYOUT.map((a) => ({ ...a, heading: 0 })),
    charge: { busy: () => false, snapshot: () => ({ vehicleHits: 0 }) },
  };
  let refreshes = 0,
    unlocks = 0;
  const qa = createFieldQA({
    params: new URLSearchParams(query),
    getState: () => state,
    getAnimals: () => animals,
    getWoodenCart: () => woodenCart,
    getCorral: () => corral,
    getPaddyPloughing: () => plough,
    input,
    colliders: [],
    orbit,
    audio: {
      unlock: () => {
        unlocks++;
      },
    },
    clearInput: () => {
      for (const k in input) input[k] = false;
    },
    setMode: (next) => {
      mode = next;
    },
    reset: () => {
      state = spawnState();
      qa.resetView();
    },
    refreshCar: () => refreshes++,
    refreshCamera: () => refreshes++,
    setImpact: (x) => {
      impact = x;
    },
    snapshot: () => ({ mode, ...state, camera: { ...orbit } }),
  });
  const button = (label) => {
    const b = nodes.get('game').children[0].children.find((b) => b.textContent === label);
    assert.ok(b, label);
    b.onclick();
  };
  return {
    qa,
    nodes,
    button,
    input,
    orbit,
    animals,
    get state() {
      return state;
    },
    get mode() {
      return mode;
    },
    get impact() {
      return impact;
    },
    get refreshes() {
      return refreshes;
    },
    get unlocks() {
      return unlocks;
    },
  };
}

test('plough inspection follows the real cow, switches overview and releases on camera reset', (t) => {
  const group = new THREE.Group();
  group.position.set(105, 0.151, 20);
  const plough = {
    cow: { group, heading: 0 },
    snapshot: () => ({ cow: { position: group.position.toArray() } }),
  };
  const f = fixture(t, 'qa=1&ploughview=close', null, null, plough);
  f.qa.mount();
  const camera = new THREE.PerspectiveCamera();
  assert(f.qa.updateInspectionCamera(camera));
  const near = camera.position.clone();
  group.position.x += 2;
  assert(f.qa.updateInspectionCamera(camera));
  assert(Math.abs(camera.position.x - near.x - 2) < 1e-8);
  f.button('僵尸牵牛犁田观察');
  assert(f.qa.updateInspectionCamera(camera));
  assert(camera.position.y > near.y + 10);
  f.button('金鱼游动观察');
  assert(f.qa.updateInspectionCamera(camera));
  f.qa.resetView();
  assert.equal(f.qa.updateInspectionCamera(camera), false);
});

test('QA preserves all 39 controls, global place/step, and uses replacement state after reset', (t) => {
  const f = fixture(t);
  assert.equal(window.__fieldQA, undefined);
  f.qa.mount();
  assert.deepEqual(
    f.nodes
      .get('game')
      .children[0].children.map((b) => b.textContent)
      .filter((label) => contract.buttons.includes(label)),
    contract.buttons,
  );
  assert.deepEqual(Object.keys(window.__fieldQA), ['place', 'step']);
  window.__fieldQA.place(62, true);
  const p = roadFrame(62);
  assert.equal(f.state.x, p.x);
  assert.equal(f.state.z, p.z);
  assert.equal(f.state.heading, p.heading + Math.PI);
  const old = f.state;
  f.button('起点');
  assert.notEqual(f.state, old);
  window.__fieldQA.place(12);
  assert.equal(f.state.z, 12);
  assert.equal(old.z, 62);
  f.input.forward = true;
  assert.equal(typeof window.__fieldQA.step(), 'boolean');
  assert.ok(f.state.speed > 0);
  assert.equal(f.mode, 'playing');
  f.button('车辆翻车检查');
  assert.deepEqual(f.impact, { time: 0, side: 1, along: 0, flip: true, impacts: 2 });
  assert.equal(f.unlocks, 0);
});

test('wood cart inspection follows its live position and road placement releases that camera', (t) => {
  const state = { position: [160.2, 0.126, 10], heading: Math.PI };
  const f = fixture(t, 'qa=1&cartview=rear&capture=1', { snapshot: () => state });
  f.qa.mount();
  const camera = new THREE.PerspectiveCamera();
  assert(f.qa.updateInspectionCamera(camera));
  const before = camera.position.clone();
  state.position[0] += 4;
  assert(f.qa.updateInspectionCamera(camera));
  assert(Math.abs(camera.position.x - before.x - 4) < 1e-10);
  assert.equal(JSON.parse(f.nodes.get('wood-cart-audit').textContent).position[0], 164.2);
  window.__fieldQA.place(12);
  assert.equal(f.qa.updateInspectionCamera(camera), false);
  f.button('僵尸运牛木车观察');
  assert(f.qa.updateInspectionCamera(camera));
  f.qa.resetView();
  assert.equal(f.qa.updateInspectionCamera(camera), false);
});

test('crew cart gate controls work without the legacy cruising interface', (t) => {
  let gateOpen = false;
  const requests = [];
  const f = fixture(t, 'qa=1', {
    snapshot: () => ({ position: [162, 0.12, 8], heading: 0, gateOpen }),
    setGateOpen(open) {
      requests.push(open);
      gateOpen = open;
      return true;
    },
  });
  f.qa.mount();
  f.button('木车后栏板开合');
  f.button('木车后栏板开合');
  assert.deepEqual(requests, [true, false]);
});

test('drift QA drives the real simulation, records side slip and recovers before stopping', (t) => {
  const f = fixture(t);
  f.qa.mount();
  for (const label of ['左漂移检查', '右漂移检查']) {
    delete window.__fieldQA.lastDriftRun;
    f.button(label);
    for (let i = 0; i < 600 && !window.__fieldQA.lastDriftRun; i++) {
      f.qa.beforeDrive();
      f.qa.afterDrive(window.__fieldQA.step(), 1 / 60);
    }
    const result = window.__fieldQA.lastDriftRun;
    assert.equal(result.phase, 'complete');
    assert.equal(result.collisions, 0);
    assert.equal(result.recovered, true);
    assert(result.maxSlip > 0.3);
    assert.equal(f.state.speed, 0);
    assert(Object.values(f.input).every((value) => value === false));
  }
});

test('goldfish QA toggles close and overview cameras while preserving normal driving state', (t) => {
  const f = fixture(t, 'qa=1&view=12&fishview=close');
  f.qa.mount();
  const camera = new THREE.PerspectiveCamera();
  assert.equal(f.qa.updateInspectionCamera(camera), true);
  const near = camera.position.clone(),
    before = { ...f.state };
  f.button('金鱼游动观察');
  assert.equal(f.qa.updateInspectionCamera(camera), true);
  assert(camera.position.y > near.y + 1);
  assert.deepEqual(f.state, before);
  f.button('金鱼游动观察');
  f.qa.updateInspectionCamera(camera);
  assert(camera.position.distanceTo(near) < 1e-9);
  assert.equal(f.mode, 'playing');
});

test('query view/reverse/capture retains placement, mode and hidden controls', (t) => {
  const f = fixture(t, 'qa=1&view=62&reverse&capture');
  f.qa.mount();
  assert.equal(f.state.z, 62);
  assert.equal(f.state.heading, roadFrame(62).heading + Math.PI);
  assert.equal(f.mode, 'playing');
  assert.equal(f.nodes.get('game').children[0].style.display, 'none');
  assert.equal(f.nodes.get('qa-report').style.display, 'none');
});

test('vehicle and animal inspection modes reset to ordinary camera without stale state', (t) => {
  const f = fixture(t, 'qa=1&view=5&animalview=face&animal=baola-leopard');
  f.qa.mount();
  const c = new THREE.PerspectiveCamera();
  assert.equal(f.qa.updateInspectionCamera(c), true);
  const a = f.animals.snapshot().find((a) => a.id === 'baola-leopard');
  assert.ok(
    c.position.distanceTo(
      new THREE.Vector3(a.x + 0.08, drivingHeight(a.x, a.z) + 1.03, a.z + 1.8),
    ) < 1e-9,
  );
  f.qa.resetView();
  assert.equal(f.qa.updateInspectionCamera(c), false);
  f.button('车辆侧面');
  assert.deepEqual(f.orbit, { yaw: Math.PI / 2, pitch: 0.35, distance: 5.8 });
  const target = new THREE.Vector3(),
    look = new THREE.Vector3();
  f.qa.applyVehicleCamera(target, look, Math.PI / 2, 0.35, 5.8);
  assert.ok(Math.abs(target.x - (f.state.x - 5.8 * Math.cos(0.35))) < 1e-9);
  assert.equal(look.y, drivingHeight(f.state.x, f.state.z) + 1.02);
  f.qa.resetView();
  target.set(1, 2, 3);
  f.qa.applyVehicleCamera(target, look, 0, 0, 10);
  assert.deepEqual(target.toArray(), [1, 2, 3]);
});

test('all five animal presets rotate, follow live movement, and reset when reselected', (t) => {
  const f = fixture(t, 'qa=1&view=5&animalview=tail');
  const live = f.animals.snapshot();
  f.animals.snapshot = () => live;
  f.qa.mount();
  const camera = new THREE.PerspectiveCamera();
  for (const [label, id] of [
    ['金牛动作', 'golden-cow'],
    ['棕牛动作', 'copper-cow'],
    ['小牛动作', 'hornless-calf'],
    ['狼动作', 'reference-wolf'],
    ['豹拉动作', 'baola-leopard'],
  ]) {
    f.button(label);
    assert(f.qa.updateInspectionCamera(camera));
    const preset = camera.position.clone();
    f.qa.inspectionCamera.rotate(120, 10);
    f.qa.updateInspectionCamera(camera);
    const rotated = camera.position.clone();
    assert(rotated.distanceTo(preset) > 1, label);
    f.qa.updateInspectionCamera(camera);
    assert(camera.position.distanceTo(rotated) < 1e-9, label);
    const animal = live.find((a) => a.id === id);
    animal.x += 1;
    animal.heading += 0.4;
    f.qa.updateInspectionCamera(camera);
    assert(Math.abs(camera.position.x - rotated.x - 1) < 1e-9, label);
    f.button(label);
    f.qa.updateInspectionCamera(camera);
    assert(camera.position.distanceTo(rotated) > 1, label);
  }
  f.qa.resetView();
  assert.equal(f.qa.updateInspectionCamera(camera), false);
  assert.equal(f.qa.inspectionCamera.active, false);
});

test('group, mountain, tree, goldfish, cart and corral inspections share manual orbit and release on reset', (t) => {
  const cart = { snapshot: () => ({ position: [160, 0.5, 10], heading: 0 }) };
  const corral = { snapshot: () => ({ position: [160, 0.5, 5], phase: 'idle', animals: [] }) };
  const f = fixture(t, 'qa=1&view=5&animalview=tail', cart, corral);
  const live = f.animals.snapshot().map((a) => ({ ...a, y: drivingHeight(a.x, a.z) }));
  f.animals.snapshot = () => live;
  f.animals.mountain = { start: () => {}, snapshot: () => ({ sheltered: false }) };
  f.animals.tree = { start: () => {}, snapshot: () => ({ tree: { position: [-34, 0, 28] } }) };
  f.qa.mount();
  const camera = new THREE.PerspectiveCamera();
  for (const label of [
    '母子互动观察',
    '公牛顶车观察',
    '公牛回应小牛观察',
    '狼登山观察',
    '豹爬树观察',
    '金鱼游动观察',
    '僵尸运牛木车观察',
    '围栏与牵牛观察',
  ]) {
    f.button(label);
    assert(f.qa.updateInspectionCamera(camera), label);
    const preset = camera.position.clone();
    f.qa.inspectionCamera.rotate(100, 25);
    f.qa.updateInspectionCamera(camera);
    assert(camera.position.distanceTo(preset) > 0.3, label);
    assert(camera.position.toArray().every(Number.isFinite), label);
    f.qa.resetView();
    assert.equal(f.qa.updateInspectionCamera(camera), false, label);
  }
  // Direct switches must not keep the old animal/tree camera ahead of the new target.
  f.button('豹爬树观察');
  f.qa.updateInspectionCamera(camera);
  f.button('金鱼游动观察');
  f.qa.updateInspectionCamera(camera);
  assert(camera.position.z > 15 && camera.position.z < 20);
  f.button('小牛动作');
  f.qa.updateInspectionCamera(camera);
  assert(camera.position.distanceTo(new THREE.Vector3(live[2].x, live[2].y, live[2].z)) < 5);
});

test('C/reset releases URL-only fixed cameras as well as fish/tree/mountain/corral modes', (t) => {
  const f = fixture(t);
  const camera = new THREE.PerspectiveCamera();
  for (const query of [
    'qa=1&houseview=front',
    'qa=1&culvertview=start',
    'qa=1&bridgeview=side',
    'qa=1&waterview=canal',
  ]) {
    const qa = createFieldQA({
      params: new URLSearchParams(query),
      getState: () => f.state,
      getAnimals: () => undefined,
    });
    assert(qa.updateInspectionCamera(camera), query);
    qa.inspectionCamera.rotate(80, 10);
    qa.resetView();
    assert.equal(qa.updateInspectionCamera(camera), false, query);
  }
});

test('paddy and car query modes keep their original orbit and do not auto-start alone', (t) => {
  const f = fixture(t, 'qa=1&paddyview&carview=front');
  f.qa.mount();
  assert.equal(f.state.x, 8);
  assert.equal(f.state.z, 7.075);
  assert.equal(f.state.heading, Math.PI / 2);
  assert.equal(f.mode, 'intro');
  assert.deepEqual(f.orbit, { yaw: Math.PI + 0.6, pitch: 0.35, distance: 5.8 });
});

test('fixed house, culvert and bridge query cameras work before animals finish loading', (t) => {
  const f = fixture(t);
  const camera = new THREE.PerspectiveCamera();
  for (const query of [
    'qa=1&houseview=front',
    'qa=1&houseview=rear',
    'qa=1&houseview=overview',
    'qa=1&culvertview=start',
    'qa=1&culvertview=end',
    'qa=1&bridgeview=side&bridge=21',
    'qa=1&bridgeview=above&bridge=21',
  ]) {
    const q = createFieldQA({
      params: new URLSearchParams(query),
      getState: () => f.state,
      getAnimals: () => undefined,
    });
    assert.equal(q.updateInspectionCamera(camera), true, query);
    assert.ok(camera.position.toArray().every(Number.isFinite), query);
  }
});

test('QA run continues through the real drive integrator and completes after hiding tools', (t) => {
  const f = fixture(t);
  f.qa.mount();
  f.button('水渠往返检查');
  f.button('隐藏验收工具');
  let sawReturn = false;
  for (let i = 0; i < 30000 && !window.__fieldQA.lastRun; i++) {
    f.qa.beforeDrive();
    sawReturn ||= f.input.backward;
    f.qa.afterDrive(window.__fieldQA.step());
  }
  assert.ok(sawReturn);
  assert.equal(window.__fieldQA.lastRun.phase, 'complete');
  assert.equal(window.__fieldQA.lastRun.collisions, 0);
  assert.equal(f.state.speed, 0);
  assert.ok(Object.values(f.input).every((v) => v === false));
  assert.equal(f.nodes.get('qa-report').removed, true);
  assert.equal(JSON.parse(f.nodes.get('qa-report').textContent).phase, 'complete');
});

test('observer keeps baseline snapshot fields, live state, ground gaps and bounded sampling', (t) => {
  const f = fixture(t);
  const steerGroup = new THREE.Group(),
    rollGroup = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.2));
  steerGroup.add(rollGroup);
  steerGroup.position.set(
    0,
    drivingHeight(0, 0) + VEHICLE_CONFIG.groundOffset + VEHICLE_CONFIG.wheelRadius,
    0,
  );
  steerGroup.updateMatrixWorld(true);
  const animals = {
    snapshot: () => [{ id: 'test' }],
    family: { snapshot: () => ({ phase: 'idle' }) },
    encounters: { snapshot: () => ({ busy: false }) },
    charge: { snapshot: () => ({ phase: 'idle' }) },
  };
  const field = { animals, summerGrass: { snapshot: () => ({ blades: 10 }) }, warnings: [] };
  const o = createFieldObserver({
    readGame: () => ({ mode: f.mode, ...f.state, camera: { ...f.orbit }, input: { ...f.input } }),
    getRenderer: () => ({
      info: { render: { calls: 4, triangles: 20 } },
      getPixelRatio: () => 1.5,
    }),
    getWheels: () => [{ steerGroup, rollGroup, front: true }],
    getField: () => field,
    getImpact: () => null,
  });
  o.recordFrame(100000, 20, 0.02);
  assert.equal(o.snapshot().performance.samples, 0);
  o.start();
  for (let i = 0; i < 300; i++) o.recordFrame(100000, 10 + i, 0.01);
  o.recordFrame(100000, 999, 0);
  const s = o.snapshot();
  // New diagnostics may be additive; every established field and its order must survive.
  assert.deepEqual(
    Object.keys(s).filter((key) => contract.snapshotKeys.includes(key)),
    contract.snapshotKeys,
  );
  assert.deepEqual(Object.keys(s.camera), contract.cameraKeys);
  assert.deepEqual(Object.keys(s.performance), contract.performanceKeys);
  assert.equal(s.performance.samples, 240);
  assert.equal(s.performance.meanFrameMs, 189.5);
  assert.equal(s.performance.p95FrameMs, 298);
  assert.ok(Math.abs(s.wheelGroundGaps[0]) < 1e-9);
  assert.equal(s.threeRevision, '180');
  assert.deepEqual(s.assetWarnings, []);
  field.goldfish = { snapshot: () => ({ elapsed: 12, fish: [{ name: 'real fish' }] }) };
  assert.deepEqual(o.snapshot().goldfish, field.goldfish.snapshot());
  f.qa.mount();
  f.button('起点');
  window.__fieldQA.place(62);
  assert.equal(o.snapshot().z, 62);
  o.start();
  assert.equal(o.snapshot().performance.samples, 0);
});

test('tree QA yields between batches and cancels when resetting the view', async (t) => {
  const f = fixture(t, 'qa=1&treeview=leopard');
  const oldFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  t.after(() => {
    if (oldFrame) Object.defineProperty(globalThis, 'requestAnimationFrame', oldFrame);
    else delete globalThis.requestAnimationFrame;
  });
  let resume,
    steps = 0;
  globalThis.requestAnimationFrame = (callback) => {
    resume = callback;
  };
  f.animals.tree = {
    start: () => {},
    snapshot: () => ({ phase: 'ascending', tree: { position: [-34, 0, 28] } }),
  };
  f.animals.update = () => {
    steps++;
  };
  f.qa.mount();
  const button = f.nodes
    .get('game')
    .children[0].children.find((b) => b.textContent === '豹动作下一阶段');
  const advancing = button.onclick();
  assert.equal(steps, 6, 'returns control to the page after six normal frames');
  assert.equal(button.disabled, true);
  assert.equal(f.mode, 'paused');
  f.qa.resetView();
  resume();
  await advancing;
  assert.equal(steps, 6, 'reset cancels the remaining simulation');
  assert.equal(button.disabled, false);
});

test('capture performance report waits for mounted assets and stays readable while tools are hidden', (t) => {
  const f = fixture(t, 'qa=1&perf=1&capture=1');
  t.mock.method(performance, 'now', () => 1000);
  const camera = new THREE.PerspectiveCamera();
  assert.doesNotThrow(() => f.qa.updateInspectionCamera(camera));
  f.qa.mount();
  f.qa.updateInspectionCamera(camera);
  const report = f.nodes.get('qa-report');
  assert.equal(report.style.display, 'none');
  assert.equal(JSON.parse(report.textContent).mode, 'intro');
});
