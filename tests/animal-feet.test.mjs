import { loadAnimalGeometry as load } from './helpers/animal-geometry.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { createAnimalAnimation } from '../src/animal-animation.js';
import { ANIMAL_PROFILES } from '../src/animal-profiles.js';
import { landscapeHeight } from '../src/world-queries.js';

// Check actual disconnected coat shells rather than a declared digit count.
function components(mesh) {
  const g = mesh.geometry,
    parents = Array.from({ length: g.attributes.position.count }, (_, i) => i);
  const find = (i) => (parents[i] === i ? i : (parents[i] = find(parents[i])));
  // GLB splits vertices at UV seams and hard normals. Weld positions for topology.
  const welded = new Map();
  for (let i = 0; i < parents.length; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(g.attributes.position, i);
    const key = p
      .toArray()
      .map((v) => Math.round(v * 1e6))
      .join(',');
    if (welded.has(key)) parents[i] = welded.get(key);
    else welded.set(key, i);
  }
  const used = new Set();
  for (let i = 0; i < g.index.count; i += 3) {
    const a = g.index.getX(i),
      b = g.index.getX(i + 1),
      c = g.index.getX(i + 2);
    parents[find(b)] = find(a);
    parents[find(c)] = find(a);
    used.add(a).add(b).add(c);
  }
  const roots = new Map();
  for (const i of used) {
    const r = find(i);
    if (!roots.has(r)) roots.set(r, new THREE.Box3());
    roots.get(r).expandByPoint(new THREE.Vector3().fromBufferAttribute(g.attributes.position, i));
  }
  return [...roots.values()];
}

for (const [id, profile] of Object.entries(ANIMAL_PROFILES)) {
  test(`${id}: real bearing digits, raised accessory digits and foot-only skinning`, async () => {
    const root = await load(id);
    root.updateMatrixWorld(true);
    const carnivore = profile.species !== 'cow';
    for (const leg of ['FL', 'FR', 'HL', 'HR']) {
      const part = root.getObjectByName(
        `${carnivore ? 'Paw_toes_' : 'Natural_cloven_hoof_'}${leg}`,
      );
      assert.ok(part, `${leg} missing foot geometry`);
      let bearing = [];
      part.traverse((n) => {
        if (!n.isSkinnedMesh) return;
        const skin = n.geometry.attributes.skinIndex,
          w = n.geometry.attributes.skinWeight;
        for (let i = 0; i < skin.count; i++)
          for (let k = 0; k < 4; k++)
            if (w.getComponent(i, k) > 0.00001)
              assert.equal(
                n.skeleton.bones[skin.getComponent(i, k)].name,
                `${leg}_${carnivore ? 'Toes' : 'Hoof'}`,
              );
        if (/hoof horn|coat|Charcoal/i.test(n.material.name) && !/pads/i.test(n.material.name))
          bearing.push(...components(n));
      });
      assert.equal(bearing.length, carnivore ? 4 : 2, `${leg} bearing digit shells`);
      const centers = bearing
        .map((box) => box.getCenter(new THREE.Vector3()))
        .sort((a, b) => a.x - b.x);
      for (let i = 1; i < centers.length; i++) assert.ok(centers[i].x - centers[i - 1].x > 0.035);
      if (carnivore) {
        assert.ok(root.getObjectByName(leg + '_Toes').isBone);
        if (leg.startsWith('H')) {
          const hock = root.getObjectByName(leg + '_Hock'),
            hoof = root.getObjectByName(leg + '_Hoof');
          assert.equal(hoof.parent, hock);
          const hip = root.getObjectByName(leg + '_Upper').getWorldPosition(new THREE.Vector3()),
            knee = root.getObjectByName(leg + '_Lower').getWorldPosition(new THREE.Vector3()),
            ankle = hock.getWorldPosition(new THREE.Vector3()),
            foot = hoof.getWorldPosition(new THREE.Vector3());
          // Character-design guard: neutral standing must not regress to the
          // former deep crouch. Dynamic planted-foot checks below remain required.
          const kneeAngle = hip.clone().sub(knee).angleTo(ankle.clone().sub(knee)),
            hockAngle = knee.clone().sub(ankle).angleTo(foot.clone().sub(ankle));
          assert.ok(kneeAngle > 130 * (Math.PI / 180), `${leg} crouched neutral knee`);
          assert.ok(hockAngle > 125 * (Math.PI / 180), `${leg} folded neutral hock`);
          if (profile.species === 'wolf')
            assert.ok((ankle.y - foot.y) / (hip.y - foot.y) > 0.32, `${leg} short metatarsal`);
          assert.ok(
            hock.getWorldPosition(new THREE.Vector3()).y >
              hoof.getWorldPosition(new THREE.Vector3()).y + 0.2,
          );
        }
      }
      if (!carnivore || leg.startsWith('F')) {
        const dew = root.getObjectByName(`${carnivore ? 'Paw_dewclaw_' : 'Hoof_dewclaws_'}${leg}`);
        assert.ok(dew);
        assert.ok(new THREE.Box3().setFromObject(dew, true).min.y > 0.15);
      }
    }
  });
}

