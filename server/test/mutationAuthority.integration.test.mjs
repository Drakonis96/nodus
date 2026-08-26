import assert from 'node:assert/strict';
import test from 'node:test';
import { withServer } from '../../scripts/lib/nodusServerHarness.mjs';
import { academicSnapshot, publish } from '../../scripts/lib/nodusServerFixtures.mjs';

test('mutation ownership and provenance aliases are always server-stamped', async () => {
  await withServer({ label: 'mutation-authority' }, async (ctx) => {
    const spaceId = await ctx.createSpace('Authority vault');
    const owner = await ctx.deviceToken(ctx.adminEmail, ctx.adminPassword, spaceId);
    await ctx.createUser('writer-authority@example.test', 'writer-authority-password', [{ spaceId, role: 'writer' }]);
    const writer = await ctx.deviceToken('writer-authority@example.test', 'writer-authority-password', spaceId);
    await publish(ctx.origin, owner.deviceToken, spaceId, academicSnapshot());
    const response = await ctx.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: { mutations: [{
      id: 'authority-mut-1', clientId: 'forged-client', kind: 'upsert', table: 'workspace_actors', key: ['actor-1'], schemaVersion: 121,
      row: { id: 'actor-1', userId: 'victim', owner_id: 'victim', createdBy: 'victim', vaultId: 'other-vault', originInstanceId: 'other-instance' },
    }] } });
    assert.equal(response.status, 200, await response.text());
    const stream = await (await ctx.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations?since=0`)).json();
    const row = stream.mutations[0].row;
    assert.equal(row.userId, writer.user.id); assert.equal(row.owner_id, writer.user.id); assert.equal(row.createdBy, writer.user.id);
    assert.equal(row.vaultId, spaceId); assert.notEqual(row.originInstanceId, 'other-instance');
    assert.equal(stream.mutations[0].actorId, writer.user.id); assert.equal(stream.mutations[0].vaultId, spaceId);
  });
});
