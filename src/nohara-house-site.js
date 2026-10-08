// Shared site dimensions keep rendered grass, vehicle support and house placement aligned.
export const NOHARA_HOUSE_SITE = {
  x: -48,
  z: 200,
  width: 10.821434020996092,
  depth: 16.4412841796875,
  grassMargin: 0.6,
  transition: 3,
};
export const NOHARA_HOUSE_POLE = { x: -35, z: 186 };
export function houseSiteHeight(x, z, height, level) {
  const site = NOHARA_HOUSE_SITE;
  const outside = Math.max(
    Math.abs(x - site.x) - site.width / 2 - site.grassMargin,
    Math.abs(z - site.z) - site.depth / 2 - site.grassMargin,
    0,
  );
  if (outside >= site.transition) return height;
  const t = outside / site.transition,
    blend = t * t * (3 - 2 * t);
  return level + (height - level) * blend;
}
