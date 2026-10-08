import * as THREE from 'three';
import { drivingHeight } from './world-queries.js';

export const CORRAL = Object.freeze({
  x: 164,
  z: 23,
  halfX: 4,
  halfZ: 3,
  gateWidth: 4,
  height: 1.55,
});

// Small deterministic textures work in the browser and in real-asset Node tests.
// Bark has long fissures; sawn boards retain quieter longitudinal grain.
function woodTexture(bark) {
  const width = 128,
    height = 256,
    pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const grain =
        Math.sin(x * 0.57 + Math.sin(y * 0.043) * 0.8) *
        Math.sin(x * 0.21 + Math.sin(y * 0.017) * 0.6);
      const fissure = bark ? Math.pow(Math.max(0, grain), 3) * 34 : grain * 8;
      const noise = ((x * 73 + y * 37 + x * y * 13) % 29) - 14;
      const tone = (bark ? 101 : 124) - fissure + noise * (bark ? 0.42 : 0.2);
      const i = (y * width + x) * 4;
      pixels[i] = tone;
      pixels[i + 1] = tone * 0.73;
      pixels[i + 2] = tone * 0.52;
      pixels[i + 3] = 255;
    }
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.name = bark ? 'Unpeeled dark timber bark' : 'Dark sawn timber grain';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createCorralModel(
  scene,
  colliders,
  ground = drivingHeight,
  { side = 'left' } = {},
) {
  const root = new THREE.Group();
  root.name = 'Zombie animal corral';
  const grain = woodTexture(false),
    barkMap = woodTexture(true);
  const timber = new THREE.MeshStandardMaterial({ map: grain, roughness: 0.94 });
  const dark = new THREE.MeshStandardMaterial({ map: grain, color: '#b09a80', roughness: 0.96 });
  const bark = new THREE.MeshStandardMaterial({
    map: barkMap,
    bumpMap: barkMap,
    bumpScale: 0.012,
    roughness: 0.98,
  });
  const endGrain = new THREE.MeshStandardMaterial({ color: '#94704c', roughness: 0.95 });
  const iron = new THREE.MeshStandardMaterial({
    color: '#302f2a',
    roughness: 0.72,
    metalness: 0.65,
  });
  const bodies = [],
    gateBodies = [];
  function box(parent, name, x, y, z, sx, sy, sz, material = timber) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  const gateZ = CORRAL.z - CORRAL.halfZ,
    left = CORRAL.x - CORRAL.gateWidth / 2;
  const base = ground(CORRAL.x, CORRAL.z);
  function log(name, a, b, radius, seed) {
    const direction = b.clone().sub(a),
      length = direction.length();
    const geometry = new THREE.CylinderGeometry(radius * 0.93, radius, length, 12, 8);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i);
      if (Math.hypot(x, z) < radius * 0.5) continue;
      const angle = Math.atan2(z, x);
      const uneven = 1 + 0.035 * Math.sin(angle * 5 + seed) + 0.02 * Math.sin(p.getY(i) * 3 + seed);
      p.setXYZ(i, x * uneven, p.getY(i), z * uneven);
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, [bark, endGrain, endGrain]);
    mesh.name = name;
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }
  const postLocations = new Set();
  function fence(a, b) {
    const length = Math.hypot(b.x - a.x, b.z - a.z),
      segments = Math.ceil(length / 1.6);
    for (let i = 0; i <= segments; i++) {
      const x = a.x + ((b.x - a.x) * i) / segments,
        z = a.z + ((b.z - a.z) * i) / segments;
      const key = x.toFixed(3) + ':' + z.toFixed(3);
      if (!postLocations.has(key)) {
        postLocations.add(key);
        const atGate =
          Math.abs(z - gateZ) < 0.01 &&
          (Math.abs(x - left) < 0.01 || Math.abs(x - left - CORRAL.gateWidth) < 0.01);
        log(
          atGate ? 'Bark covered gate post' : 'Bark covered fence post',
          new THREE.Vector3(x, ground(x, z) - 0.04, z),
          new THREE.Vector3(x, ground(x, z) + (atGate ? 1.8 : 1.62), z),
          atGate ? 0.14 : 0.105,
          x + z,
        );
      }
    }
    for (const y of [0.42, 0.86, 1.28]) {
      log(
        'Bark covered fence rail',
        new THREE.Vector3(a.x, base + y, a.z),
        new THREE.Vector3(b.x, base + y, b.z),
        0.07,
        a.x + b.z + y,
      );
    }
    for (let i = 0; i <= Math.ceil(length / 0.35); i++) {
      const t = i / Math.ceil(length / 0.35);
      bodies.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        radius: 0.16,
        height: 1.6,
        corral: true,
      });
    }
  }
  const x0 = CORRAL.x - CORRAL.halfX,
    x1 = CORRAL.x + CORRAL.halfX,
    z1 = CORRAL.z + CORRAL.halfZ;
  fence({ x: x0, z: gateZ }, { x: left, z: gateZ });
  fence({ x: left + CORRAL.gateWidth, z: gateZ }, { x: x1, z: gateZ });
  fence({ x: x0, z: gateZ }, { x: x0, z: z1 });
  fence({ x: x1, z: gateZ }, { x: x1, z: z1 });
  fence({ x: x0, z: z1 }, { x: x1, z: z1 });
  const gate = new THREE.Group();
  gate.name = 'Corral swinging gate';
  gate.position.set(left, ground(left, gateZ), gateZ);
  root.add(gate);
  for (const x of [0.09, CORRAL.gateWidth - 0.09])
    box(gate, 'Gate stile', x, 0.81, 0, 0.16, 1.42, 0.13, dark);
  for (const y of [0.2, 1.42])
    box(gate, 'Gate rail', CORRAL.gateWidth / 2, y, 0, CORRAL.gateWidth, 0.16, 0.13, dark);
  for (let i = 0; i < 16; i++)
    box(gate, 'Gate vertical plank', 0.19 + i * 0.188, 0.81, -0.025, 0.176, 1.25, 0.04, timber);
  const brace = box(
    gate,
    'Gate diagonal brace',
    CORRAL.gateWidth / 2,
    0.84,
    0.09,
    Math.hypot(CORRAL.gateWidth - 0.25, 1.05),
    0.12,
    0.075,
    dark,
  );
  brace.rotation.z = Math.atan2(1.05, CORRAL.gateWidth - 0.25);
  for (const y of [0.36, 1.25]) {
    box(gate, 'Iron strap hinge', 0.3, y, -0.09, 0.58, 0.065, 0.035, iron);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10), iron);
    barrel.name = 'Iron hinge barrel';
    barrel.position.set(0, y, -0.08);
    gate.add(barrel);
    for (const x of [0.12, 0.35, 0.53]) {
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 6), iron);
      bolt.name = 'Gate hinge bolt';
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(x, y, -0.116);
      gate.add(bolt);
    }
  }
  const latch = box(
    gate,
    'Gate sliding latch',
    CORRAL.gateWidth - 0.19,
    1.15,
    -0.12,
    0.3,
    0.045,
    0.05,
    iron,
  );
  box(
    root,
    'Gate latch keeper',
    left + CORRAL.gateWidth + 0.075,
    base + 1.15,
    gateZ - 0.11,
    0.12,
    0.095,
    0.07,
    iron,
  );
  box(
    gate,
    'Gate handle mounting plate',
    CORRAL.gateWidth - 0.25,
    1.15,
    -0.087,
    0.12,
    0.18,
    0.035,
    iron,
  );
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.012, 6, 16), iron);
  handle.name = 'Iron gate ring handle';
  handle.position.set(CORRAL.gateWidth - 0.25, 1.15, -0.15);
  gate.add(handle);
  for (let i = 0; i <= 12; i++)
    gateBodies.push({
      x: left + (i * CORRAL.gateWidth) / 12,
      z: gateZ,
      radius: 0.17,
      height: 1.5,
      corral: true,
      corralGate: true,
    });
  bodies.push(...gateBodies);
  colliders.push(...bodies);
  scene.add(root);
  const mirrored = side === 'right';
  if (mirrored) {
    gate.position.x = left + CORRAL.gateWidth;
    gate.scale.x = -1;
    const keeper = root.getObjectByName('Gate latch keeper');
    keeper.position.x = left - 0.075;
  }
  return {
    root,
    gate,
    bodies,
    gateBodies,
    latch,
    handle,
    setLatched(amount) {
      latch.position.x = CORRAL.gateWidth - 0.19 - (1 - amount) * 0.17;
    },
    latchPoint() {
      root.updateMatrixWorld(true);
      return gate.localToWorld(new THREE.Vector3(CORRAL.gateWidth - 0.25, 1.15, 0));
    },
    handPoint() {
      root.updateMatrixWorld(true);
      return handle.getWorldPosition(new THREE.Vector3());
    },
    operatorPoint(amount, front = 0.72) {
      const angle = (amount * Math.PI) / 2,
        along = CORRAL.gateWidth - 0.21;
      const sign = mirrored ? -1 : 1;
      return {
        x: gate.position.x + sign * along * Math.cos(angle) - sign * front * Math.sin(angle),
        z: gate.position.z - along * Math.sin(angle) - front * Math.cos(angle),
      };
    },
    leafPoint(amount, along) {
      const sign = mirrored ? -1 : 1,
        angle = (amount * Math.PI) / 2;
      return {
        x: gate.position.x + sign * along * Math.cos(angle),
        z: gate.position.z - along * Math.sin(angle),
      };
    },
    setAmount(amount) {
      gate.rotation.y = ((mirrored ? -1 : 1) * (amount * Math.PI)) / 2;
      root.updateMatrixWorld(true);
      for (let i = 0; i < gateBodies.length; i++) {
        const p = gate.localToWorld(new THREE.Vector3((i * CORRAL.gateWidth) / 12, 0, 0));
        gateBodies[i].x = p.x;
        gateBodies[i].z = p.z;
      }
    },
  };
}
