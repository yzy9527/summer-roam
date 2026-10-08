import * as THREE from 'three';
import { ploughWater } from './paddy-plough-site.js';
import { fitPloughHarness } from './paddy-plough-harness.js';

const up = new THREE.Vector3(0, 1, 0);
const material = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.92 });
export function link(mesh, a, b) {
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  const d = b.clone().sub(a);
  mesh.scale.y = d.length();
  mesh.quaternion.setFromUnitVectors(up, d.normalize());
}
function rod(parent, radius, mat, a, b) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 8), mat);
  parent.add(mesh);
  mesh.castShadow = mesh.receiveShadow = true;
  link(mesh, new THREE.Vector3(...a), new THREE.Vector3(...b));
  return mesh;
}

// Fixed topology: update only vertices, without allocating/discarding tube
// geometries each frame. The curve can be a lead, a trace, or a flexible whip.
export function createCord(radius, color, segments = 24, endRadius = radius) {
  const geometry = new THREE.BufferGeometry(),
    sides = 6;
  const positions = new Float32Array((segments + 1) * sides * 3),
    indices = [];
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j,
        b = i * sides + ((j + 1) % sides);
      indices.push(a, b, a + sides, b, b + sides, a + sides);
    }
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  geometry.setIndex(indices);
  const point = new THREE.Vector3(),
    tangent = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    binormal = new THREE.Vector3(),
    vertex = new THREE.Vector3(),
    xAxis = new THREE.Vector3(1, 0, 0);
  const circle = Array.from({ length: sides }, (_, j) => [
    Math.cos((j * Math.PI * 2) / sides),
    Math.sin((j * Math.PI * 2) / sides),
  ]);
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.frustumCulled = false;
  return {
    mesh,
    update(curve) {
      for (let i = 0; i <= segments; i++) {
        const t = i / segments,
          width = THREE.MathUtils.lerp(radius, endRadius, t);
        curve.getPoint(t, point);
        curve.getTangent(t, tangent).normalize();
        normal.crossVectors(tangent, Math.abs(tangent.y) > 0.95 ? xAxis : up).normalize();
        binormal.crossVectors(tangent, normal).normalize();
        for (let j = 0; j < sides; j++) {
          const [cos, sin] = circle[j],
            offset = (i * sides + j) * 3;
          vertex
            .copy(point)
            .addScaledVector(normal, width * cos)
            .addScaledVector(binormal, width * sin)
            .toArray(positions, offset);
        }
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.computeVertexNormals();
    },
  };
}

export function createPloughProps(root, cow, asset) {
  if (!asset) throw new Error('耕田需要完整木犁资产');
  const wood = material('#76502e'),
    leather = material('#86623d');
  const model = asset.clone(true);
  const plough = model.getObjectByName('plough_body'),
    timber = model.getObjectByName('shoulder_yoke'),
    beam = model.getObjectByName('draft_beam'),
    share = model.getObjectByName('forged_iron_share'),
    gripSocket = model.getObjectByName('handle_grip'),
    hitchSocket = model.getObjectByName('beam_hitch'),
    pullSocket = model.getObjectByName('yoke_pull');
  if (!plough || !timber || !beam || !share || !gripSocket || !hitchSocket || !pullSocket)
    throw new Error('木犁缺少完整构件或握持挂点');
  model.traverse((n) => {
    if (n.isMesh) n.castShadow = n.receiveShadow = true;
  });
  root.add(plough);
  const head = cow.source.getObjectByName('Head');
  const yoke = new THREE.Group();
  yoke.name = '贴合肩颈的单牛木轭';
  yoke.add(timber);
  root.add(yoke);
  const fit = fitPloughHarness(cow, yoke, timber, beam);
  const neckStrap = createCord(0.014, '#baa078', 40),
    trace = createCord(0.015, '#baa078', 24);
  neckStrap.mesh.name = '贴颈固定绳套';
  trace.mesh.name = '肩轭连接曲犁辕的柔性耕索';
  root.add(neckStrap.mesh, trace.mesh);
  const halter = new THREE.Group();
  halter.name = '牵牛头笼';
  root.add(halter);
  halter.quaternion.copy(cow.group.getWorldQuaternion(new THREE.Quaternion()));
  halter.position
    .copy(cow.rig.contactPoint())
    .add(new THREE.Vector3(0, 0, -0.075).applyQuaternion(halter.quaternion));
  if (cow.id === 'hornless-calf') halter.scale.setScalar(0.78);
  const noseband = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.014, 6, 20), leather);
  noseband.scale.y = 0.72;
  halter.add(noseband);
  for (const side of [-1, 1])
    rod(halter, 0.013, leather, [side * 0.14, 0, 0], [side * 0.14, 0.17, -0.27]);
  rod(halter, 0.014, leather, [-0.14, 0.17, -0.27], [0.14, 0.17, -0.27]);
  head.attach(halter);
  const lead = createCord(0.012, '#baa078');
  lead.mesh.name = '旗手左手牵牛绳';
  root.add(lead.mesh);
  const whip = createCord(0.013, '#493c2b', 48, 0.004);
  whip.mesh.name = '柔性牛鞭';
  root.add(whip.mesh);
  const handle = rod(root, 0.026, wood, [0, 0, 0], [0, 1, 0]);
  handle.name = '僵尸右手鞭柄';
  return {
    plough,
    halter,
    neckStrap,
    share,
    beam,
    yoke,
    lead,
    whip,
    handle,
    fit,
    trace,
    grip: () => gripSocket.getWorldPosition(new THREE.Vector3()),
    nose: () => halter.localToWorld(new THREE.Vector3(-0.14, 0, 0)),
    hitch: () => hitchSocket.getWorldPosition(new THREE.Vector3()),
    pull: () => pullSocket.getWorldPosition(new THREE.Vector3()),
    shareTip: () => plough.getObjectByName('share_tip').getWorldPosition(new THREE.Vector3()),
    shareHeel: () => plough.getObjectByName('share_heel').getWorldPosition(new THREE.Vector3()),
    updateTraces(turning = 0) {
      neckStrap.update(new THREE.CatmullRomCurve3(fit.update(), true, 'centripetal'));
      const a = pullSocket.getWorldPosition(new THREE.Vector3()),
        b = hitchSocket.getWorldPosition(new THREE.Vector3());
      // In a headland turn the raised plough unloads the trace. Guide the
      // slack cord outside the haunch instead of cutting across the animal.
      const outside = (z, height) =>
        cow.group.localToWorld(
          new THREE.Vector3(fit.metrics.yokeWidth * 0.6, height, z).divideScalar(cow.scale),
        );
      const front = a
        .clone()
        .lerp(b, 0.28)
        .lerp(outside(fit.metrics.shoulderZ - 0.3, 0.91), turning);
      const rear = a
        .clone()
        .lerp(b, 0.74)
        .lerp(outside(fit.metrics.rearZ - 0.24, 0.7), turning);
      if (turning < 0.01) {
        front.y -= 0.015;
        rear.y -= 0.015;
      }
      trace.update(new THREE.CatmullRomCurve3([a, front, rear, b], false, 'centripetal'));
    },
  };
}

