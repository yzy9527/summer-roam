import * as THREE from 'three';
import { createModelLoader } from './loading/model-loader.js';
import { assetUrl } from './asset-url.js';
import { roadFrame, terrainHeight } from './world-base.js';
import { landscapeHeight } from './world-queries.js';
import { canalOffset, canalWidth, waterLevel, CANAL } from './canal-profile.js';
import { paddySurfaceGeometry } from './paddy-geometry.js';

// Broad pigment washes and a restrained moving sunlight pattern, lit by the real scene.
export function waterBedMaterial({ canal = false, time, night }) {
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  material.name = canal ? 'Warm sand under clear stream' : 'Soft grey ochre paddy mud';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBedTime = time;
    shader.uniforms.uBedNight = night;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBedWorld;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvBedWorld=(modelMatrix*vec4(transformed,1.)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vBedWorld;uniform float uBedTime;uniform float uBedNight;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec2 bed=vBedWorld.xz;
float wash=.5+.5*sin(bed.x*1.8+sin(bed.y*.74))*sin(bed.y*1.1-bed.x*.38);
float grain=.5+.5*sin(bed.x*39.+sin(bed.y*26.))*sin(bed.y*31.+bed.x*12.);
diffuseColor.rgb=mix(${canal ? 'vec3(.15,.22,.20),vec3(.25,.32,.27)' : 'vec3(.12,.105,.066),vec3(.20,.18,.115)'},smoothstep(.12,.88,wash));
diffuseColor.rgb*=.98+grain*.035;
float causticA=abs(sin(bed.x*7.+sin(bed.y*4.2+uBedTime*.38)+uBedTime*.24));
float causticB=abs(sin(bed.y*6.3+sin(bed.x*4.8-uBedTime*.31)));
float caustic=(1.-smoothstep(.025,.15,min(causticA,causticB)))*(.5+.5*sin(bed.y*.8+bed.x));
float nearDetail=1.-smoothstep(12.,35.,distance(vBedWorld,cameraPosition));
diffuseColor.rgb+=vec3(.11,.13,.09)*caustic*${canal ? '.22' : '.06'}*(1.-uBedNight)*nearDetail;`,
      );
  };
  material.customProgramCacheKey = () => `painted-water-bed-${canal ? 'sand' : 'mud'}-v1`;
  return material;
}

function channelPoint(s, d) {
  const f = roadFrame(s),
    offset = canalOffset(s) + d;
  return { x: f.x + f.nx * offset, z: f.z + f.nz * offset };
}

export function canalBedGeometry() {
  const positions = [],
    indices = [],
    across = 12,
    rows = 720;
  for (let j = 0; j <= rows; j++) {
    const s = CANAL.openStart + ((CANAL.openEnd - CANAL.openStart) * j) / rows;
    for (let i = 0; i <= across; i++) {
      const p = channelPoint(s, (((i / across) * 2 - 1) * canalWidth(s)) / 2);
      positions.push(p.x, landscapeHeight(p.x, p.z) + 0.004, p.z);
    }
  }
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < across; i++) {
      const a = j * (across + 1) + i,
        b = a + across + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function addPaddyBed(scene, p, material) {
  const mesh = new THREE.Mesh(paddySurfaceGeometry(p, 0, 0.006), material);
  mesh.name = `Painted paddy mud ${p.row} ${p.col}`;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function random(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function canalPebblePlacements() {
  const rnd = random(7826),
    placements = [];
  for (let s = 10.7; s < 189.5; s += 0.52 + rnd() * 0.75) {
    if (rnd() < 0.2) continue;
    const side = rnd() < 0.5 ? -1 : 1,
      centre = side * canalWidth(s) * (0.18 + rnd() * 0.18);
    for (let i = 0, count = 2 + Math.floor(rnd() * 4); i < count; i++) {
      const station = s + rnd() * 0.4,
        d = centre + (rnd() - 0.5) * 0.18;
      const p = channelPoint(station, d),
        bed = landscapeHeight(p.x, p.z),
        depth = terrainHeight(p.x, p.z) + waterLevel(station) - bed,
        radius = Math.min(0.035 + rnd() ** 2 * 0.065, (depth - 0.045) / 0.95);
      if (radius < 0.02) continue;
      placements.push({
        ...p,
        y: bed + 0.006,
        radius,
        rotation: rnd() * Math.PI * 2,
        variant: Math.floor(rnd() * 4),
      });
    }
  }
  return placements;
}

export async function addCanalBed(scene, warnings, uniforms) {
  const sand = new THREE.Mesh(canalBedGeometry(), waterBedMaterial({ ...uniforms, canal: true }));
  sand.name = 'Continuous warm sand canal bed';
  sand.receiveShadow = true;
  scene.add(sand);
  let prototypes;
  try {
    const { scene: source } = await createModelLoader().loadAsync(assetUrl('water-pebbles'));
    source.updateMatrixWorld(true);
    prototypes = Array.from({ length: 4 }, (_, i) => {
      const mesh = source.getObjectByName(`Water_pebble_${i}`);
      if (!mesh?.isMesh) throw new Error('Incomplete pebble asset');
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      return { geometry, material: mesh.material };
    });
  } catch (error) {
    warnings.push('water-pebbles');
    console.warn('Water pebble asset unavailable; sand bed retained.', error);
    return;
  }
  const placements = canalPebblePlacements(),
    dummy = new THREE.Object3D();
  for (let variant = 0; variant < prototypes.length; variant++) {
    const points = placements.filter((p) => p.variant === variant),
      source = prototypes[variant];
    const mesh = new THREE.InstancedMesh(source.geometry, source.material, points.length);
    mesh.name = `Submerged rounded river pebbles ${variant}`;
    points.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rotation, 0);
      dummy.scale.setScalar(p.radius);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
  }
  // Small, sparse rooted ribbons below the surface. Their tips lean with the flow.
  const vertices = [],
    indices = [],
    rnd = random(357);
  for (let s = 12.5; s < 187; s += 7 + rnd() * 5) {
    const side = rnd() < 0.5 ? -1 : 1,
      width = canalWidth(s);
    for (let blade = 0; blade < 5; blade++) {
      const p = channelPoint(s + rnd() * 0.3, side * width * (0.35 + rnd() * 0.065));
      const y = landscapeHeight(p.x, p.z) + 0.005,
        h = Math.min(0.06 + rnd() * 0.045, terrainHeight(p.x, p.z) + waterLevel(s) - y - 0.02),
        w = 0.007;
      const a = vertices.length / 3;
      vertices.push(
        p.x - w,
        y,
        p.z,
        p.x + w,
        y,
        p.z,
        p.x + 0.016,
        y + h * 0.58,
        p.z + 0.014,
        p.x + 0.035,
        y + h,
        p.z + 0.055,
      );
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const plants = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: '#788b58', roughness: 1, side: THREE.DoubleSide }),
  );
  plants.name = 'Sparse submerged canal grass';
  plants.receiveShadow = true;
  scene.add(plants);
}

export function addRiceRootContacts(scene, plants) {
  const geometry = new THREE.CircleGeometry(1, 8);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: '#797456', roughness: 1 }),
    plants.length,
  );
  const dummy = new THREE.Object3D();
  plants.forEach((p, i) => {
    dummy.position.set(p.x, terrainHeight(p.x, p.z) + 0.008, p.z);
    dummy.scale.set(0.042, 0.042, 0.057);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  mesh.name = 'Submerged rice root mud contacts';
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  scene.add(mesh);
}
