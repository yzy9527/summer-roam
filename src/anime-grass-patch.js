import * as THREE from 'three';
export function createSummerGrassPatch(point, options = {}) {
  const time = { value: 0 };
  // One curved ribbon shared by all blades; individual roots and shapes stay on the GPU.
  const segments = options.segments ?? 7,
    positions = [],
    uv = [],
    indices = [];
  for (let j = 0; j <= segments; j++) {
    const t = j / segments;
    positions.push(-0.5 * (1 - t), t, 0, 0.5 * (1 - t), t, 0);
    uv.push(0, t, 1, t);
    if (j < segments) {
      const a = j * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  let seed = options.seed ?? 9137;
  function random() {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const roots = [],
    shapes = [];
  // Broad communities and smaller tufts share height and lean, avoiding uniform lawn fuzz.
  for (let clump = 0; clump < (options.clumps ?? 700); clump++) {
    const x = (random() - 0.5) * (options.length ?? 5),
      z = (random() - 0.5) * (options.width ?? 1.25);
    if (options.density && random() > options.density(x, z)) continue;
    const community = 0.5 + 0.5 * Math.sin(x * 2.1 + Math.sin(z * 1.8));
    const h = 0.16 + community * 0.22 + random() * 0.13,
      angle = 0.65 + Math.sin(x * 1.5 + z) * 0.8;
    for (let leaf = 0; leaf < (options.leaves ?? 25); leaf++) {
      const r = Math.sqrt(random()) * 0.11,
        a = random() * Math.PI * 2;
      const px = x + Math.cos(a) * r,
        pz = z + Math.sin(a) * r;
      if (Math.abs(px) > (options.length ?? 5) / 2 || Math.abs(pz) > (options.width ?? 1.25) / 2)
        continue;
      const p = point(px, pz);
      if (!p) continue;
      roots.push(p.x, p.y, p.z);
      shapes.push(
        Math.min(
          p.maxHeight ?? options.maxHeight ?? 1,
          h * (0.65 + random() * 0.65) * (p.heightScale ?? options.heightScale ?? 1),
        ),
        (0.019 + random() * 0.029) * (options.widthScale ?? 1),
        angle + (random() - 0.5) * 2.8,
        random(),
      );
    }
  }
  const count = roots.length / 3;
  geometry.setAttribute('root', new THREE.InstancedBufferAttribute(new Float32Array(roots), 3));
  geometry.setAttribute('shape', new THREE.InstancedBufferAttribute(new Float32Array(shapes), 4));
  geometry.instanceCount = count;

  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 1,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.grassTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
 attribute vec3 root;attribute vec4 shape;uniform float grassTime;varying float grassT;varying vec3 grassRoot;varying float grassFacing;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal=normalize(vec3(-cos(shape.z)*.3,.85,-sin(shape.z)*.3));`,
      )
      .replace(
        '#include <begin_vertex>',
        `float t=position.y;vec2 dir=vec2(cos(shape.z),sin(shape.z));
 vec3 transformed=root;transformed.y+=t*shape.x-pow(t,3.)*shape.x*.18;
 transformed.xz+=vec2(-dir.y,dir.x)*position.x*shape.y+dir*pow(t,1.7)*shape.x*(.38+shape.w*.45);
 float wave=sin(root.x*1.4+root.z*.8-grassTime*.9)+.35*sin(root.x*3.7-root.z*2.1-grassTime*1.4);
 transformed.xz+=vec2(.85,.35)*wave*.04*t*t;
 grassT=t;grassRoot=root;grassFacing=.5+.5*sin(shape.z+.7);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
 varying float grassT;varying vec3 grassRoot;varying float grassFacing;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
 float patch=clamp(.5+.23*sin(grassRoot.x*1.8+sin(grassRoot.z*1.9))+.17*sin(grassRoot.z*3.1-grassRoot.x*.8),0.,1.);
 vec3 low=mix(vec3(.025,.11,.045),vec3(.075,.17,.025),patch);
 vec3 tip=mix(vec3(.065,.22,.045),vec3(.20,.34,.055),patch);
 diffuseColor.rgb*=mix(low,tip,smoothstep(.05,1.,grassT))*(.8+.2*grassFacing);`.replaceAll(
          'patch',
          'grassColourPatch',
        ),
      );
  };
  if (options.shadowFloor) {
    const hook = material.onBeforeCompile;
    material.onBeforeCompile = (shader) => {
      hook(shader);
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `float woodlandMask=step(10.,grassRoot.z)*step(grassRoot.z,21.)*step(-12.,grassRoot.x)*step(grassRoot.x,-5.5);\noutgoingLight=mix(outgoingLight,max(outgoingLight,diffuseColor.rgb*${options.shadowFloor.toFixed(2)}),woodlandMask);\n#include <opaque_fragment>`,
      );
    };
  }
  material.customProgramCacheKey = () => 'summer-grass-patch-v2-' + (options.shadowFloor ?? 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Summer anime grass trial patch';
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  if (count) {
    const box = new THREE.Box3();
    for (let i = 0; i < roots.length; i += 3)
      box.expandByPoint(new THREE.Vector3(roots[i], roots[i + 1], roots[i + 2]));
    box.expandByScalar(0.6);
    geometry.boundingBox = box;
    geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    mesh.frustumCulled = true;
  }
  return {
    mesh,
    count,
    update(seconds) {
      time.value = seconds;
    },
  };
}
