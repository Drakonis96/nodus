import { assertSkillCapabilitiesSupported, officialSkillSourceId, validateManifest, validateSkillPackage, skillSlug, type SkillPackage } from '@shared/skillMarketplace';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_CHAT_SKILLS, builtinSkillForPackage, type ChatSkill, type ChatSkillSurface } from '@shared/chatSkills';
import { normalizeCapabilityId } from '../skill-capabilities/contracts';
import { capabilityRegistry } from './capabilities/registry';
import { readTrustedPluginSkills } from './capabilities/bundledSkills';
import { resolveInstalledCapability } from './skillPlugins';
import { resolvePluginCapabilityReference, type ValidatedPluginPackage } from '../skill-capabilities/pluginPackage';
import {
  approvePendingPlugin,
  installPluginPackage,
  installedCapabilityAvailable,
  pluginPackageDigest,
  readActivePluginPackage,
  readPluginDirectory,
  readPluginState,
  removePlugin as removeInstalledPlugin,
  rollbackPlugin,
  type PluginInstallOptions,
} from './skillPlugins';

const file = () => path.join(app.getPath('userData'), 'chat-skills.json');
const originFile = () => path.join(app.getPath('userData'), 'profile-migrations', 'library-origin.json');
const LIBRARY_VERSION = 16;
const LEGACY_SVG_V12_SHA256 = '8a8629caa2db26ab2d86ad7b2ee3daae72bd4156d198a8da01b639218c328570';
/** Whether this profile was in use before the skills library existed, written down once,
 *  before any default is created.
 *
 *  It has to be recorded rather than inferred later: the moment defaults are written there
 *  is a `chat-skills.json` on disk, and from then on a profile that predates the library
 *  is indistinguishable from one that never had a skill in it. The capability migration
 *  reads this to decide whether chemistry was on by the behaviour of the time — so getting
 *  it from the file's existence would mean either never honouring a real prior state, or
 *  installing a package into a clean install nobody asked for. */
