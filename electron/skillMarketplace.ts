import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_SKILL_SOURCE, isOfficialSkillSource, normalizeSkillSource, validateManifest, validateSkillPackage, type SkillMarketplace, type SkillPackage, type SkillSource } from '@shared/skillMarketplace';
import { BUILTIN_SKILL_PACKAGES } from '@shared/chatSkills';
import { installBuiltinChatSkill, installChatPluginPackage, installChatSkillPackage } from './chatSkills';
import { validateCapabilityManifest } from '../skill-capabilities/contracts';
import { verifyPluginAsset } from './pluginAssets';
import { validatePluginPackage } from '../skill-capabilities/pluginPackage';
const location = () => path.join(app.getPath('userData'), 'skill-marketplace.json');
export const packageDigest = (pkg: SkillPackage) => createHash('sha256').update(JSON.stringify(validateSkillPackage(pkg))).digest('hex');
export function getSkillMarketplace(): SkillMarketplace {
  if (!fs.existsSync(location())) {
    const source = normalizeSkillSource(DEFAULT_SKILL_SOURCE);
    return { version: 1, sources: [{ id: source.id, url: source.url, entries: [], errors: [] }] };
  }
  const state = JSON.parse(fs.readFileSync(location(), 'utf8')) as SkillMarketplace;
  if (state.version !== 1 || !Array.isArray(state.sources)) throw new Error('The marketplace library could not be read.');
  return state;
}
function write(state: SkillMarketplace) {
  fs.mkdirSync(path.dirname(location()), { recursive: true });
  fs.writeFileSync(`${location()}.tmp`, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(`${location()}.tmp`, location());
  return state;
}
export function addSkillSource(url: string) {
  const source = normalizeSkillSource(url), state = getSkillMarketplace();
  if (state.sources.some(s => s.id === source.id)) throw new Error('This repository is already added.');
  state.sources.push({ id: source.id, url: source.url, entries: [], errors: [] });
  return write(state);
}
export function removeSkillSource(id: string) {
  const state = getSkillMarketplace();
  state.sources = state.sources.filter(s => s.id !== id);
  return write(state);
}
class SkillSourceFetchError extends Error {}
/** Bound both streamed and declared size; refuse redirects and incomplete repository trees. */
async function request(url: string, fetcher: typeof fetch, limit: number, encoding: BufferEncoding = 'utf8'): Promise<string> {
  let response: Response;
  try { response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Nodus-Skill-Marketplace' } }); }
  catch { throw new SkillSourceFetchError('Could not reach GitHub. Check your connection and try again; the previous catalog is preserved.'); }
  if (!response.ok) throw new SkillSourceFetchError(`GitHub request failed (${response.status}). ${response.status === 403 || response.status === 429 ? 'Rate limit reached; try again later.' : ''}`);
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Repository response is too large.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty repository response.');
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { for (;;) { const next = await reader.read().catch(() => { throw new SkillSourceFetchError('GitHub download was interrupted. The previous catalog is preserved.'); }); if (next.done) break; bytes += next.value.length; if (bytes > limit) throw new Error('Repository response is too large.'); chunks.push(next.value); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString(encoding);
}
export async function scanSkillSource(source: SkillSource, fetcher: typeof fetch = fetch): Promise<SkillSource> {
  const { owner, repo } = normalizeSkillSource(source.url);
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const info = JSON.parse(await request(api, fetcher, 100000));
  const revision = JSON.parse(await request(`${api}/commits/${encodeURIComponent(info.default_branch)}`, fetcher, 1000000));
  const commit = revision.sha;
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid repository revision.');
  const tree = JSON.parse(await request(`${api}/git/trees/${commit}?recursive=1`, fetcher, 8000000));
  if (tree.truncated || !Array.isArray(tree.tree)) throw new Error('Repository tree is incomplete. Split this repository into smaller sources.');
  const blobs = new Map<string, { mode: string; size: number }>(tree.tree.filter((item: {type: string}) => item.type === 'blob').map((item: {path: string; mode: string; size: number}) => [item.path, item]));
  const pluginCandidates = [...blobs.keys()].filter(p => /^[a-z0-9]+(?:-[a-z0-9]+)*\/plugin\.json$/.test(p));
  const pluginDirectories = new Set(pluginCandidates.map(candidate => candidate.split('/')[0]));
  const candidates = [...blobs.keys()].filter(p => /^[a-z0-9]+(?:-[a-z0-9]+)*\/skill\.json$/.test(p) && !pluginDirectories.has(p.split('/')[0]));
  if (candidates.length + pluginCandidates.length > 500) throw new Error('A source can contain at most 500 packages.');
  const result: SkillSource = { id: source.id, url: source.url, commit, updatedAt: new Date().toISOString(), entries: [], plugins: [], errors: [] };
  let total = 0, assetTotal = 0;
  const read = async (file: string, limit: number, asset = false, encoding: BufferEncoding = 'utf8') => {
    const blob = blobs.get(file);
    if (!blob || blob.mode !== '100644' || blob.size > limit) throw new Error(`Missing, oversized or non-regular file: ${file}`);
    if (asset) assetTotal += blob.size; else total += blob.size;
    if (assetTotal > 128 * 1024 * 1024) throw new Error('Source assets exceed 128 MB.');
    if (total > 12000000) throw new Error('Source packages exceed 12 MB.');
    return request(`https://raw.githubusercontent.com/${owner}/${repo}/${commit}/${file}`, fetcher, limit, encoding);
  };
  for (const candidate of candidates) {
    const directory = candidate.split('/')[0];
    try {
      const manifest = validateManifest(JSON.parse(await read(candidate, 20000)));
      if (manifest.id !== directory) throw new Error('Directory name must match the manifest id.');
      const files: Record<string, string> = {};
      for (const file of ['SKILL.md', ...manifest.tools.map(t => t.entry)]) files[file] = await read(`${directory}/${file}`, file === 'SKILL.md' ? 64000 : 256000);
      result.entries.push({ path: directory, package: validateSkillPackage({ manifest, files }) });
    } catch (error) { if (error instanceof SkillSourceFetchError) throw error; result.errors.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  for (const candidate of pluginCandidates) {
    const directory = candidate.split('/')[0];
    try {
      const manifestSource = await read(candidate, 64_000), manifest = JSON.parse(manifestSource);
      if (manifest.id !== directory) throw new Error('Directory name must match the plugin id.');
      const files: Record<string, string> = { 'plugin.json': manifestSource };
      for (const skillPath of manifest.skills ?? []) {
        files[skillPath] = await read(`${directory}/${skillPath}`, 64_000);
        const skill = validateManifest(JSON.parse(files[skillPath]));
        const base = skillPath.slice(0, -'skill.json'.length);
        for (const file of ['SKILL.md', ...skill.tools.map(tool => tool.entry)]) files[base + file] = await read(`${directory}/${base}${file}`, file === 'SKILL.md' ? 64_000 : 256_000);
      }
      for (const capabilityPath of manifest.capabilities ?? []) {
        files[capabilityPath] = await read(`${directory}/${capabilityPath}`, 64_000);
        const capability = validateCapabilityManifest(JSON.parse(files[capabilityPath]));
        const base = capabilityPath.slice(0, -'capability.json'.length);
        files[base + capability.entry] = await read(`${directory}/${base}${capability.entry}`, 256_000);
        for (const asset of capability.assets ?? []) {
          const text = await read(`${directory}/${base}${asset.path}`, asset.bytes, true, asset.mimeType === 'model/gltf-binary' ? 'base64' : 'utf8');
          verifyPluginAsset(text, asset);
          files[base + asset.path] = text;
        }
      }
      const pkg = validatePluginPackage({ manifest, files });
      result.plugins!.push({ path: directory, package: { manifest: pkg.manifest, files: pkg.files } });
    } catch (error) { if (error instanceof SkillSourceFetchError) throw error; result.errors.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return result;
}
const updating = new Set<string>();
export async function updateSkillSource(id: string) {
  if (updating.has(id)) throw new Error('This source is already updating.');
  const source = getSkillMarketplace().sources.find(s => s.id === id);
  if (!source) throw new Error('Source no longer exists.');
  updating.add(id);
  try {
    const scanned = await scanSkillSource(source);
    const latest = getSkillMarketplace();
    if (!latest.sources.some(s => s.id === id)) throw new Error('Source was removed during update.');
    latest.sources = latest.sources.map(s => s.id === id ? scanned : s);
    return write(latest);
  } finally { updating.delete(id); }
}
export function installMarketplaceSkill(sourceId: string, packagePath: string, commit: string) {
  const source = getSkillMarketplace().sources.find(s => s.id === sourceId);
  const entry = source?.entries.find(e => e.path === packagePath);
  if (!entry || !source?.commit || source.commit !== commit) throw new Error('The catalog changed. Review the package again before installing.');
  // The official catalog lists this build's own built-ins. Restore the bundled skill rather than
  // adding a second, repository-tracked copy of something Nodus already includes.
  if (isOfficialSkillSource(source.url) && BUILTIN_SKILL_PACKAGES[entry.package.manifest.id]) return installBuiltinChatSkill(entry.package.manifest.id);
  return installChatSkillPackage(entry.package, { sourceId, path: packagePath, commit, packageId: entry.package.manifest.id, version: entry.package.manifest.version, digest: packageDigest(entry.package) });
}
export function installMarketplacePlugin(sourceId: string, packagePath: string, commit: string, approvePermissions = false) {
  const source = getSkillMarketplace().sources.find(item => item.id === sourceId);
  const entry = source?.plugins?.find(item => item.path === packagePath);
  if (!entry || !source?.commit || source.commit !== commit) throw new Error('The catalog changed. Review the plugin again before installing.');
  const pkg = validatePluginPackage(entry.package);
  return installChatPluginPackage(pkg, { sourceId, sourcePath: packagePath, sourceCommit: commit, approvePermissions, autoUpdate: source.url.toLowerCase() === DEFAULT_SKILL_SOURCE.toLowerCase() });
}
