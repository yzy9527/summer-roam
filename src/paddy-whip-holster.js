import * as THREE from 'three';
import { link } from './paddy-plough-props.js';

// Find a real waist vertex once; follow its deformed skin while carrying wood.
export function createWhipHolster(root, worker, whip, handle) {
  worker.object.updateMatrixWorld(true);
  let hips;
  worker.source.traverse((n) => {
    if (n.isBone && n.name.replace(/_0\d+$/, '') === 'Hips' && !hips) hips = n;
  });
  if (!hips) throw new Error('扶犁工缺少腰部骨骼');
  const workerRotation = worker.object.getWorldQuaternion(new THREE.Quaternion());
  const relativeHip = workerRotation
    .clone()
    .invert()
    .multiply(hips.getWorldQuaternion(new THREE.Quaternion()));
  const target = hips
    .getWorldPosition(new THREE.Vector3())
    .add(new THREE.Vector3(-0.26, 0.08, 0.04).applyQuaternion(workerRotation));
  let surface = null,
    nearest = Infinity;
  worker.source.traverse((mesh) => {
    if (!mesh.isSkinnedMesh || !mesh.visible) return;
    const { skinIndex, skinWeight, position } = mesh.geometry.attributes;
    mesh.skeleton.update();
    for (let i = 0; i < position.count; i++) {
      let waistWeight = 0;
      for (let j = 0; j < 4; j++) {
        const name = mesh.skeleton.bones[skinIndex.getComponent(i, j)].name.replace(/_0\d+$/, '');
        if (/^(Hips|Spine|Spine1)$/.test(name)) waistWeight += skinWeight.getComponent(i, j);
      }
      if (waistWeight < 0.5) continue;
      const point = mesh.localToWorld(mesh.getVertexPosition(i, new THREE.Vector3()));
      const distance = point.distanceToSquared(target);
      if (distance < nearest) {
        nearest = distance;
        surface = { mesh, vertex: i };
      }
    }
  });
  if (!surface) throw new Error('扶犁工缺少可安装鞭扣的腰部蒙皮');
  const holder = new THREE.Group();
  holder.name = '贴腰鞭子挂扣';
  const leather = new THREE.MeshStandardMaterial({ color: '#5a3926', roughness: 0.9 });
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.13, 0.035), leather);
  strap.position.y = -0.045;
  const clip = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.012, 6, 12), leather);
  clip.position.set(-0.025, -0.085, 0.02);
  holder.add(strap, clip);
  root.add(holder);
  const anchor = new THREE.Vector3(),
    rotation = new THREE.Quaternion();
  const at = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(rotation).add(anchor);
  return {
    update(visible) {
      holder.visible = visible;
      if (!visible) return;
      surface.mesh.skeleton.update();
      anchor.copy(
        surface.mesh.localToWorld(
          surface.mesh.getVertexPosition(surface.vertex, new THREE.Vector3()),
        ),
      );
      rotation
        .copy(hips.getWorldQuaternion(new THREE.Quaternion()))
        .multiply(relativeHip.clone().invert());
      anchor.add(new THREE.Vector3(-0.018, 0, 0).applyQuaternion(rotation));
      holder.position.copy(anchor);
      holder.quaternion.copy(rotation);
      const loop = Array.from({ length: 49 }, (_, i) => {
        const t = (i / 48) * Math.PI * 4;
        return at(-0.06 + Math.cos(t) * 0.065, -0.15 + Math.sin(t) * 0.065, 0.018 + i * 0.0003);
      });
      whip.update(new THREE.CatmullRomCurve3(loop));
      link(handle, at(-0.025, -0.085, 0.02), at(-0.09, -0.36, 0.025));
    },
    snapshot: () => ({
      visible: holder.visible,
      anchor: anchor.toArray(),
      mesh: surface.mesh.name,
      vertex: surface.vertex,
    }),
    dispose() {
      holder.removeFromParent();
      strap.geometry.dispose();
      clip.geometry.dispose();
      leather.dispose();
    },
  };
}
