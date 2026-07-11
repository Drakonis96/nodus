import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { app } from 'electron';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerStatus } from '@shared/types';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { registerTools } from './tools';

const MCP_PATH = '/mcp';
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
// Stateful sessions live only in memory. A client that dies without sending the
// DELETE (or an SSE stream that just goes quiet) would otherwise leak its session
// until the app restarts, so a periodic sweep closes sessions left idle too long.
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let sessionIdleTtlMs = 30 * 60 * 1000;

interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  lastActivity: number;
}

let httpServer: Server | null = null;
const sessions = new Map<string, McpSession>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let status: McpServerStatus = { running: false, port: null, url: null, error: null };
let lifecycle = Promise.resolve();

class HttpRequestError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

function endpoint(port: number): string {
  return `http://127.0.0.1:${port}${MCP_PATH}`;
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'EADDRINUSE') {
    return 'El puerto MCP ya está en uso. Elige otro puerto o cierra la aplicación que lo está usando.';
  }
  return error instanceof Error ? error.message : String(error);
}

function validPort(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65_535) {
    throw new Error('El puerto MCP debe ser un número entre 1024 y 65535.');
  }
  return value;
}

function ensureToken(): string {
  const settings = getSettings();
  if (settings.mcpToken) return settings.mcpToken;
  const token = randomBytes(32).toString('base64url');
  updateSettings({ mcpToken: token });
  return token;
}

function hasValidToken(req: IncomingMessage, expected: string): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const actual = Buffer.from(header.slice('Bearer '.length), 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function isLocalRequest(req: IncomingMessage, port: number): boolean {
  const host = req.headers.host;
  const allowedHosts = new Set(['127.0.0.1', 'localhost', `127.0.0.1:${port}`, `localhost:${port}`]);
  if (!host || !allowedHosts.has(host)) return false;

  // Native MCP clients normally send no Origin. A browser request always does, and
  // is accepted only when it was opened from this exact local origin.
  const origin = req.headers.origin;
  return !origin || origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function sendJsonRpcError(res: ServerResponse, statusCode: number, message: string): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > MAX_REQUEST_BYTES) throw new HttpRequestError(413, 'The MCP request exceeds the maximum allowed size.');
    chunks.push(data);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) throw new HttpRequestError(400, 'The MCP request must include a JSON body.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpRequestError(400, 'The MCP request body is not valid JSON.');
  }
}

function makeMcpServer(): McpServer {
  const server = new McpServer({
    name: 'nodus',
    version: app.getVersion(),
  }, {
    instructions: [
      'Nodus is a local-first academic research workspace. Its graph entities (ideas, themes, edges, debates, gaps and authors) are derived from analysed works and are read-only through MCP.',
      'A Nodus install can hold several vaults (separate corpora), but every tool reads the one vault that is active in the app. Call nodus_get_capabilities to see the active vault and the list of available ones; if the user means a different vault, ask them to switch it in the Nodus app, as MCP cannot change it.',
      'Use list tools before get tools. IDs returned by list tools are stable identifiers for the corresponding detail and writing tools.',
      'User-created folders, notes, coverage questions and saved writing drafts can be written through the dedicated tools. Writing and coverage tools may consume the AI provider already configured in Nodus.',
      'For writing, build a snapshot first, choose an explicit selection, then generate a draft with save=true if it should appear in Nodus.',
      'To situate a draft passage in the corpus, nodus_analyze_passage returns its typed relations (supports/contradicts/refines/…) with citable Zotero items; nodus_get_copilot_idea expands one idea with its citation, and nodus_compose_insertion drafts a cited sentence to insert.',
      'To locate where the corpus discusses a topic, nodus_search_passages returns citable full-text passages ranked by semantic similarity; nodus_search_ideas does the same over derived ideas.',
      'All data remains on this machine. Do not claim a relation, evidence or source that is not returned by a Nodus tool.',
    ].join('\n'),
  });
  registerTools(server);
  return server;
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
  if ((req.url ?? '').split('?')[0] !== MCP_PATH) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  if (!isLocalRequest(req, port)) {
    sendJsonRpcError(res, 403, 'Origin or Host not authorized for the local MCP server.');
    return;
  }

  const token = getSettings().mcpToken;
  if (!token || !hasValidToken(req, token)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="Nodus MCP"');
    sendJsonRpcError(res, 401, 'A valid bearer token is required for the Nodus MCP server.');
    return;
  }

  try {
    const parsedBody = req.method === 'POST' ? await readJsonBody(req) : undefined;
    const header = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(header) ? header[0] : header;
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    if (existing) {
      existing.lastActivity = Date.now();
      await existing.transport.handleRequest(req, res, parsedBody);
      return;
    }

    // A session id was supplied but no live session matches it. This is the normal
    // state after the Nodus app restarts (e.g. an update): the HTTP server loses its
    // in-memory sessions while the client still holds the old id. The Streamable HTTP
    // spec requires HTTP 404 here so the client transparently starts a fresh session
    // with a new InitializeRequest. Answering 400 instead leaves clients like
    // mcp-remote stuck retrying the dead session until they are restarted by hand.
    if (sessionId) {
      sendJsonRpcError(res, 404, 'The MCP session no longer exists. Start a new MCP session.');
      return;
    }

    if (req.method !== 'POST' || !isInitializeRequest(parsedBody)) {
      sendJsonRpcError(res, 400, 'A sessionless MCP initialization or a valid MCP session is required.');
      return;
    }

    let session: McpSession | null = null;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      enableDnsRebindingProtection: true,
      allowedHosts: ['127.0.0.1', 'localhost', `127.0.0.1:${port}`, `localhost:${port}`],
      allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
      onsessioninitialized: (newSessionId) => {
        if (session) sessions.set(newSessionId, session);
      },
    });
    const server = makeMcpServer();
    session = { server, transport, lastActivity: Date.now() };
    transport.onclose = () => {
      const activeId = transport.sessionId;
      if (activeId) sessions.delete(activeId);
    };
    transport.onerror = (error) => console.warn('[mcp] transport error', error.message);
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    if (res.headersSent) return;
    if (error instanceof HttpRequestError) {
      sendJsonRpcError(res, error.statusCode, error.message);
      return;
    }
    console.error('[mcp] request failed', error);
    sendJsonRpcError(res, 500, 'Internal error in the Nodus MCP server.');
  }
}

