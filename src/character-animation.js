import * as THREE from 'three';

// Shared joint aiming for Shiro. Human animation is preserved in local-archive/.
export function aimJoint(bone, child, target) {
  bone.updateWorldMatrix(true, true);
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const from = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  const to = target.clone().sub(origin).normalize();
  const world = new THREE.Quaternion()
    .setFromUnitVectors(from, to)
    .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(
    bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world),
  );
  bone.updateWorldMatrix(false, true);
}
