import assert from 'node:assert/strict';
import test from 'node:test';
import { registerOauthClient, withServer } from '../../scripts/lib/nodusServerHarness.mjs';

test('OAuth rejects unknown scopes and malformed PKCE instead of weakening the request', async () => {
  await withServer({ label: 'oauth-security' }, async (ctx) => {
    const client = await registerOauthClient(ctx.origin);
    const base = {
      response_type: 'code', client_id: client.client_id, redirect_uri: client.redirect_uris[0],
      resource: `${ctx.origin}/mcp`, code_challenge_method: 'S256', code_challenge: 'a'.repeat(43),
    };
    const unknown = new URLSearchParams({ ...base, scope: 'materials.read superuser' });
    const unknownResponse = await fetch(`${ctx.origin}/oauth/authorize?${unknown}`, { headers: { cookie: ctx.adminCookie } });
    assert.equal(unknownResponse.status, 400);
    const shortPkce = new URLSearchParams({ ...base, scope: 'materials.read', code_challenge: 'short' });
    const shortResponse = await fetch(`${ctx.origin}/oauth/authorize?${shortPkce}`, { headers: { cookie: ctx.adminCookie } });
    assert.equal(shortResponse.status, 400);
  });
});
