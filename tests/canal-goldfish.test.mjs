import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGoldfishController } from '../src/canal-goldfish.js';
import { terrainHeight } from '../src/world-base.js';
import { canalCoordinates, landscapeHeight } from '../src/world-queries.js';
import { canalWidth, waterLevel } from '../src/canal-profile.js';
import { canalPebblePlacements } from '../src/water-bed.js';

async function source() {
  const bytes = await readFile(
    new URL('../src/assets/models/canal-goldfish/canal-goldfish-rigged.glb', import.meta.url),
  );
  return (
    await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      '',
    )
  ).scene;
}
function skin(object) {
  let result;
  object.traverse((o) => {
    if (o.isSkinnedMesh) result = o;
  });
  assert(result, 'real skinned fish mesh is present');
  return result;
}
function bodyVertex(mesh, index) {
  return mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
}

test('actual fish GLB has normalized aquatic skin, smooth tail blends and independent clones', async () => {
  const controller = createGoldfishController(await source()),
    fish = controller.root.children;
  assert.equal(fish.length, 5);
  assert.equal(fish.filter((o) => o.name.includes('red white')).length, 2);
  for (const object of fish) {
    const mesh = skin(object),
      weights = mesh.geometry.attributes.skinWeight,
      indices = mesh.geometry.attributes.skinIndex,
      names = mesh.skeleton.bones.map((b) => b.name);
    assert.equal(names.length, 8);
    for (const name of ['Root', 'Body', 'Tail', 'Tail_Mid', 'Tail_Tip', 'Fin_L', 'Fin_R', 'Dorsal'])
      assert(names.includes(name));
    assert.equal(object.getObjectByName('Tail_Tip').parent.name, 'Tail_Mid');
    assert.equal(object.getObjectByName('Tail_Mid').parent.name, 'Tail');
    const used = new Set();
    let tailBlends = 0;
    for (let v = 0; v < weights.count; v++) {
      let sum = 0,
        tailCount = 0;
      for (let k = 0; k < 4; k++) {
        const w = weights.getComponent(v, k);
        assert(w >= 0 && Number.isFinite(w));
        sum += w;
        if (w > 0) {
          const name = names[indices.getComponent(v, k)];
          used.add(name);
          if (name.startsWith('Tail')) tailCount++;
        }
      }
      assert(Math.abs(sum - 1) < 1e-5);
      if (tailCount > 1) tailBlends++;
    }
    assert(tailBlends > 30, 'tail membrane has continuous multi-bone weights');
    for (const name of ['Body', 'Tail', 'Tail_Mid', 'Tail_Tip', 'Fin_L', 'Fin_R', 'Dorsal'])
      assert(used.has(name));
    assert.notEqual(mesh.skeleton, skin(fish[(fish.indexOf(object) + 1) % 5]).skeleton);
  }
  assert.notDeepEqual(
    skin(fish[0]).geometry.attributes.color.array,
    skin(fish[1]).geometry.attributes.color.array,
  );
});

