import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateVehicleAsset, assembleVehicle } from '../src/vehicle-runtime.js';
import { VEHICLE_CONFIG as C } from '../src/vehicle-config.js';
import { vehicleHitsObstacle } from '../src/drive.js';
for (const file of ['surf-car-09.glb', 'surf-car-09-base.glb'])
  test(
    file + ' runtime assembly uniformly scales body, all accessories and detached wheels',
    async () => {
      const b = readFileSync(new URL('../src/assets/models/' + file, import.meta.url));
      const asset = (
        await new GLTFLoader().parseAsync(
          b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
          '',
        )
      ).scene;
      validateVehicleAsset(asset);
      const before = new Box3().setFromObject(asset, true),
        size = before.getSize(new Vector3());
      const { car, wheels } = assembleVehicle(asset),
        after = new Box3().setFromObject(car, true),
        scaled = after.getSize(new Vector3());
      for (const k of ['x', 'y', 'z']) assert(Math.abs(scaled[k] - size[k] * C.modelScale) < 1e-5);
      assert(Math.abs(after.min.y) < 1e-6);
      assert.equal(wheels.length, 4);
      for (const w of wheels) {
        const p = w.steerGroup.getWorldPosition(new Vector3());
        assert(Math.abs(p.y - C.wheelRadius) < 1e-6);
        assert(Math.abs(Math.abs(p.x) - C.track / 2) < 1e-6);
      }
      assert(
        Math.abs(wheels[0].steerGroup.position.z - wheels[2].steerGroup.position.z - C.wheelbase) <
          1e-6,
      );
      for (const point of [after.min, after.max]) {
        assert(Math.abs(point.x) <= C.collisionHalfWidth + 1e-6);
        assert(Math.abs(point.z - C.collisionCenterZ) <= C.collisionHalfLength + 1e-6);
      }
    },
  );
test('collision footprint uses both scaled width and length and follows vehicle rotation', () => {
  for (const heading of [0, Math.PI / 2, Math.PI / 4]) {
    const f = { x: Math.sin(heading), z: Math.cos(heading) },
      r = { x: Math.cos(heading), z: -Math.sin(heading) };
    assert(
      vehicleHitsObstacle(0, 0, heading, {
        x: f.x * (C.collisionHalfLength + 0.04),
        z: f.z * (C.collisionHalfLength + 0.04),
        radius: 0.1,
      }),
    );
    assert(
      !vehicleHitsObstacle(0, 0, heading, {
        x: f.x * (C.collisionHalfLength + 0.2),
        z: f.z * (C.collisionHalfLength + 0.2),
        radius: 0.1,
      }),
    );
    assert(
      !vehicleHitsObstacle(0, 0, heading, {
        x: r.x * (C.collisionHalfWidth + 0.2),
        z: r.z * (C.collisionHalfWidth + 0.2),
        radius: 0.1,
      }),
    );
  }
});
