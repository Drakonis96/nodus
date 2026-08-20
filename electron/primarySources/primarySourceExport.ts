import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  PrimarySourceExportPreview,
  PrimarySourceExportRequest,
  PrimarySourceInventoryFormat,
  PrimarySourcePackageValidation,
  PrimarySourceResearchManifest,
  PrimarySourceResearchManifestFile,
  PrimarySourceRestoreReport,
} from '@shared/primarySourcesTypes';
import {
  PRIMARY_SOURCE_EXPORT_PROFILES,
  decidePrimarySourcePolicy,
} from '@shared/primarySourcesTypes';
import { getActiveVault, createVaultFromDatabaseFile } from '../vaults/vaultRegistry';
import { getDb, SCHEMA_VERSION } from '../db/database';
import {
  PRIMARY_SOURCE_PORTABLE_TABLES,
  getPrimarySourcePolicySettings,
  insertPrimarySourceRestoreReport,
} from '../db/primarySourceGovernanceRepo';
import { getArchiveFileBlob } from '../db/archiveFilesRepo';
import { recordArchiveExport } from '../db/archiveIntegrityRepo';

type ExportPolicyRow = {
  item_id: string;
  access_status: 'open' | 'private' | 'restricted' | 'embargoed' | 'unknown';
  sensitivity: 'normal' | 'personal' | 'sensitive' | 'highly_sensitive';
  embargo_until: string | null;
  citation_status: string;
};

type ExportNotePolicyRow = {
  note_id: string;
  access_status: 'open' | 'private' | 'restricted' | 'embargoed' | 'unknown';
  sensitivity: 'normal' | 'personal' | 'sensitive' | 'highly_sensitive';
};

type InventoryRow = {
  unitId: string;
  itemIds: string;
  sourceCount: number;
  title: string;
  repository: string | null;
  hierarchy: string;
  referenceCode: string | null;
  level: string | null;
  documentType: string | null;
  creator: string | null;
  dateDisplay: string | null;
  dateStartSort: string | null;
  dateEndSort: string | null;
  accessStatus: string;
  sensitivity: string;
  descriptionStatus: string;
  analysisStatus: string;
  citationStatus: string;
  fileCount: number;
  textVersionCount: number;
  excerptCount: number;
};

type SourceMetadataRow = Omit<InventoryRow, 'unitId' | 'itemIds' | 'sourceCount'> & {
  itemId: string;
  unitId: string | null;
};

type PackageBuild = {
  buffer: Buffer;
  packageHash: string;
  manifest: PrimarySourceResearchManifest;
  exportId: string;
  preview: PrimarySourceExportPreview;
};

const safeIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`;
const hash = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');

function safeEntryName(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || !value
    || value.includes('\0')
    || value.includes('\\')
    || value.split('/').some((segment) => segment === '..' || segment === '.' || !segment)
  ) return false;
  const normalized = path.posix.normalize(value);
  return Boolean(normalized)
    && normalized !== '.'
    && normalized === value
    && !normalized.startsWith('../')
    && !path.posix.isAbsolute(normalized);
}

function requestedIds(request: PrimarySourceExportRequest): string[] {
  if (request.profile === 'evidence_dossier' && request.evidenceTarget) {
    const target = request.evidenceTarget;
    if (
      !['person', 'event', 'relationship'].includes(target.kind)
      || typeof target.id !== 'string'
      || !target.id.trim()
    ) throw new Error('El objetivo del dossier de evidencia no es válido.');
    return (getDb().prepare(
      `SELECT DISTINCT nodus_id AS item_id FROM record_evidence
        WHERE target_kind=? AND target_id=? AND nodus_id IS NOT NULL
        ORDER BY nodus_id`
    ).all(target.kind, target.id) as Array<{ item_id: string }>).map((row) => row.item_id);
  }
  const supplied = [...new Set(
    (Array.isArray(request.itemIds) ? request.itemIds : [])
      .filter((id) => typeof id === 'string' && id.trim())
  )];
  if (supplied.length) return supplied.slice(0, 10_000);
  return (getDb().prepare(
    `SELECT item_id FROM archive_item_profiles ORDER BY updated_at DESC`
  ).all() as { item_id: string }[]).map((row) => row.item_id);
}

function policyRows(ids: string[]): ExportPolicyRow[] {
  if (!ids.length) return [];
  return getDb().prepare(
    `SELECT item_id, access_status, sensitivity, embargo_until, citation_status
       FROM archive_item_profiles
      WHERE item_id IN (${ids.map(() => '?').join(',')})`
  ).all(...ids) as ExportPolicyRow[];
}

function filesRequested(request: PrimarySourceExportRequest): boolean {
  return Boolean(request.includeFiles && request.profile !== 'inventory');
}

export function previewPrimarySourceExport(
  request: PrimarySourceExportRequest,
): PrimarySourceExportPreview {
  if (!PRIMARY_SOURCE_EXPORT_PROFILES.includes(request.profile)) {
    throw new Error('El perfil de exportación no es válido.');
  }
  const itemIds = requestedIds(request);
  const policies = policyRows(itemIds);
  const authorized = new Set(
    (Array.isArray(request.authorizedItemIds) ? request.authorizedItemIds : [])
      .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
  );
  const settings = getPrimarySourcePolicySettings();
  const includedItemIds: string[] = [];
  const excludedByRestriction: string[] = [];
  const confirmationRequired: string[] = [];
  const metadataRedacted: string[] = [];
  const includedNoteIds: string[] = [];
  const excludedNoteIds: string[] = [];
  const confirmationNoteIds: string[] = [];
  const includeFiles = filesRequested(request);

  for (const row of policies) {
    // Institutional restrictions and embargoes exclude the entire source. A
    // renderer checkbox cannot turn either into a redistributable object.
    if (row.access_status === 'restricted' || row.access_status === 'embargoed') {
      excludedByRestriction.push(row.item_id);
      continue;
    }
    const metadata = decidePrimarySourcePolicy({
      accessStatus: row.access_status,
      sensitivity: row.sensitivity,
      embargoUntil: row.embargo_until,
      action: 'export_metadata',
    });
    if (metadata.decision === 'block') {
      excludedByRestriction.push(row.item_id);
      continue;
    }
    if (metadata.decision === 'redact') metadataRedacted.push(row.item_id);
    if (includeFiles) {
      const file = decidePrimarySourcePolicy({
        accessStatus: row.access_status,
        sensitivity: row.sensitivity,
        embargoUntil: row.embargo_until,
        action: 'export_file',
      });
      const privateAllowedByVault = row.access_status !== 'private' || settings.exportPrivateFiles;
      if (!privateAllowedByVault) {
        excludedByRestriction.push(row.item_id);
        continue;
      }
      if (file.decision === 'block') {
        excludedByRestriction.push(row.item_id);
        continue;
      }
      if (
        file.decision === 'confirm'
        && !authorized.has(row.item_id)
      ) {
        confirmationRequired.push(row.item_id);
        continue;
      }
    }
    includedItemIds.push(row.item_id);
  }

  if (request.includeNotes) {
    const requestedNotes = [...new Set(
      (Array.isArray(request.noteIds) ? request.noteIds : [])
        .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
    )].slice(0, 10_000);
    const authorizedNotes = new Set(
      (Array.isArray(request.authorizedNoteIds) ? request.authorizedNoteIds : [])
        .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
    );
    const noteRows = requestedNotes.length ? getDb().prepare(
      `SELECT note_id, access_status, sensitivity
         FROM primary_source_note_profiles
        WHERE note_id IN (${requestedNotes.map(() => '?').join(',')})`
    ).all(...requestedNotes) as ExportNotePolicyRow[] : [];
    const byNote = new Map(noteRows.map((row) => [row.note_id, row]));
    for (const noteId of requestedNotes) {
      const note = byNote.get(noteId);
      if (!note || note.access_status === 'restricted' || note.access_status === 'embargoed') {
        excludedNoteIds.push(noteId);
      } else if (
        (
          note.access_status === 'private'
          || note.access_status === 'unknown'
          || note.sensitivity === 'highly_sensitive'
        )
        && !authorizedNotes.has(noteId)
      ) {
        confirmationNoteIds.push(noteId);
      } else {
        includedNoteIds.push(noteId);
      }
    }
  }

  const selected = includedItemIds.length
    ? `WHERE item_id IN (${includedItemIds.map(() => '?').join(',')})`
    : 'WHERE 0';
  const fileRoles = request.includeDerivatives
    ? "('master','access','derivative','ocr','transcript','supplement','thumbnail')"
    : "('master','access','supplement')";
  const fileSummary = getDb().prepare(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(CASE WHEN content_blob IS NOT NULL THEN byte_size ELSE 0 END), 0) AS bytes,
            SUM(CASE WHEN content_blob IS NULL THEN 1 ELSE 0 END) AS missing
       FROM archive_item_files ${selected}
        AND superseded_at IS NULL AND role IN ${fileRoles}`
  ).get(...includedItemIds) as { count: number; bytes: number; missing: number | null };
  const incompleteReferences = policies.filter((row) =>
    includedItemIds.includes(row.item_id) && row.citation_status !== 'ready'
  ).length;
  const selectedNotes = includedItemIds.length ? Number((getDb().prepare(
    `SELECT COUNT(DISTINCT nl.nodus_id) AS value
       FROM note_links nl
       LEFT JOIN archive_excerpts ex ON ex.excerpt_id=nl.excerpt_id
      WHERE nl.target_id IN (${includedItemIds.map(() => '?').join(',')})
         OR ex.item_id IN (${includedItemIds.map(() => '?').join(',')})`
  ).get(...includedItemIds, ...includedItemIds) as { value: number }).value) : 0;
  return {
    request: { ...request, itemIds },
    includedItemIds,
    excludedByRestriction: [...new Set(excludedByRestriction)],
    confirmationRequired,
    metadataRedacted,
    includedNoteIds,
    excludedNoteIds,
    confirmationNoteIds,
    notesExcluded: request.includeNotes ? excludedNoteIds.length : selectedNotes,
    missingFiles: Number(fileSummary.missing ?? 0),
    incompleteReferences,
    includedFiles: includeFiles ? Number(fileSummary.count) : 0,
    estimatedBytes: includeFiles ? Number(fileSummary.bytes) : 0,
    canExport: includedItemIds.length > 0
      && confirmationRequired.length === 0
      && confirmationNoteIds.length === 0,
    blockers: [
      ...(includedItemIds.length === 0 ? ['La selección no contiene fuentes exportables.'] : []),
      ...(confirmationRequired.length ? ['Falta confirmar material privado o con derechos desconocidos.'] : []),
      ...(confirmationNoteIds.length ? ['Falta confirmar notas privadas o altamente sensibles.'] : []),
    ],
  };
}

