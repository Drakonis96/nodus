import { assertSkillCapabilitiesSupported, unsupportedSkillCapabilities, validateManifest, validateSkillPackage, skillSlug, type SkillPackage } from '@shared/skillMarketplace';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_CHAT_SKILLS, builtinSkillForPackage, type ChatSkill, type ChatSkillSurface } from '@shared/chatSkills';

const file = () => path.join(app.getPath('userData'), 'chat-skills.json');
const LIBRARY_VERSION = 12;
const LEGACY_CHEMISTRY_V8_SHA256 = '876f9cf3d84a695540625bc79865b5f1d9026f6e577dbbbfd78a970e5552db94';
const LEGACY_CHEMISTRY_V7_SHA256 = '752f1a771d090e09a2ac564421e563167fc89b858d9167eba50eb2327ce1c5ef';
const LEGACY_CHEMISTRY_V6_SHA256 = '2fcb5625341467d5724b42ef1ac37d2429eb48779237e0593f7f75a605f00d5c';
const LEGACY_CHEMISTRY_V5_SHA256 = '52585c98d17188a731ce06b5df8a34f914f63d68ef779fe8212cbe92db77b506';
const LEGACY_CHEMISTRY_V4_SHA256 = '44b5250ff95674024902f363f3f7964645564774bbfbbeb7073597a8d583b147';
/** Run before first-launch database/preferences initialization. Older profiles without
 * an explicit library retain the previously implicit Chemistry activation. */
export function initializeChatSkillDefaults(): void {
  if (fs.existsSync(file())) return;
  const olderProfile = ['app-prefs.json', 'vaults.json', 'nodus.sqlite'].some(name => fs.existsSync(path.join(app.getPath('userData'), name)));
  const defaults = structuredClone(DEFAULT_CHAT_SKILLS);
  if (olderProfile) { const chemistry = defaults.find(s => s.builtin === 'chemistry')!; chemistry.enabled = { assistant: true, nodi: true }; }
  write(defaults);
}
export function listChatSkills(): ChatSkill[] {
  if (!fs.existsSync(file())) return write(structuredClone(DEFAULT_CHAT_SKILLS));
  let parsed: { version?: number; skills?: ChatSkill[] };
  try { parsed = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { throw new Error('The skills library could not be read.'); }
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, LIBRARY_VERSION].includes(parsed.version ?? 0) || !Array.isArray(parsed.skills)) throw new Error('The skills library could not be read.');
  if (parsed.version! < LIBRARY_VERSION) {
    // Each release adds only newly introduced defaults. Never restore a skill
    // deleted in an earlier version or overwrite its edited instructions/flags.
    const latestChemistry = DEFAULT_CHAT_SKILLS.find(skill => skill.builtin === 'chemistry');
    const renamed = parsed.skills.map(skill => skill.builtin === 'genomics'
      ? { ...skill, name: skill.name === 'Genomics Studio' ? 'AlphaGenome' : skill.name,
        instructions: skill.instructions.replaceAll('Genomics Studio', 'AlphaGenome') }
      : skill);
    const existing = renamed.map(skill => skill.builtin === 'chemistry'
      && ((parsed.version === 4 && createHash('sha256').update(skill.instructions).digest('hex') === LEGACY_CHEMISTRY_V4_SHA256)
        || (parsed.version === 5 && createHash('sha256').update(skill.instructions).digest('hex') === LEGACY_CHEMISTRY_V5_SHA256)
        || (parsed.version === 6 && createHash('sha256').update(skill.instructions).digest('hex') === LEGACY_CHEMISTRY_V6_SHA256)
        || (parsed.version === 7 && createHash('sha256').update(skill.instructions).digest('hex') === LEGACY_CHEMISTRY_V7_SHA256)
        || (parsed.version === 8 && createHash('sha256').update(skill.instructions).digest('hex') === LEGACY_CHEMISTRY_V8_SHA256))
      && latestChemistry
      ? { ...skill, instructions: latestChemistry.instructions }
      : skill);
    const additions = DEFAULT_CHAT_SKILLS.filter(skill =>
      ((parsed.version! < 2 && skill.builtin === 'socratic')
        || (parsed.version! < 3 && skill.builtin === 'general')
        || (parsed.version! < 4 && skill.builtin === 'chemistry')
        || (parsed.version! < 10 && skill.builtin === 'genomics')
        || (parsed.version! < 12 && skill.builtin === 'legal'))
      && !existing.some(item => item.id === skill.id));
    return write([...existing, ...structuredClone(additions).map(skill => skill.builtin === 'chemistry'
      ? { ...skill, enabled: { assistant: true, nodi: true } } : skill)]);
  }
  for (const skill of parsed.skills) if (!fs.existsSync(path.join(skillDirectory(skill.id), 'skill.json'))) writeSkillDirectory(skill);
  return parsed.skills;
}
function write(skills: ChatSkill[]): ChatSkill[] {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  for (const skill of skills) writeSkillDirectory(skill);
  fs.writeFileSync(`${file()}.tmp`, JSON.stringify({ version: LIBRARY_VERSION, skills }, null, 2), { mode: 0o600 });
  fs.renameSync(`${file()}.tmp`, file());
  return skills;
}
export function enabledChatSkills(surface: ChatSkillSurface): ChatSkill[] {
  return listChatSkills().filter(skill => skill.enabled[surface] && !unsupportedSkillCapabilities(skill.capabilities ?? []).length);
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
    ...(existing?.builtin ? { builtin: existing.builtin } : {}),
  };
  if (!skill.name || !skill.description || !skill.instructions) throw new Error('Add a name, description and instructions.');
  assertSkillCapabilitiesSupported(skill.capabilities ?? []);
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
  // Reinstalling one already present restores its shipped instructions and activation in place.
  if (skills.some(skill => skill.id === preset.id)) return write(skills.map(skill => skill.id === preset.id ? restored : skill));
  // Otherwise return the skill to its shipped position instead of the end of the library.
  const order = DEFAULT_CHAT_SKILLS.map(skill => skill.id);
  const next = skills.findIndex(skill => order.includes(skill.id) && order.indexOf(skill.id) > order.indexOf(preset.id));
  return write(next === -1 ? [...skills, restored] : [...skills.slice(0, next), restored, ...skills.slice(next)]);
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
