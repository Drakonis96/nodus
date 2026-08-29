import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const source = async (name) => readFile(new URL(name, root), 'utf8');

test('Ideas, authors and graph do not invent private research panels absent from Desktop', async () => {
  const code = await source('src/serverWeb/advanced/AdvancedWorkspace.tsx');
  assert.doesNotMatch(code, /PrivateResearchPanel/);
  assert.doesNotMatch(code, /api\.artifacts\(spaceId, 'workspace-note'\)/);
  assert.doesNotMatch(code, /Notas privadas del autor|Notas privadas de Ideas|Notas privadas del grafo/);
  assert.match(code, /AcademicDetailExplorer/);
  assert.match(code, /GraphServerView/);
});

test('Reading path has private read-state and assistant affordances', async () => {
  const code = await source('src/serverWeb/AcademicToolsServerView.tsx');
  assert.match(code, /\.annotations\(spaceId, ["']reading-path["']/);
  assert.match(code, /api\.addAnnotation\(\s*spaceId/);
  assert.match(code, /content: read \? ["']read["'] : ["']unread["']/);
  assert.match(code, /window\.location\.assign\(\s*`\/view\/assistant/);
  assert.match(code, /onToggleRead=\{toggleRead\}/);
});

test('Parity matrix records the safe boundary instead of claiming unsupported writes', async () => {
  const docs = await source('docs/server-web-academic-parity.md');
  assert.match(docs, /sin paneles privados inventados/i);
  assert.match(docs, /estado personal puede superponerse/);
  assert.match(docs, /Markdown.*vista previa/);
  assert.match(docs, /las publicaciones nunca se mutan/i);
  assert.match(docs, /salto al grafo, lector y asistente/);
});