function hierarchyFor(unitId: string | null, units: Map<string, { parent: string | null; title: string }>): string {
  if (!unitId) return '';
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | null = unitId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const unit = units.get(current);
    if (!unit) break;
    chain.unshift(unit.title);
    current = unit.parent;
  }
  return chain.join(' / ');
}

function sourceMetadataRows(itemIds: string[], redactedIds: Set<string>): SourceMetadataRow[] {
  if (!itemIds.length) return [];
  const unitsRaw = getDb().prepare(
    'SELECT unit_id, parent_unit_id, title FROM archive_description_units'
  ).all() as Array<{ unit_id: string; parent_unit_id: string | null; title: string }>;
  const units = new Map(unitsRaw.map((row) => [row.unit_id, { parent: row.parent_unit_id, title: row.title }]));
  const rows = getDb().prepare(
    `SELECT ai.item_id, ai.title, ai.doc_type, u.unit_id, u.title AS unit_title,
            u.reference_code, u.level, u.creator_display, u.date_display,
            u.date_start_sort, u.date_end_sort, r.name AS repository_name,
            p.access_status, p.sensitivity, p.description_status,
            p.analysis_status, p.citation_status,
            (SELECT COUNT(*) FROM archive_item_files f WHERE f.item_id=ai.item_id AND f.superseded_at IS NULL) AS file_count,
            (SELECT COUNT(*) FROM archive_text_versions tv WHERE tv.item_id=ai.item_id) AS text_count,
            (SELECT COUNT(*) FROM archive_excerpts ex WHERE ex.item_id=ai.item_id) AS excerpt_count
       FROM archive_items ai
       JOIN archive_item_profiles p ON p.item_id=ai.item_id
       LEFT JOIN archive_description_units u ON u.unit_id=(
         SELECT iu.unit_id FROM archive_item_units iu
          WHERE iu.item_id=ai.item_id AND iu.relation_kind='describes'
          ORDER BY iu.position LIMIT 1
       )
       LEFT JOIN archive_repositories r ON r.repository_id=u.repository_id
      WHERE ai.item_id IN (${itemIds.map(() => '?').join(',')})
      ORDER BY r.name, u.reference_code, ai.title`
  ).all(...itemIds) as Array<{
    item_id: string;
    title: string;
    doc_type: string | null;
    unit_id: string | null;
    unit_title: string | null;
    reference_code: string | null;
    level: string | null;
    creator_display: string | null;
    date_display: string | null;
    date_start_sort: string | null;
    date_end_sort: string | null;
    repository_name: string | null;
    access_status: string;
    sensitivity: string;
    description_status: string;
    analysis_status: string;
    citation_status: string;
    file_count: number;
    text_count: number;
    excerpt_count: number;
  }>;
  const policy = getPrimarySourcePolicySettings();
  return rows.map((row) => {
    const redacted = redactedIds.has(row.item_id);
    const redactPersonal = policy.redactPersonalMetadata && row.sensitivity !== 'normal';
    return {
      itemId: row.item_id,
      unitId: row.unit_id,
      title: redacted ? '[Metadatos redactados]' : row.title,
      repository: redacted ? null : row.repository_name,
      hierarchy: redacted ? '' : hierarchyFor(row.unit_id, units),
      referenceCode: redacted ? null : row.reference_code,
      level: row.level,
      documentType: row.doc_type,
      creator: redacted || redactPersonal ? null : row.creator_display,
      dateDisplay: redacted ? null : row.date_display,
      dateStartSort: redacted ? null : row.date_start_sort,
      dateEndSort: redacted ? null : row.date_end_sort,
      accessStatus: row.access_status,
      sensitivity: redacted ? 'redacted' : row.sensitivity,
      descriptionStatus: row.description_status,
      analysisStatus: row.analysis_status,
      citationStatus: row.citation_status,
      fileCount: row.file_count,
      textVersionCount: redacted ? 0 : row.text_count,
      excerptCount: redacted ? 0 : row.excerpt_count,
    };
  });
}

