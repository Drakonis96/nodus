import { SEMVER, SLUG, exactKeys, plainText } from './json';
import { validateLocalizedText, type LocalizedText } from './localized';
import type { PluginTarget } from './manifest';

/** `catalog-v2.json`: what a source publishes about its capability packages.
 *
 *  Deliberately small. It is a directory, not a distribution channel: it names each
 *  package and where its signed release lives, and nothing in it is trusted until that
 *  release's signature has been verified. */

export interface CatalogPluginEntry {
  id: string;
  name: string;
  description: LocalizedText;
  version: string;
  /** Directory in the source repository holding the package's source and manifests. */
  path: string;
  /** Built-in skill ids this package takes over, so a v1 listing can be hidden. */
  replaces: string[];
  targets: PluginTarget[];
  release: { tag: string; manifest: string; signature: string; assets: Array<{ target: PluginTarget; asset: string; bytes: number }> };
}

export interface CapabilityCatalogV2 {
  schemaVersion: 2;
  updatedAt: string;
  plugins: CatalogPluginEntry[];
}

const TARGET = /^(?:any|(?:darwin|win32|linux)-(?:x64|arm64))$/;
const ASSET = /^[a-z0-9][a-z0-9._-]{0,120}\.(?:nodus-plugin|json|sig)$/;
const TAG = /^[a-z0-9][a-z0-9._/-]{0,80}$/;

export function validateCapabilityCatalog(input: unknown): CapabilityCatalogV2 {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !exactKeys(input, ['schemaVersion', 'updatedAt', 'plugins'])) throw new Error('Invalid catalog-v2.json.');
  const value = input as CapabilityCatalogV2;
  if (value.schemaVersion !== 2 || typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))
    || !Array.isArray(value.plugins) || value.plugins.length > 200) throw new Error('Invalid catalog-v2.json.');

  const ids = new Set<string>();
  const plugins = value.plugins.map(entry => {
    if (!entry || !exactKeys(entry, ['id', 'name', 'description', 'version', 'path', 'replaces', 'targets', 'release'])
      || !SLUG.test(entry.id) || ids.has(entry.id) || !plainText(entry.name, 80) || !SEMVER.test(entry.version)
      || entry.path !== `plugins/${entry.id}`
      || !Array.isArray(entry.replaces) || entry.replaces.length > 8 || entry.replaces.some(id => !/^[a-z0-9-]{1,64}$/.test(String(id)))
      || !Array.isArray(entry.targets) || !entry.targets.length || entry.targets.length > 8 || entry.targets.some(target => !TARGET.test(String(target)))
      || !entry.release || !exactKeys(entry.release, ['tag', 'manifest', 'signature', 'assets'])
      || !TAG.test(String(entry.release.tag)) || !ASSET.test(String(entry.release.manifest)) || !ASSET.test(String(entry.release.signature))
      || !Array.isArray(entry.release.assets) || !entry.release.assets.length) throw new Error(`Invalid catalog entry: ${String(entry?.id)}`);
    const targets = new Set<string>();
    for (const asset of entry.release.assets) {
      if (!asset || !exactKeys(asset, ['target', 'asset', 'bytes']) || !TARGET.test(String(asset.target)) || targets.has(asset.target)
        || !ASSET.test(String(asset.asset)) || !asset.asset.endsWith('.nodus-plugin')
        || !Number.isInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 512 * 1024 * 1024) throw new Error(`Invalid catalog asset for ${entry.id}.`);
      targets.add(asset.target);
    }
    if (entry.targets.some(target => !targets.has(target))) throw new Error(`${entry.id} declares a target with no published asset.`);
    ids.add(entry.id);
    return { ...structuredClone(entry), description: validateLocalizedText(entry.description, 500) };
  });
  return { schemaVersion: 2, updatedAt: value.updatedAt, plugins };
}

/** The built-in skill ids a catalog says are superseded, so a v1 listing of the same
 *  thing can be hidden from a build that can install the package instead. */
export const catalogReplacedSkills = (catalog: CapabilityCatalogV2): Set<string> =>
  new Set(catalog.plugins.flatMap(entry => entry.replaces));
