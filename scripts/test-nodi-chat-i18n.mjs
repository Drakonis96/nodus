import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Nodi chat has a complete native prompt pack for every supported prompt language', async () => {
  const source = await readFile(path.join(root, 'shared/nodiChatPromptPacks.ts'), 'utf8');
  const languages = ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr'];
  const packNames = ['SPANISH', 'ENGLISH', 'FRENCH', 'GERMAN', 'EUROPEAN_PORTUGUESE', 'BRAZILIAN_PORTUGUESE', 'ITALIAN', 'TURKISH'];

  assert.match(source, /export const NODI_CHAT_PROMPT_PACKS: Record<PromptLanguage, NodiChatPromptPack>/);
  for (const language of languages) assert.match(source, new RegExp(`(?:'${language}'|${language}):`));
  for (const name of packNames) {
    const start = source.indexOf(`const ${name}:`);
    const end = source.indexOf('\nconst ', start + 1);
    const block = source.slice(start, end < 0 ? source.length : end);
    for (const field of ['vaultTypeLabels', 'systemRules', 'corpusCitationRules', 'readerMode', 'contextLabels', 'metadataLabels', 'answerOnly', 'privacyNote']) {
      assert.match(block, new RegExp(`\\b${field}\\s*:`), `${name} is missing ${field}`);
    }
    assert.match(block, /nodus:\/\//, `${name} lost the citation URI contract`);
    assert.match(block, /persona_central|persona_central/, `${name} lost the genealogy JSON key contract`);
  }

  const spanish = source.slice(source.indexOf('const SPANISH:'), source.indexOf('const ENGLISH:'));
  for (const canonical of [
    'Eres Nodi, el asistente profesional integrado de Nodus.',
    'REGLA CRÍTICA:',
    'No puedo verificarlo con las fuentes seleccionadas',
    'termina con «Base:»',
    'parentesco_con_persona_central',
  ]) assert.match(spanish, new RegExp(canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const pt = source.slice(source.indexOf('const EUROPEAN_PORTUGUESE:'), source.indexOf('const BRAZILIAN_PORTUGUESE:'));
  const ptBr = source.slice(source.indexOf('const BRAZILIAN_PORTUGUESE:'), source.indexOf('const ITALIAN:'));
  assert.notEqual(pt, ptBr, 'European and Brazilian Portuguese must be distinct native packs');
  assert.match(pt, /ficheiro|utilizador|seleccion/i);
  assert.match(ptBr, /arquivo|usuário|configurações/i);
});

test('Nodi chat wires promptLanguage into every model-facing scaffold', async () => {
  const source = await readFile(path.join(root, 'electron/ai/nodiChat.ts'), 'utf8');
  assert.match(source, /getNodiChatPromptPack/);
  assert.match(source, /settings\.promptLanguage \?\? settings\.uiLanguage/);
  for (const field of ['systemRules', 'corpusCitationRules', 'contextLabels', 'historyUser', 'answerOnly', 'responseLanguage']) {
    assert.match(source, new RegExp(`pack\\.${field}`), `${field} is not wired into nodiChat`);
  }
  assert.doesNotMatch(source, /\.\.\.CHAT_CITATION_RULES/);
});

test('Nodi documentation and visible roadmap are localized by the prompt/UI language', async () => {
  const documentation = await readFile(path.join(root, 'shared/nodiDocumentation.ts'), 'utf8');
  const chat = await readFile(path.join(root, 'electron/ai/nodiChat.ts'), 'utf8');
  const roadmap = await readFile(path.join(root, 'src/views/RoadmapModal.tsx'), 'utf8');

  assert.match(documentation, /const LOCALIZED_ROADMAP: Record<PromptLanguage, readonly RoadmapItem\[\]>/);
  assert.match(documentation, /export function buildNodusDocumentation\(language: PromptLanguage/);
  assert.match(documentation, /export const NODUS_DOCUMENTATION_BY_LANGUAGE: Record<PromptLanguage, string>/);
  for (const language of ['es', 'en', 'fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
    assert.match(documentation, new RegExp(`(?:^|\\n)\\s*['"]?${language}['"]?:`), `${language} documentation is missing`);
  }
  assert.match(chat, /buildNodusDocumentation\(documentationLanguage\)/);
  assert.match(roadmap, /getActiveLang\(\)/);
  assert.match(roadmap, /getNodusRoadmap\(language\)/);
  assert.match(roadmap, /getNodusRoadmapStatusLabel/);
});

test('localized documentation uses native compact bodies for every non-English locale', async () => {
  const source = await readFile(path.join(root, 'shared/nodiDocumentation.ts'), 'utf8');
  const start = source.indexOf('const COMPACT_LOCALIZED_DOCUMENTATION');
  const end = source.indexOf('\n};', start);
  const compact = source.slice(start, end);
  for (const language of ['fr', 'de', 'pt', 'pt-BR', 'it', 'tr']) {
    const localeStart = compact.search(new RegExp("['\\\"]?" + language + "['\\\"]?: `"));
    const localeEnd = compact.indexOf('`,', localeStart + 1);
    assert.ok(localeStart >= 0 && localeEnd > localeStart, `${language} has a complete native body`);
    const body = compact.slice(localeStart, localeEnd);
    assert.ok(body.length > 4_000, `${language} body is substantive`);
    assert.doesNotMatch(body, /This guide documents|The roadmap distinguishes|Provider keys are configured|At the far right of the header|There are no fixed dates|Guía interna|Esta guía documenta|El roadmap distingue|Las claves de proveedores|En el extremo derecho|No hay fechas cerradas|No puedo verificarlo/);
    assert.match(body, /__ROADMAP_GUIDE__/);
    assert.equal((body.match(/^## /gm) ?? []).length, 18, `${language} must contain the 18 canonical sections plus the title`);
  }
});
