import { URLSearchParams } from 'node:url';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function cookies(req) {
  return Object.fromEntries((req.headers.cookie ?? '').split(';').map((part) => part.trim()).filter(Boolean).flatMap((part) => {
    const index = part.indexOf('=');
    try {
      return [[decodeURIComponent(index < 0 ? part : part.slice(0, index)), decodeURIComponent(index < 0 ? '' : part.slice(index + 1))]];
    } catch {
      return [];
    }
  }));
}

export async function body(req, limit = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) {
      const error = new Error('The request exceeds the allowed size.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export async function form(req, limit) {
  return Object.fromEntries(new URLSearchParams((await body(req, limit)).toString('utf8')));
}

export async function jsonBody(req, limit) {
  const raw = (await body(req, limit)).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch {
    const error = new Error('Invalid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

export function contentSecurityPolicy(formActionSources = ["'self'"]) {
  return `default-src 'none'; style-src 'unsafe-inline'; form-action ${formActionSources.join(' ')}; frame-ancestors 'none'; base-uri 'none'`;
}

const SECURITY_HEADERS = {
  'content-security-policy': contentSecurityPolicy(),
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
};

export function json(res, status, value, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(value));
}

export function html(res, status, value, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(value);
}

export function redirect(res, location, headers = {}) {
  res.writeHead(303, { ...SECURITY_HEADERS, location, 'cache-control': 'no-store', ...headers });
  res.end();
}
