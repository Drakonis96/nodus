import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { withServer } from '../../scripts/lib/nodusServerHarness.mjs';

async function api(origin, cookie, csrf, pathname, method = 'GET', value) {
  return fetch(`${origin}${pathname}`, {
    method,
    headers: {
      cookie,
      ...(csrf ? { origin, 'x-csrf-token': csrf } : {}),
      ...(value !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(value !== undefined ? { body: JSON.stringify(value) } : {}),
  });
}

test('private artifacts are vault-authorized, user-isolated and secret-redacted', async () => {
  await withServer({ label: 'user-artifacts', ai: true }, async (ctx) => {
    const vaultId = await ctx.createSpace('Shared vault');
    const otherVaultId = await ctx.createSpace('Other vault');
    const alpha = await ctx.createUser('artifact-alpha@example.test', 'artifact-alpha-password-long', [{ spaceId: vaultId, role: 'reader' }]);
    const beta = await ctx.createUser('artifact-beta@example.test', 'artifact-beta-password-long', [{ spaceId: vaultId, role: 'reader' }]);
    const alphaCookie = await ctx.signIn(alpha.email, alpha.password);
    const betaCookie = await ctx.signIn(beta.email, beta.password);
    const alphaCsrf = await ctx.csrf(alphaCookie);
    const betaCsrf = await ctx.csrf(betaCookie);
    const secret = 'sk-artifact-secret-1234567890123456';

    const created = await api(ctx.origin, alphaCookie, alphaCsrf, '/api/v2/me/artifacts', 'POST', {
      vaultId, kind: 'workspace-note', title: 'Private note', content: `do not persist ${secret}`,
      ownerUserId: 'forged-beta', metadata: { apiKey: secret },
    });
    assert.equal(created.status, 201);
    const artifact = (await created.json()).artifact;
    assert.equal(artifact.content.includes(secret), false);
    assert.equal(artifact.metadata.apiKey, '[REDACTED]');

    const own = await api(ctx.origin, alphaCookie, null, `/api/v2/me/artifacts?vaultId=${vaultId}`);
    assert.equal(own.status, 200);
    assert.deepEqual((await own.json()).artifacts.map((entry) => entry.id), [artifact.id]);
    assert.equal((await api(ctx.origin, alphaCookie, null, '/api/v2/me/artifacts')).status, 400);
    assert.equal((await api(ctx.origin, betaCookie, null, `/api/v2/me/artifacts/${artifact.id}`)).status, 404);
    assert.equal((await api(ctx.origin, betaCookie, betaCsrf, `/api/v2/me/artifacts/${artifact.id}`, 'PATCH', { content: 'stolen' })).status, 404);
    assert.equal((await api(ctx.origin, alphaCookie, alphaCsrf, '/api/v2/me/artifacts', 'POST', { vaultId: otherVaultId, kind: 'workspace-note', content: 'no access' })).status, 403);
    assert.equal((await api(ctx.origin, alphaCookie, alphaCsrf, '/api/v2/me/artifacts', 'POST', { vaultId, kind: 'deep-research', sourceJobId: 'job_forged', content: 'forged provenance' })).status, 400);
    assert.equal((await api(ctx.origin, alphaCookie, null, '/api/v2/me/artifacts/%E0%A4%A')).status, 400);
    assert.equal((await api(ctx.origin, alphaCookie, null, '/api/v2/me/jobs/%E0%A4%A')).status, 400);
    assert.equal((await api(ctx.origin, alphaCookie, null, '/api/v1/spaces/%E0%A4%A/snapshot')).status, 400);

    const state = await ctx.readState();
    const alphaUserId = state.users.find((entry) => entry.email === alpha.email).id;
    await ctx.revokeAccess(alphaUserId, vaultId);
    assert.equal((await api(ctx.origin, alphaCookie, null, `/api/v2/me/artifacts/${artifact.id}`)).status, 403, 'revoked members cannot retain artifact access through an old session');
    assert.equal((await api(ctx.origin, alphaCookie, null, `/api/v2/me/artifacts?vaultId=${vaultId}`)).status, 403);

    const files = await fs.readdir(path.join(ctx.root, 'private', 'users'), { withFileTypes: true });
    const artifactFiles = [];
    for (const entry of files) if (entry.isDirectory()) {
      const file = path.join(ctx.root, 'private', 'users', entry.name, 'artifacts.json');
      try { artifactFiles.push(await fs.readFile(file, 'utf8')); } catch { /* user has no artifacts */ }
    }
    assert.equal(artifactFiles.join('\n').includes(secret), false);
  });
});

test('deep-research artifacts export as a private binary PDF', async () => {
  await withServer({ label: 'user-artifacts-pdf', ai: true }, async (ctx) => {
    const vaultId = await ctx.createSpace('PDF vault');
    const alpha = await ctx.createUser('artifact-pdf@example.test', 'artifact-pdf-password-long', [{ spaceId: vaultId, role: 'reader' }]);
    const cookie = await ctx.signIn(alpha.email, alpha.password);
    const csrf = await ctx.csrf(cookie);
    const created = await api(ctx.origin, cookie, csrf, '/api/v2/me/artifacts', 'POST', {
      vaultId, kind: 'deep-research', title: 'Informe seguro', content: '# Hallazgo\n\nTexto privado.',
    });
    assert.equal(created.status, 201);
    const artifact = (await created.json()).artifact;
    const pdf = await api(ctx.origin, cookie, null, `/api/v2/me/artifacts/${artifact.id}/document.pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.match(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString('ascii'), /^%PDF-/);
  });
});

test('workspace collections and note lifecycle stay private and metadata-driven', async () => {
  await withServer({ label: 'workspace-artifacts', ai: true }, async (ctx) => {
    const vaultId = await ctx.createSpace('Workspace vault');
    const user = await ctx.createUser('workspace@example.test', 'workspace-password-long', [{ spaceId: vaultId, role: 'reader' }]);
    const cookie = await ctx.signIn(user.email, user.password);
    const csrf = await ctx.csrf(cookie);
    const collectionResponse = await api(ctx.origin, cookie, csrf, '/api/v2/me/artifacts', 'POST', {
      vaultId, kind: 'workspace-collection', title: 'Investigación', content: '',
      metadata: { surface: 'workspace', entity: 'collection', private: true, parentId: null },
    });
    assert.equal(collectionResponse.status, 201);
    const collection = (await collectionResponse.json()).artifact;
    const noteResponse = await api(ctx.origin, cookie, csrf, '/api/v2/me/artifacts', 'POST', {
      vaultId, kind: 'workspace-note', title: 'Apunte', content: '# Markdown',
      metadata: { surface: 'workspace', private: true, folderId: collection.id, tags: ['tesis'] },
    });
    assert.equal(noteResponse.status, 201);
    const note = (await noteResponse.json()).artifact;
    assert.equal(note.metadata.folderId, collection.id);
    const moved = await api(ctx.origin, cookie, csrf, `/api/v2/me/artifacts/${note.id}`, 'PATCH', { metadata: { ...note.metadata, trashedAt: '2026-08-28T00:00:00.000Z' } });
    assert.equal(moved.status, 200);
    assert.equal((await moved.json()).artifact.metadata.trashedAt, '2026-08-28T00:00:00.000Z');
    const listed = await api(ctx.origin, cookie, null, `/api/v2/me/artifacts?vaultId=${vaultId}&kind=workspace-note`);
    assert.deepEqual((await listed.json()).artifacts.map((entry) => entry.id), [note.id]);
    assert.equal((await api(ctx.origin, cookie, csrf, `/api/v2/me/artifacts/${note.id}`, 'DELETE')).status, 200);
    assert.equal((await api(ctx.origin, cookie, null, `/api/v2/me/artifacts/${note.id}`)).status, 404);
  });
});