for (const id of ['reference-wolf', 'baola-leopard']) {
  test(`${id}: articulated hocks and toes settle, plant and freeze through walk/gallop/turn`, async () => {
    const root = await load(id),
      group = new THREE.Group(),
      scale = 0.45;
    const box = new THREE.Box3().setFromObject(root, true),
      center = box.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -box.min.y, -center.z);
    group.add(root);
    group.scale.setScalar(scale);
    group.position.set(-25, landscapeHeight(-25, 5) + 0.025, 5);
    const rig = createAnimalAnimation(root, group, ANIMAL_PROFILES[id]);
    const a = {
      scale,
      distance: 0,
      clock: 0,
      velocity: 0.5,
      chargeRun: 0,
      look: 0,
      gestureType: 0,
    };
    let curl = 0,
      support = 0,
      error = 0,
      previous,
      worst;
    for (let i = 0; i < 600; i++) {
      a.chargeRun = i >= 180 && i < 360 ? 1 : 0;
      a.velocity = a.chargeRun ? 2 : 0.4;
      const step = i >= 420 ? 0 : a.velocity / 60;
      group.position.z += step;
      a.distance += step;
      if (i >= 420) group.rotation.y += 0.8 / 60;
      group.position.y = landscapeHeight(group.position.x, group.position.z) + 0.025;
      a.clock += 1 / 60;
      rig.update(1 / 60, a, 0, 0);
      const s = rig.snapshot();
      for (const l of s.legs) {
        const toes = root.getObjectByName(l.name + '_Toes');
        curl = Math.max(curl, toes.quaternion.angleTo(new THREE.Quaternion()));
        if (l.hock) assert.ok(l.hock.every(Number.isFinite));
        if (!l.swinging && s.activity > 0.999) {
          const current = new THREE.Vector3(...l.foot).distanceTo(new THREE.Vector3(...l.target));
          if (current > error) {
            error = current;
            worst = {
              i,
              leg: l.name,
              gait: s.gait,
              foot: l.foot,
              target: l.target,
              solved: l.solvedTarget,
              hip: root
                .getObjectByName(l.name + '_Upper')
                .getWorldPosition(new THREE.Vector3())
                .toArray(),
              knee: root
                .getObjectByName(l.name + '_Lower')
                .getWorldPosition(new THREE.Vector3())
                .toArray(),
            };
          }
          const old = previous?.legs.find((p) => p.name === l.name);
          if (old && !old.swinging && old.steps === l.steps) {
            support++;
            assert.ok(
              new THREE.Quaternion(...l.rotation)
                .normalize()
                .angleTo(new THREE.Quaternion(...old.rotation).normalize()) < 0.001,
              `support orientation changed at frame ${i} ${l.name} (${s.gait})`,
            );
          }
        }
      }
      previous = s;
    }
    assert.ok(curl > 0.08);
    assert.ok(support > 100);
    assert.ok(error < 0.055, `support error ${error} ${JSON.stringify(worst)}`);
    a.chargeRun = a.velocity = 0;
    for (let i = 0; i < 120; i++) rig.update(1 / 60, a, 0, 0);
    for (const leg of ['FL', 'FR', 'HL', 'HR']) {
      assert.ok(
        root.getObjectByName(leg + '_Toes').quaternion.angleTo(new THREE.Quaternion()) < 0.0001,
      );
      const paw = root.getObjectByName('Paw_toes_' + leg);
      const sole = new THREE.Box3().setFromObject(paw, true);
      assert.ok(sole.min.y > landscapeHeight(group.position.x, group.position.z) - 0.01);
      assert.ok(sole.min.y < landscapeHeight(group.position.x, group.position.z) + 0.08);
    }
    const frozen = rig.snapshot();
    rig.update(0, a, 1, 1);
    assert.deepEqual(rig.snapshot(), frozen);
  });
}

