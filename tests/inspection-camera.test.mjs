import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInspectionCamera } from '../src/inspection-camera.js';

test('manual orbit holds its angle while the live subject moves/turns and group framing expands', () => {
  const orbit = createInspectionCamera(() => -100);
  const camera = new THREE.PerspectiveCamera();
  const target = new THREE.Vector3(10, 1, 12),
    preset = new THREE.Vector3(14, 3, 15);
  orbit.update(camera, preset, target);
  assert(camera.position.equals(preset));
  assert(orbit.focus.equals(target));
  orbit.rotate(100, 30);
  orbit.update(camera, preset, target);
  const offset = camera.position.clone().sub(target);
  assert(camera.position.distanceTo(preset) > 1);
  orbit.update(camera, preset, target);
  assert(camera.position.clone().sub(target).distanceTo(offset) < 1e-10);
  assert(orbit.focus.equals(target));
  const translation = new THREE.Vector3(5, 2, -3);
  target.add(translation);
  // The animal turns: its automatic preset rotates; the manual viewing angle stays put.
  preset.copy(target).add(new THREE.Vector3(-3, 2, 4));
  orbit.update(camera, preset, target);
  assert(camera.position.clone().sub(target).distanceTo(offset) < 1e-10);
  preset.copy(target).add(new THREE.Vector3(-6, 4, 8));
  orbit.update(camera, preset, target);
  assert(camera.position.clone().sub(target).distanceTo(offset.clone().multiplyScalar(2)) < 1e-10);
  const facing = camera.getWorldDirection(new THREE.Vector3());
  assert(facing.dot(target.clone().sub(camera.position).normalize()) > 0.999999);
  orbit.reset();
  assert.equal(orbit.focus, null);
  assert.equal(orbit.rotate(100, 10), false);
  orbit.update(camera, preset, target);
  assert(camera.position.equals(preset));
});

test('pitch/zoom limits keep finite upright views above actual support height', () => {
  const orbit = createInspectionCamera(() => 2);
  const camera = new THREE.PerspectiveCamera();
  const target = new THREE.Vector3(0, 0.2, 0),
    preset = new THREE.Vector3(0, 3, 5);
  orbit.update(camera, preset, target);
  for (const dy of [-100000, 100000]) {
    orbit.rotate(100000, dy);
    orbit.zoom(dy);
    orbit.update(camera, preset, target);
    assert(camera.position.toArray().every(Number.isFinite));
    assert(camera.quaternion.toArray().every(Number.isFinite));
    assert(camera.position.y >= 2.18);
    assert(camera.getWorldDirection(new THREE.Vector3()).y < 0);
  }
});
