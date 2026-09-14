import { LIMITS } from './limits';

/** What `nodus:3d` accepts, and what it refuses.
 *
 *  A capability hands over an asset; the core stores it, validates it and renders it.
 *  Nothing about a discipline is here — a molecule, a bone, a pot and a building are all
 *  the same thing to this file — and nothing about rendering is either. This is the
 *  format check, shared by the application, the marketplace CI and the packages
 *  themselves, so a model that would fail on a user's machine fails at review instead.
 *
 *  The rule that matters is self-containment. glTF can reference external buffers,
 *  images and shaders by URI, which on a viewer that honoured them would mean a document
 *  fetching whatever it liked from wherever it liked, the moment someone opened an old
 *  conversation. So an asset is accepted only when everything it needs is inside it:
 *  a binary `.glb`, or a `.gltf` whose every URI is an inline `data:`. */

export const MODEL_MIME_TYPES = {
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
} as const;

export type ModelFormat = keyof typeof MODEL_MIME_TYPES;

export interface ModelAssetInfo {
  format: ModelFormat;
  bytes: number;
  /** glTF asset version, as the file declares it. Only 2.x is rendered. */
  version: string;
  meshes: number;
  nodes: number;
  /** True when the file carries its own buffers and images rather than URIs. */
  selfContained: true;
}

const GLB_MAGIC = 0x46546c67; // 'glTF', little-endian
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const CHUNK_BIN = 0x004e4942; // 'BIN\0'

const isDataUri = (value: unknown) => typeof value === 'string' && /^data:[a-z0-9.+-]+\/[a-z0-9.+-]+[;,]/i.test(value);

/** Every place glTF 2.0 may put a URI. A buffer with no URI lives in the GLB's binary
 *  chunk; an image with no URI points at a buffer view. Both are self-contained. */
function assertNoExternalReferences(gltf: Record<string, unknown>): void {
  for (const collection of ['buffers', 'images']) {
    const entries = gltf[collection];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) throw new Error(`Invalid 3D model ${collection}.`);
    for (const entry of entries) {
      const uri = (entry as { uri?: unknown })?.uri;
      if (uri === undefined) continue;
      if (!isDataUri(uri)) throw new Error('A 3D model may not reference anything outside itself.');
    }
  }
}

function summarize(gltf: Record<string, unknown>, format: ModelFormat, bytes: number): ModelAssetInfo {
  const asset = gltf.asset as { version?: unknown } | undefined;
  const version = typeof asset?.version === 'string' ? asset.version : '';
  if (!/^2\.\d+$/.test(version)) throw new Error('Only glTF 2.0 models are supported.');

  const count = (key: string) => (Array.isArray(gltf[key]) ? (gltf[key] as unknown[]).length : 0);
  const nodes = count('nodes');
  const meshes = count('meshes');
  if (nodes > LIMITS.modelNodes) throw new Error('The 3D model has more nodes than the viewer will open.');
  if (!meshes) throw new Error('The 3D model contains nothing to draw.');

  // Extensions a viewer must understand to show the file at all. Anything it merely may
  // understand is fine; anything required and unknown would render as silent nonsense.
  const required = gltf.extensionsRequired;
  if (required !== undefined) {
    if (!Array.isArray(required)) throw new Error('Invalid 3D model extensions.');
    const unsupported = required.filter(name => !SUPPORTED_EXTENSIONS.includes(String(name)));
    if (unsupported.length) throw new Error(`The 3D model requires an extension the viewer does not implement: ${unsupported.slice(0, 3).join(', ')}.`);
  }

  assertNoExternalReferences(gltf);
  return { format, bytes, version, meshes, nodes, selfContained: true };
}

/** What the bundled viewer can actually draw. Kept short on purpose: a required
 *  extension that is merely listed here and not implemented is worse than a refusal. */
export const SUPPORTED_EXTENSIONS: readonly string[] = [
  'KHR_materials_unlit',
  'KHR_texture_transform',
  'KHR_materials_emissive_strength',
];

/** Reads a `.glb`'s chunk table without a parser: header, then JSON, then binary. */
function readGlb(bytes: Uint8Array): Record<string, unknown> {
  if (bytes.byteLength < 20) throw new Error('The 3D model is not a readable GLB file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('The 3D model is not a readable GLB file.');
  if (view.getUint32(4, true) !== 2) throw new Error('Only glTF 2.0 models are supported.');
  const declared = view.getUint32(8, true);
  if (declared !== bytes.byteLength) throw new Error('The 3D model declares a length it does not have.');

  let offset = 12;
  let json: Record<string, unknown> | undefined;
  let sawBinary = false;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (length > bytes.byteLength - start) throw new Error('The 3D model has a chunk that runs past its end.');
    if (type === CHUNK_JSON) {
      if (json) throw new Error('The 3D model has more than one JSON chunk.');
      if (length > LIMITS.modelJsonBytes) throw new Error('The 3D model description is too large.');
      try { json = JSON.parse(new TextDecoder().decode(bytes.subarray(start, start + length))) as Record<string, unknown>; }
      catch { throw new Error('The 3D model has an unreadable description.'); }
    } else if (type === CHUNK_BIN) {
      if (sawBinary) throw new Error('The 3D model has more than one binary chunk.');
      sawBinary = true;
    }
    // Unknown chunk types are skipped, which is what the specification asks for.
    offset = start + length + (length % 4 === 0 ? 0 : 4 - (length % 4));
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('The 3D model has no description.');
  return json;
}

/** The one check. Accepts the bytes a capability wants stored and says what they are, or
 *  refuses them with a reason a person can act on. */
export function validateModelAsset(input: unknown, mimeType: string): ModelAssetInfo {
  const bytes = input instanceof Uint8Array ? input : null;
  if (!bytes) throw new Error('A 3D model must be handed over as bytes.');
  if (!bytes.byteLength) throw new Error('The 3D model is empty.');
  if (bytes.byteLength > LIMITS.modelBytes) throw new Error(`A 3D model may not exceed ${Math.round(LIMITS.modelBytes / (1024 * 1024))} MB.`);

  if (mimeType === MODEL_MIME_TYPES.glb) return summarize(readGlb(bytes), 'glb', bytes.byteLength);

  if (mimeType === MODEL_MIME_TYPES.gltf) {
    if (bytes.byteLength > LIMITS.modelJsonBytes) throw new Error('The 3D model description is too large.');
    let json: Record<string, unknown>;
    try { json = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>; }
    catch { throw new Error('The 3D model has an unreadable description.'); }
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('The 3D model has no description.');
    return summarize(json, 'gltf', bytes.byteLength);
  }

  throw new Error(`A 3D model must be ${MODEL_MIME_TYPES.glb} or ${MODEL_MIME_TYPES.gltf}.`);
}

export const isModelMimeType = (value: unknown): value is typeof MODEL_MIME_TYPES[ModelFormat] =>
  value === MODEL_MIME_TYPES.glb || value === MODEL_MIME_TYPES.gltf;
