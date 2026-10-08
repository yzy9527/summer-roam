import { assetUrl } from './asset-url.js';
import * as THREE from 'three';
import { terrainHeight } from './world-base.js';
import { CULVERT_STATIONS, culvertLayout, roofLift } from './culvert-profile.js';
// Compatibility for existing tools; the physical definitions live in the pure layer.
export {
  CULVERT,
  CULVERT_STATIONS,
  culvertLayout,
  culvertGroundHeight,
} from './culvert-profile.js';

const STONE_PALETTE = ['#b3a58b', '#969d7e', '#c0b196', '#a29e86', '#839478'];
function softBox(w, h, d, r = 0.018) {
  const g = new THREE.BoxGeometry(w, h, d, 6, 4, 6),
    a = g.attributes.position,
    n = g.attributes.normal,
    core = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r),
    v = new THREE.Vector3(),
    q = new THREE.Vector3(),
    normal = new THREE.Vector3();
  for (let i = 0; i < a.count; i++) {
    v.fromBufferAttribute(a, i);
    q.copy(v).clamp(core.clone().negate(), core);
    normal.copy(v).sub(q).normalize();
    v.copy(q).addScaledVector(normal, r);
    a.setXYZ(i, v.x, v.y, v.z);
    n.setXYZ(i, normal.x, normal.y, normal.z);
  }
  return g;
}
function shallowLid(p, width, centre) {
  const g = softBox(width - 0.008, 0.08, p.length),
    a = g.attributes.position;
  for (let i = 0; i < a.count; i++)
    a.setY(i, a.getY(i) + roofLift(p, a.getX(i) + centre, a.getZ(i) + p.length / 2));
  g.computeVertexNormals();
  return g;
}
function grassCover(p, material) {
  const v = [],
    uv = [],
    idx = [],
    rows = 16,
    cols = 8,
    half = p.width / 2 + 0.44;
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i <= cols; i++) {
      const x = ((i / cols) * 2 - 1) * half,
        z = 0.22 + ((p.length + 0.18 - 0.22) * j) / rows,
        wx = p.x + x * Math.cos(p.heading) + z * Math.sin(p.heading),
        wz = p.z - x * Math.sin(p.heading) + z * Math.cos(p.heading);
      const base = terrainHeight(wx, wz),
        edge = 1 - THREE.MathUtils.smoothstep(Math.abs(x), p.width / 2 + 0.2, half),
        fade = 1 - THREE.MathUtils.smoothstep(z, 0.22, 0.62),
        shoulder = p.bankTop + roofLift(p, x, z);
      v.push(x, THREE.MathUtils.lerp(base, shoulder, edge * fade) + 0.003, z);
      uv.push(wx / 4, wz / 4);
    }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      idx.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const o = new THREE.Mesh(g, material);
  o.name = 'Continuous restored grass behind flush inlet';
  o.receiveShadow = true;
  return o;
}
function tunnelWater(p) {
  const g = new THREE.PlaneGeometry(p.width, p.tailStart + 0.02, 4, 12),
    colours = [],
    a = g.attributes.position;
  for (let i = 0; i < a.count; i++) {
    const depth = (p.tailStart / 2 - a.getY(i)) / p.tailStart,
      c = new THREE.Color('#7fa997').lerp(new THREE.Color('#101f21'), Math.min(1, depth * 1.55));
    colours.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  const m = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.userData.canalFlow = true;
  m.userData.flowTime = { value: 0 };
  m.userData.flowNight = { value: 0 };
  m.onBeforeCompile = (s) => {
    s.uniforms.uCanalTime = m.userData.flowTime;
    s.uniforms.uCanalNight = m.userData.flowNight;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTunnelUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTunnelUv=uv;');
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uCanalTime;uniform float uCanalNight;varying vec2 vTunnelUv;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
 float along=${p.station === 10 ? '-1.' : '1.'}*(1.-vTunnelUv.y)*${p.tailStart.toFixed(2)}-uCanalTime*.28;
 float ripple=pow(.5+.5*sin(along*19.+vTunnelUv.x*5.),24.);
 diffuseColor.rgb+=vec3(.038,.06,.06)*ripple*smoothstep(.05,.85,vTunnelUv.y)*(1.-uCanalNight);
 diffuseColor.rgb*=mix(vec3(1.),vec3(.15,.21,.31),uCanalNight);`,
      );
  };
  m.customProgramCacheKey = () => `rounded-culvert-day-night-flow-${p.station}`;
  const water = new THREE.Mesh(g, m);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, p.water, p.tailStart / 2 - 0.01);
  water.name = 'Continuous water inside flush inlet';
  return water;
}
export function addCanalCulvert(scene, colliders, cull, geometry, surface) {
  const reports = [],
    soil = new THREE.MeshStandardMaterial({ color: '#b3cd83', roughness: 1 });
  if (typeof document !== 'undefined')
    new THREE.TextureLoader().load(assetUrl('ground'), (map) => {
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.MirroredRepeatWrapping;
      soil.map = map;
      soil.needsUpdate = true;
    });
  for (const station of CULVERT_STATIONS) {
    const p = culvertLayout(station),
      group = new THREE.Group();
    group.name = 'Flush stone canal inlet ' + station;
    group.position.set(p.x, 0, p.z);
    group.rotation.y = p.heading;
    scene.add(group);
    const mesh = (g, m, x, y, z, name) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.name = name;
      o.receiveShadow = true;
      o.castShadow = true;
      group.add(o);
      return o;
    };
    for (let i = 0; i < 4; i++) {
      const width = (p.width + 0.4) / 4;
      mesh(
        shallowLid(p, width, (i - 1.5) * width),
        surface(STONE_PALETTE[i]),
        (i - 1.5) * width,
        p.bankTop - 0.04,
        p.length / 2,
        'Ground flush rounded stone lintel',
      );
    }
    for (const side of [-1, 1])
      for (let j = 0; j < 2; j++) {
        const h = (p.bankTop - p.bed) / 2;
        mesh(
          softBox(0.2, h - 0.01, p.length),
          surface(STONE_PALETTE[(j + (side + 1)) % 5]),
          side * (p.width / 2 + 0.1),
          p.bed + (j + 0.5) * h,
          p.length / 2,
          'Low rounded stone inlet jamb',
        );
      }
    const back = p.tailStart - 0.02,
      opening = new THREE.Shape();
    opening.moveTo(-p.width / 2, p.bed);
    opening.lineTo(p.width / 2, p.bed);
    for (let i = 0; i <= 32; i++) {
      const x = p.width / 2 - (i * p.width) / 32;
      opening.lineTo(x, p.spring + roofLift(p, x, back));
    }
    opening.closePath();
    mesh(
      new THREE.ShapeGeometry(opening),
      new THREE.MeshBasicMaterial({ color: '#101e1b', side: THREE.DoubleSide }),
      0,
      0,
      back,
      'Recessed dark underground inlet',
    );
    group.add(tunnelWater(p), grassCover(p, soil));
    cull.push({ o: group, x: p.x, z: p.z, distance: 85 });
    for (const side of [-1, 1]) {
      const x = side * (p.width / 2 + 0.12),
        z = 0.12;
      colliders.push({
        x: p.x + x * Math.cos(p.heading) + z * Math.sin(p.heading),
        z: p.z - x * Math.sin(p.heading) + z * Math.cos(p.heading),
        radius: 0.2,
        height: 0.15,
        kind: 'culvert',
        s: station,
      });
    }
    reports.push({ ...p, shallowArc: true, restoredGrass: true, waterOnlyInside: true });
  }
  return { ends: reports, shallowArc: true };
}
