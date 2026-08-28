import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('generic catalog and dossier surfaces do not invent private-note panels absent from Desktop', async () => {
  const [app, advanced, state, vaults] = await Promise.all([
    source('src/serverWeb/App.tsx'),
    source('src/serverWeb/advanced/AdvancedWorkspace.tsx'),
    source('src/serverWeb/StateOfArtServerView.tsx'),
    source('src/serverWeb/vaults/index.tsx'),
  ]);

  assert.doesNotMatch(app, /AnnotationPanel|Anotaciones personales|personal-annotations/);
  assert.doesNotMatch(advanced, /<PrivateResearchPanel|Notas privadas del autor|Notas privadas de Ideas/);
  assert.doesNotMatch(state, /PrivateOverlayNote|state-private-overlay/);
  assert.doesNotMatch(vaults, /tab === 'notes'/);
});

