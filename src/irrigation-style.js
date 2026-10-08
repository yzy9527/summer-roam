import { addCanalCulvert } from './canal-culvert.js';
import * as THREE from 'three';
import { roadFrame, terrainHeight } from './world-base.js';
import { landscapeHeight } from './world-queries.js';
import {
  canalOffset,
  canalWidth,
  waterLevel,
  localCanalBlend,
  canalBankTop,
} from './canal-profile.js';
import { createSummerGrassPatch } from './anime-grass-patch.js';
import { sampleWeight, SAMPLE } from './sample-layout.js';
export const BRIDGE_STATIONS = Object.freeze([21, 34, 114, 174]);
export function bridgeWindow(s, d, padding = 0.12) {
  return (
    Math.abs(d - canalOffset(s)) < canalWidth(s) / 2 + 0.85 &&
    BRIDGE_STATIONS.some((b) => Math.abs(s - b) < 0.8 + padding)
  );
}
const random =
  (seed = 10221) =>
  () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
const material = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.96, ...extra });
function point(s, d) {
  const f = roadFrame(s);
  return { s, d, x: f.x + f.nx * d, z: f.z + f.nz * d, heading: f.heading };
}
function add(scene, g, m, s, d, y, scale, name) {
  const p = point(s, d),
    o = new THREE.Mesh(g, m);
  o.name = name;
  o.position.set(p.x, y, p.z);
  o.rotation.y = p.heading;
  o.scale.set(...scale);
  o.castShadow = true;
  o.receiveShadow = true;
  scene.add(o);
  return o;
}
function batch(scene, g, m, points, name, wet = false) {
  if (!points.length) return null;
  if (wet)
    g.setAttribute(
      'stoneWater',
      new THREE.InstancedBufferAttribute(new Float32Array(points.map((p) => p.water)), 1),
    );
  const o = new THREE.InstancedMesh(g, m, points.length),
    dummy = new THREE.Object3D();
  o.name = name;
  points.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
    dummy.scale.set(p.sx || 1, p.sy || 1, p.sz || 1);
    dummy.updateMatrix();
    o.setMatrixAt(i, dummy.matrix);
    if (p.color) o.setColorAt(i, new THREE.Color(p.color));
  });
  o.castShadow = true;
  o.receiveShadow = true;
  o.computeBoundingSphere();
  scene.add(o);
  return o;
}
// Rounded river stones retain broad faces without polygon corners.
export function bankStoneGeometry(seed) {
  const g = new THREE.SphereGeometry(1, 24, 16),
    p = g.attributes.position;
  const signed = (v) => Math.sign(v) * Math.pow(Math.abs(v), 0.46 + 0.07 * Math.sin(seed));
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const swell =
      1 + 0.065 * Math.sin(x * 3 + z * 2 + seed) + 0.045 * Math.sin(y * 4 - z * 3 + seed * 0.7);
    p.setXYZ(
      i,
      signed(x) * 0.5 * swell,
      signed(y) * 0.5 * swell + 0.035 * x * z,
      signed(z) * 0.5 * swell,
    );
  }
  g.computeVertexNormals();
  return g;
}
// Build rounded edges in physical dimensions so thin rails keep soft corners.
function wornBridgeGeometry(width, height, depth, radius) {
  const g = new THREE.BoxGeometry(width, height, depth, 16, 12, 12),
    p = g.attributes.position,
    normals = g.attributes.normal;
  const r = Math.min(radius, width * 0.45, height * 0.45, depth * 0.45),
    core = new THREE.Vector3(width / 2 - r, height / 2 - r, depth / 2 - r);
  const v = new THREE.Vector3(),
    q = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    q.copy(v).clamp(core.clone().negate(), core);
    n.copy(v).sub(q).normalize();
    v.copy(q).addScaledVector(n, r);
    // Leave the broad planes flat; wear is confined to the small bevel.
    const edge = Math.abs(n.x) + Math.abs(n.y) + Math.abs(n.z) > 1.01;
    const wear = edge ? 0.0006 * Math.sin(v.x * 5.3 + v.z * 3.7) : 0;
    p.setXYZ(i, v.x + n.x * wear, v.y + n.y * wear, v.z + n.z * wear);
    normals.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}