/**
 * Archivists inventory descriptive units, not individual binary objects. Sources
 * attached to the same unit therefore collapse into one row while still exposing
 * their aggregate preservation and review state.
 */
function inventoryRows(itemIds: string[], redactedIds: Set<string>): InventoryRow[] {
  const sources = sourceMetadataRows(itemIds, redactedIds);
  const grouped = new Map<string, InventoryRow>();
  for (const source of sources) {
    const key = source.unitId ?? `unlinked:${source.itemId}`;
    const current = grouped.get(key);
    if (!current) {
      const { itemId, unitId, ...metadata } = source;
      grouped.set(key, {
        unitId: unitId ?? '',
        itemIds: itemId,
        sourceCount: 1,
        ...metadata,
      });
      continue;
    }
    current.itemIds = `${current.itemIds};${source.itemId}`;
    current.sourceCount += 1;
    current.fileCount += source.fileCount;
    current.textVersionCount += source.textVersionCount;
    current.excerptCount += source.excerptCount;
    current.documentType = uniqueInventoryValues(current.documentType, source.documentType);
    current.accessStatus = uniqueInventoryValues(current.accessStatus, source.accessStatus) ?? '';
    current.sensitivity = uniqueInventoryValues(current.sensitivity, source.sensitivity) ?? '';
    current.descriptionStatus = uniqueInventoryValues(current.descriptionStatus, source.descriptionStatus) ?? '';
    current.analysisStatus = uniqueInventoryValues(current.analysisStatus, source.analysisStatus) ?? '';
    current.citationStatus = uniqueInventoryValues(current.citationStatus, source.citationStatus) ?? '';
    if (redactedIds.has(source.itemId)) {
      current.title = '[Metadatos redactados]';
      current.repository = null;
      current.hierarchy = '';
      current.referenceCode = null;
      current.creator = null;
      current.dateDisplay = null;
      current.dateStartSort = null;
      current.dateEndSort = null;
    }
  }
  return [...grouped.values()];
}

