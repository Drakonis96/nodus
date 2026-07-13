/**
 * "Databases" mode — the pure domain model for the Notion-like database manager.
 * Dependency-free so column-type behaviour and cell (de)serialization stay
 * unit-tested without a database. Both the repo (electron/db/databasesRepo.ts) and
 * the views (src/views/DatabasesView.tsx) build on these types and helpers.
 *
 * Storage model: a vault holds many databases; each database has typed columns and
 * rows; a row's value for a column is one text cell (db_cells.value_text). All typed
 * meaning lives here — the DB only ever sees strings — so retyping a column or adding
 * a column needs no schema change (an entity-attribute-value model).
 */

// ── Column types ───────────────────────────────────────────────────────────────

export type DatabaseColumnType =
  | 'title'
  | 'text'
  | 'number'
  | 'date'
  | 'time'
  | 'select'
  | 'multi_select'
  | 'checkbox'
  | 'attachment' // Phase 2
  | 'ai' // Phase 3
  | 'ai_image' // AI-generated image, stored as an attachment
  | 'relation' // Phase 3
  | 'rollup'; // Rollup: aggregate a property across related rows

export interface ColumnTypeDef {
  id: DatabaseColumnType;
  /** Spanish source label; the UI translates it via t(). */
  label: string;
  /** Icon name in src/components/ui.tsx. */
  icon: string;
  /** Whether the type draws its values from a controlled option list (db_select_options). */
  hasOptions: boolean;
  /** Selectable in the current build. attachment/ai/relation ship in later phases. */
  available: boolean;
}

/** Canonical column-type registry; order here is the order shown in the type picker. */
export const COLUMN_TYPES: ColumnTypeDef[] = [
  { id: 'title', label: 'Título', icon: 'heading', hasOptions: false, available: true },
  { id: 'text', label: 'Texto', icon: 'notebook', hasOptions: false, available: true },
  { id: 'number', label: 'Número', icon: 'hash', hasOptions: false, available: true },
  { id: 'date', label: 'Fecha', icon: 'calendar', hasOptions: false, available: true },
  { id: 'time', label: 'Hora', icon: 'clock', hasOptions: false, available: true },
  { id: 'select', label: 'Selección', icon: 'tag', hasOptions: true, available: true },
  { id: 'multi_select', label: 'Selección múltiple', icon: 'tags', hasOptions: true, available: true },
  { id: 'checkbox', label: 'Casilla', icon: 'check', hasOptions: false, available: true },
  { id: 'attachment', label: 'Adjunto', icon: 'upload', hasOptions: false, available: true },
  { id: 'ai', label: 'IA', icon: 'wand', hasOptions: false, available: true },
  { id: 'ai_image', label: 'Imagen IA', icon: 'image', hasOptions: false, available: true },
  { id: 'relation', label: 'Relación', icon: 'link', hasOptions: false, available: true },
  { id: 'rollup', label: 'Rollup', icon: 'layers', hasOptions: false, available: true },
];

const COLUMN_TYPE_BY_ID = new Map<DatabaseColumnType, ColumnTypeDef>(COLUMN_TYPES.map((d) => [d.id, d]));

export function isDatabaseColumnType(value: unknown): value is DatabaseColumnType {
  return typeof value === 'string' && COLUMN_TYPE_BY_ID.has(value as DatabaseColumnType);
}

/** Definition for a type id; falls back to 'text' for unknown/legacy values. */
export function columnTypeDef(type: unknown): ColumnTypeDef {
  return COLUMN_TYPE_BY_ID.get(type as DatabaseColumnType) ?? COLUMN_TYPE_BY_ID.get('text')!;
}

/** Column types offered in the picker for this build. */
export function availableColumnTypes(): ColumnTypeDef[] {
  return COLUMN_TYPES.filter((d) => d.available);
}

export function columnTypeHasOptions(type: unknown): boolean {
  return columnTypeDef(type).hasOptions;
}

// ── Domain types (shared across main + renderer + NodusApi) ─────────────────────

