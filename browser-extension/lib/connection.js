// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

export const DEFAULT_NODUS_PORT = 4321;

export function normalizeConnectorPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_NODUS_PORT;
}

export function connectorPortCandidates(preferredPort) {
  return [...new Set([normalizeConnectorPort(preferredPort), DEFAULT_NODUS_PORT])];
}

export async function discoverNodus(preferredPort, probe) {
  for (const port of connectorPortCandidates(preferredPort)) {
    try {
      const health = await probe(port);
      if (health?.ok && health.app === 'nodus') return { port, health };
    } catch {
      // A stale port or another local service must not prevent checking Nodus's default port.
    }
  }
  return null;
}

export function extensionOrigin(getUrl) {
  const url = new URL(getUrl(''));
  if (!/^(?:chrome|moz)-extension:$/.test(url.protocol) || !url.hostname) {
    throw new TypeError('Nodus Connector must run from an installed browser extension.');
  }
  return `${url.protocol}//${url.hostname}`;
}

export async function requestLocalJson(url, options = {}, request = fetch) {
  const response = await request(url, options);
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { error: raw }; }
  return { ok: response.ok, status: response.status, data };
}
