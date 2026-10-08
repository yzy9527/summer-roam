import * as THREE from 'three';

const STAR_COUNT = 1500;
const TRANSITION_SECONDS = 1.2;

// Distant, unlit scenery needs its own tint in addition to changing the lights.
export function createNightSky(scene, night) {
  const clouds = [],
    backdrops = new Map(),
    dayBackground = scene.background.clone(),
    dayFog = scene.fog.color.clone(),
    nightBackground = new THREE.Color('#080e25'),
    nightFog = new THREE.Color('#192943'),
    nightBackdrop = new THREE.Color('#354b75'),
    backdropTint = new THREE.Color();
  scene.traverse((object) => {
    if (object.userData.dayCloud) clouds.push(object);
    if (object.userData.nightBackdrop)
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        backdrops.set(material, material.color.clone());
  });
  const positions = [],
    sizes = [],
    phases = [],
    colors = [];
  let seed = 91473;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < STAR_COUNT; i++) {
    const y = 0.035 + random() * 0.965,
      angle = random() * Math.PI * 2,
      horizontal = Math.sqrt(1 - y * y),
      brightness = 0.4 + random() * 0.6;
    positions.push(
      Math.cos(angle) * horizontal * 2080,
      y * 2080,
      Math.sin(angle) * horizontal * 2080,
    );
    sizes.push(1.1 + random() ** 3 * 2.5);
    phases.push(random() * Math.PI * 2);
    colors.push(brightness * 0.84, brightness * 0.91, brightness);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phases, 1));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    vertexColors: true,
    uniforms: {
      uNight: night,
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uTwinkle: { value: 1 },
    },
    vertexShader: `
attribute float aSize;
attribute float aPhase;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vPhase;
void main() {
  vColor = color;
  vPhase = aPhase;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
  gl_PointSize = aSize * uPixelRatio;
}`,
    fragmentShader: `
uniform float uNight;
uniform float uTime;
uniform float uTwinkle;
varying vec3 vColor;
varying float vPhase;
void main() {
  float distanceToCenter = length(gl_PointCoord - .5);
  float glow = 1. - smoothstep(.12, .5, distanceToCenter);
  float twinkle = 1. - uTwinkle * (.09 + .09 * sin(uTime * .75 + vPhase));
  gl_FragColor = vec4(vColor, glow * uNight * twinkle);
  #include <colorspace_fragment>
}`,
  });
  const stars = new THREE.Points(geometry, material);
  stars.name = 'Night stars';
  stars.position.z = 90;
  stars.userData.waterSky = true;
  stars.visible = false;
  scene.add(stars);
  function setMix(value) {
    night.value = THREE.MathUtils.clamp(value, 0, 1);
    stars.visible = night.value > 0;
    scene.background.copy(dayBackground).lerp(nightBackground, night.value);
    scene.fog.color.copy(dayFog).lerp(nightFog, night.value);
    for (const cloud of clouds) {
      cloud.material.opacity = 1 - night.value;
      cloud.visible = night.value < 1;
    }
    backdropTint.setRGB(1, 1, 1).lerp(nightBackdrop, night.value);
    for (const [backdrop, dayColor] of backdrops)
      backdrop.color.copy(dayColor).multiply(backdropTint);
  }
  return {
    night,
    stars,
    setMix,
    update(seconds, pixelRatio, reducedMotion) {
      material.uniforms.uTime.value = seconds;
      material.uniforms.uPixelRatio.value = pixelRatio;
      material.uniforms.uTwinkle.value = reducedMotion ? 0 : 1;
    },
  };
}

export function createDayNight({
  scene,
  renderer,
  sunLight,
  hemiLight,
  sky,
  reducedMotion = false,
}) {
  const daySun = sunLight.color.clone(),
    dayHemi = hemiLight.color.clone(),
    dayGround = hemiLight.groundColor.clone(),
    nightSun = new THREE.Color('#9dbbff'),
    nightHemi = new THREE.Color('#6e8cc5'),
    nightGround = new THREE.Color('#222b44'),
    daySunIntensity = sunLight.intensity,
    dayHemiIntensity = hemiLight.intensity,
    dayEnvironmentIntensity = scene.environmentIntensity;
  let mode = 'day',
    progress = 0;
  function apply() {
    const mix = THREE.MathUtils.smoothstep(progress, 0, 1);
    sky.setMix(mix);
    sunLight.color.copy(daySun).lerp(nightSun, mix);
    sunLight.intensity = THREE.MathUtils.lerp(daySunIntensity, 0.38, mix);
    hemiLight.color.copy(dayHemi).lerp(nightHemi, mix);
    hemiLight.groundColor.copy(dayGround).lerp(nightGround, mix);
    hemiLight.intensity = THREE.MathUtils.lerp(dayHemiIntensity, 0.52, mix);
    scene.environmentIntensity = THREE.MathUtils.lerp(dayEnvironmentIntensity, 0.035, mix);
  }
  apply();
  return {
    setMode(next) {
      if (next !== 'day' && next !== 'night') return;
      mode = next;
      if (reducedMotion) {
        progress = mode === 'night' ? 1 : 0;
        apply();
      }
    },
    update(dt, seconds) {
      const target = mode === 'night' ? 1 : 0;
      if (progress !== target) {
        const step = Math.min(Math.max(dt, 0), 0.25) / TRANSITION_SECONDS;
        progress =
          target > progress ? Math.min(target, progress + step) : Math.max(target, progress - step);
        apply();
      }
      sky.update(seconds, renderer.getPixelRatio(), reducedMotion);
    },
    snapshot: () => ({ mode, nightMix: sky.night.value, stars: STAR_COUNT }),
  };
}
