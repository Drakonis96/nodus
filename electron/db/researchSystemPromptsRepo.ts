import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import { RESEARCH_PROMPT_NAME_LIMIT, RESEARCH_PROMPT_TEXT_LIMIT, type ResearchSystemPrompt, type ResearchSystemPromptInput, type ResearchSystemPromptState } from '@shared/researchSystemPrompts';
const KEY = 'researchSystemPrompts.v1';
interface Store { version: 1; prompts: ResearchSystemPrompt[]; selections: Record<string, string> }
function read(): Store {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as { value: string } | undefined;
  return row ? JSON.parse(row.value) as Store : { version: 1, prompts: [], selections: {} };
}
function write(store: Store) {
  getDb().prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(KEY, JSON.stringify(store));
}
function conversationKey(key: string) {
  if (typeof key !== 'string' || !/^(research|database|study|world):[^\s]{1,160}$/.test(key)) throw new Error('Conversación de Research chat no válida.');
  return key;
}
export function getResearchSystemPrompts(key?: string | null): ResearchSystemPromptState {
  const store = read();
  return { prompts: [...store.prompts].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || a.id.localeCompare(b.id)), selectedId: key ? store.selections[conversationKey(key)] ?? null : null };
}
export function resolveResearchSystemPrompt(id?: string | null): ResearchSystemPrompt | null {
  if (!id) return null;
  const prompt = read().prompts.find(item => item.id === id);
  if (!prompt) throw new Error('El prompt seleccionado ya no existe. Elige otro o usa Default.');
  return prompt;
}
export function saveResearchSystemPrompt(input: ResearchSystemPromptInput): ResearchSystemPrompt {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const instructions = typeof input?.instructions === 'string' ? input.instructions.trim() : '';
  if (!name || name.length > RESEARCH_PROMPT_NAME_LIMIT || name.toLowerCase() === 'default') throw new Error('Elige un nombre de 1 a 80 caracteres distinto de Default.');
  if (!instructions || instructions.length > RESEARCH_PROMPT_TEXT_LIMIT) throw new Error('Escribe instrucciones de 1 a 12.000 caracteres.');
  return getDb().transaction(() => {
    const store = read();
    const previous = input.id ? store.prompts.find(item => item.id === input.id) : undefined;
    if (input.id && !previous) throw new Error('El prompt seleccionado ya no existe. Elige otro o usa Default.');
    if (store.prompts.some(item => item.id !== input.id && item.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0)) throw new Error('Ya existe un prompt con ese nombre.');
    const now = new Date().toISOString();
    const prompt = { id: previous?.id ?? randomUUID(), name, instructions, createdAt: previous?.createdAt ?? now, updatedAt: now };
    store.prompts = [...store.prompts.filter(item => item.id !== prompt.id), prompt];
    write(store); return prompt;
  })();
}
export function selectResearchSystemPrompt(key: string, id: string | null): void {
  conversationKey(key);
  getDb().transaction(() => { const store = read(); if (id && !store.prompts.some(item => item.id === id)) throw new Error('El prompt seleccionado ya no existe. Elige otro o usa Default.');
    if (id) store.selections[key] = id; else delete store.selections[key]; write(store);
  })();
}
export function deleteResearchSystemPrompt(id: string): void {
  getDb().transaction(() => { const store = read(); store.prompts = store.prompts.filter(item => item.id !== id);
    store.selections = Object.fromEntries(Object.entries(store.selections).filter(([, selected]) => selected !== id)); write(store);
  })();
}
