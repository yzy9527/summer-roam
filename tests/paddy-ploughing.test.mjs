import { loadGLTF } from './helpers/model-loader.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createZombieController } from '../src/field-zombies.js';
import { createPaddyPloughing } from '../src/paddy-ploughing.js';
import { addPaddyPloughing } from './compatibility/paddy-ploughing.mjs';
import {
  PLOUGH_FIELD,
  PLOUGH_ROUTE_LENGTH,
  PLOUGH_ROW_LENGTH,
  ploughRoute,
  inPloughField,
  ploughGround,
} from '../src/paddy-plough-site.js';
import { createPaddyPloughAudio } from '../src/paddy-plough-audio.js';

const load = async (path) => (await loadGLTF(new URL(path, import.meta.url))).scene;

async function fixture(cowId = 'golden-cow', cowScale = 0.4875, random = () => 0, create = true) {
  const [flag, worker, cow, ploughSource] = await Promise.all([
    load('../src/assets/models/pvz-zombies/pvz-flagbearer.glb'),
    load('../src/assets/models/pvz-zombies/pvz-browncoat.glb'),
    load(`../src/assets/models/${cowId}/${cowId}-rigged.glb`),
    load('../src/assets/models/paddy-plough.glb'),
  ]);
  const scene = new THREE.Scene(),
    colliders = [];
  const zombies = createZombieController(
    new Map([
      ['pvz-flagbearer', flag],
      ['pvz-browncoat', worker],
    ]),
    colliders,
  );
  scene.add(zombies.root);
  const plough =
    create &&
    createPaddyPloughing(scene, colliders, zombies, cow, {
      random,
      cowId,
      cowScale,
      ploughSource,
    });
  return { plough, colliders, zombies, scene, cowSource: cow, ploughSource };
}
const bones = (root) => {
  const map = new Map();
  root.traverse((n) => {
    if (n.isBone) {
      const name = n.name.replace(/_0\d+$/, '');
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(n);
    }
  });
  return map;
};

// Test the actual deformed skin, not just a circular cow collider.
function insideCow(plough, point) {
  const { cow, props } = plough;
  const p = cow.group.worldToLocal(point.clone()).multiplyScalar(cow.scale);
  if (p.z < props.fit.metrics.rearZ || p.z > props.fit.metrics.shoulderZ + 0.12 || p.y < 0.2)
    return false;
  const start = cow.group.localToWorld(
    new THREE.Vector3(Math.sign(p.x || 1) * 2, p.y, p.z).divideScalar(cow.scale),
  );
  const distance = start.distanceTo(point);
  const ray = new THREE.Raycaster(start, point.clone().sub(start).normalize(), 0, distance - 0.018);
  return (
    ray.intersectObject(
      cow.source.getObjectByName('Continuous_quadruped_body_and_four_legs'),
      false,
    ).length > 0
  );
}

test('one exported curved beam, sheet share and fitted shoulder yoke adapt to both adult cows and a larger replacement', async () => {
  const measurements = [];
  for (const [id, scale] of [
    ['golden-cow', 0.4875],
    ['copper-cow', 0.4875],
    ['golden-cow', 0.58],
  ]) {
    const { plough } = await fixture(id, scale);
    plough.update(1 / 60, null);
    const { props, cow } = plough;
    assert.equal(cow.id, id);
    assert.equal(cow.instanceId, 'paddy-ox');
    assert.equal(props.plough.parent, plough.root);
    assert.equal(props.beam.parent, props.plough, 'beam is part of the complete wooden plough');
    assert(!plough.root.getObjectByName('牛后牵引横木'));
    assert(!plough.root.getObjectByName('牛身侧牵引索'));
    assert(
      props.share.geometry.attributes.position.count > 40,
      'forged sheet replaces the old cone',
    );
    const pull = props.pull(),
      hitch = props.hitch();
    assert(!insideCow(plough, pull.clone().lerp(hitch, 0.5)));
    const center = props.fit.contact();
    const ray = new THREE.Raycaster(
      center.clone().add(new THREE.Vector3(0, 0.001, 0)),
      new THREE.Vector3(0, 1, 0),
    );
    const wood = props.yoke.getObjectByName('curved_shoulder_timber');
    const contact = ray.intersectObject(wood, true)[0];
    assert(
      contact && contact.distance < 0.025,
      'real wood underside rests at the skinned shoulder',
    );
    const ratio = props.fit.metrics.yokeWidth / props.fit.metrics.shoulderWidth;
    assert(ratio > 1.1 && ratio < 1.3);
    measurements.push(props.fit.metrics);
  }
  assert(measurements[2].yokeWidth > measurements[0].yokeWidth * 1.15);
  console.log(JSON.stringify({ harnessAdaptation: measurements }));
});