test('real deformed fish stay submerged above the bed, away from banks, pebbles and each other for two minutes', async () => {
  const controller = createGoldfishController(await source()),
    stones = canalPebblePlacements().filter((p) => p.z > 14 && p.z < 19);
  const stoneBytes = await readFile(
    new URL('../src/assets/models/water-pebbles.glb', import.meta.url),
  );
  const stoneSource = (
    await new GLTFLoader().parseAsync(
      stoneBytes.buffer.slice(stoneBytes.byteOffset, stoneBytes.byteOffset + stoneBytes.byteLength),
      '',
    )
  ).scene;
  stoneSource.updateMatrixWorld(true);
  const stoneBoxes = stones.map((p) => {
    const mesh = stoneSource.getObjectByName(`Water_pebble_${p.variant}`),
      matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, p.y, p.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rotation),
        new THREE.Vector3().setScalar(p.radius),
      );
    return new THREE.Box3().setFromObject(mesh, true).applyMatrix4(matrix);
  });
  let surfaceGap = Infinity,
    bedGap = Infinity,
    fishGap = Infinity;
  for (let frame = 0; frame <= 1200; frame++) {
    if (frame) controller.update(0.1);
    if (frame % 10) continue;
    const boxes = controller.root.children.map((object) => {
      const mesh = skin(object);
      mesh.computeBoundingBox();
      const box = mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
      for (const x of [box.min.x, box.max.x])
        for (const z of [box.min.z, box.max.z]) {
          const { s, d } = canalCoordinates(x, z),
            surface = terrainHeight(x, z) + waterLevel(s),
            bed = landscapeHeight(x, z);
          surfaceGap = Math.min(surfaceGap, surface - box.max.y);
          bedGap = Math.min(bedGap, box.min.y - bed);
          assert(box.max.y < surface - 0.008, `fin broke water surface at ${frame / 10}s`);
          assert(box.min.y > bed + 0.04, `fish touched canal bed at ${frame / 10}s`);
          assert(Math.abs(d) < canalWidth(s) / 2 - 0.15);
          assert(s > 14 && s < 19, 'complete silhouette stays inside the open stone canal');
        }
      for (const stone of stoneBoxes)
        assert(!box.intersectsBox(stone), `fish intersected submerged pebble at ${frame / 10}s`);
      return box;
    });
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        assert(
          !boxes[i].intersectsBox(boxes[j]),
          `fish ${i}/${j} silhouettes overlap at ${frame / 10}s`,
        );
        fishGap = Math.min(fishGap, boxes[j].min.z - boxes[i].max.z);
      }
  }
  console.log(
    JSON.stringify({ fishSafety: { simulatedSeconds: 120, surfaceGap, bedGap, fishGap } }),
  );
});

test('tail deforms sideways, swimming and turning remain continuous, pause freezes all skins, day/night shares scene control', async () => {
  const night = { value: 0 },
    controller = createGoldfishController(await source(), night),
    first = controller.root.children[0],
    mesh = skin(first),
    position = mesh.geometry.attributes.position;
  let tip = 0;
  for (let v = 1; v < position.count; v++) if (position.getZ(v) < position.getZ(tip)) tip = v;
  function localTip() {
    return first.worldToLocal(bodyVertex(mesh, tip));
  }
  const start = localTip(),
    finStart = first.getObjectByName('Fin_L').quaternion.clone();
  controller.update(0.1);
  const moved = localTip();
  assert(Math.abs(moved.x - start.x) > 0.002, 'tail actually bends the exported membrane sideways');
  assert(Math.abs(moved.y - start.y) < 0.001, 'tail does not twist vertically in place');
  assert(first.getObjectByName('Fin_L').quaternion.angleTo(finStart) > 0.01);
  let previous = controller.snapshot();
  for (let frame = 0; frame < 3600; frame++) {
    controller.update(1 / 60);
    const current = controller.snapshot();
    current.fish.forEach((f, i) => {
      const prev = previous.fish[i];
      assert(
        new THREE.Vector3(...f.position).distanceTo(new THREE.Vector3(...prev.position)) < 0.003,
      );
      const angle = Math.atan2(
        Math.sin(f.heading - prev.heading),
        Math.cos(f.heading - prev.heading),
      );
      assert(Math.abs(angle) < 0.04, 'smooth heading at loop turns');
      f.tailRotations.forEach((q, j) =>
        assert(
          new THREE.Quaternion(...q).angleTo(new THREE.Quaternion(...prev.tailRotations[j])) < 0.05,
        ),
      );
    });
    previous = current;
  }
  const frozen = controller.snapshot(),
    frozenVertex = bodyVertex(mesh, tip).toArray();
  for (let i = 0; i < 90; i++) controller.update(0);
  assert.deepEqual(controller.snapshot(), frozen);
  assert.deepEqual(bodyVertex(mesh, tip).toArray(), frozenVertex);
  const shader = { uniforms: {}, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  mesh.material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uFishNight, night);
  night.value = 1;
  assert.equal(shader.uniforms.uFishNight.value, 1);
  assert(shader.fragmentShader.includes('.8*(1.-uFishNight)'));
  controller.update(1 / 60);
  assert.notDeepEqual(controller.snapshot(), frozen);
});
