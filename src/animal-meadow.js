// Dry meadow outside the starting road's irrigation bank and utility poles.
// Shared by wandering, click retreats and the mother/calf route planner.
export const ANIMAL_MEADOW = { minX: -37, maxX: -17, minZ: -3, maxZ: 23 };
// Bull-only patrol: the southern end guards the calf's return; the northern
// end approaches the leopard tree and leaves the return corridor unguarded.
export const BULL_PATROL = { minX: -36, maxX: -27, minZ: 2, maxZ: 26 };
export function inBullPatrol(x, z) {
  return (
    x >= BULL_PATROL.minX && x <= BULL_PATROL.maxX && z >= BULL_PATROL.minZ && z <= BULL_PATROL.maxZ
  );
}
export function inAnimalMeadow(x, z) {
  return (
    x >= ANIMAL_MEADOW.minX &&
    x <= ANIMAL_MEADOW.maxX &&
    z >= ANIMAL_MEADOW.minZ &&
    z <= ANIMAL_MEADOW.maxZ
  );
}
