const JSON_LIMIT = 2 * 1024 * 1024;

/** Private notes, collections and AI drafts. The URL deliberately contains no user id. */
export function createArtifactRoutes({ authorize, json, jsonBody, publicUrl, artifacts, privateData, renderPdf }) {
  function sameOrigin(req, res, auth) {
    if (auth.principal.kind !== 'session') return true;
    let origin = String(req.headers.origin || '');
    if (!origin) { try { origin = new URL(String(req.headers.referer || '')).origin; } catch { origin = ''; } }
    const csrf = String(req.headers['x-csrf-token'] || req.headers['x-csrf'] || '');
    if (origin !== new URL(publicUrl()).origin || csrf !== String(auth.principal.session?.csrf || '')) {
      json(res, 403, { error: 'csrf_failed' }); return false;
    }
    return true;
  }

  function me(req, res, mutation = false) {
    const auth = authorize(req, res, {
      via: ['session', 'device', 'oauth'], resource: 'api',
      scope: mutation ? 'materials.write' : 'materials.read',
    });
    if (!auth || (mutation && !sameOrigin(req, res, auth))) return null;
    return auth;
  }

  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/v2/me/artifacts')) return false;
    let segments;
    try { segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); }
    catch { json(res, 400, { error: 'bad_path' }); return true; }
    if (segments[0] !== 'api' || segments[1] !== 'v2' || segments[2] !== 'me' || segments[3] !== 'artifacts') return false;
    const id = segments[4] || null;
    const mutation = !['GET', 'HEAD'].includes(req.method);
    const auth = me(req, res, mutation); if (!auth) return true;

    if (!id && req.method === 'GET') {
      const vaultId = url.searchParams.get('vaultId') || '';
      if (!vaultId) { json(res, 400, { error: 'vault_required' }); return true; }
      const vaultAuth = authorize(req, res, {
        spaceId: vaultId, need: 'read', via: [auth.principal.kind], resource: 'api', scope: 'materials.read',
      });
      if (!vaultAuth) return true;
      let items;
      try {
        items = artifacts.list(auth.user.id, {
          vaultId: vaultAuth.space.id,
          kind: url.searchParams.get('kind') || null,
        });
      } catch (error) {
        json(res, 400, { error: 'invalid_artifact_filter', error_description: String(error?.message || error) }); return true;
      }
      json(res, 200, { artifacts: items }); return true;
    }

    if (!id && req.method === 'POST') {
      const input = await jsonBody(req, JSON_LIMIT);
      const vaultId = String(input.vaultId || '');
      const vaultAuth = authorize(req, res, {
        spaceId: vaultId, need: 'read', via: [auth.principal.kind], resource: 'api', scope: 'materials.write',
      });
      if (!vaultAuth) return true;
      if (input.sourceJobId != null) {
        let sourceJob = null;
        try { sourceJob = privateData?.job(auth.user.id, input.sourceJobId); } catch { sourceJob = null; }
        if (!sourceJob || sourceJob.vaultId !== vaultAuth.space.id || sourceJob.status !== 'completed') {
          json(res, 400, { error: 'invalid_source_job' }); return true;
        }
      }
      try { json(res, 201, { artifact: artifacts.create(auth.user.id, { ...input, vaultId: vaultAuth.space.id }) }); }
      catch (error) { json(res, 400, { error: 'invalid_artifact', error_description: String(error?.message || error) }); }
      return true;
    }

    let artifact = null;
    try { artifact = id ? artifacts.get(auth.user.id, id) : null; }
    catch { json(res, 404, { error: 'artifact_not_found' }); return true; }
    // Cross-user ids and unknown ids are intentionally indistinguishable.
    if (!artifact) { json(res, 404, { error: 'artifact_not_found' }); return true; }
    const artifactVaultAuth = authorize(req, res, {
      spaceId: artifact.vaultId, need: 'read', via: [auth.principal.kind], resource: 'api',
      scope: mutation ? 'materials.write' : 'materials.read',
    });
    if (!artifactVaultAuth) return true;
    if (req.method === 'GET' && segments[5] === 'document.pdf') {
      if (artifact.kind !== 'deep-research' || typeof renderPdf !== 'function') { json(res, 404, { error: 'artifact_not_found' }); return true; }
      let bytes;
      try {
        bytes = await renderPdf({
          title: artifact.title,
          draftMarkdown: artifact.content,
          abstract: artifact.metadata?.objective || '',
        }, { subject: 'Deep Research · privado' });
      } catch (error) {
        json(res, 422, { error: 'unrenderable_artifact', error_description: String(error?.message || error) }); return true;
      }
      const filename = String(artifact.title || 'deep-research').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'deep-research';
      res.writeHead(200, {
        'content-type': 'application/pdf', 'content-length': bytes.length,
        'content-disposition': `inline; filename="${filename}.pdf"`,
        'cache-control': 'private, max-age=0, must-revalidate', 'x-content-type-options': 'nosniff',
      });
      if (req.method === 'HEAD') res.end(); else res.end(bytes);
      return true;
    }
    if (req.method === 'GET') { json(res, 200, { artifact }); return true; }
    if (req.method === 'PATCH') {
      const input = await jsonBody(req, JSON_LIMIT);
      try { json(res, 200, { artifact: artifacts.update(auth.user.id, id, input) }); }
      catch (error) { json(res, 400, { error: 'invalid_artifact', error_description: String(error?.message || error) }); }
      return true;
    }
    if (req.method === 'DELETE') {
      artifacts.remove(auth.user.id, id);
      json(res, 200, { ok: true }); return true;
    }
    json(res, 405, { error: 'method_not_allowed' }); return true;
  }

  return { handle };
}