for (const [id, cruise, quick] of [
  ['golden-cow', 0.32, 0.512],
  ['copper-cow', 0.28, 0.448],
  ['hornless-calf', 0.42, 0.756],
  ['reference-wolf', 0.52, 0.884],
  ['baola-leopard', 0.48, 0.816],
]) {
  test(`${id}: real slow walk keeps four distinct beats without paired-side swings`, async () => {
    const root = await load(id),
      group = new THREE.Group(),
      scale = ANIMAL_PROFILES[id].species === 'cow' ? 0.4875 : 0.45;
    const box = new THREE.Box3().setFromObject(root, true),
      center = box.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -box.min.y, -center.z);
    group.add(root);
    group.scale.setScalar(scale);
    group.position.set(-25, landscapeHeight(-25, 5) + 0.025, 5);
    const rig = createAnimalAnimation(root, group, ANIMAL_PROFILES[id]);
    const a = { scale, distance: 0, clock: 0, velocity: 0, look: 0, gestureType: 0 };
    const order = ['HL', 'FL', 'HR', 'FR'];
    let previous = rig.snapshot();
    for (const velocity of [0.12, 0.25, 0.4, cruise, quick]) {
      a.velocity = velocity;
      const period = Math.max(
        (ANIMAL_PROFILES[id].stride * scale) / velocity,
        1 / (ANIMAL_PROFILES[id].walkFrequency ?? 3.3),
      );
      let lastStep,
        stepCount = 0;
      for (let i = 0; i < Math.ceil(period * 8 * 120); i++) {
        const step = velocity / 120;
        group.position.z += step;
        a.distance += step;
        a.clock += 1 / 120;
        group.position.y = landscapeHeight(group.position.x, group.position.z) + 0.025;
        rig.update(1 / 120, a, 0, 0);
        const state = rig.snapshot();
        if (i > period * 3 * 120) {
          for (const side of ['L', 'R'])
            assert.ok(
              !state.legs.find((l) => l.name === 'F' + side).swinging ||
                !state.legs.find((l) => l.name === 'H' + side).swinging,
              `${velocity}m/s paired ${side} legs at frame ${i}`,
            );
          for (const leg of state.legs) {
            const old = previous.legs.find((l) => l.name === leg.name);
            if (leg.steps > old.steps) {
              if (lastStep)
                assert.equal(
                  leg.name,
                  order[(order.indexOf(lastStep) + 1) % 4],
                  `${velocity}m/s out-of-order step after ${lastStep}`,
                );
              lastStep = leg.name;
              stepCount++;
            }
            if (!leg.swinging)
              assert.ok(
                new THREE.Vector3(...leg.foot).distanceTo(new THREE.Vector3(...leg.target)) < 0.02,
                `${velocity}m/s planted ${leg.name} cannot reach its anchor: ${JSON.stringify(leg)}`,
              );
          }
        }
        previous = state;
      }
      assert.ok(stepCount >= 16, `${velocity}m/s incomplete walk cycles`);
    }
  });
}

