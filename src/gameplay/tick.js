/**
 * @typedef {Object} GameFrame
 * @property {number} dt Simulation seconds; zero while paused.
 * @property {number} clockDt Elapsed active seconds, independent of simulation cap.
 * @property {number} seconds Visual time in seconds.
 * @property {{x:number,z:number,heading?:number}} player Actual vehicle state.
 * @property {{x:number,z:number}} focus Observation/culling focus.
 * @property {{x:number,z:number}} cameraPosition Camera location.
 * @property {'day'|'night'} timeOfDay
 */

// Preserve the normal frame order. All transport handoffs use this same order.
export function createGameplayTick({
  animals,
  goldfish,
  zombies,
  paddy,
  cart,
  corral,
  heist,
  rescue,
  campsite,
}) {
  /** @param {GameFrame} frame */
  return ({
    dt,
    player,
    focus = player,
    cameraPosition = focus,
    timeOfDay = 'day',
    clockDt = dt,
  }) => {
    animals?.update(dt, player, timeOfDay, clockDt, focus);
    goldfish?.update(dt);
    zombies?.update(dt, player);
    paddy?.update(dt, player, cameraPosition);
    cart?.update(dt, player);
    corral?.update(dt, player, clockDt, timeOfDay);
    heist?.update(dt, player);
    rescue?.update(dt, player);
    campsite?.update(dt);
  };
}
