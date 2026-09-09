import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DEFAULT_CHAT_SKILLS, type ChatSkill, type ChatSkillSurface } from '@shared/chatSkills';

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
  if (!fs.existsSync(file())) return structuredClone(DEFAULT_CHAT_SKILLS);
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
  return parsed.skills;
}
function write(skills: ChatSkill[]): ChatSkill[] {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(`${file()}.tmp`, JSON.stringify({ version: LIBRARY_VERSION, skills }, null, 2), { mode: 0o600 });
  fs.renameSync(`${file()}.tmp`, file());
  return skills;
}
export function enabledChatSkills(surface: ChatSkillSurface): ChatSkill[] {
  return listChatSkills().filter(skill => skill.enabled[surface]);
}
export function saveChatSkill(input: ChatSkill): ChatSkill[] {
  const skills = listChatSkills();
  const existing = skills.find(skill => skill.id === input.id);
  const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\0/g, '').trim().slice(0, max) : '';
  const skill: ChatSkill = {
    id: existing?.id ?? randomUUID(),
    name: clean(input.name, 80), description: clean(input.description, 500), instructions: clean(input.instructions, 16000),
    enabled: { assistant: input.enabled?.assistant === true, nodi: input.enabled?.nodi === true },
    ...(existing?.builtin ? { builtin: existing.builtin } : {}),
  };
  if (!skill.name || !skill.description || !skill.instructions) throw new Error('Add a name, description and instructions.');
  if (!existing && skills.length >= 40) throw new Error('The library supports up to 40 skills.');
  return write(existing ? skills.map(item => item.id === skill.id ? skill : item) : [...skills, skill]);
}
export function deleteChatSkill(id: string): ChatSkill[] { return write(listChatSkills().filter(skill => skill.id !== id)); }
export function restoreChatSkills(): ChatSkill[] {
  const skills = listChatSkills();
  // Explicit restore affects only built-ins; custom skills survive.
  return write([...structuredClone(DEFAULT_CHAT_SKILLS), ...skills.filter(skill => !skill.builtin)]);
}
