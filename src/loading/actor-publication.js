import { vehicleObstacleGap } from '../vehicle-collision.js';

// Publish visuals and their footprints atomically. A car parked at an actor's
// spawn delays that group until it leaves, rather than materializing inside it.
export async function publishActors({
  scene,
  colliders,
  objects,
  footprints,
  getPlayer,
  wait = () => new Promise((resolve) => setTimeout(resolve, 100)),
}) {
  while (getPlayer) {
    const player = getPlayer();
    if (
      !player ||
      footprints.every(
        (c) => vehicleObstacleGap(player.x, player.z, player.heading ?? 0, c) >= 0.25,
      )
    )
      break;
    await wait();
  }
  scene.add(...objects);
  colliders.push(...footprints);
}