function noteLibraryOrigin(): void {
  if (fs.existsSync(originFile())) return;
  const userData = app.getPath('userData');
  const hadLibrary = fs.existsSync(file());
  // A profile with a database or preferences but no library is one from before the
  // library. A profile with neither is a clean install and carries no prior state at all.
  const preLibraryProfile = !hadLibrary
    && ['app-prefs.json', 'vaults.json', 'nodus.sqlite'].some(name => fs.existsSync(path.join(userData, name)));
  fs.mkdirSync(path.dirname(originFile()), { recursive: true, mode: 0o700 });
  fs.writeFileSync(originFile(), JSON.stringify({ schemaVersion: 1, hadLibrary, preLibraryProfile, recordedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
}

/** True when this profile was already in use before skills had a library, so an implicit
 *  activation of the time is a real prior state rather than an absence. */
export function profilePredatesSkillLibrary(): boolean {
  try {
    const value = JSON.parse(fs.readFileSync(originFile(), 'utf8')) as { preLibraryProfile?: boolean };
    return value.preLibraryProfile === true;
  } catch {
    // No marker means nothing wrote one yet, which only happens before the first library
    // is created. Recording it now is what keeps the answer stable from here on.
    noteLibraryOrigin();
    try { return (JSON.parse(fs.readFileSync(originFile(), 'utf8')) as { preLibraryProfile?: boolean }).preLibraryProfile === true; }
    catch { return false; }
  }
}

/** Run before first-launch database/preferences initialization. Older profiles without
 * an explicit library retain the previously implicit Chemistry activation. */
export function initializeChatSkillDefaults(): void {
  noteLibraryOrigin();
  if (fs.existsSync(file())) return;
  write(structuredClone(DEFAULT_CHAT_SKILLS));
}
export function listChatSkills(): ChatSkill[] {
  if (!fs.existsSync(file())) { noteLibraryOrigin(); return write(structuredClone(DEFAULT_CHAT_SKILLS)); }
  let parsed: { version?: number; skills?: ChatSkill[] };
  try { parsed = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { throw new Error('The skills library could not be read.'); }
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, LIBRARY_VERSION].includes(parsed.version ?? 0) || !Array.isArray(parsed.skills)) throw new Error('The skills library could not be read.');
  if (parsed.version! < LIBRARY_VERSION) {
    // Each release adds only newly introduced defaults. Never restore a skill
    // deleted in an earlier version or overwrite its edited instructions/flags.
    const latestSvg = DEFAULT_CHAT_SKILLS.find(skill => skill.builtin === 'svg');
    // The three disciplines left the application in 5.3.2. Their skills stay in an old
    // profile exactly as they were — the capability migration is what adopts them — so
    // nothing here refreshes their text or restores them as defaults.
    const existing = parsed.skills.map(skill => {
      const builtin = skill.builtin as string | undefined;
      const digest = typeof skill.instructions === 'string' ? createHash('sha256').update(skill.instructions).digest('hex') : '';
      let updated = skill;
      if (builtin === 'svg' && digest === LEGACY_SVG_V12_SHA256 && latestSvg) {
        updated = { ...skill, instructions: latestSvg.instructions, version: latestSvg.version };
      }
      if (builtin === 'genomics' && skill.name === 'Genomics Studio') {
        updated = { ...updated, name: 'AlphaGenome', instructions: updated.instructions.replaceAll('Genomics Studio', 'AlphaGenome') };
      }
      // The capability declaration is what the migration reads to decide whether a
      // profile still depends on a discipline, so it is normalized even as it leaves.
      return builtin && ['svg', 'image', 'chemistry', 'genomics', 'legal'].includes(builtin)
        ? { ...updated, capabilities: [`nodus:${builtin}`] }
        : updated;
    });
    const additions = DEFAULT_CHAT_SKILLS.filter(skill =>
      ((parsed.version! < 2 && skill.builtin === 'socratic')
        || (parsed.version! < 3 && skill.builtin === 'general'))
      && !existing.some(item => item.id === skill.id));
    return write([...existing, ...structuredClone(additions)]);
  }
  for (const skill of parsed.skills) if (!fs.existsSync(path.join(skillDirectory(skill.id), 'skill.json'))) writeSkillDirectory(skill);
  return parsed.skills;
}
/** Replaces the whole library at once. Capability migration and signed package installation use this: every
 *  other change goes through the functions that reason about one skill at a time. */
export function replaceChatSkills(skills: ChatSkill[]): ChatSkill[] { return write(skills); }

function write(skills: ChatSkill[]): ChatSkill[] {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  for (const skill of skills) writeSkillDirectory(skill);
  fs.writeFileSync(`${file()}.tmp`, JSON.stringify({ version: LIBRARY_VERSION, skills }, null, 2), { mode: 0o600 });
  fs.renameSync(`${file()}.tmp`, file());
  return skills;
}
/** The tools a skill can actually reach, read from whatever provides its capabilities
 *  right now. Persisting this list let an update or an uninstall leave a skill advertising
 *  tools that no longer existed. */
export function deriveCapabilityTools(skill: ChatSkill): ChatSkill['capabilityTools'] {
  const snapshot = capabilityRegistry();
  const tools = (skill.capabilities ?? []).flatMap(reference => {
    const capabilityId = normalizeCapabilityId(reference);
    const provider = snapshot.providers.get(capabilityId);
    if (provider?.tools.length) {
      return provider.tools.map(tool => ({ capabilityId, toolId: tool.id, description: tool.description, inputSchema: tool.inputSchema, resultKinds: [] as string[] }));
    }
    const runtime = capabilityId.startsWith('nodus:') ? null : resolveInstalledCapability(capabilityId, skill.plugin ? { version: skill.plugin.version, digest: skill.plugin.digest } : undefined);
    return (runtime?.manifest.tools ?? []).map(tool => ({ capabilityId, toolId: tool.id, description: tool.description, inputSchema: tool.inputSchema, resultKinds: tool.resultKinds as string[] }));
  });
  return tools.length ? tools : undefined;
}

export function enabledChatSkills(surface: ChatSkillSurface): ChatSkill[] {
  return listChatSkills()
    .filter(skill => skill.enabled[surface]
      && (skill.capabilities ?? []).every(capability => installedCapabilityAvailable(normalizeCapabilityId(capability))))
    .map(skill => { const capabilityTools = deriveCapabilityTools(skill); return capabilityTools ? { ...skill, capabilityTools } : { ...skill, capabilityTools: undefined }; });
}
export function saveChatSkill(input: ChatSkill): ChatSkill[] {
  const skills = listChatSkills();
  const existing = skills.find(skill => skill.id === input.id);
  const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\0/g, '').trim().slice(0, max) : '';
  const skill: ChatSkill = {
    id: existing?.id ?? randomUUID(),
    name: clean(input.name, 80), description: clean(input.description, 500), instructions: clean(input.instructions, 16000),
    enabled: { assistant: input.enabled?.assistant === true, nodi: input.enabled?.nodi === true },
    capabilities: input.capabilities ?? existing?.capabilities ?? (existing?.builtin && ['svg', 'image', 'chemistry'].includes(existing.builtin) ? [existing.builtin as 'svg' | 'image' | 'chemistry'] : []), tools: input.tools ?? existing?.tools ?? [],
    author: input.author ?? existing?.author ?? 'local', category: input.category ?? existing?.category ?? 'Personal',
    version: input.version ?? existing?.version ?? '1.0.0', license: input.license ?? existing?.license ?? 'AGPL-3.0-only',
    ...(existing?.origin ? { origin: existing.origin } : {}),
    ...(existing?.plugin ? { plugin: existing.plugin, capabilityTools: existing.capabilityTools,
      overrides: { name: clean(input.name, 80), description: clean(input.description, 500), instructions: clean(input.instructions, 16000) } } : {}),
    ...(existing?.builtin ? { builtin: existing.builtin } : {}),
  };
  if (!skill.name || !skill.description || !skill.instructions) throw new Error('Add a name, description and instructions.');
  if (!existing?.plugin) assertSkillCapabilitiesSupported(skill.capabilities ?? []);
  chatSkillPackage(skill); // Validate capability declarations and authoring metadata before persisting.
  return write(existing ? skills.map(item => item.id === skill.id ? skill : item) : [...skills, skill]);
}
export function deleteChatSkill(id: string): ChatSkill[] {
  const skills = listChatSkills();
  const result = write(skills.filter(skill => skill.id !== id));
  if (skills.some(s => s.id === id)) fs.rmSync(skillDirectory(id), { recursive: true, force: true });
  return result;
}
/** Reinstall a single built-in published by the official catalog. The bundled definition is
 * restored, never repository text, so the skill returns exactly as this build ships it — including
 * capabilities that no downloaded package may declare — and the rest of the library is untouched. */
export function installBuiltinChatSkill(packageId: string): ChatSkill[] {
  const preset = builtinSkillForPackage(packageId);
  if (!preset) throw new Error('This package is not a built-in Nodus skill.');
  const skills = listChatSkills(), restored = structuredClone(preset);
  // Earlier builds let the official catalog install a downloaded copy of a skill Nodus already
  // includes. Consolidate that duplicate here instead of leaving two equivalent skills behind.
  const legacy = skills.filter(skill => skill.id !== preset.id && skill.origin?.sourceId === officialSkillSourceId() && skill.origin.packageId === packageId);
  const library = skills.filter(skill => !legacy.includes(skill));
  // Reinstalling one already present restores its shipped instructions and activation in place;
  // otherwise the skill returns to its shipped position instead of the end of the library.
  const order = DEFAULT_CHAT_SKILLS.map(skill => skill.id);
  const next = library.findIndex(skill => order.includes(skill.id) && order.indexOf(skill.id) > order.indexOf(preset.id));
  const result = write(library.some(skill => skill.id === preset.id) ? library.map(skill => skill.id === preset.id ? restored : skill)
    : next === -1 ? [...library, restored] : [...library.slice(0, next), restored, ...library.slice(next)]);
  for (const skill of legacy) fs.rmSync(skillDirectory(skill.id), { recursive: true, force: true });
  return result;
}
export function restoreChatSkills(): ChatSkill[] {
  const skills = listChatSkills();
  // Explicit restore affects only built-ins; custom skills survive.
  return write([...structuredClone(DEFAULT_CHAT_SKILLS), ...skills.filter(skill => !skill.builtin)]);
}

function skillDirectory(id: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid skill id.');
  return path.join(app.getPath('userData'), 'skills', id);
}
export function chatSkillPackage(skill: ChatSkill): SkillPackage {
  const tools = skill.tools ?? [];
  const capabilities = skill.capabilities ?? (['svg', 'image', 'chemistry'].includes(skill.builtin ?? '') ? [skill.builtin as 'svg' | 'image' | 'chemistry'] : []);
  return validateSkillPackage({ manifest: {
    schemaVersion: 1, id: skill.origin?.packageId ?? skillSlug(skill.name), name: skill.name,
    description: skill.description, author: skill.author ?? 'NodusResearch', category: skill.category ?? 'General',
    version: skill.version ?? '1.0.0', license: skill.license ?? 'AGPL-3.0-only', instructions: 'SKILL.md', capabilities,
    tools: tools.map(t => ({ id: t.id, description: t.description, entry: `tools/${t.id}.js`, runtime: 'javascript-sandbox' })),
  }, files: Object.fromEntries([['SKILL.md', skill.instructions], ...tools.map(t => [`tools/${t.id}.js`, t.source])]) });
}
function writeSkillDirectory(skill: ChatSkill) {
  const pkg = chatSkillPackage(skill), directory = skillDirectory(skill.id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'skill.json'), JSON.stringify(pkg.manifest, null, 2), { mode: 0o600 });
  // Only this generated directory is owned by the library; discard obsolete tool files.
  fs.rmSync(path.join(directory, 'tools'), { recursive: true, force: true });
  for (const [file, source] of Object.entries(pkg.files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), source, { mode: 0o600 });
  }
}
export function installChatSkillPackage(input: SkillPackage, origin?: ChatSkill['origin']): ChatSkill[] {
  const pkg = validateSkillPackage(input), m = pkg.manifest, skills = listChatSkills();
  assertSkillCapabilitiesSupported(m.capabilities);
  const existing = origin ? skills.find(s => s.origin?.sourceId === origin.sourceId && s.origin?.packageId === m.id) : undefined;
  const skill: ChatSkill = {
    id: existing?.id ?? randomUUID(), name: m.name, description: m.description, instructions: pkg.files['SKILL.md'],
    author: m.author, category: m.category, version: m.version, license: m.license, capabilities: m.capabilities,
    tools: m.tools.map(t => ({ id: t.id, description: t.description, source: pkg.files[t.entry] })),
    enabled: { assistant: false, nodi: false }, ...(origin ? { origin } : {}),
  };
  return write(existing ? skills.map(s => s.id === existing.id ? skill : s) : [...skills, skill]);
}
export function importSkillDirectory(directory: string) {
  if (fs.existsSync(path.join(directory, 'plugin.json'))) return installChatPluginDirectory(directory, { sourceId: 'local', sourcePath: directory, approvePermissions: true, autoUpdate: false });
  const read = (file: string) => {
    const target = path.join(directory, file), stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256000 || !fs.realpathSync(target).startsWith(fs.realpathSync(directory) + path.sep)) throw new Error('Invalid package file.');
    return fs.readFileSync(target, 'utf8');
  };
  const manifest = JSON.parse(read('skill.json'));
  // Validate paths before opening any files declared by the package.
  const checked = validateManifest(manifest);
  return installChatSkillPackage({ manifest: checked, files: Object.fromEntries(['SKILL.md', ...checked.tools.map(t => t.entry)].map(file => [file, read(file)])) });
}

