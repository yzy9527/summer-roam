import { CREW_CART } from '../../zombie-crew-cart.js';
const DRIVER = 'pvz-conehead';
export function updateDriverParking(
  parking,
  dt,
  { cart, zombies, driver, player, clearCartPath, transitionPose, walk, walkStates },
) {
  if (!parking || parking.stage === 'complete') return;
  parking.retry = Math.max(0, parking.retry - dt);
  if (parking.stage === 'closing-tailgate') {
    if (cart.snapshot().gateAmount < 0.005) parking.stage = 'returning';
  } else if (parking.stage === 'returning') {
    if (cart.snapshot().blocked || !parking.goal) clearCartPath();
    cart.boards.visible = false;
    if (parking.goal && cart.snapshot().blocked && parking.retry === 0) {
      parking.route.unshift(parking.goal);
      parking.goal = null;
      cart.stop();
      parking.retry = 2;
    }
    if (!parking.goal && parking.route.length && parking.retry === 0) {
      if (cart.routeTo(parking.route[0], player, { reverse: !!parking.route[0].reverse }))
        parking.goal = parking.route.shift();
      parking.retry = 1;
    }
    if (parking.goal && cart.arrived()) parking.goal = null;
    if (!parking.goal && !parking.route.length && cart.arrived()) {
      cart.boards.visible = true;
      const at = cart.world(-0.8, 0.551, CREW_CART.driverEntryZ);
      transitionPose(driver, () => cart.releaseDriver({ x: at.x, y: at.y, z: at.z }));
      parking.stage = 'dismounting';
    }
  } else if (
    !driver.transitioning &&
    walk(driver, cart.world(-3.15, 0, CREW_CART.driverEntryZ), dt, { boarding: true })
  ) {
    cart.boards.visible = false;
    zombies.release(DRIVER);
    walkStates.delete(driver);
    parking.stage = 'complete';
  }
}
