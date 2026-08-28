import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const source = async (name) => readFile(new URL(name, root), 'utf8');

test('Ideas, authors and graph expose private account-scoped research panels', async () => {
  const code = await source('src/serverWeb/advanced/AdvancedWorkspace.tsx');
  assert.match(code, /api\.artifacts\(spaceId, 'workspace-note'\)/);
  assert.match(code, /entry\.metadata\?\.surface === surface/);
  assert.match(code, /api\.createArtifact\(\{ vaultId: spaceId, kind: 'workspace-note'/);
  assert.match(code, /api\.updateArtifact\(active\.id/);
  assert.match(code, /api\.deleteArtifact\(active\.id/);
  assert.match(code, /surface="graph"/);
  assert.match(code, /surface="idea"/);
  assert.match(code, /surface="author"/);
});

test('Reading path has private read-state and assistant affordances', async () => {
  const code = await source('src/serverWeb/AcademicToolsServerView.tsx');
  assert.match(code, /api\.annotations\(spaceId, 'reading-path'/);
  assert.match(code, /api\.addAnnotation\(spaceId/);
  assert.match(code, /content: read \? 'read' : 'unread'/);
  assert.match(code, /window\.location\.assign\(`\/view\/assistant/);
  assert.match(code, /onToggleRead=\{toggleRead\}/);
});

test('Parity matrix records the safe boundary instead of claiming unsupported writes', async () => {
  const docs = await source('docs/server-web-academic-parity.md');
  assert.match(docs, /notas\/auditoría privado/);
  assert.match(docs, /estado personal puede superponerse/);
  assert.match(docs, /Markdown.*vista previa/);
  assert.match(docs, /las publicaciones nunca se mutan/i);
  assert.match(docs, /salto al grafo, lector y asistente/);
});
