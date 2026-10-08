import assert from 'node:assert/strict';
import { MeshoptEncoder } from 'meshoptimizer/encoder';
import { MeshoptDecoder } from 'meshoptimizer/decoder';

export const MODEL_ENCODING_VERSION = 'meshopt-lossless-v1';
const extension = 'EXT_meshopt_compression';
const align = (size) => Math.ceil(size / 4) * 4;

export function readGLB(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'Expected GLB');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const length = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a);
  assert.equal(bytes.readUInt32LE(24 + length), 0x004e4942);
  assert.equal(28 + length + bytes.readUInt32LE(20 + length), bytes.length);
  return {
    json: JSON.parse(bytes.subarray(20, 20 + length).toString()),
    binary: bytes.subarray(28 + length),
  };
}

function writeGLB(json, binary) {
  const sentinel = '__GLB_NEGATIVE_ZERO__';
  assert.ok(!JSON.stringify(json).includes(sentinel));
  const text = Buffer.from(
    JSON.stringify(json, (_key, value) => (Object.is(value, -0) ? sentinel : value)).replaceAll(
      `"${sentinel}"`,
      '-0',
    ),
  );
  const jsonLength = align(text.length),
    binLength = align(binary.length);
  const result = Buffer.alloc(28 + jsonLength + binLength);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonLength, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  result.fill(0x20, 20, 20 + jsonLength);
  text.copy(result, 20);
  result.writeUInt32LE(binLength, 20 + jsonLength);
  result.writeUInt32LE(0x004e4942, 24 + jsonLength);
  binary.copy(result, 28 + jsonLength);
  return result;
}

// Encode buffer views without quantizing, reordering, or rewriting any accessor,
// skin, morph, animation, material or embedded image. Source GLBs stay untouched.
export async function compressGLB(bytes) {
  await MeshoptEncoder.ready;
  const { json, binary } = readGLB(bytes);
  assert.equal(json.buffers.length, 1, 'Only self-contained GLBs are published');
  assert.equal(json.buffers[0].uri, undefined);
  assert.ok(!json.extensionsUsed?.includes(extension), 'Source is already compressed');
  const images = new Set((json.images ?? []).map((image) => image.bufferView));
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  const widths = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const chunks = [];
  let offset = 0,
    compressed = 0;
  for (const [index, view] of json.bufferViews.entries()) {
    const data = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const accessors = (json.accessors ?? []).filter((accessor) => accessor.bufferView === index);
    const size =
      view.byteStride ??
      (accessors.length === 1
        ? components[accessors[0].type] * widths[accessors[0].componentType]
        : 4);
    const indices = view.target === 34963 && accessors.length === 1 && [2, 4].includes(size);
    const stride = indices ? size : size % 4 === 0 && size <= 256 ? size : 4;
    const canEncode = !images.has(index) && data.length >= 256 && data.length % stride === 0;
    const mode = indices ? 'INDICES' : 'ATTRIBUTES';
    const encoded = canEncode
      ? Buffer.from(MeshoptEncoder.encodeGltfBuffer(data, data.length / stride, stride, mode))
      : data;
    if (canEncode && encoded.length + 128 < data.length) {
      view.buffer = 1;
      view.extensions = {
        ...view.extensions,
        [extension]: {
          buffer: 0,
          byteOffset: offset,
          byteLength: encoded.length,
          byteStride: stride,
          count: data.length / stride,
          mode,
          filter: 'NONE',
        },
      };
      compressed++;
    } else {
      view.buffer = 0;
      view.byteOffset = offset;
    }
    const chunk = canEncode && view.buffer === 1 ? encoded : data;
    chunks.push(chunk, Buffer.alloc(align(chunk.length) - chunk.length));
    offset += align(chunk.length);
  }
  if (!compressed) return bytes;
  json.buffers = [
    { ...json.buffers[0], byteLength: offset },
    { byteLength: json.buffers[0].byteLength, extensions: { [extension]: { fallback: true } } },
  ];
  json.extensionsUsed = [...(json.extensionsUsed ?? []), extension];
  json.extensionsRequired = [...(json.extensionsRequired ?? []), extension];
  const result = writeGLB(json, Buffer.concat(chunks));
  return result.length < bytes.length ? result : bytes;
}

// Check every decoded byte, including indices, weights, inverse bind matrices,
// sparse/morph buffers and images, plus all non-storage JSON metadata.
export async function verifyGLBEquivalence(source, published) {
  if (source.equals(published)) return;
  await MeshoptDecoder.ready;
  const original = readGLB(source),
    release = readGLB(published);
  assert.equal(release.json.bufferViews.length, original.json.bufferViews.length);
  for (const [index, view] of release.json.bufferViews.entries()) {
    const encoding = view.extensions?.[extension];
    let decoded;
    if (encoding) {
      decoded = Buffer.alloc(encoding.count * encoding.byteStride);
      MeshoptDecoder.decodeGltfBuffer(
        decoded,
        encoding.count,
        encoding.byteStride,
        release.binary.subarray(encoding.byteOffset, encoding.byteOffset + encoding.byteLength),
        encoding.mode,
        encoding.filter,
      );
    } else
      decoded = release.binary.subarray(
        view.byteOffset ?? 0,
        (view.byteOffset ?? 0) + view.byteLength,
      );
    const before = original.json.bufferViews[index];
    assert.deepEqual(
      decoded,
      original.binary.subarray(
        before.byteOffset ?? 0,
        (before.byteOffset ?? 0) + before.byteLength,
      ),
      `Buffer view ${index} changed`,
    );
  }
  const normalized = structuredClone(release.json);
  assert.deepEqual(release.json.buffers[1], {
    byteLength: original.json.buffers[0].byteLength,
    extensions: { [extension]: { fallback: true } },
  });
  normalized.buffers = [
    { ...release.json.buffers[0], byteLength: original.json.buffers[0].byteLength },
  ];
  for (const [index, view] of normalized.bufferViews.entries()) {
    const before = original.json.bufferViews[index];
    view.buffer = before.buffer;
    if (before.byteOffset === undefined) delete view.byteOffset;
    else view.byteOffset = before.byteOffset;
    if (view.extensions) {
      delete view.extensions[extension];
      if (!before.extensions) delete view.extensions;
    }
  }
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    normalized[key] = normalized[key]?.filter((name) => name !== extension);
    if (!original.json[key]) delete normalized[key];
  }
  assert.deepEqual(normalized, original.json, 'Model metadata changed');
}
