import type { ArchiveDescriptionUnit } from '@shared/archiveTypes';
import type { PrimarySourceItemProfile } from '@shared/primarySourcesTypes';
import { getDb } from './database';
import { getArchiveUnit, updateArchiveUnit } from './archiveHierarchyRepo';

const now = () => new Date().toISOString();
const parseObject = (value: string | null): Record<string, unknown> => {
  try {
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export function primaryUnitForItem(itemId: string): ArchiveDescriptionUnit | null {
  const row = getDb().prepare(
    `SELECT unit_id FROM archive_item_units
     WHERE item_id=? AND relation_kind='describes' LIMIT 1`
  ).get(itemId) as { unit_id: string } | undefined;
  return row ? getArchiveUnit(row.unit_id) : null;
}

type ProfileRow = {
  item_id: string; date_certainty: PrimarySourceItemProfile['dateCertainty'];
  provenance_place_id: string | null;
  access_status: PrimarySourceItemProfile['accessStatus']; embargo_until: string | null;
  rights_statement: string | null; reproduction_conditions: string | null;
  sensitivity: PrimarySourceItemProfile['sensitivity'];
  processing_status: PrimarySourceItemProfile['processingStatus'];
  description_status: PrimarySourceItemProfile['descriptionStatus'];
  analysis_status: PrimarySourceItemProfile['analysisStatus'];
  citation_status: PrimarySourceItemProfile['citationStatus']; capture_session_id: string | null;
  metadata_json: string | null; created_at: string; updated_at: string;
};
const profileFromRow = (row: ProfileRow): PrimarySourceItemProfile => ({
  itemId: row.item_id, provenancePlaceId: row.provenance_place_id,
  dateCertainty: row.date_certainty, accessStatus: row.access_status,
  embargoUntil: row.embargo_until, rightsStatement: row.rights_statement,
  reproductionConditions: row.reproduction_conditions, sensitivity: row.sensitivity,
  processingStatus: row.processing_status, descriptionStatus: row.description_status,
  analysisStatus: row.analysis_status, citationStatus: row.citation_status,
  captureSessionId: row.capture_session_id, metadata: parseObject(row.metadata_json),
  createdAt: row.created_at, updatedAt: row.updated_at,
});

export function getPrimarySourceProfile(itemId: string): PrimarySourceItemProfile | null {
  const row = getDb().prepare('SELECT * FROM archive_item_profiles WHERE item_id=?').get(itemId) as ProfileRow | undefined;
  return row ? profileFromRow(row) : null;
}

export function listPrimarySourceProfiles(itemIds: string[]): PrimarySourceItemProfile[] {
  const ids = [...new Set(itemIds)].slice(0, 500);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb().prepare(
    `SELECT * FROM archive_item_profiles WHERE item_id IN (${placeholders})`
  ).all(...ids) as ProfileRow[];
  const byId = new Map(rows.map((row) => [row.item_id, profileFromRow(row)]));
  return ids.map((itemId) => byId.get(itemId))
    .filter((profile): profile is PrimarySourceItemProfile => Boolean(profile));
}

export function updatePrimarySourceProfile(
  itemId: string,
  patch: Partial<Omit<PrimarySourceItemProfile, 'itemId' | 'createdAt' | 'updatedAt'>>
): PrimarySourceItemProfile | null {
  const current = getPrimarySourceProfile(itemId);
  if (!current) return null;
  const next = { ...current, ...patch, metadata: patch.metadata ?? current.metadata };
  getDb().prepare(
    `UPDATE archive_item_profiles SET date_certainty=?, access_status=?, embargo_until=?,
      rights_statement=?, reproduction_conditions=?, sensitivity=?, processing_status=?,
      description_status=?, analysis_status=?, citation_status=?, capture_session_id=?,
      provenance_place_id=?, metadata_json=?, updated_at=? WHERE item_id=?`
  ).run(
    next.dateCertainty, next.accessStatus, next.embargoUntil, next.rightsStatement,
    next.reproductionConditions, next.sensitivity, next.processingStatus,
    next.descriptionStatus, next.analysisStatus, next.citationStatus,
    next.captureSessionId, next.provenancePlaceId, JSON.stringify(next.metadata), now(), itemId
  );
  return getPrimarySourceProfile(itemId);
}

/**
 * The only writer for canonical archival description and the legacy projection.
 * A transaction prevents Archive legacy and primary-source screens from diverging.
 */
export function updateCanonicalDescription(
  itemId: string,
  patch: Partial<ArchiveDescriptionUnit>
): ArchiveDescriptionUnit | null {
  const db = getDb();
  const unit = primaryUnitForItem(itemId);
  if (!unit) return null;
  const tx = db.transaction(() => {
    const updated = updateArchiveUnit(unit.unitId, patch);
    if (!updated) return null;
    db.prepare(
      `UPDATE archive_items SET title=?, description=?, source=?, metadata_json=?, updated_at=?
       WHERE item_id=?`
    ).run(
      updated.title, updated.scopeContent,
      updated.repositoryId || updated.referenceCode
        ? [updated.repositoryId, updated.referenceCode].filter(Boolean).join(' · ')
        : null,
      JSON.stringify(updated.metadata), now(), itemId
    );
    return updated;
  });
  return tx();
}

/** Explicit source deletion covers polymorphic links before FK cascades remove rows. */
export function deletePrimarySource(itemId: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    const units = db.prepare('SELECT unit_id FROM archive_item_units WHERE item_id=?').all(itemId) as Array<{ unit_id: string }>;
    const files = db.prepare('SELECT file_id FROM archive_item_files WHERE item_id=?').all(itemId) as Array<{ file_id: string }>;
    const texts = db.prepare('SELECT text_version_id FROM archive_text_versions WHERE item_id=?').all(itemId) as Array<{ text_version_id: string }>;
    const excerpts = db.prepare('SELECT excerpt_id FROM archive_excerpts WHERE item_id=?').all(itemId) as Array<{ excerpt_id: string }>;
    const deleteLinks = db.prepare('DELETE FROM note_links WHERE target_kind=? AND target_id=?');
    deleteLinks.run('archive_item', itemId);
    for (const row of units) deleteLinks.run('archive_unit', row.unit_id);
    for (const row of files) deleteLinks.run('archive_file', row.file_id);
    for (const row of texts) deleteLinks.run('archive_text_version', row.text_version_id);
    for (const row of excerpts) {
      deleteLinks.run('archive_excerpt', row.excerpt_id);
      db.prepare('DELETE FROM record_evidence WHERE excerpt_id=?').run(row.excerpt_id);
    }
    db.prepare("DELETE FROM record_evidence WHERE source_kind='archive' AND nodus_id=?").run(itemId);
    db.prepare("DELETE FROM record_evidence WHERE target_kind='archive_item' AND target_id=?").run(itemId);
    // Excerpt anchors are immutable while the source exists. An explicit whole-source
    // deletion is different: remove the anchors before their files so ON DELETE SET
    // NULL never looks like an ordinary anchor edit to the preservation trigger.
    db.prepare('DELETE FROM archive_excerpts WHERE item_id=?').run(itemId);
    db.prepare('DELETE FROM archive_text_versions WHERE item_id=?').run(itemId);
    // parent_file_id is deliberately RESTRICT: a master can never disappear from
    // underneath an unexplained derivative. A whole-source deletion is the explicit
    // exception, so remove the representation tree from leaves to roots first.
    const deleteFileLeaves = db.prepare(
      `DELETE FROM archive_item_files
       WHERE item_id=?
         AND NOT EXISTS (
           SELECT 1 FROM archive_item_files child
           WHERE child.parent_file_id=archive_item_files.file_id
         )`
    );
    let filesRemaining = files.length;
    while (filesRemaining > 0) {
      const removed = deleteFileLeaves.run(itemId).changes;
      if (removed === 0) throw new Error('El árbol de archivos contiene un ciclo y no puede eliminarse.');
      filesRemaining -= removed;
    }
    db.prepare('DELETE FROM archive_items WHERE item_id=?').run(itemId);
    for (const row of units) {
      const stillUsed = db.prepare('SELECT 1 FROM archive_item_units WHERE unit_id=? LIMIT 1').get(row.unit_id);
      const child = db.prepare('SELECT 1 FROM archive_description_units WHERE parent_unit_id=? LIMIT 1').get(row.unit_id);
      if (!stillUsed && !child) db.prepare('DELETE FROM archive_description_units WHERE unit_id=?').run(row.unit_id);
    }
  });
  tx();
}

