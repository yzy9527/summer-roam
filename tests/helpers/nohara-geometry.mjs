import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { ASSETS } from '../../src/assets-manifest.js';

export async function loadNoharaActor(id) {
  globalThis.ProgressEvent ??= class {
    constructor(type, values) {
      Object.assign(this, values);
    }
  };
  const bytes = await readFile(new URL(`../../src/assets/${ASSETS[id]}`, import.meta.url));
  const size = bytes.readUInt32LE(12),
    json = JSON.parse(bytes.subarray(20, 20 + size));
  json.buffers[0].uri =
    'data:application/octet-stream;base64,' + bytes.subarray(28 + size).toString('base64');
  for (const material of json.materials ?? []) {
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
    if (material.pbrMetallicRoughness) {
      delete material.pbrMetallicRoughness.baseColorTexture;
      delete material.pbrMetallicRoughness.metallicRoughnessTexture;
    }
  }
  delete json.images;
  delete json.textures;
  delete json.samplers;
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), '');
  const source = gltf.scene,
    object = new THREE.Group();
  source.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(source, true),
    center = box.getCenter(new THREE.Vector3());
  source.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  object.add(source);
  object.position.set(-40.99, 0, 200.85);
  const collider = {
    x: object.position.x,
    z: object.position.z,
    radius: 0.3,
    height: box.max.y - box.min.y,
    character: id,
  };
  object.updateMatrixWorld(true);
  return { source, object, collider, clips: gltf.animations };
}
