import { createHash } from 'node:crypto';
import type { PluginAsset } from '../packages/capability-api/src/pluginAssets';
import { validatePluginAssets } from '../packages/capability-api/src/pluginAssets';
import { validateModelAsset } from '../packages/capability-api/src/models';

export function verifyPluginAsset(text: string, asset: PluginAsset): void {
  validatePluginAssets([asset]);
  const bytes = Buffer.from(text, asset.mimeType === 'model/gltf-binary' ? 'base64' : 'utf8');
  if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Plugin asset SHA-256 mismatch. Reinstall the verified package.');
  if (asset.mimeType.startsWith('model/')) validateModelAsset(bytes, asset.mimeType);
  else JSON.parse(text);
}

/** Select named nodes from an immutable scene. Geometry and extras remain source data.
 * Parents are kept to preserve transforms and grouping; nothing is re-positioned or inferred.
 * Skins/animations require dependency rewriting and are refused by this minimal subset path. */
export function selectPackagedModel(input: { text: string; asset: PluginAsset }, ids: string[]): Buffer {
  verifyPluginAsset(input.text, input.asset);
  if (!input.asset.mimeType.startsWith('model/')) throw new Error('The declared asset is not a model.');
  const binaryInput = input.asset.mimeType === 'model/gltf-binary';
  const original = binaryInput ? Buffer.from(input.text, 'base64') : null;
  const jsonLength = original?.readUInt32LE(12) ?? 0;
  const gltf = JSON.parse(original ? original.subarray(20, 20 + jsonLength).toString('utf8') : input.text);
  const binaryTail = original?.subarray(20 + jsonLength);
  if (gltf.skins?.length || gltf.animations?.length) throw new Error('Animated or skinned packaged subsets are unsupported.');
  if (!Array.isArray(gltf.nodes) || !Array.isArray(gltf.scenes)) throw new Error('Model has no scene graph.');
  const names = new Map<string, number>();
  for (const [i, node] of gltf.nodes.entries()) {
    const id = node.extras?.id;
    if (typeof id === 'string') {
      if (names.has(id)) throw new Error('Ambiguous model node identity.');
      names.set(id, i);
    }
  }
  const selected = new Set(ids.map(id => {
    const index = names.get(id);
    if (index === undefined) throw new Error('Requested model node is unavailable: ' + id);
    return index;
  }));
  const scene = gltf.scenes[gltf.scene ?? 0];
  if (!scene || !Array.isArray(scene.nodes)) throw new Error('Model has no active scene.');
  const visiting = new Set<number>(), reached = new Set<number>();
  const keep = (index: number, inherited = false): boolean => {
    if (!Number.isInteger(index) || !gltf.nodes[index] || visiting.has(index)) throw new Error('Invalid or cyclic model scene.');
    visiting.add(index); reached.add(index);
    const node = gltf.nodes[index], chosen = inherited || selected.has(index);
    const children = (node.children ?? []).filter((child: number) => keep(child, chosen));
    visiting.delete(index);
    if (children.length) node.children = children;
    else delete node.children;
    if (!chosen) delete node.mesh;
    return chosen || children.length > 0;
  };
  scene.nodes = scene.nodes.filter((index: number) => keep(index));
  if ([...selected].some(index => !reached.has(index))) throw new Error('Requested model node is outside the active scene.');
  // Other scenes must not re-expose unselected structures through a viewer scene switch.
  gltf.scenes = [scene]; gltf.scene = 0;
  // Keep only reachable nodes, remapping indices without touching stable extras identities.
  // glTF forbids empty children arrays; omitted branches must not leave invalid placeholders.
  const retained = new Set<number>();
  const visit = (index: number) => { retained.add(index); for (const child of gltf.nodes[index].children ?? []) visit(child); };
  scene.nodes.forEach(visit);
  const ordered = [...retained].sort((a, b) => a - b);
  const remap = new Map(ordered.map((index, next) => [index, next]));
  gltf.nodes = ordered.map(index => {
    const node = gltf.nodes[index];
    if (node.children) node.children = node.children.map((child: number) => remap.get(child));
    return node;
  });
  scene.nodes = scene.nodes.map((index: number) => remap.get(index));
  const json = Buffer.from(JSON.stringify(gltf));
  let bytes = json;
  if (binaryInput) {
    const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20); json.copy(padded);
    bytes = Buffer.alloc(20 + padded.length + binaryTail!.length);
    bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
    bytes.writeUInt32LE(padded.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16);
    padded.copy(bytes, 20); binaryTail!.copy(bytes, 20 + padded.length);
  }
  validateModelAsset(bytes, input.asset.mimeType);
  return bytes;
}
