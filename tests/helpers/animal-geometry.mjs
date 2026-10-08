import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Only textures are stripped: geometry, skins, skeletons and morphs are genuine.
export function loadAnimalGeometry(id) {
  return loadGLBGeometry(
    new URL(`../../src/assets/models/${id}/${id}-rigged.glb`, import.meta.url),
  );
}

export async function loadGLBGeometry(url) {
  globalThis.ProgressEvent ??= class {
    constructor(type, values) {
      Object.assign(this, values);
    }
  };
  const bytes = await readFile(url);
  const length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length));
  json.buffers[0].uri =
    'data:application/octet-stream;base64,' + bytes.subarray(28 + length).toString('base64');
  for (const m of json.materials) {
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
  }
  delete json.images;
  delete json.textures;
  delete json.samplers;
  return (await new GLTFLoader().parseAsync(JSON.stringify(json), '')).scene;
}
