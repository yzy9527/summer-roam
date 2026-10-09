import * as THREE from 'three';

// Editable procedural source: an open pail, rolled rim, bail and visible milk.
// Origin is the bottom of the pail; the bail's top is the mouth grip.
export const MILK_BUCKET = Object.freeze({ radius: 0.18, height: 0.3, grip: 0.57 });
export function createMilkBucket(scene) {
  const root = new THREE.Group();
  root.name = 'Open milk pail';
  const metal = new THREE.MeshStandardMaterial({
    color: '#acbdc1',
    metalness: 0.65,
    roughness: 0.37,
  });
  const outline = [
    [0, 0],
    [0.135, 0],
    [0.18, 0.3],
    [0.169, 0.3],
    [0.125, 0.018],
    [0, 0.018],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const shell = new THREE.Mesh(new THREE.LatheGeometry(outline, 32), metal);
  shell.name = 'Open tapered metal pail';
  root.add(shell);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.013, 8, 32), metal);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.3;
  root.add(rim);
  const curve = new THREE.CatmullRomCurve3(
    Array.from({ length: 25 }, (_, i) => {
      const angle = (Math.PI * i) / 24;
      return new THREE.Vector3(0.18 * Math.cos(angle), 0.29 + 0.28 * Math.sin(angle), 0);
    }),
  );
  const handle = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.009, 6, false), metal);
  handle.name = 'Pail carrying bail';
  root.add(handle);
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.09, 8),
    new THREE.MeshStandardMaterial({ color: '#78543a', roughness: 0.8 }),
  );
  grip.rotation.z = Math.PI / 2;
  grip.position.y = MILK_BUCKET.grip;
  root.add(grip);
  const milk = new THREE.Mesh(
    new THREE.CircleGeometry(1, 32),
    new THREE.MeshStandardMaterial({ color: '#fff8e6', roughness: 0.3, side: THREE.DoubleSide }),
  );
  milk.name = 'Milk surface';
  milk.rotation.x = -Math.PI / 2;
  root.add(milk);
  root.traverse((node) => {
    if (node.isMesh) node.castShadow = node.receiveShadow = true;
  });
  scene.add(root);
  let fill = 1;
  return {
    root,
    setFill(value) {
      fill = THREE.MathUtils.clamp(value, 0, 1);
      const y = 0.02 + fill * 0.205;
      milk.position.y = y;
      milk.scale.setScalar(0.125 + (y / 0.3) * 0.044);
      milk.visible = fill > 0.001;
    },
    gripPoint: () => root.localToWorld(new THREE.Vector3(0, MILK_BUCKET.grip, 0)),
    get fill() {
      return fill;
    },
  };
}