test('continuous 30m rows fit the merged field and mud support', () => {
  assert.deepEqual(
    [PLOUGH_FIELD.row, PLOUGH_FIELD.col, PLOUGH_FIELD.x, PLOUGH_FIELD.z],
    [1, 4, (105 + 103.75167766889444) / 2, 32],
  );
  assert.equal(PLOUGH_ROW_LENGTH, 30);
  for (let d = 0; d < 30; d += 0.1) assert.equal(ploughRoute(d).turning, false);
  assert.equal(ploughRoute(30).turning, true);
  for (let s = 0; s < PLOUGH_ROUTE_LENGTH; s += 0.02) {
    const a = ploughRoute(s),
      b = ploughRoute(s + 0.01);
    assert(Math.hypot(a.x - b.x, a.z - b.z) < 0.011);
    for (const [offset, side] of [
      [0, 0],
      [3.1, -0.65],
      [-3.2, 0.4],
      [-2.35, 0],
    ]) {
      const p = ploughRoute(s + offset, side);
      assert(inPloughField(p.x, p.z, offset === 0 ? 1.15 : 0.75));
      assert.equal(ploughGround(p.x, p.z), 0.126);
    }
  }
});

test('real GLBs complete rows, turns, whip contact and a lap; grips, feet, lengths and duplicate skins stay coherent', async () => {
  const { plough } = await fixture();
  const crewBones = [plough.leader, plough.worker].map((a) => bones(a.source));
  const lengths = crewBones.map((map) =>
    ['Left', 'Right'].flatMap((side) =>
      ['Arm', 'ForeArm', 'UpLeg', 'Leg'].map((part) => [
        map.get(side + part)[0],
        map.get(side + part)[0].position.length(),
      ]),
    ),
  );
  let maxGrip = 0,
    maxFoot = 0,
    lifted = false,
    grounded = false;
  const stepChanges = new Set();
  for (let i = 0; i < 60 * (PLOUGH_ROUTE_LENGTH / 0.22 + 20); i++) {
    plough.update(1 / 60, null);
    if (i % 30) continue;
    const snap = plough.snapshot();
    if (snap.lift < 0.01) {
      const ground = ploughGround(...[snap.plough.position[0], snap.plough.position[2]]);
      const fraction =
        (ground - snap.plough.shareTip[1]) / (snap.plough.shareHeel[1] - snap.plough.shareTip[1]);
      assert(fraction >= 0.3 && fraction <= 0.5, 'share stays embedded in mud during work');
    }
    if (i % 600 === 0) {
      const trace = plough.props.trace.mesh.geometry.attributes.position;
      for (let ring = 3; ring < 22; ring += 3) {
        const center = new THREE.Vector3();
        for (let j = 0; j < 6; j++)
          center.add(new THREE.Vector3().fromBufferAttribute(trace, ring * 6 + j));
        center.multiplyScalar(1 / 6);
        assert(
          !insideCow(plough, center),
          `trace stays outside the real skin at distance ${snap.distance}`,
        );
      }
      const beam = plough.props.beam.getObjectByName('one_curved_draft_beam');
      beam.traverse((n) => {
        if (!n.isMesh) return;
        const points = n.geometry.attributes.position;
        for (let j = 0; j < points.count; j += 60) {
          const p = n.localToWorld(new THREE.Vector3().fromBufferAttribute(points, j));
          assert(
            !insideCow(plough, p),
            `wooden beam does not enter the real skin at ${snap.distance}`,
          );
        }
      });
    }
    maxGrip = Math.max(
      maxGrip,
      new THREE.Vector3(...snap.plough.grip).distanceTo(new THREE.Vector3(...snap.plough.hand)),
    );
    lifted ||= snap.lift > 0.9;
    grounded ||= snap.lift < 0.1;
    for (const foot of snap.cow.rig.legs) {
      if (foot.steps > 0) stepChanges.add(foot.name);
      if (!foot.swinging && foot.solvedTarget)
        maxFoot = Math.max(
          maxFoot,
          new THREE.Vector3(...foot.foot).distanceTo(new THREE.Vector3(...foot.solvedTarget)),
        );
    }
    for (const list of lengths)
      for (const [bone, length] of list)
        assert(Math.abs(bone.position.length() - length) < 1e-8, 'no limb stretching');
    for (const map of crewBones)
      for (const [name, copies] of map)
        if (
          /^(Hips|Spine[12]?|Head|Neck1?|Jaw|(?:Left|Right)(?:Arm|ForeArm|Hand|UpLeg|Leg|Foot|ToeBase))$/.test(
            name,
          ) ||
          /^(Left|Right)Hand(Middle|Ring|Pinky|Index|Thumb)[0-3]$/.test(name)
        )
          for (const copy of copies.slice(1))
            assert.deepEqual(copy.quaternion.toArray(), copies[0].quaternion.toArray(), name);
    const shaft = crewBones[0].get('RightHand_Prop_01')[0];
    assert(
      new THREE.Vector3(0, 1, 0).applyQuaternion(shaft.getWorldQuaternion(new THREE.Quaternion()))
        .y > 0.9999,
    );
    if (snap.laps >= 1) break;
  }
  const snap = plough.snapshot();
  console.log(
    JSON.stringify({
      maxGrip,
      maxFoot,
      distance: snap.distance,
      laps: snap.laps,
      contacts: snap.whip.contacts,
      furrows: snap.effects.furrows,
      splashes: snap.splashes,
    }),
  );
  assert(snap.laps >= 1, 'convoy actually completes its loop');
  assert.equal(stepChanges.size, 4, 'all four legs step');
  assert(lifted && grounded, 'lift plough in turns and lower for rows');
  assert(maxGrip < 0.06, 'left palm grips the plough');
  assert(maxFoot < 0.025, 'support feet do not slide off their IK targets');
  assert(snap.whip.contacts > 0, 'whip actually reaches the cow');
  assert(snap.effects.furrows > 40 && snap.splashes > 30);
});

