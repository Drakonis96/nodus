import { exactKeys, plainText, SLUG } from './json';

/** Immutable JSON/glTF/GLB data shipped with a v1 sandbox capability. No runtime paths or URLs. */
export interface PluginAsset {
  id: string;
  path: string;
  mimeType: 'application/json' | 'model/gltf+json' | 'model/gltf-binary';
  bytes: number;
  sha256: string;
}
export function validatePluginAssets(input: unknown): asserts input is PluginAsset[] | undefined {
  if (input === undefined) return;
  if (!Array.isArray(input) || input.length > 64) throw new Error('Invalid plugin assets.');
  const ids = new Set(), paths = new Set();
  let total = 0;
  for (const asset of input) {
    if (!asset || !exactKeys(asset, ['id', 'path', 'mimeType', 'bytes', 'sha256'])
      || typeof asset.id !== 'string' || !SLUG.test(asset.id) || ids.has(asset.id)
      || typeof asset.path !== 'string' || !/^assets\/[a-z0-9]+(?:-[a-z0-9]+)*\.(json|gltf|glb)$/.test(asset.path) || paths.has(asset.path)
      || !['application/json', 'model/gltf+json', 'model/gltf-binary'].includes(asset.mimeType)
      || (asset.mimeType === 'model/gltf+json') !== asset.path.endsWith('.gltf')
      || (asset.mimeType === 'model/gltf-binary') !== asset.path.endsWith('.glb')
      || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > (asset.mimeType === 'model/gltf-binary' ? 64 * 1024 * 1024 : asset.mimeType === 'application/json' ? 2_000_000 : 16 * 1024 * 1024)
      || typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid plugin asset declaration.');
    ids.add(asset.id); paths.add(asset.path); total += asset.bytes;
  }
  if (total > 128 * 1024 * 1024) throw new Error('Plugin assets exceed 128 MB.');
}

export function validatePackagedModelResult(input: unknown): void {
  const result = input as { kind: string; panels: Array<{ assetId: string; nodeIds: string[]; title: string; alt: string }>; metadata: unknown };
  if (!result || !exactKeys(result, ['kind', 'panels', 'metadata']) || result.kind !== 'model'
    || !Array.isArray(result.panels) || !result.panels.length || result.panels.length > 12
    || JSON.stringify(result).length > 256_000) throw new Error('Invalid packaged model result.');
  for (const panel of result.panels) {
    if (!panel || !exactKeys(panel, ['assetId', 'nodeIds', 'title', 'alt']) || typeof panel.assetId !== 'string' || !SLUG.test(panel.assetId)
      || !plainText(panel.title, 160) || !plainText(panel.alt, 4_000)
      || !Array.isArray(panel.nodeIds) || !panel.nodeIds.length || panel.nodeIds.length > 2_000
      || panel.nodeIds.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(id))
      || new Set(panel.nodeIds).size !== panel.nodeIds.length) throw new Error('Invalid packaged model panel.');
  }
}
