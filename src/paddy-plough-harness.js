import * as THREE from 'three';

// Existing adult cows share this body/neck contract. New skeletons must provide
// an explicit body mesh and a neck landmark instead of silently using a guess.
export function fitPloughHarness(cow, yoke, timber, beam) {
  const mesh = cow.source.getObjectByName('Continuous_quadruped_body_and_four_legs');
  const body = cow.source.getObjectByName('Body'),
    neck = cow.source.getObjectByName('Neck');
  if (!mesh?.isSkinnedMesh || !body || !neck) throw new Error('耕牛缺少肩颈适配挂点');
  cow.group.updateMatrixWorld(true);
  mesh.skeleton.update();
  const local = (p) => cow.group.worldToLocal(p).multiplyScalar(cow.scale);
  const world = (p) => cow.group.localToWorld(p.clone().divideScalar(cow.scale));
  const bounds = new THREE.Box3();
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++)
    bounds.expandByPoint(local(mesh.localToWorld(mesh.getVertexPosition(i, new THREE.Vector3()))));
  const shoulderZ = local(neck.getWorldPosition(new THREE.Vector3())).z - 0.035;
  const halfWidth = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
  const widthScale = (halfWidth * 1.24) / 0.5;
  timber.scale.x = widthScale;
  beam.scale.x = widthScale;
  const raycaster = new THREE.Raycaster();
  function anchor(origin, direction) {
    const a = world(origin),
      b = world(origin.clone().add(direction));
    raycaster.set(a, b.sub(a).normalize());
    const hit = raycaster.intersectObject(mesh, false)[0];
    if (!hit?.face) throw new Error('牛肩颈表面无法定位');
    const ids = [hit.face.a, hit.face.b, hit.face.c];
    const vertices = ids.map((i) => mesh.getVertexPosition(i, new THREE.Vector3()));
    const weights = THREE.Triangle.getBarycoord(
      mesh.worldToLocal(hit.point.clone()),
      ...vertices,
      new THREE.Vector3(),
    ).toArray();
    return () => {
      const point = new THREE.Vector3();
      for (let j = 0; j < 3; j++)
        point.addScaledVector(mesh.getVertexPosition(ids[j], new THREE.Vector3()), weights[j]);
      return mesh.localToWorld(point);
    };
  }
  const fractions = [-0.64, -0.32, 0, 0.32, 0.64];
  const contacts = fractions.map((x) =>
    anchor(
      new THREE.Vector3(x * 0.5 * widthScale, bounds.max.y + 1, shoulderZ),
      new THREE.Vector3(0, -1, 0),
    ),
  );
  const top = local(contacts[2]());
  const strapCenter = new THREE.Vector3(0, top.y - 0.24, shoulderZ);
  const strap = Array.from({ length: 16 }, (_, i) => {
    const angle = (i * Math.PI * 2) / 16,
      radial = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
    const point = anchor(strapCenter.clone().addScaledVector(radial, 2), radial.clone().negate());
    return () =>
      point().add(
        radial
          .clone()
          .applyQuaternion(cow.group.getWorldQuaternion(new THREE.Quaternion()))
          .multiplyScalar(0.027),
      );
  });
  // Keep the Blender cross-section and wear; only bend its mounting contour.
  const geometries = [];
  const woodVertices = [];
  timber.traverse((n) => {
    if (!n.isMesh) return;
    n.geometry = n.geometry.clone();
    const base = n.geometry.attributes.position.array.slice();
    geometries.push({ mesh: n, base });
    if (n.parent.name === 'curved_shoulder_timber' || n.name === 'curved_shoulder_timber')
      for (let i = 0; i < base.length; i += 3) woodVertices.push([base[i], base[i + 1]]);
  });
  const underside = fractions.map((f) => {
    const nearby = woodVertices.filter(([x]) => Math.abs(x - f * 0.5) < 0.018);
    return Math.min(...nearby.map(([, y]) => y));
  });
  if (!underside.every(Number.isFinite)) throw new Error('木轭缺少可适配的接触轮廓');
  yoke.position.copy(contacts[2]());
  yoke.quaternion.copy(cow.group.getWorldQuaternion(new THREE.Quaternion()));
  body.attach(yoke);
  let gap = 0,
    fitted = null;
  return {
    metrics: {
      shoulderWidth: halfWidth * 2,
      yokeWidth: widthScale,
      bodyLength: bounds.max.z - bounds.min.z,
      rearZ: bounds.min.z,
      shoulderZ,
    },
    update() {
      mesh.skeleton.update();
      const center = contacts[2]();
      yoke.position.copy(body.worldToLocal(center.clone()));
      yoke.updateMatrixWorld(true);
      const offsets = contacts.map(
        (point, i) => yoke.worldToLocal(point()).y + 0.006 - underside[i],
      );
      const correction = (x) => {
        // Five uniformly spaced mounting samples: x = -.32 .. .32.
        const f = THREE.MathUtils.clamp(x / 0.16 + 2, 0, 4),
          i = Math.min(3, Math.floor(f));
        return THREE.MathUtils.lerp(offsets[i], offsets[i + 1], f - i);
      };
      // Shoulder motion follows Body every step. Rebuild the wood only when
      // its local mounting contour changes by more than half a millimetre.
      if (!fitted || offsets.some((v, i) => Math.abs(v - fitted[i]) > 0.0005)) {
        for (const { mesh: part, base } of geometries) {
          const position = part.geometry.attributes.position;
          for (let i = 0; i < position.count; i++)
            position.setY(i, base[i * 3 + 1] + correction(base[i * 3]));
          position.needsUpdate = true;
          part.geometry.computeVertexNormals();
          part.geometry.computeBoundingSphere();
        }
        fitted = offsets;
      }
      // The pull socket bends with the timber end, rather than floating below it.
      const pull = timber.getObjectByName('yoke_pull');
      pull.position.y = -0.16 + correction(0.49);
      gap = Math.max(...offsets.map((v, i) => Math.abs(0.006 + fitted[i] - v)));
      return strap.map((point) => point());
    },
    contact: () => contacts[2](),
    gap: () => gap,
  };
}
