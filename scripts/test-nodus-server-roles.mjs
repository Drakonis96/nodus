// Space membership used to be binary: server.mjs called `membership(userId, spaceId)` and
// every caller only asked whether the row existed, so a reader paired to a space could
// publish straight over the owner's corpus. These tests pin the three things that fix:
//
//   • server/lib/roles.mjs — the rank order, and that an unknown role or an unknown
//     requirement denies rather than allows;
//   • the state.json v1→v2 migration, including the `grandfathered` flag without which
//     every already-paired desktop would stop publishing the moment its server upgraded;
//   • server/lib/auth.mjs — that the role is read LIVE on each request, so revoking or
//     downgrading someone takes effect on their very next call with a token they already hold.
//
// Plus the administration surface the roles exist for: granting several spaces at once with
// a different level in each, and changing a level without revoking and re-granting.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { can, migrateState, normalizeSpaceRole, SPACE_ROLES, STATE_VERSION } from '../server/lib/roles.mjs';
import { Store } from '../server/lib/store.mjs';
import { academicSnapshot, publish } from './lib/nodusServerFixtures.mjs';
import { postForm, postJson, withServer } from './lib/nodusServerHarness.mjs';

test('the rank order denies by default in both directions', () => {
  assert.deepEqual(SPACE_ROLES, ['reader', 'writer', 'owner']);
  assert.equal(can('owner', 'own'), true);
  assert.equal(can('owner', 'write'), true);
  assert.equal(can('writer', 'write'), true);
  assert.equal(can('writer', 'own'), false);
  assert.equal(can('reader', 'read'), true);
  assert.equal(can('reader', 'write'), false);
  // An unrecognised role is the least privileged one, never the most.
  assert.equal(normalizeSpaceRole('superuser'), 'reader');
  assert.equal(normalizeSpaceRole(undefined), 'reader');
  assert.equal(can('superuser', 'own'), false);
  // A typo in a route definition must close a door, not open one.
  assert.equal(can('owner', 'publish'), false);
  assert.equal(can('owner', undefined), false);
});

