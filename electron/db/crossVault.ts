// Cross-vault entity access for databases-mode relations. A relation cell can link to
// a Nodus entity (academic idea/gap/work/author, genealogy person) that lives in a
// DIFFERENT vault. Each vault is its own nodus.sqlite, so we open sibling vaults
// read-only (cached) to search candidates and resolve labels. Links are "live
// references": if the entity or its vault is gone, resolution reports `broken`.

import Database from 'better-sqlite3';
import { getDb } from './database';
import { getActiveVault, getVault, listVaults } from '../vaults/vaultRegistry';
import type { RelationTargetKind } from '@shared/databases';

type EntityKind = Exclude<RelationTargetKind, 'db_row'>;

/** Per-kind SQL: `search` (label LIKE ?, LIMIT ?) and `resolve` (by id). */
const ENTITY_QUERIES: Record<EntityKind, { search: string; resolve: string }> = {
  work: {
    search: "SELECT nodus_id AS id, title AS label FROM works WHERE archived = 0 AND LOWER(COALESCE(title,'')) LIKE ? ORDER BY title LIMIT ?",
    resolve: 'SELECT title AS label FROM works WHERE nodus_id = ?',
  },
  idea: {
    search: "SELECT global_id AS id, label FROM ideas WHERE LOWER(COALESCE(label,'')) LIKE ? ORDER BY label LIMIT ?",
    resolve: 'SELECT label FROM ideas WHERE global_id = ?',
  },
  gap: {
    search: "SELECT id, statement AS label FROM gaps WHERE LOWER(COALESCE(statement,'')) LIKE ? ORDER BY statement LIMIT ?",
    resolve: 'SELECT statement AS label FROM gaps WHERE id = ?',
  },
  author: {
    search: "SELECT author_id AS id, name AS label FROM authors WHERE LOWER(COALESCE(name,'')) LIKE ? ORDER BY name LIMIT ?",
    resolve: 'SELECT name AS label FROM authors WHERE author_id = ?',
  },
  person: {
    search: "SELECT person_id AS id, display_name AS label FROM persons WHERE LOWER(COALESCE(display_name,'')) LIKE ? ORDER BY display_name LIMIT ?",
    resolve: 'SELECT display_name AS label FROM persons WHERE person_id = ?',
  },
};

// Cached read-only connections to non-active vaults, keyed by their sqlite path.
const readonlyPool = new Map<string, Database.Database>();

function openReadOnly(dbPath: string): Database.Database | null {
  const cached = readonlyPool.get(dbPath);
  if (cached) {
    try {
      cached.prepare('SELECT 1').get();
      return cached;
    } catch {
      readonlyPool.delete(dbPath);
    }
  }
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    readonlyPool.set(dbPath, db);
    return db;
  } catch {
    return null;
  }
}

/** Close all cached read-only connections (call on vault switch to avoid stale snapshots). */
export function closeCrossVaultConnections(): void {
  for (const db of readonlyPool.values()) {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  readonlyPool.clear();
}

function safeActiveId(): string {
  try {
    return getActiveVault().id;
  } catch {
    return '';
  }
}

/** All vaults' DBs (active via getDb, others read-only). Falls back to just the active
 *  DB when the vault registry is unavailable (headless/tests). */
function* eachVaultDb(): Generator<{ vaultId: string; vaultName: string; db: Database.Database }> {
  let vaults: { id: string; name: string; path: string }[] = [];
  try {
    vaults = listVaults();
  } catch {
    vaults = [];
  }
  if (vaults.length === 0) {
    yield { vaultId: '', vaultName: '', db: getDb() };
    return;
  }
  const activeId = safeActiveId();
  for (const v of vaults) {
    const db = v.id === activeId ? getDb() : openReadOnly(v.path);
    if (db) yield { vaultId: v.id, vaultName: v.name, db };
  }
}

export interface CrossVaultHit {
  id: string;
  label: string;
  vaultId: string;
  vaultName: string;
}

type NodiVaultItem = { kind: string; label: string; excerpt?: string };

function safeCount(db: Database.Database, table: string): number {
  try { return Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count); }
  catch { return 0; }
}

