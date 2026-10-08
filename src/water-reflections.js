import * as THREE from 'three';

// Capture each time-of-day sky once. Reflection directions still depend on the
// moving camera and the surface normal; this never adds a second scene render per frame.
export function captureWaterSky(renderer, scene, { background = '#72b6e4' } = {}) {
  const skyScene = new THREE.Scene();
  skyScene.background = new THREE.Color(background);
  skyScene.fog = scene.fog?.clone();
  for (const o of scene.children) if (o.userData.waterSky) skyScene.add(o.clone());
  const target = new THREE.WebGLCubeRenderTarget(512, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  const camera = new THREE.CubeCamera(0.1, 2400, target);
  camera.position.set(0, 0.12, 90);
  const oldTarget = renderer.getRenderTarget();
  camera.update(renderer, skyScene);
  renderer.setRenderTarget(oldTarget);
  return target;
}
export function applyWaterReflection(
  material,
  environment,
  { canal = false, time, night = { value: 0 }, nightEnvironment = environment } = {},
) {
  material.envMap = environment.texture;
  material.combine = THREE.MixOperation;
  material.reflectivity = 0.96;
  material.color.set(canal ? '#399bb9' : '#549fd0');
  material.specular.set('#93c9df');
  material.shininess = 90;
  material.opacity = 1;
  material.transparent = true;
  material.depthWrite = false;
  const hook = material.onBeforeCompile;
  material.onBeforeCompile = (s) => {
    hook(s);
    s.uniforms.uReflectionTime = time;
    s.uniforms.uNightStrength = night;
    s.uniforms.uNightEnvironment = { value: nightEnvironment.texture };
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float waterDepth;varying float vWaterDepth;varying vec2 vWaterUv;varying vec3 vReflectionWorld;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWaterDepth=waterDepth;vWaterUv=uv;vReflectionWorld=(modelMatrix*vec4(transformed,1.)).xyz;',
      );
    s.fragmentShader = s.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform float uReflectionTime;uniform float uNightStrength;uniform samplerCube uNightEnvironment;varying float vWaterDepth;varying vec2 vWaterUv;varying vec3 vReflectionWorld;',
    );
    s.fragmentShader = s.fragmentShader.replace(
      '#include <shadowmap_pars_fragment>',
      '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>',
    );
    s.fragmentShader = s.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
   // Small world-space ripples distort the cloud shapes without dissolving them.
   vec3 rippleNormal=vec3(.003*sin(vReflectionWorld.z*2.4+uReflectionTime*.45)+.002*sin(vReflectionWorld.x*4.1),0.,.004*cos(vReflectionWorld.x*2.2+vReflectionWorld.z*.45+uReflectionTime*.35));
   ${
     canal
       ? `float flowS=vWaterUv.y*2.-uReflectionTime*.18;
   rippleNormal=vec3(.007*sin(flowS*5.+vWaterUv.x*4.),0.,.008*cos(flowS*3.8+vWaterUv.x*5.));`
       : ''
   }
   normal=normalize(normal+mat3(viewMatrix)*rippleNormal);`,
    );
    const reflection = THREE.ShaderChunk.envmap_fragment
      .replaceAll(
        'specularStrength * reflectivity',
        'specularStrength * reflectivity * waterReflectWeight',
      )
      // Phong otherwise uses the vertex reflection and ignores our moving fragment normal.
      .replace(
        'vec3 reflectVec = vReflect;',
        'vec3 reflectVec = inverseTransformDirection(reflect(-normalize(vViewPosition),normal),viewMatrix);',
      )
      .replace(
        'vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );',
        `vec3 waterReflectDirection = envMapRotation * vec3(flipEnvMap * reflectVec.x, reflectVec.yz);
        vec4 dayWaterSky = textureCube(envMap, waterReflectDirection);
        float cloudLight=smoothstep(.40,.76,min(dayWaterSky.r,min(dayWaterSky.g,dayWaterSky.b)));
        waterCloud=smoothstep(.68,.92,min(dayWaterSky.r,min(dayWaterSky.g,dayWaterSky.b)));
        dayWaterSky.rgb=mix(dayWaterSky.rgb,vec3(.055,.35,.66),.25*(1.-cloudLight));
        dayWaterSky.rgb=mix(dayWaterSky.rgb,vec3(.94,.97,1.),cloudLight*.16);
        vec4 envColor = mix(dayWaterSky, textureCube(uNightEnvironment, waterReflectDirection), uNightStrength);`,
      );
    s.fragmentShader = s.fragmentShader.replace(
      '#include <envmap_fragment>',
      `float viewGrazing=1.-clamp(abs(dot(normal,normalize(vViewPosition))),0.,1.);
float waterFresnel=mix(${canal ? '.12+.88*pow(viewGrazing,3.)' : '.22+.78*pow(viewGrazing,2.5)'},.03+.97*pow(viewGrazing,4.),uNightStrength);
float shoreFilm=${canal ? '1.' : 'mix(.32,1.,smoothstep(0.,.8,vWaterDepth))'};
float dayFilm=${canal ? 'mix(.48,.94,smoothstep(.10,.72,viewGrazing))' : '.93+.04*waterFresnel'};
float waterAlpha=mix(dayFilm,.18+.80*waterFresnel,uNightStrength)*shoreFilm;
float waterReflectWeight=clamp(waterFresnel/max(waterAlpha,.001),0.,1.);
float waterCloud=0.;
outgoingLight/=max(1.,max(max(outgoingLight.r,outgoingLight.g),outgoingLight.b)/.65);
${reflection}`,
    );
    s.fragmentShader = s.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
float realWaterShadow=getShadowMask();
float waterDay=1.-uNightStrength;
${
  canal
    ? `
float along=vWaterUv.y*2.-uReflectionTime*.18;
float stroke=sin(along*4.7+sin(vWaterUv.x*8.+along*.4)*.45);
float line=1.-smoothstep(.015,.04+fwidth(stroke)*1.2,abs(stroke));
float breakMask=smoothstep(.35,.75,sin(along*.71+vWaterUv.x*13.))*smoothstep(.25,.65,sin(vWaterUv.x*18.-along*.3));
float bankSoft=1.-smoothstep(.76,1.,abs(vWaterUv.x*2.-1.));
float nearDetail=1.-smoothstep(15.,40.,distance(vReflectionWorld,cameraPosition));
outgoingLight+=vec3(.15,.19,.21)*line*breakMask*bankSoft*realWaterShadow*waterDay*nearDetail;
`
    : `
float windBand=sin(vReflectionWorld.x*.9+vReflectionWorld.z*1.4-uReflectionTime*.3);
float glimmer=pow(max(0.,windBand),28.)*smoothstep(.72,.94,sin(vReflectionWorld.z*.63-vReflectionWorld.x*.5));
outgoingLight+=vec3(.045,.06,.055)*glimmer*realWaterShadow*waterDay*vWaterDepth;
`
}
diffuseColor.a*=waterAlpha;
#include <opaque_fragment>`,
    );
    // Calibrate the displayed pigment after tone mapping, before output color conversion.
    // Keep white cloud shapes local while the body of the water stays blue in sunlight.
    s.fragmentShader = s.fragmentShader.replace(
      '#include <tonemapping_fragment>',
      `#include <tonemapping_fragment>
vec3 clearDayWater=mix(${canal ? 'vec3(.012,.045,.085),vec3(.105,.39,.53)' : 'vec3(.04,.13,.25),vec3(.13,.39,.68)'},smoothstep(.10,.85,realWaterShadow));
float cloudAccent=waterCloud*${canal ? '.10' : '.34'}*(.45+.55*realWaterShadow);
clearDayWater=mix(clearDayWater,vec3(.79,.84,.85),cloudAccent);
gl_FragColor.rgb=mix(gl_FragColor.rgb,clearDayWater,${canal ? '.94' : '.90'}*waterDay);`,
    );
  };
  material.customProgramCacheKey = () =>
    canal ? 'azure-painted-canal-day-night-fish-v6' : 'sky-blue-painted-paddy-day-night-v5';
  material.needsUpdate = true;
}
