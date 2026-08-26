import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { withServer } from '../../scripts/lib/nodusServerHarness.mjs';
import { Store } from '../lib/store.mjs';

function hidden(html, name) {
  return html.match(new RegExp(`name="${name}" value="([^"]+)"`))?.[1] || '';
}

test('browser login requires its pre-authentication token and rejects cross-site session swapping', async () => {
  await withServer({ label: 'login-csrf' }, async (ctx) => {
    const page = await fetch(`${ctx.origin}/login?next=/admin`);
    const csrf = hidden(await page.text(), 'csrf');
    const cookie = page.headers.get('set-cookie')?.split(';', 1)[0] || '';
    assert.ok(csrf.length >= 32);
    assert.match(page.headers.get('set-cookie') || '', /HttpOnly/i);
    assert.match(page.headers.get('set-cookie') || '', /SameSite=Strict/i);

    const submit = (fields, headers = {}) => fetch(`${ctx.origin}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(fields),
    });
    const missing = await submit({ email: ctx.adminEmail, password: ctx.adminPassword, next: '/admin' });
    assert.equal(missing.status, 403);
    assert.doesNotMatch(missing.headers.get('set-cookie') || '', /nodus_session=/);

    const crossSite = await submit(
      { csrf, email: ctx.adminEmail, password: ctx.adminPassword, next: '/admin' },
      { cookie, origin: 'https://attacker.example', referer: 'https://attacker.example/form', 'sec-fetch-site': 'cross-site' },
    );
    assert.equal(crossSite.status, 403);
    assert.doesNotMatch(crossSite.headers.get('set-cookie') || '', /nodus_session=/);

    const wrongPassword = await submit(
      { csrf, email: ctx.adminEmail, password: 'incorrect-password', next: '/admin' },
      { cookie, origin: ctx.origin, 'sec-fetch-site': 'same-origin' },
    );
    assert.equal(wrongPassword.status, 401);
    const retryCsrf = hidden(await wrongPassword.text(), 'csrf');
    const retryCookie = wrongPassword.headers.get('set-cookie')?.split(';', 1)[0] || '';
    assert.ok(retryCsrf.length >= 32);
    const retry = await submit(
      { csrf: retryCsrf, email: ctx.adminEmail, password: ctx.adminPassword, next: '/admin' },
      { cookie: retryCookie, origin: ctx.origin, 'sec-fetch-site': 'same-origin' },
    );
    assert.equal(retry.status, 303);

    const chromiumNoReferrer = await submit(
      { csrf, email: ctx.adminEmail, password: ctx.adminPassword, next: '/admin' },
      { cookie, origin: 'null', 'sec-fetch-site': 'same-origin' },
    );
    assert.equal(chromiumNoReferrer.status, 303);
    assert.match(chromiumNoReferrer.headers.get('set-cookie') || '', /nodus_session=/);

    const accepted = await submit(
      { csrf, email: ctx.adminEmail, password: ctx.adminPassword, next: '/admin' },
      { cookie, origin: ctx.origin, referer: `${ctx.origin}/login`, 'sec-fetch-site': 'same-origin' },
    );
    assert.equal(accepted.status, 303);
    assert.equal(accepted.headers.get('location'), '/admin');
    assert.match(accepted.headers.get('set-cookie') || '', /nodus_session=/);

    const language = await fetch(`${ctx.origin}/language`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', referer: `${ctx.origin}//evil.example/path` },
      body: new URLSearchParams({ language: 'es' }),
    });
    assert.equal(language.status, 303);
    assert.equal(language.headers.get('location'), '/');
  });
});

test('environment email rotation revokes every credential even when the password is unchanged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-admin-email-rotation-'));
  try {
    const store = new Store(root);
    store.syncAdminCredentials('old-admin@example.test', 'unchanged-admin-password');
    const admin = store.state.users[0];
    const rawSession = store.createSession(admin.id);
    for (const field of ['oauthCodes', 'accessTokens', 'refreshTokens', 'authTickets', 'pairingCodes', 'deviceTokens']) {
      store.state[field].push({ hash: `${field}-credential`, userId: admin.id, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    }
    store.save();
    store.syncAdminCredentials('new-admin@example.test', 'unchanged-admin-password');
    assert.equal(store.session(rawSession), null);
    assert.equal(store.state.users[0].email, 'new-admin@example.test');
    for (const field of ['sessions', 'oauthCodes', 'accessTokens', 'refreshTokens', 'authTickets', 'pairingCodes', 'deviceTokens']) {
      assert.equal(store.state[field].some((entry) => entry.userId === admin.id), false, `${field} survived email rotation`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
