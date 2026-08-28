import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { withServer } from '../../scripts/lib/nodusServerHarness.mjs';

const TYPES = ['academic', 'estudio', 'primary_sources', 'genealogy', 'prosopography', 'databases', 'testimonios', 'worldbuilding', 'docencia'];
const HOME_COLLECTION = {
  academic: 'ideas', estudio: 'study-courses', primary_sources: 'archive-items',
  genealogy: 'persons', prosopography: 'persons', databases: 'databases',
  testimonios: 'testimony-interviews', worldbuilding: 'world-entries', docencia: 'teaching-exams',
};

async function nativeRequest(ctx, method, pathname, json, cookie = ctx.adminCookie) {
  const headers = { cookie, origin: ctx.origin };
  if (json !== undefined) { headers['content-type'] = 'application/json'; headers['x-csrf-token'] = await ctx.csrf(cookie); }
  return fetch(`${ctx.origin}${pathname}`, { method, headers, ...(json === undefined ? {} : { body: JSON.stringify(json) }) });
}

test('server-native lifecycle supports all nine vault types and keeps metadata in SQLite', async () => {
  await withServer({ label: 'native-lifecycle' }, async (ctx) => {
    const created = [];
    let response;
    for (const type of TYPES) {
      response = await nativeRequest(ctx, 'POST', '/api/v2/vaults', { name: `Native ${type}`, vaultType: type });
      assert.equal(response.status, 201, type);
      const payload = await response.json(); created.push(payload.vault);
      assert.equal(payload.vault.storageKind, 'server_native');
      assert.equal(payload.vault.authorityMode, 'server');
      assert.equal(payload.vault.schemaVersion, 166);
      assert.equal(payload.vault.initializationState, 'ready');
      assert.ok(fs.existsSync(`${ctx.root}/vaults/${payload.vault.id}/vault.sqlite`));
    }
    const list = await nativeRequest(ctx, 'GET', '/api/v2/vaults');
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json()).vaults.map((vault) => vault.vaultType).sort(), [...TYPES].sort());

    // The existing web contract must be able to open every newly-created native
    // vault before it has a published snapshot. Collection reads are an empty,
    // revisioned projection; private annotations stay on their own API route.
    for (const vault of created) {
      response = await nativeRequest(ctx, 'GET', `/api/v1/spaces/${vault.id}`);
      assert.equal(response.status, 200, `${vault.vaultType} summary`);
      assert.equal((await response.json()).vault.type, vault.vaultType);
      response = await nativeRequest(ctx, 'GET', `/api/v1/spaces/${vault.id}/${HOME_COLLECTION[vault.vaultType]}`);
      assert.equal(response.status, 200, `${vault.vaultType} Home collection`);
      assert.deepEqual((await response.json()).items, []);
      response = await nativeRequest(ctx, 'GET', `/api/v1/spaces/${vault.id}/personal-annotations`);
      assert.equal(response.status, 200, `${vault.vaultType} private annotations`);
      assert.deepEqual((await response.json()).annotations, []);
    }

    const vault = created[0];
    response = await nativeRequest(ctx, 'PATCH', `/api/v2/vaults/${vault.id}`, { name: 'Renamed', expectedRevision: 0 });
    assert.equal(response.status, 200); const renamed = (await response.json()).vault;
    assert.equal(renamed.revision, 1); assert.equal(renamed.name, 'Renamed');
    response = await nativeRequest(ctx, 'GET', `/api/v1/spaces/${vault.id}`);
    assert.equal(response.status, 200); assert.equal((await response.json()).vault.type, 'academic');
    response = await nativeRequest(ctx, 'GET', `/api/v1/spaces/${vault.id}/ideas`);
    assert.equal(response.status, 200); assert.deepEqual((await response.json()).items, []);
    response = await nativeRequest(ctx, 'PATCH', `/api/v2/vaults/${vault.id}`, { name: 'Stale', expectedRevision: 0 });
    assert.equal(response.status, 409); assert.equal((await response.json()).error, 'revision_conflict');

    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/commands`, { kind: 'pages.update', idempotencyKey: 'native-test-1', expectedRevision: 1, payload: { pageId: 'p1' } });
    assert.equal(response.status, 201); const command = (await response.json()).command;
    assert.equal(command.status, 'queued');
    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/commands`, { kind: 'pages.update', idempotencyKey: 'native-test-1', expectedRevision: 1, payload: { pageId: 'p1' } });
    assert.equal(response.status, 200); assert.equal((await response.json()).duplicate, true);
    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/commands`, { kind: 'pages.update', idempotencyKey: 'native-test-1', expectedRevision: 1, payload: { pageId: 'other' } });
    assert.equal(response.status, 409);

    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/duplicate`, { name: 'Duplicate' });
    assert.equal(response.status, 201); const duplicate = (await response.json()).vault;
    assert.equal(duplicate.storageKind, 'server_native');
    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${duplicate.id}/reset`, { expectedRevision: 0 });
    assert.equal(response.status, 200); assert.equal((await response.json()).vault.revision, 1);

    response = await nativeRequest(ctx, 'GET', `/api/v2/vaults/${vault.id}/export`);
    assert.equal(response.status, 200); const exported = Buffer.from(await response.arrayBuffer()); assert.ok(exported.length > 1000);
    response = await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/import`, { base64: exported.toString('base64'), expectedRevision: 1 });
    assert.equal(response.status, 200); assert.equal((await response.json()).vault.id, vault.id);
    response = await fetch(`${ctx.origin}/api/v2/vaults/${vault.id}/import`, { method: 'POST', headers: { cookie: ctx.adminCookie, origin: ctx.origin, 'content-type': 'application/vnd.sqlite3', 'x-csrf-token': await ctx.csrf() }, body: exported });
    assert.equal(response.status, 200); assert.equal((await response.json()).vault.id, vault.id);
    response = await nativeRequest(ctx, 'DELETE', `/api/v2/vaults/${duplicate.id}?expectedRevision=1`, {});
    assert.equal(response.status, 200); assert.equal(fs.existsSync(`${ctx.root}/vaults/${duplicate.id}`), false);
  });
});

