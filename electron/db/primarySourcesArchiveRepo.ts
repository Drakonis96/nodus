import { createHash, randomUUID } from 'node:crypto';
import type {
  PrimarySourceArchiveRow,
  PrimarySourceArchiveEditInput,
  PrimarySourceArchiveWorkspace,
  PrimarySourceBulkPatch,
  PrimarySourceBulkPreview,
  PrimarySourceDescriptionTemplate,
  PrimarySourceDossier,
  PrimarySourceIngestInput,
  PrimarySourceItemProfile,
  PrimarySourceUnitCreateInput,
} from '@shared/primarySourcesTypes';
import type { ArchiveDescriptionUnit } from '@shared/archiveTypes';
import {
  addTag,
  getItem,
  listArchiveItemsMetadataByIds,
  listFolders,
  removeTag,
  setItemFolders,
} from './archiveRepo';
import {
  createArchiveUnit,
  listArchiveRepositories,
  listArchiveUnits,
  listArchiveUnitsByIds,
  listCaptureSessions,
} from './archiveHierarchyRepo';
import { getDb } from './database';
import { findOrCreateGazetteerPlace, listPlaces } from './entitiesRepo';
import {
  getPrimarySourceProfile,
  listPrimarySourceProfiles,
  primaryUnitForItem,
  updatePrimarySourceProfile,
  updateCanonicalDescription,
} from './primarySourcesRepo';
import { getArchiveUnit } from './archiveHierarchyRepo';
import { listArchiveFiles, listArchivePreviewFilesByItemIds } from './archiveFilesRepo';
import { listIntegrityChecks } from './archiveIntegrityRepo';
import { listArchiveAudit } from './archiveAuditRepo';
import {
  listArchiveTextSegmentsForItem,
  listArchiveTextVersions,
} from './archiveTextsRepo';
import {
  getPrimarySourceAnalysis,
  listArchiveExcerpts,
  listPrimarySourceEvidenceForItem,
} from './archiveEvidenceRepo';
import {
  listEntityProposals,
  listEntityResolutions,
  listProposalCandidates,
  listProposalDecisions,
} from './archiveProposalsRepo';

const PENDING_PROVENANCE_ID = 'primary_sources_pending_provenance';
const now = () => new Date().toISOString();

function resolveProvenancePlace(
  candidate: NonNullable<PrimarySourceIngestInput['place']>
): string {
  if (
    !candidate.gazetteerId?.trim()
    || !candidate.name?.trim()
    || !Number.isFinite(candidate.latitude)
    || !Number.isFinite(candidate.longitude)
    || candidate.latitude < -90
    || candidate.latitude > 90
    || candidate.longitude < -180
    || candidate.longitude > 180
  ) {
    throw new Error('El lugar seleccionado no es válido.');
  }
  return findOrCreateGazetteerPlace(candidate).placeId;
}

