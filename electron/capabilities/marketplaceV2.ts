import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeSkillSource } from '@shared/skillMarketplace';
import { resolvePluginTarget } from '../../packages/capability-api/src/manifest';
import { validateCapabilityCatalog, type CapabilityCatalogV2, type CatalogPluginEntry } from '../../packages/capability-api/src/catalog';
import { installVerifiedPlugin, type InstallOutcome } from './pluginStoreV2';
import { rebuildCapabilityRegistry } from './registry';

/** Reading a source's `catalog-v2.json` and installing from the signed release it names.
 *
 *  Nothing the catalog says is trusted. It is a directory: it tells Nodus which tag to
 *  look at, and the signature on that release is what decides whether anything is
 *  installed. A catalog that lies about a version, a size or an asset simply fails
 *  verification. */

const CATALOG_LIMIT = 4 * 1024 * 1024;
const MANIFEST_LIMIT = 256 * 1024;
const SIGNATURE_LIMIT = 4 * 1024;
const ASSET_LIMIT = 512 * 1024 * 1024;

const cachePath = () => path.join(app.getPath('userData'), 'capability-catalog.json');

export interface CachedCatalog { sourceId: string; url: string; commit: string; fetchedAt: string; catalog: CapabilityCatalogV2 }

async function download(url: string, limit: number, fetcher: typeof fetch): Promise<Buffer> {
  let response: Response;
  try { response = await fetcher(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000), headers: { 'User-Agent': 'Nodus-Capability-Marketplace' } }); }
  catch { throw new Error('Could not reach the package source. Check your connection and try again.'); }
  if (!response.ok) throw new Error(`The package source returned ${response.status}.`);
  if (Number(response.headers.get('content-length') ?? 0) > limit) throw new Error('The download is larger than allowed.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response from the package source.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > limit) throw new Error('The download is larger than allowed.');
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks);
}

export async function fetchCapabilityCatalog(sourceUrl: string, fetcher: typeof fetch = fetch): Promise<CachedCatalog> {
  const { id, url, owner, repo } = normalizeSkillSource(sourceUrl);
  const info = JSON.parse((await download(`https://api.github.com/repos/${owner}/${repo}`, 100_000, fetcher)).toString('utf8'));
  const revision = JSON.parse((await download(`https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(info.default_branch)}`, 1_000_000, fetcher)).toString('utf8'));
  const commit = String(revision.sha);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid repository revision.');
  const raw = await download(`https://raw.githubusercontent.com/${owner}/${repo}/${commit}/catalog-v2.json`, CATALOG_LIMIT, fetcher);
  const catalog = validateCapabilityCatalog(JSON.parse(raw.toString('utf8')));
  const cached: CachedCatalog = { sourceId: id, url, commit, fetchedAt: new Date().toISOString(), catalog };
  const target = cachePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(cached), { mode: 0o600 });
  fs.renameSync(`${target}.tmp`, target);
  return cached;
}

export function readCachedCatalog(): CachedCatalog | null {
  try {
    const value = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as CachedCatalog;
    return { ...value, catalog: validateCapabilityCatalog(value.catalog) };
  } catch { return null; }
}

const releaseAsset = (owner: string, repo: string, tag: string, asset: string) =>
  `https://github.com/${owner}/${repo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;

/** Installs one catalogued package for this platform, verifying the release signature
 *  before a byte of it is opened. */
export async function installCatalogPlugin(
  pluginId: string,
  options: { approvePermissions?: boolean; fetcher?: typeof fetch } = {},
): Promise<InstallOutcome> {
  const cached = readCachedCatalog();
  if (!cached) throw new Error('Refresh the package catalog before installing.');
  const entry = cached.catalog.plugins.find(candidate => candidate.id === pluginId);
  if (!entry) throw new Error('That package is not in the catalog.');
  const outcome = await installCatalogEntry(entry, cached, options);
  rebuildCapabilityRegistry();
  return outcome;
}

export async function installCatalogEntry(
  entry: CatalogPluginEntry,
  cached: CachedCatalog,
  options: { approvePermissions?: boolean; fetcher?: typeof fetch } = {},
): Promise<InstallOutcome> {
  const fetcher = options.fetcher ?? fetch;
  const { owner, repo } = normalizeSkillSource(cached.url);
  const target = resolvePluginTarget(entry.targets, process.platform, process.arch);
  if (!target) throw new Error(`${entry.name} does not publish a package for ${process.platform}-${process.arch}.`);
  const asset = entry.release.assets.find(candidate => candidate.target === target);
  if (!asset) throw new Error(`${entry.name} has no published asset for ${target}.`);

  const releaseManifestBytes = await download(releaseAsset(owner, repo, entry.release.tag, entry.release.manifest), MANIFEST_LIMIT, fetcher);
  const signature = await download(releaseAsset(owner, repo, entry.release.tag, entry.release.signature), SIGNATURE_LIMIT, fetcher);
  // The catalog's size is only a download bound; the signed manifest is what the bytes
  // are actually checked against.
  const archive = await download(releaseAsset(owner, repo, entry.release.tag, asset.asset), Math.min(asset.bytes, ASSET_LIMIT), fetcher);

  return installVerifiedPlugin(
    { archive, releaseManifestBytes, signature, source: { id: cached.sourceId, path: entry.path, commit: cached.commit } },
    { approvePermissions: options.approvePermissions },
  );
}