export interface DatabaseSelectOption {
  id: string;
  label: string;
  color: string | null;
  position: number;
}

/** Per-type column configuration. Kept open-ended; later phases add AI/relation keys. */
export interface DatabaseColumnConfig {
  /** number: how to render the value. */
  numberFormat?: 'plain' | 'integer' | 'decimal';
  /** Column width in px (user-resized); falls back to a per-type default. */
  width?: number;
  /** ai columns: the user prompt, whether it auto-recomputes, and an optional source. */
  aiPrompt?: string;
  aiAuto?: boolean;
  /** ai columns: an attachment column whose file(s) feed the prompt (vision/OCR/summary). */
  aiSourceColumnId?: string;
  /** relation columns: what the relation points at, and (for db_row) which database. */
  relationTargetKind?: RelationTargetKind;
  relationTargetDatabaseId?: string;
  /** rollup columns: aggregate a property across the rows a relation column links to. */
  rollupRelationColumnId?: string; // a 'relation' (db_row) column on THIS database
  rollupTargetColumnId?: string; // a column id on the related database ('__title__' for its title)
  rollupFunction?: RollupFunction;
  [key: string]: unknown;
}

export type RollupFunction =
  | 'show' // list the values
  | 'count' // number of related rows
  | 'count_values' // non-empty values
  | 'count_unique' // distinct values
  | 'sum'
  | 'average'
  | 'min'
  | 'max'
  | 'range' // max - min
  | 'percent_checked'; // for checkbox target columns

export const ROLLUP_FUNCTIONS: { id: RollupFunction; label: string }[] = [
  { id: 'show', label: 'Mostrar valores' },
  { id: 'count', label: 'Contar' },
  { id: 'count_values', label: 'Contar con valor' },
  { id: 'count_unique', label: 'Contar únicos' },
  { id: 'sum', label: 'Suma' },
  { id: 'average', label: 'Media' },
  { id: 'min', label: 'Mínimo' },
  { id: 'max', label: 'Máximo' },
  { id: 'range', label: 'Rango' },
  { id: 'percent_checked', label: '% marcadas' },
];

/**
 * Aggregate the display values pulled from a relation's related rows into a rollup
 * string. `values` are already display-ready (raw text, or resolved select labels),
 * one per related row (may be null/empty). Pure — unit-tested.
 */
export function aggregateRollup(fn: RollupFunction, values: (string | null)[]): string {
  const nonEmpty = values.filter((v): v is string => v != null && v.trim() !== '');
  const nums = nonEmpty.map((v) => decodeNumber(v)).filter((n): n is number => n != null);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
  switch (fn) {
    case 'count':
      return String(values.length);
    case 'count_values':
      return String(nonEmpty.length);
    case 'count_unique':
      return String(new Set(nonEmpty).size);
    case 'sum':
      return nums.length ? fmt(nums.reduce((a, b) => a + b, 0)) : '';
    case 'average':
      return nums.length ? fmt(nums.reduce((a, b) => a + b, 0) / nums.length) : '';
    case 'min':
      return nums.length ? fmt(Math.min(...nums)) : '';
    case 'max':
      return nums.length ? fmt(Math.max(...nums)) : '';
    case 'range':
      return nums.length ? fmt(Math.max(...nums) - Math.min(...nums)) : '';
    case 'percent_checked':
      return values.length ? `${Math.round((values.filter((v) => decodeCheckbox(v)).length / values.length) * 100)}%` : '';
    case 'show':
    default:
      return nonEmpty.join(', ');
  }
}

export interface DatabaseColumn {
  id: string;
  databaseId: string;
  name: string;
  type: DatabaseColumnType;
  position: number;
  config: DatabaseColumnConfig;
  /** Only populated for select / multi_select columns. */
  options: DatabaseSelectOption[];
}

