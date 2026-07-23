// Opt-in localhost HTTP server for the "Nodus for Zotero" plugin. The plugin
// (running inside Zotero's privileged JS) calls this JSON/NDJSON API to chat
// about the open item with Nodus's library as context: featured models,
// zotero_key → Work resolution, per-work ideas, cross-library connections, and
// a streaming chat that cites document pages + Nodus ideas.
//
// Plain HTTP (not HTTPS like the copilot) on 127.0.0.1 + a bearer token: Zotero
// runs on Gecko with its own NSS trust store, which would reject Nodus's
// system-trusted local CA, so a loopback HTTP + token model (like the MCP
// server) is the right fit. Mirrors the lifecycle/token shape of
// electron/mcp/server.ts and electron/copilot/server.ts.
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import type { ModelRef, ReasoningEffort, Work, ZoteroPluginServerStatus } from '@shared/types';
import { getSettings, updateSettings } from '../db/settingsRepo';
import { getDb } from '../db/database';
import { embeddedIdeaCount, getIdeasByWork, getIdeaDetail } from '../db/ideasRepo';
import { getWorkByZoteroKey, getWorkByDoi, getWorkByAliasKey } from '../db/worksRepo';
import { searchCopilotIdeas, searchCopilotPassages } from '../ai/liveRelations';
import { completeTextStream } from '../ai/aiClient';
import { getActiveVault } from '../vaults/vaultRegistry';
import type { VisionImagePart } from '@shared/imageAnalysis';

const MAX_REQUEST_BYTES = 20 * 1024 * 1024; // full text plus several bounded page images

let httpServer: Server | null = null;
let status: ZoteroPluginServerStatus = { running: false, port: null, url: null, error: null };
let lifecycle = Promise.resolve();
let getMainWindow: (() => BrowserWindow | null) | null = null;

export function setZoteroPluginWindowProvider(provider: () => BrowserWindow | null): void {
  getMainWindow = provider;
}

// ---------------------------------------------------------------- token/auth

function ensureToken(): string {
  const settings = getSettings();
  if (settings.zoteroPluginToken) return settings.zoteroPluginToken;
  const token = randomBytes(24).toString('base64url');
  updateSettings({ zoteroPluginToken: token });
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

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'EADDRINUSE') {
    return 'El puerto del plugin de Zotero ya está en uso. Elige otro puerto o cierra la app que lo usa.';
  }
  return error instanceof Error ? error.message : String(error);
}

// -------------------------------------------------------------- bridge file
// The plugin reads this to auto-configure port + token (zero manual setup),
// mirroring the copilot bridge. Owner-only perms; the token is equally readable
// in the settings DB. Fixed per-user path independent of userData/vaults.

function bridgeDir(): string {
  return path.join(os.homedir(), '.nodus');
}

