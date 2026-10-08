import { readFile, mkdir, writeFile } from 'node:fs/promises';

// Keep the user's original GLBs intact. Only translate the obsolete material
// schema; the embedded geometry, weights, joints and texture bytes stay intact.
for (const [source, target] of [
  ['PvZ_Zombie.glb', 'pvz-conehead.glb'],
  ['PvZ_Zombie2.glb', 'pvz-browncoat.glb'],
  ['PvZ_Zombie_bg.glb', 'pvz-gargantuar.glb'],
]) {
  const bytes = await readFile(new URL(source, import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  for (const material of json.materials) {
    const legacy = material.extensions?.KHR_materials_pbrSpecularGlossiness;
    if (!legacy) continue;
    material.pbrMetallicRoughness = {
      baseColorFactor: legacy.diffuseFactor ?? [1, 1, 1, 1],
      metallicFactor: 0,
      roughnessFactor: 1 - (legacy.glossinessFactor ?? 1),
      ...(legacy.diffuseTexture ? { baseColorTexture: legacy.diffuseTexture } : {}),
    };
    delete material.extensions.KHR_materials_pbrSpecularGlossiness;
    if (!Object.keys(material.extensions).length) delete material.extensions;
  }
  for (const key of ['extensionsRequired', 'extensionsUsed']) {
    json[key] = (json[key] ?? []).filter((name) => name !== 'KHR_materials_pbrSpecularGlossiness');
    if (!json[key].length) delete json[key];
  }
  const text = Buffer.from(JSON.stringify(json));
  const chunk = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
  text.copy(chunk);
  const binary = bytes.subarray(20 + jsonLength);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + chunk.length + binary.length, 8);
  header.writeUInt32LE(chunk.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const output = new URL(`../../src/assets/models/pvz-zombies/${target}`, import.meta.url);
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, Buffer.concat([header, chunk, binary]));
  console.log(`${source} -> ${target}: original binary chunk preserved`);
}