export function createPloughEffects(root) {
  const dummy = new THREE.Object3D(),
    rings = [],
    drops = [];
  const ringMesh = new THREE.InstancedMesh(
    new THREE.TorusGeometry(1, 0.013, 4, 24),
    new THREE.MeshBasicMaterial({
      color: '#d2e4d7',
      transparent: true,
      opacity: 0.27,
      depthWrite: false,
    }),
    32,
  );
  const dropMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 5, 4),
    material('#a2beb7'),
    64,
  );
  const mudMesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.15, 0.26),
    new THREE.MeshStandardMaterial({
      color: '#66563d',
      transparent: true,
      opacity: 0.45,
      roughness: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    480,
  );
  ringMesh.name = '蹄落水面涟漪';
  dropMesh.name = '踩水泥点';
  mudMesh.name = '犁过的湿泥痕迹';
  for (const mesh of [ringMesh, dropMesh, mudMesh]) {
    mesh.frustumCulled = false;
    for (let i = 0; i < mesh.count; i++) {
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    root.add(mesh);
  }
  let clock = 0,
    mudIndex = 0;
  return {
    splash(point) {
      rings.push({ x: point.x, z: point.z, born: clock });
      if (rings.length > 32) rings.shift();
      for (let i = 0; i < 3; i++)
        drops.push({
          x: point.x,
          z: point.z,
          born: clock,
          angle: i * 2.4 + clock * 3,
          velocity: 0.38 + i * 0.12,
        });
      if (drops.length > 64) drops.splice(0, drops.length - 64);
    },
    furrow(point, heading) {
      dummy.position.set(point.x, ploughWater(point.x, point.z) + 0.001, point.z);
      dummy.rotation.set(-Math.PI / 2, 0, -heading);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mudMesh.setMatrixAt(mudIndex++ % mudMesh.count, dummy.matrix);
      mudMesh.instanceMatrix.needsUpdate = true;
    },
    update(dt, draw = true) {
      if (!(dt > 0)) return;
      clock += dt;
      if (!draw) return;
      for (let i = 0; i < 32; i++) {
        const r = rings[i],
          age = r ? clock - r.born : 2;
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.setScalar(age < 1.1 ? 0.04 + age * 0.35 : 0);
        if (r) dummy.position.set(r.x, ploughWater(r.x, r.z) + 0.005, r.z);
        dummy.updateMatrix();
        ringMesh.setMatrixAt(i, dummy.matrix);
      }
      for (let i = 0; i < 64; i++) {
        const p = drops[i],
          age = p ? clock - p.born : 2;
        const h = p ? p.velocity * age - 2.8 * age * age : -1;
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(h > 0 ? 0.012 : 0);
        if (p)
          dummy.position.set(
            p.x + Math.cos(p.angle) * age * 0.16,
            ploughWater(p.x, p.z) + Math.max(0, h),
            p.z + Math.sin(p.angle) * age * 0.16,
          );
        dummy.updateMatrix();
        dropMesh.setMatrixAt(i, dummy.matrix);
      }
      ringMesh.instanceMatrix.needsUpdate = dropMesh.instanceMatrix.needsUpdate = true;
    },
    snapshot: () => ({ clock, furrows: mudIndex, rings: rings.length, drops: drops.length }),
  };
}
