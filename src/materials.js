import * as THREE from 'three';

// Shared lighting retained when the procedural legacy car is replaced.
export function applySceneEnvironment(renderer, scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const c = canvas.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#72b8ed');
  g.addColorStop(0.48, '#d9ecfa');
  g.addColorStop(0.54, '#f1e5c5');
  g.addColorStop(1, '#697344');
  c.fillStyle = g;
  c.fillRect(0, 0, 512, 256);
  const env = new THREE.CanvasTexture(canvas);
  env.colorSpace = THREE.SRGBColorSpace;
  env.mapping = THREE.EquirectangularReflectionMapping;
  const generator = new THREE.PMREMGenerator(renderer);
  const target = generator.fromEquirectangular(env);
  scene.environment = target.texture;
  scene.environmentIntensity = 0.25;
  env.dispose();
  generator.dispose();
}
