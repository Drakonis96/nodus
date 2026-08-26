import assert from 'node:assert/strict';
import test from 'node:test';
import { withServer } from './lib/nodusServerHarness.mjs';

test('the classic server queues and delivers typed Desktop actions', { timeout: 60_000 }, async () => {
  await withServer({ label: 'space-actions' }, async (server) => {
    const spaceId = await server.createSpace('Typed actions');
    await server.createUser('writer-actions@example.test', 'writer-actions-password', [{ spaceId, role: 'writer' }]);
    const phone = await server.deviceToken(
      'writer-actions@example.test',
      'writer-actions-password',
      spaceId,
      'Writer phone',
    );
    const endpoint = `/api/v1/spaces/${spaceId}/actions`;
    const action = {
      id: 'action-author-1',
      idempotencyKey: 'ios:author-synthesis:1',
      kind: 'author.synthesis.generate',
      schemaVersion: 1,
      payload: { authorId: 'author-1' },
    };

    const capabilities = await (await server.api(null, 'GET', '/api/v1/capabilities')).json();
    assert.equal(capabilities.spaceActions.schemaVersion, 1);

    const created = await server.api(phone.deviceToken, 'POST', endpoint, { json: action });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).action.status, 'queued');

    const duplicate = await server.api(phone.deviceToken, 'POST', endpoint, {
      json: { ...action, id: 'action-author-duplicate' },
    });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).duplicate, true);

    const listed = await (await server.api(phone.deviceToken, 'GET', endpoint)).json();
    assert.equal(listed.actions.length, 1);
    assert.equal(listed.actions[0].kind, 'author.synthesis.generate');

    const ownerReplica = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId, 'Owner phone');
    const ownerList = await (await server.api(ownerReplica.deviceToken, 'GET', endpoint)).json();
    assert.equal(ownerList.actions.length, 0, 'vault owners cannot read another user\'s private job payload/result');
    const ownerIdor = await server.api(ownerReplica.deviceToken, 'GET', `${endpoint}/${action.id}`);
    assert.equal(ownerIdor.status, 404);

    const replicaClaim = await server.api(phone.deviceToken, 'POST', `${endpoint}/claim`, { json: {} });
    assert.equal(replicaClaim.status, 403, 'a replica token cannot claim Desktop work');

    const desktop = await server.pair(await server.pairingCode(spaceId), 'Owner Desktop');
    const claimed = await server.api(desktop.accessToken, 'POST', `${endpoint}/claim`, { json: {} });
    assert.equal(claimed.status, 200);
    assert.equal((await claimed.json()).action, null, 'a publisher cannot claim another user\'s private prompt');

    const leakedSecret = await server.api(phone.deviceToken, 'POST', endpoint, { json: {
      ...action, id: 'action-secret', idempotencyKey: 'ios:secret:1', payload: { secretValue: 'sk-must-not-persist' },
    } });
    assert.equal(leakedSecret.status, 400);
    assert.equal((await leakedSecret.json()).error, 'payload_contains_secret');
  });
});