test('a version 1 state file migrates once, keeps its roles, and grandfathers its devices', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nodus-server-state-migration-'));
  try {
    await writeFile(path.join(root, 'state.json'), JSON.stringify({
      version: 1,
      settings: { name: 'Legacy', publicUrl: '', language: 'es' },
      users: [{ id: 'u-1', email: 'a@example.test', role: 'admin', salt: 's', hash: 'h', createdAt: '2026-01-01T00:00:00.000Z' }],
      spaces: [{ id: 'sp-1', name: 'Espacio', description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: null, revision: '', bytes: 0 }],
      // A reader membership on a space this account nevertheless paired and publishes to:
      // exactly the install that a naive "publishing now needs owner" would break.
      memberships: [{ userId: 'u-1', spaceId: 'sp-1', role: 'reader' }],
      deviceTokens: [{ hash: 'devicehash', userId: 'u-1', spaceId: 'sp-1', deviceName: 'Old desktop', createdAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null }],
      sessions: [], pairingCodes: [], oauthClients: [], oauthCodes: [], accessTokens: [], refreshTokens: [],
    }));

    const store = new Store(root);
    assert.equal(store.state.version, STATE_VERSION);
    assert.equal(store.state.memberships[0].role, 'reader', 'an existing role is preserved, not upgraded');
    assert.equal(store.state.deviceTokens[0].grandfathered, true);
    assert.equal(store.state.deviceTokens[0].kind, 'publisher');
    assert.equal(store.state.deviceTokens[0].expiresAt, null);
    assert.equal(store.state.spaces[0].mutationCursor, 0);
    assert.equal(store.state.spaces[0].snapshotFormatVersion, 1);
    assert.equal(store.state.settings.language, 'es', 'the migration does not disturb existing settings');

    // Written through, not just held in memory.
    const onDisk = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8'));
    assert.equal(onDisk.version, STATE_VERSION);

    // Idempotent: a second boot changes nothing and does not re-stamp migratedAt.
    const reopened = new Store(root);
    assert.equal(reopened.migration.migrated, false);
    assert.equal(reopened.state.migratedAt, store.state.migratedAt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('migrateState leaves an already-current state untouched', () => {
  const state = { version: STATE_VERSION, memberships: [{ role: 'writer' }], deviceTokens: [{}], spaces: [{}] };
  const result = migrateState(state);
  assert.equal(result.migrated, false);
  assert.equal(state.deviceTokens[0].grandfathered, undefined, 'a current file is not rewritten');
});

test('a reader cannot publish, a writer cannot drain, and the role is read live', { timeout: 60_000 }, async () => {
  await withServer({ label: 'roles' }, async (server) => {
    const spaceId = await server.createSpace('Corpus compartido');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId, 'Owner desktop');
    assert.equal(owner.role, 'owner', 'the admin who created the space owns it');

    await server.createUser('reader@example.test', 'reader-account-password', [{ spaceId, role: 'reader' }]);
    await server.createUser('writer@example.test', 'writer-account-password', [{ spaceId, role: 'writer' }]);
    const reader = await server.deviceToken('reader@example.test', 'reader-account-password', spaceId);
    const writer = await server.deviceToken('writer@example.test', 'writer-account-password', spaceId);
    assert.equal(reader.role, 'reader');
    assert.equal(writer.role, 'writer');

    const snapshot = academicSnapshot();
    await publish(server.origin, owner.deviceToken, spaceId, snapshot);

    // Publishing is the owner's alone.
    for (const [label, token] of [['reader', reader.deviceToken], ['writer', writer.deviceToken]]) {
      const refused = await fetch(`${server.origin}/api/v1/spaces/${spaceId}/snapshot`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-encoding': 'gzip', 'x-nodus-revision': 'other' },
        body: snapshot.gzipped,
      });
      assert.equal(refused.status, 403, `${label} must not publish`);
      const value = await refused.json();
      assert.equal(value.required, 'own');
      assert.equal(value.actual, label);
    }

    // Reading is everyone's.
    for (const token of [reader.deviceToken, writer.deviceToken, owner.deviceToken]) {
      const response = await server.api(token, 'GET', `/api/v1/spaces/${spaceId}/ideas`);
      assert.equal(response.status, 200);
    }

    // Sending a mutation is the writer's and the owner's; draining the ledger is the owner's.
    const mutation = { mutations: [{ id: 'mut-role-1', kind: 'upsert', table: 'notes', key: ['n-role'], row: { id: 'n-role', title: 'Nota', content: 'x', kind: 'markdown', order_idx: 0, folder_id: null, source_json: null, created_at: '2026-02-02T00:00:00.000Z', updated_at: '2026-02-02T00:00:00.000Z' }, schemaVersion: 121, createdAt: '2026-02-02T00:00:00.000Z' }] };
    assert.equal((await server.api(reader.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: mutation })).status, 403);
    assert.equal((await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, { json: mutation })).status, 200);
    assert.equal((await server.api(writer.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations`)).status, 403, 'a writer must not drain the queue that feeds the owner');
    assert.equal((await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/mutations`)).status, 200);

    // Downgrade the writer with a token it already holds in hand.
    const state = await server.readState();
    const writerUser = state.users.find((user) => user.email === 'writer@example.test');
    await server.setRole(writerUser.id, spaceId, 'reader');
    const afterDowngrade = await server.api(writer.deviceToken, 'POST', `/api/v1/spaces/${spaceId}/mutations`, {
      json: { mutations: [{ ...mutation.mutations[0], id: 'mut-role-2' }] },
    });
    assert.equal(afterDowngrade.status, 403, 'the role is re-read on every request, not cached in the token');
    assert.equal((await server.api(writer.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas`)).status, 200, 'reading still works after the downgrade');

    // Revoking membership outright invalidates the token completely.
    const readerUser = state.users.find((user) => user.email === 'reader@example.test');
    const revoked = await postForm(`${server.origin}/admin/access/revoke`, { csrf: await server.csrf(), userId: readerUser.id, spaceId }, { headers: { cookie: server.adminCookie } });
    assert.equal(revoked.status, 303);
    assert.equal((await server.api(reader.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/ideas`)).status, 401);
  });
});