test('30/60/120fps hold the original instances; pause freezes all poses/effects and an obstacle blocks then releases the convoy', async () => {
  for (const fps of [30, 60, 120]) {
    const { plough, colliders } = await fixture();
    const cow = plough.cow.group;
    for (let i = 0; i < fps * 4; i++) plough.update(1 / fps, null);
    const before = plough.snapshot(),
      pose = [];
    for (const root of [plough.cow.source, plough.leader.source, plough.worker.source])
      root.traverse((n) => {
        if (n.isBone) pose.push([n, n.position.clone(), n.quaternion.clone()]);
      });
    for (let i = 0; i < fps; i++) plough.update(0, null);
    assert.deepEqual(plough.snapshot(), before);
    for (const [n, p, q] of pose) {
      assert.deepEqual(n.position, p);
      assert.deepEqual(n.quaternion.toArray(), q.toArray());
    }
    const block = { ...ploughRoute(before.distance + 3.1, -0.65), radius: 0.8 };
    colliders.push(block);
    for (let i = 0; i < fps; i++) plough.update(1 / fps, null);
    assert(plough.snapshot().blocked);
    assert.equal(plough.snapshot().distance, before.distance);
    colliders.splice(colliders.indexOf(block), 1);
    for (let i = 0; i < fps; i++) plough.update(1 / fps, null);
    assert(plough.snapshot().distance > before.distance);
    const snap = plough.snapshot(),
      leader = plough.leader.object.position;
    for (let i = 0; i < fps; i++) plough.update(1 / fps, { x: leader.x, z: leader.z, heading: 0 });
    assert(plough.snapshot().blocked);
    assert.equal(plough.snapshot().distance, snap.distance);
    assert.equal(plough.cow.group, cow);
  }
});

