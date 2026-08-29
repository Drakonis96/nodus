import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('Desktop exposes one authoring section and keeps old ids as aliases only', async () => {
  const [navigation, app, corpus, home, tour] = await Promise.all([
    source('src/navigation.ts'), source('src/App.tsx'), source('src/app/views/corpus.tsx'),
    source('src/views/HomeView.tsx'), source('src/views/AdvancedTour.tsx'),
  ]);

  assert.match(navigation, /id: 'workspace', label: 'Espacio de trabajo'/);
  assert.doesNotMatch(navigation, /\{ id: 'writing', label: 'Escritura'/);
  assert.doesNotMatch(navigation, /\{ id: 'projects', label: 'Proyectos'/);
  assert.match(app, /next === 'writing' \|\| next === 'projects'/);
  assert.match(app, /\? 'workspace' : 'notes'/);
  assert.match(corpus, /Compatibility aliases[\s\S]*writing:[\s\S]*<WorkspaceView/);
  assert.match(corpus, /projects:[\s\S]*<WorkspaceView/);
  assert.doesNotMatch(home, /onNavigate\('writing'\)/);
  assert.doesNotMatch(tour, /view: 'writing'|view: 'projects'/);
});

test('Server exposes the same single authoring section and canonicalizes legacy URLs', async () => {
  const app = await source('src/serverWeb/App.tsx');
  assert.match(app, /'deepResearch', 'workspace',/);
  assert.doesNotMatch(app, /'deepResearch', 'workspace', 'writing', 'projects'/);
  assert.match(app, /requested === 'writing' \|\| requested === 'projects' \? 'workspace'/);
  assert.match(app, /view === 'writing' \|\| view === 'projects' \? 'workspace'/);
  assert.doesNotMatch(app, /\['argument', 'hypothesis', 'reading', 'immersion', 'writing', 'projects'\]/);
});