function oldBridgeSurface(color, { foot = null, deckTop = false } = {}) {
  const m = material(color, { roughness: 1, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOldStone;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOldStone=position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOldStone;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
   float wash=.5+.5*sin(vOldStone.x*2.2+vOldStone.z*3.1+sin(vOldStone.y*2.));
   diffuseColor.rgb*=.96+.065*wash;
   ${
     foot === null
       ? ''
       : `float damp=1.-smoothstep(${foot.toFixed(3)},${(foot + 0.07).toFixed(3)},vOldStone.y);
   float mossPatch=smoothstep(.70,.97,.5+.5*sin(vOldStone.x*8.+vOldStone.z*6.));
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.18,.22,.14),damp*mossPatch*.12);`
   }
   ${
     deckTop
       ? `float slab=floor((vOldStone.z+.76)/.38);
   diffuseColor.rgb*=1.+.018*sin(slab*2.7);
   float seam=min(abs(vOldStone.z+.38),min(abs(vOldStone.z),abs(vOldStone.z-.38)));
   diffuseColor.rgb*=mix(.73,1.,smoothstep(.0015,.0035,seam));`
       : ''
   }
  `,
      );
  };
  m.customProgramCacheKey = () => 'bridge-neutral-stone-v2-' + foot + '-' + deckTop;
  return m;
}
export function stoneSurface(color, wet = false) {
  const m = material(color, { flatShading: false, roughness: 0.98 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vStoneWorld;' +
          (wet ? '\nattribute float stoneWater;varying float vStoneWater;' : ''),
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvec4 stonePosition=vec4(transformed,1.);\n#ifdef USE_INSTANCING\nstonePosition=instanceMatrix*stonePosition;\n#endif\nvStoneWorld=(modelMatrix*stonePosition).xyz;' +
          (wet ? '\nvStoneWater=stoneWater;' : ''),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vStoneWorld;' +
          (wet ? '\nvarying float vStoneWater;' : ''),
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  float plane=.5+.5*sin(vStoneWorld.x*7.1+vStoneWorld.y*9.2+vStoneWorld.z*4.3);
  float grain=.5+.5*sin(vStoneWorld.x*83.+vStoneWorld.z*97.)*sin(vStoneWorld.y*71.+vStoneWorld.z*63.);
  diffuseColor.rgb*=.94+.09*plane+.012*grain;
  float moss=smoothstep(.64,.90,.5+.5*sin(vStoneWorld.x*11.+vStoneWorld.z*7.)*sin(vStoneWorld.y*16.+vStoneWorld.z*3.));
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.25,.34,.13),moss*.22);
  ${wet ? 'diffuseColor.rgb*=mix(.61,1.,smoothstep(.05,.20,vStoneWorld.y-vStoneWater));' : ''}`,
      );
  };
  m.customProgramCacheKey = () => 'rounded-stone-warm-moss-v2-' + wet;
  return m;
}
export function masonryPlacements(rnd = random()) {
  // Staggered, individually embedded masonry courses on both sides of the lowered water.
  const rockSets = Array.from({ length: 5 }, () => []);
  for (const side of [-1, 1])
    for (let course = 0; course < 2; course++) {
      for (let pos = 9.6 + course * 0.31; pos < 32.8; ) {
        const length = 0.34 + rnd() * 0.26,
          cut = localCanalBlend(pos),
          weight = sampleWeight(pos),
          depth = 0.31 + rnd() * 0.12;
        if (rnd() < weight && Math.abs(pos - 21) > 0.76) {
          const edge = canalWidth(pos) / 2,
            dd = canalOffset(pos) + side * (edge + 0.14 + course * 0.055),
            q = point(pos, dd),
            ground = terrainHeight(q.x, q.z);
          const height = (0.27 + rnd() * 0.13) * (1 + 0.08 * cut),
            top = ground + (course ? 0.035 + (rnd() - 0.5) * 0.09 : -0.27) * cut;
          rockSets[Math.floor(rnd() * 5)].push({
            ...q,
            y: top - height * 0.4,
            ry: q.heading + (rnd() - 0.5) * 0.3,
            rx: (rnd() - 0.5) * 0.08,
            rz: -side * 0.13 + (rnd() - 0.5) * 0.12,
            sx: depth,
            sy: height,
            sz: length,
            color: ['#b4a58a', '#a2aa8b', '#c2b59b', '#a8a086', '#8e9e7b'][Math.floor(rnd() * 5)],
          });
        }
        pos += length * 0.91;
      }
    }
  return rockSets;
}
export function masonryColliders(sets = masonryPlacements()) {
  const p = point(SAMPLE.bridgeS, canalOffset(SAMPLE.bridgeS));
  return sets
    .flat()
    .map((q) => ({ x: q.x, z: q.z, radius: Math.hypot(q.sx / 2, q.sz / 2) + 0.035, height: 0.44 }))
    .concat({ x: p.x, z: p.z, radius: 1.43, height: 1.22 });
}

