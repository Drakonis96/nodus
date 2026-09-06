import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CHAT_SKILLS, type ChatSkill, type ChatSkillSurface } from '@shared/chatSkills';

const file = () => path.join(app.getPath('userData'), 'chat-skills.json');
const LIBRARY_VERSION = 3;
export function listChatSkills(): ChatSkill[] {
  if (!fs.existsSync(file())) return structuredClone(DEFAULT_CHAT_SKILLS);
  let parsed: { version?: number; skills?: ChatSkill[] };
  try { parsed = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { throw new Error('The skills library could not be read.'); }
  if (![1, 2, LIBRARY_VERSION].includes(parsed.version ?? 0) || !Array.isArray(parsed.skills)) throw new Error('The skills library could not be read.');
  if (parsed.version! < LIBRARY_VERSION) {
    // Each release adds only newly introduced defaults. Never restore a skill
    // deleted in an earlier version or overwrite its edited instructions/flags.
    const additions = DEFAULT_CHAT_SKILLS.filter(skill =>
      ((parsed.version! < 2 && skill.builtin === 'socratic') || (parsed.version! < 3 && skill.builtin === 'general'))
      && !parsed.skills!.some(existing => existing.id === skill.id));
    return write([...parsed.skills, ...structuredClone(additions)]);
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
