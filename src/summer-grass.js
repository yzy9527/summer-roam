import { createSummerGrassPatch } from './anime-grass-patch.js';
import { canalCoordinates } from './world-queries.js';
import { roadFrame, nearestRoad } from './world-base.js';
import { fieldGroundHeight } from './field-landscape.js';
import { canalOffset, canalWidth } from './canal-profile.js';
import { bridgeWindow } from './irrigation-style.js';
import { roadsidePlantAllowed } from './roadside-planting.js';
import { fieldRoadPaths } from './road-network.js';
// Grass coverage follows dry land; crops, roads, irrigation and buildings stay clear.
export function grassAllowed(x, z, buildings) {
  if (x < -65 || x > 140 || z < -8 || z > 208) return false;
  const clearance = nearestRoad(x, z).distance;
  if (clearance < 3.04 || clearance > 4.04) return false;
  const c = canalCoordinates(x, z);
  const roadD = c.d + canalOffset(c.s);
  if (
    (Math.abs(roadD) < 3.3 && nearestRoad(x, z).distance < 3.04) ||
    Math.hypot(x, z) < 7.82 ||
    Math.hypot(x + 26, z - 200) < 7.82 ||
    bridgeWindow(c.s, roadD, 0.4)
  )
    return false;
  if (Math.abs(c.d) < canalWidth(c.s) / 2 + 0.28 && c.s > 4 && c.s < 196) return false;
  if (!roadsidePlantAllowed(x, z, 0.16)) return false;
  if (buildings.some((p) => Math.hypot(x - p.x, z - p.z) < p.radius + 0.25)) return false;
  return true;
}
export function addSummerGrass(scene, cull, colliders) {
  const buildings = colliders.filter((c) => c.radius > 3),
    patches = [];
  // Build narrow shoulder strips once. Driving only changes visibility and wind time.
  function create(frame, length, seed) {
    for (const side of [-1, 1]) {
      const patch = createSummerGrassPatch(
        (along, across) => {
          const f = frame(along),
            d = side * (3.54 + across),
            x = f.x + f.nx * d,
            z = f.z + f.nz * d;
          if (!grassAllowed(x, z, buildings)) return null;
          return { x, y: fieldGroundHeight(x, z) - 0.006, z, heightScale: 0.45, maxHeight: 0.22 };
        },
        {
          length,
          width: 1,
          seed: seed + (side + 1),
          clumps: Math.ceil(length * 12),
          leaves: 10,
          segments: 3,
          heightScale: 0.45,
          maxHeight: 0.22,
          widthScale: 1.3,
        },
      );
      if (!patch.count) {
        patch.mesh.geometry.dispose();
        patch.mesh.material.dispose();
        continue;
      }
      patch.mesh.name = 'Summer road shoulder grass';
      scene.add(patch.mesh);
      const centre = frame(0);
      patches.push({ ...patch, x: centre.x, z: centre.z });
    }
  }
  for (let start = 0; start < 200; start += 8)
    create((along) => roadFrame(start + 4 + along), 8, start * 31 + 1);
  let seed = 7001;
  for (const path of fieldRoadPaths)
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i],
        dx = b.x - a.x,
        dz = b.z - a.z,
        length = Math.hypot(dx, dz),
        pieces = Math.ceil(length / 8),
        part = length / pieces;
      for (let j = 0; j < pieces; j++) {
        const centre = (j + 0.5) * part;
        create(
          (along) => ({
            x: a.x + (dx * (centre + along)) / length,
            z: a.z + (dz * (centre + along)) / length,
            nx: dz / length,
            nz: -dx / length,
          }),
          part,
          seed++ * 31,
        );
      }
    }
  for (const id of ['field-landscape-audit', 'paddy-banks-audit']) {
    const el = typeof document === 'undefined' ? null : document.getElementById(id);
    if (el) {
      const audit = JSON.parse(el.textContent);
      audit.grass = {
        source: 'summer-grass.js',
        heightMax: 0.22,
        streamed: false,
        roadShouldersOnly: true,
        shoulderWidth: 1,
      };
      el.textContent = JSON.stringify(audit);
    }
  }
  return {
    update(seconds, position) {
      for (const patch of patches) {
        patch.mesh.visible = Math.hypot(position.x - patch.x, position.z - patch.z) < 45;
        patch.update(seconds);
      }
    },
    snapshot() {
      return {
        tiles: patches.length,
        blades: patches.reduce((n, p) => n + p.count, 0),
        maxHeight: 0.22,
        retired: 0,
        roadShouldersOnly: true,
        shoulderWidth: 1,
        streamed: false,
      };
    },
  };
}
