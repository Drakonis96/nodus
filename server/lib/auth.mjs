// One gate for every authenticated route.
//
// Before this module the checks were scattered: seven call sites did
// `membership(userId, spaceId)` and only asked whether the row existed, and
// `oauthAccess()` hard-coded `entry.resource !== mcpResource()` so a token minted for
// the MCP surface would have been accepted by any future REST route and vice versa.
//
// Two invariants live here and nowhere else:
//   1. The role is read LIVE from `store.state.memberships` on every request, never from
//      a copy embedded in the token, so revoking access takes effect immediately.
//   2. The scope narrows, the role decides. An OAuth token carrying `materials.write`
//      over a `reader` membership gets 403. The reverse never happens.

import { digest } from './store.mjs';
import { json } from './http.mjs';
import { can, normalizeSpaceRole } from './roles.mjs';

/** Replica tokens expire, publisher tokens do not. Sliding: every use pushes it out. */
export const REPLICA_TOKEN_DAYS = 180;

export function bearer(req) {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function notExpired(entry, now) {
  return !entry?.expiresAt || Date.parse(entry.expiresAt) > now;
}

/**
 * `resourceFor` is a function, not a map: the public URL is only settled once /setup has
 * run, so a value captured at construction time would freeze the pre-setup origin into
 * every token comparison.
 */
export function createAuthorizer({ store, resourceFor, publicUrl }) {
  function membership(userId, spaceId) {
    return store.state.memberships.find((entry) => entry.userId === userId && entry.spaceId === spaceId) ?? null;
  }

  function spaceRole(userId, spaceId) {
    const entry = membership(userId, spaceId);
    return entry ? normalizeSpaceRole(entry.role) : null;
  }

  function protectedResourceMetadata(resourceKey) {
    const suffix = new URL(resourceFor(resourceKey)).pathname;
    return `${publicUrl()}/.well-known/oauth-protected-resource${suffix}`;
  }

  function challenge(res, { resource = 'mcp', scope = 'materials.read' } = {}) {
    json(res, 401, { error: 'unauthorized', error_description: 'Sign in to Nodus to continue.' }, {
      'www-authenticate': `Bearer resource_metadata="${protectedResourceMetadata(resource)}", scope="${scope}"`,
    });
    return null;
  }

  function forbidden(res, required, actual) {
    json(res, 403, { error: 'forbidden', error_description: 'Your access to this space does not allow that.', required, actual });
    return null;
  }

  /** Device tokens are bound to one space and carry no scopes: they are desktop clients. */
  function deviceFor(raw, spaceId, now) {
    if (!raw) return null;
    const device = store.state.deviceTokens.find((entry) => entry.hash === digest(raw));
    if (!device || !notExpired(device, now)) return null;
    if (spaceId && device.spaceId !== spaceId) return null;
    return device;
  }

  function oauthFor(raw, resourceKey, scope, now) {
    if (!raw) return null;
    store.cleanup(now);
    const entry = store.state.accessTokens.find((candidate) => candidate.hash === digest(raw));
    if (!entry) return null;
    if (entry.resource !== resourceFor(resourceKey)) return null;
    if (scope && !entry.scopes.includes(scope)) return null;
    return entry;
  }

  function sessionFrom(req, cookieValue) {
    const raw = cookieValue || String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('nodus_session='))?.slice('nodus_session='.length) || '';
    try { return store.session(decodeURIComponent(raw)); } catch { return null; }
  }

  /**
   * Resolve who is calling and whether they may do it.
   *
   * Returns `null` after writing the failure response, so every caller reads:
   *   const auth = authorize(req, res, {...}); if (!auth) return;
   */
  function authorize(req, res, options = {}) {
    const {
      spaceId = null,
      need = 'read',
      via = ['device', 'oauth'],
      resource = 'api',
      scope = null,
      sessionCookie = null,
      // Some device-only control-plane routes are server-wide URLs even though the
      // credential itself is bound to one space. Resolve that binding here so those
      // routes do not reimplement expiry, user, membership and role checks by hand.
      boundSpace = false,
    } = options;
    const now = Date.now();
    const raw = bearer(req);
    let principal = null;
    let user = null;
    let device = null;
    let touched = false;

    if (via.includes('device')) {
      device = deviceFor(raw, spaceId, now);
      if (device) {
        user = store.state.users.find((entry) => entry.id === device.userId) ?? null;
        if (user) {
          principal = { kind: 'device', id: device.hash };
          device.lastUsedAt = new Date(now).toISOString();
          if (device.kind === 'replica') {
            device.expiresAt = new Date(now + REPLICA_TOKEN_DAYS * 86400_000).toISOString();
          }
          touched = true;
        } else {
          device = null;
        }
      }
    }

    if (!principal && via.includes('oauth')) {
      const entry = oauthFor(raw, resource, scope, now);
      if (entry) {
        user = store.state.users.find((candidate) => candidate.id === entry.userId) ?? null;
        if (user) principal = { kind: 'oauth', id: entry.hash, token: entry };
      }
    }

    if (!principal && via.includes('session')) {
      const current = sessionFrom(req, sessionCookie);
      if (current) {
        user = current.user;
        principal = { kind: 'session', id: current.session.hash, session: current.session };
      }
    }

    if (!principal || !user) {
      if (touched) store.save();
      return challenge(res, { resource, scope: scope || 'materials.read' });
    }

    const authorizedSpaceId = spaceId || (boundSpace ? device?.spaceId : null);
    if (!authorizedSpaceId) {
      if (touched) store.save();
      return { principal, user, device, space: null, role: null };
    }

    const space = store.state.spaces.find((entry) => entry.id === authorizedSpaceId) ?? null;
    let role = space ? spaceRole(user.id, space.id) : null;

    // `grandfathered` is migration metadata, not an authorization bypass. It keeps the
    // historical token kind, but a live membership role (including a deliberate demotion)
    // always wins and a revoked membership never comes back through an old token.

    if (touched) store.save();

    // An unauthorized space and a non-existent one answer identically: membership is
    // not something an outsider gets to probe.
    if (!space || !role) return forbidden(res, need, null);
    if (!can(role, need)) return forbidden(res, need, role);
    return { principal, user, device, space, role };
  }

  return { authorize, membership, spaceRole, challenge, forbidden, protectedResourceMetadata, deviceFor };
}