test('foley is spatial, event-driven, bounded and stops immediately', () => {
  const nodes = [],
    ctx = {
      currentTime: 1,
      sampleRate: 48000,
      createBuffer: (channels, size) => ({ getChannelData: () => new Float32Array(size) }),
      createBufferSource: () => {
        const node = {
          buffer: null,
          connect() {
            return this;
          },
          start() {},
          stop() {
            this.stops = (this.stops ?? 0) + 1;
          },
          disconnect() {},
        };
        nodes.push(node);
        return node;
      },
      createGain: () => ({
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {
          return this;
        },
        disconnect() {},
      }),
      createBiquadFilter: () => ({
        frequency: {},
        Q: {},
        connect() {
          return this;
        },
        disconnect() {},
      }),
    };
  const audio = createPaddyPloughAudio(ctx, {}),
    event = { type: 'splash', x: 105, z: 20 };
  assert.equal(audio.play(event, { x: 0, z: 0 }), false);
  assert.equal(audio.play(event, null), false);
  for (const type of ['splash', 'soil']) assert.equal(audio.play({ ...event, type }, event), false);
  for (const type of ['whip-swish', 'whip']) assert(audio.play({ ...event, type }, event));
  audio.stop();
  assert.equal(audio.snapshot().active, 0);
  assert(nodes.every((n) => n.stops === 2));
  assert(audio.play({ ...event, type: 'whip' }, event));
});

test('lash starts every three working seconds; obstruction and pause do not accumulate lashes', async () => {
  for (const fps of [30, 60, 120]) {
    const { plough, colliders } = await fixture();
    const starts = [];
    let previous = null,
      straightWork = 0;
    for (let frame = 0; frame < fps * 120 && starts.length < 3; frame++) {
      plough.update(1 / fps, null);
      const snap = plough.snapshot();
      if (snap.speed > 0 && !ploughRoute(snap.distance).turning && snap.lift < 0.1)
        straightWork += 1 / fps;
      const time = snap.whip.time;
      if (time !== null && previous === null) starts.push(straightWork);
      previous = time;
    }
    assert(starts.length >= 3);
    assert(Math.abs(starts[0] - 3) <= 1 / fps + 1e-6);
    for (let i = 1; i < starts.length; i++)
      assert(Math.abs(starts[i] - starts[i - 1] - 3) <= 1 / fps + 1e-6);
    const before = plough.snapshot().whip.in;
    const block = { x: plough.cow.x, z: plough.cow.z, radius: 1 };
    colliders.push(block);
    for (let i = 0; i < fps * 5; i++) plough.update(1 / fps, null);
    assert.equal(plough.snapshot().whip.in, before);
    plough.update(0, null);
    assert.equal(plough.snapshot().whip.in, before);
  }
});

