// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import CSL from 'citeproc';
import bundledLocales from '@citation-js/plugin-csl/lib/locales.json';
import bundledStyles from '@citation-js/plugin-csl/lib/styles.json';
import type {
  LibraryCitationResult,
  LibraryCitationStyle,
  LibraryCitationStyleImportReport,
  LibraryCitationStyleRecord,
  LibraryCitationStyleRepositoryEntry,
  LibraryItemRecord,
} from '@shared/libraryTypes';
import type {
  OfficeCitationDocumentRequest,
  OfficeCitationDocumentResult,
  OfficeCitationItem,
} from '@shared/officeCitationTypes';
import { atomicWriteFile, atomicWriteJson, configuredLibraryRootOrThrow, readJsonFile, safeLibraryFolderName } from './libraryPaths';
import { bundledOfficialCslStyle } from './bundledOfficialCslStyles';

type StoredStyleSource = Extract<LibraryCitationStyleRecord['source'], 'zotero' | 'file' | 'repository'>;
interface StoredStyleEntry { id: string; source: StoredStyleSource; fileName: string; importedAt: string }
interface StyleManifest { format: 'nodus.citation-styles'; formatVersion: 1; styles: StoredStyleEntry[] }

const OFFICIAL_ATTRIBUTION = 'Citation styles from the CSL project (https://citationstyles.org/), CC BY-SA 3.0.';
const MAX_STYLE_BYTES = 5 * 1024 * 1024;
const OFFICIAL_STYLES_REVISION = 'v1.0.2';
const OFFICIAL_STYLES_RAW_URL = `https://raw.githubusercontent.com/citation-style-language/styles/${OFFICIAL_STYLES_REVISION}`;
const OFFICIAL_STYLES_TREE_URL = `https://api.github.com/repos/citation-style-language/styles/git/trees/${OFFICIAL_STYLES_REVISION}?recursive=1`;
const BUILTIN_STYLES = [
  { id: 'apa-7', title: 'APA 7', repositoryId: 'apa', pluginId: 'apa' },
  { id: 'chicago-author-date', title: 'Chicago author-date', repositoryId: 'chicago-author-date', pluginId: 'chicago-author-date' },
  { id: 'mla-9', title: 'MLA 9', repositoryId: 'modern-language-association', pluginId: 'modern-language-association' },
  { id: 'ieee', title: 'IEEE', repositoryId: 'ieee', pluginId: 'ieee' },
  { id: 'vancouver', title: 'Vancouver', repositoryId: 'vancouver', pluginId: 'vancouver' },
] as const;

type CslItem = Record<string, unknown> & { id: string };
type CiteprocEngine = {
  setOutputFormat(format: 'text' | 'html'): void;
  updateItems(ids: string[]): void;
  makeCitationCluster(items: Array<Record<string, unknown> & { id: string }>): string;
  rebuildProcessorState(
    citations: Array<{
      citationID: string;
      citationItems: Array<Record<string, unknown> & { id: string }>;
      properties: { noteIndex: number };
    }>,
    mode: 'text' | 'html',
    uncitedItemIds?: string[],
  ): Array<[string, number, string]>;
  makeBibliography(): [{ bibstart?: string; bibend?: string } | null, string[]] | false;
};
type CiteprocConstructor = new (
  system: { retrieveLocale(language: string): string; retrieveItem(id: string): CslItem },
  style: string,
  language?: string,
) => CiteprocEngine;
const Citeproc = CSL as unknown as { Engine: CiteprocConstructor };
let repositoryIndexPromise: Promise<LibraryCitationStyleRepositoryEntry[]> | null = null;

