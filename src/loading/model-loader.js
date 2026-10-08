import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { assetUrl } from '../asset-url.js';
import { createResourceQueue } from './resource-queue.js';

let downloads;
const queue = () => (downloads ??= createResourceQueue());
export function prefetchModels(ids) {
  for (const id of ids)
    void queue()
      .load(assetUrl(id))
      .catch(() => {});
}

export function createModelLoader({ resources = queue(), baseURL = () => document.baseURI } = {}) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // Keep GLTFLoader's public API and independently parsed scenes. In-flight and
  // prefetched bytes are consumed once and released after parsing, including errors.
  loader.load = (url, onLoad, _onProgress, onError = console.error) => {
    const download = resources.load(url);
    download
      .then(async (bytes) => {
        try {
          const path = new URL('.', new URL(url, baseURL())).href;
          onLoad(await loader.parseAsync(bytes, path));
        } finally {
          resources.release(url, download);
        }
      })
      .catch(onError);
  };
  return loader;
}

export function yieldSceneWork() {
  return typeof document === 'undefined'
    ? Promise.resolve()
    : new Promise((resolve) => setTimeout(resolve, 0));
}
