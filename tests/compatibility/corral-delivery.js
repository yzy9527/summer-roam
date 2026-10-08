import * as THREE from 'three';
import { CORRAL } from '../../src/corral-model.js';
import { clearAnimalSegment, findAnimalPath } from '../../src/corral-navigation.js';
const DRIVER = 'pvz-browncoat';
const gateZ = CORRAL.z - CORRAL.halfZ;
const driverHome = { x: CORRAL.x + 3.4, z: gateZ - 4 };
const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
// Compatibility delivery only. Current crew-cart deliveries use finishDelivery().
export function createLegacyCorralDelivery({
  scene,
  cart,
  zombies,
  ground,
  emit,
  guard: GUARD,
  getPhase,
  getPhaseTime,
  setPhase,
  setGate,
  gateController,
  receive,
  allowed,
  inside,
  zombieRoute,
  walkZombie,
  moveAnimal,
  updatePose,
  releaseControl,
}) {
  const ownedCollider = (c) => c.corralAnimal || c.zombie === DRIVER || c.zombie === GUARD;
  let chaserMode = 'idle',
    chaseTime = 0,
    chaseTarget = null;
  let driverRoute = [],
    driverLanding = null,
    driverStart = null,
    unloadGoal = null,
    leadStage = null;
  const driverBlend = [];
  const ramp = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.065, Math.hypot(3, 0.551)),
    new THREE.MeshStandardMaterial({ color: '#aa7b62', roughness: 0.96 }),
  );
  ramp.name = 'Cattle unloading ramp';
  ramp.position.set(0, 0.275, -3.3);
  ramp.rotation.x = -Math.atan2(0.551, 3);
  ramp.visible = false;
  ramp.receiveShadow = ramp.castShadow = true;
  cart.root.add(ramp);
  const sideRamp = new THREE.Mesh(
    new THREE.BoxGeometry(Math.hypot(3, 0.68), 0.065, 0.85),
    ramp.material,
  );
  sideRamp.name = 'Zombie dismount board';
  sideRamp.position.set(-1.5, 0.34, 1.5);
  sideRamp.rotation.z = Math.atan2(0.68, 3);
  sideRamp.visible = false;
  sideRamp.castShadow = sideRamp.receiveShadow = true;
  cart.root.add(sideRamp);
  const sideSupport = (x, z) => {
    const p = cart.root.worldToLocal(new THREE.Vector3(x, cart.root.position.y, z));
    return ground(x, z) + 0.68 * THREE.MathUtils.clamp((3 + p.x) / 3, 0, 1);
  };
  const rope = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({ color: '#b99c65', roughness: 1 }),
  );
  rope.name = 'Zombie hand to cattle nose lead';
  rope.visible = false;
  scene.add(rope);
  function walkDriverHome(dt) {
    const p = zombies.actor(DRIVER).object.position;
    if (!driverRoute.length && Math.hypot(p.x - driverHome.x, p.z - driverHome.z) > 0.15)
      driverRoute = zombieRoute(DRIVER, driverHome);
    walkZombie(DRIVER, driverRoute, dt, { speed: 0.65 });
    return Math.hypot(p.x - driverHome.x, p.z - driverHome.z) < 0.15;
  }
  function updateRope(a) {
    const actor = zombies.actor(DRIVER);
    if (!actor || !a) return;
    actor.object.updateMatrixWorld(true);
    a.group.updateMatrixWorld(true);
    const start = leadHand(actor);
    if (!start) return;
    const end = a.rig.contactPoint();
    const middle = start.clone().lerp(end, 0.5);
    middle.y -= Math.min(0.3, Math.max(0, 2.5 - start.distanceTo(end)) * 0.22);
    const curve = new THREE.QuadraticBezierCurve3(start, middle, end);
    const geometry = new THREE.TubeGeometry(curve, 20, 0.018, 5, false);
    rope.geometry.dispose();
    rope.geometry = geometry;
    rope.visible = true;
  }
  function leadHand(actor) {
    if (!actor) return null;
    actor.object.updateMatrixWorld(true);
    let hand;
    actor.source.traverse((n) => {
      if (!hand && n.isBone && /^RightHand(_0\d+)?$/.test(n.name)) hand = n;
    });
    return hand?.getWorldPosition(new THREE.Vector3());
  }

  function notifyEscape(a) {
    if (chaserMode === 'idle') {
      chaserMode = 'chasing';
      chaseTime = 0;
      chaseTarget = a;
      emit('zombie-no', a);
    }
  }
  function updateChase(dt, timerDt, car) {
    if (chaserMode === 'chasing') {
      chaseTime += timerDt;
      const target = { x: chaseTarget.x, z: chaseTarget.z };
      const actor = zombies.actor(DRIVER);
      const gap = Math.hypot(
        target.x - actor.object.position.x,
        target.z - actor.object.position.z,
      );
      zombies.walk(DRIVER, target, dt, { speed: gap > 2.4 ? 0.9 : 0, car });
      if (chaseTime >= 4.5) {
        chaserMode = 'returning';
        driverRoute = zombieRoute(DRIVER, driverHome);
      }
    } else if (chaserMode === 'returning') {
      if (walkDriverHome(dt)) {
        chaserMode = 'idle';
        chaseTarget = null;
      }
    }
  }
  function prepareLeadPose(a) {
    if (a.mode === 'leading') {
      a.behavior.down = 0;
      a.behavior.raised = 0.3;
      const actor = zombies.actor(DRIVER);
      const guide = leadHand(actor) ?? actor.object.position;
      a.familyLook = THREE.MathUtils.clamp(
        angleDifference(Math.atan2(guide.x - a.x, guide.z - a.z), a.heading),
        -0.3,
        0.3,
      );
    } else delete a.familyLook;
  }
  return {
    notifyEscape,
    updateChase,
    prepareLeadPose,
    chaseSnapshot: () => ({ mode: chaserMode, time: chaseTime }),
    ramp,
    rope,
    get driverRoute() {
      return driverRoute;
    },
    update(dt, car, gateAmount, a) {
      const handled = ['unloading', 'leading', 'leaving'].includes(getPhase());
      if (getPhase() === 'arriving' && getPhaseTime() > 3) {
        cart.deliveryMode();
        setPhase('parking');
      }
      if (getPhase() === 'parking' && cart.snapshot().speed < 0.02) {
        cart.setGateOpen(true);
        setGate(true, true);
        setPhase('opening');
      }
      if (getPhase() === 'opening' && cart.snapshot().gateAmount > 0.99 && gateAmount > 0.99) {
        ramp.visible = true;
        sideRamp.visible = true;
        const driver = zombies.actor(DRIVER),
          foot = [];
        driver.source.traverse((b) => {
          if (b.isBone) {
            driverBlend.push({ bone: b, from: b.quaternion.clone() });
            if (/^(Left|Right)Foot_0\d+$/.test(b.name))
              foot.push(b.getWorldPosition(new THREE.Vector3()));
          }
        });
        const p = foot
          .reduce((sum, p) => sum.add(p), new THREE.Vector3())
          .multiplyScalar(1 / foot.length);
        zombies.releaseDriver({ x: p.x, y: p.y, z: p.z });
        for (const entry of driverBlend) entry.to = entry.bone.quaternion.clone();
        zombies.take(DRIVER);
        zombies.take(GUARD);
        const landing = cart.root.localToWorld(new THREE.Vector3(-3.25, 0, 1.5));
        driverLanding = { x: landing.x, z: landing.z };
        setPhase('dismounting');
      }
      if (getPhase() === 'dismounting') {
        if (getPhaseTime() < 0.7) {
          const t = THREE.MathUtils.smoothstep(getPhaseTime(), 0, 0.7);
          for (const entry of driverBlend)
            entry.bone.quaternion.copy(entry.from).slerp(entry.to, t);
          zombies.actor(DRIVER).object.updateMatrixWorld(true);
        } else if (
          zombies.walk(DRIVER, driverLanding, dt, {
            speed: 0.55,
            car,
            ground: sideSupport,
            ignore: (c) => c.woodenCart,
          })
        ) {
          sideRamp.visible = false;
          const cargo = cart.unloadCargo(scene);
          if (!cargo) throw new Error('Parked cart did not release cargo');
          const cow = receive(cargo);
          cow.supportHeight = cart.cargoSupportHeight;
          const goal = cart.root.localToWorld(new THREE.Vector3(0, 0, -6.1));
          unloadGoal = { x: goal.x, z: goal.z };
          cow.route = [unloadGoal];
          driverStart = { x: goal.x + 2.4, z: goal.z };
          driverRoute = zombieRoute(DRIVER, driverStart);
          setPhase('unloading');
        }
      }
      if (getPhase() === 'unloading' && a) {
        walkZombie(DRIVER, driverRoute, dt, { speed: 0.65 });
        const done = moveAnimal(a, dt, 0.32, true, (c) => c.woodenCart);
        updatePose(a, dt);
        if (done && !driverRoute.length) {
          a.supportHeight = ground;
          a.mode = 'leading';
          // Lead across the clear apron first, so the cow is aligned with the
          // doorway before the zombie turns in. A trailing animal cuts corners.
          leadStage = 'approach';
          driverRoute = zombieRoute(DRIVER, { x: CORRAL.x + 2.05, z: unloadGoal.z });
          a.route = [];
          setPhase('leading');
        }
      } else if (getPhase() === 'leading' && a) {
        const guide = zombies.actor(DRIVER);
        const leadTarget = { x: guide.object.position.x, z: guide.object.position.z };
        if (
          leadStage === 'entering' &&
          leadTarget.z > gateZ + 1 &&
          Math.abs(leadTarget.x - CORRAL.x) < 0.2
        )
          leadTarget.x = CORRAL.x;
        const separation = Math.hypot(guide.object.position.x - a.x, guide.object.position.z - a.z);
        const facing =
          Math.abs(
            angleDifference(
              Math.atan2(guide.object.position.x - a.x, guide.object.position.z - a.z),
              a.heading,
            ),
          ) < 0.2;
        const leadDistance = Math.hypot(leadTarget.x - a.x, leadTarget.z - a.z);
        const reach = Math.max(0, leadDistance - 2.05) / Math.max(leadDistance, 1e-9);
        const followPoint = {
          x: a.x + (leadTarget.x - a.x) * reach,
          z: a.z + (leadTarget.z - a.z) * reach,
        };
        const leadClear = clearAnimalSegment(
          a,
          followPoint,
          (x, z) => allowed(a, x, z, ownedCollider),
          0.08,
        );
        if (leadStage === 'aligning' || (leadClear && separation < 2.8 && facing))
          walkZombie(DRIVER, driverRoute, dt, { speed: 0.6 });
        a.route = [leadTarget];
        moveAnimal(
          a,
          dt,
          leadStage !== 'aligning' && leadClear && separation > 2.05
            ? Math.min(0.55, (separation - 2.05) * 1.5)
            : 0,
          false,
          () => false,
        );
        updatePose(a, dt);
        updateRope(a);
        if (leadStage === 'approach' && !driverRoute.length && separation < 2.2) {
          leadStage = 'aligning';
          driverRoute = zombieRoute(DRIVER, { x: CORRAL.x, z: a.z + 2.1 });
        }
        if (leadStage === 'aligning' && !driverRoute.length) {
          leadStage = 'entering';
          const entry = findAnimalPath(
            guide.object.position,
            { x: CORRAL.x, z: CORRAL.z - 1 },
            (x, z) => allowed(a, x, z, ownedCollider, 0.08),
            { step: 0.5, padding: 6 },
          );
          driverRoute = entry ? [...entry, { x: CORRAL.x, z: CORRAL.z + 1.9 }] : [];
        }
        if (
          leadStage === 'entering' &&
          !driverRoute.length &&
          separation < 2.1 &&
          inside(a, a.x, a.z)
        ) {
          a.mode = 'confined';
          a.route = [];
          a.velocity = 0;
          a.chargeRun = 0;
          rope.visible = false;
          driverRoute = zombieRoute(DRIVER, driverHome);
          setPhase('leaving');
        }
      }
      if (getPhase() === 'leaving') {
        if (walkDriverHome(dt)) {
          setGate(false, true);
          cart.setGateOpen(false);
          ramp.visible = false;
          setPhase('closing');
        }
      }
      if (getPhase() === 'closing' && gateAmount === 0 && gateController.settled) {
        releaseControl();
        setPhase('ready');
      }
      return handled || ['unloading', 'leading', 'leaving'].includes(getPhase());
    },
  };
}