export interface DatabaseSummary {
  id: string;
  shortId: string;
  name: string;
  icon: string | null;
  position: number;
  rowCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A database matched by the sidebar search — by its title and/or by its content. */
export interface DatabaseSearchHit {
  id: string;
  shortId: string;
  name: string;
  icon: string | null;
  rowCount: number;
  /** The query appears in the database name. */
  titleMatch: boolean;
  /** How many rows contain the query in a cell (0 when content search is off). */
  contentMatches: number;
}

/** A single row matched by the full-text search, for the dedicated search view. */
export interface DatabaseRowHit {
  databaseId: string;
  databaseName: string;
  databaseShortId: string;
  rowId: string;
  /** The row's Title-column value (empty when the row has no title). */
  title: string;
  /** The column the match was found in, and a short snippet around it. */
  columnName: string;
  snippet: string;
}

/** A file attached to an attachment cell. Metadata only — the blob is fetched on demand. */
export interface DatabaseAttachment {
  id: string;
  rowId: string;
  columnId: string;
  fileName: string | null;
  mimeType: string | null;
  bytes: number;
  hasBlob: boolean;
  contentHash: string | null;
  extractedText: string | null;
  description: string | null;
  /** True when this attachment was produced by an 'ai_image' column (AI generation). */
  aiGenerated: boolean;
  /** The exact image prompt used, for AI-generated attachments (shown in the info panel). */
  aiPrompt: string | null;
  position: number;
  createdAt: string;
}

export type RelationTargetKind = 'db_row' | 'work' | 'idea' | 'gap' | 'author' | 'person';

/** Entity relation kinds live in OTHER vaults (academic/genealogy); db_row is local. */
export const ENTITY_RELATION_KINDS: RelationTargetKind[] = ['work', 'idea', 'gap', 'author', 'person'];
export function isEntityRelationKind(kind: RelationTargetKind): boolean {
  return ENTITY_RELATION_KINDS.includes(kind);
}

/** A relation from a row's relation cell to another DB row or a Nodus entity. */
export interface DatabaseRelation {
  id: string;
  rowId: string;
  columnId: string;
  targetKind: RelationTargetKind;
  targetId: string;
  /** Which vault the target lives in (for cross-vault entity links). Null = this vault. */
  targetVaultId: string | null;
  /** Resolved display label for the target (best-effort). */
  label: string;
  /** The name of the vault the target lives in (for cross-vault links). */
  vaultName?: string;
  /** True when the target could not be resolved (e.g. its vault/entity is gone). */
  broken?: boolean;
  position: number;
  createdAt: string;
}

/** A candidate shown in the relation picker. */
export interface RelationTarget {
  kind: RelationTargetKind;
  id: string;
  label: string;
  sublabel?: string;
  /** For cross-vault entity results: which vault the entity lives in. */
  vaultId?: string;
  vaultName?: string;
}

export const RELATION_TARGET_KINDS: { kind: RelationTargetKind; label: string; icon: string }[] = [
  { kind: 'db_row', label: 'Otra base de datos', icon: 'table' },
  { kind: 'work', label: 'Obra (Zotero)', icon: 'book' },
  { kind: 'idea', label: 'Idea', icon: 'bulb' },
  { kind: 'gap', label: 'Gap / vacío', icon: 'gap' },
  { kind: 'author', label: 'Autor', icon: 'user' },
  { kind: 'person', label: 'Persona', icon: 'users' },
];

/** Coarse file kind for choosing an icon / thumbnail treatment. */
export function attachmentKind(mime: string | null | undefined): 'image' | 'pdf' | 'other' {
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  return 'other';
}

export interface DatabaseRow {
  id: string;
  databaseId: string;
  position: number;
  /** columnId → raw value_text (decode per column type with the helpers below). */
  cells: Record<string, string | null>;
  /** columnId → attachments (metadata only), for attachment columns. */
  attachments?: Record<string, DatabaseAttachment[]>;
  /** columnId → number of relations, for relation columns (labels fetched on demand). */
  relationCounts?: Record<string, number>;
  /** columnId → computed rollup display value, for rollup columns (derived, read-only). */
  rollups?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

/** A database with its column definitions (no rows) — the shape the table header needs. */
export interface DatabaseDetail {
  database: DatabaseSummary;
  columns: DatabaseColumn[];
}

/** Row ordering keys (Phase 1: by row metadata; column-value sorts arrive in Phase 5). */
export type DatabaseRowSort = 'position' | 'createdAsc' | 'createdDesc' | 'updatedDesc';

// ── Short id ────────────────────────────────────────────────────────────────────

// Crockford-ish alphabet: no I/O/0/1 so a hand-typed or spoken id is unambiguous.
const SHORT_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A short, human-friendly database id like `DB-7QK2`. Uniqueness is enforced by the
 * db_databases.short_id UNIQUE constraint; the repo retries on the (rare) collision.
 * `rand` is injectable for deterministic tests.
 */
export function newDatabaseShortId(rand: () => number = Math.random): string {
  let body = '';
  for (let i = 0; i < 4; i++) {
    body += SHORT_ID_ALPHABET[Math.floor(rand() * SHORT_ID_ALPHABET.length)];
  }
  return `DB-${body}`;
}

// ── Entry count / percentage ─────────────────────────────────────────────────────

/** This database's share of all rows across every database in the vault (0–100). */
export function entryPercent(count: number, vaultTotal: number): number {
  if (vaultTotal <= 0) return 0;
  return Math.round((count / vaultTotal) * 100);
}

/**
 * Language-neutral header label: locale-formatted count + its percentage of the
 * vault total, e.g. `"1,240 (37%)"`. The UI prepends the translated noun ("entries").
 */
export function entryCountLabel(count: number, vaultTotal: number): string {
  return `${count.toLocaleString('en-US')} (${entryPercent(count, vaultTotal)}%)`;
}

// ── Cell value (de)serialization ─────────────────────────────────────────────────
// Storage is always text. Encode before writing, decode after reading.

export function encodeNumber(n: number | null): string | null {
  return n == null || !Number.isFinite(n) ? null : String(n);
}

export function decodeNumber(v: string | null): number | null {
  if (v == null) return null;
  const trimmed = v.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function encodeCheckbox(b: boolean): string {
  return b ? '1' : '0';
}

export function decodeCheckbox(v: string | null): boolean {
  return v === '1' || v === 'true';
}

/** A single select stores one option id. */
export function decodeSelect(v: string | null): string | null {
  const trimmed = v?.trim();
  return trimmed ? trimmed : null;
}

/** Multi-select stores a JSON array of option ids. */
export function encodeMultiSelect(ids: string[]): string | null {
  const clean = ids.map((s) => s.trim()).filter(Boolean);
  return clean.length ? JSON.stringify(clean) : null;
}

export function decodeMultiSelect(v: string | null): string[] {
  if (!v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Normalize a raw text value before it is stored for a column type. Defensive: keeps
 * db_cells consistent regardless of how the caller built the string, and turns empty
 * values into NULL so "no value" is unambiguous. Option-id integrity for
 * select/multi_select is handled by the repo against db_select_options.
 */
export function normalizeCellValue(type: DatabaseColumnType, raw: string | null): string | null {
  if (raw == null) return null;
  switch (type) {
    case 'number':
      return encodeNumber(decodeNumber(raw));
    case 'checkbox':
      return decodeCheckbox(raw) ? '1' : '0';
    case 'multi_select':
      return encodeMultiSelect(decodeMultiSelect(raw));
    case 'select':
      return decodeSelect(raw);
    default: {
      const trimmed = raw === '' ? null : raw;
      return trimmed;
    }
  }
}

/** Whether a decoded cell should be treated as empty (for counts and "N/A" rendering). */
export function isCellEmpty(type: DatabaseColumnType, raw: string | null): boolean {
  if (raw == null || raw === '') return true;
  if (type === 'multi_select') return decodeMultiSelect(raw).length === 0;
  if (type === 'checkbox') return false; // a checkbox is never "empty" — it's true or false
  return false;
}
