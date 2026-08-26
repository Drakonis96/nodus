import assert from 'node:assert/strict';
import test from 'node:test';
import { academicSnapshot, publish } from './lib/nodusServerFixtures.mjs';
import { postForm, withServer } from './lib/nodusServerHarness.mjs';

async function json(response) {
  const value = await response.json();
  return { response, value };
}

function sessionFetch(origin, cookie, pathname, options = {}) {
  return fetch(`${origin}${pathname}`, {
    ...options,
    headers: { cookie, ...(options.headers || {}) },
  });
}

test('Server web sessions are read-only while personal annotations stay private and CSRF protected', { timeout: 60_000 }, async () => {
  await withServer({ label: 'server-web-security' }, async (server) => {
    const spaceId = await server.createSpace('Secure corpus');
    const owner = await server.deviceToken(server.adminEmail, server.adminPassword, spaceId, 'Publisher');
    await server.createUser('reader-a@example.test', 'reader-a-password-strong', [{ spaceId, role: 'reader' }]);
    await server.createUser('reader-b@example.test', 'reader-b-password-strong', [{ spaceId, role: 'reader' }]);

    const snapshot = academicSnapshot({ tables: {
      social_contacts: [{ id: 'contact-1', email: 'private@example.test' }],
      study_attempts: [{ id: 'attempt-1', score: 42 }],
    } });
    await publish(server.origin, owner.deviceToken, spaceId, snapshot);

    const cookieA = await server.signIn('reader-a@example.test', 'reader-a-password-strong');
    const cookieB = await server.signIn('reader-b@example.test', 'reader-b-password-strong');
    const meA = await json(await sessionFetch(server.origin, cookieA, '/api/v1/web/me'));
    assert.equal(meA.response.status, 200);
    assert.ok(meA.value.csrfToken);
    assert.equal(meA.value.spaces[0].role, 'reader');
    assert.equal(meA.response.headers.get('access-control-allow-origin'), null);

    const context = await json(await sessionFetch(server.origin, cookieA, `/api/v1/spaces/${spaceId}/context`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'memoria', budget: 32_000 }),
    }));
    assert.equal(context.response.status, 200, 'a read-only browser session can retrieve its own vault context');
    assert.equal(context.value.stats.budget, 32_000);
    assert.ok(context.value.sections.some((section) => section.kind === 'ideas'));

    const endpoint = `/api/v1/spaces/${spaceId}/personal-annotations`;
    const annotation = { id: 'private-a', resource: 'works', documentId: 'w-1', kind: 'highlight', quote: '<b>selected</b>', content: '<script>alert(1)</script>My note', baseVersion: 0 };
    const missingOrigin = await sessionFetch(server.origin, cookieA, endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': meA.value.csrfToken }, body: JSON.stringify(annotation),
    });
    assert.equal(missingOrigin.status, 403);
    const crossOrigin = await sessionFetch(server.origin, cookieA, endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': meA.value.csrfToken, origin: 'https://attacker.example' }, body: JSON.stringify(annotation),
    });
    assert.equal(crossOrigin.status, 403);

    const created = await json(await sessionFetch(server.origin, cookieA, endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': meA.value.csrfToken, origin: server.origin, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(annotation),
    }));
    assert.equal(created.response.status, 200);
    assert.equal(created.value.version, 1);
    assert.equal(created.value.annotations[0].content, 'My note');
    assert.equal(created.value.annotations[0].quote, 'selected');

    const stale = await sessionFetch(server.origin, cookieA, endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': meA.value.csrfToken, origin: server.origin }, body: JSON.stringify({ ...annotation, id: 'stale' }),
    });
    assert.equal(stale.status, 409);

    const mine = await json(await sessionFetch(server.origin, cookieA, `${endpoint}?resource=works&documentId=w-1`));
    const theirs = await json(await sessionFetch(server.origin, cookieB, `${endpoint}?resource=works&documentId=w-1`));
    const adminView = await json(await sessionFetch(server.origin, server.adminCookie, `${endpoint}?resource=works&documentId=w-1`));
    assert.deepEqual(mine.value.annotations.map((entry) => entry.id), ['private-a']);
    assert.deepEqual(theirs.value.annotations, []);
    assert.deepEqual(adminView.value.annotations, []);

    const deviceCannotReadOverlay = await server.api(owner.deviceToken, 'GET', endpoint);
    assert.ok([401, 403].includes(deviceCannotReadOverlay.status));
    const sessionCannotPublish = await sessionFetch(server.origin, cookieA, `/api/v1/spaces/${spaceId}/snapshot`, { method: 'PUT', body: Buffer.from('not a snapshot') });
    assert.ok([401, 403].includes(sessionCannotPublish.status));

    const canonicalResponse = await server.api(owner.deviceToken, 'GET', `/api/v1/spaces/${spaceId}/snapshot`);
    assert.equal(canonicalResponse.status, 200);
    const canonical = JSON.parse(Buffer.from(await canonicalResponse.arrayBuffer()).toString('utf8'));
    for (const table of ['writing_draft_annotations', 'social_contacts', 'study_attempts', 'passages', 'notes']) {
      assert.equal(canonical.tables[table], undefined, `${table} must not be canonical under the restrictive policy`);
    }

    const app = await sessionFetch(server.origin, cookieA, '/app');
    assert.equal(app.status, 200);
    assert.match(app.headers.get('content-security-policy') || '', /connect-src 'self'/);
    assert.match(app.headers.get('content-security-policy') || '', /worker-src 'self' blob:/);
    assert.match(app.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.equal(app.headers.get('x-frame-options'), 'DENY');
    assert.equal(app.headers.get('access-control-allow-origin'), null);
    assert.doesNotMatch(await app.text(), /private-a|My note/);

    const state = await server.readState();
    const readerA = state.users.find((entry) => entry.email === 'reader-a@example.test');
    const revoked = await postForm(`${server.origin}/admin/access/revoke`, { csrf: await server.csrf(), userId: readerA.id, spaceId }, { headers: { cookie: server.adminCookie } });
    assert.equal(revoked.status, 303);
    assert.equal((await sessionFetch(server.origin, cookieA, `/api/v1/spaces/${spaceId}`)).status, 403);
    assert.equal((await sessionFetch(server.origin, cookieA, `/api/v1/spaces/${spaceId}/context`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'memoria', budget: 32_000 }),
    })).status, 403, 'revocation also closes the AI retrieval context route');
  });
});
