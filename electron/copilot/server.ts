// Opt-in localhost HTTPS server for the Word "writing copilot" add-in. It serves
// BOTH the add-in's static task-pane files (/addin/*) and a small JSON API (/api/*)
// on the same HTTPS origin, so Word's webview talks to it without CORS or
// mixed-content problems. Mirrors the lifecycle/token/127.0.0.1-bind shape of
// electron/mcp/server.ts but over TLS (Nodus-owned local CA, see copilot/certs.ts).
import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import type { CopilotServerStatus } from '@shared/types';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { loadCopilotCert, loadCopilotCa, certReady, copilotStateDir, renewLeafIfNeeded } from './certs';
import { analyzeText, composeCopilotIdeaInsertion, getCopilotIdeaDetail, searchCopilotIdeas } from '../ai/liveRelations';
import { embeddedIdeaCount } from '../db/ideasRepo';
import { getDb } from '../db/database';

const MAX_REQUEST_BYTES = 1 * 1024 * 1024;

let httpServer: Server | null = null;
let status: CopilotServerStatus = { running: false, port: null, addinUrl: null, certReady: false, error: null };
let lifecycle = Promise.resolve();
let getMainWindow: (() => BrowserWindow | null) | null = null;

interface EditorState {
  paragraphText: string;
  selectionText: string;
}

// Bridge state for external editors (LibreOffice Writer): the macro pushes the
// current paragraph/selection here and long-polls for texts to insert, while the
// standalone task pane reads the state and posts insertions. Single-slot state is
// enough: this is a local, single-user bridge.
const editorState: EditorState = { paragraphText: '', selectionText: '' };
let pendingInsertionResolvers: ((text: string) => void)[] = [];
const EDITOR_POLL_TIMEOUT_MS = 30_000;

function addinUrl(port: number): string {
  return `https://localhost:${port}/addin/taskpane.html`;
}

/**
 * Connection info for external bridges that cannot receive the token via an
 * injected page (the LibreOffice macro). Written next to the copilot certs —
 * a fixed per-user path independent of userData/vaults — with owner-only
 * permissions (the token is equally readable in the settings DB). Includes the
 * active CA PEM so the macro can verify TLS instead of disabling verification.
 */
export async function writeCopilotBridgeFile(port: number, dir: string = copilotStateDir()): Promise<string> {
  const bridgePath = path.join(dir, 'bridge.json');
  const payload = {
    port,
    token: ensureToken(),
    caCert: loadCopilotCa(),
    updatedAt: new Date().toISOString(),
  };
  await mkdir(dir, { recursive: true });
  await writeFile(bridgePath, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  return bridgePath;
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'EADDRINUSE') {
    return 'El puerto del copiloto ya está en uso. Elige otro puerto o cierra la app que lo usa.';
  }
  return error instanceof Error ? error.message : String(error);
}

function ensureToken(): string {
  const settings = getSettings();
  if (settings.copilotToken) return settings.copilotToken;
  const token = randomBytes(24).toString('base64url');
  updateSettings({ copilotToken: token });
  return token;
}

function hasValidToken(req: IncomingMessage, expected: string): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice('Bearer '.length), 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function setCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

export function setCopilotWindowProvider(provider: () => BrowserWindow | null): void {
  getMainWindow = provider;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > MAX_REQUEST_BYTES) throw new Error('La solicitud supera el tamaño máximo.');
    chunks.push(data);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function addinDir(): string {
  return path.join(app.getAppPath(), 'word-addin');
}