test('actual lash contact rolls once at adult 30% and calf 20%/20% boundaries; playback opens the mouth', async () => {
  for (const [cowId, scale, probability, expectedCall] of [
    ['golden-cow', 0.4875, 0.299999, 'calf-cry'],
    ['golden-cow', 0.4875, 0.3, null],
    ['hornless-calf', 0.39, 0, 'calf-cry'],
    ['hornless-calf', 0.39, 0.199999, 'calf-cry'],
    ['hornless-calf', 0.39, 0.2, 'calf-lift-call'],
    ['hornless-calf', 0.39, 0.399999, 'calf-lift-call'],
    ['hornless-calf', 0.39, 0.4, null],
    ['hornless-calf', 0.39, 0.999999, null],
  ]) {
    let rolls = 0,
      notify;
    const { plough } = await fixture(cowId, scale, () => {
      rolls++;
      return probability;
    });
    const sounds = [];
    plough.connectAudio((event, callback) => {
      if (event.type !== 'cow-position') sounds.push(event.type);
      if (event.type === 'cow-call') {
        notify = callback;
        assert.equal(event.call ?? 'calf-cry', expectedCall);
      }
      return true;
    });
    for (let i = 0; i < 60 * 60 && !plough.snapshot().whip.contacts; i++)
      plough.update(1 / 60, null);
    const contact = plough.snapshot();
    assert.equal(contact.whip.contacts, 1);
    assert.equal(contact.whip.callRolls, 1);
    assert.equal(rolls, 1);
    assert.equal(contact.whip.callRequests, expectedCall ? 1 : 0);
    assert.equal(sounds.filter((t) => t === 'whip').length, 1);
    assert.equal(sounds.filter((t) => t === 'whip-swish').length, 1);
    assert.equal(contact.cow.vocalPose, 0, 'request is not proof of playback');
    notify?.('playing');
    for (let i = 0; i < 24; i++) plough.update(1 / 60, null);
    assert(plough.snapshot().speed > contact.speed, 'retains modest contact acceleration');
    assert.equal(plough.snapshot().whip.callRolls, 1, 'holding the tip does not reroll');
    if (notify) {
      assert(plough.snapshot().cow.vocalPose > 0.5);
      notify('stopped');
      for (let i = 0; i < 30; i++) plough.update(1 / 60, null);
      assert(plough.snapshot().cow.vocalPose < 0.001);
    }
  }
});

test('startup reuses the loaded cow geometry and textures, with independent skin and bones; missing source rolls back', async () => {
  const { scene, colliders, zombies, cowSource, ploughSource } = await fixture(
    'golden-cow',
    0.4875,
    () => 0,
    false,
  );
  // The meadow has already normalized the source under its own positioned parent.
  const bounds = new THREE.Box3().setFromObject(cowSource, true),
    center = bounds.getCenter(new THREE.Vector3());
  cowSource.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  const meadow = new THREE.Group();
  meadow.position.set(-25, 4, 8);
  meadow.scale.setScalar(0.4875);
  meadow.add(cowSource);
  scene.add(meadow);
  scene.updateMatrixWorld(true);
  const position = cowSource.position.toArray(),
    calls = [],
    warnings = [];
  const loadAsync = GLTFLoader.prototype.loadAsync;
  GLTFLoader.prototype.loadAsync = async function (url) {
    calls.push(url);
    return { scene: ploughSource };
  };
  try {
    const plough = await addPaddyPloughing(scene, colliders, zombies, warnings, {
      modelSource: (id) => (id === 'golden-cow' ? cowSource : null),
    });
    assert(plough);
    assert.deepEqual(warnings, []);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /paddy-plough/);
    const original = cowSource.getObjectByName('Continuous_quadruped_body_and_four_legs'),
      copy = plough.cow.source.getObjectByName(original.name);
    assert.equal(copy.geometry, original.geometry);
    assert.equal(copy.material, original.material);
    assert.notEqual(copy.skeleton, original.skeleton);
    assert.notEqual(copy.skeleton.bones[0], original.skeleton.bones[0]);
    cowSource.traverse((mesh) => {
      if (mesh.morphTargetInfluences)
        assert.notEqual(
          plough.cow.source.getObjectByName(mesh.name).morphTargetInfluences,
          mesh.morphTargetInfluences,
        );
    });
    const originalBones = original.skeleton.bones.map((b) => b.quaternion.toArray());
    for (let i = 0; i < 60; i++) plough.update(1 / 60, null);
    assert.deepEqual(
      original.skeleton.bones.map((b) => b.quaternion.toArray()),
      originalBones,
    );
    assert.deepEqual(cowSource.position.toArray(), position);
    assert.equal(cowSource.parent, meadow);
    assert.deepEqual(
      plough.cow.rig.footContacts(),
      plough.cow.rig.snapshot().legs.map(({ swinging, foot }) => ({ swinging, foot })),
    );
  } finally {
    GLTFLoader.prototype.loadAsync = loadAsync;
  }
  const missing = await fixture('golden-cow', 0.4875, () => 0, false),
    leader = missing.zombies.actor('pvz-flagbearer');
  const home = leader.object.position.toArray(),
    beforeCount = missing.colliders.length,
    errors = [];
  const warn = console.warn;
  console.warn = (...message) => errors.push(message);
  try {
    assert.equal(
      await addPaddyPloughing(missing.scene, missing.colliders, missing.zombies, warnings, {
        modelSource: () => null,
      }),
      null,
    );
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(leader.object.position.toArray(), home);
  assert.equal(missing.colliders.length, beforeCount);
  assert.equal(missing.scene.getObjectByName('僵尸牵牛犁田队伍'), undefined);
  assert.deepEqual(warnings, ['paddy-ploughing']);
  assert.equal(errors.length, 1);
});