export function primarySourcesSchemaInventory(): string[] {
  return (getDb().prepare(
    `SELECT name FROM sqlite_master
     WHERE type='table' AND (
       name LIKE 'archive_%'
       OR name IN ('record_evidence', 'entity_resolutions', 'note_links', 'social_relations')
     ) ORDER BY name`
  ).all() as Array<{ name: string }>).map((row) => row.name);
}

/** Test helper used to verify full rollback of multi-table primary-source writes. */
export function runPrimarySourcesTransaction<T>(work: () => T): T {
  return getDb().transaction(work)();
}

export function createPrimarySourceLink(itemId: string, unitId: string): void {
  getDb().prepare(
    `INSERT INTO archive_item_units (item_id, unit_id, relation_kind, position, created_at)
     VALUES (?, ?, 'describes', 0, ?)`
  ).run(itemId, unitId, now());
}

export function seedPrimarySourceProfile(itemId: string): PrimarySourceItemProfile {
  const ts = now();
  getDb().prepare(
    `INSERT INTO archive_item_profiles (
      item_id, date_certainty, access_status, sensitivity, processing_status,
      description_status, analysis_status, citation_status, metadata_json, created_at, updated_at
    ) VALUES (?, 'unknown', 'unknown', 'normal', 'imported', 'minimal', 'not_started',
      'not_ready', '{}', ?, ?)`
  ).run(itemId, ts, ts);
  return getPrimarySourceProfile(itemId)!;
}
