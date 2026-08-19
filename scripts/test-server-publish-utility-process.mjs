import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installRuntimeHooks } from './lib/tsRuntimeHooks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

test('classic and Cloudflare publication use one-shot utility processes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-publish-utility-'));
  const workerFixture = path.join(root, 'serverPublishWorker.js');
  fs.writeFileSync(workerFixture, '// existence check only');
  const requests = [];
  let kills = 0;
  class FakeUtilityProcess extends EventEmitter {
    postMessage(request) {
      requests.push(request);
      const response = request.kind === 'build'
        ? {
            kind: 'done', id: request.id, compressed: new Uint8Array([31, 139, 8]),
            rawBytes: 116_300_000, revision: 'rev-classic', counts: { passages: 157_442 },
            assets: [], schemaVersion: 327, vectors: [],
          }
        : {
            kind: 'cloudflare-done', id: request.id,
            result: { revision: 'rev-cloud', updatedAt: '2026-08-16T00:00:00.000Z', bytes: 42, assetsSent: 0, libraryPackagesSent: 0 },
          };
      queueMicrotask(() => this.emit('message', response));
    }
    kill() { kills += 1; return true; }
  }
  installRuntimeHooks(root, {
    utilityProcess: {
      fork(file, args, options) {
        assert.equal(file, workerFixture);
        assert.deepEqual(args, []);
        assert.equal(options.serviceName, 'Nodus Server publisher');
        return new FakeUtilityProcess();
      },
    },
  });
  process.env.NODUS_SERVER_PUBLISH_WORKER_FILE = workerFixture;
  try {
    const host = require(path.join(repoRoot, 'electron/serverSync/serverPublishWorkerHost.ts'));
    const vault = { id: 'v1', name: 'Sintética', type: 'academic', path: '/isolated/vault.sqlite', active: true, legacy: true };
    const classic = await host.buildServerSnapshotInUtility({
      vaultPath: vault.path,
      vault,
      settings: { nodusServerIncludeUserContent: true, nodusServerIncludePassages: true },
      library: null,
      vectorKinds: [],
    });
    assert.ok(Buffer.isBuffer(classic.compressed));
    assert.deepEqual([...classic.compressed], [31, 139, 8]);
    assert.equal(classic.rawBytes, 116_300_000);

    const cloud = await host.publishVaultToCloudflareInUtility({
      vaultPath: vault.path,
      vault,
      config: {
        vaultId: vault.id, vaultName: vault.name, vaultType: vault.type, isActiveVault: true,
        kind: 'cloudflare', url: 'https://example.test', spaceId: 's1', spaceName: 'S', language: 'es',
        enabled: true, autoSync: true, includeUserContent: true, includePassages: true,
        includeLibraryDocuments: false, includeVectors: true, hasToken: true, configured: true,
      },
      token: 'test-token',
      library: null,
    });
    assert.equal(cloud.revision, 'rev-cloud');
    assert.deepEqual(requests.map((request) => request.kind), ['build', 'publish-cloudflare']);
    assert.equal(kills, 2, 'each utility process is reaped after its response');
  } finally {
    delete process.env.NODUS_SERVER_PUBLISH_WORKER_FILE;
    await rm(root, { recursive: true, force: true });
  }
});

test('production publication has no worker_threads or main-process snapshot fallback', () => {
  const host = fs.readFileSync(path.join(repoRoot, 'electron/serverSync/serverPublishWorkerHost.ts'), 'utf8');
  const service = fs.readFileSync(path.join(repoRoot, 'electron/serverSync/serverSyncService.ts'), 'utf8');
  const vite = fs.readFileSync(path.join(repoRoot, 'vite.config.ts'), 'utf8');
  assert.match(host, /utilityProcess\.fork\(/);
  assert.doesNotMatch(host, /worker_threads|new Worker\s*\(/);
  assert.match(service, /await buildServerSnapshotInUtility\(/);
  assert.match(service, /await publishVaultToCloudflareInUtility\(/);
  assert.doesNotMatch(service, /buildServerSnapshot\s*\(/);
  assert.match(vite, /utilityBuild\('serverPublishWorker',\s*'electron\/serverSync\/serverPublishWorker\.ts'\)/);
});
