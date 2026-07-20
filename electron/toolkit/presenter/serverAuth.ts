// PDF Presenter — the pure, security-critical helpers of the mobile-remote server:
// PIN generation/checking and path-traversal guards. Kept Electron-free (only node
// crypto/path) so they can be unit-tested directly (scripts/test-presenter-server.mjs).
// The server (server.ts) wires these to the live http/ws sockets.
import crypto from 'node:crypto';
import path from 'node:path';

/** A fresh 6-digit connection PIN for one presentation session. */
export function makePin(): string {
  return String(crypto.randomInt(100000, 1000000));
}

/** Loopback clients (the app's own windows) never need the PIN. */
export function isLoopback(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  const a = remoteAddress.replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || a === 'localhost';
}

/** A LAN client is admitted only with the correct PIN; loopback is always allowed. */
export function isAuthorized(remoteAddress: string | undefined, providedPin: string | null, pin: string | null): boolean {
  if (isLoopback(remoteAddress)) return true;
  return !!pin && providedPin === pin;
}

/**
 * Resolve the on-disk PDF for a presentation id, or null if the id tries to escape
 * the library directory (path traversal). `id` is reduced to its basename first.
 */
export function safePdfPath(baseDir: string, id: string): string | null {
  const safeId = path.basename(String(id));
  if (!safeId || safeId === '.' || safeId === '..') return null;
  const resolved = path.resolve(baseDir, `${safeId}.pdf`);
  const root = path.resolve(baseDir) + path.sep;
  return resolved.startsWith(root) ? resolved : null;
}

/**
 * Resolve a static file request against the dist directory, or null if it escapes
 * it. `urlPath` is the request path ("/assets/x.js"); "/" maps to the mobile page.
 */
export function safeStaticPath(distDir: string, urlPath: string): string | null {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/presenterRemote.html';
  const resolved = path.resolve(distDir, `.${rel}`);
  const root = path.resolve(distDir) + path.sep;
  return resolved.startsWith(root) ? resolved : null;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
