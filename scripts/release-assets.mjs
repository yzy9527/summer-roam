import { ASSETS } from '../src/assets-manifest.js';

// Registration is pure data; build tools never instantiate runtime modules.
export const releaseAssets = Object.values(ASSETS).map((path) => 'assets/' + path);
