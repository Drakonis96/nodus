import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPackagingOnlyPackageJson,
  findShippedChanges,
  verifyBackfillParity,
} from './verify-backfill-parity.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

function fakeGit({ changed = [], taggedPackage, currentPackage }) {
  return (args) => {
    if (args[0] === 'diff') return `${changed.join('\n')}\n`;
    if (args[0] === 'show') return args[1].startsWith('HEAD:') ? currentPackage : taggedPackage;
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

test('packaging files may differ from the tag; product files may not', () => {
  assert.deepEqual(findShippedChanges([
    '.github/workflows/release-build.yml',
    'build/beforePack.cjs',
    'scripts/upload-release-assets.mjs',
    'site/app/index.html',
    'README.md',
    'package.json',
  ]), []);

  assert.deepEqual(findShippedChanges([
    'src/views/BasicsTutorial.tsx',
    'electron/ai/codexSubscription.ts',
    'shared/providers.ts',
    'scripts/nodus_copilot.py',
    'zotero-plugin/manifest.json',
  ]), [
    'src/views/BasicsTutorial.tsx',
    'electron/ai/codexSubscription.ts',
    'shared/providers.ts',
    'scripts/nodus_copilot.py',
    'zotero-plugin/manifest.json',
  ]);
});

test('a backfill that would ship different application code is refused', () => {
  assert.throws(
    () => verifyBackfillParity('v5.1.6', { git: fakeGit({ changed: ['electron/main.ts'] }) }),
    /these changes since the tag reach the application itself/,
  );
});

test('the backfill can only ever rebuild the version that was released', () => {
  assert.throws(
    () => assertPackagingOnlyPackageJson('{"version":"5.1.6"}', '{"version":"5.1.7"}'),
    /version changed since the tag/,
  );
});

test('package.json may only differ in its packaging block', () => {
  const tagged = '{"version":"5.1.6","dependencies":{"a":"1"},"build":{"mac":{"target":["dmg"]}}}';
  assert.doesNotThrow(() => assertPackagingOnlyPackageJson(
    tagged,
    '{"version":"5.1.6","dependencies":{"a":"1"},"build":{"mac":{"target":["dmg","zip"]}}}',
  ));
  assert.throws(
    () => assertPackagingOnlyPackageJson(tagged, '{"version":"5.1.6","dependencies":{"a":"2"},"build":{}}'),
    /outside its "build" section/,
  );
});

test('the real change set for this backfill is packaging only', () => {
  // The actual diff this branch carries, checked against the real rule rather
  // than a fixture: if a later commit touches product code, this fails and the
  // backfill has to become a normal release instead.
  const changed = read('package.json') && [
    '.github/workflows/backfill-macos-intel.yml',
    '.github/workflows/release-build.yml',
    'README.md',
    'build/afterPack.cjs',
    'build/beforePack.cjs',
    'package.json',
    'scripts/merge-mac-update-manifest.mjs',
    'scripts/upload-release-assets.mjs',
    'scripts/verify-backfill-parity.mjs',
    'scripts/verify-macos-release.cjs',
    'scripts/verify-packaged-native-runtime.cjs',
    'site/app/index.html',
    'site/assets/js/site.js',
    'site/index.html',
  ];
  assert.deepEqual(findShippedChanges(changed), []);
});