test('an account can be created with several spaces and a different level in each', { timeout: 60_000 }, async () => {
  await withServer({ label: 'admin-grants' }, async (server) => {
    const alpha = await server.createSpace('Alfa');
    const beta = await server.createSpace('Beta');
    const gamma = await server.createSpace('Gamma');

    await server.createUser('multi@example.test', 'multi-account-password', [
      { spaceId: alpha, role: 'reader' },
      { spaceId: beta, role: 'writer' },
    ]);

    const login = await postJson(`${server.origin}/api/v1/auth/login`, { email: 'multi@example.test', password: 'multi-account-password' });
    assert.equal(login.status, 200);
    const session = await login.json();
    const byId = new Map(session.spaces.map((space) => [space.id, space.role]));
    assert.equal(byId.get(alpha), 'reader');
    assert.equal(byId.get(beta), 'writer');
    assert.equal(byId.has(gamma), false, 'a space that was not ticked is not granted');
    assert.equal(session.spaces.length, 2);

    // A ticket is single use, so a stolen one cannot mint a second device.
    const first = await postJson(`${server.origin}/api/v1/auth/device`, { ticket: session.ticket, spaceId: alpha });
    assert.equal(first.status, 200);
    const replay = await postJson(`${server.origin}/api/v1/auth/device`, { ticket: session.ticket, spaceId: beta });
    assert.equal(replay.status, 401);

    // …and it cannot reach a space the account was never granted.
    const second = await postJson(`${server.origin}/api/v1/auth/login`, { email: 'multi@example.test', password: 'multi-account-password' });
    const other = await postJson(`${server.origin}/api/v1/auth/device`, { ticket: (await second.json()).ticket, spaceId: gamma });
    assert.equal(other.status, 403);

    // The role changes in place, without revoking and re-granting.
    const state = await server.readState();
    const user = state.users.find((entry) => entry.email === 'multi@example.test');
    await server.setRole(user.id, alpha, 'writer');
    const third = await postJson(`${server.origin}/api/v1/auth/login`, { email: 'multi@example.test', password: 'multi-account-password' });
    assert.equal(new Map((await third.json()).spaces.map((space) => [space.id, space.role])).get(alpha), 'writer');

    // The dashboard offers all three levels for an editable membership.
    const dashboard = await server.dashboard();
    for (const role of SPACE_ROLES) assert.match(dashboard, new RegExp(`value="${role}"`), `the ${role} level is offered`);

    // The LAST owner of a space cannot be demoted or revoked: without one, nobody could
    // ever publish there again and no screen could undo it.
    const adminUser = state.users.find((entry) => entry.role === 'admin');
    const lastOwner = await postForm(`${server.origin}/admin/access/role`, { csrf: await server.csrf(), userId: adminUser.id, spaceId: alpha, role: 'reader' }, { headers: { cookie: server.adminCookie } });
    assert.equal(lastOwner.status, 400);
    const lastOwnerRevoke = await postForm(`${server.origin}/admin/access/revoke`, { csrf: await server.csrf(), userId: adminUser.id, spaceId: alpha }, { headers: { cookie: server.adminCookie } });
    assert.equal(lastOwnerRevoke.status, 400);

    // But once a second owner exists, either of them can be changed or removed. Without
    // this, granting owner to a test account would pin it to the space permanently.
    await postForm(`${server.origin}/admin/access/grant`, { csrf: await server.csrf(), userId: user.id, spaceId: beta, role: 'owner' }, { headers: { cookie: server.adminCookie } });
    const secondOwner = await postForm(`${server.origin}/admin/access/role`, { csrf: await server.csrf(), userId: user.id, spaceId: beta, role: 'reader' }, { headers: { cookie: server.adminCookie } });
    assert.equal(secondOwner.status, 303, 'a non-final owner membership can be demoted');
    const unknown = await postForm(`${server.origin}/admin/access/role`, { csrf: await server.csrf(), userId: user.id, spaceId: alpha, role: 'superuser' }, { headers: { cookie: server.adminCookie } });
    assert.equal(unknown.status, 400, 'an unknown level is refused rather than coerced');
  });
});

test('rotating a password revokes the paired devices too', { timeout: 60_000 }, async () => {
  await withServer({ label: 'password-revokes-devices' }, async (server) => {
    const spaceId = await server.createSpace('Corpus');
    await server.createUser('rotate@example.test', 'rotate-account-password', [{ spaceId, role: 'writer' }]);
    const device = await server.deviceToken('rotate@example.test', 'rotate-account-password', spaceId);
    assert.equal((await server.api(device.deviceToken, 'GET', `/api/v1/spaces/${spaceId}`)).status, 200);

    const cookie = await server.signIn('rotate@example.test', 'rotate-account-password');
    const account = await fetch(`${server.origin}/account`, { headers: { cookie } });
    const csrf = (await account.text()).match(/name="csrf" value="([^"]+)"/)[1];
    const changed = await postForm(`${server.origin}/account/password`, {
      csrf, currentPassword: 'rotate-account-password', newPassword: 'rotated-account-password', confirmPassword: 'rotated-account-password',
    }, { headers: { cookie } });
    assert.equal(changed.status, 303);

    // Before this fix a rotated password left every paired desktop publishing as before.
    assert.equal((await server.api(device.deviceToken, 'GET', `/api/v1/spaces/${spaceId}`)).status, 401);
  });
});
