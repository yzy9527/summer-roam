import { STARTING_PLATFORM } from './road-network.js';

// Driver's left is +X at spawn. Separate small patrols stay on the dry outer lawn.
export const ZOMBIE_LAYOUT = Object.freeze(
  [
    {
      id: 'pvz-browncoat',
      label: '普通僵尸',
      x: STARTING_PLATFORM.x + 20,
      z: 3.5,
      scale: 0.96,
      speed: 0.24,
      phase: 0.5,
      radius: 0.7,
    },
    {
      id: 'pvz-conehead',
      label: '路锥僵尸',
      x: STARTING_PLATFORM.x + 21.5,
      z: 10,
      scale: 0.96,
      speed: 0.22,
      phase: 0.8,
      radius: 0.7,
    },
    {
      id: 'pvz-gargantuar',
      label: '巨型僵尸',
      x: STARTING_PLATFORM.x + 23,
      z: 17,
      scale: 0.7,
      speed: 0.2,
      phase: 1.1,
      radius: 1.85,
    },
    {
      id: 'pvz-flagbearer',
      label: '旗帜僵尸',
      // Keep the whole patrol at least 0.4m clear of the cooking fire.
      x: STARTING_PLATFORM.x + 19.5,
      z: 24,
      scale: 0.96,
      speed: 0.22,
      phase: 0.5,
      radius: 1.65,
    },
  ].map((p) => Object.freeze({ ...p, patrolX: 1.25, patrolZ: 1.9 })),
);

export function zombiePatrolPoint(layout, phase) {
  return {
    x: layout.x + layout.patrolX * Math.cos(phase),
    z: layout.z + layout.patrolZ * Math.sin(phase),
  };
}
