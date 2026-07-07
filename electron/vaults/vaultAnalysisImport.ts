import Database from 'better-sqlite3';
import fs from 'node:fs';
import type { VaultAnalysisReuseKind, VaultAnalysisReuseResult, VaultAnalysisReuseWorkResult, Work } from '@shared/types';
import { getDb } from '../db/database';
import { purgeDeepData } from '../db/ideasRepo';
import { runMigrations } from '../db/migrations';
import { getActiveVault, listVaults } from './vaultRegistry';

type WorkRow = Work & {
  creators_json?: string | null;
};

interface AnalysisCounts {
  themes: number;
  ideas: number;
  ideaEmbeddings: number;
  summary: number;
  passages: number;
  relations: number;
  authors: number;
  synthesis: number;
}

interface SourceMatch {
  vaultId: string;
  vaultName: string;
  path: string;
  work: WorkRow;
  counts: AnalysisCounts;
}

const SOURCE_ALIAS = 'reuse_source';

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizeDoi(value: string | null | undefined): string {
  return normalizeText(value).replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
}

function placeholders(values: unknown[]): string {
  return values.map(() => '?').join(',');
}

function tableChange(db: Database.Database, tableRows: Record<string, number>, table: string): number {
  const count = (db.prepare('SELECT changes() AS count').get() as { count: number }).count;
  if (count > 0) tableRows[table] = (tableRows[table] ?? 0) + count;
  return count;
}