export function corridorMasonryPlacements() {
  const local = masonryPlacements().flatMap((set, variant) =>
      set.map((p) => ({
        ...p,
        variant,
        local: true,
        water: terrainHeight(p.x, p.z) + waterLevel(p.s ?? 21),
      })),
    ),
    rnd = random(78191),
    points = [];
  for (const side of [-1, 1])
    for (let course = 0; course < 2; course++)
      for (let s = 8 + course * 0.31; s < 192; ) {
        const length = 0.34 + rnd() * 0.26,
          depth = 0.31 + rnd() * 0.12,
          weight = 1 - sampleWeight(s),
          edge = canalWidth(s) / 2,
          d = canalOffset(s) + side * (edge + 0.14 + course * 0.055),
          q = point(s, d);
        const accepted =
          rnd() < weight * (course ? 0.84 : 1) &&
          !BRIDGE_STATIONS.some((b) => Math.abs(s - b) < 0.8);
        const height = 0.21 + rnd() * 0.09,
          water = terrainHeight(q.x, q.z) + waterLevel(s);
        if (accepted) {
          const top = course
            ? terrainHeight(q.x, q.z) + canalBankTop(s) - height * 0.1 + (rnd() - 0.5) * 0.075
            : water + 0.055;
          points.push({
            ...q,
            y: top - height * 0.4,
            ry: q.heading + (rnd() - 0.5) * 0.3,
            rx: (rnd() - 0.5) * 0.08,
            rz: -side * 0.13 + (rnd() - 0.5) * 0.12,
            sx: depth,
            sy: height,
            sz: length,
            water,
            color: ['#b4a58a', '#a2aa8b', '#c2b59b', '#a8a086', '#8e9e7b'][Math.floor(rnd() * 5)],
          });
        }
        s += length * 0.91;
      }
  return local.concat(points).filter((p) => p.s >= 10 && p.s < 190);
}
export function bridgeLayout(s) {
  const waterWidth = canalWidth(s),
    span = waterWidth + 1.15,
    off = canalOffset(s),
    p = point(s, off),
    h = terrainHeight(p.x, p.z),
    decks = [];
  for (let slab = 0; slab < 4; slab++) {
    const q = point(s - 0.57 + slab * 0.38, off);
    decks.push({
      ...q,
      y: h + 0.085,
      ry: q.heading,
      sx: span,
      sy: 0.26,
      sz: 0.395,
      color: ['#989287', '#9b958b', '#958f84', '#9d978d'][slab],
    });
  }
  return {
    s,
    waterWidth,
    span,
    off,
    h,
    p,
    decks,
    foot: waterWidth / 2 + 0.24,
    railEnd: span / 2 - 0.195,
    landing: span / 2 - 0.045,
  };
}
export function corridorColliders(points = corridorMasonryPlacements()) {
  return points
    .map((q) => ({
      x: q.x,
      z: q.z,
      radius: Math.hypot(q.sx / 2, q.sz / 2) + 0.035,
      height: q.sy,
      kind: 'masonry',
      s: q.s,
    }))
    .concat(
      BRIDGE_STATIONS.map((s) => {
        const b = bridgeLayout(s);
        return {
          x: b.p.x,
          z: b.p.z,
          radius: Math.hypot(b.span / 2, 0.76) + 0.002,
          height: 0.78,
          kind: 'bridge',
          s,
        };
      }),
    );
}
export function addUnifiedIrrigation(scene, colliders, cull) {
  const pillarMat = oldBridgeSurface('#aaa69d', { foot: -0.28 }),
    railMat = oldBridgeSurface('#a5a198'),
    baseMat = oldBridgeSurface('#697076', { foot: -0.28 }),
    landingMat = oldBridgeSurface('#918b80');
  const pillarTop = oldBridgeSurface('#b9b4a9');
  const pillarFaces = [pillarMat, pillarMat, pillarTop, pillarMat, pillarMat, pillarMat];
  const deckSide = oldBridgeSurface('#7e7d78'),
    deckTop = oldBridgeSurface('#a39b8e', { deckTop: true }),
    deckBottom = oldBridgeSurface('#596169');
  const shapes = new Map();
  const rounded = (size, r) => {
    const key = size.join(',') + ':' + r;
    if (!shapes.has(key)) shapes.set(key, wornBridgeGeometry(...size, r));
    return shapes.get(key);
  };
  const piece = (size, r, mat, s, d, y, name) =>
    add(scene, rounded(size, r), mat, s, d, y, [1, 1, 1], name);
  for (const s of BRIDGE_STATIONS) {
    const { off, h, span, foot, railEnd, landing } = bridgeLayout(s);
    // One uninterrupted structural beam with four subtle slab divisions on its top.
    // Use a single local frame so the side silhouette cannot step with road curvature.
    piece(
      [span, 0.26, 1.52],
      0.022,
      [deckSide, deckSide, deckTop, deckBottom, deckSide, deckSide],
      s,
      off,
      h + 0.085,
      'Unified deep grey stone bridge ' + s,
    );
    for (const side of [-1, 1]) {
      piece(
        [0.43, 0.62, 1.55],
        0.038,
        baseMat,
        s,
        off + side * foot,
        h - 0.22,
        'Embedded stone bridge foundation ' + s,
      );
      const ramp = wornBridgeGeometry(0.4, 0.13, 1.48, 0.014),
        positions = ramp.attributes.position;
      for (let i = 0; i < positions.count; i++)
        positions.setY(i, positions.getY(i) - side * positions.getX(i) * 0.45);
      ramp.computeVertexNormals();
      add(
        scene,
        ramp,
        landingMat,
        s,
        off + side * (landing + 0.12),
        h + 0.06,
        [1, 1, 1],
        'Stone path landing ' + s,
      );
      // Above-deck height is 25% lower; slender rails meet below the column caps.
      for (const end of [-1, 0, 1])
        piece(
          [0.125, 0.56, 0.125],
          0.014,
          pillarFaces,
          s + side * 0.67,
          off + end * railEnd,
          h + 0.495,
          'Weathered stone railing post ' + s,
        );
      for (const y of [0.455, 0.725])
        piece(
          [span - 0.29, 0.06, 0.068],
          0.009,
          railMat,
          s + side * 0.67,
          off,
          h + y,
          'Weathered stone horizontal rail ' + s,
        );
      piece(
        [span - 0.55, 0.095, 0.12],
        0.012,
        deckBottom,
        s + side * 0.5,
        off,
        h - 0.036,
        'Dark bridge underside ' + s,
      );
    }
  }
  const points = corridorMasonryPlacements();
  // Small warm pebbles sit partly underwater and on the exposed earth between banks.
  for (let section = 0; section < 10; section++) {
    const pebbles = [],
      rnd = random(541 + section);
    for (let j = 0; j < 24; j++) {
      const s = section * 20 + 1 + rnd() * 18;
      if (s < 11 || s > 189) continue;
      const side = j % 2 ? 1 : -1,
        d = canalOffset(s) + side * (canalWidth(s) / 2 - 0.065 + rnd() * 0.22);
      if (bridgeWindow(s, d, 0.3)) continue;
      const q = point(s, d),
        water = terrainHeight(q.x, q.z) + waterLevel(s),
        ground = landscapeHeight(q.x, q.z),
        scale = 0.065 + rnd() * 0.1;
      pebbles.push({
        ...q,
        y: Math.max(ground + 0.025, water - 0.065),
        sx: scale,
        sy: scale * 0.5,
        sz: scale * 1.25,
        ry: rnd() * 6.28,
        color: ['#c5b798', '#afa785', '#929d76'][j % 3],
      });
    }
    const o = batch(
      scene,
      bankStoneGeometry(41),
      stoneSurface('#ffffff'),
      pebbles,
      'Natural canal shore pebbles ' + section,
    );
    if (o) {
      const f = roadFrame(section * 20 + 10);
      cull.push({ o, x: f.x, z: f.z, distance: 65 });
    }
  }

  for (let section = 0; section < 10; section++)
    for (let variant = 0; variant < 5; variant++) {
      const list = points.filter(
          (p, i) => Math.floor(p.s / 20) === section && (p.variant ?? i % 5) === variant,
        ),
        o = batch(
          scene,
          bankStoneGeometry(921 + variant),
          stoneSurface('#ffffff', true),
          list,
          'Unified two-course canal masonry ' + section + ' ' + variant,
          true,
        );
      if (o) {
        o.castShadow = list.some((p) => p.local);
        const f = roadFrame(section * 20 + 10);
        cull.push({ o, x: f.x, z: f.z, distance: 82 });
      }
    }
  // Short rooted tufts emerge from the seams between the upper and lower courses.
  let seamGrass = 0;
  for (let section = 0; section < 10; section++)
    for (const side of [-1, 1]) {
      const start = Math.max(8, section * 20),
        end = Math.min(192, section * 20 + 20);
      if (end <= start) continue;
      const patch = createSummerGrassPatch(
        (ds, dd) => {
          const s = (start + end) / 2 + ds,
            d = canalOffset(s) + side * (canalWidth(s) / 2 + 0.09) + dd;
          if (bridgeWindow(s, d, 0.18)) return null;
          const nearby = points.filter(
            (p) => Math.abs(p.s - s) < 0.55 && Math.sign(p.d - canalOffset(p.s)) === side,
          );
          if (!nearby.length) return null;
          const upperCourse = nearby.filter(
            (p) => p.y > Math.max(...nearby.map((p) => p.y)) - 0.08,
          );
          const upper = upperCourse.reduce((a, b) =>
            Math.abs(a.s - s) < Math.abs(b.s - s) ? a : b,
          );
          // Roots occupy the recessed vertical joints on the water-facing wall.
          // Reject the central face of every neighbouring upper stone.
          if (upperCourse.some((p) => Math.abs(p.s - s) < p.sz * 0.43)) return null;
          const face = point(s, upper.d - side * upper.sx * 0.49 + dd);
          return { x: face.x, z: face.z, y: upper.y + upper.sy * 0.08 };
        },
        {
          length: end - start,
          width: 0.025,
          seed: 631 + section * 13 + (side + 1),
          clumps: Math.ceil((end - start) * 32),
          leaves: 20,
          segments: 4,
          heightScale: 0.32,
          maxHeight: 0.13,
          widthScale: 0.62,
          density: (ds) => 0.65 + 0.3 * Math.sin(ds * 2.3 + section),
        },
      );
      patch.mesh.name = 'Dense short canal stone seam grass ' + section + ' ' + side;
      scene.add(patch.mesh);
      seamGrass += patch.count;
      const f = roadFrame((start + end) / 2);
      cull.push({ o: patch.mesh, x: f.x, z: f.z, distance: 65 });
    }
  colliders.push(...corridorColliders(points));
  const culvert = addCanalCulvert(scene, colliders, cull, bankStoneGeometry, stoneSurface);
  const report = {
    range: [8, 192],
    bridges: BRIDGE_STATIONS.map((s) => {
      const b = bridgeLayout(s);
      return { s, waterWidth: b.waterWidth, span: b.span, slabs: 4, thickness: 0.26 };
    }),
    stones: points.length,
    seamGrass,
    roundedBanks: true,
    bothBanks: true,
    sharedStyle: true,
    originalWaterProfile: true,
    culvert,
    collisionBodies: colliders.length,
    cullDistance: 82,
  };
  if (typeof document !== 'undefined') {
    const el = document.createElement('script');
    el.id = 'irrigation-style-audit';
    el.type = 'application/json';
    el.textContent = JSON.stringify(report);
    document.body.append(el);
  }
  return report;
}
