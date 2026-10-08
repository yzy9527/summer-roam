import * as THREE from 'three';

/** Current tree leaf shading. Original surfaces, holes and leaf placement are locked.
 * Extra canopyNormal is a shading field, never a rendered surface or shell.
 * All meshes continue casting and receiving actual sun shadows.
 */
export function applyLeafMaterial(material, { normalMix = 0.65, shadowFloor = 0.4 } = {}) {
  material.roughness = 0.94;
  material.metalness = 0;
  const coherent = normalMix;
  const floor = shadowFloor;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCanopyNormalMix = { value: coherent };
    shader.uniforms.uLeafShadowFloor = { value: floor };
    shader.uniforms.uLeafHueStrength = { value: 1 };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
    attribute vec3 canopyNormal;
    varying vec3 vCanopyViewNormal;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
    vCanopyViewNormal = normalMatrix * canopyNormal;`,
      );
    const lighting = THREE.ShaderChunk.lights_fragment_begin.replace(
      /getShadow\( directionalShadowMap\[ i \],[^)]*\)/g,
      'mix(uLeafShadowFloor, 1.0, $&)',
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
    varying vec3 vCanopyViewNormal;
    uniform float uCanopyNormalMix;
    uniform float uLeafShadowFloor;
    uniform float uLeafHueStrength;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
    // Preserve some folded-leaf response, align double-sided normals to the
    // crown hemisphere so random back-facing leaves do not become dark shards.
    vec3 crownNormal = normalize(vCanopyViewNormal);
    vec3 foldedLeafNormal = normal * (dot(normal, crownNormal) < 0.0 ? -1.0 : 1.0);
    if (uCanopyNormalMix > 0.0) normal = normalize(mix(foldedLeafNormal, crownNormal, uCanopyNormalMix));`,
      )
      .replace('#include <lights_fragment_begin>', lighting)
      .replace(
        '#include <opaque_fragment>',
        `
    // Pigment tint only; no constant fill, baked sunshine or quantized tones.
    float sunFacing = 0.5;
    #if NUM_DIR_LIGHTS > 0
     sunFacing = smoothstep(-0.35, 0.85, dot(normal, directionalLights[0].direction));
    #endif
    vec3 subtleTint = mix(vec3(0.90, 0.99, 1.10), vec3(1.035, 1.015, 0.965), sunFacing);
    outgoingLight *= mix(vec3(1.0), subtleTint, uLeafHueStrength);
    #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => `field-leaf-${normalMix}-${shadowFloor}`;
  material.needsUpdate = true;
}

// Keep complete six-triangle folded leaves from the approved directional tree.
export function leafLOD(source, stride) {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(source.attributes)) g.setAttribute(name, a);
  const indices = [];
  for (let i = 0; i < source.index.count; i += 18 * stride)
    for (let j = 0; j < 18 && i + j < source.index.count; j++)
      indices.push(source.index.getX(i + j));
  g.setIndex(indices);
  g.computeBoundingSphere();
  return g;
}
