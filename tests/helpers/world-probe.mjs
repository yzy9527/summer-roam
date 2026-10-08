import { createHash } from 'node:crypto';

// Fixed samples and controls. The oracle is captured from phase-one commit 8dd5706.
export function probeWorld(world, culvert) {
  const points = [];
  for (let x = -175; x <= 175; x += 14) for (let z = -35; z <= 245; z += 10) points.push([x, z]);
  for (const station of [
    0, 4, 8, 9.999999, 10, 10.000001, 12, 14, 18, 21, 28, 33, 62, 105, 118, 120, 185, 189.999999,
    190, 190.000001, 192, 196, 200,
  ]) {
    const f = world.roadFrame(station);
    for (const d of [-8, -6.8, -5.6, -5.3, -4.975, -4.6, -4.3, -3.975, -3.6, -2.25, 0, 2.25, 5.5])
      points.push([f.x + f.nx * d, f.z + f.nz * d]);
  }
  const layouts = [];
  for (const station of culvert.CULVERT_STATIONS) {
    const p = culvert.culvertLayout(station);
    layouts.push(p);
    for (const across of [-1.1, -0.98, -0.8, -0.67, -0.6, 0, 0.6, 0.67, 0.8, 0.98, 1.1])
      for (const along of [
        -0.080001, -0.08, 0, 0.12, 0.22, 0.3, 0.300001, 0.35, 0.62, 1, 6.1, 6.100001,
      ])
        points.push([
          p.x + across * Math.cos(p.heading) + along * Math.sin(p.heading),
          p.z - across * Math.sin(p.heading) + along * Math.cos(p.heading),
        ]);
  }
  const space = points.map(([x, z]) => [
    x,
    z,
    world.terrainHeight(x, z),
    world.landscapeHeight(x, z),
    world.drivingHeight(x, z),
    world.canalCoordinates(x, z),
    world.nearestRoad(x, z),
    world.inStream(x, z),
    world.isRoadSurface(x, z),
    culvert.culvertGroundHeight(x, z, world.terrainHeight(x, z)),
  ]);
  const traces = [],
    finals = [];
  // Hold the phase-one physics fixture fixed while the gameplay spawn moves.
  const physicsFixture = () => ({
    ...world.spawnState(),
    x: 132,
    z: 10,
    heading: 0,
    surface: '公路',
  });
  const scenarios = [
    { name: 'road-accel-coast-brake', state: physicsFixture(), steps: 720 },
    { name: 'grass-reverse-steer', state: { ...physicsFixture(), x: 20, z: 35 }, steps: 480 },
    {
      name: 'obstacle',
      state: { ...physicsFixture(), x: 0, z: 0 },
      colliders: [{ x: 0, z: 5, radius: 1 }],
      steps: 480,
    },
    {
      name: 'existing-overlap-outward',
      state: { ...physicsFixture(), x: -28, z: 8, heading: -Math.PI / 2 },
      colliders: [{ x: -30, z: 8, radius: 1.1 }],
      steps: 240,
    },
    {
      name: 'water-crossing',
      state: { ...physicsFixture(), x: -2, z: 18, heading: -Math.PI / 2 },
      steps: 360,
    },
    { name: 'world-edge', state: { ...physicsFixture(), x: 100, z: 240 }, steps: 360 },
  ];
  for (const [n, c] of scenarios.entries()) {
    const calls = [];
    for (let i = 0; i < c.steps; i++) {
      const dt = i % 83 === 0 ? 0 : i % 2 ? 1 / 60 : 1 / 120;
      const input =
        n === 0
          ? { forward: i < 360, brake: i >= 600 }
          : n === 1
            ? { backward: true, left: i < 240, right: i >= 240 }
            : n === 3
              ? { backward: true }
              : { forward: true };
      const hit = world.stepDrive(c.state, input, dt, c.colliders ?? [], (x) =>
        calls.push((c.colliders ?? []).indexOf(x)),
      );
      traces.push([n, i, hit, { ...c.state }]);
    }
    finals.push({ name: c.name, state: { ...c.state }, calls });
  }
  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    spaceSamples: space.length,
    spaceHash: hash(space),
    layouts,
    driveSteps: traces.length,
    driveHash: hash(traces),
    finals,
    exports: Object.keys(world).sort(),
  };
}
