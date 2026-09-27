import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Linking a global document into a vault writes the work into that vault's database,
// but the vault's Library list is served from a per-vault, per-filter in-memory cache.
// Without invalidating it, returning to "This vault" showed the pre-link page until
// another filter forced a fresh query. These tests pin both halves: the cache honours
// a targeted invalidation, and the link flow performs it.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const outDir = await mkdtemp(path.join(os.tmpdir(), 'nodus-vault-cache-'));

function loadModule(file) {
  const bundle = path.join(outDir, `${path.basename(file, '.ts')}.cjs`);
  execFileSync(
    path.join(repoRoot, 'node_modules/.bin/esbuild'),
    [path.join(repoRoot, file), '--bundle', '--platform=node', '--format=cjs', '--target=es2022', `--outfile=${bundle}`],
    { cwd: repoRoot, stdio: 'inherit' }
  );
  return require(bundle);
}

test('invalidating one vault clears only that vault, and returns stale pages to a miss', () => {
  const cache = loadModule('src/vaultQueryCache.ts');
  const key = 'library:{"filter":{},"pageOffset":0,"sort":null}';
  cache.setVaultQueryCache('vault-a', key, { items: ['before-link'] });
  cache.setVaultQueryCache('vault-b', key, { items: ['untouched'] });
  assert.deepEqual(cache.getVaultQueryCache('vault-a', key), { items: ['before-link'] });

  cache.invalidateVaultQueryCache('vault-a');

  assert.equal(cache.getVaultQueryCache('vault-a', key), undefined, 'the linked vault must miss and re-query');
  assert.deepEqual(cache.getVaultQueryCache('vault-b', key), { items: ['untouched'] }, 'other vaults keep their cache');
});

test('the vault-link flow invalidates the target vault before it closes the dialog', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'src/views/GlobalLibraryView.tsx'), 'utf8');
  assert.match(source, /import \{ invalidateVaultQueryCache \} from '\.\.\/vaultQueryCache';/);
  assert.match(source, /import \{[^}]*\bnotifyDataChanged\b[^}]*\} from '\.\.\/hooks';/);
  assert.match(
    source,
    /invalidateVaultQueryCache\(vaultId\);\s*notifyDataChanged\(\);\s*onLinked\(report\.links\);\s*onClose\(\);/,
    'the link success path must invalidate the vault cache and refresh mounted views'
  );
});
