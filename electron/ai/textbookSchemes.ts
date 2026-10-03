import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { TEXTBOOK_ID, textbookCitation, type TextbookCitation, type TextbookSchemeRecord, type TextbookTemplateSource } from '@shared/textbookSchemes';
import { getDb } from '../db/database';
import type { ChemistryEvidenceScope } from './chemistryEvidenceScope';

/**
 * The textbook-scheme reaction index: reactions transcribed from the scheme drawings in the user's
 * own books and checked against their names (tools/scheme-scan/build_index.py). It lives in
 * <userData>/chemistry-schemes/index (NODUS_SCHEME_INDEX_DIR overrides it). It has the Open
 * Reaction Database index's format, so Chemistry Studio's known-reactions and
 * propose-disconnections tools read it unchanged; records.json turns its "tb-…" ids into book,
 * page and conditions. Until the user builds one, everything that uses it is skipped.
 */

const SOURCE = 'nodus.textbook-schemes';
const REQUIRED = ['manifest.json', 'records.json', 'exact.tsv.zst', 'products.tsv.zst', 'reaction-smiles.tsv.zst',
  'molecules.tsv.zst', 'reactions.faiss.zst', 'reaction-keys.txt.zst'];

export function textbookSchemeDirectory(scope?: ChemistryEvidenceScope): string | null {
  if (scope?.workIds?.size === 0) return null;
  const dir = process.env.NODUS_SCHEME_INDEX_DIR
    ? path.resolve(process.env.NODUS_SCHEME_INDEX_DIR)
    : path.join(app.getPath('userData'), 'chemistry-schemes', 'index');
  try {
    if (!REQUIRED.every((name) => fs.statSync(path.join(dir, name)).isFile())) return null;
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { source?: string };
    return manifest.source === SOURCE && (!scope || indexWithinScope(dir, scope)) ? dir : null;
  } catch {
    return null;
  }
}

/** The package searches an entire index, including its templates. Filtering its citations
 * afterwards cannot undo an excluded book's influence on a proposed route. Until the package
 * can filter before search, only indexes entirely attributable to permitted works may run. */
function indexWithinScope(dir: string, scope: ChemistryEvidenceScope): boolean {
  const allowed = new Set((getDb().prepare('SELECT nodus_id, zotero_key FROM works WHERE archived = 0').all() as Array<{ nodus_id: string; zotero_key: string | null }>)
    .filter(work => !scope.workIds || scope.workIds.has(work.nodus_id))
    .flatMap(work => [work.nodus_id, ...(work.zotero_key ? [work.zotero_key] : [])]));
  const permitted = (source: { nodusId?: string }) => !!source.nodusId && allowed.has(source.nodusId);
  // Check the raw files too: parsers used for display skip malformed entries, while an index
  // can still contain the reactions/templates behind them.
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'records.json'), 'utf8')) as Record<string, TextbookSchemeRecord>;
  if (!Object.keys(raw).length || !Object.values(raw).every(source => source && permitted(source))) return false;
  const hasTemplates = ['templates.tsv.zst', 'retro-templates.tsv.zst'].some(file => fs.existsSync(path.join(dir, file)));
  if (hasTemplates || fs.existsSync(path.join(dir, 'template-sources.json'))) {
    const templates = JSON.parse(fs.readFileSync(path.join(dir, 'template-sources.json'), 'utf8')) as Record<string, { sources?: Array<{ nodusId?: string }> }>;
    if (!Object.values(templates).every(entry => Array.isArray(entry?.sources) && entry.sources.length > 0 && entry.sources.every(source => source && permitted(source)))) return false;
  }
  return true;
}

let cached: { file: string; mtimeMs: number; records: Map<string, TextbookSchemeRecord> } | null = null;

/** records.json, read once per build of the index. */
function records(dir: string): Map<string, TextbookSchemeRecord> {
  const file = path.join(dir, 'records.json');
  const mtimeMs = fs.statSync(file).mtimeMs;
  if (cached?.file === file && cached.mtimeMs === mtimeMs) return cached.records;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, TextbookSchemeRecord>;
  const map = new Map(Object.entries(raw).filter(([id, record]) => TEXTBOOK_ID.test(id) && record && typeof record.book === 'string' && Number.isInteger(record.page)));
  cached = { file, mtimeMs, records: map };
  return map;
}