test('tool geometry updates once per display frame; distant visuals throttle without skipping navigation, whip contact or pause', async () => {
  const near = await fixture(),
    far = await fixture();
  const camera = { x: -25, z: 4 };
  const initial = far.plough.snapshot();
  far.plough.update(0, null, camera);
  assert(!far.plough.root.visible, 'intro and paused views can cull without advancing gameplay');
  assert.deepEqual(far.plough.snapshot(), initial);
  const geometry = near.plough.props.lead.mesh.geometry.attributes.position;
  const version = geometry.version;
  near.plough.update(1 / 30, null);
  assert.equal(geometry.version, version + 1, 'two physics steps upload only one final rope');
  far.plough.update(1 / 30, null, camera);
  const farGeometry = far.plough.props.lead.mesh.geometry.attributes.position;
  const farVersion = farGeometry.version;
  for (let i = 0; i < 60 * 20; i++) {
    near.plough.update(1 / 60, null);
    far.plough.update(1 / 60, null, camera);
  }
  const n = near.plough.snapshot(),
    f = far.plough.snapshot();
  for (const key of ['clock', 'distance', 'speed', 'splashes']) assert.equal(f[key], n[key]);
  assert.equal(f.whip.contacts, n.whip.contacts);
  assert.equal(f.whip.callRolls, n.whip.callRolls);
  assert(f.whip.contacts > 0);
  assert(farGeometry.version - farVersion < 205, 'distant ropes run at about 10Hz');
  for (const object of [far.plough.root, far.plough.leader.object, far.plough.worker.object])
    assert.equal(object.visible, false);
  const paused = far.plough.snapshot(),
    pausedVersion = farGeometry.version;
  far.plough.update(0, null, near.plough.cow);
  assert.deepEqual(far.plough.snapshot(), paused);
  assert.equal(farGeometry.version, pausedVersion);
  const beforeResume = farGeometry.version;
  far.plough.update(1 / 60, null, far.plough.cow);
  assert.equal(farGeometry.version, beforeResume + 1, 'near camera refreshes on its first frame');
  assert(
    far.plough.root.visible && far.plough.worker.object.visible && far.plough.leader.object.visible,
  );
  const resumed = far.plough.snapshot();
  assert(
    new THREE.Vector3(...resumed.plough.grip).distanceTo(
      new THREE.Vector3(...resumed.plough.hand),
    ) < 0.06,
  );
  assert(
    far.plough.props.fit.gap() <= 0.00651,
    'cached contour stays within half a millimetre of its original fit',
  );
  const block = { ...ploughRoute(resumed.distance + 0.001), radius: 0.25 };
  far.colliders.push(block);
  far.plough.update(1 / 30, null, camera);
  assert(far.plough.snapshot().blocked, 'distant navigation still checks obstacles');
  far.colliders.splice(far.colliders.indexOf(block), 1);
  far.plough.update(1 / 30, null, camera);
  assert(!far.plough.snapshot().blocked);
});