function parseObject<T extends object>(value: string | null, fallback: T): T {
  try {
    const parsed = value ? JSON.parse(value) : fallback;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

type TemplateRow = {
  template_id: string;
  name: string;
  document_type: string | null;
  default_level: ArchiveDescriptionUnit['level'];
  unit_defaults_json: string | null;
  profile_defaults_json: string | null;
  builtin: number;
  created_at: string;
  updated_at: string;
};

function templateFromRow(row: TemplateRow): PrimarySourceDescriptionTemplate {
  return {
    templateId: row.template_id,
    name: row.name,
    documentType: row.document_type,
    defaultLevel: row.default_level,
    unitDefaults: parseObject(row.unit_defaults_json, {}),
    profileDefaults: parseObject(row.profile_defaults_json, {}),
    builtin: Boolean(row.builtin),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listDescriptionTemplates(): PrimarySourceDescriptionTemplate[] {
  return (getDb().prepare(
    'SELECT * FROM archive_description_templates ORDER BY builtin DESC, name COLLATE NOCASE'
  ).all() as TemplateRow[]).map(templateFromRow);
}

export function createDescriptionTemplate(input: {
  name: string;
  documentType?: string | null;
  defaultLevel?: ArchiveDescriptionUnit['level'];
  unitDefaults?: Partial<ArchiveDescriptionUnit>;
  profileDefaults?: Partial<PrimarySourceItemProfile>;
}): PrimarySourceDescriptionTemplate {
  const templateId = `adt_${randomUUID()}`;
  const ts = now();
  getDb().prepare(
    `INSERT INTO archive_description_templates (
      template_id, name, document_type, default_level, unit_defaults_json,
      profile_defaults_json, builtin, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    templateId,
    input.name.trim() || 'Plantilla sin título',
    input.documentType ?? null,
    input.defaultLevel ?? 'item',
    JSON.stringify(input.unitDefaults ?? {}),
    JSON.stringify(input.profileDefaults ?? {}),
    ts,
    ts
  );
  return templateFromRow(
    getDb().prepare('SELECT * FROM archive_description_templates WHERE template_id=?').get(templateId) as TemplateRow
  );
}

function ensurePendingProvenanceUnit(): string {
  const ts = now();
  getDb().prepare(
    `INSERT OR IGNORE INTO archive_description_units (
      unit_id, repository_id, parent_unit_id, level, reference_code, title,
      title_type, date_certainty, language_codes_json, script_codes_json,
      position, metadata_json, created_at, updated_at
    ) VALUES (?, NULL, NULL, 'collection', NULL, 'Procedencia por completar',
      'supplied', 'unknown', '[]', '[]', -100000, '{"system":"pending_provenance"}', ?, ?)`
  ).run(PENDING_PROVENANCE_ID, ts, ts);
  return PENDING_PROVENANCE_ID;
}

function nextPosition(parentUnitId: string | null): number {
  const row = parentUnitId
    ? getDb().prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM archive_description_units WHERE parent_unit_id=?'
    ).get(parentUnitId)
    : getDb().prepare(
      'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM archive_description_units WHERE parent_unit_id IS NULL'
    ).get();
  return Number((row as { position: number }).position);
}

/**
 * Promote a compatible archive_items row into the canonical Primary Sources layer.
 * It is deliberately idempotent: duplicate detection can return an old Genealogy item
 * and this function safely adds only the missing archival representations.
 */
export function ensurePrimarySourceProjection(
  itemId: string,
  input: Omit<PrimarySourceIngestInput, 'paths'> = {}
): PrimarySourceArchiveRow {
  const db = getDb();
  const legacy = db.prepare(
    `SELECT item_id, title, file_name, mime_type, bytes, blob, extracted_text,
      description, content_hash, metadata_json, created_at, updated_at
     FROM archive_items WHERE item_id=?`
  ).get(itemId) as {
    item_id: string;
    title: string;
    file_name: string | null;
    mime_type: string | null;
    bytes: number;
    blob: Buffer | null;
    extracted_text: string | null;
    description: string | null;
    content_hash: string | null;
    metadata_json: string | null;
    created_at: string;
    updated_at: string;
  } | undefined;
  if (!legacy) throw new Error('Fuente no encontrada.');

  const template = input.templateId
    ? listDescriptionTemplates().find((candidate) => candidate.templateId === input.templateId) ?? null
    : null;

  db.transaction(() => {
    let unit = primaryUnitForItem(itemId);
    if (!unit) {
      const requestedParent = input.parentUnitId ?? null;
      const parent = requestedParent ? getArchiveUnit(requestedParent) : null;
      if (requestedParent && !parent) throw new Error('La unidad archivística seleccionada ya no existe.');
      const parentUnitId = requestedParent
        ?? (input.repositoryId ? null : ensurePendingProvenanceUnit());
      const repositoryId = input.repositoryId ?? parent?.repositoryId ?? null;
      const unitId = `primary_unit_${itemId}`;
      const ts = now();
      const defaults = template?.unitDefaults ?? {};
      const title = input.title?.trim() || legacy.title;
      db.prepare(
        `INSERT INTO archive_description_units (
          unit_id, repository_id, parent_unit_id, level, local_level_label,
          reference_code, title, title_type, date_display, date_start_sort,
          date_end_sort, date_certainty, creator_display, extent_display,
          scope_content, arrangement, administrative_biographical_history,
          custodial_history, acquisition_info, access_conditions,
          reproduction_conditions, language_codes_json, script_codes_json,
          physical_characteristics, finding_aids, related_units,
          source_catalog_url, position, metadata_json, created_at, updated_at
        ) VALUES (${Array.from({ length: 31 }, () => '?').join(',')})`
      ).run(
        unitId,
        repositoryId,
        parentUnitId,
        template?.defaultLevel ?? 'item',
        defaults.localLevelLabel ?? null,
        input.referenceCode ?? defaults.referenceCode ?? null,
        title,
        defaults.titleType ?? 'supplied',
        input.dateDisplay ?? defaults.date?.display ?? null,
        input.dateStartSort ?? defaults.date?.startSort ?? null,
        input.dateEndSort ?? defaults.date?.endSort ?? null,
        input.dateCertainty ?? defaults.date?.certainty ?? 'unknown',
        input.creatorDisplay ?? defaults.creatorDisplay ?? null,
        defaults.extentDisplay ?? null,
        input.description?.trim() || legacy.description || defaults.scopeContent || null,
        defaults.arrangement ?? null,
        defaults.administrativeBiographicalHistory ?? null,
        defaults.custodialHistory ?? null,
        defaults.acquisitionInfo ?? null,
        defaults.accessConditions ?? null,
        defaults.reproductionConditions ?? null,
        JSON.stringify(defaults.languageCodes ?? []),
        JSON.stringify(defaults.scriptCodes ?? []),
        defaults.physicalCharacteristics ?? null,
        defaults.findingAids ?? null,
        defaults.relatedUnits ?? null,
        defaults.sourceCatalogUrl ?? null,
        nextPosition(parentUnitId),
        JSON.stringify(defaults.metadata ?? parseObject(legacy.metadata_json, {})),
        ts,
        ts
      );
      db.prepare(
        `INSERT INTO archive_item_units (item_id, unit_id, relation_kind, position, created_at)
         VALUES (?, ?, 'describes', 0, ?)`
      ).run(itemId, unitId, ts);
      unit = getArchiveUnit(unitId);
    }

    if (!getPrimarySourceProfile(itemId)) {
      const ts = now();
      const defaults = template?.profileDefaults ?? {};
      const provenancePlaceId = input.place
        ? resolveProvenancePlace(input.place)
        : defaults.provenancePlaceId ?? null;
      const profileMetadata = {
        ...(defaults.metadata ?? {}),
        ...(input.documentIcon?.trim() ? { documentIcon: input.documentIcon.trim() } : {}),
      };
      db.prepare(
        `INSERT INTO archive_item_profiles (
          item_id, date_certainty, access_status, embargo_until, rights_statement,
          reproduction_conditions, sensitivity, processing_status, description_status,
          analysis_status, citation_status, capture_session_id, provenance_place_id,
          metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        itemId,
        input.dateCertainty ?? defaults.dateCertainty ?? 'unknown',
        input.accessStatus ?? defaults.accessStatus ?? 'unknown',
        defaults.embargoUntil ?? null,
        defaults.rightsStatement ?? null,
        defaults.reproductionConditions ?? null,
        input.sensitivity ?? defaults.sensitivity ?? 'normal',
        legacy.blob ? 'imported' : 'needs_description',
        defaults.descriptionStatus ?? 'minimal',
        defaults.analysisStatus ?? 'not_started',
        defaults.citationStatus ?? 'not_ready',
        input.captureSessionId ?? null,
        provenancePlaceId,
        JSON.stringify(profileMetadata),
        ts,
        ts
      );
    } else {
      const currentProfile = getPrimarySourceProfile(itemId)!;
      updatePrimarySourceProfile(itemId, {
        ...(input.captureSessionId !== undefined ? { captureSessionId: input.captureSessionId } : {}),
        ...(input.accessStatus ? { accessStatus: input.accessStatus } : {}),
        ...(input.sensitivity ? { sensitivity: input.sensitivity } : {}),
        ...(input.place ? { provenancePlaceId: resolveProvenancePlace(input.place) } : {}),
        ...(input.documentIcon?.trim()
          ? { metadata: { ...currentProfile.metadata, documentIcon: input.documentIcon.trim() } }
          : {}),
      });
    }

    const fileExists = db.prepare(
      'SELECT 1 FROM archive_item_files WHERE item_id=? LIMIT 1'
    ).get(itemId);
    if (!fileExists && legacy.blob) {
      const hash = createHash('sha256').update(legacy.blob).digest('hex');
      const ts = now();
      db.prepare(
        `INSERT INTO archive_item_files (
          file_id, item_id, parent_file_id, role, version_no, sequence_no,
          original_file_name, mime_type, byte_size, content_blob, content_hash,
          hash_algorithm, created_by, created_at, verified_at, verification_status
        ) VALUES (?, ?, NULL, 'master', 1, 0, ?, ?, ?, ?, ?, 'sha256',
          'primary_sources_ingest', ?, ?, 'verified')`
      ).run(
        `primary_master_${itemId}`,
        itemId,
        legacy.file_name,
        legacy.mime_type,
        legacy.blob.byteLength,
        legacy.blob,
        hash,
        ts,
        ts
      );
      db.prepare(
        'UPDATE archive_items SET content_hash=COALESCE(content_hash, ?) WHERE item_id=?'
      ).run(hash, itemId);
    }

    const textExists = db.prepare(
      'SELECT 1 FROM archive_text_versions WHERE item_id=? LIMIT 1'
    ).get(itemId);
    if (!textExists && legacy.extracted_text?.trim()) {
      const ts = now();
      db.prepare(
        `INSERT INTO archive_text_versions (
          text_version_id, item_id, file_id, parent_version_id, kind, content,
          status, engine, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, 'ocr', ?, 'automatic', 'primary_sources_ingest',
          'primary_sources_ingest', ?, ?)`
      ).run(
        `primary_text_${itemId}`,
        itemId,
        legacy.blob ? `primary_master_${itemId}` : null,
        legacy.extracted_text,
        ts,
        ts
      );
    }

    if (input.collectionIds) setItemFolders(itemId, input.collectionIds);
    for (const tag of input.tags ?? []) addTag(itemId, tag);
  })();

  const row = getPrimarySourceArchiveRow(itemId);
  if (!row) throw new Error('No se pudo completar la proyección de la fuente.');
  return row;
}

function revisionFor(itemUpdatedAt: string, unitUpdatedAt: string, profileUpdatedAt: string): string {
  return createHash('sha256')
    .update(`${itemUpdatedAt}\u0000${unitUpdatedAt}\u0000${profileUpdatedAt}`)
    .digest('hex');
}

export function getPrimarySourceArchiveRow(itemId: string): PrimarySourceArchiveRow | null {
  const item = getItem(itemId);
  const unit = primaryUnitForItem(itemId);
  const profile = getPrimarySourceProfile(itemId);
  if (!item || !unit || !profile) return null;
  const repositoryName = unit.repositoryId
    ? (getDb().prepare('SELECT name FROM archive_repositories WHERE repository_id=?').get(unit.repositoryId) as { name: string } | undefined)?.name ?? null
    : null;
  const counts = getDb().prepare(
    `SELECT
      SUM(CASE WHEN role='master' THEN 1 ELSE 0 END) AS masters,
      SUM(CASE WHEN role<>'master' THEN 1 ELSE 0 END) AS derivatives
     FROM archive_item_files WHERE item_id=?`
  ).get(itemId) as { masters: number | null; derivatives: number | null };
  const textVersionCount = Number(
    (getDb().prepare('SELECT COUNT(*) AS count FROM archive_text_versions WHERE item_id=?').get(itemId) as { count: number }).count
  );
  const previewFile = listArchivePreviewFilesByItemIds([itemId])[0] ?? null;
  return {
    item,
    unit,
    profile,
    repositoryName,
    previewFile,
    masterCount: Number(counts.masters ?? 0),
    derivativeCount: Number(counts.derivatives ?? 0),
    textVersionCount,
    revision: revisionFor(item.updatedAt, unit.updatedAt, profile.updatedAt),
  };
}

function queryPrimarySourceArchiveRows(
  search = '',
  requestedOffset = 0,
  requestedLimit = 200,
): { rows: PrimarySourceArchiveRow[]; total: number; unitIds: string[] } {
  const db = getDb();
  const needle = search.trim();
  const offset = Math.max(0, Math.trunc(requestedOffset));
  const limit = Math.max(1, Math.min(Math.trunc(requestedLimit), 500));
  // Deliberately metadata-only: full OCR/transcription lives in the cross-corpus
  // search screen and is never loaded by an archive listing.
  const filter = `(
    @search='' OR i.title LIKE '%' || @search || '%' COLLATE NOCASE
    OR u.title LIKE '%' || @search || '%' COLLATE NOCASE
    OR COALESCE(u.reference_code, '') LIKE '%' || @search || '%' COLLATE NOCASE
    OR COALESCE(u.creator_display, '') LIKE '%' || @search || '%' COLLATE NOCASE
    OR COALESCE(u.scope_content, '') LIKE '%' || @search || '%' COLLATE NOCASE
  )`;
  const total = Number((db.prepare(
    `SELECT COUNT(DISTINCT i.item_id) AS count
       FROM archive_items i
       JOIN archive_item_units iu
         ON iu.item_id=i.item_id AND iu.relation_kind='describes'
       JOIN archive_description_units u ON u.unit_id=iu.unit_id
      WHERE ${filter}`
  ).get({ search: needle }) as { count: number }).count);
  const page = db.prepare(
    `SELECT i.item_id, MIN(u.unit_id) AS unit_id
       FROM archive_items i
       JOIN archive_item_units iu
         ON iu.item_id=i.item_id AND iu.relation_kind='describes'
       JOIN archive_description_units u ON u.unit_id=iu.unit_id
      WHERE ${filter}
      GROUP BY i.item_id
      ORDER BY i.updated_at DESC, i.item_id
      LIMIT @limit OFFSET @offset`
  ).all({ search: needle, limit, offset }) as Array<{ item_id: string; unit_id: string }>;
  const itemIds = page.map((row) => row.item_id);
  if (itemIds.length === 0) return { rows: [], total, unitIds: [] };
  const unitIds = page.map((row) => row.unit_id);
  const items = new Map(listArchiveItemsMetadataByIds(itemIds).map((item) => [item.itemId, item]));
  const units = new Map(listArchiveUnitsByIds(unitIds).map((unit) => [unit.unitId, unit]));
  const profiles = new Map(listPrimarySourceProfiles(itemIds).map((profile) => [profile.itemId, profile]));
  const repositories = new Map(listArchiveRepositories().map((repository) => [
    repository.repositoryId,
    repository.name,
  ]));
  const placeholders = itemIds.map(() => '?').join(',');
  const fileCounts = new Map((db.prepare(
    `SELECT item_id,
      SUM(CASE WHEN role='master' THEN 1 ELSE 0 END) AS masters,
      SUM(CASE WHEN role<>'master' THEN 1 ELSE 0 END) AS derivatives
     FROM archive_item_files WHERE item_id IN (${placeholders}) GROUP BY item_id`
  ).all(...itemIds) as Array<{ item_id: string; masters: number; derivatives: number }>)
    .map((row) => [row.item_id, row]));
  const textCounts = new Map((db.prepare(
    `SELECT item_id, COUNT(*) AS count FROM archive_text_versions
     WHERE item_id IN (${placeholders}) GROUP BY item_id`
  ).all(...itemIds) as Array<{ item_id: string; count: number }>)
    .map((row) => [row.item_id, Number(row.count)]));
  const previewFiles = new Map(
    listArchivePreviewFilesByItemIds(itemIds).map((file) => [file.itemId, file])
  );

  const rows = page.flatMap(({ item_id: itemId, unit_id: unitId }) => {
    const item = items.get(itemId);
    const unit = units.get(unitId);
    const profile = profiles.get(itemId);
    if (!item || !unit || !profile) return [];
    const counts = fileCounts.get(itemId);
    return [{
      item,
      unit,
      profile,
      repositoryName: unit.repositoryId
        ? repositories.get(unit.repositoryId) ?? null
        : null,
      previewFile: previewFiles.get(itemId) ?? null,
      masterCount: Number(counts?.masters ?? 0),
      derivativeCount: Number(counts?.derivatives ?? 0),
      textVersionCount: textCounts.get(itemId) ?? 0,
      revision: revisionFor(item.updatedAt, unit.updatedAt, profile.updatedAt),
    } satisfies PrimarySourceArchiveRow];
  });
  return { rows, total, unitIds };
}

export function listPrimarySourceArchiveRows(
  search = '',
  offset = 0,
  limit = 200,
): PrimarySourceArchiveRow[] {
  return queryPrimarySourceArchiveRows(search, offset, limit).rows;
}

function hierarchyUnitsForPage(unitIds: string[]): {
  units: ArchiveDescriptionUnit[];
  truncated: boolean;
} {
  const db = getDb();
  const total = Number((db.prepare(
    'SELECT COUNT(*) AS count FROM archive_description_units'
  ).get() as { count: number }).count);
  if (total <= 2_000) return { units: listArchiveUnits(), truncated: false };
  if (unitIds.length === 0) {
    const rootIds = (db.prepare(
      `SELECT unit_id FROM archive_description_units
       WHERE parent_unit_id IS NULL ORDER BY position, title COLLATE NOCASE LIMIT 500`
    ).all() as Array<{ unit_id: string }>).map((row) => row.unit_id);
    return { units: listArchiveUnitsByIds(rootIds), truncated: true };
  }
  const placeholders = unitIds.map(() => '?').join(',');
  const ancestorIds = (db.prepare(
    `WITH RECURSIVE ancestors(unit_id, parent_unit_id) AS (
       SELECT unit_id, parent_unit_id FROM archive_description_units
        WHERE unit_id IN (${placeholders})
       UNION
       SELECT parent.unit_id, parent.parent_unit_id
         FROM archive_description_units parent
         JOIN ancestors child ON child.parent_unit_id=parent.unit_id
     )
     SELECT DISTINCT unit_id FROM ancestors LIMIT 2000`
  ).all(...unitIds) as Array<{ unit_id: string }>).map((row) => row.unit_id);
  return { units: listArchiveUnitsByIds(ancestorIds), truncated: true };
}

export function getPrimarySourceArchiveWorkspace(
  search = '',
  requestedOffset = 0,
  requestedLimit = 200,
): PrimarySourceArchiveWorkspace {
  const offset = Math.max(0, Math.trunc(requestedOffset));
  const limit = Math.max(1, Math.min(Math.trunc(requestedLimit), 500));
  const page = queryPrimarySourceArchiveRows(search, offset, limit);
  const hierarchy = hierarchyUnitsForPage(page.unitIds);
  return {
    rows: page.rows,
    repositories: listArchiveRepositories(),
    units: hierarchy.units,
    sessions: listCaptureSessions(),
    collections: listFolders(),
    places: listPlaces(),
    templates: listDescriptionTemplates(),
    page: {
      offset,
      limit,
      total: page.total,
      hasMore: offset + page.rows.length < page.total,
      unitsTruncated: hierarchy.truncated,
    },
  };
}

export function getPrimarySourceDossier(itemId: string): PrimarySourceDossier | null {
  const row = getPrimarySourceArchiveRow(itemId);
  if (!row) return null;
  const files = listArchiveFiles(itemId);
  const integrityChecks = files.flatMap((file) => listIntegrityChecks({ fileId: file.fileId }));
  const latestStatus = new Map<string, (typeof files)[number]['verificationStatus']>();
  for (const file of files) latestStatus.set(file.fileId, file.verificationStatus);
  const count = (status: (typeof files)[number]['verificationStatus']) =>
    [...latestStatus.values()].filter((candidate) => candidate === status).length;
  const persistedHistory = listArchiveAudit(itemId);
  const syntheticCreationHistory = files
    .filter((file) => !persistedHistory.some((event) =>
      event.fileId === file.fileId && event.action === 'file_created'
    ))
    .map((file): PrimarySourceDossier['history'][number] => ({
      eventId: `historic_${file.fileId}`,
      itemId,
      fileId: file.fileId,
      action: 'file_created',
      details: {
        role: file.role,
        versionNo: file.versionNo,
        sequenceNo: file.sequenceNo,
        originalFileName: file.originalFileName,
        mimeType: file.mimeType,
        byteSize: file.byteSize,
        contentHash: file.contentHash,
        migratedHistory: true,
      },
      createdBy: file.createdBy,
      createdAt: file.createdAt,
    }));
  return {
    row,
    files,
    textVersions: listArchiveTextVersions(itemId),
    textSegments: listArchiveTextSegmentsForItem(itemId),
    excerpts: listArchiveExcerpts(itemId),
    analysis: getPrimarySourceAnalysis(itemId),
    proposals: listEntityProposals({ itemId }),
    proposalDecisions: listProposalDecisions({ itemId }),
    proposalCandidates: listProposalCandidates(itemId),
    evidence: listPrimarySourceEvidenceForItem(itemId),
    resolutions: listEntityResolutions(itemId),
    integrityChecks,
    history: [...persistedHistory, ...syntheticCreationHistory]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.eventId.localeCompare(a.eventId)),
    integrity: {
      verified: count('verified'),
      pending: count('pending'),
      missing: count('missing'),
      mismatch: count('mismatch'),
      error: count('error'),
      orphanDerivatives: files.filter((file) =>
        file.role !== 'master'
        && file.role !== 'supplement'
        && (!file.parentFileId || !files.some((parent) => parent.fileId === file.parentFileId))
      ).length,
      unhashed: files.filter((file) => file.hasContent && !file.contentHash).length,
    },
  };
}

export function updatePrimarySourceArchiveRecord(
  itemId: string,
  input: PrimarySourceArchiveEditInput
): PrimarySourceArchiveRow {
  const db = getDb();
  return db.transaction(() => {
    const current = getPrimarySourceArchiveRow(itemId);
    if (!current) throw new Error('La fuente ya no existe.');
    if (current.revision !== input.expectedRevision) {
      throw new Error('La fuente cambió mientras la editabas. Recarga antes de guardar.');
    }
    if (input.unit) updateCanonicalDescription(itemId, input.unit);
    if (input.profile) updatePrimarySourceProfile(itemId, input.profile);
    const updated = getPrimarySourceArchiveRow(itemId);
    if (!updated) throw new Error('No se pudo volver a leer la fuente.');
    return updated;
  })();
}

export function createDescriptionOnlyUnit(input: PrimarySourceUnitCreateInput): ArchiveDescriptionUnit {
  const parent = input.parentUnitId ? getArchiveUnit(input.parentUnitId) : null;
  if (input.parentUnitId && !parent) throw new Error('La unidad padre no existe.');
  return createArchiveUnit({
    title: input.title,
    level: input.level,
    localLevelLabel: input.localLevelLabel ?? null,
    repositoryId: input.repositoryId ?? parent?.repositoryId ?? null,
    parentUnitId: input.parentUnitId ?? null,
    referenceCode: input.referenceCode ?? null,
    creatorDisplay: input.creatorDisplay ?? null,
    date: {
      display: input.dateDisplay ?? null,
      startSort: input.dateStartSort ?? null,
      endSort: input.dateEndSort ?? null,
      certainty: input.dateCertainty ?? 'unknown',
    },
    scopeContent: input.scopeContent ?? null,
    position: input.position ?? nextPosition(input.parentUnitId ?? null),
  });
}

export function previewPrimarySourceBulkEdit(itemIds: string[]): PrimarySourceBulkPreview {
  const unique = [...new Set(itemIds)];
  const rows = unique.map(getPrimarySourceArchiveRow);
  const missing = unique.filter((_itemId, index) => !rows[index]);
  const existing = rows.filter((row): row is PrimarySourceArchiveRow => Boolean(row));
  return {
    itemIds: unique,
    affected: existing.length,
    missing,
    revisions: Object.fromEntries(existing.map((row) => [row.item.itemId, row.revision])),
    warnings: missing.length ? ['Algunas fuentes ya no existen y no se modificarán.'] : [],
  };
}

export function applyPrimarySourceBulkEdit(input: {
  itemIds: string[];
  patch: PrimarySourceBulkPatch;
  expectedRevisions: Record<string, string>;
}): PrimarySourceArchiveRow[] {
  const db = getDb();
  const unique = [...new Set(input.itemIds)];
  return db.transaction(() => {
    for (const itemId of unique) {
      const current = getPrimarySourceArchiveRow(itemId);
      if (!current) throw new Error('Una fuente seleccionada ya no existe.');
      if (input.expectedRevisions[itemId] !== current.revision) {
        throw new Error(`La fuente «${current.item.title}» cambió desde la vista previa. Recarga antes de aplicar el lote.`);
      }
      updatePrimarySourceProfile(itemId, {
        ...(input.patch.accessStatus ? { accessStatus: input.patch.accessStatus } : {}),
        ...(input.patch.sensitivity ? { sensitivity: input.patch.sensitivity } : {}),
        ...(input.patch.processingStatus ? { processingStatus: input.patch.processingStatus } : {}),
        ...(input.patch.descriptionStatus ? { descriptionStatus: input.patch.descriptionStatus } : {}),
        ...(input.patch.captureSessionId !== undefined ? { captureSessionId: input.patch.captureSessionId } : {}),
      });
      if (input.patch.collectionIds) setItemFolders(itemId, input.patch.collectionIds);
      for (const tag of input.patch.addTags ?? []) addTag(itemId, tag);
      for (const tag of input.patch.removeTags ?? []) removeTag(itemId, tag);
    }
    return unique.map((itemId) => getPrimarySourceArchiveRow(itemId)!);
  })();
}