function uniqueInventoryValues(left: string | null, right: string | null): string | null {
  const values = new Set(
    [left, right]
      .flatMap((value) => value?.split(';') ?? [])
      .map((value) => value.trim())
      .filter(Boolean)
  );
  return values.size ? [...values].sort((a, b) => a.localeCompare(b)).join(';') : null;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const INVENTORY_COLUMNS: Array<keyof InventoryRow> = [
  'unitId', 'itemIds', 'sourceCount', 'title', 'repository', 'hierarchy', 'referenceCode', 'level',
  'documentType', 'creator', 'dateDisplay', 'dateStartSort', 'dateEndSort',
  'accessStatus', 'sensitivity', 'descriptionStatus', 'analysisStatus',
  'citationStatus', 'fileCount', 'textVersionCount', 'excerptCount',
];

function inventoryCsv(rows: InventoryRow[]): Buffer {
  const lines = [
    INVENTORY_COLUMNS.join(','),
    ...rows.map((row) => INVENTORY_COLUMNS.map((column) => csvCell(row[column])).join(',')),
  ];
  return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
}

function xml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Small standards-compliant XLSX writer: one sheet, inline strings and numeric counts. */
function inventoryXlsx(rows: InventoryRow[]): Buffer {
  const matrix: unknown[][] = [
    INVENTORY_COLUMNS,
    ...rows.map((row) => INVENTORY_COLUMNS.map((column) => row[column])),
  ];
  const letters = (index: number): string => {
    let result = '';
    let current = index + 1;
    while (current) {
      current -= 1;
      result = String.fromCharCode(65 + current % 26) + result;
      current = Math.floor(current / 26);
    }
    return result;
  };
  const sheet = matrix.map((row, rowIndex) =>
    `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => {
      const ref = `${letters(columnIndex)}${rowIndex + 1}`;
      return typeof value === 'number'
        ? `<c r="${ref}"><v>${value}</v></c>`
        : `<c r="${ref}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
    }).join('')}</row>`
  ).join('');
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    </Types>`));
  zip.addFile('_rels/.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>`));
  zip.addFile('xl/workbook.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets><sheet name="Inventario" sheetId="1" r:id="rId1"/></sheets>
    </workbook>`));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
    </Relationships>`));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`));
  return zip.toBuffer();
}

function inventoryBytes(format: PrimarySourceInventoryFormat, rows: InventoryRow[]): Buffer {
  if (format === 'xlsx') return inventoryXlsx(rows);
  if (format === 'json') return Buffer.from(JSON.stringify(rows, null, 2), 'utf8');
  return inventoryCsv(rows);
}

function filteredItemClause(itemIds: string[]): string {
  return itemIds.length
    ? `(${itemIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(',')})`
    : '(NULL)';
}

function clearTable(db: Database.Database, table: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) return;
  // FTS5 owns its shadow tables (`*_data`, `*_idx`, ...). Clearing the virtual
  // table already updates them; SQLite deliberately rejects direct writes to those
  // internals, which can appear in snapshots created by newer database features.
  const metadata = db.prepare('SELECT type FROM pragma_table_list WHERE name = ?').get(table) as { type: string } | undefined;
  if (metadata?.type === 'shadow') return;
  db.prepare(`DELETE FROM ${safeIdentifier(table)}`).run();
}

function filterSnapshot(
  databasePath: string,
  preview: PrimarySourceExportPreview,
  request: PrimarySourceExportRequest,
): Record<string, number> {
  const db = new Database(databasePath);
  const itemSet = filteredItemClause(preview.includedItemIds);
  const portable = new Set<string>(PRIMARY_SOURCE_PORTABLE_TABLES);
  const policySettings = getPrimarySourcePolicySettings();
  try {
    db.pragma('foreign_keys = OFF');
    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as { name: string }[]).map((row) => row.name);
    for (const table of tables) {
      if (!portable.has(table)) clearTable(db, table);
    }

    // Every table with direct source ownership is filtered first.
    const directItemTables = [
      'archive_item_folders', 'archive_item_persons', 'archive_item_tags',
      'archive_item_units', 'archive_item_profiles', 'archive_item_files',
      'archive_text_versions', 'archive_excerpts', 'archive_entity_proposals',
      'archive_proposal_decisions', 'archive_source_analyses', 'archive_place_mentions',
      'archive_person_mentions', 'archive_integrity_checks', 'archive_audit_log',
      'record_evidence',
    ];
    for (const table of directItemTables) {
      const columns = new Set((db.prepare(`PRAGMA table_info(${safeIdentifier(table)})`).all() as { name: string }[]).map((row) => row.name));
      if (columns.has('item_id')) db.prepare(`DELETE FROM ${safeIdentifier(table)} WHERE item_id NOT IN ${itemSet}`).run();
      else if (table === 'archive_integrity_checks') {
        db.prepare(`DELETE FROM archive_integrity_checks WHERE file_id NOT IN (SELECT file_id FROM archive_item_files)`).run();
      } else if (table === 'record_evidence') {
        db.prepare(`DELETE FROM record_evidence WHERE nodus_id NOT IN ${itemSet} OR nodus_id IS NULL`).run();
      } else if (table === 'archive_proposal_decisions') {
        db.prepare('DELETE FROM archive_proposal_decisions WHERE proposal_id NOT IN (SELECT proposal_id FROM archive_entity_proposals)').run();
      }
    }
    db.prepare(`DELETE FROM archive_items WHERE item_id NOT IN ${itemSet}`).run();

    const redactedIds = preview.metadataRedacted.filter((id) => preview.includedItemIds.includes(id));
    if (redactedIds.length) {
      const redactedSet = filteredItemClause(redactedIds);
      // Redaction must apply to the portable SQLite too, not just the friendly
      // CSV/JSON views. Otherwise a restored package would silently recover the
      // very metadata the policy preview said was removed.
      db.prepare(`DELETE FROM archive_item_units WHERE item_id IN ${redactedSet}`).run();
      db.prepare(
        `UPDATE archive_items
            SET title='[Metadatos redactados]', file_name=NULL,
                extracted_text=NULL, description=NULL
          WHERE item_id IN ${redactedSet}`
      ).run();
      db.prepare(
        `UPDATE archive_item_profiles
            SET rights_statement=NULL, reproduction_conditions=NULL,
                metadata_json='{}'
          WHERE item_id IN ${redactedSet}`
      ).run();
      db.prepare(
        `UPDATE archive_item_files
            SET original_file_name=NULL, capture_metadata_json=NULL
          WHERE item_id IN ${redactedSet}`
      ).run();
    }

    if (!request.includeTextVersions) {
      // Filtering runs with foreign keys disabled so excluded rows cannot cascade
      // into otherwise permitted evidence. Reproduce every SET NULL edge
      // explicitly before removing the text layer, then verify the result below.
      db.prepare('UPDATE archive_entity_proposals SET excerpt_id=NULL').run();
      db.prepare('UPDATE archive_place_mentions SET excerpt_id=NULL').run();
      db.prepare('UPDATE archive_person_mentions SET excerpt_id=NULL').run();
      db.prepare('UPDATE note_links SET excerpt_id=NULL').run();
      db.prepare('UPDATE record_evidence SET excerpt_id=NULL, source_version_id=NULL').run();
      clearTable(db, 'archive_text_segments');
      clearTable(db, 'archive_excerpts');
      clearTable(db, 'archive_text_versions');
    } else {
      db.prepare('DELETE FROM archive_text_segments WHERE text_version_id NOT IN (SELECT text_version_id FROM archive_text_versions)').run();
    }

    const roles = request.includeDerivatives
      ? ['master', 'access', 'derivative', 'ocr', 'transcript', 'supplement', 'thumbnail']
      : ['master', 'access', 'supplement'];
    db.prepare(
      `DELETE FROM archive_item_files WHERE role NOT IN (${roles.map(() => '?').join(',')})`
    ).run(...roles);
    // Package objects are separate entries. The portable DB stores their identity,
    // expected hash and transformation but never duplicate bytes or local paths.
    db.prepare(
      `UPDATE archive_item_files
          SET content_blob=NULL, external_path=NULL,
              verification_status=CASE WHEN content_hash IS NULL THEN 'missing' ELSE 'pending' END,
              verified_at=NULL`
    ).run();
    db.prepare('UPDATE archive_items SET blob=NULL, bytes=0, extracted_text=NULL').run();

    // Retain the directly described units plus every ancestor needed to understand
    // their hierarchy, then only their repositories.
    db.prepare(
      `DELETE FROM archive_description_units
        WHERE unit_id NOT IN (
          WITH RECURSIVE kept(unit_id, parent_unit_id) AS (
            SELECT u.unit_id, u.parent_unit_id
              FROM archive_description_units u
             WHERE u.unit_id IN (SELECT unit_id FROM archive_item_units)
            UNION
            SELECT parent.unit_id, parent.parent_unit_id
              FROM archive_description_units parent JOIN kept ON kept.parent_unit_id=parent.unit_id
          ) SELECT unit_id FROM kept
        )`
    ).run();
    db.prepare(
      `DELETE FROM archive_capture_sessions
        WHERE session_id NOT IN (
          SELECT capture_session_id FROM archive_item_profiles WHERE capture_session_id IS NOT NULL
        )`
    ).run();
    db.prepare(
      `DELETE FROM archive_repositories
        WHERE repository_id NOT IN (
          SELECT repository_id FROM archive_description_units WHERE repository_id IS NOT NULL
          UNION SELECT repository_id FROM archive_capture_sessions WHERE repository_id IS NOT NULL
        )`
    ).run();
    if (policySettings.redactPhysicalLocations) {
      db.prepare('UPDATE archive_repositories SET address=NULL, contact_notes=NULL').run();
      db.prepare('UPDATE archive_item_files SET external_path=NULL, capture_metadata_json=NULL').run();
    }
    clearTable(db, 'archive_description_templates');

    // Collections are thematic working context. Keep only attached folders and
    // their ancestors; this cannot expose unrelated collection names.
    db.prepare(
      `DELETE FROM archive_folders
        WHERE folder_id NOT IN (
          WITH RECURSIVE kept(folder_id, parent_id) AS (
            SELECT f.folder_id, f.parent_id FROM archive_folders f
             WHERE f.folder_id IN (
               SELECT folder_id FROM archive_item_folders
               UNION SELECT folder_id FROM archive_items WHERE folder_id IS NOT NULL
             )
            UNION
            SELECT parent.folder_id, parent.parent_id
              FROM archive_folders parent JOIN kept ON kept.parent_id=parent.folder_id
          ) SELECT folder_id FROM kept
        )`
    ).run();

    // Entities survive only when one of the retained sources names or evidences them.
    if (policySettings.redactPersonalMetadata) {
      const sensitiveRows = db.prepare(
        `SELECT item_id FROM archive_item_profiles WHERE sensitivity<>'normal'`
      ).all() as Array<{ item_id: string }>;
      if (sensitiveRows.length) {
        const sensitiveSet = filteredItemClause(sensitiveRows.map((row) => row.item_id));
        db.prepare(`DELETE FROM archive_person_mentions WHERE item_id IN ${sensitiveSet}`).run();
        db.prepare(`DELETE FROM archive_item_persons WHERE item_id IN ${sensitiveSet}`).run();
        db.prepare(`DELETE FROM archive_entity_proposals WHERE item_id IN ${sensitiveSet}`).run();
        db.prepare('DELETE FROM archive_proposal_decisions WHERE proposal_id NOT IN (SELECT proposal_id FROM archive_entity_proposals)').run();
        db.prepare(`DELETE FROM archive_source_analyses WHERE item_id IN ${sensitiveSet}`).run();
        db.prepare(
          `DELETE FROM record_evidence
            WHERE nodus_id IN ${sensitiveSet}
              AND target_kind IN ('person','event_participant','relationship','identity_resolution')`
        ).run();
        db.prepare(
          `UPDATE archive_description_units SET creator_display=NULL
            WHERE unit_id IN (
              SELECT iu.unit_id FROM archive_item_units iu
              JOIN archive_item_profiles p ON p.item_id=iu.item_id
              WHERE p.sensitivity<>'normal'
            )
            AND unit_id NOT IN (
              SELECT iu.unit_id FROM archive_item_units iu
              JOIN archive_item_profiles p ON p.item_id=iu.item_id
              WHERE p.sensitivity='normal'
            )`
        ).run();
      }
      db.prepare('UPDATE archive_capture_sessions SET researcher=NULL, device=NULL, notes=NULL').run();
    }
    db.prepare(
      `DELETE FROM persons WHERE person_id NOT IN (
        SELECT person_id FROM archive_person_mentions WHERE person_id IS NOT NULL
        UNION SELECT person_id FROM archive_item_persons
        UNION SELECT target_id FROM record_evidence WHERE target_kind='person'
      )`
    ).run();
    db.prepare('DELETE FROM person_names WHERE person_id NOT IN (SELECT person_id FROM persons)').run();
    db.prepare('DELETE FROM person_places WHERE person_id NOT IN (SELECT person_id FROM persons)').run();
    db.prepare(
      `DELETE FROM places WHERE place_id NOT IN (
        SELECT provenance_place_id FROM archive_item_profiles WHERE provenance_place_id IS NOT NULL
        UNION SELECT place_id FROM archive_place_mentions WHERE place_id IS NOT NULL
        UNION SELECT target_id FROM record_evidence WHERE target_kind='place'
      )`
    ).run();
    db.prepare(
      `DELETE FROM events WHERE event_id NOT IN (
        SELECT target_id FROM record_evidence WHERE target_kind='event'
      )`
    ).run();
    db.prepare('DELETE FROM event_participants WHERE event_id NOT IN (SELECT event_id FROM events) OR person_id NOT IN (SELECT person_id FROM persons)').run();
    db.prepare('DELETE FROM relationships WHERE from_person NOT IN (SELECT person_id FROM persons) OR to_person NOT IN (SELECT person_id FROM persons)').run();
    db.prepare(
      `DELETE FROM entity_resolutions
        WHERE (entity_kind='person' AND source_entity_id NOT IN (SELECT person_id FROM persons))
           OR (entity_kind='place' AND source_entity_id NOT IN (SELECT place_id FROM places))`
    ).run();
    db.prepare('DELETE FROM archive_place_resolution_decisions WHERE place_id NOT IN (SELECT place_id FROM places)').run();
    clearTable(db, 'social_contacts');
    clearTable(db, 'social_relations');

    if (!request.includeNotes) {
      clearTable(db, 'primary_source_note_link_snapshots');
      clearTable(db, 'note_links');
      clearTable(db, 'primary_source_note_profiles');
      clearTable(db, 'notes');
      clearTable(db, 'note_folders');
    } else {
      const noteSet = filteredItemClause(preview.includedNoteIds);
      db.prepare(`DELETE FROM notes WHERE id NOT IN ${noteSet}`).run();
      db.prepare('DELETE FROM note_links WHERE nodus_id NOT IN (SELECT id FROM notes)').run();
      db.prepare(
        `DELETE FROM note_links
          WHERE (target_kind='source' AND target_id NOT IN (SELECT item_id FROM archive_items))
             OR (target_kind='excerpt' AND target_id NOT IN (SELECT excerpt_id FROM archive_excerpts))
             OR (target_kind='text_version' AND target_id NOT IN (SELECT text_version_id FROM archive_text_versions))
             OR (target_kind='unit' AND target_id NOT IN (SELECT unit_id FROM archive_description_units))
             OR (target_kind='note' AND target_id NOT IN (SELECT id FROM notes))
             OR (target_kind='person' AND target_id NOT IN (SELECT person_id FROM persons))
             OR (target_kind='place' AND target_id NOT IN (SELECT place_id FROM places))
             OR (target_kind='event' AND target_id NOT IN (SELECT event_id FROM events))
             OR (target_kind='relation' AND target_id NOT IN (SELECT rel_id FROM relationships))
             OR target_kind='saved_search'
             OR target_kind NOT IN (
               'source','unit','text_version','excerpt','person','event','place','relation','note'
             )`
      ).run();
      db.prepare('DELETE FROM primary_source_note_profiles WHERE note_id NOT IN (SELECT id FROM notes)').run();
      db.prepare('DELETE FROM primary_source_note_link_snapshots WHERE link_id NOT IN (SELECT link_id FROM note_links)').run();
      db.prepare(
        `DELETE FROM note_folders
          WHERE id NOT IN (
            WITH RECURSIVE kept(id, parent_id) AS (
              SELECT nf.id, nf.parent_id FROM note_folders nf
               WHERE nf.id IN (SELECT folder_id FROM notes WHERE folder_id IS NOT NULL)
              UNION
              SELECT parent.id, parent.parent_id
                FROM note_folders parent JOIN kept ON kept.parent_id=parent.id
            ) SELECT id FROM kept
          )`
      ).run();
    }

    // Deletes above fire the live sync tombstone triggers copied into the
    // snapshot. Operational tables are intentionally non-portable, so clear
    // them again after filtering to prevent excluded IDs from reappearing in
    // deletion metadata.
    for (const table of tables) {
      if (!portable.has(table)) clearTable(db, table);
    }

    // A restored research vault gets local defaults. No token, API key, listener,
    // filesystem path or backup destination can hitchhike in the package.
    db.prepare("DELETE FROM settings WHERE key<>'app'").run();
    db.prepare("UPDATE settings SET value='{}' WHERE key='app'").run();
    db.pragma('user_version = ' + SCHEMA_VERSION);
    db.pragma('foreign_keys = ON');
    // Deleted SQLite records can remain recoverable on freelist pages. VACUUM is
    // therefore a privacy boundary, not merely a size optimization.
    db.exec('VACUUM');
    const foreign = db.pragma('foreign_key_check') as unknown[];
    const quick = db.pragma('quick_check', { simple: true });
    if (foreign.length || quick !== 'ok') {
      throw new Error(`La instantánea filtrada no superó las comprobaciones SQLite: ${quick}.`);
    }
    return Object.fromEntries(
      (db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all() as { name: string }[]).map(({ name }) => [
        name,
        Number((db.prepare(`SELECT COUNT(*) AS value FROM ${safeIdentifier(name)}`).get() as { value: number }).value),
      ])
    );
  } finally {
    db.close();
  }
}

function sourceMetadata(itemIds: string[], redacted: Set<string>): unknown[] {
  const rows = sourceMetadataRows(itemIds, redacted);
  return rows.map((row) => ({
    ...row,
    redacted: redacted.has(row.itemId),
    deepLink: `nodus://primary-source/${encodeURIComponent(row.itemId)}`,
  }));
}

