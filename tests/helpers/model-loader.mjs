import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// Substitute Node's absent image decoder; retain actual skins, geometry, morphs and clips.
export async function loadGLTF(url) {
  const bytes = await readFile(url);
  const loader = new GLTFLoader();
  loader.register((parser) => {
    parser.loadTexture = async () => new THREE.Texture();
    return { name: 'NodeTextures' };
  });
  return loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    '',
  );
}
export function modelURL(path) {
  if (path === 'models/zombie-wood-cart.glb')
    return new URL('../../assets-source/zombie-wood-cart/zombie-wood-cart.glb', import.meta.url);
  return new URL('../../src/assets/' + path, import.meta.url);
}
export async function loadModel(path) {
  return (await loadGLTF(modelURL(path))).scene;
}
