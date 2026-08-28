import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const academic = fs.readFileSync(`${root}/src/serverWeb/AcademicToolsServerView.tsx`, 'utf8');
const state = fs.readFileSync(`${root}/src/serverWeb/StateOfArtServerView.tsx`, 'utf8');
const api = fs.readFileSync(`${root}/src/serverWeb/api.ts`, 'utf8');

test('writing and projects expose private artifact CRUD without public writes', () => {
  assert.match(academic, /data-testid=\{`private-\$\{surface\}-workspace`\}/);
  assert.match(academic, /api\.createArtifact\(\{ vaultId: spaceId, kind: 'workspace-note'/);
  assert.match(academic, /api\.updateArtifact\(active\.id/);
  assert.match(academic, /api\.deleteArtifact\(active\.id/);
  assert.match(academic, /metadata: \{ surface, private: true \}/);
  assert.match(academic, /filter\(\(entry\) => entry\.metadata\?\.surface === 'writing'\)/);
  assert.match(academic, /filter\(\(entry\) => entry\.metadata\?\.surface === 'project'\)/);
  assert.doesNotMatch(academic, /window\.nodus\.(createProject|updateProject|deleteProject)/);
});

test('writing and projects offer an account-private Markdown preview', () => {
  assert.match(academic, /private-\$\{surface\}-preview-tab/);
  assert.match(academic, /private-\$\{surface\}-preview/);
  assert.match(academic, /<MarkdownReader value=\{content \|\|/);
});

test('state of the question keeps the published triple view and private overlay', () => {
  assert.match(state, /data-testid="coverage-tabs"/);
  assert.match(state, /data-testid="state-private-questions"/);
  assert.match(state, /data-testid="state-private-analysis"/);
  assert.match(state, /metadata: \{ surface: 'state-of-art', entity: 'question', private: true/);
  assert.match(state, /metadata: \{ surface: 'state-of-art', entity: 'analysis', private: true/);
  assert.match(state, /api\.runAI\(spaceId, 'content-query'/);
  assert.match(state, /api\.contextPackage\(spaceId, title\(question\)/);
  assert.match(state, /api\.updateArtifact\(own\.id/);
  assert.match(state, /api\.deleteArtifact\(active\.id/);
  assert.match(state, /tab === 'map' \? <CoverageView/);
});

test('artifact API mutations remain CSRF-aware', () => {
  assert.match(api, /updateArtifact: \(id: string, input/);
  assert.match(api, /deleteArtifact: \(id: string, csrfToken\?: string\)/);
  assert.match(api, /X-CSRF-Token/);
});
