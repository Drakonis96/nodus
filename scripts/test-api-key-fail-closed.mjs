import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('API keys fail closed when Electron Safe Storage is unavailable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-key-fail-closed-'));
  try {
    const electronStub = path.join(root, 'electron-stub.js');
    const vaultStub = path.join(root, 'vault-stub.js');
    const entry = path.join(root, 'entry.ts');
    const bundle = path.join(root, 'bundle.mjs');
    fs.writeFileSync(electronStub, `
      export const app = { getPath: () => ${JSON.stringify(root)} };
      export const safeStorage = {
        isEncryptionAvailable: () => false,
        encryptString: () => { throw new Error('must not encrypt'); },
        decryptString: () => { throw new Error('must not decrypt'); },
      };
    `);
    fs.writeFileSync(vaultStub, `
      export const activeVaultDir = () => ${JSON.stringify(root)};
      export const getActiveVault = () => ({ id: 'default', path: ${JSON.stringify(path.join(root, 'nodus.sqlite'))} });
      export const vaultDir = () => ${JSON.stringify(root)};
      export const listVaults = () => [];
    `);
    fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(repoRoot, 'electron/secrets/secretStore.ts'))};`);
    await build({
      entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'node',
      plugins: [{
        name: 'secret-stubs',
        setup(api) {
          api.onResolve({ filter: /^electron$/ }, () => ({ path: electronStub }));
          api.onResolve({ filter: /vaults\/vaultRegistry$/ }, () => ({ path: vaultStub }));
        },
      }],
      alias: { '@shared': path.join(repoRoot, 'shared') },
    });
    const store = await import(`${pathToFileURL(bundle).href}?v=${Date.now()}`);
    assert.throws(() => store.setApiKey('openai', 'sk-plaintext'), /almacén seguro/i);
    assert.equal(fs.existsSync(path.join(root, 'secrets', 'ai_key_openai.bin')), false);

    const legacy = path.join(root, 'secrets', 'ai_key_openai.bin');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, `b64:${Buffer.from('sk-legacy').toString('base64')}`, { mode: 0o600 });
    assert.equal(store.getApiKey('openai'), null, 'legacy plaintext is not returned or sent');
    assert.equal(store.apiKeyStorageState('openai'), 'locked', 'legacy plaintext remains visible for later encrypted migration');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