async function serveAddin(req: IncomingMessage, res: ServerResponse, urlPath: string, port: number): Promise<void> {
  const rel = urlPath.replace(/^\/addin\/?/, '') || 'taskpane.html';
  // Block path traversal: resolve within the add-in directory only.
  const baseDir = addinDir();
  const filePath = path.normalize(path.join(baseDir, rel));
  if (!filePath.startsWith(baseDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    let body: Buffer | string = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    // Inject the current token + port + UI language into the task pane so it
    // can call /api and speak the same language as the app.
    if (ext === '.html') {
      body = body
        .toString('utf8')
        .replace(/__COPILOT_TOKEN__/g, ensureToken())
        .replace(/__COPILOT_PORT__/g, String(port))
        .replace(/__COPILOT_LANG__/g, getSettings().uiLanguage === 'es' ? 'es' : 'en');
    }
    res.writeHead(200, { 'Content-Type': STATIC_TYPES[ext] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlPath = (req.url ?? '/').split('?')[0];

  // Static add-in files (no token; same-origin page that then authorizes with the token).
  if (urlPath === '/' || urlPath.startsWith('/addin')) {
    await serveAddin(req, res, urlPath === '/' ? '/addin/taskpane.html' : urlPath, port);
    return;
  }

  // Health is intentionally tokenless so connectivity can be verified quickly.
  if (urlPath === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      embeddingsConfigured: embeddedIdeaCount() > 0,
      corpusSize: (getDb().prepare('SELECT COUNT(*) AS n FROM works WHERE archived = 0').get() as { n: number }).n,
    });
    return;
  }

  if (!urlPath.startsWith('/api/')) {
    sendJson(res, 404, { error: 'No encontrado' });
    return;
  }

  const token = getSettings().copilotToken;
  if (!token || !hasValidToken(req, token)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="Nodus Copilot"');
    sendJson(res, 401, { error: 'Se requiere un bearer token válido.' });
    return;
  }

  try {
    if (urlPath === '/api/relations' && req.method === 'POST') {
      const body = (await readJsonBody(req)) as { text?: string; model?: unknown };
      const result = await analyzeText(String(body.text ?? ''), (body.model ?? null) as never);
      sendJson(res, 200, result);
      return;
    }
    if (urlPath === '/api/search' && req.method === 'POST') {
      const body = (await readJsonBody(req)) as { query?: string; limit?: number };
      const ideas = await searchCopilotIdeas(String(body.query ?? ''), Number(body.limit ?? 30));
      sendJson(res, 200, { ideas });
      return;
    }
    if (urlPath === '/api/idea' && req.method === 'POST') {
      const body = (await readJsonBody(req)) as { ideaId?: string };
      if (!body.ideaId) {
        sendJson(res, 400, { error: 'Falta ideaId.' });
        return;
      }
      const idea = getCopilotIdeaDetail(body.ideaId);
      if (!idea) {
        sendJson(res, 404, { error: 'Idea no encontrada.' });
        return;
      }
      sendJson(res, 200, { idea });
      return;
    }
    if (urlPath === '/api/insert' && req.method === 'POST') {
      const body = (await readJsonBody(req)) as { ideaId?: string; paragraphText?: string; selectionText?: string };
      if (!body.ideaId) {
        sendJson(res, 400, { error: 'Falta ideaId.' });
        return;
      }
      const insertion = await composeCopilotIdeaInsertion({
        ideaId: body.ideaId,
        paragraphText: String(body.paragraphText ?? ''),
        selectionText: String(body.selectionText ?? ''),
      });
      sendJson(res, 200, insertion);
      return;
    }
    if (urlPath === '/api/nodus/open' && req.method === 'POST') {
      const body = (await readJsonBody(req)) as { ideaId?: string };
      if (!body.ideaId) {
        sendJson(res, 400, { error: 'Falta ideaId.' });
        return;
      }
      const idea = getCopilotIdeaDetail(body.ideaId);
      if (!idea) {
        sendJson(res, 404, { error: 'Idea no encontrada.' });
        return;
      }
      const win = getMainWindow?.() ?? null;
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        win.webContents.send('copilot:openIdea', { ideaId: idea.idea.globalId, label: idea.idea.label });
      }
      sendJson(res, 200, { ok: Boolean(win) });
      return;
    }
    if (urlPath === '/api/zotero/select' && req.method === 'POST') {
      const body = (await readJsonBody(req)) as { zoteroKey?: string };
      if (!body.zoteroKey) {
        sendJson(res, 400, { error: 'Falta zoteroKey.' });
        return;
      }
      await shell.openExternal(`zotero://select/library/items/${encodeURIComponent(body.zoteroKey)}`);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (urlPath === '/api/editor/update-text' && req.method === 'POST') {
      const body = (await readJsonBody(req)) as { paragraphText?: string; selectionText?: string };
      editorState.paragraphText = String(body.paragraphText ?? '');
      editorState.selectionText = String(body.selectionText ?? '');
      sendJson(res, 200, { ok: true });
      return;
    }
    if (urlPath === '/api/editor/state' && req.method === 'GET') {
      sendJson(res, 200, editorState);
      return;
    }
    if (urlPath === '/api/editor/insert' && req.method === 'POST') {
      const body = (await readJsonBody(req)) as { text?: string };
      const text = String(body.text ?? '');
      const resolver = pendingInsertionResolvers.shift();
      if (resolver) resolver(text);
      // delivered:false tells the pane no editor bridge is long-polling right now,
      // so it can surface "run the macro in Writer" instead of a silent no-op.
      sendJson(res, 200, { ok: true, delivered: Boolean(resolver) });
      return;
    }
    if (urlPath === '/api/editor/poll-insertion' && req.method === 'GET') {
      await new Promise<void>((resolve) => {
        let settled = false;
        // Writing to a response whose socket died (client gone, server stopping)
        // throws outside handleRequest's try/catch — from a timer — so every
        // late send must be guarded to protect the main process.
        const safeSend = (body: unknown) => {
          try {
            if (!res.writableEnded && !res.destroyed) sendJson(res, 200, body);
          } catch {
            /* client already gone */
          }
        };
        const settle = (body: unknown | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          pendingInsertionResolvers = pendingInsertionResolvers.filter((r) => r !== resolver);
          if (body !== null) safeSend(body);
          resolve();
        };
        const timeout = setTimeout(() => settle({ text: null }), EDITOR_POLL_TIMEOUT_MS);
        const resolver = (text: string) => settle({ text });
        // A dead poller must leave the queue immediately: otherwise a later
        // insert would be handed to it and the text silently lost. res 'close'
        // fires on premature termination (and, harmlessly for the idempotent
        // settle, after a normal send); req 'close' would fire on request
        // completion, far too early for a bodyless GET.
        res.on('close', () => settle(null));
        pendingInsertionResolvers.push(resolver);
      });
      return;
    }
    sendJson(res, 404, { error: 'Ruta no encontrada.' });
  } catch (error) {
    if (res.headersSent) return;
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function start(): Promise<void> {
  if (httpServer) return;
  const settings = getSettings();
  status = { ...status, certReady: certReady() };
  if (!settings.copilotEnabled) {
    status = { running: false, port: null, addinUrl: null, certReady: certReady(), error: null };
    return;
  }
  await renewLeafIfNeeded();
  const cert = loadCopilotCert();
  if (!cert) {
    status = {
      running: false,
      port: null,
      addinUrl: null,
      certReady: false,
      error: 'Falta el certificado localhost. Genera el certificado del copiloto en Ajustes.',
    };
    return;
  }
  const port = settings.copilotPort;
  try {
    ensureToken();
    const candidate = createServer({ cert: cert.cert, key: cert.key }, (req, res) => {
      // A rejection escaping here (e.g. a throw outside handleRequest's inner
      // try, like /api/health hitting a closing DB) must not become an
      // unhandled rejection that kills the main process.
      handleRequest(req, res, port).catch((error) => {
        console.warn('[copilot] request failed', error);
        try {
          if (!res.headersSent) sendJson(res, 500, { error: 'Error interno del copiloto.' });
        } catch {
          /* client already gone */
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        candidate.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        candidate.off('error', onError);
        resolve();
      };
      candidate.once('error', onError);
      candidate.once('listening', onListening);
      candidate.listen(port, '127.0.0.1');
    });
    httpServer = candidate;
    status = { running: true, port, addinUrl: addinUrl(port), certReady: true, error: null };
    console.log(`[copilot] listening on ${addinUrl(port)}`);
    // Refresh the discovery file for external bridges (LibreOffice macro) on every
    // start, so port/token/CA changes propagate. Best-effort: a write failure
    // must not take the server down.
    try {
      await writeCopilotBridgeFile(port);
    } catch (error) {
      console.warn('[copilot] failed to write bridge file', error);
    }
  } catch (error) {
    status = { running: false, port: null, addinUrl: null, certReady: certReady(), error: describeError(error) };
    console.warn('[copilot] failed to start', error);
  }
}

async function stop(): Promise<void> {
  const active = httpServer;
  httpServer = null;
  if (active) {
    active.closeAllConnections?.();
    await new Promise<void>((resolve) => active.close(() => resolve()));
  }
  status = { running: false, port: null, addinUrl: null, certReady: certReady(), error: null };
}

export function startCopilotServer(): Promise<void> {
  lifecycle = lifecycle.then(start, start);
  return lifecycle;
}
export function stopCopilotServer(): Promise<void> {
  lifecycle = lifecycle.then(stop, stop);
  return lifecycle;
}
export function restartCopilotServer(): Promise<void> {
  const run = async () => {
    await stop();
    await start();
  };
  lifecycle = lifecycle.then(run, run);
  return lifecycle;
}
export function getCopilotStatus(): CopilotServerStatus {
  return { ...status, certReady: certReady() };
}
export async function regenerateCopilotToken(): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  updateSettings({ copilotToken: token });
  if (getSettings().copilotEnabled) await restartCopilotServer();
  return token;
}
