import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { withServer } from '../../scripts/lib/nodusServerHarness.mjs';

test('a modified publisher cannot place secrets or local paths in a shared snapshot', async () => {
  await withServer({ label: 'publication-secret-strip' }, async (ctx) => {
    const spaceId = await ctx.createSpace('Secret boundary');
    await ctx.setPublicationPolicy(spaceId, ['allowUserContent']);
    const owner = await ctx.deviceToken(ctx.adminEmail, ctx.adminPassword, spaceId);
    const snapshot = {
      format: 'nodus.server-snapshot', formatVersion: 2, schemaVersion: 1, revision: 'secret-test',
      vault: {
        id: spaceId, name: 'Secret boundary', type: 'academic', privateKey: 'vault-private-key-canary',
        metadata: { clientSecret: 'vault-client-secret-canary', safeLabel: 'Allowed metadata' },
      },
      assets: [{ id: 'asset-1', webhookSecret: 'asset-secret-canary', label: 'Safe asset' }], library: null,
      tables: { works: [{
        nodus_id: 'work-1', title: 'Safe', api_key: 'sk-must-never-publish', password: 'secret',
        privateKey: 'row-private-key-canary', clientSecret: 'row-client-secret-canary', secretValue: 'row-secret-value-canary',
        local_path: '/private/file', abstract: 'Allowed',
      }] },
    };
    const upload = await ctx.api(owner.deviceToken, 'PUT', `/api/v1/spaces/${spaceId}/snapshot`, {
      body: gzipSync(Buffer.from(JSON.stringify(snapshot))), headers: { 'content-encoding': 'gzip', 'content-type': 'application/vnd.nodus.snapshot+json' },
    });
    assert.equal(upload.status, 200);
    const downloaded = await ctx.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/snapshot`);
    assert.equal(downloaded.status, 200);
    const published = JSON.parse(Buffer.from(await downloaded.arrayBuffer()).toString('utf8'));
    assert.deepEqual(published.tables.works, [{ nodus_id: 'work-1', title: 'Safe', abstract: 'Allowed' }]);
    const serialized = JSON.stringify(published);
    for (const canary of ['vault-private-key-canary', 'vault-client-secret-canary', 'asset-secret-canary', 'row-private-key-canary', 'row-client-secret-canary', 'row-secret-value-canary']) {
      assert.equal(serialized.includes(canary), false, `${canary} crossed the publication boundary`);
    }
    assert.equal(published.vault.metadata.safeLabel, 'Allowed metadata');
  });
});