test('native vault permissions enforce owner, writer and reader roles', async () => {
  await withServer({ label: 'native-roles' }, async (ctx) => {
    const response = await nativeRequest(ctx, 'POST', '/api/v2/vaults', { name: 'Role vault', vaultType: 'academic' });
    const vault = (await response.json()).vault;
    const writer = { email: 'native-writer@example.test', password: 'native-writer-password' };
    const reader = { email: 'native-reader@example.test', password: 'native-reader-password' };
    await ctx.createUser(writer.email, writer.password, [{ spaceId: vault.id, role: 'writer' }]);
    await ctx.createUser(reader.email, reader.password, [{ spaceId: vault.id, role: 'reader' }]);
    const writerCookie = await ctx.signIn(writer.email, writer.password);
    const readerCookie = await ctx.signIn(reader.email, reader.password);
    const writerDevice = await ctx.deviceToken(writer.email, writer.password, vault.id, 'Native writer device');
    assert.equal((await nativeRequest(ctx, 'GET', `/api/v2/vaults/${vault.id}`, undefined, readerCookie)).status, 200);
    assert.equal((await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/commands`, { kind: 'pages.update', idempotencyKey: 'reader', expectedRevision: 0, payload: {} }, readerCookie)).status, 403);
    assert.equal((await nativeRequest(ctx, 'POST', `/api/v2/vaults/${vault.id}/commands`, { kind: 'pages.update', idempotencyKey: 'writer', expectedRevision: 0, payload: {} }, writerCookie)).status, 201);
    assert.equal((await ctx.api(writerDevice.deviceToken, 'POST', `/api/v2/vaults/${vault.id}/commands`, { json: { kind: 'pages.update', idempotencyKey: 'writer-device', expectedRevision: 0, payload: {} } })).status, 201);
    assert.equal((await nativeRequest(ctx, 'PATCH', `/api/v2/vaults/${vault.id}`, { name: 'Nope', expectedRevision: 0 }, writerCookie)).status, 403);
  });
});
