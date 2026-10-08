import * as THREE from 'three';
import { createModelLoader } from './loading/model-loader.js';
import { assetUrl } from './asset-url.js';
import { landscapeHeight, inStream } from './world-queries.js';
import { nearestRoad, isRoadSurface } from './world-base.js';

// Facing the carved mountain (+X front), screen-right is +Z. Keep clear of its trail.
export const LEOPARD_TREE_SITE = Object.freeze({ x: -34, z: 28, height: 9.5 });
export const TREE_VISIT = Object.freeze({
  intervalMin: 60,
  intervalMax: 90,
  chance: 0.3,
  restMin: 120,
  restMax: 240,
});
export const TREE_APPROACH = Object.freeze({ minX: -37, maxX: -17, minZ: 12, maxZ: 32 });

export function createLeopardTreeSite(root, scene, colliders) {
  const site = LEOPARD_TREE_SITE;
  const group = new THREE.Group();
  group.name = 'Leopard play tree';
  const box = new THREE.Box3().setFromObject(root, true);
  const scale = site.height / box.getSize(new THREE.Vector3()).y;
  root.scale.multiplyScalar(scale);
  root.position.y -= box.min.y * scale;
  root.updateMatrixWorld(true);
  let bark;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      material.roughness = 1;
      material.metalness = 0;
      if (material.name.includes('tronc')) bark = material;
      else if (material.transparent) {
        // Cutout foliage avoids sorted translucent cards hiding the animal.
        material.transparent = false;
        material.alphaTest = 0.5;
        material.depthWrite = true;
        material.side = THREE.DoubleSide;
      }
    }
  });
  if (!bark) throw new Error('Jabami tree trunk material unavailable');
  group.add(root);
  const base = landscapeHeight(site.x, site.z);
  group.position.set(site.x, base, site.z);
  scene.add(group);
  group.updateMatrixWorld(true);
  const wood = [];
  root.traverse((o) => {
    if (o.isMesh && o.material.name.includes('tronc')) wood.push(o);
  });
  // Guide points lie INSIDE the supplied trunk and its existing front fork.
  // This curve has no rendered geometry; contacts are projected onto native bark.
  const curve = new THREE.CatmullRomCurve3(
    [
      [0.015, 0, 0],
      [0.007, 1.65, 0],
      [0.016, 2.56, 0],
      [0.142, 3.321, 0.168],
      [0.592, 3.726, 0.696],
      [0.77, 3.777, 0.905],
      [0.938, 3.716, 1.059],
      [1.04, 3.822, 1.218],
      [1.153, 4.176, 1.352],
    ].map((p) => new THREE.Vector3(...p)),
    false,
    'centripetal',
  );
  const length = curve.getLength();
  let surfaceGuideReady = false;
  function frame(s) {
    const t = THREE.MathUtils.clamp(s / length, 0, 1);
    const center = group.localToWorld(curve.getPointAt(t));
    const forward = curve.getTangentAt(t).normalize();
    if (surfaceGuideReady) {
      const nativePoint = (value) => {
        const u = THREE.MathUtils.clamp(value / length, 0, 1) * count;
        const i = Math.min(count - 1, Math.floor(u));
        return contacts[i][1].point.clone().lerp(contacts[i + 1][1].point, u - i);
      };
      forward.copy(
        nativePoint(s + 0.55)
          .sub(nativePoint(s - 0.55))
          .normalize(),
      );
    }
    const bend = THREE.MathUtils.smoothstep(center.y - base, 2.8, 3.7);
    const outward = new THREE.Vector3(0.75 * (1 - bend), bend, -0.65 * (1 - bend)).normalize();
    const side = new THREE.Vector3().crossVectors(outward, forward).normalize();
    const normal = new THREE.Vector3().crossVectors(forward, side).normalize();
    return { center, forward, side, normal };
  }
  const triangles = [];
  for (const mesh of wood) {
    const geometry = mesh.geometry,
      index = geometry.index,
      pos = geometry.attributes.position;
    for (let i = 0; i < index.count; i += 3) {
      const points = [0, 1, 2].map((k) =>
        mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(pos, index.getX(i + k))),
      );
      const triangle = new THREE.Triangle(...points);
      triangle.bounds = new THREE.Box3().setFromPoints(points);
      triangle.normal = triangle.getNormal(new THREE.Vector3());
      triangle.order = triangles.length;
      triangles.push(triangle);
    }
  }
  const surfaceCells = new Map(),
    cellSize = 0.4;
  for (const triangle of triangles) {
    const bounds = triangle.bounds;
    for (let x = Math.floor(bounds.min.x / cellSize); x <= Math.floor(bounds.max.x / cellSize); x++)
      for (
        let y = Math.floor(bounds.min.y / cellSize);
        y <= Math.floor(bounds.max.y / cellSize);
        y++
      )
        for (
          let z = Math.floor(bounds.min.z / cellSize);
          z <= Math.floor(bounds.max.z / cellSize);
          z++
        ) {
          const key = x + ',' + y + ',' + z;
          if (!surfaceCells.has(key)) surfaceCells.set(key, new Set());
          surfaceCells.get(key).add(triangle);
        }
  }
  function candidatesNear(probe) {
    const cell = probe.toArray().map((v) => Math.floor(v / cellSize));
    const nearby = new Set();
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++)
          for (const triangle of surfaceCells.get(
            [cell[0] + x, cell[1] + y, cell[2] + z].join(','),
          ) ?? [])
            nearby.add(triangle);
    // Preserve the original tie-breaking order for coincident triangles.
    return [...nearby].sort((a, b) => a.order - b.order);
  }
  function barkContact(s, lateral = 0) {
    const f = frame(s);
    const width = THREE.MathUtils.lerp(
      0.13,
      0.04,
      THREE.MathUtils.smoothstep(f.center.y - base, 2.5, 3.3),
    );
    const p = f.center
      .clone()
      .addScaledVector(f.side, THREE.MathUtils.clamp(lateral, -width, width));
    const probe = p.clone().addScaledVector(f.normal, 0.18);
    let point,
      triangle,
      normal,
      distance = Infinity;
    const search = (candidates) => {
      for (const candidateTriangle of candidates) {
        if (candidateTriangle.normal.dot(f.normal) < 0.15) continue;
        if (candidateTriangle.bounds.distanceToPoint(probe) ** 2 >= distance) continue;
        const candidate = candidateTriangle.closestPointToPoint(probe, new THREE.Vector3());
        if (candidate.clone().sub(p).dot(f.normal) < -0.01) continue;
        const d = candidate.distanceToSquared(probe);
        if (d < distance) {
          distance = d;
          point = candidate;
          triangle = candidateTriangle;
          normal = triangle.normal.clone();
        }
      }
    };
    search(candidatesNear(probe));
    // Anything outside the 27 cells is at least one full cell away. If the
    // local answer is farther, retain the exhaustive search's exact result.
    if (distance >= cellSize * cellSize) search(triangles);
    if (!triangle) throw new Error('No outward bark contact at ' + s);
    return { point, normal, triangle, forward: f.forward, side: f.side, s };
  }
  // Cache native triangle contacts; runtime interpolation avoids recasting the
  // entire tree for four paws at every animation frame.
  const count = 480;
  const contacts = Array.from({ length: count + 1 }, (_, i) =>
    [-0.18, 0, 0.18].map((lateral) => barkContact((length * i) / count, lateral)),
  );
  surfaceGuideReady = true;
  function sample(s, lateral = 0) {
    s = THREE.MathUtils.clamp(s, 0.04, length - 0.04);
    const index = (s / length) * count,
      i = Math.floor(index),
      t = index - i;
    const l = THREE.MathUtils.clamp(lateral / 0.18, -1, 1);
    const k = l < 0 ? 0 : 1,
      v = l < 0 ? l + 1 : l;
    const interpolate = (field) =>
      contacts[i][k][field]
        .clone()
        .lerp(contacts[i][k + 1][field], v)
        .lerp(contacts[i + 1][k][field].clone().lerp(contacts[i + 1][k + 1][field], v), t);
    const interpolated = interpolate('point');
    let point,
      triangle,
      distance = Infinity;
    for (const contact of [
      contacts[i][k],
      contacts[i][k + 1],
      contacts[i + 1][k],
      contacts[i + 1][k + 1],
    ]) {
      const p = contact.triangle.closestPointToPoint(interpolated, new THREE.Vector3());
      const d = p.distanceToSquared(interpolated);
      if (d < distance) {
        distance = d;
        point = p;
        triangle = contact.triangle;
      }
    }
    const f = frame(s);
    return { point, normal: triangle.normal.clone(), forward: f.forward, side: f.side, s };
  }
  // Include the sides of the native fork too: paws wrap around a narrow limb,
  // rather than reaching only the top triangles used by the body guide.
  function contactNear(probe, hip, reach) {
    const nearby = new Set();
    for (const origin of hip ? [probe, hip] : [probe]) {
      const cell = origin.toArray().map((v) => Math.floor(v / cellSize));
      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -1; z <= 1; z++)
            for (const triangle of surfaceCells.get(
              [cell[0] + x, cell[1] + y, cell[2] + z].join(','),
            ) ?? [])
              nearby.add(triangle);
    }
    let point,
      triangle,
      distance = Infinity;
    for (const candidateTriangle of nearby.size ? nearby : triangles) {
      if (candidateTriangle.bounds.distanceToPoint(probe) ** 2 >= distance) continue;
      let candidate = candidateTriangle.closestPointToPoint(probe, new THREE.Vector3());
      if (hip && candidate.distanceTo(hip) > reach) {
        const nearHip = candidateTriangle.closestPointToPoint(hip, new THREE.Vector3());
        if (nearHip.distanceTo(hip) > reach) continue;
        let lo = 0,
          hi = 1;
        for (let i = 0; i < 12; i++) {
          const t = (lo + hi) / 2;
          if (nearHip.clone().lerp(candidate, t).distanceTo(hip) <= reach) lo = t;
          else hi = t;
        }
        candidate = nearHip.lerp(candidate, lo);
      }
      const d = candidate.distanceToSquared(probe);
      if (d < distance) {
        distance = d;
        point = candidate;
        triangle = candidateTriangle;
      }
    }
    if (!triangle) return contactNear(probe);
    return { point, normal: triangle.getNormal(new THREE.Vector3()) };
  }
  const branchStart = 3.7;
  function project(x, z) {
    let closest = branchStart,
      distance = Infinity;
    for (let i = Math.ceil((branchStart / length) * count); i <= count; i++) {
      const p = contacts[i][1].point;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < distance) {
        distance = d;
        closest = (length * i) / count;
      }
    }
    const f = frame(closest);
    return sample(closest, new THREE.Vector3(x - f.center.x, 0, z - f.center.z).dot(f.side));
  }
  colliders.push({
    x: site.x,
    z: site.z,
    radius: 0.48,
    height: site.height,
    treeTrunk: true,
    leopardTree: true,
  });
  return {
    group,
    wood,
    length,
    sample,
    frame,
    project,
    contactNear,
    entry: { x: site.x + 0.8, z: site.z - 0.7 },
    entryHeading: Math.atan2(-0.75, 0.65),
    restS: length - 0.72,
    height: (x, z) => project(x, z).point.y,
    normal: (x, z) => project(x, z).normal,
    snapshot: () => ({
      position: group.position.toArray(),
      height: site.height,
      length,
      restS: length - 0.72,
      originalGeometryOnly: true,
    }),
  };
}

export async function addLeopardTree(scene, colliders, warnings) {
  try {
    const root = (await createModelLoader().loadAsync(assetUrl('jabami-anime-tree-v2'))).scene;
    return createLeopardTreeSite(root, scene, colliders);
  } catch (error) {
    warnings.push('jabami-anime-tree-v2');
    console.warn('Leopard play tree unavailable:', error);
    return null;
  }
}

export function leopardTreeGroundAllowed(x, z, a, obstacles, animals, car, entry = false) {
  const b = TREE_APPROACH;
  if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
  if (isRoadSurface(x, z) || nearestRoad(x, z).distance < 3.8 || inStream(x, z)) return false;
  if (car && Math.hypot(x - car.x, z - car.z) < a.radius + 1.7) return false;
  if (
    obstacles.some(
      (o) => !(entry && o.leopardTree) && Math.hypot(x - o.x, z - o.z) < a.radius + o.radius + 0.35,
    )
  )
    return false;
  return !animals.some((o) => o !== a && Math.hypot(x - o.x, z - o.z) < a.radius + o.radius + 0.4);
}