function evidenceData(
  itemIds: string[],
  target?: PrimarySourceExportRequest['evidenceTarget'],
): Record<string, unknown> {
  if (!itemIds.length) return {};
  const placeholders = itemIds.map(() => '?').join(',');
  const select = (sql: string, ...params: unknown[]) => getDb().prepare(sql).all(...params);
  const redactPersonal = getPrimarySourcePolicySettings().redactPersonalMetadata;
  const sensitive = redactPersonal ? new Set(
    (getDb().prepare(
      `SELECT item_id FROM archive_item_profiles
        WHERE item_id IN (${placeholders}) AND sensitivity<>'normal'`
    ).all(...itemIds) as Array<{ item_id: string }>).map((row) => row.item_id)
  ) : new Set<string>();
  return {
    excerpts: select(`SELECT * FROM archive_excerpts WHERE item_id IN (${placeholders})`, ...itemIds),
    evidence: select(
      `SELECT * FROM record_evidence WHERE nodus_id IN (${placeholders})
        ${target ? 'AND target_kind=? AND target_id=?' : ''}`,
      ...itemIds,
      ...(target ? [target.kind, target.id] : []),
    )
      .filter((row: any) => !sensitive.has(row.nodus_id) || ![
        'person', 'event_participant', 'relationship', 'identity_resolution',
      ].includes(row.target_kind)),
    proposals: select(`SELECT * FROM archive_entity_proposals WHERE item_id IN (${placeholders})`, ...itemIds)
      .filter((row: any) => !sensitive.has(row.item_id))
      .map((row: any) => {
        let payload: unknown = {};
        try {
          payload = JSON.parse(row.payload_json || '{}');
        } catch {
          payload = { invalidPayload: true };
        }
        const { payload_json: _payloadJson, ...safeRow } = row;
        return { ...safeRow, payload };
      }),
    analyses: select(`SELECT * FROM archive_source_analyses WHERE item_id IN (${placeholders})`, ...itemIds)
      .filter((row: any) => !sensitive.has(row.item_id)),
  };
}