function selectNodiItems(
  db: Database.Database,
  sql: string,
  kind: string,
  terms: string[],
  limit = 8
): NodiVaultItem[] {
  try {
    const rows = db.prepare(sql).all() as Array<{ label?: unknown; excerpt?: unknown }>;
    return rows
      .map((row) => ({ kind, label: String(row.label ?? '').trim(), excerpt: String(row.excerpt ?? '').trim() || undefined }))
      .filter((row) => row.label && (terms.length === 0 || terms.some((term) => `${row.label} ${row.excerpt ?? ''}`.toLocaleLowerCase().includes(term))))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Bounded, read-only inventory for Nodi's explicit "all vaults" context. Unlike
 * relation search, this includes study and database surfaces as well as academic
 * and genealogy entities. No active-vault switch is performed.
 */
export function buildNodiAllVaultsContext(question: string): unknown {
  const ignored = new Set(['vault', 'vaults', 'boveda', 'bovedas', 'sobre', 'todos', 'todas', 'donde', 'cuales', 'cuantos', 'tengo', 'contiene', 'resume', 'resumen', 'cuatro', 'menciona', 'elemento', 'verificable', 'cada', 'alguno']);
  const terms = [...new Set(question.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((term) => term.length >= 4 && !ignored.has(term)))].slice(0, 6);
  const activeId = safeActiveId();
  const inventories = [];
  for (const { vaultId, vaultName, db } of eachVaultDb()) {
    let type = 'unknown';
    try { type = getVault(vaultId)?.type ?? 'unknown'; } catch { /* headless fallback */ }
    const items = [
      ...selectNodiItems(db, 'SELECT title AS label, title AS excerpt FROM works WHERE archived = 0 ORDER BY updated_at DESC LIMIT 40', 'obra', terms),
      ...selectNodiItems(db, 'SELECT label, statement AS excerpt FROM ideas ORDER BY created_at DESC LIMIT 40', 'idea', terms),
      ...selectNodiItems(db, 'SELECT display_name AS label, biography AS excerpt FROM persons ORDER BY updated_at DESC LIMIT 40', 'persona', terms),
      ...selectNodiItems(db, 'SELECT title AS label, extracted_text AS excerpt FROM archive_items ORDER BY updated_at DESC LIMIT 40', 'archivo', terms),
      ...selectNodiItems(db, 'SELECT name AS label, description AS excerpt FROM study_courses ORDER BY updated_at DESC LIMIT 40', 'curso', terms),
      ...selectNodiItems(db, 'SELECT name AS label, description AS excerpt FROM study_subjects ORDER BY updated_at DESC LIMIT 40', 'asignatura', terms),
      ...selectNodiItems(db, 'SELECT title AS label, content_markdown AS excerpt FROM study_docs ORDER BY updated_at DESC LIMIT 40', 'apunte', terms),
      ...selectNodiItems(db, 'SELECT name AS label, name AS excerpt FROM db_databases ORDER BY updated_at DESC LIMIT 40', 'base de datos', terms),
    ].slice(0, 14).map((item) => ({ ...item, excerpt: item.excerpt?.slice(0, 500) }));
    inventories.push({
      id: vaultId,
      name: vaultName,
      type,
      active: vaultId === activeId,
      counts: {
        works: safeCount(db, 'works'), ideas: safeCount(db, 'ideas'), persons: safeCount(db, 'persons'),
        archive_items: safeCount(db, 'archive_items'), courses: safeCount(db, 'study_courses'),
        subjects: safeCount(db, 'study_subjects'), study_documents: safeCount(db, 'study_docs'),
        databases: safeCount(db, 'db_databases'),
      },
      matching_or_recent_items: items,
    });
  }
  return {
    note: 'Inventario transversal de solo lectura. Los conteos son completos; los elementos son una muestra acotada por la pregunta.',
    query_terms: terms,
    vaults: inventories,
  };
}

/** Search one entity kind across every vault. */
export function searchEntitiesAcrossVaults(kind: EntityKind, query: string, limit = 20): CrossVaultHit[] {
  const qy = ENTITY_QUERIES[kind];
  if (!qy) return [];
  const like = `%${query.trim().toLowerCase()}%`;
  const hits: CrossVaultHit[] = [];
  for (const { vaultId, vaultName, db } of eachVaultDb()) {
    try {
      const rows = db.prepare(qy.search).all(like, limit) as { id: string; label: string | null }[];
      for (const r of rows) hits.push({ id: r.id, label: r.label || r.id, vaultId, vaultName });
    } catch {
      /* the entity table may not exist in a given vault */
    }
    if (hits.length >= limit * 3) break;
  }
  return hits.slice(0, limit);
}

/** Resolve one entity's label in a specific vault (null → active/current vault). */
export function resolveEntityLabel(
  kind: EntityKind,
  id: string,
  vaultId: string | null
): { label: string; vaultName?: string; broken: boolean } {
  const qy = ENTITY_QUERIES[kind];
  if (!qy) return { label: id, broken: true };
  let db: Database.Database | null = getDb();
  let vaultName: string | undefined;
  if (vaultId) {
    let v: { id: string; name: string; path: string } | null = null;
    try {
      v = getVault(vaultId);
    } catch {
      v = null;
    }
    if (v) {
      vaultName = v.name;
      db = v.id === safeActiveId() ? getDb() : openReadOnly(v.path);
    } else {
      db = null; // the target vault no longer exists
    }
  }
  if (!db) return { label: id, vaultName, broken: true };
  try {
    const row = db.prepare(qy.resolve).get(id) as { label?: string | null } | undefined;
    if (!row || !row.label) return { label: id, vaultName, broken: true };
    return { label: row.label, vaultName, broken: false };
  } catch {
    return { label: id, vaultName, broken: true };
  }
}