for (const [id, cruise] of [
  ['golden-cow', 0.32],
  ['copper-cow', 0.28],
  ['hornless-calf', 0.42],
  ['reference-wolf', 0.52],
  ['baola-leopard', 0.48],
]) {
  test(`${id}: curved walks retain support time without a corrective-step storm at 30/60/120fps`, async () => {
    const totals = new Map();
    for (const fps of [30, 60, 120]) {
      for (const turnRate of [0, 0.1, -0.3]) {
        const root = await load(id),
          group = new THREE.Group(),
          scale = ANIMAL_PROFILES[id].species === 'cow' ? 0.4875 : 0.45;
        const box = new THREE.Box3().setFromObject(root, true),
          center = box.getCenter(new THREE.Vector3());
        root.position.set(-center.x, -box.min.y, -center.z);
        group.add(root);
        group.scale.setScalar(scale);
        group.position.set(-25, landscapeHeight(-25, 5) + 0.025, 5);
        const rig = createAnimalAnimation(root, group, ANIMAL_PROFILES[id]),
          a = { scale, distance: 0, clock: 0, velocity: cruise, look: 0, gestureType: 0 },
          period = Math.max(
            (ANIMAL_PROFILES[id].stride * scale) / cruise,
            1 / (ANIMAL_PROFILES[id].walkFrequency ?? 3.3),
          ),
          lastStep = new Map(),
          landedAt = new Map();
        let previous = rig.snapshot(),
          steps = 0;
        for (let i = 0; i < fps * 12; i++) {
          const dt = 1 / fps,
            step = cruise * dt;
          group.rotation.y += turnRate * dt;
          group.position.x += Math.sin(group.rotation.y) * step;
          group.position.z += Math.cos(group.rotation.y) * step;
          group.position.y = landscapeHeight(group.position.x, group.position.z) + 0.025;
          a.distance += step;
          a.clock += dt;
          rig.update(dt, a, 0, 0);
          const state = rig.snapshot();
          if (i >= fps * 3) {
            for (const leg of state.legs) {
              const old = previous.legs.find((l) => l.name === leg.name),
                context = `${fps}fps ${turnRate}rad/s ${leg.name} at ${a.clock}s`;
              if (!leg.swinging && old.swinging) landedAt.set(leg.name, a.clock);
              if (leg.steps > old.steps) {
                steps++;
                if (lastStep.has(leg.name))
                  assert.ok(
                    a.clock - lastStep.get(leg.name) >= period * 0.5 - dt,
                    `${context}: same foot lifted again too soon`,
                  );
                if (landedAt.has(leg.name))
                  assert.ok(
                    a.clock - landedAt.get(leg.name) >= 0.05,
                    `${context}: no stable support between swings`,
                  );
                lastStep.set(leg.name, a.clock);
              }
              if (!leg.swinging)
                assert.ok(
                  new THREE.Vector3(...leg.foot).distanceTo(new THREE.Vector3(...leg.target)) <
                    0.035,
                  `${context}: planted foot cannot reach its anchor`,
                );
            }
          }
          previous = state;
        }
        if (turnRate === 0) totals.set(fps, steps);
        else
          assert.ok(
            steps <= totals.get(fps) * 1.3,
            `${fps}fps ${turnRate}rad/s: ${steps} steps versus ${totals.get(fps)} straight`,
          );
        const frozen = rig.snapshot();
        rig.update(0, a, 0, 0);
        assert.deepEqual(rig.snapshot(), frozen);
      }
    }
    const values = [...totals.values()];
    assert.ok(Math.max(...values) - Math.min(...values) <= 4, 'walk timing depends on frame rate');
  });
}

for (const [id, quick] of [
  ['golden-cow', 0.512],
  ['copper-cow', 0.448],
  ['hornless-calf', 0.756],
]) {
  test(`${id}: accelerating, reversing a gentle turn and braking keep hooves reachable`, async () => {
    for (const fps of [30, 60, 120]) {
      const root = await load(id),
        group = new THREE.Group(),
        scale = 0.4875,
        box = new THREE.Box3().setFromObject(root, true),
        center = box.getCenter(new THREE.Vector3());
      root.position.set(-center.x, -box.min.y, -center.z);
      group.add(root);
      group.scale.setScalar(scale);
      group.position.set(-25, landscapeHeight(-25, 5) + 0.025, 5);
      const rig = createAnimalAnimation(root, group, ANIMAL_PROFILES[id]),
        a = { scale, distance: 0, clock: 0, velocity: 0, look: 0, gestureType: 0 };
      let previous = rig.snapshot(),
        swings = 0;
      for (let i = 0; i < 10 * fps; i++) {
        const dt = 1 / fps,
          t = i * dt;
        a.velocity = quick * Math.max(0, Math.min(t / 2, 1, (8 - t) / 2));
        const step = a.velocity * dt;
        group.rotation.y += t < 8 ? Math.sin(t * 0.8) * 0.3 * dt : 0;
        group.position.x += Math.sin(group.rotation.y) * step;
        group.position.z += Math.cos(group.rotation.y) * step;
        group.position.y = landscapeHeight(group.position.x, group.position.z) + 0.025;
        a.distance += step;
        a.clock += dt;
        rig.update(dt, a, 0, 0);
        const state = rig.snapshot();
        for (const leg of state.legs) {
          const old = previous.legs.find((l) => l.name === leg.name);
          if (leg.steps > old.steps) swings++;
          if (!leg.swinging && state.activity > 0.99)
            assert.ok(
              new THREE.Vector3(...leg.foot).distanceTo(new THREE.Vector3(...leg.target)) < 0.035,
              `${fps}fps ${leg.name} lost support while changing speed at ${t}s`,
            );
          if (!leg.swinging && !old.swinging && old.steps === leg.steps && state.activity > 0.999)
            assert.ok(
              new THREE.Quaternion(...leg.rotation)
                .normalize()
                .angleTo(new THREE.Quaternion(...old.rotation).normalize()) < 0.001,
              `${fps}fps support hoof rotated with the body`,
            );
        }
        previous = state;
      }
      assert.ok(swings > 20, 'speed changes must produce real steps');
      assert.equal(rig.snapshot().gait, 'walk');
      assert.ok(
        rig.snapshot().legs.every((leg) => !leg.swinging),
        'feet failed to settle',
      );
    }
  });
}
