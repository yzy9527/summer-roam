import { readFile, writeFile } from 'node:fs/promises';
const source = new URL('../crayon_shin-chan_nohara_house.glb', import.meta.url);
const target = new URL(
  '../../src/assets/models/crayon_shin-chan_nohara_house.glb',
  import.meta.url,
);
const data = await readFile(source),
  jsonLength = data.readUInt32LE(12);
const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString());
// Three's current GLTFLoader no longer reads the legacy specular/glossiness extension.
// Retain diffuse colours, texture coordinates and transparency; approximate glossiness as roughness.
for (const material of gltf.materials) {
  const old = material.extensions?.KHR_materials_pbrSpecularGlossiness;
  if (!old) continue;
  material.pbrMetallicRoughness = {
    baseColorFactor: old.diffuseFactor ?? [1, 1, 1, 1],
    metallicFactor: 0,
    roughnessFactor: 1 - (old.glossinessFactor ?? 1),
  };
  if (old.diffuseTexture) material.pbrMetallicRoughness.baseColorTexture = old.diffuseTexture;
  delete material.extensions.KHR_materials_pbrSpecularGlossiness;
  if (!Object.keys(material.extensions).length) delete material.extensions;
}
for (const key of ['extensionsUsed', 'extensionsRequired'])
  if (gltf[key]) {
    gltf[key] = gltf[key].filter((e) => e !== 'KHR_materials_pbrSpecularGlossiness');
    if (!gltf[key].length) delete gltf[key];
  }
const raw = Buffer.from(JSON.stringify(gltf)),
  json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32);
raw.copy(json);
const rest = data.subarray(20 + jsonLength),
  header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(20 + json.length + rest.length, 8);
header.writeUInt32LE(json.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
await writeFile(target, Buffer.concat([header, json, rest]));
console.log(
  `Converted ${gltf.materials.length} materials; original geometry and embedded images retained.`,
);
