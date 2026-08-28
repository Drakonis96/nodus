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

    const rootApp = await sessionFetch(server.origin, cookieA, '/', { headers: { 'sec-fetch-dest': 'document' } });
    assert.equal(rootApp.status, 200, 'the authenticated browser app is canonical at the web root');
    assert.match(rootApp.headers.get('content-security-policy') || '', /connect-src 'self'/);
    assert.match(rootApp.headers.get('content-security-policy') || '', /worker-src 'self' blob:/);
    assert.match(rootApp.headers.get('content-security-policy') || '', /font-src 'self' data:/);
    assert.match(rootApp.headers.get('content-security-policy') || '', /img-src 'self' data: blob: https:\/\/\*\.tile\.openstreetmap\.org/);
    assert.match(rootApp.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.equal(rootApp.headers.get('x-frame-options'), 'DENY');
    assert.equal(rootApp.headers.get('access-control-allow-origin'), null);
    assert.doesNotMatch(await rootApp.text(), /private-a|My note/);

    // Browser-side navigation can open a published map without touching the
    // network again, but a hard reload starts at the detail URL.  The server
    // must return the authenticated SPA shell for that route so React can
    // resolve the published record; API/static paths must still be handled by
    // their own dispatchers below.
    const mapDeepLink = await sessionFetch(server.origin, cookieA, '/detail/map/world-maps/w-map-1', {
      headers: { 'sec-fetch-dest': 'document' },
    });
    assert.equal(mapDeepLink.status, 200, 'published map deep-links must survive a hard reload');
    assert.match(mapDeepLink.headers.get('content-type') || '', /text\/html/i);
    assert.doesNotMatch(await mapDeepLink.text(), /private-a|My note/);

    const legacyApp = await sessionFetch(server.origin, cookieA, '/app');
    assert.equal(legacyApp.status, 200, 'legacy /app links remain backwards compatible');

    const adminRedirect = await sessionFetch(server.origin, server.adminCookie, '/admin', { redirect: 'manual' });
    assert.equal(adminRedirect.status, 303);
    assert.equal(adminRedirect.headers.get('location'), '/view/settings?tab=server');

    const embeddedAdmin = await sessionFetch(server.origin, server.adminCookie, '/admin/settings?embedded=1&theme=light');
    assert.equal(embeddedAdmin.status, 200);
    assert.equal(embeddedAdmin.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(embeddedAdmin.headers.get('content-security-policy') || '', /frame-ancestors 'self'/);
    assert.doesNotMatch(await embeddedAdmin.text(), /class="site-header"/);

    const embeddedValidationError = await postForm(`${server.origin}/admin/spaces/name`, {
      csrf: await server.csrf(), spaceId, name: '',
    }, { headers: { cookie: server.adminCookie, referer: `${server.origin}/admin/settings?embedded=1&theme=light` } });
    assert.equal(embeddedValidationError.status, 400);
    assert.equal(embeddedValidationError.headers.get('x-frame-options'), 'SAMEORIGIN');
    const embeddedErrorHtml = await embeddedValidationError.text();
    assert.match(embeddedErrorHtml, /<html class="light"/);
    assert.doesNotMatch(embeddedErrorHtml, /class="site-header"/);

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

test('integrated Server settings use a native JSON control plane with admin, owner and CSRF gates', { timeout: 60_000 }, async () => {
  await withServer({ label: 'server-web-admin-json' }, async (server) => {
    const headers = (csrf) => ({
      cookie: server.adminCookie,
      'content-type': 'application/json',
      'x-csrf-token': csrf,
      origin: server.origin,
      'sec-fetch-site': 'same-origin',
    });
    const initial = await json(await sessionFetch(server.origin, server.adminCookie, '/api/v1/web/admin'));
    assert.equal(initial.response.status, 200);
    assert.equal(initial.value.server.publicUrl, server.origin);
    assert.equal(initial.value.spaces.length, 0);
    assert.ok(initial.value.csrfToken);

    const refused = await sessionFetch(server.origin, server.adminCookie, '/api/v1/web/admin/spaces', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'No CSRF' }),
    });
    assert.equal(refused.status, 403);

    const created = await json(await sessionFetch(server.origin, server.adminCookie, '/api/v1/web/admin/spaces', {
      method: 'POST', headers: headers(initial.value.csrfToken), body: JSON.stringify({ name: 'Corpus JSON', description: 'Integrado', vaultType: 'academic' }),
    }));
    assert.equal(created.response.status, 201);
    const spaceId = created.value.space.id;
    assert.equal(created.value.space.name, 'Corpus JSON');

    const patched = await json(await sessionFetch(server.origin, server.adminCookie, `/api/v1/web/admin/spaces/${spaceId}`, {
      method: 'PATCH', headers: headers(initial.value.csrfToken), body: JSON.stringify({
        name: 'Corpus nativo',
        publicationPolicy: { allowUserContent: true, allowLibraryDocuments: true, allowPassages: true },
      }),
    }));
    assert.equal(patched.response.status, 200);
    assert.equal(patched.value.space.name, 'Corpus nativo');
    assert.equal(patched.value.space.publicationPolicy.allowUserContent, true);
    assert.equal(patched.value.space.publicationPolicy.allowVectors, false, 'an omitted lane retains its restrictive value');

    const pairing = await json(await sessionFetch(server.origin, server.adminCookie, `/api/v1/web/admin/spaces/${spaceId}/pairing`, {
      method: 'POST', headers: headers(initial.value.csrfToken), body: '{}',
    }));
    assert.equal(pairing.response.status, 201);
    assert.match(pairing.value.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const paired = await server.pair(pairing.value.code, 'Native settings device');

    const userCreated = await json(await sessionFetch(server.origin, server.adminCookie, '/api/v1/web/admin/users', {
      method: 'POST', headers: headers(initial.value.csrfToken), body: JSON.stringify({
        email: 'native-reader@example.test', password: 'native-reader-password', memberships: [{ spaceId, role: 'reader' }],
      }),
    }));
    assert.equal(userCreated.response.status, 201);
    const userId = userCreated.value.user.id;
    assert.deepEqual(userCreated.value.user.memberships, [{ spaceId, role: 'reader' }]);

    const access = await json(await sessionFetch(server.origin, server.adminCookie, `/api/v1/web/admin/users/${userId}/access`, {
      method: 'PATCH', headers: headers(initial.value.csrfToken), body: JSON.stringify({ memberships: [{ spaceId, role: 'writer' }] }),
    }));
    assert.equal(access.response.status, 200);
    assert.deepEqual(access.value.user.memberships, [{ spaceId, role: 'writer' }]);

    const refreshed = await json(await sessionFetch(server.origin, server.adminCookie, '/api/v1/web/admin'));
    const device = refreshed.value.devices.find((entry) => entry.deviceName === 'Native settings device');
    assert.ok(device);
    assert.notEqual(device.id, paired.accessToken, 'the raw bearer token is never returned');
    const revoked = await json(await sessionFetch(server.origin, server.adminCookie, `/api/v1/web/admin/devices/${encodeURIComponent(device.id)}`, {
      method: 'DELETE', headers: headers(initial.value.csrfToken),
    }));
    assert.equal(revoked.response.status, 200);
    assert.equal((await json(await sessionFetch(server.origin, server.adminCookie, '/api/v1/web/admin'))).value.devices.length, 0);

    const readerCookie = await server.signIn('native-reader@example.test', 'native-reader-password');
    const me = await json(await sessionFetch(server.origin, readerCookie, '/api/v1/web/me'));
    const changed = await json(await sessionFetch(server.origin, readerCookie, '/api/v1/web/account/password', {
      method: 'PUT', headers: {
        cookie: readerCookie, 'content-type': 'application/json', 'x-csrf-token': me.value.csrfToken,
        origin: server.origin, 'sec-fetch-site': 'same-origin',
      }, body: JSON.stringify({ currentPassword: 'native-reader-password', newPassword: 'native-reader-password-2', confirmPassword: 'native-reader-password-2' }),
    }));
    assert.equal(changed.response.status, 200);
    assert.equal((await server.signIn('native-reader@example.test', 'native-reader-password-2')).startsWith('nodus_session='), true);
  });
});
