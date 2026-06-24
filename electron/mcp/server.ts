import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServerStatus } from '@shared/types';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { registerTools } from './tools';

const MCP_PATH = '/mcp';
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

interface McpSession {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

let httpServer: Server | null = null;
const sessions = new Map<string, McpSession>();
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
    if (size > MAX_REQUEST_BYTES) throw new HttpRequestError(413, 'La solicitud MCP supera el tamaño máximo permitido.');
    chunks.push(data);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) throw new HttpRequestError(400, 'La solicitud MCP debe incluir un cuerpo JSON.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpRequestError(400, 'El cuerpo de la solicitud MCP no es JSON válido.');
  }
}

function makeMcpServer(): McpServer {
  const server = new McpServer({
    name: 'nodus',
    version: '1.0.0',
  }, {
    instructions: [
      'Nodus is a local-first academic research workspace. Its graph entities (ideas, themes, edges, debates, gaps and authors) are derived from analysed works and are read-only through MCP.',
      'Use list tools before get tools. IDs returned by list tools are stable identifiers for the corresponding detail and writing tools.',
      'User-created folders, notes, coverage questions and saved writing drafts can be written through the dedicated tools. Writing and coverage tools may consume the AI provider already configured in Nodus.',
      'For writing, build a snapshot first, choose an explicit selection, then generate a draft with save=true if it should appear in Nodus.',
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
    sendJsonRpcError(res, 403, 'Origen u Host no autorizado para el servidor MCP local.');
    return;
  }

  const token = getSettings().mcpToken;
  if (!token || !hasValidToken(req, token)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="Nodus MCP"');
    sendJsonRpcError(res, 401, 'Se requiere un bearer token válido para el servidor MCP de Nodus.');
    return;
  }

  try {
    const parsedBody = req.method === 'POST' ? await readJsonBody(req) : undefined;
    const header = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(header) ? header[0] : header;
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    if (existing) {
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
      sendJsonRpcError(res, 404, 'La sesión MCP ya no existe. Inicia una nueva sesión MCP.');
      return;
    }

    if (req.method !== 'POST' || !isInitializeRequest(parsedBody)) {
      sendJsonRpcError(res, 400, 'Se requiere una inicialización MCP sin sesión o una sesión MCP válida.');
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
    session = { server, transport };
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
    sendJsonRpcError(res, 500, 'Error interno del servidor MCP de Nodus.');
  }
}

async function closeSessions(): Promise<void> {
  const active = [...sessions.values()];
  sessions.clear();
  await Promise.allSettled(active.map((session) => session.server.close()));
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
