import * as THREE from 'three';
import { drivingHeight } from './world-queries.js';

export const LOOKOUT_SITE = Object.freeze({ x: 146, z: 23, deck: 8, roof: 10.1 });
export const LOOKOUT_NOTICE_SECONDS = 3.2;
export const LOOKOUT_STRIKES = Object.freeze([1.35, 1.95]);
const smooth = (t) => {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * t * (10 + t * (-15 + 6 * t));
};

export function createZombieLookout(scene, colliders, zombies) {
  const site = LOOKOUT_SITE,
    ground = drivingHeight(site.x, site.z);
  const root = new THREE.Group();
  root.name = '僵尸营地高瞭望塔';
  root.position.set(site.x, ground, site.z);
  const wood = new THREE.MeshStandardMaterial({ color: 0x69503a, roughness: 0.95 });
  const pale = new THREE.MeshStandardMaterial({ color: 0x997653, roughness: 0.9 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x383b39, roughness: 0.6, metalness: 0.6 });
  function box(name, size, position, material = wood) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }
  function beam(name, a, b, width = 0.2) {
    const from = new THREE.Vector3(...a),
      to = new THREE.Vector3(...b);
    const mesh = box(
      name,
      [width, from.distanceTo(to), width],
      from.clone().add(to).multiplyScalar(0.5).toArray(),
    );
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize());
  }
  for (const x of [-1.55, 1.55])
    for (const z of [-1.55, 1.55]) {
      box('高塔承重木柱', [0.32, site.roof, 0.32], [x, site.roof / 2, z]);
      box('铁箍柱脚', [0.4, 0.4, 0.4], [x, 0.2, z], iron);
      colliders.push({
        x: site.x + x,
        z: site.z + z,
        radius: 0.3,
        height: site.roof,
        lookoutTower: true,
      });
    }
  for (const y of [0.7, 3.2, 5.7])
    for (const side of [-1, 1]) {
      beam('塔身交叉斜撑', [-1.55, y, side * 1.55], [1.55, y + 2.1, side * 1.55]);
      beam('塔身交叉斜撑', [side * 1.55, y, -1.55], [side * 1.55, y + 2.1, 1.55]);
    }
  for (let i = 0; i < 12; i++)
    box('瞭望平台木板', [3.8, 0.22, 0.3], [0, site.deck - 0.11, -1.65 + i * 0.3], pale);
  for (const y of [site.deck + 0.35, site.deck + 0.75]) {
    for (const z of [-1.75, 1.75]) box('瞭望台横护栏', [3.7, 0.065, 0.065], [0, y, z]);
    box('瞭望台西护栏', [0.065, 0.065, 3.7], [-1.75, y, 0]);
    for (const z of [-1.2, 1.2]) box('梯口护栏', [0.065, 0.065, 1.1], [1.75, y, z]);
  }
  for (const z of [-0.45, 0.45]) beam('高塔梯子侧梁', [2.1, 0, z], [1.8, site.deck + 0.8, z], 0.12);
  for (let i = 0; i < 25; i++)
    box('梯子踏棍', [0.12, 0.07, 1], [2.1 - i * 0.012, 0.3 + i * 0.32, 0], pale);
  colliders.push({ x: site.x + 2, z: site.z, radius: 0.55, height: site.deck, lookoutTower: true });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.15, 1.3, 4), wood);
  roof.name = '瞭望塔遮雨屋顶';
  roof.rotation.y = Math.PI / 4;
  roof.position.y = site.roof + 0.45;
  roof.castShadow = true;
  root.add(roof);
  scene.add(root);
  const actor = zombies.addLookout({ x: site.x, y: ground + site.deck, z: site.z });
  if (!actor) {
    scene.remove(root);
    colliders.splice(0, colliders.length, ...colliders.filter((c) => !c.lookoutTower));
    return null;
  }
  // Beside the lookout's right arm while facing west, within a short reach.
  // A roof suspension cord supports the bell; the separate lower cord pulls
  // its clapper. Both hang vertically at rest, as on a small rope-pull bell.
  const bell = new THREE.Group();
  bell.name = '瞭望塔悬挂铜铃';
  bell.position.set(-0.25, site.roof - 0.46, -0.45);
  root.add(bell);
  const ropeMaterial = new THREE.MeshStandardMaterial({ color: 0xb4a17c, roughness: 1 });
  const suspensionTop = new THREE.Vector3(bell.position.x, site.roof - 0.08, bell.position.z);
  const suspension = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, suspensionTop.y - bell.position.y, 8),
    ropeMaterial,
  );
  suspension.name = '屋顶铜铃吊绳';
  suspension.position.copy(suspensionTop).add(bell.position).multiplyScalar(0.5);
  suspension.castShadow = true;
  root.add(suspension);
  const bronze = new THREE.MeshStandardMaterial({
    color: 0xb78e43,
    metalness: 0.72,
    roughness: 0.38,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.018, 8, 16), iron);
  ring.name = '铜铃吊环';
  bell.add(ring);
  const cup = new THREE.Mesh(
    new THREE.LatheGeometry(
      [
        // Rounded crown and shoulder, a narrow waist, then a curved sound bow.
        // The profile returns up the inside to form a hollow cast bell.
        new THREE.Vector2(0, -0.048),
        new THREE.Vector2(0.028, -0.048),
        new THREE.Vector2(0.047, -0.056),
        new THREE.Vector2(0.069, -0.068),
        new THREE.Vector2(0.09, -0.084),
        new THREE.Vector2(0.104, -0.106),
        new THREE.Vector2(0.111, -0.133),
        new THREE.Vector2(0.115, -0.165),
        new THREE.Vector2(0.121, -0.2),
        new THREE.Vector2(0.132, -0.239),
        new THREE.Vector2(0.149, -0.279),
        new THREE.Vector2(0.174, -0.318),
        new THREE.Vector2(0.203, -0.352),
        new THREE.Vector2(0.225, -0.38),
        new THREE.Vector2(0.237, -0.402),
        new THREE.Vector2(0.241, -0.421),
        new THREE.Vector2(0.238, -0.434),
        new THREE.Vector2(0.215, -0.434),
        new THREE.Vector2(0.209, -0.413),
        new THREE.Vector2(0.2, -0.387),
        new THREE.Vector2(0.18, -0.354),
        new THREE.Vector2(0.15, -0.318),
        new THREE.Vector2(0.126, -0.277),
        new THREE.Vector2(0.109, -0.233),
        new THREE.Vector2(0.097, -0.19),
        new THREE.Vector2(0.09, -0.151),
        new THREE.Vector2(0.083, -0.12),
        new THREE.Vector2(0.068, -0.096),
        new THREE.Vector2(0.045, -0.081),
        new THREE.Vector2(0, -0.077),
      ],
      48,
    ),
    bronze,
  );
  cup.name = '铜铃钟体';
  cup.castShadow = cup.receiveShadow = true;
  bell.add(cup);
  for (const [radius, y, thickness] of [
    [0.111, -0.132, 0.005],
    [0.225, -0.382, 0.005],
    [0.238, -0.424, 0.007],
  ]) {
    const molding = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 8, 48), bronze);
    molding.name = '铜铃铸造环纹';
    molding.rotation.x = Math.PI / 2;
    molding.position.y = y;
    molding.castShadow = true;
    bell.add(molding);
  }
  const tongue = new THREE.Group();
  tongue.name = '铜铃摆动铃舌';
  tongue.position.y = -0.12;
  bell.add(tongue);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), iron);
  stem.position.y = -0.11;
  tongue.add(stem);
  const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), iron);
  clapper.position.y = -0.25;
  tongue.add(clapper);
  const clapperEye = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.008, 8, 12), iron);
  clapperEye.name = '铃舌拉绳系环';
  clapperEye.position.y = -0.3;
  tongue.add(clapperEye);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 8), ropeMaterial);
  rope.name = '铜铃拉绳';
  root.add(rope);
  const ropeGrip = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.014, 8, 16), ropeMaterial);
  ropeGrip.name = '拉绳握环';
  root.add(ropeGrip);
  const telescope = new THREE.Group();
  telescope.name = '瞭望员长筒望远镜与三脚架';
  scene.add(telescope);
  const scope = new THREE.Group();
  telescope.add(scope);
  const brass = new THREE.MeshStandardMaterial({
    color: 0xc3a365,
    metalness: 0.65,
    roughness: 0.34,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x30433f, metalness: 0.5, roughness: 0.4 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x548b98,
    metalness: 0.4,
    roughness: 0.12,
  });
  function tube(radius, length, z, material, endRadius = radius) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(endRadius, radius, length, 20),
      material,
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.z = z;
    mesh.castShadow = mesh.receiveShadow = true;
    scope.add(mesh);
    return mesh;
  }
  tube(0.13, 1.15, 0, dark, 0.2);
  tube(0.225, 0.12, 0.6, brass);
  tube(0.115, 0.15, -0.65, brass);
  tube(0.09, 0.16, -0.78, iron);
  tube(0.195, 0.012, 0.665, glass);
  for (const z of [-0.4, 0.32]) tube(0.19, 0.05, z, brass);
  const scopeHeight = actor.rig.headPoint().y - ground - site.deck + 0.06;
  scope.position.y = scopeHeight;
  scope.rotation.x = -0.045;
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3;
    const from = new THREE.Vector3(0, scopeHeight - 0.15, 0);
    const to = new THREE.Vector3(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.05, from.distanceTo(to), 8),
      wood,
    );
    leg.name = '望远镜三脚架支脚';
    leg.position.copy(from.clone().add(to).multiplyScalar(0.5));
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.sub(from).normalize());
    leg.castShadow = true;
    telescope.add(leg);
  }
  let clock = 0,
    noticing = false,
    noticeTime = 0;
  let ringMode = null,
    ringTime = 0,
    strike = 0,
    ringId = 0;
  let voiceSent = false,
    speaking = false;
  let ringHeading = actor.object.rotation.y;
  let sound = () => false,
    muted = false;
  const gripPoint = new THREE.Vector3();
  const restGrip = new THREE.Vector3(bell.position.x, site.deck + 1.03, bell.position.z);
  function placeRope(pull = 0) {
    gripPoint.copy(restGrip);
    gripPoint.y -= pull * 0.12;
    gripPoint.x += pull * 0.04;
    gripPoint.z += pull * 0.06;
    ropeGrip.position.copy(gripPoint);
    const anchor = root.worldToLocal(tongue.localToWorld(clapperEye.position.clone()));
    const direction = gripPoint.clone().sub(anchor);
    rope.position.copy(anchor).add(gripPoint).multiplyScalar(0.5);
    rope.scale.y = direction.length();
    rope.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    root.updateMatrixWorld(true);
  }
  placeRope();
  const api = {
    root,
    actor,
    bell,
    telescope,
    suspension,
    scope,
    rope,
    ropeGrip,
    connectAudio(listener) {
      sound = listener;
    },
    ringAvailability() {
      return ringMode ? (ringMode === 'notice' ? '正在摇铃通知' : '正在摇铃') : '';
    },
    ring(mode = 'manual') {
      if (ringMode || !['manual', 'notice'].includes(mode)) return false;
      ringMode = mode;
      ringHeading = actor.object.rotation.y;
      ringTime = 0;
      strike = 0;
      ringId++;
      muted = false;
      voiceSent = speaking = false;
      return true;
    },
    silence() {
      muted = true;
      voiceSent = true;
      speaking = false;
    },
    cancelNotice() {
      if (ringMode !== 'notice') return;
      sound({ type: 'lookout-cancel' });
      ringMode = null;
      speaking = false;
    },
    update(dt, state) {
      if (!(dt > 0)) return;
      clock += dt;
      noticing = state.noticing;
      noticeTime = state.time;
      if (ringMode) ringTime = Math.min(LOOKOUT_NOTICE_SECONDS, ringTime + dt);
      const active = !!ringMode;
      const calfHeading = state.target
        ? Math.atan2(state.target.x - site.x, state.target.z - site.z)
        : -Math.PI / 2;
      const scan = active ? 0 : 0.08 * Math.sin(clock * 0.35);
      const heading = active ? ringHeading : calfHeading + scan;
      const error = Math.atan2(
        Math.sin(heading - actor.object.rotation.y),
        Math.cos(heading - actor.object.rotation.y),
      );
      actor.object.rotation.y += THREE.MathUtils.clamp(error, -dt * 4.2, dt * 4.2);
      // Two deliberate downward pulls. Each sound is emitted by its matching
      // game-time strike, so pause/mute never schedules a future second sound.
      const pull = active
        ? LOOKOUT_STRIKES.reduce(
            (value, at) =>
              value +
              (Math.abs(ringTime - at) < 0.22
                ? (1 + Math.cos(((ringTime - at) * Math.PI) / 0.22)) / 2
                : 0),
            0,
          )
        : 0;
      const grip = active
        ? smooth((ringTime - 0.1) / 0.5) * (1 - smooth((ringTime - 2.3) / 0.35))
        : 0;
      const swing =
        active && ringTime + 1e-9 >= 1.13 && ringTime < 2.65
          ? Math.sin(((ringTime - 1.13) * Math.PI) / 0.6) *
            0.26 *
            (1 - smooth((ringTime - 2.3) / 0.35))
          : 0;
      bell.rotation.z = swing;
      tongue.rotation.z = -swing * 2.9;
      placeRope(pull);
      if (ringMode === 'notice' && !voiceSent && !muted && ringTime + 1e-9 >= 1.1) {
        voiceSent = true;
        const session = ringId;
        sound({ type: 'lookout-voice', x: site.x, z: site.z, ringId }, (type) => {
          if (session === ringId && ringMode === 'notice' && !muted) speaking = type === 'playing';
        });
      }
      if (active)
        actor.rig.ringBell(
          root.localToWorld(gripPoint.clone()),
          grip,
          dt,
          pull,
          speaking ? 0.65 + 0.35 * Math.sin(clock * 15) : 0,
        );
      telescope.position.set(site.x - 1.06, ground + site.deck, site.z);
      telescope.rotation.y = active ? ringHeading : calfHeading + scan;
      if (!active) {
        actor.rig.watch(dt, { headPitch: 0.045 });
        const scopeGrip = scope.localToWorld(new THREE.Vector3(0.13, -0.08, -0.65));
        actor.rig.reach(scopeGrip, Math.abs(error) < 0.2 ? 1 : 0, dt);
      }
      while (
        active &&
        strike < LOOKOUT_STRIKES.length &&
        ringTime + 1e-9 >= LOOKOUT_STRIKES[strike]
      ) {
        const event = {
          type: 'lookout-bell',
          single: true,
          ringId,
          strike: strike++,
          x: site.x + bell.position.x,
          z: site.z + bell.position.z,
        };
        if (!muted && sound(event) === false) muted = true;
      }
      if (active && ringTime + 1e-9 >= LOOKOUT_NOTICE_SECONDS) {
        if (ringMode === 'notice' && voiceSent) sound({ type: 'lookout-voice-stop' });
        ringMode = null;
        speaking = false;
      }
    },
    snapshot: () => ({
      site,
      position: actor.object.position.toArray(),
      noticing,
      noticeTime,
      clock,
      ringMode,
      speaking,
      ringTime,
      strikes: strike,
      bellPosition: bell.getWorldPosition(new THREE.Vector3()).toArray(),
      bellAngle: bell.rotation.z,
      grip: root.localToWorld(gripPoint.clone()).toArray(),
      handGap: actor.rig.handPoint().distanceTo(root.localToWorld(gripPoint.clone())),
    }),
  };
  return api;
}
