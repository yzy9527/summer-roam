import { readFile, writeFile } from 'node:fs/promises';

function decode(bytes) {
  const end = 20 + bytes.readUInt32LE(12);
  return { json: JSON.parse(bytes.subarray(20, end)), bin: bytes.subarray(end + 8) };
}
const base = decode(
  await readFile(new URL('../../src/assets/models/pvz-zombies/pvz-browncoat.glb', import.meta.url)),
);
const flag = decode(await readFile(new URL('flag-zombie-original.glb', import.meta.url)));
const json = base.json;
const chunks = [base.bin];
let length = base.bin.length;
const views = new Map();
function view(index) {
  if (views.has(index)) return views.get(index);
  const source = flag.json.bufferViews[index];
  const bytes = flag.bin.subarray(
    source.byteOffset ?? 0,
    (source.byteOffset ?? 0) + source.byteLength,
  );
  const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
  bytes.copy(padded);
  const target = json.bufferViews.length;
  json.bufferViews.push({ ...source, buffer: 0, byteOffset: length });
  chunks.push(padded);
  length += padded.length;
  views.set(index, target);
  return target;
}
function accessor(index) {
  const source = flag.json.accessors[index];
  const target = json.accessors.length;
  json.accessors.push({ ...source, bufferView: view(source.bufferView) });
  return target;
}
function texture(index) {
  const source = flag.json.textures[index];
  const image = flag.json.images[source.source];
  const imageIndex = json.images.length;
  json.images.push({ ...image, bufferView: view(image.bufferView) });
  const target = json.textures.length;
  const sampler = source.sampler === undefined ? undefined : json.samplers.length;
  if (sampler !== undefined) json.samplers.push(flag.json.samplers[source.sampler]);
  json.textures.push({
    ...source,
    source: imageIndex,
    ...(sampler === undefined ? {} : { sampler }),
  });
  return target;
}
const meshIndex = flag.json.meshes.findIndex((m) => m.name.includes('CHAR_FLAG_ZOMBIE'));
const original = flag.json.meshes[meshIndex];
const node = flag.json.nodes.find((n) => n.mesh === meshIndex);
const material = structuredClone(flag.json.materials[original.primitives[0].material]);
const legacy = material.extensions.KHR_materials_pbrSpecularGlossiness;
material.pbrMetallicRoughness = {
  baseColorFactor: legacy.diffuseFactor,
  baseColorTexture: { index: texture(legacy.diffuseTexture.index) },
  metallicFactor: 0,
  roughnessFactor: 1 - legacy.glossinessFactor,
};
material.normalTexture.index = texture(material.normalTexture.index);
delete material.extensions;
const materialIndex = json.materials.length;
json.materials.push(material);
const mesh = json.meshes.length;
json.meshes.push({
  ...original,
  primitives: original.primitives.map((p) => ({
    ...p,
    material: materialIndex,
    indices: accessor(p.indices),
    attributes: Object.fromEntries(
      Object.entries(p.attributes).map(([key, index]) => [key, accessor(index)]),
    ),
  })),
});
// Reuse the ordinary zombie's joints but preserve the flag's inverse binds:
// unused prop joints in the body skin contain placeholder inverse matrices.
const semantic = (name) => name.replace(/_0\d+$/, '');
const joints = new Map(
  json.skins[0].joints.map((index) => [semantic(json.nodes[index].name), index]),
);
const sourceSkin = flag.json.skins[node.skin];
const skin = json.skins.length;
json.skins.push({
  joints: sourceSkin.joints.map((index) => {
    const joint = joints.get(semantic(flag.json.nodes[index].name));
    if (joint === undefined) throw new Error('Missing flag joint');
    return joint;
  }),
  skeleton: json.skins[0].skeleton,
  inverseBindMatrices: accessor(sourceSkin.inverseBindMatrices),
});
const nodeIndex = json.nodes.length;
json.nodes.push({ ...node, name: 'Flag with original cloth skin', mesh, skin });
const baseMeshNode = json.nodes.findIndex((n) => n.mesh === 0);
json.nodes.find((n) => n.children?.includes(baseMeshNode)).children.push(nodeIndex);
json.buffers = [{ byteLength: length }];
json.asset.extras = { ...json.asset.extras, flagSource: flag.json.asset.extras };
const text = Buffer.from(JSON.stringify(json));
const jsonChunk = Buffer.alloc(Math.ceil(text.length / 4) * 4, 0x20);
text.copy(jsonChunk);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonChunk.length + length, 8);
header.writeUInt32LE(jsonChunk.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(length, 0);
binHeader.writeUInt32LE(0x004e4942, 4);
await writeFile(
  new URL('../../src/assets/models/pvz-zombies/pvz-flagbearer.glb', import.meta.url),
  Buffer.concat([header, jsonChunk, binHeader, ...chunks]),
);
console.log('Ordinary zombie retained; original flag mesh, textures and inverse binds extracted.');
