import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFile(path.join(root, file), 'utf8');

test('the complete Global Library ships with recovery, privacy, hardening and real-renderer gates', async () => {
  const [guide, acceptance, readme, privacy, readerStore, packageJson] = await Promise.all([
    read('docs/global-library.md'),
    read('docs/global-library-acceptance.md'),
    read('README.md'),
    read('PRIVACY.md'),
    read('electron/libraryReader/libraryReaderStore.ts'),
    read('package.json').then(JSON.parse),
  ]);

  for (const contract of [
    'nodus-library', 'catalog.sqlite', 'metadata.json', 'reader.md', 'source-map.json',
    'quality-report.json', 'annotations.json', 'chat.json', '.nodus/conflicts/',
    'Crossref', 'Open Library', 'read-only', 'local model', 'remote provider',
  ]) assert.match(guide, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

  for (const phase of ['Storage', 'Zotero', 'Extraction', 'Reader', 'Metadata', 'Vaults', 'Reuse', 'Privacy', 'Licenses']) {
    assert.match(acceptance, new RegExp(`\\| ${phase} \\|`));
  }
  assert.match(readme, /docs\/global-library\.md/);
  assert.match(privacy, /Cross-vault Library/);
  assert.match(privacy, /Clean-reader chat and remote OCR/);
  assert.match(readerStore, /realpathSync\.native/);
  assert.match(readerStore, /atomicWriteJson, configuredLibraryRootOrThrow/);

  for (const file of [
    'scripts/test-library-storage.mjs',
    'scripts/test-library-migration.mjs',
    'scripts/test-library-migration-sessions.mjs',
    'scripts/test-library-revisions.mjs',
    'scripts/test-zotero-library-import.mjs',
    'scripts/test-library-extraction.mjs',
    'scripts/test-global-library-operations.mjs',
    'scripts/test-library-metadata.mjs',
    'scripts/test-global-library-reader.mjs',
    'scripts/test-global-library-vault-integration.mjs',
    'scripts/test-global-library-hardening.mjs',
    'scripts/e2e-global-library.mjs',
    'scripts/e2e-library-reader.mjs',
  ]) await access(path.join(root, file));

  assert.equal(packageJson.scripts['test:e2e:global-library'], 'npm run build && node scripts/e2e-global-library.mjs');
  assert.equal(packageJson.scripts['test:e2e:library-reader'], 'npm run build && node scripts/e2e-library-reader.mjs');
});
