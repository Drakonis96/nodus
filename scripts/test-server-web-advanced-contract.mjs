import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const advancedFiles = [
  'src/serverWeb/advanced/api.ts',
  'src/serverWeb/advanced/types.ts',
  'src/serverWeb/advanced/AdvancedWorkspace.tsx',
];

test('Advanced Server workspace is an isolated read-only browser boundary', () => {
  for (const file of advancedFiles) {
    const source = read(file);
    assert.doesNotMatch(source, /window\.nodus|from\s+['"]electron['"]|electron\/preload|vite-plugin-electron/, file);
    assert.doesNotMatch(source, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/, `${file} must not expose writes`);
  }
});

test('Advanced REST adapter pins the published workspace contracts', () => {
  const api = read('src/serverWeb/advanced/api.ts');
  assert.match(api, /surface:\s*'workspace'/, 'Ideas and authors use workspace projections');
  assert.match(api, /ideas\/\$\{encoded\(ideaId\)\}\/graph/, 'graph uses the bounded idea subgraph endpoint');
  assert.match(api, /authors\/\$\{encoded\(authorId\)\}\/dossier/, 'authors use the published dossier endpoint');
  assert.match(api, /export const advancedRest/, 'adapter has an explicit public entry point');
});

test('Advanced UI exposes ideas, authors, graph, tabs, rich details and published synthesis', () => {
  const ui = read('src/serverWeb/advanced/AdvancedWorkspace.tsx');
  for (const marker of [
    'advanced-server-workspace',
    'advanced-ideas-tabs',
    'advanced-idea-detail',
    'advanced-authors-tabs',
    'advanced-author-dossier',
    'advanced-author-synthesis',
    'advanced-graph-view',
    '<SigmaGraph',
  ]) assert.match(ui, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), marker);
});

test('Advanced module is integrated only into the Server shell through lazy boundaries', () => {
  const app = read('src/serverWeb/App.tsx');
  assert.match(app, /lazy\(\(\) => import\('\.\/advanced'\)/);
  assert.match(app, /<IdeasServerView/);
  assert.match(app, /<AuthorsServerView/);
  assert.match(app, /<GraphServerView/);
  assert.doesNotMatch(read('src/App.tsx'), /serverWeb\/advanced|serverWeb\/PersonalViews/, 'Desktop entry must remain untouched');
});
