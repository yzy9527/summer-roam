import { createLeopardMilkVisit } from './gameplay/milk/visit.js';
import { createGameplayTick } from './gameplay/tick.js';
import { addLeopardTree } from './leopard-tree-site.js';
import { assetUrl } from './asset-url.js';
import { NOHARA_HOUSE_POLE } from './nohara-house-site.js';
import { fieldRoadPaths, onStartingPlatform } from './road-network.js';
import { createStartingPlatform } from './starting-platform.js';
import { addNoharaHouse } from './nohara-house.js';
import { addNoharaFamily } from './nohara-family.js';
import { addUnifiedIrrigation } from './irrigation-style.js';
import * as THREE from 'three';
import { createModelLoader, yieldSceneWork } from './loading/model-loader.js';
import { addFieldMountain } from './field-mountain.js';
import { addFieldAnimals } from './field-animals.js';
import { loadFieldTreeAssets } from './field-trees.js';
import { roadPoint, roadFrame, terrainHeight, ROAD_LENGTH, ROAD_WIDTH } from './world-base.js';
import { drivingHeight } from './world-queries.js';

import { addFieldLandscape } from './field-landscape.js';
import { leafSpray, leafMaterial } from './vegetation.js';
import { addPaddyBanks } from './paddy-banks.js';
import { addSummerGrass } from './summer-grass.js';
import { addSummerDressing } from './summer-dressing.js';
import {
  loadForestTreeAssets,
  addForestTrees,
  FOREST_ASSET_ID,
  FOREST_LOD_DISTANCES,
} from './forest-trees.js';
import { addEnvironmentSample } from './environment-sample.js';
import { keepLegacyPoint } from './sample-layout.js';
import { paddyLayout, paddyDistance } from './paddy-profile.js';
import { paddySurfaceGeometry } from './paddy-geometry.js';
import { roadsidePlantAllowed } from './roadside-planting.js';
import { captureWaterSky, applyWaterReflection } from './water-reflections.js';
import { createNightSky } from './day-night.js';
import { waterBedMaterial, addPaddyBed, addCanalBed, addRiceRootContacts } from './water-bed.js';
import { addCanalGoldfish } from './canal-goldfish.js';
import { addFieldZombies } from './field-zombies.js';
import { createZombieCorral } from './zombie-corral.js';
import { createZombieCalfRescue } from './zombie-calf-rescue.js';
import { addZombieCrewCart } from './zombie-crew-cart.js';
import { createZombieCalfHeist } from './zombie-calf-heist.js';
import { createZombieLookout } from './zombie-lookout.js';
import { addCampsiteCookingSet } from './campsite-cooking-set.js';
import { isPloughField } from './paddy-plough-site.js';
import { addPaddyTask } from './paddy-task.js';

const random =
  (seed = 718) =>
  () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
const rnd = random(),
  time = { value: 0 };