function pluginSkillBase(pkg: ValidatedPluginPackage, packageId: string) {
  return pkg.skills.find(item => item.package.manifest.id === packageId)?.package;
}

function materializePluginSkills(pkg: ValidatedPluginPackage, options: PluginInstallOptions, previous?: ValidatedPluginPackage): ChatSkill[] {
  const installed = listChatSkills();
  const ids = new Set(pkg.skills.map(item => item.package.manifest.id));
  const retained = installed.filter(skill => skill.plugin?.id !== pkg.manifest.id || ids.has(skill.origin?.packageId ?? ''));
  for (const item of pkg.skills) {
    const m = item.package.manifest;
    const existing = retained.find(skill => skill.plugin?.id === pkg.manifest.id && skill.origin?.packageId === m.id);
    const previousBase = previous && pluginSkillBase(previous, m.id);
    const inferred = existing && previousBase ? {
      ...(existing.name !== previousBase.manifest.name ? { name: existing.name } : {}),
      ...(existing.description !== previousBase.manifest.description ? { description: existing.description } : {}),
      ...(existing.instructions !== previousBase.files['SKILL.md'] ? { instructions: existing.instructions } : {}),
    } : {};
    const overlay = { ...inferred, ...(existing?.overrides ?? {}) };
    const capabilities = m.capabilities.map(capability => resolvePluginCapabilityReference(pkg.manifest.id, capability));
    const capabilityTools = pkg.capabilities
      .filter(capability => capabilities.includes(`${pkg.manifest.id}:${capability.manifest.id}`))
      .flatMap(capability => capability.manifest.tools.map(tool => ({ capabilityId: `${pkg.manifest.id}:${capability.manifest.id}`, toolId: tool.id, description: tool.description, inputSchema: tool.inputSchema, resultKinds: tool.resultKinds })));
    const skill: ChatSkill = {
      id: existing?.id ?? randomUUID(), name: overlay.name ?? m.name, description: overlay.description ?? m.description,
      instructions: overlay.instructions ?? item.package.files['SKILL.md'], author: m.author, category: m.category,
      version: m.version, license: m.license, capabilities, capabilityTools,
      tools: m.tools.map(tool => ({ id: tool.id, description: tool.description, source: item.package.files[tool.entry] })),
      enabled: existing?.enabled ?? { assistant: false, nodi: false },
      origin: { sourceId: options.sourceId, path: options.sourcePath ?? pkg.manifest.id, commit: options.sourceCommit ?? pkg.manifest.version, packageId: m.id, version: m.version, digest: createHash('sha256').update(JSON.stringify(item.package)).digest('hex') },
      plugin: { id: pkg.manifest.id, version: pkg.manifest.version, digest: pluginPackageDigest(pkg) },
      ...(Object.keys(overlay).length ? { overrides: overlay } : {}),
    };
    const index = retained.findIndex(candidate => candidate.id === skill.id);
    if (index >= 0) retained[index] = skill; else retained.push(skill);
  }
  return write(retained);
}

