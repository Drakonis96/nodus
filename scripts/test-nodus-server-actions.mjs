import assert from 'node:assert/strict';
import test from 'node:test';
import { withServer } from './lib/nodusServerHarness.mjs';

test('the classic server queues and delivers typed Desktop actions', { timeout: 60_000 }, async () => {
  await withServer({ label: 'space-actions' }, async (server) => {
    const spaceId = await server.createSpace('Typed actions');
    const phone = await server.deviceToken(
      server.adminEmail,
      server.adminPassword,
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

    const replicaClaim = await server.api(phone.deviceToken, 'POST', `${endpoint}/claim`, { json: {} });
    assert.equal(replicaClaim.status, 403, 'a replica token cannot claim Desktop work');

    const desktop = await server.pair(await server.pairingCode(spaceId), 'Owner Desktop');
    const claimed = await server.api(desktop.accessToken, 'POST', `${endpoint}/claim`, { json: {} });
    assert.equal(claimed.status, 200);
    assert.equal((await claimed.json()).action.status, 'claimed');

    const running = await server.api(
      desktop.accessToken,
      'POST',
      `${endpoint}/${action.id}/status`,
      { json: { status: 'running' } },
    );
    assert.equal(running.status, 200);

    const applied = await server.api(
      desktop.accessToken,
      'POST',
      `${endpoint}/${action.id}/status`,
      { json: { status: 'applied', result: { synthesisId: 'syn-1' } } },
    );
    assert.equal(applied.status, 200);
    const appliedAction = (await applied.json()).action;
    assert.equal(appliedAction.status, 'applied');
    assert.equal(appliedAction.result.synthesisId, 'syn-1');
  });
});