const C = {
  grass: '#7d9f49',
  soil: '#a99871',
  road: '#cdc7c0',
  paint: '#f7edce',
  bark: '#736d51',
};
const standard = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.91, ...extra });
function noiseTexture(kind) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d'),
    r = random(93);
  ctx.fillStyle = kind === 'road' ? '#989b96' : '#a6ad80';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 14000; i++) {
    const v = kind === 'road' ? 125 + r() * 60 : 130 + r() * 45;
    ctx.fillStyle = `rgba(${v},${v},${v - 5},${0.12 + r() * 0.22})`;
    const w = 0.4 + r() * 2;
    ctx.fillRect(r() * 512, r() * 512, w, w);
  }
  if (kind === 'road') {
    ctx.strokeStyle = 'rgba(80,83,79,.22)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 9; i++) {
      let x = r() * 512,
        y = r() * 512;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 0; j < 8; j++) {
        x += r() * 12 - 6;
        y += r() * 18;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function ribbon(
  scene,
  offset,
  width,
  material,
  start = 0,
  end = 200,
  lift = 0.025,
  height = drivingHeight,
) {
  const v = [],
    uv = [],
    idx = [],
    n = Math.ceil((end - start) * 2);
  for (let i = 0; i <= n; i++) {
    const f = roadFrame(start + ((end - start) * i) / n);
    for (const side of [-1, 1]) {
      const d = offset + width * 0.5 * side,
        x = f.x + f.nx * d,
        z = f.z + f.nz * d;
      v.push(x, height(x, z) + lift, z);
      uv.push(x * 0.23, z * 0.23);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
function addFieldRoads(scene, asphalt, soil, paint) {
  function strip(path, offset, width, material, lift, mark = false) {
    const v = [],
      uv = [],
      idx = [];
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1],
        b = path[k],
        length = Math.hypot(b.x - a.x, b.z - a.z),
        nx = (b.z - a.z) / length,
        nz = -(b.x - a.x) / length,
        n = Math.ceil(length * 2);
      for (let i = 0; i < n; i++) {
        const mid = {
          x: a.x + ((b.x - a.x) * (i + 0.5)) / n,
          z: a.z + ((b.z - a.z) * (i + 0.5)) / n,
        };
        if (mark && Math.abs(mid.x - roadPoint(mid.z).x) < 7) continue;
        if (mark && onStartingPlatform(mid.x + nx * offset, mid.z + nz * offset, 0.15)) continue;
        const base = v.length / 3;
        for (const t of [i / n, (i + 1) / n])
          for (const side of [-1, 1]) {
            const d = offset + (side * width) / 2,
              x = a.x + (b.x - a.x) * t + nx * d,
              z = a.z + (b.z - a.z) * t + nz * d;
            v.push(x, drivingHeight(x, z) + lift, z);
            uv.push(x * 0.23, z * 0.23);
          }
        idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const o = new THREE.Mesh(g, material);
    o.receiveShadow = true;
    o.name = 'Field loop road';
    scene.add(o);
  }
  for (const path of fieldRoadPaths) {
    strip(path, 0, 5.45, soil, 0.025);
    strip(path, 0, ROAD_WIDTH, asphalt, 0.035);
    for (const side of [-1, 1]) strip(path, side * 2.13, 0.095, paint, 0.042, true);
  }
}
function add(scene, g, m, x, y, z, scale = null) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  if (scale) o.scale.set(...scale);
  o.castShadow = true;
  o.receiveShadow = true;
  scene.add(o);
  return o;
}
function instances(scene, g, m, points, shadow = false) {
  const o = new THREE.InstancedMesh(g, m, points.length),
    d = new THREE.Object3D();
  points.forEach((p, i) => {
    d.position.set(p.x, p.y, p.z);
    d.rotation.set(p.rx || 0, p.ry || 0, p.rz || 0);
    d.scale.set(p.sx || 1, p.sy || 1, p.sz || 1);
    d.updateMatrix();
    o.setMatrixAt(i, d.matrix);
    if (p.color) o.setColorAt(i, new THREE.Color(p.color));
  });
  o.castShadow = shadow;
  o.receiveShadow = true;
  o.computeBoundingSphere();
  scene.add(o);
  return o;
}
function blades(rice = false) {
  const v = [],
    uv = [];
  for (let i = 0; i < (rice ? 5 : 7); i++) {
    const angle = i * 2.399,
      height = (rice ? 0.55 : 0.42) * (1 + (i % 3) * 0.16),
      dx = Math.cos(angle),
      dz = Math.sin(angle),
      w = rice ? 0.018 : 0.032;
    let previous = null;
    for (let j = 0; j <= 3; j++) {
      const t = j / 3,
        lean = t * t * (rice ? 0.14 : 0.24),
        half = w * (1 - t * 0.93),
        pair = [
          [dx * lean - dz * half, height * t, dz * lean + dx * half],
          [dx * lean + dz * half, height * t, dz * lean - dx * half],
        ];
      if (previous) {
        v.push(...previous[0], ...previous[1], ...pair[0], ...pair[0], ...previous[1], ...pair[1]);
        uv.push(0, (j - 1) / 3, 1, (j - 1) / 3, 0, t, 0, t, 1, (j - 1) / 3, 1, t);
      }
      previous = pair;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}
function windMaterial(color) {
  const m = standard(color, { side: THREE.DoubleSide });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.vertexShader = 'uniform float uTime;\n' + s.vertexShader;
    s.vertexShader = s.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
 vec3 windPos=position;
 #ifdef USE_INSTANCING
 windPos=(instanceMatrix*vec4(position,1.)).xyz;
 #endif
 transformed.x+=sin(uTime*1.15+windPos.x*.43+windPos.z*.24)*position.y*position.y*.09;`,
    );
  };
  return m;
}
function waterMaterial() {
  const m = new THREE.MeshPhongMaterial({
    color: '#3b87a5',
    specular: '#c6e5f7',
    shininess: 150,
    transparent: true,
    opacity: 0.97,
    depthWrite: false,
  });
  m.name = 'Paddy shallow water with sky reflection';
  return m;
}
async function sky(scene, night) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uNight: night },
    vertexShader:
      'varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:
      'uniform float uNight;varying vec3 vDirection;void main(){float h=normalize(vDirection).y;vec3 day=mix(vec3(.38,.68,.94),vec3(.035,.25,.67),smoothstep(-.05,.5,h));vec3 night=mix(vec3(.008,.018,.055),vec3(.0015,.003,.014),smoothstep(-.05,.65,h));gl_FragColor=vec4(mix(day,night,uNight),1.);\n#include <colorspace_fragment>}',
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2200, 48, 24), m);
  dome.userData.waterSky = true;
  scene.add(dome);
  let atlas;
  try {
    atlas = await new THREE.TextureLoader().loadAsync(assetUrl('clouds'));
    atlas.colorSpace = THREE.SRGBColorSpace;
  } catch (error) {
    console.warn('Cloud atlas unavailable; using distinct procedural silhouettes.', error);
  }
  const clouds = [
    [-0.4, 1750, 460, 930, 660, 0],
    [0.18, 1780, 420, 510, 500, 3],
    [0.55, 1900, 470, 900, 660, 1],
    [1.65, 1830, 620, 470, 260, 3],
    [2.5, 1760, 580, 570, 290, 0],
    [3.44, 1900, 670, 430, 320, 1],
    [4.46, 1810, 600, 630, 200, 2],
    [5.28, 1880, 610, 500, 270, 3],
  ];
  for (const [angle, radius, y, width, height, variant] of clouds) {
    let map;
    if (atlas) {
      map = atlas.clone();
      map.repeat.set(0.5, 0.5);
      map.offset.set((variant % 2) * 0.5, variant < 2 ? 0.5 : 0);
      map.needsUpdate = true;
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 320;
      const c = canvas.getContext('2d'),
        r = random(variant * 73 + 91);
      for (let i = 0; i < 26; i++) {
        const x = 65 + r() * 380,
          y = 180 - r() * 100,
          size = 25 + r() * 38,
          g = c.createRadialGradient(x - size * 0.3, y - size * 0.4, 2, x, y, size);
        g.addColorStop(0, '#fffdf1');
        g.addColorStop(0.8, '#e8edf2');
        g.addColorStop(1, '#e8edf200');
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, size, 0, Math.PI * 2);
        c.fill();
      }
      map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
    }
    const material = new THREE.SpriteMaterial({
      map,
      color: '#fffdf4',
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const cloud = new THREE.Sprite(material);
    cloud.position.set(Math.sin(angle) * radius, y, 90 + Math.cos(angle) * radius);
    cloud.scale.set(width, height, 1);
    cloud.name = 'Distant_cloud_variant_' + variant;
    cloud.userData.waterSky = true;
    cloud.userData.dayCloud = true;
    scene.add(cloud);
  }
}
function geometricMountains(scene) {
  for (let layer = 0; layer < 4; layer++) {
    const v = [],
      colors = [],
      idx = [],
      nx = 130,
      nz = 18,
      near = 500 + layer * 260,
      width = 1800 + layer * 400,
      c = new THREE.Color(['#547f67', '#628d85', '#739fab', '#91b5c9'][layer]);
    for (let j = 0; j <= nz; j++)
      for (let i = 0; i <= nx; i++) {
        const x = (i / nx - 0.5) * width,
          z = near + (j / nz) * 290,
          noise =
            (Math.sin(x * 0.009 + layer * 2) +
              0.4 * Math.sin(x * 0.022 + layer) +
              0.2 * Math.cos(x * 0.046)) *
              0.5 +
            0.7,
          profile = Math.sin((j / nz) * Math.PI) ** 0.7,
          height = -4 + profile * (32 + noise * (62 + layer * 12));
        v.push(x, height, z);
        const cc = c.clone();
        cc.offsetHSL(
          0.007 * Math.sin(x * 0.1),
          0,
          0.045 * Math.sin(x * 0.04 + z * 0.025) + 0.012 * Math.sin(x * 0.24 + z * 0.18),
        );
        colors.push(cc.r, cc.g, cc.b);
      }
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i,
          b = a + nx + 1;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide }),
    );
    m.userData.nightBackdrop = true;
    scene.add(m);
  }
  // Low foothills surround the sample so an orbit never exposes an empty sky seam.
  for (const side of [-1, 1])
    for (let i = 0; i < 7; i++) {
      const z = -120 + i * 95,
        x = side * (440 + Math.sin(i) * 35);
      const g = new THREE.SphereGeometry(1, 30, 16);
      const o = add(scene, g, standard('#638b78'), x, 6, z, [110, 16 + (i % 3) * 7, 100]);
      o.castShadow = false;
    }
}
async function mountains(scene) {
  try {
    const texture = await new THREE.TextureLoader().loadAsync(assetUrl('mountains'));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    for (let layer = 0; layer < 2; layer++)
      for (let segment = 0; segment < 6; segment++) {
        const radius = layer ? 1650 : 850,
          height = layer ? 540 : 300,
          extent = Math.PI / 3 + 0.005,
          centre = (segment * Math.PI) / 3 + (layer ? 0.5 : 0),
          v = [],
          uv = [],
          idx = [],
          n = 100;
        for (let j = 0; j < 2; j++)
          for (let i = 0; i <= n; i++) {
            const a = centre + (i / n - 0.5) * extent;
            v.push(Math.sin(a) * radius, -25 + j * height, 90 + Math.cos(a) * radius);
            uv.push(i / n, j);
          }
        for (let i = 0; i < n; i++) {
          idx.push(i, i + 1, i + n + 1, i + 1, i + n + 2, i + n + 1);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        const m = new THREE.MeshBasicMaterial({
          map: texture,
          color: layer ? '#a0c8ed' : '#ffffff',
          transparent: false,
          alphaTest: 0.12,
          depthWrite: true,
          side: THREE.DoubleSide,
          fog: true,
        });
        const o = new THREE.Mesh(g, m);
        o.userData.waterSky = true;
        o.userData.nightBackdrop = true;
        o.renderOrder = layer ? -8 : -7;
        scene.add(o);
      }
  } catch (error) {
    console.warn('Mountain texture unavailable; using three-dimensional fallback.', error);
    geometricMountains(scene);
  }
}
export async function buildField(
  scene,
  renderer,
  colliders,
  { progressive = false, getPlayer } = {},
) {
  const cull = [],
    warnings = [],
    night = { value: 0 };
  const roadTexture = noiseTexture('road'),
    asphalt = standard(C.road, { map: roadTexture, bumpMap: roadTexture, bumpScale: 0.016 }),
    paint = standard(C.paint),
    soil = standard(C.soil);
  await addFieldLandscape(scene, cull, warnings);
  ribbon(scene, 0, 5.45, soil);
  ribbon(scene, 0, ROAD_WIDTH, asphalt, 0, ROAD_LENGTH, 0.035);
  ribbon(scene, -2.13, 0.095, paint, 0, 200, 0.042);
  for (const [a, b] of [[7, 193]]) ribbon(scene, 2.13, 0.095, paint, a, b, 0.042);
  addFieldRoads(scene, asphalt, soil, paint);
  for (const [x, z] of [
    [0, 0],
    [-26, 200],
  ]) {
    const disc = add(
      scene,
      new THREE.CircleGeometry(7.5, 64),
      asphalt,
      x,
      terrainHeight(x, z) + 0.035,
      z,
    );
    disc.rotation.x = -Math.PI / 2;
    disc.castShadow = false;
  }
  scene.add(createStartingPlatform(asphalt));
  const water = waterMaterial(),
    wood = standard(C.bark);
  addUnifiedIrrigation(scene, colliders, cull);
  const mud = waterBedMaterial({ time, night }),
    riceRoots = [];
  await addCanalBed(scene, warnings, { time, night });
  const goldfish = await addCanalGoldfish(scene, warnings, night);
  const riceMat = windMaterial('#c5d68d'),
    riceGeo = blades(true),
    riceSpacing = 0.6;
  for (const p of paddyLayout(roadPoint)) {
    const { x, z } = p,
      waterMesh = new THREE.Mesh(paddySurfaceGeometry(p), water);
    waterMesh.name = 'Rounded paddy water ' + p.row + ' ' + p.col;
    addPaddyBed(scene, p, mud);
    waterMesh.receiveShadow = true;
    scene.add(waterMesh);
    if (isPloughField(p)) continue;
    const plants = [];
    for (let a = 0; a < 20 / riceSpacing; a++)
      for (let b = 0; b < 21 / riceSpacing; b++) {
        const px = x - 9.7 + a * riceSpacing + (rnd() - 0.5) * 0.09,
          pz = z - 10 + b * riceSpacing + (rnd() - 0.5) * 0.09;
        if (paddyDistance(p, px, pz, roadPoint) > -0.24) continue;
        plants.push({
          x: px,
          y: terrainHeight(px, pz) + 0.055,
          z: pz,
          sy: 0.42 + rnd() * 0.32,
          ry: rnd() * 6.28,
          color: ['#54833a', '#8daa48', '#a6b856'][Math.floor(rnd() * 3)],
        });
      }
    riceRoots.push(...plants);
    const o = instances(scene, riceGeo, riceMat, plants);
    o.name = 'Rounded paddy rice ' + p.row + ' ' + p.col;
    cull.push({ o, x, z, distance: 230 });
  }

  addRiceRootContacts(scene, riceRoots);
  addPaddyBanks(scene, cull);
  // Hydrangea clusters with broad leaves, placed deliberately at two shoulders.
  const hLeaves = [],
    hFlowers = [];
  for (const [distance, side] of [
    [6, 1],
    [19, -1],
    [83, 1],
    [139, -1],
  ]) {
    const f = roadFrame(distance),
      cx = f.x + f.nx * 3.8 * side,
      cz = f.z + f.nz * 3.8 * side;
    for (let i = 0; i < 70; i++) {
      const a = rnd() * 6.28,
        r = rnd() * 0.85,
        x = cx + Math.cos(a) * r,
        z = cz + Math.sin(a) * r;
      hLeaves.push({
        s: distance,
        d: side * 3.8,
        x,
        y: terrainHeight(x, z) + 0.2 + rnd() * 0.45,
        z,
        rx: -0.5 + rnd(),
        ry: rnd() * 6.28,
        color: '#537d3e',
      });
    }
    for (let head = 0; head < 9; head++) {
      const a = head * 2.4,
        x = cx + Math.cos(a) * 0.6,
        z = cz + Math.sin(a) * 0.6,
        y = terrainHeight(x, z) + 0.6 + rnd() * 0.3;
      for (let j = 0; j < 28; j++) {
        const phi = j * 2.399,
          h = 1 - (2 * j) / 28,
          r = Math.sqrt(1 - h * h) * 0.17;
        hFlowers.push({
          s: distance,
          d: side * 3.8,
          x: x + Math.cos(phi) * r,
          y: y + h * 0.17,
          z: z + Math.sin(phi) * r,
          color: head % 2 ? '#9cafe6' : '#b2a0d5',
        });
      }
    }
  }
  instances(
    scene,
    leafSpray(62),
    leafMaterial(),
    hLeaves
      .filter((p) => keepLegacyPoint(p) && roadsidePlantAllowed(p.x, p.z, 0.4))
      .map((p) => ({ ...p, sx: 0.65, sy: 0.65, sz: 0.65, color: '#e4e3b8' })),
  );
  instances(
    scene,
    new THREE.SphereGeometry(0.045, 5, 3),
    standard('#ffffff'),
    hFlowers.filter((p) => keepLegacyPoint(p) && roadsidePlantAllowed(p.x, p.z, 0.06)),
  );
  // Preserve unrelated scenery random state after removing the old large leaf producer.
  for (let i = 0; i < 37 * 70 * 6; i++) rnd();

  const poles = [];
  for (let z = 12; z < 200; z += 26) {
    const f = roadFrame(z),
      x = z === 194 ? NOHARA_HOUSE_POLE.x : f.x - f.nx * 9,
      zp = z === 194 ? NOHARA_HOUSE_POLE.z : f.z - f.nz * 9,
      y = terrainHeight(x, zp);
    add(scene, new THREE.CylinderGeometry(0.11, 0.17, 8.5, 10), wood, x, y + 4.25, zp);
    const arm = add(scene, new THREE.BoxGeometry(1.5, 0.12, 0.13), wood, x, y + 7.8, zp);
    arm.rotation.y = f.heading;
    for (const d of [-0.55, 0.55])
      add(scene, new THREE.CylinderGeometry(0.06, 0.06, 0.17, 8), paint, x + d, y + 7.97, zp);
    poles.push(new THREE.Vector3(x, y + 8, zp));
    colliders.push({ x, z: zp, radius: 0.2 });
  }
  for (let i = 1; i < poles.length; i++)
    for (const offset of [-0.55, 0.55]) {
      const a = poles[i - 1].clone(),
        b = poles[i].clone();
      a.x += offset;
      b.x += offset;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      mid.y -= 0.8;
      const wire = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid, b]), 20, 0.016, 4, false),
        standard('#3d4944'),
      );
      scene.add(wire);
    }
  await Promise.all([sky(scene, night), mountains(scene)]);
  const nightSky = createNightSky(scene, night);
  scene.traverse((o) => {
    for (const material of Array.isArray(o.material) ? o.material : [o.material])
      if (material?.userData?.canalFlow) {
        material.userData.flowTime = time;
        material.userData.flowNight = night;
      }
  });
  const waterSky = captureWaterSky(renderer, scene);
  await yieldSceneWork();
  nightSky.setMix(1);
  const nightWaterSky = captureWaterSky(renderer, scene, { background: scene.background });
  nightSky.setMix(0);
  applyWaterReflection(water, waterSky, { time, night, nightEnvironment: nightWaterSky });
  const canal = scene.getObjectByName('Approved independent 192m shallow irrigation water');
  if (canal) {
    applyWaterReflection(canal.material, waterSky, {
      canal: true,
      time,
      night,
      nightEnvironment: nightWaterSky,
    });
  }
  const waterAudit = document.getElementById('field-landscape-audit');
  if (waterAudit) {
    const audit = JSON.parse(waterAudit.textContent);
    Object.assign(audit.water, {
      opacity: 'view-dependent clear film',
      bed: 'warm painted sand with submerged Blender pebbles',
      dayNight: true,
      skyCloudReflection: true,
      reflectionCubeSize: 512,
    });
    waterAudit.textContent = JSON.stringify(audit);
  }
  const loader = createModelLoader();
  const [trees, house] = await Promise.all([
    loadFieldTreeAssets().catch((error) => {
      warnings.push('sample-tree-02');
      console.warn(
        'Registered sample-tree-02 unavailable; tree visuals and colliders omitted.',
        error,
      );
      return null;
    }),
    loader
      .loadAsync(assetUrl('reference-house'))
      .then((g) => {
        const root = g.scene,
          bounds = new THREE.Box3().setFromObject(root, true),
          center = bounds.getCenter(new THREE.Vector3()),
          group = new THREE.Group();
        root.position.set(-center.x, -bounds.min.y, -center.z);
        group.add(root);
        return group;
      })
      .catch((error) => {
        warnings.push('reference-house');
        console.warn(
          'Registered reference-house unavailable; house visuals and colliders omitted.',
          error,
        );
        return null;
      }),
  ]);
  if (trees) {
    for (const [d, offset, scale] of [
      [34, -10, 1.35],
      [59, -8.7, 1.65],
      [85, -12, 1.05],
      [111, -9, 1.7],
      [141, -11, 1.25],
      [166, -8.4, 1.65],
      [188, -12, 1.1],
    ]) {
      const f = roadFrame(d),
        x = f.x + f.nx * offset,
        z = f.z + f.nz * offset,
        o = trees.create();
      o.position.set(x, terrainHeight(x, z), z);
      o.rotation.y = d * 0.08;
      o.scale.setScalar(scale);
      scene.add(o);
      colliders.push({ x, z, radius: 0.6 * scale });
    }
    const points = Array.from({ length: 32 }, (_, i) => {
      const x = -150 + i * 11 + (i % 3) * 4,
        z = 240 + (i % 5) * 12;
      return { x, y: terrainHeight(x, z), z, scale: 0.3 + (i % 3) * 0.08, ry: i * 2.399 };
    });
    trees.belt(scene, points);
    const status = document.createElement('script');
    status.type = 'application/json';
    status.id = 'field-tree-audit';
    status.textContent = JSON.stringify({
      asset: 'sample-tree-02',
      referenceHeight: trees.referenceHeight,
      lod: trees.stats,
      nearTrees: 7,
      beltTrees: 32,
      sampleTree: 'sample-tree-02',
    });
    document.body.append(status);
  }
  if (house)
    for (const [x, z, s, rot] of [
      [-30, 73, 1.3, -0.2],
      [-31, 94, 1.65, -0.4],
      [-35, 121, 1.5, 0.1],
      [-41, 163, 1.3, -0.25],
    ]) {
      const o = house.clone(true);
      o.position.set(x, terrainHeight(x, z), z);
      o.rotation.y = rot + Math.PI;
      o.scale.setScalar(s);
      o.traverse((n) => {
        if (n.isMesh) {
          n.castShadow = true;
          n.receiveShadow = true;
        }
      });
      scene.add(o);
      colliders.push({ x, z, radius: 4.8 * s, height: 5.455 * s });
    }
  await addNoharaHouse(scene, colliders, warnings);
  let noharaFamily = null;
  const forestPoints = addSummerDressing(scene, cull, colliders);
  let forest = null;
  try {
    forest = addForestTrees(scene, await loadForestTreeAssets(), forestPoints);
    const audit = document.createElement('script');
    audit.type = 'application/json';
    audit.id = 'forest-tree-audit';
    audit.textContent = JSON.stringify({
      asset: FOREST_ASSET_ID,
      count: forest.count,
      variants: forest.variants,
      focus: forest.focus,
      lodDistances: FOREST_LOD_DISTANCES,
    });
    document.body.append(audit);
  } catch (error) {
    warnings.push(FOREST_ASSET_ID);
    console.warn('Anime forest unavailable; forest visuals omitted.', error);
  }
  await addEnvironmentSample(scene, colliders, warnings);
  // Keep the roadside marker at the far-end turn-around area.
  for (const [x, z] of [[-33, 204]]) {
    add(
      scene,
      new THREE.CylinderGeometry(0.045, 0.045, 1.5, 8),
      wood,
      x,
      terrainHeight(x, z) + 0.75,
      z,
    );
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const c = canvas.getContext('2d');
    c.fillStyle = '#e9e6cf';
    c.fillRect(0, 0, 256, 128);
    c.fillStyle = '#526b5d';
    c.font = 'bold 36px sans-serif';
    c.textAlign = 'center';
    c.fillText('田野 · 慢行', 128, 58);
    c.font = '24px sans-serif';
    c.fillText(z > 100 ? '左拐 · 环田公路' : '环田公路 · 慢行', 128, 99);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    add(
      scene,
      new THREE.PlaneGeometry(1.6, 0.8),
      standard('#ffffff', { map, side: THREE.DoubleSide }),
      x,
      terrainHeight(x, z) + 1.45,
      z,
    );
  }
  const summerGrass = addSummerGrass(scene, cull, colliders);
  const mountain = await addFieldMountain(scene, colliders, warnings);
  const leopardTree = await addLeopardTree(scene, colliders, warnings);
  let animals = null;
  const zombies = await addFieldZombies(scene, colliders, warnings);
  zombies?.addGatekeeper();
  const lookout = zombies ? createZombieLookout(scene, colliders, zombies) : null;
  const woodenCart = zombies ? await addZombieCrewCart(scene, colliders, warnings, zombies) : null;
  const corral =
    woodenCart && zombies?.actor('pvz-conehead') && zombies?.actor('pvz-gargantuar')
      ? createZombieCorral(scene, colliders, woodenCart, zombies, {
          externalDelivery: true,
          guard: 'pvz-gatekeeper',
          gateSide: 'right',
        })
      : null;
  const animalAccess = { animal: (id) => animals?.animal(id) };
  const paddyPloughing = await addPaddyTask(
    scene,
    colliders,
    zombies,
    warnings,
    animalAccess,
    corral,
  );
  const campsite = await addCampsiteCookingSet(scene, colliders, warnings);
  let calfHeist = null,
    calfRescue = null,
    leopardMilk = null;
  const loading = { actors: 'pending' };
  let background;
  function loadBackground() {
    return (background ??= finishBackground());
  }
  async function finishBackground() {
    loading.actors = 'loading';
    [animals, noharaFamily] = await Promise.all([
      addFieldAnimals(scene, colliders, warnings, !!mountain, leopardTree, { getPlayer }),
      addNoharaFamily(scene, colliders, warnings, { getPlayer }),
    ]);
    calfHeist =
      corral && animals.animal('hornless-calf')
        ? createZombieCalfHeist(scene, colliders, woodenCart, zombies, animals, corral, { lookout })
        : null;
    calfRescue = calfHeist
      ? createZombieCalfRescue(scene, colliders, zombies, animals, corral, calfHeist)
      : null;
    leopardMilk = createLeopardMilkVisit(scene, colliders, animals, corral);
    const qaParams = new URLSearchParams(globalThis.location?.search ?? '');
    if (
      qaParams.has('qa') &&
      ['front', 'side', 'rear'].includes(qaParams.get('crewcartview')) &&
      woodenCart
    ) {
      woodenCart.mountDriver();
      woodenCart.mountGiant();
    }
    if (qaParams.has('qa') && qaParams.has('carrypreview')) calfHeist?.previewCarry();
    // Deterministic real-scene reproductions; these only run with explicit QA URLs.
    if (qaParams.has('qa') && calfHeist && qaParams.has('clearancecheck')) {
      const positionZombie = (id, at) => {
        const actor = zombies.actor(id);
        actor.object.position.set(at.x, drivingHeight(at.x, at.z), at.z);
        actor.object.rotation.set(0, at.heading ?? 0, 0, 'YXZ');
        Object.assign(actor.collider, { x: at.x, z: at.z });
        zombies.rebind(id);
        return actor;
      };
      if (qaParams.get('clearancecheck') === 'boarding') {
        for (const [id, z] of [
          ['pvz-conehead', 2.3],
          ['pvz-gargantuar', -0.65],
        ]) {
          positionZombie(id, woodenCart.world(-5, 0, z));
          zombies.take(id);
        }
        const blocker = positionZombie('pvz-browncoat', woodenCart.world(-3.15, 0, -0.65));
        zombies.release(blocker.layout.id);
        blocker.layout.speed = 0;
        calfHeist.startManual();
      } else if (qaParams.get('clearancecheck') === 'pickup') {
        for (const [id, x, z] of [
          ['hornless-calf', -25, 10],
          ['golden-cow', -25, 11.08],
          ['copper-cow', -35, 25],
        ]) {
          const animal = animals.animal(id);
          Object.assign(animal, { x, z, heading: -Math.PI / 2, target: null, wait: 600 });
          animal.group.position.set(x, drivingHeight(x, z) + 0.025, z);
          animal.group.rotation.set(0, animal.heading, 0, 'YXZ');
          Object.assign(animal.collider, { x, z });
        }
        positionZombie('pvz-gargantuar', { x: -25, z: 14.5, heading: Math.PI });
        calfHeist.holdManual();
      }
    }
    Object.assign(field, { animals, noharaFamily, calfHeist, calfRescue, leopardMilk });
    tick = makeTick();
    loading.actors = 'ready';
    return field;
  }
  const makeTick = () =>
    createGameplayTick({
      animals,
      goldfish,
      zombies,
      paddy: paddyPloughing,
      cart: woodenCart,
      corral,
      heist: calfHeist,
      rescue: calfRescue,
      milk: leopardMilk,
      campsite,
    });
  let tick = makeTick();
  const field = {
    loading,
    loadBackground,
    warnings,
    sky: nightSky,
    animals,
    summerGrass,
    forest,
    goldfish,
    zombies,
    woodenCart,
    corral,
    calfHeist,
    calfRescue,
    leopardMilk,
    lookout,
    paddyPloughing,
    advanceCalfHeist(seconds, car) {
      for (let t = 0; t < seconds; t += 0.05) {
        const dt = Math.min(0.05, seconds - t);
        tick({ dt, clockDt: dt, player: car, focus: car, cameraPosition: car, timeOfDay: 'day' });
      }
    },
    campsite,
    noharaFamily,
    update(frame) {
      const { seconds, focus: carPosition, dt, cameraPosition, player: actualCar } = frame;
      forest?.update(cameraPosition);
      noharaFamily?.update(dt, carPosition, actualCar);
      summerGrass.update(seconds, carPosition);
      tick(frame);
      time.value = seconds;
      for (const item of cull) {
        const distance = Math.hypot(carPosition.x - item.x, carPosition.z - item.z);
        item.o.visible = distance < item.distance && distance >= (item.minDistance || 0);
      }
    },
    roadLength: ROAD_LENGTH,
  };
  if (!progressive) await loadBackground();
  return field;
}