export function installChatPluginPackage(pkg: ValidatedPluginPackage, options: PluginInstallOptions): ChatSkill[] {
  let previous: ValidatedPluginPackage | undefined;
  try { previous = readActivePluginPackage(pkg.manifest.id); } catch { /* first install */ }
  const outcome = installPluginPackage(pkg, options);
  return outcome.activated ? materializePluginSkills(outcome.package, options, previous) : listChatSkills();
}

export function installChatPluginDirectory(directory: string, options: PluginInstallOptions): ChatSkill[] {
  return installChatPluginPackage(readPluginDirectory(directory), options);
}

export function approvePendingChatPlugin(id: string): ChatSkill[] {
  let previous: ValidatedPluginPackage | undefined;
  try { previous = readActivePluginPackage(id); } catch { /* first install */ }
  const outcome = approvePendingPlugin(id);
  return outcome.activated ? materializePluginSkills(outcome.package, { sourceId: outcome.state.sourceId, sourcePath: outcome.state.sourcePath, sourceCommit: outcome.state.sourceCommit, approvePermissions: true, autoUpdate: outcome.state.autoUpdate }, previous) : listChatSkills();
}

export function rollbackChatPlugin(id: string): ChatSkill[] {
  rollbackPlugin(id);
  const statePackage = readActivePluginPackage(id);
  const state = readPluginState(id)!;
  return materializePluginSkills(statePackage, { sourceId: state.sourceId, sourcePath: state.sourcePath, sourceCommit: state.sourceCommit, approvePermissions: true }, undefined);
}

