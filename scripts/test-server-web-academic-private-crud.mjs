import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const variants = (source) => [source, source.replaceAll('"', "'"), source.replace(/\s+/g, ' '), source.replaceAll('"', "'").replace(/\s+/g, ' ')].join('\n');
const academic = variants(fs.readFileSync(`${root}/src/serverWeb/AcademicToolsServerView.tsx`, 'utf8'));
const state = variants(fs.readFileSync(`${root}/src/serverWeb/StateOfArtServerView.tsx`, 'utf8'));
const api = variants(fs.readFileSync(`${root}/src/serverWeb/api.ts`, 'utf8'));
const app = variants(fs.readFileSync(`${root}/src/serverWeb/App.tsx`, 'utf8'));
const navigation = variants(fs.readFileSync(`${root}/src/navigation.ts`, 'utf8'));

test('the visible writing group contains only Workspace and legacy URLs canonicalize there', () => {
  assert.match(navigation, /\{ id: 'workspace', label: 'Espacio de trabajo'/);
  assert.doesNotMatch(navigation, /\{ id: 'writing', label:/);
  assert.doesNotMatch(navigation, /\{ id: 'projects', label:/);
  assert.match(app, /requested === ["']writing["'] \|\| requested === ["']projects["'] \? ["']workspace["']/);
  assert.match(app, /view === ["']writing["'] \|\| view === ["']projects["'] \? ["']workspace["']/);
  assert.doesNotMatch(app, /tool=\{route\.view as 'writing' \| 'projects'/);
  assert.doesNotMatch(academic, /window\.nodus\.(createProject|updateProject|deleteProject)/);
});

test('state of the question keeps the published triple view without invented private overlays', () => {
  assert.match(state, /data-testid="coverage-tabs"/);
  assert.doesNotMatch(state, /state-private-questions|state-private-analysis/);
  assert.doesNotMatch(state, /api\.(createArtifact|updateArtifact|deleteArtifact|runAI|contextPackage)/);
  assert.match(state, /tab === ["']map["'] \? \(\s*<CoverageView/);
});

test('artifact API mutations remain CSRF-aware', () => {
  assert.match(api, /updateArtifact:\s*\(\s*id: string,\s*input/);
  assert.match(api, /deleteArtifact: \(id: string, csrfToken\?: string\)/);
  assert.match(api, /X-CSRF-Token/);
});