export async function writeZoteroBridgeFile(port: number): Promise<string> {
  const dir = bridgeDir();
  const bridgePath = path.join(dir, 'zotero-bridge.json');
  const payload = { port, token: ensureToken(), updatedAt: new Date().toISOString() };
  await mkdir(dir, { recursive: true });
  await writeFile(bridgePath, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  return bridgePath;
}

// ------------------------------------------------------------- http helpers

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

// -------------------------------------------------------------- domain logic

/** zotero_key → Work with the same fallback order the MCP tools use. */
function resolveWork(body: Record<string, unknown>): Work | null {
  const zoteroKey = typeof body.zoteroKey === 'string' ? body.zoteroKey : '';
  const doi = typeof body.doi === 'string' ? body.doi : '';
  if (zoteroKey) {
    const w = getWorkByZoteroKey(zoteroKey) ?? getWorkByAliasKey(zoteroKey);
    if (w) return w;
  }
  if (doi) {
    const w = getWorkByDoi(doi);
    if (w) return w;
  }
  return null;
}

function toModelRef(value: unknown): ModelRef | null {
  if (value && typeof value === 'object') {
    const v = value as { provider?: unknown; model?: unknown };
    if (typeof v.provider === 'string' && typeof v.model === 'string' && v.provider && v.model) {
      return { provider: v.provider as ModelRef['provider'], model: v.model };
    }
  }
  return null;
}

/** The user's "featured" models = settings.favorites (app-wide), plus the default. */
function featuredModels(): { models: ModelRef[]; default: ModelRef | null } {
  const settings = getSettings();
  const models = Array.isArray(settings.favorites) ? settings.favorites : [];
  return { models, default: settings.synthesisModel ?? models[0] ?? null };
}

const CITE_INSTRUCTIONS = [
  'CITATION RULES — cite sources inline using these exact tokens (the reader turns them into clickable chips):',
  '• Retrieved or complete Zotero evidence: [[e:PASSAGE_ID]]. Use only ids present in ZOTERO EVIDENCE and put citations immediately after supported sentences.',
  '• A page of the OPEN DOCUMENT: [[p:N]] where N is the page label/number. Only cite pages that appear in the provided document text or passages.',
  '• A Nodus idea: [[idea:GLOBAL_ID]] using an id from the "NODUS IDEAS" list below.',
  '• A Nodus research gap: [[gap:GAP_ID]] using an id from the "NODUS GAPS" list below.',
  '• Another library item: [[zotero:KEY]] using a zoteroKey from the context.',
  'Never invent ids, keys, or page numbers. Cite only what is present in the context. Answer in the same language as the user’s last message.',
].join('\n');

interface ChatContext {
  work: Work | null;
  ideasBlock: string;
  gapsBlock: string;
  passagesBlock: string;
  usedIdeas: { globalId: string; label: string }[];
  usedPages: string[];
}

async function buildChatContext(body: Record<string, unknown>, lastUserText: string): Promise<ChatContext> {
  const context = (body.context && typeof body.context === 'object' ? body.context : {}) as Record<string, unknown>;
  const work = resolveWork(context);
  const useIdeas = context.useIdeas !== false;
  const useCorpus = context.useCorpus !== false;
  const usedIdeas: { globalId: string; label: string }[] = [];
  const usedPages: string[] = [];

  let ideasBlock = '';
  if (work && work.deep_status === 'done' && useIdeas) {
    const { ideas } = getIdeasByWork(work.nodus_id, 60, 0);
    if (ideas.length) {
      ideasBlock =
        'NODUS IDEAS for the open document (Nodus already deep-analysed it):\n' +
        ideas
          .map((i) => {
            usedIdeas.push({ globalId: i.global_id, label: i.label });
            return `- [[idea:${i.global_id}]] (${i.role}) ${i.label}: ${i.statement}`;
          })
          .join('\n');
    }
  }

  // Research gaps Nodus found for this work — citable so answers can link to them.
  let gapsBlock = '';
  if (work && work.deep_status === 'done') {
    try {
      const rows = getDb()
        .prepare('SELECT id, kind, statement FROM gaps WHERE nodus_id = ? LIMIT 20')
        .all(work.nodus_id) as { id: string; kind: string; statement: string }[];
      if (rows.length) {
        gapsBlock = 'NODUS GAPS (open questions Nodus found for this work):\n' +
          rows.map((g) => `- [[gap:${g.id}]] (${g.kind}) ${g.statement}`).join('\n');
      }
    } catch {
      /* gaps table optional */
    }
  }

  // Semantic passages give page-anchored quotes across the library (and the
  // open work), each with a pageLabel + zoteroKey we can cite.
  let passagesBlock = '';
  if (useCorpus && lastUserText.trim()) {
    try {
      const found = await searchCopilotPassages(lastUserText, 8);
      if (found.available && found.passages.length) {
        passagesBlock =
          'RELEVANT PASSAGES (from Nodus full-text index; cite the page):\n' +
          found.passages
            .map((p) => {
              if (p.pageLabel) usedPages.push(p.pageLabel);
              const page = p.pageLabel ? `[[p:${p.pageLabel}]] ` : '';
              const key = p.zoteroKey ? `[[zotero:${p.zoteroKey}]] ` : '';
              return `- ${page}${key}${p.authorYear ?? p.workTitle}: "${p.snippet}"`;
            })
            .join('\n');
      }
    } catch {
      /* passage retrieval is best-effort */
    }
  }

  return { work, ideasBlock, gapsBlock, passagesBlock, usedIdeas, usedPages };
}

function buildPrompt(body: Record<string, unknown>, ctx: ChatContext): { system: string; user: string } {
  const context = (body.context && typeof body.context === 'object' ? body.context : {}) as Record<string, unknown>;
  const itemTitle = typeof context.title === 'string' ? context.title : ctx.work?.title ?? '';
  const documentText = typeof context.documentText === 'string' ? context.documentText : '';
  const evidenceText = typeof context.evidenceText === 'string' ? context.evidenceText : '';
  const selection = typeof context.selection === 'string' ? context.selection : '';
  const extraContext = typeof context.extraContext === 'string' ? context.extraContext : '';

  const messages = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: string }[]) : [];
  const history = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
  const lastUser = [...messages].reverse().find((m) => m?.role === 'user')?.content ?? '';
  const normalizedLast = lastUser.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const spanishSignals = (normalizedLast.match(/\b(que|como|segun|documento|pagina|explica|describe|distingue|cita|evidencia)\b/g) ?? []).length;
  const englishSignals = (normalizedLast.match(/\b(what|how|according|document|page|explain|describe|distinguish|cite|evidence)\b/g) ?? []).length;
  const outputLanguage = spanishSignals >= 2 && spanishSignals > englishSignals ? 'Spanish' : 'English';

  const agentInstructions = typeof context.agentInstructions === 'string' ? context.agentInstructions : '';
  const system = [
    'You are Nodus, an academic research assistant embedded in Zotero. You help the user understand the open document and how it connects to their Nodus library.',
    'Be precise and concise. Ground every claim in the provided context.',
    CITE_INSTRUCTIONS,
    `OUTPUT LANGUAGE (highest priority): answer entirely in ${outputLanguage}. Do not switch because sources or images use another language.`,
    ...(agentInstructions ? [agentInstructions] : []),
  ].join('\n\n');

  const parts: string[] = [];
  if (itemTitle) parts.push(`OPEN DOCUMENT: ${itemTitle}`);
  if (extraContext) parts.push(extraContext);
  if (ctx.ideasBlock) parts.push(ctx.ideasBlock);
  if (ctx.gapsBlock) parts.push(ctx.gapsBlock);
  if (selection) parts.push(`USER SELECTION (the user highlighted this — treat it as the focus and quote/cite it):\n"""\n${selection}\n"""`);
  if (evidenceText) parts.push(`ZOTERO EVIDENCE (authoritative passages with exact citable ids):\n${evidenceText.slice(0, 1_000_000)}`);
  // The plugin already head/tail-samples long documents to DOC_CHAR_LIMIT; keep a
  // generous ceiling here so we don't re-truncate away the sampled conclusion.
  if (documentText) parts.push(`DOCUMENT TEXT (page markers like "=== page N ===" indicate pages you may cite with [[p:N]]):\n"""\n${documentText.slice(0, 200_000)}\n"""`);
  if (ctx.passagesBlock) parts.push(ctx.passagesBlock);
  parts.push(`CONVERSATION SO FAR:\n${history}`);
  parts.push('Answer the last user message.');

  return { system, user: parts.join('\n\n') };
}