async function closeSessions(): Promise<void> {
  const active = [...sessions.values()];
  sessions.clear();
  await Promise.allSettled(active.map((session) => session.server.close()));
}

/** Closes every session left idle beyond the TTL. Exported so tests can drive it
 *  deterministically instead of waiting for the interval. Closing a session's server
 *  fires transport.onclose, which removes it from the map. */
export function sweepIdleSessions(now = Date.now()): void {
  for (const [id, session] of sessions) {
    if (now - session.lastActivity <= sessionIdleTtlMs) continue;
    sessions.delete(id);
    console.log(`[mcp] closing idle session ${id}`);
    void session.server.close().catch(() => {
      /* a session already tearing down is fine — it is gone either way */
    });
  }
}

/** Test-only override of the idle TTL (ms). Never called in production. */
export function __setSessionIdleTtlForTest(ms: number): void {
  sessionIdleTtlMs = ms;
}

/** Test-only count of live in-memory sessions. */
export function __sessionCountForTest(): number {
  return sessions.size;
}

async function closeHttpServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function start(): Promise<void> {
  if (httpServer) return;
  const settings = getSettings();
  if (!settings.mcpEnabled) {
    status = { running: false, port: null, url: null, error: null };
    return;
  }

  let port: number;
  try {
    port = validPort(settings.mcpPort);
    ensureToken();
  } catch (error) {
    status = { running: false, port: null, url: null, error: describeError(error) };
    return;
  }

  const candidate = createServer((req, res) => {
    void handleMcpRequest(req, res, port);
  });
  try {
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
    sweepTimer = setInterval(() => sweepIdleSessions(), SESSION_SWEEP_INTERVAL_MS);
    sweepTimer.unref?.();
    status = { running: true, port, url: endpoint(port), error: null };
    console.log(`[mcp] listening on ${endpoint(port)}`);
  } catch (error) {
    candidate.close();
    status = { running: false, port: null, url: null, error: describeError(error) };
    console.warn('[mcp] failed to start', error);
  }
}

async function stop(): Promise<void> {
  const active = httpServer;
  httpServer = null;
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  await closeSessions();
  if (active) await closeHttpServer(active);
  status = { running: false, port: null, url: null, error: null };
}

/** Starts the opt-in Streamable HTTP server when enabled in Settings. */
export function startMcpServer(): Promise<void> {
  lifecycle = lifecycle.then(start, start);
  return lifecycle;
}

/** Closes the HTTP listener and all active stateful MCP sessions. */
export function stopMcpServer(): Promise<void> {
  lifecycle = lifecycle.then(stop, stop);
  return lifecycle;
}

/** Restarts the listener after a port or token change. */
export function restartMcpServer(): Promise<void> {
  lifecycle = lifecycle.then(async () => {
    await stop();
    await start();
  }, async () => {
    await stop();
    await start();
  });
  return lifecycle;
}

export function getMcpStatus(): McpServerStatus {
  return { ...status };
}

/** Rotates the local bearer token. A running server restarts so all old sessions are invalidated. */
export async function regenerateMcpToken(): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  updateSettings({ mcpToken: token });
  if (getSettings().mcpEnabled) await restartMcpServer();
  return token;
}