function stylesDirectory(): string { return path.join(configuredLibraryRootOrThrow(), 'citation-styles'); }
function manifestPath(): string { return path.join(stylesDirectory(), 'styles.json'); }
function stylePath(fileName: string): string {
  const target = path.resolve(stylesDirectory(), fileName);
  const root = path.resolve(stylesDirectory());
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('La ruta del estilo CSL no es válida.');
  return target;
}
function manifest(): StyleManifest {
  const value = readJsonFile<StyleManifest>(manifestPath());
  return value?.format === 'nodus.citation-styles' && value.formatVersion === 1 && Array.isArray(value.styles)
    ? value : { format: 'nodus.citation-styles', formatVersion: 1, styles: [] };
}
function saveManifest(value: StyleManifest): void { atomicWriteJson(manifestPath(), value); }
function decodeXml(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function tagText(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(xml);
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) || null : null;
}
function tagAttribute(xml: string, tag: string, attribute: string, predicate?: string): string | null {
  for (const match of xml.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))) {
    if (predicate && !new RegExp(predicate, 'i').test(match[0])) continue;
    const value = new RegExp(`\\b${attribute}\\s*=\\s*["']([^"']+)["']`, 'i').exec(match[0])?.[1];
    if (value) return decodeXml(value.trim());
  }
  return null;
}
function styleSlug(xml: string, fallback: string): string {
  const id = tagText(xml, 'id') || fallback;
  const tail = id.replace(/[?#].*$/, '').split('/').filter(Boolean).at(-1) || fallback;
  const slug = tail.toLowerCase().replace(/\.csl$/i, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || `style-${createHash('sha256').update(xml).digest('hex').slice(0, 16)}`;
}
function validateStyleXml(xml: string): void {
  if (!/<style\b[^>]*xmlns=["']http:\/\/purl\.org\/net\/xbiblio\/csl["']/i.test(xml)) throw new Error('El archivo no es un estilo CSL válido.');
  if (!/<info\b/i.test(xml) || !tagText(xml, 'title') || !tagText(xml, 'id')) throw new Error('El estilo CSL no incluye título e identificador.');
  if (!/<citation\b/i.test(xml) && !tagAttribute(xml, 'link', 'href', 'rel=["\']independent-parent["\']')) throw new Error('El estilo CSL no contiene reglas de citación ni un estilo padre.');
}
function styleRecord(entry: StoredStyleEntry): LibraryCitationStyleRecord | null {
  const file = stylePath(entry.fileName);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  const xml = fs.readFileSync(file, 'utf8');
  try { validateStyleXml(xml); } catch { return null; }
  const rights = tagText(xml, 'rights'); const dependentParent = tagAttribute(xml, 'link', 'href', 'rel=["\']independent-parent["\']');
  const license = tagAttribute(xml, 'rights', 'license') || (rights && /creativecommons\.org\/licenses\/by-sa\/3\.0/i.test(rights) ? 'CC-BY-SA-3.0' : null);
  const parentId = dependentParent ? repositoryIdFromUrl(dependentParent) : null;
  const parentAvailable = !dependentParent || !!parentId && (manifest().styles.some((style) => style.id === parentId)
    || BUILTIN_STYLES.some((style) => style.repositoryId === parentId && !!style.pluginId && !!bundledStyleXml(style.pluginId)));
  const warnings = [
    !license && entry.source !== 'repository' ? 'Este estilo personalizado no declara una licencia. Nodus puede usar tu copia local, pero no la redistribuirá.' : null,
    !parentAvailable ? 'El estilo padre independiente se descargará y guardará la primera vez que se use.' : null,
  ].filter((value): value is string => !!value);
  return {
    id: entry.id, title: tagText(xml, 'title') || entry.id, source: entry.source, fileName: entry.fileName,
    updatedAt: tagText(xml, 'updated'),
    citationFormat: tagAttribute(xml, 'category', 'citation-format') as LibraryCitationStyleRecord['citationFormat'],
    dependentParent,
    rights, license, availableOffline: parentAvailable, removable: true, warning: warnings.join(' ') || null,
  };
}
function storedRecords(): LibraryCitationStyleRecord[] { return manifest().styles.map(styleRecord).filter((entry): entry is LibraryCitationStyleRecord => !!entry); }
function storedById(id: string): { record: LibraryCitationStyleRecord; xml: string } | null {
  const record = storedRecords().find((entry) => entry.id === id);
  if (!record?.fileName) return null;
  return { record, xml: fs.readFileSync(stylePath(record.fileName), 'utf8') };
}

function repositoryIdFromUrl(value: string): string | null {
  const trimmed = value.trim();
  const publicMatch = /^https?:\/\/(?:www\.)?(?:zotero\.org|citationstyles\.org)\/styles\/([^/?#]+)(?:\.csl)?(?:[?#].*)?$/i.exec(trimmed);
  if (publicMatch?.[1]) return publicMatch[1].toLowerCase();
  const githubMatch = /^https?:\/\/(?:raw\.githubusercontent\.com\/citation-style-language\/styles\/[^/]+|github\.com\/citation-style-language\/styles\/(?:raw|blob)\/[^/]+)\/([^/?#]+)\.csl(?:[?#].*)?$/i.exec(trimmed);
  return githubMatch?.[1]?.toLowerCase() ?? null;
}

function normalizeStyleSearch(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function repositoryStyleTitle(id: string): string {
  return id.split(/[-_.]+/).filter(Boolean).map((part) => /^(apa|apsa|asa|ama|mla|ieee|iso|mhra)$/i.test(part)
    ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

async function officialRepositoryIndex(): Promise<LibraryCitationStyleRepositoryEntry[]> {
  if (!repositoryIndexPromise) {
    repositoryIndexPromise = fetch(OFFICIAL_STYLES_TREE_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Nodus/4.1.5' },
    }).then(async (response) => {
      if (!response.ok) throw new Error(`El repositorio oficial de CSL respondió ${response.status}.`);
      const payload = await response.json() as { tree?: Array<{ path?: string; type?: string }>; truncated?: boolean };
      if (!Array.isArray(payload.tree)) throw new Error('El índice del repositorio oficial de CSL no es válido.');
      return payload.tree.flatMap((entry) => entry.type === 'blob' && typeof entry.path === 'string'
        && !entry.path.includes('/') && entry.path.toLowerCase().endsWith('.csl')
        ? [{ id: entry.path.slice(0, -4), title: repositoryStyleTitle(entry.path.slice(0, -4)) }] : [])
        .sort((a, b) => a.title.localeCompare(b.title));
    }).catch((cause) => {
      repositoryIndexPromise = null;
      throw cause;
    });
  }
  return repositoryIndexPromise;
}

export async function searchRepositoryCitationStyles(rawQuery: string, rawLimit = 80): Promise<LibraryCitationStyleRepositoryEntry[]> {
  const query = normalizeStyleSearch(rawQuery);
  const tokens = query.split(' ').filter(Boolean);
  const limit = Math.max(1, Math.min(200, Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 80));
  const index = await officialRepositoryIndex();
  return index.filter((entry) => {
    const haystack = normalizeStyleSearch(`${entry.title} ${entry.id}`);
    return tokens.every((token) => haystack.includes(token));
  }).slice(0, limit);
}

function bundledStyleXml(id: string): string | null {
  const xml = (bundledStyles as Record<string, string>)[id];
  if (typeof xml === 'string' && xml.includes('<style')) return xml;
  return bundledOfficialCslStyle(id);
}

export function listLibraryCitationStyles(): LibraryCitationStyleRecord[] {
  const stored = storedRecords();
  const builtins = BUILTIN_STYLES.map((entry) => {
    const cached = stored.find((style) => style.id === entry.repositoryId);
    const bundledXml = entry.pluginId ? bundledStyleXml(entry.pluginId) : null;
    return {
      id: entry.id, title: entry.title, source: 'bundled' as const, fileName: cached?.fileName ?? null,
      updatedAt: cached?.updatedAt ?? null,
      citationFormat: cached?.citationFormat
        ?? (bundledXml ? tagAttribute(bundledXml, 'category', 'citation-format') as LibraryCitationStyleRecord['citationFormat'] : null),
      dependentParent: null, rights: cached?.rights ?? OFFICIAL_ATTRIBUTION, license: 'CC-BY-SA-3.0',
      availableOffline: !!(entry.pluginId && bundledStyleXml(entry.pluginId)) || !!cached, removable: false, warning: cached ? null : entry.pluginId ? null : 'El archivo CSL exacto se guardará desde el repositorio oficial de CSL la primera vez que se use.',
    };
  });
  return [...builtins, ...stored.filter((entry) => !BUILTIN_STYLES.some((builtin) => builtin.id === entry.id || builtin.repositoryId === entry.id))]
    .sort((a, b) => Number(a.source !== 'bundled') - Number(b.source !== 'bundled') || a.title.localeCompare(b.title));
}

export function importLibraryCitationStyleFiles(files: string[], source: Exclude<StoredStyleSource, 'repository'>): LibraryCitationStyleImportReport {
  fs.mkdirSync(stylesDirectory(), { recursive: true });
  const current = manifest(); const warnings: string[] = []; let imported = 0; let updated = 0; let skipped = 0;
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_STYLE_BYTES || path.extname(file).toLowerCase() !== '.csl') throw new Error('The file is not a readable CSL style under 5 MB.');
      const xml = fs.readFileSync(file, 'utf8'); validateStyleXml(xml);
      const id = styleSlug(xml, path.basename(file, '.csl')); const fileName = `${safeLibraryFolderName(id)}.csl`;
      const existing = current.styles.findIndex((entry) => entry.id === id);
      atomicWriteFile(stylePath(fileName), xml.replace(/\r\n?/g, '\n'));
      const entry: StoredStyleEntry = { id, source, fileName, importedAt: new Date().toISOString() };
      if (existing >= 0) { current.styles[existing] = entry; updated += 1; } else { current.styles.push(entry); imported += 1; }
      if (!tagAttribute(xml, 'rights', 'license') && !tagText(xml, 'rights')) warnings.push(`${tagText(xml, 'title') || id}: no license is declared; the style remains local and is not redistributed.`);
    } catch (error) { skipped += 1; warnings.push(`${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  saveManifest(current);
  return { imported, updated, skipped, styles: listLibraryCitationStyles(), warnings };
}

export function zoteroStyleDirectories(): string[] {
  const candidates = [
    path.join(os.homedir(), 'Zotero', 'styles'),
    path.join(os.homedir(), '.zotero', 'zotero', 'styles'),
    ...(process.platform === 'win32' && process.env.APPDATA ? [path.join(process.env.APPDATA, 'Zotero', 'Zotero', 'styles')] : []),
  ];
  return [...new Set(candidates.map((entry) => path.resolve(entry)))].filter((entry) => fs.existsSync(entry) && fs.statSync(entry).isDirectory());
}
export function importZoteroCitationStyleDirectories(directories = zoteroStyleDirectories()): LibraryCitationStyleImportReport {
  const files = directories.flatMap((directory) => fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.csl')).map((entry) => path.join(directory, entry.name)));
  if (!files.length) return { imported: 0, updated: 0, skipped: 0, styles: listLibraryCitationStyles(), warnings: ['No Zotero CSL styles were found. Choose the Zotero styles folder manually if it uses a custom location.'] };
  return importLibraryCitationStyleFiles(files, 'zotero');
}

export async function installRepositoryCitationStyle(rawId: string): Promise<LibraryCitationStyleRecord> {
  const id = repositoryIdFromUrl(rawId) ?? rawId.trim().toLowerCase().replace(/\.csl$/i, '');
  if (!/^[a-z0-9][a-z0-9._-]{1,199}$/.test(id)) throw new Error('Introduce el identificador de un estilo del repositorio oficial de CSL.');
  const response = await fetch(`${OFFICIAL_STYLES_RAW_URL}/${encodeURIComponent(id)}.csl`, {
    headers: { Accept: 'application/vnd.citationstyles.style+xml, application/xml;q=0.9', 'User-Agent': 'Nodus/4.1.5' },
  });
  if (!response.ok) throw new Error(`El repositorio oficial de CSL respondió ${response.status}.`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_STYLE_BYTES) throw new Error('El estilo CSL supera el límite de 5 MB.');
  const xml = await response.text();
  if (Buffer.byteLength(xml, 'utf8') > MAX_STYLE_BYTES) throw new Error('El estilo CSL supera el límite de 5 MB.');
  validateStyleXml(xml); fs.mkdirSync(stylesDirectory(), { recursive: true });
  const actualId = styleSlug(xml, id); const fileName = `${safeLibraryFolderName(actualId)}.csl`; atomicWriteFile(stylePath(fileName), xml.replace(/\r\n?/g, '\n'));
  const current = manifest(); const entry: StoredStyleEntry = { id: actualId, source: 'repository', fileName, importedAt: new Date().toISOString() };
  const existing = current.styles.findIndex((item) => item.id === actualId); if (existing >= 0) current.styles[existing] = entry; else current.styles.push(entry); saveManifest(current);
  const record = styleRecord(entry); if (!record) throw new Error('El estilo descargado no pudo validarse.'); return record;
}

export function removeLibraryCitationStyle(id: string): boolean {
  const current = manifest(); const index = current.styles.findIndex((entry) => entry.id === id);
  if (index < 0) return false;
  const [entry] = current.styles.splice(index, 1); const file = stylePath(entry.fileName);
  if (fs.existsSync(file)) fs.unlinkSync(file); saveManifest(current); return true;
}

function cslData(record: LibraryItemRecord): Record<string, unknown> {
  const metadata = record.metadata;
  const creator = (type: string) => metadata.creators.filter((entry) => entry.creatorType === type).map((entry) => entry.name ? { literal: entry.name } : { given: entry.firstName, family: entry.lastName });
  const creators = (...types: string[]) => types.flatMap(creator);
  const primaryCreatorRoles: Partial<Record<LibraryItemRecord['metadata']['itemType'], string[]>> = {
    artwork: ['artist'], map: ['cartographer'], patent: ['inventor'], interview: ['interviewer'],
    film: ['director'], 'video-recording': ['director'], 'audio-recording': ['performer', 'composer'],
    'radio-broadcast': ['director'], 'tv-broadcast': ['director'], podcast: ['podcaster'],
    presentation: ['presenter'], 'computer-program': ['programmer'],
  };
  const typeMap: Partial<Record<LibraryItemRecord['metadata']['itemType'], string>> = {
    'article-journal': 'article-journal', 'journal-article': 'article-journal', 'magazine-article': 'article-magazine',
    'newspaper-article': 'article-newspaper', book: 'book', 'book-chapter': 'chapter', chapter: 'chapter',
    'book-section': 'chapter', 'conference-paper': 'paper-conference', thesis: 'thesis', report: 'report',
    manuscript: 'manuscript', presentation: 'speech', interview: 'interview', letter: 'personal_communication',
    email: 'personal_communication', 'instant-message': 'personal_communication', 'encyclopedia-article': 'entry-encyclopedia',
    'dictionary-entry': 'entry-dictionary', case: 'legal_case', hearing: 'hearing', bill: 'bill', statute: 'legislation',
    patent: 'patent', artwork: 'graphic', map: 'map', film: 'motion_picture', 'audio-recording': 'song',
    'video-recording': 'motion_picture', 'radio-broadcast': 'broadcast', 'tv-broadcast': 'broadcast', podcast: 'broadcast',
    'blog-post': 'post-weblog', 'forum-post': 'post', 'computer-program': 'software', webpage: 'webpage',
    document: 'document', dataset: 'dataset', preprint: 'article', standard: 'standard', other: 'document',
  };
  return {
    id: record.id, type: typeMap[metadata.itemType] ?? 'document', title: metadata.title,
    author: creators('author', ...(primaryCreatorRoles[metadata.itemType] ?? [])),
    editor: creator('editor'),
    translator: creator('translator'),
    'container-author': creator('bookAuthor'),
    'collection-editor': creator('seriesEditor'),
    'reviewed-author': creator('reviewedAuthor'),
    recipient: creator('recipient'),
    interviewer: creator('interviewer'),
    composer: creator('composer'),
    director: creator('director'),
    illustrator: creators('artist', 'illustrator'),
    ...(metadata.year != null ? { issued: { 'date-parts': [[metadata.year]] } } : {}),
    abstract: metadata.abstract, 'container-title': metadata.publicationTitle, publisher: metadata.publisher,
    'publisher-place': metadata.place, volume: metadata.volume, issue: metadata.issue, page: metadata.pages,
    edition: metadata.edition, DOI: metadata.doi, ISBN: metadata.isbn, ISSN: metadata.issn, URL: metadata.url,
    language: metadata.language, keyword: metadata.tags?.join('; '),
    ...Object.fromEntries(Object.entries(metadata.extra ?? {}).map(([key, value]) => [key.replace(/^csl:/, ''), value])),
  };
}

async function runtimeStyle(
  style: LibraryCitationStyle,
  seen = new Set<string>(),
): Promise<{ xml: string; title: string; citationFormat: LibraryCitationStyleRecord['citationFormat'] }> {
  if (seen.has(style)) throw new Error('El estilo CSL contiene un ciclo entre estilos dependientes.');
  seen.add(style);
  const builtin = BUILTIN_STYLES.find((entry) => entry.id === style || entry.repositoryId === style);
  if (builtin?.pluginId) {
    const xml = bundledStyleXml(builtin.pluginId);
    if (xml) return {
      xml,
      title: builtin.title,
      citationFormat: tagAttribute(xml, 'category', 'citation-format') as LibraryCitationStyleRecord['citationFormat'],
    };
  }
  let installed = storedById(style);
  if (!installed && builtin) {
    await installRepositoryCitationStyle(builtin.repositoryId); installed = storedById(builtin.repositoryId);
  }
  if (!installed) throw new Error('El estilo CSL seleccionado no está instalado.');
  const parentUrl = installed.record.dependentParent;
  if (!parentUrl) return {
    xml: installed.xml,
    title: installed.record.title,
    citationFormat: installed.record.citationFormat,
  };
  const parentId = repositoryIdFromUrl(parentUrl);
  if (!parentId) throw new Error('El estilo CSL dependiente no contiene una referencia válida a su estilo padre.');
  if (!storedById(parentId) && !BUILTIN_STYLES.some((entry) => entry.id === parentId || entry.repositoryId === parentId)) {
    await installRepositoryCitationStyle(parentId);
  }
  const parent = await runtimeStyle(parentId, seen);
  return {
    xml: parent.xml,
    title: installed.record.title,
    citationFormat: installed.record.citationFormat ?? parent.citationFormat,
  };
}

export async function formatLibraryCitationCsl(records: LibraryItemRecord[], style: LibraryCitationStyle, kind: 'citation' | 'bibliography', locale = 'es-ES'): Promise<LibraryCitationResult> {
  if (!records.length) throw new Error('Selecciona al menos una referencia para generar la cita.');
  const selected = await runtimeStyle(style); const items = Object.fromEntries(records.map((record) => [record.id, cslData(record) as CslItem]));
  const localeXml = (language: string) => {
    const available = bundledLocales as Record<string, string>;
    const base = language.split('-')[0].toLowerCase();
    const matched = Object.keys(available).find((key) => key.toLowerCase() === language.toLowerCase())
      ?? Object.keys(available).find((key) => key.toLowerCase().startsWith(`${base}-`));
    return matched ? available[matched] : available['en-US'];
  };
  const engine = new Citeproc.Engine({ retrieveLocale: localeXml, retrieveItem: (id) => items[id] }, selected.xml, locale);
  engine.setOutputFormat('text'); engine.updateItems(records.map((record) => record.id));
  let text = '';
  if (kind === 'citation') text = engine.makeCitationCluster(records.map((record) => ({ id: record.id })));
  else {
    const bibliography = engine.makeBibliography();
    if (!bibliography) throw new Error('El estilo CSL no define una bibliografía.');
    text = `${bibliography[0]?.bibstart ?? ''}${bibliography[1].join('')}${bibliography[0]?.bibend ?? ''}`;
  }
  text = text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  return { style, styleTitle: selected.title, locale, kind, itemIds: records.map((record) => record.id), text };
}

function citeprocCitationItem(item: OfficeCitationItem): Record<string, unknown> & { id: string } {
  return {
    id: item.id,
    ...(item.locator?.trim() ? { locator: item.locator.trim() } : {}),
    ...(item.label ? { label: item.label } : {}),
    ...(item.prefix?.trim() ? { prefix: item.prefix.trim() } : {}),
    ...(item.suffix?.trim() ? { suffix: item.suffix.trim() } : {}),
    ...(item.suppressAuthor ? { 'suppress-author': true } : {}),
  };
}

function cleanCitationOutput(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
}

/**
 * Formats a whole editor document in one citeproc state. Unlike isolated
 * makeCitationCluster calls, this preserves CSL sorting, ibid rules and author
 * disambiguation across every citation in document order.
 */
export async function formatLibraryOfficeDocumentCsl(
  records: LibraryItemRecord[],
  request: OfficeCitationDocumentRequest,
): Promise<OfficeCitationDocumentResult> {
  const selected = await runtimeStyle(request.style);
  const recordById = new Map(records.map((record) => [record.id, record]));
  const items = Object.fromEntries(records.map((record) => [record.id, cslData(record) as CslItem]));
  const localeXml = (language: string) => {
    const available = bundledLocales as Record<string, string>;
    const base = language.split('-')[0].toLowerCase();
    const matched = Object.keys(available).find((key) => key.toLowerCase() === language.toLowerCase())
      ?? Object.keys(available).find((key) => key.toLowerCase().startsWith(`${base}-`));
    return matched ? available[matched] : available['en-US'];
  };
  const citations = request.citations.map((citation, index) => ({
    citationID: citation.citationId || `nodus-citation-${index + 1}`,
    citationItems: citation.citationItems.map(citeprocCitationItem),
    properties: { noteIndex: Math.max(0, Math.trunc(citation.noteIndex || 0)) },
  }));
  const renderCitations = (mode: 'text' | 'html') => {
    const engine = new Citeproc.Engine({ retrieveLocale: localeXml, retrieveItem: (id) => items[id] }, selected.xml, request.locale);
    return new Map(engine.rebuildProcessorState(citations, mode).map(([id, , value]) => [id, cleanCitationOutput(value)]));
  };
  const textCitations = citations.length ? renderCitations('text') : new Map<string, string>();
  const htmlCitations = citations.length ? renderCitations('html') : new Map<string, string>();

  const excluded = new Set([
    ...(request.excludedItemIds ?? []),
    ...request.citations.flatMap((citation) => citation.citationItems.filter((item) => item.excludeFromBibliography).map((item) => item.id)),
  ]);
  const bibliographyIds = [...new Set([
    ...request.citations.flatMap((citation) => citation.citationItems.map((item) => item.id)),
    ...(request.uncitedItemIds ?? []),
    ...(request.uncitedItems ?? []).map((item) => item.id),
  ])].filter((id) => !excluded.has(id) && recordById.has(id));
  const renderBibliography = (mode: 'text' | 'html') => {
    if (!bibliographyIds.length) return '';
    const engine = new Citeproc.Engine({ retrieveLocale: localeXml, retrieveItem: (id) => items[id] }, selected.xml, request.locale);
    engine.setOutputFormat(mode);
    engine.updateItems(bibliographyIds);
    const bibliography = engine.makeBibliography();
    if (!bibliography) return '';
    return cleanCitationOutput(`${bibliography[0]?.bibstart ?? ''}${bibliography[1].join('')}${bibliography[0]?.bibend ?? ''}`);
  };
  const bibliographyText = renderBibliography('text');
  const bibliographyHtml = renderBibliography('html');
  // A dependent style inherits rendering from its independent parent, but its
  // own category is the authoritative signal for note/in-text placement.
  const citationFormat = selected.citationFormat as OfficeCitationDocumentResult['citationFormat'];
  return {
    style: request.style,
    styleTitle: selected.title,
    locale: request.locale,
    citationFormat,
    citations: request.citations.map((citation) => ({
      citationId: citation.citationId,
      noteIndex: citation.noteIndex,
      itemIds: citation.citationItems.map((item) => item.id),
      text: textCitations.get(citation.citationId) ?? '',
      html: htmlCitations.get(citation.citationId) ?? '',
    })),
    bibliography: bibliographyIds.length ? {
      itemIds: bibliographyIds,
      text: bibliographyText,
      html: bibliographyHtml,
    } : null,
  };
}
