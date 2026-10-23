import test from 'node:test';
import assert from 'node:assert/strict';
import { createZombieController } from '../src/field-zombies.js';
import { loadModel } from './helpers/model-loader.mjs';
import { rescueFixture } from './helpers/rescue-fixture.mjs';
import { createZombieTaunt } from '../src/gameplay/zombies/taunt.js';
import { landscapeHeight } from '../src/world-queries.js';
const SMALL = 'pvz-browncoat',
  GIANT = 'pvz-gargantuar';
async function fixture() {
  const sources = new Map(
    await Promise.all(
      [SMALL, GIANT].map(async (id) => [id, await loadModel('models/pvz-zombies/' + id + '.glb')]),
    ),
  );
  const colliders = [];
  const z = createZombieController(sources, colliders, () => 0, {
    comedy: true,
    random: () => 0.5,
  });
  z.actor(GIANT).collider.radius = 1.05;
  return { z, colliders, small: z.actor(SMALL), giant: z.actor(GIANT) };
}
test('real skins run over, taunt, receive exactly one actual head contact, recoil and retreat at 30/60/120fps', async () => {
  for (const fps of [30, 60, 120]) {
    const { z, small, giant } = await fixture();
    assert.equal(z.tauntAvailability(), '');
    assert(z.startTaunt(null));
    const phases = new Set();
    const rest = new Map();
    z.root.traverse((n) => {
      if (n.isBone && !n.name.startsWith('Hips')) rest.set(n, n.position.clone());
    });
    let previousContacts = 0,
      contactGap = Infinity,
      paused = false;
    for (let i = 0; i < fps * 46 && z.tauntState().active; i++) {
      const before = small.object.position.clone();
      z.update(1 / fps, null);
      const state = z.tauntState();
      phases.add(state.phase);
      assert(small.object.position.distanceTo(before) < 2 / fps + 1e-6, 'no teleport');
      assert(small.object.position.distanceTo(giant.object.position) > 1.86, 'full body clearance');
      for (const [bone, position] of rest)
        assert(bone.position.distanceTo(position) < 1e-8, bone.name + ' length');
      if (state.contacts > previousContacts)
        contactGap = giant.rig.patPalmPoint().distanceTo(small.rig.headTopPoint());
      previousContacts = state.contacts;
      if (!paused && state.phase === 'taunting') {
        paused = true;
        const before = JSON.stringify([z.snapshot(), z.tauntState()]);
        z.update(0, null);
        assert.equal(JSON.stringify([z.snapshot(), z.tauntState()]), before);
      }
    }
    assert.equal(z.tauntState().outcome, 'complete', JSON.stringify(z.tauntState()));
    assert.equal(z.tauntState().contacts, 1);
    assert(contactGap < 0.08, 'palm really touches the crown');
    for (const phase of ['approach', 'taunting', 'stare', 'windup', 'recoil', 'retract', 'retreat'])
      assert(phases.has(phase), phase);
    assert(paused);
    assert(!small.scripted && !giant.scripted);
    assert(!small.socialOwner && !giant.socialOwner);
    assert(z.tauntAvailability(), 'cooldown prevents immediate repeat');
  }
});
test('busy roles reject taunts; cancellation releases both, and blocked approaches cannot produce a fake hit', async () => {
  const { z, small, giant, colliders } = await fixture();
  z.setSocialAvailability(() => false);
  assert(!z.startTaunt(null), 'transport notice and bull-defense reservations block a new taunt');
  z.setSocialAvailability(() => true);
  z.take(GIANT);
  assert(!z.startTaunt(null));
  z.release(GIANT);
  assert(z.startTaunt(null));
  assert(!z.startTaunt(null));
  assert.equal(small.socialOwner, 'taunt');
  assert.equal(giant.socialOwner, 'taunt');
  assert(z.cancelTaunt());
  assert.equal(z.tauntState().outcome, 'cancelled');
  assert(!small.scripted && !giant.scripted);
  for (let i = 0; i < 190; i++) z.update(1 / 60, null);
  colliders.push({ x: giant.object.position.x, z: giant.object.position.z, radius: 3 });
  const origin = small.object.position.clone();
  assert(z.startTaunt(null));
  for (let i = 0; i < 100 && z.tauntState().active; i++) z.update(1 / 60, null);
  assert.equal(z.tauntState().outcome, 'no-space');
  assert.equal(z.tauntState().contacts, 0);
  assert(small.object.position.distanceTo(origin) < 1e-8);
  assert(!small.socialOwner && !giant.socialOwner);
});
test('the existing capture and recapture controllers reject a giant leased by taunting', async () => {
  const f = await rescueFixture(() => 0.9, { withHeist: true });
  const giant = f.zombies.actor(GIANT);
  giant.socialOwner = 'taunt';
  assert(f.heist.manualAvailability());
  assert(f.rescue.manualAvailability(f.animal('hornless-calf')));
  assert(!f.heist.startManual());
  assert(!f.rescue.startManual(f.animal('hornless-calf')));
  delete giant.socialOwner;
});
test('the real idle rescue patrol can hand its scripted giant to taunting and pauses its route under the lease', async () => {
  const f = await rescueFixture(() => 0.9, { withHeist: true });
  const giant = f.zombies.actor(GIANT);
  for (let i = 0; i < 20; i++) f.rescue.update(1 / 60, f.car);
  assert(f.rescue.snapshot().patrolGoal);
  assert(giant.scripted, 'idle rescue patrol uses the scripted walker');
  const taunt = createZombieTaunt(
    { ...f.zombies, comedyAvailability: () => '' },
    landscapeHeight,
    () => f.rescue.snapshot().phase === 'idle',
    () => !!f.rescue.snapshot().patrolGoal,
  );
  assert.equal(taunt.availability(), '');
  assert(taunt.start(f.car));
  const position = giant.object.position.clone();
  f.rescue.update(1 / 60, f.car);
  assert(giant.object.position.distanceTo(position) < 1e-8);
  assert.equal(f.rescue.snapshot().patrolGoal, null);
  assert(taunt.cancel());
  assert(!giant.scripted && !giant.socialOwner);
});
