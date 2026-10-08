import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createNightSky, createDayNight } from '../src/day-night.js';
import { applyWaterReflection } from '../src/water-reflections.js';

function fixture(reducedMotion = false) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#bad7e4');
  scene.fog = new THREE.Fog('#a4c9e6', 500, 2800);
  scene.environmentIntensity = 0.25;
  const sunLight = new THREE.DirectionalLight('#fff1cf', 3),
    hemiLight = new THREE.HemisphereLight('#b3d9fa', '#6c715c', 1.15),
    cloud = new THREE.Sprite(new THREE.SpriteMaterial()),
    backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(),
      new THREE.MeshBasicMaterial({ color: '#a0c8ed' }),
    );
  cloud.userData.dayCloud = true;
  backdrop.userData.nightBackdrop = true;
  scene.add(sunLight, hemiLight, cloud, backdrop);
  const sky = createNightSky(scene, { value: 0 }),
    controller = createDayNight({
      scene,
      renderer: { getPixelRatio: () => 1.5 },
      sunLight,
      hemiLight,
      sky,
      reducedMotion,
    });
  const advance = (frames = 90) => {
    for (let frame = 0; frame < frames; frame++) controller.update(1 / 60, frame / 60);
  };
  return { scene, sunLight, hemiLight, cloud, backdrop, sky, controller, advance };
}

test('night changes sky, fog, distant scenery and lights together, then restores daylight exactly', () => {
  const f = fixture(),
    day = {
      background: f.scene.background.clone(),
      fog: f.scene.fog.color.clone(),
      backdrop: f.backdrop.material.color.clone(),
      sun: f.sunLight.color.clone(),
      hemi: f.hemiLight.color.clone(),
      ground: f.hemiLight.groundColor.clone(),
    },
    children = f.scene.children.length;
  assert.equal(f.sky.stars.visible, false);
  f.controller.setMode('night');
  f.advance(30);
  assert(f.sky.night.value > 0 && f.sky.night.value < 1, 'fade includes intermediate values');
  f.advance();
  assert.equal(f.controller.snapshot().mode, 'night');
  assert.equal(f.sky.night.value, 1);
  assert.equal(f.sky.stars.visible, true);
  assert.equal(f.cloud.visible, false);
  assert(f.sunLight.intensity > 0 && f.sunLight.intensity < 1);
  assert(f.hemiLight.intensity > 0 && f.hemiLight.intensity < 1);
  assert(f.scene.environmentIntensity < 0.1);
  assert.notDeepEqual(f.scene.fog.color, day.fog);
  assert.notDeepEqual(f.backdrop.material.color, day.backdrop);
  for (let cycle = 0; cycle < 3; cycle++) {
    f.controller.setMode('day');
    f.advance();
    assert.deepEqual(f.scene.background, day.background);
    assert.deepEqual(f.scene.fog.color, day.fog);
    assert.deepEqual(f.backdrop.material.color, day.backdrop);
    assert.deepEqual(f.sunLight.color, day.sun);
    assert.deepEqual(f.hemiLight.color, day.hemi);
    assert.deepEqual(f.hemiLight.groundColor, day.ground);
    assert.equal(f.sunLight.intensity, 3);
    assert.equal(f.hemiLight.intensity, 1.15);
    assert.equal(f.scene.environmentIntensity, 0.25);
    assert.equal(f.cloud.visible, true);
    assert.equal(f.cloud.material.opacity, 1);
    assert.equal(f.sky.stars.visible, false);
    f.controller.setMode('night');
    f.advance();
  }
  assert.equal(f.scene.children.length, children, 'switches reuse scenery and stars');
});

test('reversing a transition is continuous and reduced motion switches immediately without twinkling', () => {
  const f = fixture();
  f.controller.setMode('night');
  f.advance(20);
  const mix = f.sky.night.value;
  f.controller.setMode('day');
  assert.equal(f.sky.night.value, mix);
  f.controller.update(1 / 60, 1);
  assert(f.sky.night.value < mix);
  f.advance();
  assert.equal(f.sky.night.value, 0);
  f.controller.setMode('invalid');
  assert.equal(f.controller.snapshot().mode, 'day');
  const reduced = fixture(true);
  reduced.controller.setMode('night');
  assert.equal(reduced.sky.night.value, 1);
  reduced.controller.update(0, 20);
  assert.equal(reduced.sky.stars.material.uniforms.uTwinkle.value, 0);
  assert.equal(reduced.sky.stars.material.uniforms.uPixelRatio.value, 1.5);
  const positions = reduced.sky.stars.geometry.attributes.position;
  assert.equal(positions.count, 1500);
  for (let i = 0; i < positions.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(positions, i);
    assert(p.y > 0, 'stars stay above the horizon');
    assert(Math.abs(p.length() - 2080) < 0.001);
  }
});

test('water retains existing shader hooks and uses the same transition uniform for both cached skies', () => {
  for (const canal of [false, true]) {
    const material = new THREE.MeshPhongMaterial(),
      dayEnvironment = { texture: new THREE.CubeTexture() },
      nightEnvironment = { texture: new THREE.CubeTexture() },
      night = { value: 0 },
      time = { value: 12 },
      shader = {
        uniforms: {},
        vertexShader: THREE.ShaderLib.phong.vertexShader,
        fragmentShader: THREE.ShaderLib.phong.fragmentShader,
      };
    let previousHookCalled = false;
    material.onBeforeCompile = () => {
      previousHookCalled = true;
    };
    applyWaterReflection(material, dayEnvironment, { canal, time, night, nightEnvironment });
    material.onBeforeCompile(shader);
    assert(previousHookCalled);
    assert.equal(material.envMap, dayEnvironment.texture);
    assert.equal(shader.uniforms.uNightEnvironment.value, nightEnvironment.texture);
    assert.equal(shader.uniforms.uNightStrength, night);
    assert.equal(shader.uniforms.uReflectionTime, time);
    assert(shader.fragmentShader.includes('textureCube(uNightEnvironment, waterReflectDirection)'));
    assert(!shader.fragmentShader.includes('#include <envmap_fragment>'));
    night.value = 0.6;
    assert.equal(shader.uniforms.uNightStrength.value, 0.6);
  }
});