export function removeChatPlugin(id: string): ChatSkill[] {
  removeInstalledPlugin(id);
  return write(listChatSkills().filter(skill => skill.plugin?.id !== id));
}

export function restorePluginSkillAuthorVersion(id: string): ChatSkill[] {
  const skills = listChatSkills(), existing = skills.find(skill => skill.id === id);
  if (!existing?.plugin || !existing.origin?.packageId) throw new Error('This skill is not supplied by an installed plugin.');
  const trusted = readTrustedPluginSkills(existing.plugin.id);
  const base = trusted
    ? trusted.packaged.find(item => item.manifest.id === existing.origin!.packageId)
    : pluginSkillBase(readActivePluginPackage(existing.plugin.id), existing.origin.packageId);
  if (!base) throw new Error('The author version is no longer available.');
  return write(skills.map(skill => skill.id === id ? { ...skill, name: base.manifest.name, description: base.manifest.description, instructions: base.files['SKILL.md'], overrides: undefined } : skill));
}
export function exportSkillDirectory(id: string, parent: string): string {
  const skill = listChatSkills().find(s => s.id === id);
  if (!skill) throw new Error('Skill no longer exists.');
  const pkg = chatSkillPackage(skill), directory = path.join(parent, pkg.manifest.id);
  fs.mkdirSync(directory); // Never overwrite an existing author directory.
  fs.writeFileSync(path.join(directory, 'skill.json'), JSON.stringify(pkg.manifest, null, 2));
  for (const [file, source] of Object.entries(pkg.files)) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), source);
  }
  return directory;
}
