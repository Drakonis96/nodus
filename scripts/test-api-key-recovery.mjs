// Regression coverage for the 2.3.0 macOS Safe Storage identity change. The test
// uses the real secret store + recovery coordinator against an isolated profile;
// no real Keychain entry or API key is accessed.
import assert from 'node:assert/strict';
import { createCipheriv, pbkdf2Sync } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-api-key-recovery-'));

try {
  const vaultDir = path.join(root, 'vaults', 'vault-a');
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'nodus.sqlite'), 'stub');

  const electronStub = path.join(root, 'electron-stub.js');
  const vaultStub = path.join(root, 'vault-stub.js');
  const entry = path.join(root, 'entry.ts');
  const bundle = path.join(root, 'bundle.mjs');
  fs.writeFileSync(electronStub, `
    export const app = {
      getPath: () => ${JSON.stringify(root)},
      getAppPath: () => ${JSON.stringify(repoRoot)},
      isPackaged: false,
      dock: { hide() {} },
    };
    export const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from('current:' + value, 'utf8'),
      decryptString: (buffer) => {
        const value = Buffer.from(buffer).toString('utf8');
        if (!value.startsWith('current:')) throw new Error('legacy identity');
        return value.slice('current:'.length);
      },
    };
  `);
  fs.writeFileSync(vaultStub, `
    export const activeVaultDir = () => ${JSON.stringify(vaultDir)};
    export const listVaults = () => [{ id: 'vault-a', path: ${JSON.stringify(path.join(vaultDir, 'nodus.sqlite'))} }];
  `);
  fs.writeFileSync(entry, `
    export * as store from ${JSON.stringify(path.join(repoRoot, 'electron/secrets/secretStore.ts'))};
    export * as recovery from ${JSON.stringify(path.join(repoRoot, 'electron/secrets/legacySecretRecovery.ts'))};
  `);

  await build({
    entryPoints: [entry],
    outfile: bundle,
    bundle: true,
    format: 'esm',
    platform: 'node',
    plugins: [{
      name: 'recovery-stubs',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^electron$/ }, () => ({ path: electronStub }));
        buildApi.onResolve({ filter: /vaults\/vaultRegistry$/ }, () => ({ path: vaultStub }));
      },
    }],
    alias: { '@shared': path.join(repoRoot, 'shared') },
  });

  const { store, recovery } = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`);
  const globalDir = path.join(root, 'secrets');
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(path.join(globalDir, 'ai_key_gemini.bin'), 'legacy:gemini-old');
  fs.writeFileSync(path.join(vaultDir, 'ai_key_deepseek.bin'), 'legacy:deepseek-old');
  fs.writeFileSync(path.join(root, 'ai_key_openai.bin'), 'current:openai-readable-old-location');

  assert.equal(store.getApiKey('openai'), 'openai-readable-old-location', 'readable released locations migrate without platform-specific recovery');
  assert.equal(fs.existsSync(path.join(root, 'ai_key_openai.bin')), false, 'migrated historical key is retired');

  assert.equal(store.apiKeyStorageState('gemini'), 'locked');
  assert.equal(store.apiKeyStorageState('deepseek'), 'locked');
  assert.ok(store.apiKeyCandidateFiles('deepseek').some((file) => file.includes('vault-a')));

  const calls = [];
  const result = await recovery.recoverLegacyApiKeys(async (storageName, candidates) => {
    calls.push({ storageName, candidates });
    return storageName === 'nodus'
      ? { gemini: 'gemini-recovered-key', deepseek: 'deepseek-recovered-key' }
      : {};
  }, 'darwin');

  assert.deepEqual(new Set(result.recoveredProviders), new Set(['gemini', 'deepseek']));
  assert.deepEqual(result.remainingLockedProviders, []);
  assert.equal(store.getApiKey('gemini'), 'gemini-recovered-key');
  assert.equal(store.getApiKey('deepseek'), 'deepseek-recovered-key');
  assert.equal(calls[0].storageName, 'nodus', 'lowercase pre-2.3 identity is tried first');
  assert.equal(calls.length, 1, 'current identity is not prompted when legacy recovery succeeds');
  assert.ok(fs.readdirSync(path.join(globalDir, 'locked-archive')).some((name) => name.startsWith('ai_key_gemini-')), 'locked global blob preserved before migration');

  const password = Buffer.from('legacy-keychain-password');
  const derivedKey = pbkdf2Sync(password, Buffer.from('saltysalt'), 1003, 16, 'sha1');
  const cipher = createCipheriv('aes-128-cbc', derivedKey, Buffer.alloc(16, 0x20));
  const encrypted = Buffer.concat([Buffer.from('v10'), cipher.update('known-legacy-secret'), cipher.final()]);
  derivedKey.fill(0);
  assert.equal(recovery.decryptChromiumV10Blob(encrypted, password), 'known-legacy-secret', 'Chromium v10 compatibility fixture decrypts');
  assert.equal(recovery.decryptChromiumV10Blob(encrypted, Buffer.from('wrong-password')), null, 'wrong Keychain credential is rejected');

  const exportSource = fs.readFileSync(path.join(repoRoot, 'electron/export/exportImport.ts'), 'utf8');
  assert.match(exportSource, /lockedApiKeyProviders\(\)/, 'full backup refuses silently locked API keys');
  const restoreBody = exportSource.match(/function restoreApiKeys[\s\S]*?\n}/)?.[0] ?? '';
  assert.doesNotMatch(restoreBody, /clearApiKey/, 'restoring an empty snapshot never clears local encrypted keys');

  const notes = fs.readFileSync(path.join(repoRoot, 'shared/releaseNotes.ts'), 'utf8');
  assert.match(notes, /version: '2\.3\.1'/);
  assert.match(notes, /impedía a Nodus leer algunas claves de API de IA/);
  const providersView = fs.readFileSync(path.join(repoRoot, 'src/views/ProvidersSettings.tsx'), 'utf8');
  assert.match(providersView, /data-testid="locked-api-key-recovery"/, 'locked-key retry is visible in Settings');
  assert.match(providersView, /bg-amber-50[\s\S]*dark:bg-amber-950/, 'recovery warning has explicit light and dark surfaces');
  console.log('API-key Safe Storage recovery regression test passed');
} finally {
  await rm(root, { recursive: true, force: true });
}