function parseVisionImages(value: unknown): VisionImagePart[] {
  if (!Array.isArray(value)) return [];
  const out: VisionImagePart[] = [];
  for (const raw of value.slice(0, 6)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.dataUrl === 'string') {
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(item.dataUrl);
      if (match) out.push({ mediaType: match[1].toLowerCase(), base64: match[2].replace(/\s+/g, '') });
    } else if (typeof item.mimeType === 'string' && typeof item.data === 'string' && /^image\/(?:png|jpeg|webp)$/i.test(item.mimeType)) {
      out.push({ mediaType: item.mimeType.toLowerCase(), base64: item.data.replace(/\s+/g, '') });
    }
  }
  return out;
}

// ------------------------------------------------------------- request router

async function handleRequest(req: IncomingMessage, res: ServerResponse, port: number): Promise<void> {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  const urlPath = (req.url ?? '/').split('?')[0];

  // Health is tokenless so the plugin can probe connectivity + report the vault.
  if (urlPath === '/api/z/health') {
    const vault = safeActiveVault();
    sendJson(res, 200, {
      ok: true,
      app: 'nodus',
      version: app.getVersion?.() ?? null,
      vault,
      corpusSize: (getDb().prepare('SELECT COUNT(*) AS n FROM works WHERE archived = 0').get() as { n: number }).n,
      embeddingsConfigured: embeddedIdeaCount() > 0,
    });
    return;
  }

  const token = getSettings().zoteroPluginToken;
  if (!token || !hasValidToken(req, token)) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="Nodus for Zotero"');
    sendJson(res, 401, { error: 'Se requiere un bearer token válido.' });
    return;
  }

  try {
    if (urlPath === '/api/z/models' && req.method === 'GET') {
      sendJson(res, 200, featuredModels());
      return;
    }

    if (urlPath === '/api/z/resolve' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const work = resolveWork(body);
      if (!work) {
        sendJson(res, 200, { matched: false, hasAnalysis: false, ideaCount: 0 });
        return;
      }
      const ideaCount = (getDb().prepare('SELECT COUNT(*) AS n FROM idea_occurrences WHERE nodus_id = ?').get(work.nodus_id) as { n: number }).n;
      sendJson(res, 200, {
        matched: true,
        nodusId: work.nodus_id,
        title: work.title,
        deepStatus: work.deep_status,
        hasAnalysis: work.deep_status === 'done',
        ideaCount,
      });
      return;
    }

    if (urlPath === '/api/z/ideas' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const work = resolveWork(body);
      if (!work) {
        sendJson(res, 200, { matched: false, hasAnalysis: false, ideas: [] });
        return;
      }
      const { ideas } = getIdeasByWork(work.nodus_id, 200, 0);
      sendJson(res, 200, { matched: true, hasAnalysis: work.deep_status === 'done', ideas });
      return;
    }

    if (urlPath === '/api/z/connections' && req.method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 200, buildConnections(body));
      return;
    }

    if (urlPath === '/api/z/search' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const query = typeof body.query === 'string' ? body.query : '';
      const kind = body.kind === 'passages' ? 'passages' : 'ideas';
      if (kind === 'passages') {
        sendJson(res, 200, await searchCopilotPassages(query, Number(body.limit ?? 20)));
      } else {
        sendJson(res, 200, { ideas: await searchCopilotIdeas(query, Number(body.limit ?? 30)) });
      }
      return;
    }

    if (urlPath === '/api/z/open' && req.method === 'POST') {
      const body = await readJsonBody(req);
      sendJson(res, 200, await openInNodus(body));
      return;
    }

    if (urlPath === '/api/z/select' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const key = typeof body.zoteroKey === 'string' ? body.zoteroKey : '';
      if (key) await shell.openExternal(`zotero://select/library/items/${encodeURIComponent(key)}`);
      sendJson(res, 200, { ok: Boolean(key) });
      return;
    }

    if (urlPath === '/api/z/chat/stream' && req.method === 'POST') {
      await handleChatStream(req, res);
      return;
    }

    if (urlPath === '/api/z/vision' && req.method === 'POST') {
      await handleVision(req, res);
      return;
    }

    if (urlPath === '/api/z/rerank' && req.method === 'POST') {
      await handleRerank(req, res);
      return;
    }

    if (urlPath === '/api/z/citation-repair' && req.method === 'POST') {
      await handleCitationRepair(req, res);
      return;
    }

    if (urlPath === '/api/z/highlight' && req.method === 'POST') {
      await handleHighlight(req, res);
      return;
    }

    if (urlPath === '/api/z/translate' && req.method === 'POST') {
      await handleTranslate(req, res);
      return;
    }

    sendJson(res, 404, { error: 'Ruta no encontrada.' });
  } catch (error) {
    if (res.headersSent) {
      try { res.end(); } catch { /* client gone */ }
      return;
    }
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

function safeActiveVault(): { name: string; type: string } | null {
  try {
    const v = getActiveVault();
    return { name: v.name, type: v.type };
  } catch {
    return null;
  }
}

/** Works that connect to the given item through shared/linked ideas. */
function buildConnections(body: Record<string, unknown>): unknown {
  const work = resolveWork(body);
  if (!work) return { matched: false, works: [], ideas: [] };
  if (work.deep_status !== 'done') return { matched: true, hasAnalysis: false, works: [], ideas: [] };

  const { ideas } = getIdeasByWork(work.nodus_id, 200, 0);
  const byWork = new Map<string, { zoteroKey: string | null; title: string; authorYear: string | null; sharedIdeas: number }>();
  const relatedIdeas: { globalId: string; label: string; relation: string; otherLabel: string }[] = [];

  for (const idea of ideas) {
    const detail = getIdeaDetail(idea.global_id);
    if (!detail) continue;
    // Other works that develop the same idea.
    for (const occ of detail.occurrences) {
      if (occ.work.nodus_id === work.nodus_id) continue;
      const key = occ.work.nodus_id;
      const existing = byWork.get(key);
      if (existing) existing.sharedIdeas += 1;
      else {
        byWork.set(key, {
          zoteroKey: occ.work.zotero_key ?? null,
          title: occ.work.title,
          authorYear: null,
          sharedIdeas: 1,
        });
      }
    }
  }

  const works = [...byWork.values()].sort((a, b) => b.sharedIdeas - a.sharedIdeas).slice(0, 30);
  return { matched: true, hasAnalysis: true, works, ideas: relatedIdeas };
}

async function openInNodus(body: Record<string, unknown>): Promise<{ ok: boolean }> {
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const id = typeof body.id === 'string' ? body.id : '';
  const win = getMainWindow?.() ?? null;
  if (!win) return { ok: false };
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  // Reuse the copilot idea-open channel for ideas (already handled by the UI);
  // other kinds focus the window and send a generic open event.
  if (kind === 'idea' && id) {
    win.webContents.send('copilot:openIdea', { ideaId: id, label: '' });
  } else {
    win.webContents.send('zoteroPlugin:open', { kind, id });
  }
  return { ok: true };
}

const HIGHLIGHT_SYSTEM =
  "You pick the most important passages of a document to highlight for a student. " +
  "Read the DOCUMENT TEXT and choose the passages that matter most, as EXACT verbatim quotes copied from the text — do NOT paraphrase, keep the exact wording so they can be located in the PDF. " +
  "Assign each a level: 'high' for the few MOST important (core thesis, key definitions, critical findings/conclusions) and 'medium' for important supporting points. " +
  "Prefer a single sentence or short clause per passage (never a whole paragraph). Return between 8 and 25 passages. " +
  'Respond with ONLY a JSON array and nothing else: [{"text":"exact quote","level":"high|medium"}].';

/** Parse a model reply into [{text, level}] highlight passages. */
function parseHighlightPassages(text: string): { text: string; level: 'high' | 'medium' }[] {
  const s = text.replace(/```(?:json)?/gi, '');
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a < 0 || b <= a) return [];
  let arr: unknown;
  try { arr = JSON.parse(s.slice(a, b + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: { text: string; level: 'high' | 'medium' }[] = [];
  for (const it of arr) {
    const quote = typeof it === 'string' ? it : (it && typeof it === 'object' ? (it as Record<string, unknown>).text : null);
    if (typeof quote !== 'string' || !quote.trim()) continue;
    const raw = String((it && typeof it === 'object' && ((it as Record<string, unknown>).level || (it as Record<string, unknown>).importance)) || 'medium').toLowerCase();
    out.push({ text: quote.trim(), level: /(high|very|muy|crit|red|rojo|1)/.test(raw) ? 'high' : 'medium' });
  }
  return out;
}

async function handleHighlight(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const documentText = typeof body.documentText === 'string' ? body.documentText.slice(0, 300_000) : '';
  const model = toModelRef(body.model);
  const reasoningRaw = typeof body.reasoning === 'string' ? body.reasoning : 'default';
  const reasoning: ReasoningEffort = (['off', 'low', 'medium', 'high'] as const).includes(reasoningRaw as ReasoningEffort)
    ? (reasoningRaw as ReasoningEffort)
    : 'off';
  if (!documentText) {
    sendJson(res, 200, { passages: [] });
    return;
  }
  let acc = '';
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    await completeTextStream(
      { system: HIGHLIGHT_SYSTEM, user: `DOCUMENT TEXT:\n"""\n${documentText}\n"""\n\nReturn the JSON array of the most important passages to highlight.`, reasoning },
      (delta, kind) => { if (kind !== 'reasoning') acc += delta; },
      model,
      controller.signal,
    );
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error), passages: [] });
    return;
  }
  sendJson(res, 200, { passages: parseHighlightPassages(acc) });
}

async function handleTranslate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const text = typeof body.text === 'string' ? body.text.slice(0, 20_000) : '';
  const language = typeof body.language === 'string' ? body.language.slice(0, 60) : 'English';
  const model = toModelRef(body.model);
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  const write = (obj: unknown) => { try { if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(obj) + '\n'); } catch { /* client gone */ } };
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    await completeTextStream(
      {
        system: `Translate the text the user provides into ${language}. Output ONLY the translation — no explanations, no notes, no quotation marks. Preserve meaning and tone.`,
        user: text,
        reasoning: 'off',
      },
      (delta, kind) => { if (kind !== 'reasoning') write({ type: 'delta', text: delta }); },
      model,
      controller.signal,
    );
    write({ type: 'done' });
  } catch (error) {
    write({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
  try { res.end(); } catch { /* client gone */ }
}

async function handleChatStream(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const messages = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: string }[]) : [];
  const lastUser = [...messages].reverse().find((m) => m?.role === 'user');
  const lastUserText = typeof lastUser?.content === 'string' ? lastUser.content : '';

  const ctx = await buildChatContext(body, lastUserText);
  const { system, user } = buildPrompt(body, ctx);
  const model = toModelRef(body.model);
  const images = parseVisionImages(body.images);
  // Honor the plugin's reasoning/thinking selector; 'default' preserves the
  // server's historical 'off'.
  const context = (body.context && typeof body.context === 'object' ? body.context : {}) as Record<string, unknown>;
  const reasoningRaw = typeof context.reasoning === 'string' ? context.reasoning : 'default';
  const reasoning: ReasoningEffort = (['off', 'low', 'medium', 'high'] as const).includes(
    reasoningRaw as ReasoningEffort,
  )
    ? (reasoningRaw as ReasoningEffort)
    : 'off';

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  const write = (obj: unknown) => {
    try {
      if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(obj) + '\n');
    } catch {
      /* client gone */
    }
  };
  write({ type: 'meta', matched: Boolean(ctx.work), hasAnalysis: ctx.work?.deep_status === 'done', ideas: ctx.usedIdeas });

  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    await completeTextStream(
      { system, user, reasoning, images },
      (delta, kind) => {
        if (kind === 'reasoning') return;
        write({ type: 'delta', text: delta });
      },
      model,
      controller.signal,
    );
    write({ type: 'done' });
  } catch (error) {
    write({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
  try { res.end(); } catch { /* client gone */ }
}

async function handleVision(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const model = toModelRef(body.model);
  const system = typeof body.system === 'string' ? body.system.slice(0, 20_000) : 'Extract visible document content faithfully.';
  const user = typeof body.prompt === 'string' ? body.prompt.slice(0, 30_000) : 'Describe and transcribe this document page.';
  const images = parseVisionImages(body.images);
  if (!images.length) {
    sendJson(res, 400, { error: 'No valid page image supplied.' });
    return;
  }
  let text = '';
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  try {
    await completeTextStream(
      { system, user, images, reasoning: 'off', plainContext: true, skipStudentPseudonyms: true },
      (delta, kind) => { if (kind !== 'reasoning') text += delta; },
      model,
      controller.signal,
    );
    sendJson(res, 200, { text });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleRerank(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const model = toModelRef(body.model);
  const query = typeof body.query === 'string' ? body.query.slice(0, 10_000) : '';
  const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 36) : [];
  const rows = candidates
    .map((raw) => {
      const c = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const id = typeof c.id === 'string' ? c.id : '';
      const title = typeof c.title === 'string' ? c.title : '';
      const page = typeof c.pageLabel === 'string' ? c.pageLabel : String(c.pageLabel ?? '');
      const text = typeof c.text === 'string' ? c.text.replace(/\s+/g, ' ').slice(0, 650) : '';
      return id ? `${id} | ${title} | page ${page} | ${text}` : '';
    })
    .filter(Boolean);
  const allowed = new Set(candidates.map((raw) => raw && typeof raw === 'object' ? String((raw as Record<string, unknown>).id ?? '') : '').filter(Boolean));
  let output = '';
  await completeTextStream(
    {
      system: 'Rerank academic evidence across languages. Prefer passages that directly answer the question over related passages or bibliography entries. Return ONLY a JSON array of up to 10 exact ids, best first. Never invent ids.',
      user: `QUESTION:\n${query}\n\nCANDIDATES:\n${rows.join('\n')}`,
      reasoning: 'off',
      plainContext: true,
      skipStudentPseudonyms: true,
      maxTokens: 1200,
    },
    (delta, kind) => { if (kind !== 'reasoning') output += delta; },
    model,
  );
  let ids: string[] = [];
  const start = output.indexOf('['), end = output.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(output.slice(start, end + 1));
      if (Array.isArray(parsed)) ids = parsed.map(String).filter((id) => allowed.has(id));
    } catch { /* malformed model result falls back client-side */ }
  }
  sendJson(res, 200, { ids });
}

async function handleCitationRepair(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const model = toModelRef(body.model);
  const answer = typeof body.answer === 'string' ? body.answer.slice(0, 100_000) : '';
  const evidence = Array.isArray(body.evidence) ? body.evidence.slice(0, 20) : [];
  const catalogue = evidence.map((raw) => {
    const e = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const id = typeof e.id === 'string' ? e.id : '';
    const title = typeof e.title === 'string' ? e.title : '';
    const page = String(e.pageLabel ?? '');
    const text = typeof e.text === 'string' ? e.text.slice(0, 3000) : '';
    return id ? `[[e:${id}]] ${title} · page ${page}\n"""${text}"""` : '';
  }).filter(Boolean).join('\n\n');
  let text = '';
  await completeTextStream(
    {
      system: 'Repair citations in the supplied academic answer. Preserve its language, meaning and structure. Add exact [[e:ID]] tokens immediately after every supported factual sentence. Never invent ids. Replace an unsupported claim only with a statement that supplied evidence is insufficient. Return only the complete repaired answer.',
      user: `ANSWER TO REPAIR:\n${answer}\n\nEVIDENCE CATALOGUE:\n${catalogue}`,
      reasoning: 'off',
      plainContext: true,
      skipStudentPseudonyms: true,
      maxTokens: 3000,
    },
    (delta, kind) => { if (kind !== 'reasoning') text += delta; },
    model,
  );
  sendJson(res, 200, { text: text.trim() || answer });
}

// ---------------------------------------------------------------- lifecycle

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1024 && port <= 65535;
}

async function start(): Promise<void> {
  if (httpServer) return;
  const settings = getSettings();
  if (!settings.zoteroPluginEnabled) {
    status = { running: false, port: null, url: null, error: null };
    return;
  }
  const port = settings.zoteroPluginPort;
  if (!validPort(port)) {
    status = { running: false, port: null, url: null, error: `Puerto no válido: ${port}` };
    return;
  }
  try {
    ensureToken();
    const candidate = createServer((req, res) => {
      handleRequest(req, res, port).catch((error) => {
        console.warn('[zotero-plugin] request failed', error);
        try {
          if (!res.headersSent) sendJson(res, 500, { error: 'Error interno del servidor de Zotero.' });
        } catch {
          /* client gone */
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
    status = { running: true, port, url: `http://127.0.0.1:${port}`, error: null };
    console.log(`[zotero-plugin] listening on http://127.0.0.1:${port}`);
    try {
      await writeZoteroBridgeFile(port);
    } catch (error) {
      console.warn('[zotero-plugin] failed to write bridge file', error);
    }
  } catch (error) {
    status = { running: false, port: null, url: null, error: describeError(error) };
    console.warn('[zotero-plugin] failed to start', error);
  }
}

async function stop(): Promise<void> {
  const active = httpServer;
  httpServer = null;
  if (active) {
    active.closeAllConnections?.();
    await new Promise<void>((resolve) => active.close(() => resolve()));
  }
  status = { running: false, port: null, url: null, error: null };
}

export function startZoteroPluginServer(): Promise<void> {
  lifecycle = lifecycle.then(start, start);
  return lifecycle;
}
export function stopZoteroPluginServer(): Promise<void> {
  lifecycle = lifecycle.then(stop, stop);
  return lifecycle;
}
export function restartZoteroPluginServer(): Promise<void> {
  const run = async () => {
    await stop();
    await start();
  };
  lifecycle = lifecycle.then(run, run);
  return lifecycle;
}
export function getZoteroPluginStatus(): ZoteroPluginServerStatus {
  return { ...status };
}
export async function regenerateZoteroPluginToken(): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  updateSettings({ zoteroPluginToken: token });
  if (getSettings().zoteroPluginEnabled) await restartZoteroPluginServer();
  return token;
}
