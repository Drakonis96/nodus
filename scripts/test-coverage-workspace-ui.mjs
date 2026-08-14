import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './ipc-channel-census.mjs';

test('Estado de la cuestión is a Library-style workspace with three ordered tabs', async () => {
  const workspace = await readSource('src/views/CoverageWorkspace.tsx');
  assert.match(workspace, /data-testid="coverage-workspace"/);
  assert.match(workspace, /data-testid="coverage-tabs"/);
  assert.match(workspace, /<Icon name="compass"/);
  assert.match(workspace, /bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100/);
  assert.match(workspace, /border-neutral-300 bg-white text-neutral-900[^\n]*dark:border-neutral-700 dark:bg-neutral-900/);
  assert.match(
    workspace,
    /\['map', 'Cobertura', '[a-z]+'\],\s*\['debate', 'Debates', '[a-z]+'\],\s*\['gaps', 'Huecos', '[a-z]+'\]/,
    'tab order stays Cobertura → Debates → Huecos',
  );
});

test('Debates remains routable but internal links switch the workspace tab', async () => {
  const [workspace, corpus, navigation] = await Promise.all([
    readSource('src/views/CoverageWorkspace.tsx'),
    readSource('src/app/views/corpus.tsx'),
    readSource('src/navigation.ts'),
  ]);
  assert.match(workspace, /const openDebates = \(\) => setTab\('debate'\)/);
  assert.match(workspace, /<ResearchMapView[\s\S]*onOpenDebates=\{openDebates\}/);
  assert.match(workspace, /<GapsView[\s\S]*onOpenDebates=\{openDebates\}/);
  assert.match(corpus, /debate:[\s\S]*<CoverageWorkspace[\s\S]*initialTab="debate"/);
  assert.doesNotMatch(navigation, /\{ id: 'debate',/);
});

test('Coverage reloads with the active vault and confirms destructive deletion', async () => {
  const [workspace, map] = await Promise.all([
    readSource('src/views/CoverageWorkspace.tsx'),
    readSource('src/views/ResearchMapView.tsx'),
  ]);
  assert.match(workspace, /<ResearchMapView[\s\S]*vaultId=\{vaultId\}/);
  assert.match(map, /const reloadList = useCallback\([\s\S]*\}, \[vaultId\]\)/);
  assert.match(map, /const approved = await confirm\(/);
  assert.match(map, /Se eliminará «\{title\}». Esta acción no se puede deshacer\./);
  assert.match(map, /if \(!approved\) return/);
});

test('Coverage accepts several questions into a serial queue and reveals ready results', async () => {
  const map = await readSource('src/views/ResearchMapView.tsx');
  assert.match(map, /coverageQuestionQueue\.enqueue/);
  assert.match(map, /data-testid="coverage-question-queue"/);
  assert.match(map, /event\.type === 'ready'[\s\S]*reloadList\(\)/);
  assert.match(map, /visibleQuestions = questions\.filter/);
});

test('the academic section name uses the native term in every supported language', async () => {
  const expected = [
    ['src/i18n.en.ts', 'State of the art'],
    ['src/i18n.fr.ts', 'État de la question'],
    ['src/i18n.de.ts', 'Forschungsstand'],
    ['src/i18n.pt.ts', 'Estado da arte'],
    ['src/i18n.pt-BR.ts', 'Estado da arte'],
    ['src/i18n.it.ts', 'Stato dell’arte'],
    ['src/i18n.tr.ts', 'Alanyazın'],
  ];
  for (const [file, term] of expected) {
    assert.match(await readSource(file), new RegExp(`Estado de la cuestión['"]: ['"]${term}`), `${file} uses ${term}`);
  }
});
