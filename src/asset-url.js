import { ASSETS } from './assets-manifest.js';

// Vite defines only this explicit prefix; it never rewrites arbitrary source strings.
const prefix =
  typeof __RUNTIME_ASSET_PREFIX__ === 'string' ? __RUNTIME_ASSET_PREFIX__ : './assets/';
export function assetUrl(id, base = prefix) {
  if (!Object.hasOwn(ASSETS, id)) throw new Error(`Unregistered asset: ${id}`);
  return base + ASSETS[id];
}
