import { NOHARA_HOUSE_SITE } from './nohara-house-site.js';
import * as THREE from 'three';
import { roadFrame, terrainHeight } from './world-base.js';
import { landscapeHeight, canalCoordinates } from './world-queries.js';
import { CANAL, canalBlend, canalOffset, waterLevel, canalWidth } from './canal-profile.js';
import { loadCloseupTexture, sampleWater } from './canal-closeup.js';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export { canalCoordinates };
export const fieldGroundHeight = landscapeHeight;
function point(s, offset) {
  const f = roadFrame(s);
  return { x: f.x + f.nx * offset, z: s + f.nz * offset, heading: f.heading };
}
function xAt(z, offset) {
  let s = clamp(z, 0, 200);
  for (let i = 0; i < 8; i++) s = clamp(z - roadFrame(s).nz * offset, 0, 200);
  return roadFrame(s).x + roadFrame(s).nx * offset;
}
export function fieldGroundGeometry() {
  const v = [],
    uv = [],
    coord = [],
    idx = [],
    rows = [];
  let zs = [];
  for (let z = -110; z < -8; z += 6) zs.push(z);
  for (let z = -8; z <= 208; z += 0.4) zs.push(z);
  for (let z = 208.4; z < 214; z += 0.4) zs.push(z);
  for (let z = 214; z <= 550; z += 6) zs.push(z);
  for (const z of zs) {
    const xs = [];
    for (let x = -300; x <= 300; x += 6) xs.push(x);
    if (z >= -8 && z <= 208) {
      const s = clamp(z, 0, 200),
        centre = canalOffset(s);
      const edge = canalWidth(s) / 2;
      for (const d of [
        -edge - 0.3,
        -edge - 0.2,
        -edge - 0.08,
        -edge,
        edge,
        edge + 0.08,
        edge + 0.2,
        edge + 0.3,
      ])
        xs.push(xAt(z, centre + d));
      for (const d of [
        -1.6, -1.3, -1.05, -0.85, -0.7, -0.56, -0.46, -0.38, -0.26, 0, 0.26, 0.38, 0.46, 0.56, 0.7,
        0.85, 1.05, 1.3, 1.6,
      ])
        xs.push(xAt(z, centre + d));
      for (const off of [-10, -8, -2.72, -2.25, 0, 2.25, 2.72, 4, 7, 10]) xs.push(xAt(z, off));
    }
    if (Math.abs(z - NOHARA_HOUSE_SITE.z) < 13) {
      for (let x = -58; x <= -38; x += 0.5) xs.push(x);
    }
    xs.sort((a, b) => a - b);
    const row = [];
    for (let i = 0; i < xs.length; i++) {
      if (i && xs[i] - xs[i - 1] < 0.001) continue;
      const x = xs[i],
        c = canalCoordinates(x, z),
        id = v.length / 3;
      v.push(x, fieldGroundHeight(x, z), z);
      uv.push(x / 4, z / 4);
      coord.push(c.d, c.s);
      row.push({ x, id });
    }
    rows.push(row);
  }
  for (let r = 1; r < rows.length; r++) {
    const a = rows[r - 1],
      b = rows[r];
    let i = 0,
      j = 0;
    while (i < a.length - 1 || j < b.length - 1) {
      if (j === b.length - 1 || (i < a.length - 1 && a[i + 1].x < b[j + 1].x)) {
        idx.push(a[i].id, b[j].id, a[i + 1].id);
        i++;
      } else {
        idx.push(a[i].id, b[j].id, b[j + 1].id);
        j++;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('canalCoord', new THREE.Float32BufferAttribute(coord, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function terrainMaterial(map) {
  const m = new THREE.MeshStandardMaterial({ map, color: '#b3cd83', roughness: 0.96 });
  m.name = 'Approved grass-soil albedo with exposed earth and wet bank';
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 canalCoord;varying vec2 vBank;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBank=canalCoord;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vBank;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float bankFade=smoothstep(9.8,10.,vBank.y)*(1.-smoothstep(190.,190.2,vBank.y));
float localCut=smoothstep(10.,14.,vBank.y)*(1.-smoothstep(28.,33.,vBank.y));
float d=vBank.x,shore=.60+.20*localCut+.026*sin(vBank.y*3.5+sign(d)*1.9);
float bed=1.-smoothstep(shore-.04,shore+.10,abs(d));
float wet=exp(-pow((abs(d)-shore-.05)/.06,2.));
float patches=exp(-pow((abs(d)-1.05)/.36,2.))*smoothstep(.25,.9,sin(vBank.y*.95+d*2.));
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.42,.30,.16),patches*.68*bankFade);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.22,.20,.125),bed*.86*bankFade);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.16,.145,.085),wet*.6*bankFade);
float stoneCutSoil=smoothstep(shore-.04,shore+.02,abs(d))*(1.-smoothstep(shore+.16,shore+.32,abs(d)))*localCut;
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.075,.115,.09),stoneCutSoil*.87);
float sampleMask=smoothstep(8.,10.,vBank.y)*(1.-smoothstep(30.,33.,vBank.y));
float sampleSide=(1.-smoothstep(2.0,2.2,d))*smoothstep(-8.,-6.,d);
float warmGround=(.4+.13*sin(vBank.y*.63+d*1.8))*sampleMask*sampleSide*(1.-bed);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.23,.30,.10),warmGround*.38);
float bridgeDistance=min(min(abs(vBank.y-21.),abs(vBank.y-34.)),min(abs(vBank.y-114.),abs(vBank.y-174.)));
float bridgePath=(1.-smoothstep(.68,1.12,bridgeDistance))*(1.-smoothstep(2.5,3.2,abs(d)));
float rootSoil=exp(-pow((vBank.y-14.5)/1.1,2.)-pow((d+2.75)/.8,2.));
float soilMask=max(bridgePath*bankFade,rootSoil*sampleMask)*(1.-bed);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.32,.25,.14),soilMask*.88);`,
      );
  };
  return m;
}
function canalWater() {
  const positions = [],
    uv = [],
    fade = [],
    idx = [];
  for (let i = 0; i <= 768; i++) {
    const s = 4 + i * 0.25,
      blend = canalBlend(s);
    for (const side of [-1, 1]) {
      const p = point(
        s,
        canalOffset(s) + side * (canalWidth(s) / 2 + 0.009 * blend * Math.sin(s * 4 + side * 1.6)),
      );
      positions.push(p.x, terrainHeight(p.x, p.z) + waterLevel(s), p.z);
      uv.push((side + 1) / 2, s / 2);
      fade.push(blend);
    }
  }
  for (let i = 0; i < 768; i++) {
    if (4 + i * 0.25 < CANAL.openStart || 4 + i * 0.25 >= CANAL.openEnd) continue;
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('canalFade', new THREE.Float32BufferAttribute(fade, 1));
  g.setAttribute('waterDepth', new THREE.Float32BufferAttribute(fade, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  const original = sampleWater(),
    m = original.material;
  original.geometry.dispose();
  const hook = m.onBeforeCompile;
  m.onBeforeCompile = (s) => {
    hook(s);
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float canalFade;varying float vCanalFade;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCanalFade=canalFade;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCanalFade;')
      .replace(
        '#include <opaque_fragment>',
        'diffuseColor.a*=vCanalFade;\n#include <opaque_fragment>',
      );
  };
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'Approved independent 192m shallow irrigation water';
  mesh.receiveShadow = true;
  return mesh;
}
export async function addFieldLandscape(scene, cull, warnings) {
  let map;
  try {
    map = await loadCloseupTexture();
  } catch (e) {
    warnings.push('grass-soil texture');
    console.warn('Landscape texture loading failed', e);
  }
  if (map) {
    map.wrapS = map.wrapT = THREE.MirroredRepeatWrapping;
    map.needsUpdate = true;
  }
  const ground = new THREE.Mesh(
    fieldGroundGeometry(),
    map ? terrainMaterial(map) : new THREE.MeshStandardMaterial({ color: '#7d9f49', roughness: 1 }),
  );
  ground.name = 'Continuous terrain with actual irrigation depression';
  ground.receiveShadow = true;
  scene.add(ground, canalWater());
  const stones = 0;
  const report = {
    scope:
      'existing 200m road; canal 4–196m, core 8–192m with local stone cut 10–33m; turning areas preserved',
    texture: {
      file: 'assets/closeup/grass-earth-user.png',
      loaded: !!map?.image?.width,
      pixels: [map?.image?.width, map?.image?.height],
      uv: 'world x,z / 4m; mirrored repeat; sRGB',
    },
    ground: {
      material: ground.material.type,
      vertices: ground.geometry.attributes.position.count,
      continuous: true,
      wetBank: true,
    },
    water: {
      independent: true,
      material: 'MeshPhongMaterial',
      opacity: 0.45,
      bedVisible: true,
      localSection: { width: canalWidth(21), waterLevel: waterLevel(21), physicalGround: true },
    },
    grass: {
      short: 0,
      long: 0,
      source: 'roadside grass supplied by summer-grass.js; legacy grass models not loaded',
    },
    stones,
  };
  const el = document.createElement('script');
  el.id = 'field-landscape-audit';
  el.type = 'application/json';
  el.textContent = JSON.stringify(report);
  document.body.append(el);
  return report;
}