/** A link to the book's text at that page: the passage that starts on it or covers it. Only PDF
 *  pages have one (a scheme read from an EPUB image is cited by chapter, unlinked). */
function pageLink(record: TextbookSchemeRecord, works: Map<string, string | null>): string | null {
  if (record.kind === 'image') return null;
  try {
    const db = getDb();
    if (!works.has(record.nodusId)) {
      const row = db.prepare('SELECT nodus_id FROM works WHERE zotero_key = ? OR nodus_id = ? LIMIT 1').get(record.nodusId, record.nodusId) as { nodus_id: string } | undefined;
      works.set(record.nodusId, row?.nodus_id ?? null);
    }
    const work = works.get(record.nodusId);
    if (!work) return null;
    const passage = db.prepare(
      'SELECT passage_id FROM passages WHERE nodus_id = ? AND page_number IS NOT NULL AND page_number <= ? ORDER BY page_number DESC, chunk_index ASC LIMIT 1',
    ).get(work, record.page) as { passage_id: string } | undefined;
    return passage ? `nodus://passage/${encodeURIComponent(passage.passage_id)}` : null;
  } catch {
    return null;
  }
}

/** Citations for record ids, in the order given; unknown ids are skipped. */
export function textbookCitations(ids: string[], dir = textbookSchemeDirectory(), scope?: ChemistryEvidenceScope): TextbookCitation[] {
  if (!dir || !ids.length) return [];
  let map: Map<string, TextbookSchemeRecord>;
  try {
    if (scope && !indexWithinScope(dir, scope)) return [];
    map = records(dir);
  } catch {
    return [];
  }
  const works = new Map<string, string | null>();
  return ids.flatMap((id) => {
    const record = map.get(id);
    return record ? [textbookCitation(id, record, pageLink(record, works))] : [];
  });
}

let cachedTemplates: { file: string; mtimeMs: number; sources: Map<string, TextbookTemplateSource[]> } | null = null;

/** template-sources.json (retro SMARTS -> the schemes it was extracted from), read once per build
 *  of the index; an index built without templates has none. */
function templateSources(dir: string): Map<string, TextbookTemplateSource[]> {
  const file = path.join(dir, 'template-sources.json');
  const mtimeMs = fs.statSync(file).mtimeMs;
  if (cachedTemplates?.file === file && cachedTemplates.mtimeMs === mtimeMs) return cachedTemplates.sources;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { sources?: unknown }>;
  const sources = new Map<string, TextbookTemplateSource[]>();
  for (const [smarts, entry] of Object.entries(raw)) {
    const list = (Array.isArray(entry?.sources) ? entry.sources : []).filter((source): source is TextbookTemplateSource =>
      !!source && typeof (source as TextbookTemplateSource).book === 'string' && Number.isInteger((source as TextbookTemplateSource).page));
    if (list.length) sources.set(smarts, list);
  }
  cachedTemplates = { file, mtimeMs, sources };
  return sources;
}

/** The schemes behind retro templates, in the templates' order, at most `max` distinct pages;
 *  worked examples (real molecules) before general schemes (R groups). */
export function textbookTemplateCitations(templates: string[], dir = textbookSchemeDirectory(), max = 2, scope?: ChemistryEvidenceScope): TextbookTemplateSource[] {
  if (!dir || !templates.length) return [];
  let map: Map<string, TextbookTemplateSource[]>;
  try {
    if (scope && !indexWithinScope(dir, scope)) return [];
    map = templateSources(dir);
  } catch {
    return [];
  }
  const all = templates.flatMap((smarts) => map.get(smarts) ?? []);
  const ordered = [...all.filter((source) => !source.generic), ...all.filter((source) => source.generic)];
  const seen = new Set<string>();
  const out: TextbookTemplateSource[] = [];
  const works = new Map<string, string | null>();
  for (const source of ordered) {
    const key = `${source.book}#${source.page}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const link = source.nodusId ? pageLink({ nodusId: source.nodusId, page: source.page, kind: source.kind } as TextbookSchemeRecord, works) : null;
    out.push({ ...source, link });
    if (out.length >= max) break;
  }
  return out;
}