function evidenceTargetData(
  target: NonNullable<PrimarySourceExportRequest['evidenceTarget']>,
): Record<string, unknown> | null {
  if (target.kind === 'person') {
    const person = getDb().prepare('SELECT * FROM persons WHERE person_id=?').get(target.id) as Record<string, unknown> | undefined;
    if (!person) return null;
    return {
      kind: target.kind,
      entity: person,
      names: getDb().prepare('SELECT * FROM person_names WHERE person_id=? ORDER BY name COLLATE NOCASE').all(target.id),
    };
  }
  if (target.kind === 'event') {
    const event = getDb().prepare('SELECT * FROM events WHERE event_id=?').get(target.id) as Record<string, unknown> | undefined;
    return event ? { kind: target.kind, entity: event } : null;
  }
  const relationship = getDb().prepare(
    `SELECT r.*, a.display_name AS from_name, b.display_name AS to_name
       FROM relationships r
       LEFT JOIN persons a ON a.person_id=r.from_person
       LEFT JOIN persons b ON b.person_id=r.to_person
      WHERE r.rel_id=?`
  ).get(target.id) as Record<string, unknown> | undefined;
  return relationship ? { kind: target.kind, entity: relationship } : null;
}

function interoperableData(itemIds: string[]): { geojson: unknown; graph: unknown } {
  if (!itemIds.length) return { geojson: { type: 'FeatureCollection', features: [] }, graph: { nodes: [], edges: [] } };
  const placeholders = itemIds.map(() => '?').join(',');
  const places = getDb().prepare(
    `SELECT profile.item_id, item.title AS source_title, p.place_id, p.name,
      p.latitude, p.longitude
       FROM archive_item_profiles profile
       JOIN archive_items item ON item.item_id=profile.item_id
       JOIN places p ON p.place_id=profile.provenance_place_id
      WHERE profile.item_id IN (${placeholders})
        AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
      ORDER BY item.title COLLATE NOCASE`
  ).all(...itemIds) as Array<{
    item_id: string;
    source_title: string;
    place_id: string;
    name: string;
    latitude: number;
    longitude: number;
  }>;
  const evidence = getDb().prepare(
    `SELECT id AS evidence_id, target_kind, target_id, nodus_id AS item_id, excerpt_id, evidence_role,
            certainty, review_status FROM record_evidence WHERE nodus_id IN (${placeholders})`
  ).all(...itemIds);
  return {
    geojson: {
      type: 'FeatureCollection',
      features: places.map((place) => ({
        type: 'Feature',
        id: `provenance:${place.item_id}`,
        geometry: { type: 'Point', coordinates: [place.longitude, place.latitude] },
        properties: {
          name: place.name,
          role: 'provenance',
          sourceId: place.item_id,
          sourceTitle: place.source_title,
        },
      })),
    },
    graph: {
      nodes: itemIds.map((id) => ({ id, kind: 'source' })),
      edges: evidence,
      formatNote: 'JSON graph inicial; no se afirma conformidad EAD, IIIF ni GEDCOM.',
    },
  };
}

