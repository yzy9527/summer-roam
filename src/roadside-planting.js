import { nearestRoad, roadPoint } from './world-base.js';
import { canalCoordinates } from './world-queries.js';
import { canalWidth, canalOffset } from './canal-profile.js';
import { bridgeWindow } from './irrigation-style.js';
import { insidePaddy } from './paddy-profile.js';
import { onStartingPlatform } from './road-network.js';
// Plant roots and their full horizontal reach stay on the dry shoulder strip.
export function roadsidePlantAllowed(x, z, reach = 0.16) {
  if (onStartingPlatform(x, z, reach + 0.32)) return false;
  const d = nearestRoad(x, z).distance;
  if (d < 2.86 + reach || d > 4.24 - reach || insidePaddy(x, z, roadPoint, 1.05 + reach))
    return false;
  if (Math.hypot(x, z) < 7.5 + reach || Math.hypot(x + 26, z - 200) < 7.5 + reach) return false;
  const c = canalCoordinates(x, z);
  return (
    !(Math.abs(c.d) < canalWidth(c.s) / 2 + 0.28 + reach && c.s > 4 && c.s < 196) &&
    !bridgeWindow(c.s, c.d + canalOffset(c.s), reach + 0.25)
  );
}
