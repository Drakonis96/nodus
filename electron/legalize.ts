import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
import { LEGALIZE_COUNTRIES, legalAttribution, normalizeLegalText, safeLegalPath, type LegalPlan, type LegalResult, type LegalMatch } from '@shared/legalize';

const RAW = 'https://raw.githubusercontent.com/legalize-dev/';
const MAX_LAW = 10_000_000;
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
type Fetch = typeof globalThis.fetch;
async function download(url: string, limit: number, signal: AbortSignal, fetcher: Fetch): Promise<Buffer | null> {
  const response = await fetcher(url, { signal, redirect: 'error', headers: { 'User-Agent': 'Nodus-Legalize', Accept: '*/*' } });
  if (response.status === 404) return null;
  if (!response.ok) throw Error(response.status === 403 || response.status === 429 ? 'Legalize: límite de GitHub alcanzado. Inténtalo más tarde.' : `Legalize: GitHub no está disponible (${response.status}).`);
  if (Number(response.headers.get('content-length') || 0) > limit) { await response.body?.cancel(); throw Error('Legalize: el archivo supera el límite de descarga.'); }
  const reader = response.body?.getReader(); if (!reader) throw Error('Legalize: respuesta vacía.');
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw Error('Legalize: el archivo supera el límite de descarga.'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  signal.throwIfAborted(); return Buffer.concat(chunks);
}
/** Read only scalar fields; preserve the complete frontmatter verbatim for attribution. */
export function parseLegalDocument(raw: string, file: string, country: string) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
  if (!front || front[1].length > 100_000) throw Error('Legalize: documento sin metadatos compatibles.');
  const fields: Record<string, string> = {};
  for (const line of front[1].split(/\r?\n/)) {
    const m = /^([a-z_]+):\s*(.*?)\s*$/.exec(line); if (!m) continue;
    let value = m[2];
    if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { continue; } }
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replaceAll("''", "'");
    else if (/^[>|&*!{[]/.test(value)) continue;
    if (typeof value === 'string') fields[m[1]] = value;
  }
  if (fields.country !== country || !fields.title || !fields.identifier || !fields.source || !safeLegalPath(file)
    || file.split('/').at(-1) !== fields.identifier + '.md') throw Error('Legalize: país o identificador del documento incompatible.');
  let source: URL; try { source = new URL(fields.source); } catch { throw Error('Legalize: fuente oficial ausente.'); }
  if (!['https:','http:'].includes(source.protocol) || source.username || source.password) throw Error('Legalize: fuente inválida.');
  return { id: fields.identifier, title: fields.title, path: file, source: source.href, metadata: front[1], text: raw.slice(front[0].length), lastUpdated: fields.last_updated || 'No indicada por la fuente', status: fields.status || 'No indicado por la fuente' };
}
export function selectLegalArticle(text: string, article: string): string {
  const escaped = article.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^(#{1,6})[ \\t]+(?:Art[ií]culo|Article|Art\\.?|Section|§)[ \\t]+${escaped}(?=[ \\t.:—–-]|$)[^\\n]*`, 'gimu');
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) throw Error('Legalize: no se encontró un único encabezado de ese artículo. Consulta la norma completa por su identificador.');
  const m = matches[0], start = m.index!, tail = text.slice(start + m[0].length);
  const next = new RegExp(`^#{1,${m[1].length}}[ \\t]+`, 'm').exec(tail);
  return text.slice(start, next ? start + m[0].length + next.index : undefined).trimEnd();
}
interface Index { revision: string; entries: LegalMatch[]; skipped: number }
const locks = new Set<string>();
/** All hosts/paths are application-owned. No shell, Git, SDK, token or user URL is executed. */
export async function retrieveLegalize(plan: LegalPlan, callerSignal?: AbortSignal, options: { fetch?: Fetch; cacheDir?: string } = {}): Promise<LegalResult> {
  const c = LEGALIZE_COUNTRIES.find(c => c.code === plan.country); if (!c) throw Error('Legalize: país pendiente de revisión de licencia.');
  if (locks.has(c.code)) throw Error('Legalize: ya hay una consulta de este país en curso.');
  locks.add(c.code);
  const signal = AbortSignal.any([...(callerSignal ? [callerSignal] : []), AbortSignal.timeout(240_000)]);
  const fetcher = options.fetch ?? globalThis.fetch;
  const get = (url: string, max: number) => download(url, max, signal, fetcher);
  try {
    const ref = await get(`https://api.github.com/repos/legalize-dev/${c.repo}/git/ref/heads/main`, 20_000);
    const revision = ref && JSON.parse(ref.toString()).object?.sha;
    if (typeof revision !== 'string' || !/^[a-f0-9]{40}$/.test(revision)) throw Error('Legalize: no se pudo fijar la versión del repositorio.');
    const base = `${RAW}${c.repo}/${revision}/`;
    const notices = await Promise.all([get(base + 'LICENSE', 30_000), get(base + 'README.md', 100_000)]);
    if (!notices[0] || sha256(notices[0]) !== c.licenseSha256 || !notices[1] || sha256(notices[1]) !== c.readmeSha256) throw Error('Legalize: los avisos del repositorio han cambiado. Es necesario revisar su licencia antes de consultar esta versión.');
    const result: LegalResult = { version: 1, country: c.code, query: plan.query, revision, fetchedAt: new Date().toISOString(), matches: [], totalMatches: 0, attribution: '' };
    // Exact canonical identifiers avoid downloading the country catalogue. A miss
    // falls through to the actual snapshot paths (including regional/hash layouts).
    let id = /^[\p{L}\p{N}_.()-]+$/u.test(plan.query) ? plan.query : '';
    const usc = /^(\d+)\s*U\.?\s*S\.?\s*C\.?\s*§?\s*(\d+[a-z0-9-]*)$/i.exec(plan.query);
    if (c.code === 'us' && usc) id = `USC-T${usc[1]}-S${usc[2]}`;
    let document: ReturnType<typeof parseLegalDocument> | undefined;
    if (id && id !== '.' && id !== '..') {
      const file = `${c.code}/${id}.md`;
      const raw = await get(base + file.split('/').map(encodeURIComponent).join('/'), MAX_LAW);
      if (raw) document = parseLegalDocument(raw.toString('utf8'), file, c.code);
    }
    if (!document) {
      const cacheDir = options.cacheDir ?? path.join(app.getPath('userData'), 'legalize-indexes');
      const cache = path.join(cacheDir, `${c.code}.json`);
      let index: Index | undefined;
      try { const b = await fs.readFile(cache); if (b.length <= 100_000_000) { const saved = JSON.parse(b.toString()); if (saved.revision === revision && Array.isArray(saved.entries)) index = saved; } } catch { /* Absent/stale cache. */ }
      if (!index) {
        const bytes = await get(`https://codeload.github.com/legalize-dev/${c.repo}/zip/${revision}`, 256_000_000);
        if (!bytes) throw Error('Legalize: no se pudo descargar el catálogo del país.');
        const entries = new AdmZip(bytes).getEntries();
        if (entries.length > 350_000 || entries.reduce((n, e) => n + e.header.size, 0) > 4_000_000_000) throw Error('Legalize: el catálogo supera los límites de esta versión. Usa un identificador exacto.');
        index = { revision, entries: [], skipped: 0 };
        for (let i = 0; i < entries.length; i++) {
          if (i % 64 === 0) { await new Promise<void>(resolve => setImmediate(resolve)); signal.throwIfAborted(); }
          const entry = entries[i], file = entry.entryName.split('/').slice(1).join('/');
          if (entry.isDirectory || !file.includes('/') || !file.endsWith('.md') || !safeLegalPath(file)) continue;
          if (entry.header.size > MAX_LAW) { index.skipped++; continue; }
          try { const d = parseLegalDocument(entry.getData().toString('utf8'), file, c.code); index.entries.push({ id: d.id, title: d.title, path: d.path }); }
          catch { index.skipped++; }
        }
        // An incomplete catalogue must never present an exhaustive negative result.
        if (index.skipped || !index.entries.length) throw Error(`Legalize: catálogo incompatible o incompleto (${index.skipped} archivos sin indexar). Usa un identificador exacto o consulta el repositorio.`);
        await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
        const temporary = cache + '.' + randomUUID() + '.tmp';
        try { signal.throwIfAborted(); await fs.writeFile(temporary, JSON.stringify(index), { mode: 0o600 }); await fs.rename(temporary, cache); }
        finally { await fs.rm(temporary, { force: true }); }
      }
      const query = normalizeLegalText(plan.query), words = query.split(' ');
      const matches = index.entries.filter(e => normalizeLegalText(e.id) === query || words.every(w => normalizeLegalText(e.title).split(' ').some(t => t === w)))
        .sort((a, b) => Number(normalizeLegalText(b.title) === query || normalizeLegalText(b.id) === query) - Number(normalizeLegalText(a.title) === query || normalizeLegalText(a.id) === query) || a.title.localeCompare(b.title));
      result.totalMatches = matches.length; result.matches = matches.slice(0, 5);
      const exact = matches.filter(e => normalizeLegalText(e.title) === query || normalizeLegalText(e.id) === query);
      const chosen = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : undefined;
      if (chosen) {
        if (!safeLegalPath(chosen.path)) throw Error('Legalize: ruta de catálogo inválida.');
        const raw = await get(base + chosen.path.split('/').map(encodeURIComponent).join('/'), MAX_LAW);
        if (!raw) throw Error('Legalize: documento ausente en la versión consultada.');
        document = parseLegalDocument(raw.toString('utf8'), chosen.path, c.code);
      }
    }
    if (document) {
      result.matches = [{ id: document.id, title: document.title, path: document.path }]; result.totalMatches = 1;
      const text = plan.article ? selectLegalArticle(document.text, plan.article) : document.text;
      if (text.length > 200_000) throw Error('Legalize: la norma es demasiado larga para un mensaje. Solicita un artículo concreto o consulta el enlace al repositorio.');
      result.document = { ...document, text, ...(plan.article ? { article: plan.article } : {}) };
    }
    result.attribution = legalAttribution(result);
    signal.throwIfAborted(); return result;
  } finally { locks.delete(c.code); }
}