export async function createPrimarySourceResearchPackage(options: {
  request: PrimarySourceExportRequest;
  tempDir: string;
  appVersion: string;
}): Promise<PackageBuild> {
  const preview = previewPrimarySourceExport(options.request);
  if (!preview.canExport) throw new Error(preview.blockers.join(' ') || 'La selección no se puede exportar.');
  const request = preview.request;
  const format: PrimarySourceInventoryFormat = ['csv', 'xlsx', 'json'].includes(
    request.inventoryFormat ?? ''
  ) ? request.inventoryFormat! : 'csv';
  const redacted = new Set(preview.metadataRedacted);
  const rows = inventoryRows(preview.includedItemIds, redacted);
  const entries = new Map<string, { data: Buffer; itemId: string | null; fileId: string | null; role: string | null }>();
  entries.set(`data/inventory.${format}`, {
    data: inventoryBytes(format, rows),
    itemId: null,
    fileId: null,
    role: null,
  });
  entries.set('data/sources.json', {
    data: Buffer.from(JSON.stringify(sourceMetadata(preview.includedItemIds, redacted), null, 2)),
    itemId: null,
    fileId: null,
    role: null,
  });
  if (request.includeTextVersions) {
    const text = getDb().prepare(
      `SELECT text_version_id, item_id, file_id, parent_version_id, kind, language_code,
              content, status, engine, model, confidence, editorial_conventions,
              created_at, updated_at, reviewed_at
         FROM archive_text_versions
        WHERE item_id IN (${preview.includedItemIds.map(() => '?').join(',')})
        ORDER BY item_id, created_at`
    ).all(...preview.includedItemIds);
    entries.set('data/text-versions.json', {
      data: Buffer.from(JSON.stringify(text, null, 2)),
      itemId: null,
      fileId: null,
      role: null,
    });
  }
  if (request.includeNotes && preview.includedNoteIds.length) {
    const notes = getDb().prepare(
      `SELECT n.id, n.title, n.kind, n.content, n.created_at, n.updated_at,
              p.note_type, p.status, p.collection, p.access_status, p.sensitivity
         FROM notes n
         JOIN primary_source_note_profiles p ON p.note_id=n.id
        WHERE n.id IN (${preview.includedNoteIds.map(() => '?').join(',')})
        ORDER BY n.updated_at`
    ).all(...preview.includedNoteIds);
    entries.set('data/notes.json', {
      data: Buffer.from(JSON.stringify(notes, null, 2)),
      itemId: null,
      fileId: null,
      role: null,
    });
  }
  if (request.profile === 'evidence_dossier' || request.profile === 'source_package') {
    entries.set('data/evidence.json', {
      data: Buffer.from(JSON.stringify(evidenceData(
        preview.includedItemIds,
        request.profile === 'evidence_dossier' ? request.evidenceTarget : null,
      ), null, 2)),
      itemId: null,
      fileId: null,
      role: null,
    });
    if (request.profile === 'evidence_dossier' && request.evidenceTarget) {
      const target = evidenceTargetData(request.evidenceTarget);
      if (!target) throw new Error('La entidad, evento o relación del dossier ya no existe.');
      entries.set('data/evidence-target.json', {
        data: Buffer.from(JSON.stringify(target, null, 2)),
        itemId: null,
        fileId: null,
        role: null,
      });
    }
  }
  if (request.profile === 'interoperable') {
    const interoperable = interoperableData(preview.includedItemIds);
    entries.set('data/places.geojson', {
      data: Buffer.from(JSON.stringify(interoperable.geojson, null, 2)),
      itemId: null,
      fileId: null,
      role: null,
    });
    entries.set('data/graph.json', {
      data: Buffer.from(JSON.stringify(interoperable.graph, null, 2)),
      itemId: null,
      fileId: null,
      role: null,
    });
  }

  const snapshotPath = path.join(
    options.tempDir,
    `nodus-primary-source-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
  let tables: Record<string, number>;
  try {
    await getDb().backup(snapshotPath);
    tables = filterSnapshot(snapshotPath, preview, request);
    entries.set('restore/research.sqlite', {
      data: fs.readFileSync(snapshotPath),
      itemId: null,
      fileId: null,
      role: null,
    });
  } finally {
    fs.rmSync(snapshotPath, { force: true });
  }

  if (filesRequested(request)) {
    const roles = request.includeDerivatives
      ? ['master', 'access', 'derivative', 'ocr', 'transcript', 'supplement', 'thumbnail']
      : ['master', 'access', 'supplement'];
    const files = getDb().prepare(
      `SELECT file_id, item_id, role, original_file_name, content_hash
         FROM archive_item_files
        WHERE item_id IN (${preview.includedItemIds.map(() => '?').join(',')})
          AND superseded_at IS NULL
          AND role IN (${roles.map(() => '?').join(',')})
        ORDER BY item_id, sequence_no, version_no`
    ).all(...preview.includedItemIds, ...roles) as Array<{
      file_id: string;
      item_id: string;
      role: string;
      original_file_name: string | null;
      content_hash: string | null;
    }>;
    for (const file of files) {
      const data = getArchiveFileBlob(file.file_id);
      if (!data) continue;
      if (file.content_hash && hash(data) !== file.content_hash) {
        throw new Error(`El archivo ${file.file_id} no coincide con su checksum preservado.`);
      }
      const candidateExtension = path.extname(file.original_file_name ?? '').slice(0, 16);
      const extension = /^\.[A-Za-z0-9]{1,10}$/.test(candidateExtension) ? candidateExtension : '';
      const entryName = `objects/${file.item_id}/${file.file_id}${extension}`;
      if (!safeEntryName(entryName)) {
        throw new Error('Un identificador interno produciría una ruta no segura en el paquete.');
      }
      entries.set(entryName, {
        data,
        itemId: file.item_id,
        fileId: file.file_id,
        role: file.role,
      });
    }
  }

  const manifestFiles: PrimarySourceResearchManifestFile[] = [...entries].map(([entryPath, entry]) => ({
    path: entryPath,
    sha256: hash(entry.data),
    bytes: entry.data.byteLength,
    itemId: entry.itemId,
    fileId: entry.fileId,
    role: entry.role,
  }));
  const vault = getActiveVault();
  const manifest: PrimarySourceResearchManifest = {
    format: 'nodus.primary-sources-research-package',
    formatVersion: 1,
    appVersion: options.appVersion,
    schemaVersion: SCHEMA_VERSION,
    vaultId: vault.id,
    vaultName: vault.name,
    createdAt: new Date().toISOString(),
    profile: request.profile,
    inventoryFormat: format,
    selection: {
      requested: requestedIds(request).length,
      included: preview.includedItemIds.length,
      excluded: preview.excludedByRestriction.length,
      evidenceTarget: request.profile === 'evidence_dossier'
        ? request.evidenceTarget ?? null
        : undefined,
    },
    policy: {
      restrictedExcluded: preview.excludedByRestriction.length,
      metadataRedacted: preview.metadataRedacted.length,
      privateAuthorized: (request.authorizedItemIds ?? []).filter((id) => preview.includedItemIds.includes(id)).length,
    },
    tables,
    files: manifestFiles,
    // Do not disclose a restricted source identifier in the package that was
    // expressly filtered out. The fingerprint permits audit reconciliation
    // against the local export record without redistributing source metadata.
    exclusions: preview.excludedByRestriction.map((itemId) => ({
      itemId: `sha256:${hash(Buffer.from(itemId, 'utf8')).slice(0, 16)}`,
      reason: 'institutional_or_embargo_restriction',
    })),
    verification: {
      status: 'verified',
      checkedEntries: manifestFiles.length,
      missingEntries: 0,
      mismatchedEntries: 0,
    },
  };
  const zip = new AdmZip();
  for (const [entryPath, entry] of entries) zip.addFile(entryPath, entry.data);
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  zip.addFile('README.txt', Buffer.from(
    'Paquete de investigación de Nodus. Valide manifest.json y los checksums antes de usar o restaurar. La sincronización no sustituye a una copia de seguridad completa.',
    'utf8',
  ));
  const buffer = await zip.toBufferPromise();
  const packageHash = hash(buffer);
  const exportId = recordArchiveExport({
    kind: request.profile,
    selection: { itemIds: request.itemIds },
    policySnapshot: {
      includedItemIds: preview.includedItemIds,
      excludedByRestriction: preview.excludedByRestriction,
      metadataRedacted: preview.metadataRedacted,
    },
    includedFiles: manifestFiles.filter((entry) => Boolean(entry.fileId)).length,
    excludedFiles: preview.excludedByRestriction.length + preview.missingFiles,
    manifestHash: packageHash,
  });
  getDb().prepare(
    `INSERT INTO primary_source_export_manifests (
      export_id, format_version, profile, schema_version, package_hash,
      manifest_json, verified_at, created_at
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)`
  ).run(
    exportId, request.profile, SCHEMA_VERSION, packageHash,
    JSON.stringify(manifest), new Date().toISOString(), manifest.createdAt
  );
  return { buffer, packageHash, manifest, exportId, preview };
}

export function validatePrimarySourceResearchPackage(buffer: Buffer): PrimarySourcePackageValidation {
  const packageHash = hash(buffer);
  const missingEntries: string[] = [];
  const mismatchedEntries: string[] = [];
  const unsafeEntries: string[] = [];
  const errors: string[] = [];
  let zip: AdmZip;
  let manifest: PrimarySourceResearchManifest | null = null;
  try {
    zip = new AdmZip(buffer);
  } catch {
    return {
      valid: false,
      packageHash,
      manifest: null,
      missingEntries,
      mismatchedEntries,
      unsafeEntries,
      errors: ['El archivo no es un ZIP de investigación legible.'],
    };
  }
  const archiveNames = new Set<string>();
  const archiveEntries = zip.getEntries();
  if (archiveEntries.length > 50_000) errors.push('El paquete contiene demasiadas entradas.');
  for (const entry of archiveEntries) {
    if (!safeEntryName(entry.entryName) || archiveNames.has(entry.entryName)) {
      unsafeEntries.push(entry.entryName);
    }
    archiveNames.add(entry.entryName);
  }
  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) {
    errors.push('Falta manifest.json.');
  } else {
    try {
      manifest = JSON.parse(zip.readAsText(manifestEntry)) as PrimarySourceResearchManifest;
    } catch {
      errors.push('manifest.json no contiene JSON válido.');
    }
  }
  if (manifest) {
    if (manifest.format !== 'nodus.primary-sources-research-package' || manifest.formatVersion !== 1) {
      errors.push('El formato o la versión del paquete no son compatibles.');
    }
    if (!Number.isInteger(manifest.schemaVersion) || manifest.schemaVersion > SCHEMA_VERSION) {
      errors.push(`El paquete requiere un esquema posterior a v${SCHEMA_VERSION}.`);
    }
    const seen = new Set<string>();
    if (!Array.isArray(manifest.files)) {
      errors.push('El manifiesto no contiene un inventario de archivos válido.');
    } else {
      for (const file of manifest.files) {
        if (
          !file
          || typeof file !== 'object'
          || !safeEntryName(file.path)
          || seen.has(file.path)
          || !Number.isSafeInteger(file.bytes)
          || file.bytes < 0
          || typeof file.sha256 !== 'string'
          || !/^[a-f0-9]{64}$/.test(file.sha256)
        ) {
          unsafeEntries.push(
            file && typeof file === 'object' && typeof file.path === 'string'
              ? file.path
              : '[entrada de manifiesto no válida]'
          );
          continue;
        }
        seen.add(file.path);
        const entry = zip.getEntry(file.path);
        if (!entry) {
          missingEntries.push(file.path);
          continue;
        }
        const data = entry.getData();
        if (data.byteLength !== file.bytes || hash(data) !== file.sha256) {
          mismatchedEntries.push(file.path);
        }
      }
    }
    if (!seen.has('restore/research.sqlite')) errors.push('El paquete no incluye la instantánea restaurable.');
  }
  return {
    valid: Boolean(manifest)
      && errors.length === 0
      && missingEntries.length === 0
      && mismatchedEntries.length === 0
      && unsafeEntries.length === 0,
    packageHash,
    manifest,
    missingEntries,
    mismatchedEntries,
    unsafeEntries: [...new Set(unsafeEntries)],
    errors,
  };
}

export function restorePrimarySourceResearchPackage(options: {
  buffer: Buffer;
  tempDir: string;
  name?: string | null;
}): PrimarySourceRestoreReport {
  const validation = validatePrimarySourceResearchPackage(options.buffer);
  if (!validation.valid || !validation.manifest) {
    return insertPrimarySourceRestoreReport({
      status: 'rejected',
      packageHash: validation.packageHash,
      sourceSchema: validation.manifest?.schemaVersion ?? null,
      resultVaultId: null,
      missingFiles: validation.missingEntries.length,
      invalidFiles: validation.mismatchedEntries.length + validation.unsafeEntries.length,
      message: [...validation.errors, ...validation.missingEntries, ...validation.mismatchedEntries].join(' ') || 'Paquete rechazado.',
    });
  }
  const zip = new AdmZip(options.buffer);
  const databaseEntry = zip.getEntry('restore/research.sqlite');
  if (!databaseEntry) {
    return insertPrimarySourceRestoreReport({
      status: 'rejected',
      packageHash: validation.packageHash,
      sourceSchema: validation.manifest.schemaVersion,
      resultVaultId: null,
      missingFiles: 1,
      invalidFiles: 0,
      message: 'Falta la instantánea restaurable.',
    });
  }
  const temporary = path.join(
    options.tempDir,
    `nodus-primary-restore-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  );
  try {
    fs.writeFileSync(temporary, databaseEntry.getData(), { flag: 'wx' });
    const db = new Database(temporary);
    let missingFiles = 0;
    try {
      db.pragma('foreign_keys = OFF');
      for (const file of validation.manifest.files.filter((entry) => entry.fileId)) {
        const entry = zip.getEntry(file.path);
        if (!entry) {
          missingFiles += 1;
          continue;
        }
        const data = entry.getData();
        const result = db.prepare(
          `UPDATE archive_item_files
              SET content_blob=?, byte_size=?, content_hash=?, hash_algorithm='sha256',
                  verification_status='verified', verified_at=?
            WHERE file_id=? AND item_id=?`
        ).run(data, data.byteLength, file.sha256, new Date().toISOString(), file.fileId, file.itemId);
        if (result.changes !== 1) throw new Error(`El objeto ${file.fileId} no pertenece a la instantánea.`);
      }
      db.pragma('foreign_keys = ON');
      const foreign = db.pragma('foreign_key_check') as unknown[];
      const quick = db.pragma('quick_check', { simple: true });
      if (foreign.length || quick !== 'ok') throw new Error('La base restaurada no superó las comprobaciones SQLite.');
      missingFiles += Number((db.prepare(
        `SELECT COUNT(*) AS value FROM archive_item_files
          WHERE content_hash IS NOT NULL AND content_blob IS NULL`
      ).get() as { value: number }).value);
    } finally {
      db.close();
    }
    const cleanName = [...(options.name?.trim() || `${validation.manifest.vaultName} — restaurado`)]
      .map((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || code === 127 ? ' ' : character;
      })
      .join('')
      .slice(0, 120);
    const vault = createVaultFromDatabaseFile(temporary, cleanName, 'primary_sources');
    return insertPrimarySourceRestoreReport({
      status: 'restored',
      packageHash: validation.packageHash,
      sourceSchema: validation.manifest.schemaVersion,
      resultVaultId: vault.id,
      missingFiles,
      invalidFiles: 0,
      message: `Paquete validado y restaurado como un vault nuevo: ${cleanName}.`,
    });
  } catch (error) {
    return insertPrimarySourceRestoreReport({
      status: 'failed',
      packageHash: validation.packageHash,
      sourceSchema: validation.manifest.schemaVersion,
      resultVaultId: null,
      missingFiles: validation.missingEntries.length,
      invalidFiles: validation.mismatchedEntries.length,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
