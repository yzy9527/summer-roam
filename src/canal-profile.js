// Full road irrigation channel, with dry transitions before both turning pads. Units: metres.
export const CANAL = {
  openStart: 10,
  openEnd: 190,
  start: 8,
  end: 192,
  transitionStart: 4,
  transitionEnd: 196,
  waterWidth: 1.2,
  offset: -4.6,
  cut: { x0: -1200 / 110, x1: -300 / 110, z0: 1, z1: 28 },
};
// Visible open water ends at the two covered inlets; terrain blending extends farther.
export function isOpenCanalStation(s) {
  return s >= CANAL.openStart - 1e-6 && s <= CANAL.openEnd + 1e-6;
}
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export function canalBlend(s) {
  return smooth(4, 8, s) * (1 - smooth(192, 196, s));
}
export function canalOffset(s) {
  return -6.8 + 2.2 * canalBlend(s) - 0.175 + 0.025 * localCanalBlend(s);
}
// Full stone-cut section at s14–28; reconnect to the original channel by s10 / s33.
export function localCanalBlend(s) {
  return smooth(10, 14, s) * (1 - smooth(28, 33, s));
}
export function canalWidth(s) {
  return 1.2 + 0.4 * localCanalBlend(s);
}
export function canalCollisionMargin(s) {
  return 0.12 + 0.78 * localCanalBlend(s);
}
export function canalShore(s) {
  return canalWidth(s) / 2;
}
function originalBankHeight(distance, s) {
  const t = canalBlend(s),
    edge = canalWidth(s) / 2,
    a = Math.abs(distance);
  if (a <= edge * 0.59) return -0.68 * t;
  if (a <= edge) return (-0.68 + (0.2 * (a - edge * 0.59)) / (edge * 0.41)) * t;
  if (a <= edge + 0.525) {
    const q = (a - edge) / 0.525,
      round = q * q * (3 - 2 * q),
      soft = 0.028 * Math.sin(q * Math.PI) ** 2 * Math.sin(s * 0.95 + Math.sign(distance) * 1.7);
    return (-0.48 + 0.48 * round + soft) * t;
  }
  return 0;
}
export function bankHeight(distance, s) {
  const local = localCanalBlend(s),
    edge = canalShore(s),
    a = Math.abs(distance);
  // The bed and the sloped wall are part of the continuous physical terrain.
  const bed = -0.68 + 0.05 * (a / Math.max(edge, 0.01)) ** 2;
  const wall = a <= edge ? bed : bed + (0 - bed) * smooth(edge, edge + 0.28, a);
  return originalBankHeight(distance, s) * (1 - local) + Math.min(0, wall) * local;
}
export function waterLevel(s) {
  return -0.48 * canalBlend(s);
}
export function insideCanalCut(x, z) {
  const c = CANAL.cut;
  return x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1;
}

// Common upper-course elevation for the continuous bank and its terminal piers.
export function canalBankTop(s) {
  return bankHeight(canalWidth(s) / 2 + 0.195, s) + 0.08;
}
