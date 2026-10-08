// Local replacement mask. Both legacy vegetation producers share this boundary.
// Vehicle configuration is independent; the local channel profile is defined in canal-profile.js.
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const SAMPLE = { start: 10, end: 30, treeS: 14.5, treeD: -7.35, bridgeS: 21 };
export function sampleWeight(s) {
  return smooth(8, 10, s) * (1 - smooth(30, 33, s));
}
export function keepLegacy(s, d, seed = 0) {
  if (d >= -2.7 || d < -12.5) return true;
  const h = Math.sin(seed * 127.1 + s * 13.7 + d * 31.9) * 43758.5453;
  return h - Math.floor(h) >= sampleWeight(s);
}
export function keepLegacyPoint(p) {
  return p.s === undefined || keepLegacy(p.s, p.d, p.x * 7 + p.z * 11);
}