function openSourceDb(file: string): Database.Database | null {
  if (!fs.existsSync(file)) return null;
  const db = new Database(file);
  try {
    runMigrations(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function sourceCounts(db: Database.Database, nodusId: string): AnalysisCounts {
  const row = db
    .prepare(
      /* sql */ `
        SELECT
          (SELECT COUNT(*) FROM work_themes WHERE nodus_id = @id) AS themes,
          (SELECT COUNT(*) FROM idea_occurrences WHERE nodus_id = @id) AS ideas,
          (
            SELECT COUNT(*)
              FROM idea_occurrences io JOIN ideas i ON i.global_id = io.global_id
             WHERE io.nodus_id = @id AND i.embedding IS NOT NULL
          ) AS ideaEmbeddings,
          (SELECT COUNT(*) FROM work_summaries WHERE nodus_id = @id) AS summary,
          (SELECT COUNT(*) FROM passages WHERE nodus_id = @id) AS passages,
          (SELECT COUNT(*) FROM edges WHERE source_work = @id) AS relations,
          (SELECT COUNT(*) FROM work_authors WHERE nodus_id = @id) AS authors,
          (SELECT COUNT(*) FROM work_idea_synthesis WHERE nodus_id = @id) AS synthesis
      `
    )
    .get({ id: nodusId }) as AnalysisCounts;
  return row;
}

function reusableKinds(work: WorkRow, counts: AnalysisCounts): VaultAnalysisReuseKind[] {
  const kinds = new Set<VaultAnalysisReuseKind>();
  if (work.light_status === 'done' || counts.themes > 0) kinds.add('themes');
  if (work.deep_status === 'done' || counts.ideas > 0) kinds.add('ideas');
  if (counts.ideaEmbeddings > 0) kinds.add('ideaEmbeddings');
  if (work.summary_status === 'done' || counts.summary > 0) kinds.add('summary');
  if (counts.passages > 0) kinds.add('passages');
  if (counts.relations > 0) kinds.add('relations');
  if (counts.authors > 0) kinds.add('authors');
  if (counts.synthesis > 0) kinds.add('synthesis');
  return [...kinds];
}

function findSourceMatch(db: Database.Database, target: WorkRow): WorkRow | null {
  const candidates = db
    .prepare(
      /* sql */ `
        SELECT w.*
          FROM works w
         WHERE w.zotero_key = @zoteroKey
            OR EXISTS (
              SELECT 1 FROM work_aliases a
               WHERE a.nodus_id = w.nodus_id
                 AND a.zotero_key = @zoteroKey
            )
            OR (@doi != '' AND LOWER(COALESCE(w.doi, '')) = @doi)
            OR (
              @title != ''
              AND LOWER(TRIM(w.title)) = @title
              AND (@year IS NULL OR w.year IS NULL OR w.year = @year)
            )
         ORDER BY
         CASE WHEN w.deep_status = 'done' THEN 1 ELSE 0 END DESC,
         CASE WHEN w.summary_status = 'done' THEN 1 ELSE 0 END DESC,
         CASE WHEN w.light_status = 'done' THEN 1 ELSE 0 END DESC,
          w.rowid DESC
         LIMIT 8
      `
    )
    .all({
      zoteroKey: target.zotero_key || '',
      doi: normalizeDoi(target.doi),
      title: normalizeText(target.title),
      year: target.year,
    }) as WorkRow[];

  return (
    candidates.find((candidate) => candidate.zotero_key && candidate.zotero_key === target.zotero_key) ??
    candidates.find((candidate) => normalizeDoi(candidate.doi) && normalizeDoi(candidate.doi) === normalizeDoi(target.doi)) ??
    candidates[0] ??
    null
  );
}

function findBestMatch(target: WorkRow): SourceMatch | null {
  const activeVault = getActiveVault();
  const candidates = listVaults().filter((vault) => vault.id !== activeVault.id && fs.existsSync(vault.path));
  for (const vault of candidates) {
    const db = openSourceDb(vault.path);
    if (!db) continue;
    try {
      const work = findSourceMatch(db, target);
      if (!work) continue;
      const counts = sourceCounts(db, work.nodus_id);
      if (reusableKinds(work, counts).length === 0) continue;
      return { vaultId: vault.id, vaultName: vault.name, path: vault.path, work, counts };
    } finally {
      db.close();
    }
  }
  return null;
}

function copyThemes(db: Database.Database, sourceId: string, targetId: string, tableRows: Record<string, number>): void {
  const themes = db
    .prepare(
      /* sql */ `
        SELECT t.theme_id, t.label, t.created_at, COALESCE(t.pinned, 0) AS pinned
          FROM ${SOURCE_ALIAS}.work_themes wt
          JOIN ${SOURCE_ALIAS}.themes t ON t.theme_id = wt.theme_id
         WHERE wt.nodus_id = ?
      `
    )
    .all(sourceId) as { theme_id: string; label: string; created_at: string; pinned: number }[];
  if (themes.length === 0) return;
  db.prepare('DELETE FROM work_themes WHERE nodus_id = ?').run(targetId);
  tableChange(db, tableRows, 'work_themes');
  const findTheme = db.prepare('SELECT theme_id FROM themes WHERE label = ?');
  const insertTheme = db.prepare('INSERT OR IGNORE INTO themes (theme_id, label, created_at, pinned) VALUES (?, ?, ?, ?)');
  const linkTheme = db.prepare('INSERT OR IGNORE INTO work_themes (nodus_id, theme_id) VALUES (?, ?)');
  for (const theme of themes) {
    const existing = findTheme.get(theme.label) as { theme_id: string } | undefined;
    const themeId = existing?.theme_id ?? theme.theme_id;
    if (!existing) {
      insertTheme.run(theme.theme_id, theme.label, theme.created_at, theme.pinned);
      tableChange(db, tableRows, 'themes');
    }
    linkTheme.run(targetId, themeId);
    tableChange(db, tableRows, 'work_themes');
  }
}

function copyIdeaThemeLinks(db: Database.Database, sourceId: string, targetId: string, tableRows: Record<string, number>): void {
  const links = db
    .prepare(
      /* sql */ `
        SELECT it.global_id, it.confidence, it.basis, t.label
          FROM ${SOURCE_ALIAS}.idea_theme_links it
          JOIN ${SOURCE_ALIAS}.themes t ON t.theme_id = it.theme_id
         WHERE it.nodus_id = ?
      `
    )
    .all(sourceId) as { global_id: string; confidence: number; basis: string; label: string }[];
  const findTheme = db.prepare('SELECT theme_id FROM themes WHERE label = ?');
  const insertLink = db.prepare(
    'INSERT OR REPLACE INTO idea_theme_links (nodus_id, global_id, theme_id, confidence, basis) VALUES (?, ?, ?, ?, ?)'
  );
  for (const link of links) {
    const theme = findTheme.get(link.label) as { theme_id: string } | undefined;
    if (!theme) continue;
    insertLink.run(targetId, link.global_id, theme.theme_id, link.confidence, link.basis);
    tableChange(db, tableRows, 'idea_theme_links');
  }
}

function copyDeepAnalysis(db: Database.Database, sourceId: string, targetId: string, tableRows: Record<string, number>): void {
  db.prepare(
    /* sql */ `
      INSERT OR IGNORE INTO ideas (
        global_id, type, label, statement, embedding, created_at,
        embedding_provider, embedding_model, embedding_dim, embedding_text_hash
      )
      SELECT global_id, type, label, statement, embedding, created_at,
             embedding_provider, embedding_model, embedding_dim, embedding_text_hash
        FROM ${SOURCE_ALIAS}.ideas
       WHERE global_id IN (
         SELECT global_id FROM ${SOURCE_ALIAS}.idea_occurrences WHERE nodus_id = @sourceId
       )
    `
  ).run({ sourceId });
  tableChange(db, tableRows, 'ideas');

  db.prepare(
    /* sql */ `
      INSERT OR REPLACE INTO idea_occurrences (global_id, nodus_id, role, development, confidence)
      SELECT global_id, @targetId, role, development, confidence
        FROM ${SOURCE_ALIAS}.idea_occurrences
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'idea_occurrences');

  db.prepare(
    /* sql */ `
      INSERT OR IGNORE INTO evidence (id, global_id, nodus_id, quote, location, kind)
      SELECT id, global_id, @targetId, quote, location, kind
        FROM ${SOURCE_ALIAS}.evidence
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'evidence');

  db.prepare(
    /* sql */ `
      INSERT OR IGNORE INTO edges (id, from_id, to_id, type, basis, confidence, source_work)
      SELECT id, from_id, to_id, type, basis, confidence,
             CASE WHEN source_work = @sourceId THEN @targetId ELSE source_work END
        FROM ${SOURCE_ALIAS}.edges
       WHERE source_work = @sourceId
          OR (
            from_id IN (SELECT global_id FROM ${SOURCE_ALIAS}.idea_occurrences WHERE nodus_id = @sourceId)
            AND to_id IN (SELECT global_id FROM ${SOURCE_ALIAS}.idea_occurrences WHERE nodus_id = @sourceId)
          )
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'edges');

  db.prepare(
    /* sql */ `
      INSERT OR IGNORE INTO edge_traces (
        edge_id, method, model_json, embedding_provider, embedding_model,
        similarity, rationale, created_at
      )
      SELECT edge_id, method, model_json, embedding_provider, embedding_model,
             similarity, rationale, created_at
        FROM ${SOURCE_ALIAS}.edge_traces
       WHERE EXISTS (SELECT 1 FROM main.edges e WHERE e.id = ${SOURCE_ALIAS}.edge_traces.edge_id)
    `
  ).run();
  tableChange(db, tableRows, 'edge_traces');

  copyIdeaThemeLinks(db, sourceId, targetId, tableRows);

  db.prepare(
    /* sql */ `
      INSERT OR IGNORE INTO gaps (id, nodus_id, related_idea, kind, statement, confidence, evidence_id)
      SELECT id, @targetId, related_idea, kind, statement, confidence, evidence_id
        FROM ${SOURCE_ALIAS}.gaps
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'gaps');

  db.prepare(
    /* sql */ `
      INSERT OR IGNORE INTO external_refs (id, nodus_id, from_idea, cited_work, type, basis, confidence, evidence_id)
      SELECT id, @targetId, from_idea, cited_work, type, basis, confidence, evidence_id
        FROM ${SOURCE_ALIAS}.external_refs
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'external_refs');

  db.prepare(
    /* sql */ `
      DELETE FROM edges
       WHERE from_id NOT IN (SELECT global_id FROM ideas)
          OR to_id NOT IN (SELECT global_id FROM ideas)
    `
  ).run();
  db.prepare('DELETE FROM edge_traces WHERE edge_id NOT IN (SELECT id FROM edges)').run();
}

function copyAuthors(db: Database.Database, sourceId: string, targetId: string, tableRows: Record<string, number>): void {
  db.prepare(
    /* sql */ `
      INSERT OR IGNORE INTO authors (author_id, name, affiliation, canonical_key)
      SELECT author_id, name, affiliation, canonical_key
        FROM ${SOURCE_ALIAS}.authors
       WHERE author_id IN (
         SELECT author_id FROM ${SOURCE_ALIAS}.work_authors WHERE nodus_id = @sourceId
       )
    `
  ).run({ sourceId });
  tableChange(db, tableRows, 'authors');

  db.prepare(
    /* sql */ `
      INSERT OR REPLACE INTO work_authors (nodus_id, author_id, role)
      SELECT @targetId, author_id, role
        FROM ${SOURCE_ALIAS}.work_authors
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'work_authors');

  db.prepare(
    /* sql */ `
      INSERT OR IGNORE INTO author_relations (from_author, to_author, type, weight)
      SELECT from_author, to_author, type, weight
        FROM ${SOURCE_ALIAS}.author_relations
       WHERE from_author IN (SELECT author_id FROM ${SOURCE_ALIAS}.work_authors WHERE nodus_id = @sourceId)
         AND to_author IN (SELECT author_id FROM ${SOURCE_ALIAS}.work_authors WHERE nodus_id = @sourceId)
    `
  ).run({ sourceId });
  tableChange(db, tableRows, 'author_relations');

  db.prepare(
    /* sql */ `
      INSERT OR REPLACE INTO author_dossier_synthesis (
        author_id, thesis, remember_json, positioning, model_json, fingerprint, generated_at
      )
      SELECT author_id, thesis, remember_json, positioning, model_json, fingerprint, generated_at
        FROM ${SOURCE_ALIAS}.author_dossier_synthesis
       WHERE author_id IN (SELECT author_id FROM ${SOURCE_ALIAS}.work_authors WHERE nodus_id = @sourceId)
    `
  ).run({ sourceId });
  tableChange(db, tableRows, 'author_dossier_synthesis');
}

function copySummary(db: Database.Database, sourceId: string, targetId: string, tableRows: Record<string, number>): void {
  db.prepare(
    /* sql */ `
      INSERT OR REPLACE INTO work_summaries (
        nodus_id, summary, source_level, model_json, content_hash, embedding,
        embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at, updated_at
      )
      SELECT @targetId, summary, source_level, model_json, content_hash, embedding,
             embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at, updated_at
        FROM ${SOURCE_ALIAS}.work_summaries
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'work_summaries');
}

function copyPassages(db: Database.Database, sourceId: string, targetId: string, tableRows: Record<string, number>): void {
  db.prepare('DELETE FROM passages WHERE nodus_id = ?').run(targetId);
  tableChange(db, tableRows, 'passages');
  db.prepare(
    /* sql */ `
      INSERT OR REPLACE INTO passages (
        passage_id, nodus_id, chunk_index, text, page_label, char_len, content_hash,
        embedding, embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at
      )
      SELECT @targetId || '#' || chunk_index, @targetId, chunk_index, text, page_label, char_len, content_hash,
             embedding, embedding_provider, embedding_model, embedding_dim, embedding_text_hash, created_at
        FROM ${SOURCE_ALIAS}.passages
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'passages');
}

function copySynthesis(db: Database.Database, sourceId: string, targetId: string, tableRows: Record<string, number>): void {
  db.prepare(
    /* sql */ `
      INSERT OR REPLACE INTO work_idea_synthesis (
        nodus_id, thesis, remember_json, positioning, model_json, fingerprint, generated_at
      )
      SELECT @targetId, thesis, remember_json, positioning, model_json, fingerprint, generated_at
        FROM ${SOURCE_ALIAS}.work_idea_synthesis
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'work_idea_synthesis');
}

function copyScanCheckpoints(db: Database.Database, sourceId: string, targetId: string, tableRows: Record<string, number>): void {
  db.prepare(
    /* sql */ `
      INSERT OR REPLACE INTO scan_checkpoints (nodus_id, content_hash, kind, batch_index, data_json, created_at)
      SELECT @targetId, content_hash, kind, batch_index, data_json, created_at
        FROM ${SOURCE_ALIAS}.scan_checkpoints
       WHERE nodus_id = @sourceId
    `
  ).run({ sourceId, targetId });
  tableChange(db, tableRows, 'scan_checkpoints');
}

function updateWorkStatus(
  db: Database.Database,
  source: WorkRow,
  targetId: string,
  kinds: VaultAnalysisReuseKind[]
): void {
  const lightImported = kinds.includes('themes');
  const deepImported = kinds.includes('ideas');
  const summaryImported = kinds.includes('summary');
  db.prepare(
    /* sql */ `
      UPDATE works
         SET light_status = CASE WHEN @lightImported THEN @lightStatus ELSE light_status END,
             light_at     = CASE WHEN @lightImported THEN @lightAt     ELSE light_at     END,
             light_hash   = CASE WHEN @lightImported THEN @lightHash   ELSE light_hash   END,
             deep_status  = CASE WHEN @deepImported THEN @deepStatus ELSE deep_status END,
             deep_at      = CASE WHEN @deepImported THEN @deepAt     ELSE deep_at     END,
             deep_hash    = CASE WHEN @deepImported THEN @deepHash   ELSE deep_hash   END,
             summary_status = CASE WHEN @summaryImported THEN @summaryStatus ELSE summary_status END,
             summary_at     = CASE WHEN @summaryImported THEN @summaryAt     ELSE summary_at     END,
             summary_hash   = CASE WHEN @summaryImported THEN @summaryHash   ELSE summary_hash   END,
             source_type    = COALESCE(source_type, @sourceType),
             creators_json  = COALESCE(creators_json, @creatorsJson)
       WHERE nodus_id = @targetId
    `
  ).run({
    targetId,
    lightImported: lightImported ? 1 : 0,
    lightStatus: source.light_status,
    lightAt: source.light_at,
    lightHash: source.light_hash,
    deepImported: deepImported ? 1 : 0,
    deepStatus: source.deep_status,
    deepAt: source.deep_at,
    deepHash: source.deep_hash,
    summaryImported: summaryImported ? 1 : 0,
    summaryStatus: source.summary_status,
    summaryAt: source.summary_at,
    summaryHash: source.summary_hash,
    sourceType: source.source_type,
    creatorsJson: source.creators_json ?? null,
  });
}

function importMatch(targetDb: Database.Database, target: WorkRow, match: SourceMatch): VaultAnalysisReuseWorkResult {
  const imported = reusableKinds(match.work, match.counts);
  const tableRows: Record<string, number> = {};
  if (imported.length === 0) {
    return {
      nodusId: target.nodus_id,
      matchedVaultId: match.vaultId,
      matchedVaultName: match.vaultName,
      matchedSourceNodusId: match.work.nodus_id,
      imported,
      importedRows: 0,
      tableRows,
    };
  }

  if (imported.includes('ideas')) purgeDeepData(target.nodus_id);

  targetDb.prepare(`ATTACH DATABASE ? AS ${SOURCE_ALIAS}`).run(match.path);
  try {
    targetDb.pragma('foreign_keys = OFF');
    const tx = targetDb.transaction(() => {
      if (imported.includes('themes')) copyThemes(targetDb, match.work.nodus_id, target.nodus_id, tableRows);
      if (imported.includes('ideas')) copyDeepAnalysis(targetDb, match.work.nodus_id, target.nodus_id, tableRows);
      if (imported.includes('authors')) copyAuthors(targetDb, match.work.nodus_id, target.nodus_id, tableRows);
      if (imported.includes('summary')) copySummary(targetDb, match.work.nodus_id, target.nodus_id, tableRows);
      if (imported.includes('passages')) copyPassages(targetDb, match.work.nodus_id, target.nodus_id, tableRows);
      if (imported.includes('synthesis')) copySynthesis(targetDb, match.work.nodus_id, target.nodus_id, tableRows);
      copyScanCheckpoints(targetDb, match.work.nodus_id, target.nodus_id, tableRows);
      updateWorkStatus(targetDb, match.work, target.nodus_id, imported);
    });
    tx();
  } finally {
    targetDb.pragma('foreign_keys = ON');
    try {
      targetDb.prepare(`DETACH DATABASE ${SOURCE_ALIAS}`).run();
    } catch {
      /* ignore failed detach after an interrupted attach */
    }
  }

  const importedRows = Object.values(tableRows).reduce((sum, count) => sum + count, 0);
  return {
    nodusId: target.nodus_id,
    matchedVaultId: match.vaultId,
    matchedVaultName: match.vaultName,
    matchedSourceNodusId: match.work.nodus_id,
    imported,
    importedRows,
    tableRows,
  };
}

export function reuseVaultAnalysisForWorks(nodusIds: string[]): VaultAnalysisReuseResult {
  const ids = [...new Set(nodusIds.map((id) => id.trim()).filter(Boolean))];
  const targetDb = getDb();
  const works: VaultAnalysisReuseWorkResult[] = [];
  if (ids.length === 0) return { requested: 0, matched: 0, imported: 0, works };

  const rows = targetDb
    .prepare(`SELECT * FROM works WHERE nodus_id IN (${placeholders(ids)})`)
    .all(...ids) as WorkRow[];
  const targetsById = new Map(rows.map((row) => [row.nodus_id, row]));

  for (const id of ids) {
    const target = targetsById.get(id);
    if (!target) {
      works.push({
        nodusId: id,
        matchedVaultId: null,
        matchedVaultName: null,
        matchedSourceNodusId: null,
        imported: [],
        importedRows: 0,
        tableRows: {},
      });
      continue;
    }
    const match = findBestMatch(target);
    if (!match) {
      works.push({
        nodusId: id,
        matchedVaultId: null,
        matchedVaultName: null,
        matchedSourceNodusId: null,
        imported: [],
        importedRows: 0,
        tableRows: {},
      });
      continue;
    }
    works.push(importMatch(targetDb, target, match));
  }

  return {
    requested: ids.length,
    matched: works.filter((work) => work.matchedVaultId !== null).length,
    imported: works.filter((work) => work.imported.length > 0).length,
    works,
  };
}
