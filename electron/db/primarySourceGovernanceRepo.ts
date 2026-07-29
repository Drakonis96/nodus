import { createHash } from 'node:crypto';
import { v4 as uuid } from 'uuid';
import type {
  PrimarySourceAiAuditEntry,
  PrimarySourceCitationField,
  PrimarySourceCitationSettings,
  PrimarySourceGovernanceWorkspace,
  PrimarySourcePolicySettings,
  PrimarySourcePolicySettingsPatch,
  PrimarySourceRestoreReport,
  PrimarySourceToolkitOperationDefinition,
  PrimarySourceToolkitOperationId,
  PrimarySourceToolkitSelectionItem,
} from '@shared/primarySourcesTypes';
import { SCHEMA_VERSION, getDb } from './database';

const POLICY_ID = 'default';
const CITATION_SETTINGS_ID = 'default';
const DEFAULT_CITATION_ORDER: PrimarySourceCitationField[] = [
  'repository',
  'hierarchy',
  'reference',
  'title',
  'date',
  'locator',
  'version_url',
  'accessed',
];

export const PRIMARY_SOURCE_TOOLKIT_OPERATIONS: PrimarySourceToolkitOperationDefinition[] = [
  { id: 'run_ocr', label: 'Ejecutar OCR', description: 'Crea una versión automática de texto sin alterar el máster.', resultKind: 'text_version', minItems: 1, localCapable: true, externalCapable: false },
  { id: 'transcribe', label: 'Transcribir audio o vídeo', description: 'Crea una transcripción automática versionada y localizable.', resultKind: 'text_version', minItems: 1, localCapable: true, externalCapable: true },
  { id: 'segment_pages', label: 'Segmentar páginas', description: 'Crea una versión con segmentos localizables sin sobrescribir el texto de origen.', resultKind: 'text_version', minItems: 1, localCapable: true, externalCapable: false },
  { id: 'translate_text', label: 'Traducir como versión separada', description: 'Crea una traducción automática enlazada a la versión literal de origen.', resultKind: 'text_version', minItems: 1, localCapable: true, externalCapable: true },
  { id: 'describe_image', label: 'Describir imagen', description: 'Propone una descripción visual; nunca identifica personas.', resultKind: 'proposal', minItems: 1, localCapable: true, externalCapable: true },
  { id: 'suggest_document_type', label: 'Sugerir tipo documental', description: 'Propone tipos a partir de rasgos visibles y metadatos.', resultKind: 'proposal', minItems: 1, localCapable: true, externalCapable: true },
  { id: 'extract_mentions', label: 'Extraer menciones', description: 'Propone personas, lugares, fechas y relaciones con cita.', resultKind: 'proposal', minItems: 1, localCapable: true, externalCapable: true },
  { id: 'compare_documents', label: 'Comparar documentos', description: 'Contrasta coincidencias, diferencias y contradicciones.', resultKind: 'comparison', minItems: 2, localCapable: true, externalCapable: true },
  { id: 'detect_duplicates', label: 'Detectar posibles duplicados', description: 'Compara hashes y metadatos sin fusionar nada.', resultKind: 'quality_report', minItems: 2, localCapable: true, externalCapable: false },
  { id: 'summarize_metadata', label: 'Resumir metadatos', description: 'Resume descripción y procedencia, no el contenido del documento.', resultKind: 'proposal', minItems: 1, localCapable: true, externalCapable: true },
  { id: 'critical_questions', label: 'Proponer preguntas de crítica', description: 'Prepara preguntas sobre autoría, propósito, audiencia y contexto.', resultKind: 'proposal', minItems: 1, localCapable: true, externalCapable: true },
  { id: 'normalize_dates', label: 'Normalizar fechas como propuesta', description: 'Propone límites de ordenación sin borrar la fecha literal.', resultKind: 'proposal', minItems: 1, localCapable: true, externalCapable: true },
  { id: 'suggest_toponyms', label: 'Sugerir topónimos', description: 'Conserva candidatos y alternativas sin resolver identidades.', resultKind: 'proposal', minItems: 1, localCapable: true, externalCapable: true },
  { id: 'prepare_table', label: 'Preparar una tabla', description: 'Genera una tabla de trabajo con referencias y estados.', resultKind: 'inventory', minItems: 1, localCapable: true, externalCapable: false },
  { id: 'generate_inventory', label: 'Generar inventario', description: 'Inventaría unidades, representaciones, texto y estado de cita.', resultKind: 'inventory', minItems: 1, localCapable: true, externalCapable: false },
  { id: 'review_description_quality', label: 'Revisar calidad descriptiva', description: 'Señala campos ausentes y referencias incompletas.', resultKind: 'quality_report', minItems: 1, localCapable: true, externalCapable: false },
];

function bool(value: number): boolean {
  return Boolean(value);
}

function clampRetention(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(3650, Math.round(parsed))) : 365;
}

function json<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

function now(): string {
  return new Date().toISOString();
}

export function getPrimarySourcePolicySettings(): PrimarySourcePolicySettings {
  const db = getDb();
  const row = db.prepare('SELECT * FROM primary_source_policies WHERE policy_id=?').get(POLICY_ID) as {
    allow_private_search: number;
    allow_restricted_search: number;
    allow_private_sync: number;
    allow_restricted_sync: number;
    allow_restricted_local_ai: number;
    allow_private_external_ai: number;
    require_external_confirmation: number;
    retain_automatic_results_days: number;
    export_private_files: number;
    review_expired_embargoes: number;
    redact_physical_locations: number;
    redact_personal_metadata: number;
    created_at: string;
    updated_at: string;
  } | undefined;
  if (!row) {
    const ts = now();
    db.prepare(
      `INSERT INTO primary_source_policies (
        policy_id, created_at, updated_at
      ) VALUES (?, ?, ?)`
    ).run(POLICY_ID, ts, ts);
    return getPrimarySourcePolicySettings();
  }
  return {
    allowPrivateSearch: bool(row.allow_private_search),
    allowRestrictedSearch: bool(row.allow_restricted_search),
    allowPrivateSync: bool(row.allow_private_sync),
    allowRestrictedSync: bool(row.allow_restricted_sync),
    allowRestrictedLocalAi: bool(row.allow_restricted_local_ai),
    allowPrivateExternalAi: bool(row.allow_private_external_ai),
    requireExternalConfirmation: bool(row.require_external_confirmation),
    retainAutomaticResultsDays: row.retain_automatic_results_days,
    exportPrivateFiles: bool(row.export_private_files),
    reviewExpiredEmbargoes: bool(row.review_expired_embargoes),
    redactPhysicalLocations: bool(row.redact_physical_locations),
    redactPersonalMetadata: bool(row.redact_personal_metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function updatePrimarySourcePolicySettings(
  patch: PrimarySourcePolicySettingsPatch,
): PrimarySourcePolicySettings {
  const current = getPrimarySourcePolicySettings();
  const next: PrimarySourcePolicySettings = {
    ...current,
    ...patch,
    retainAutomaticResultsDays: patch.retainAutomaticResultsDays === undefined
      ? current.retainAutomaticResultsDays
      : clampRetention(patch.retainAutomaticResultsDays),
    createdAt: current.createdAt,
    updatedAt: now(),
  };
  getDb().prepare(
    `UPDATE primary_source_policies SET
      allow_private_search=?, allow_restricted_search=?, allow_private_sync=?,
      allow_restricted_sync=?, allow_restricted_local_ai=?, allow_private_external_ai=?,
      require_external_confirmation=?, retain_automatic_results_days=?,
      export_private_files=?, review_expired_embargoes=?, redact_physical_locations=?,
      redact_personal_metadata=?, updated_at=?
     WHERE policy_id=?`
  ).run(
    Number(next.allowPrivateSearch), Number(next.allowRestrictedSearch),
    Number(next.allowPrivateSync), Number(next.allowRestrictedSync),
    Number(next.allowRestrictedLocalAi), Number(next.allowPrivateExternalAi),
    Number(next.requireExternalConfirmation), next.retainAutomaticResultsDays,
    Number(next.exportPrivateFiles), Number(next.reviewExpiredEmbargoes),
    Number(next.redactPhysicalLocations), Number(next.redactPersonalMetadata),
    next.updatedAt, POLICY_ID
  );
  return getPrimarySourcePolicySettings();
}

function validCitationOrder(value: unknown): PrimarySourceCitationField[] {
  const allowed = new Set<PrimarySourceCitationField>(DEFAULT_CITATION_ORDER);
  const supplied = Array.isArray(value)
    ? value.filter((entry): entry is PrimarySourceCitationField =>
      typeof entry === 'string' && allowed.has(entry as PrimarySourceCitationField))
    : [];
  return [...new Set([...supplied, ...DEFAULT_CITATION_ORDER])];
}

function validRequiredCitationFields(
  value: unknown,
): PrimarySourceCitationSettings['requiredFields'] {
  const allowed = new Set<PrimarySourceCitationSettings['requiredFields'][number]>([
    'repository', 'reference', 'title', 'locator', 'master',
  ]);
  if (!Array.isArray(value)) return ['repository', 'reference', 'title', 'locator', 'master'];
  return [...new Set(value.filter(
    (entry): entry is PrimarySourceCitationSettings['requiredFields'][number] =>
      typeof entry === 'string' && allowed.has(entry as PrimarySourceCitationSettings['requiredFields'][number])
  ))];
}

export function getPrimarySourceCitationSettings(): PrimarySourceCitationSettings {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM primary_source_citation_settings WHERE settings_id=?'
  ).get(CITATION_SETTINGS_ID) as {
    field_order_json: string;
    repository_aliases_json: string;
    required_fields_json: string;
    include_accessed_date: number;
    updated_at: string;
  } | undefined;
  if (!row) {
    const ts = now();
    db.prepare(
      `INSERT INTO primary_source_citation_settings (
        settings_id, field_order_json, repository_aliases_json,
        required_fields_json, include_accessed_date, updated_at
      ) VALUES (?, ?, '{}', ?, 0, ?)`
    ).run(
      CITATION_SETTINGS_ID,
      JSON.stringify(DEFAULT_CITATION_ORDER),
      JSON.stringify(['repository', 'reference', 'title', 'locator', 'master']),
      ts
    );
    return getPrimarySourceCitationSettings();
  }
  return {
    fieldOrder: validCitationOrder(json(row.field_order_json, DEFAULT_CITATION_ORDER)),
    repositoryAliases: json<Record<string, string>>(row.repository_aliases_json, {}),
    requiredFields: validRequiredCitationFields(json(
      row.required_fields_json,
      ['repository', 'reference', 'title', 'locator', 'master']
    )),
    includeAccessedDate: bool(row.include_accessed_date),
    updatedAt: row.updated_at,
  };
}

export function updatePrimarySourceCitationSettings(
  patch: Partial<Omit<PrimarySourceCitationSettings, 'updatedAt'>>,
): PrimarySourceCitationSettings {
  const current = getPrimarySourceCitationSettings();
  const fieldOrder = patch.fieldOrder ? validCitationOrder(patch.fieldOrder) : current.fieldOrder;
  const aliases = patch.repositoryAliases ?? current.repositoryAliases;
  const required = patch.requiredFields
    ? validRequiredCitationFields(patch.requiredFields)
    : current.requiredFields;
  const includeAccessedDate = patch.includeAccessedDate ?? current.includeAccessedDate;
  getDb().prepare(
    `UPDATE primary_source_citation_settings SET
      field_order_json=?, repository_aliases_json=?, required_fields_json=?,
      include_accessed_date=?, updated_at=? WHERE settings_id=?`
  ).run(
    JSON.stringify(fieldOrder), JSON.stringify(aliases), JSON.stringify(required),
    Number(includeAccessedDate), now(), CITATION_SETTINGS_ID
  );
  return getPrimarySourceCitationSettings();
}

export function listPrimarySourceToolkitItems(): PrimarySourceToolkitSelectionItem[] {
  return (getDb().prepare(
    `SELECT ai.item_id, ai.title,
            (SELECT u.reference_code
              FROM archive_item_units iu
               JOIN archive_description_units u ON u.unit_id=iu.unit_id
              WHERE iu.item_id=ai.item_id AND iu.relation_kind='describes'
              ORDER BY iu.position, u.updated_at DESC LIMIT 1) AS reference_code,
            p.access_status, p.sensitivity,
            (SELECT COUNT(*) FROM archive_item_files f
              WHERE f.item_id=ai.item_id AND f.superseded_at IS NULL) AS file_count,
            (SELECT COUNT(*) FROM archive_text_versions tv
              WHERE tv.item_id=ai.item_id) AS text_version_count,
            (SELECT COALESCE(SUM(f.byte_size), 0) FROM archive_item_files f
              WHERE f.item_id=ai.item_id AND f.superseded_at IS NULL) AS byte_size
       FROM archive_items ai
       JOIN archive_item_profiles p ON p.item_id=ai.item_id
      ORDER BY ai.updated_at DESC, ai.title COLLATE NOCASE`
  ).all() as Array<{
    item_id: string;
    title: string;
    reference_code: string | null;
    access_status: PrimarySourceToolkitSelectionItem['accessStatus'];
    sensitivity: PrimarySourceToolkitSelectionItem['sensitivity'];
    file_count: number;
    text_version_count: number;
    byte_size: number;
  }>).map((row) => ({
    itemId: row.item_id,
    title: row.title,
    referenceCode: row.reference_code,
    accessStatus: row.access_status,
    sensitivity: row.sensitivity,
    fileCount: Number(row.file_count),
    textVersionCount: Number(row.text_version_count),
    byteSize: Number(row.byte_size),
  }));
}

export function createPrimarySourceOperationRun(input: {
  operationId: PrimarySourceToolkitOperationId;
  processingLocation: 'local' | 'external';
  itemIds: string[];
  provider: string | null;
  model: string | null;
  contextHash: string | null;
  contextBytes: number;
  leftDevice: boolean;
  policyDecision: string;
  status: PrimarySourceAiAuditEntry['status'];
  resultKind?: string | null;
  errorCode?: string | null;
}): string {
  const runId = `psrun_${uuid()}`;
  getDb().prepare(
    `INSERT INTO primary_source_operation_runs (
      run_id, operation_id, processing_location, selection_count, selected_ids_hash,
      provider, model, context_hash, context_bytes, left_device, policy_decision,
      status, result_kind, created_at, completed_at, error_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    runId, input.operationId, input.processingLocation, input.itemIds.length,
    createHash('sha256').update([...input.itemIds].sort().join('\n')).digest('hex'),
    input.provider, input.model, input.contextHash, Math.max(0, input.contextBytes),
    Number(input.leftDevice), input.policyDecision, input.status,
    input.resultKind ?? null, now(),
    ['completed', 'blocked', 'failed'].includes(input.status) ? now() : null,
    input.errorCode ?? null
  );
  return runId;
}

export function finishPrimarySourceOperationRun(
  runId: string,
  status: 'completed' | 'blocked' | 'failed',
  resultKind: string | null,
  errorCode: string | null = null,
): void {
  getDb().prepare(
    `UPDATE primary_source_operation_runs
        SET status=?, result_kind=?, completed_at=?, error_code=?
      WHERE run_id=?`
  ).run(status, resultKind, now(), errorCode, runId);
}

export function listPrimarySourceAiAudit(limit = 30): PrimarySourceAiAuditEntry[] {
  return (getDb().prepare(
    `SELECT * FROM primary_source_operation_runs ORDER BY created_at DESC LIMIT ?`
  ).all(Math.max(1, Math.min(200, Math.trunc(limit)))) as Array<{
    run_id: string;
    operation_id: string;
    processing_location: 'local' | 'external';
    selection_count: number;
    provider: string | null;
    model: string | null;
    context_bytes: number;
    left_device: number;
    policy_decision: string;
    status: PrimarySourceAiAuditEntry['status'];
    result_kind: string | null;
    created_at: string;
    completed_at: string | null;
    error_code: string | null;
  }>).map((row) => ({
    runId: row.run_id,
    operationId: row.operation_id,
    processingLocation: row.processing_location,
    selectionCount: row.selection_count,
    provider: row.provider,
    model: row.model,
    contextBytes: row.context_bytes,
    leftDevice: bool(row.left_device),
    policyDecision: row.policy_decision,
    status: row.status,
    resultKind: row.result_kind,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    errorCode: row.error_code,
  }));
}

export function tableInventory(): Record<string, number> {
  const db = getDb();
  const names = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all() as { name: string }[]).map((row) => row.name);
  return Object.fromEntries(names.map((name) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return [name, 0];
    const quoted = `"${name.replace(/"/g, '""')}"`;
    return [name, Number((db.prepare(`SELECT COUNT(*) AS value FROM ${quoted}`).get() as { value: number }).value)];
  }));
}

/** Tables that make a research package self-contained. Non-archival product data is
 * deliberately cleared from the filtered SQLite snapshot before it leaves the vault. */
export const PRIMARY_SOURCE_PORTABLE_TABLES = [
  'settings',
  'archive_folders',
  'archive_items',
  'archive_item_folders',
  'archive_item_persons',
  'archive_item_tags',
  'archive_repositories',
  'archive_description_units',
  'archive_item_units',
  'archive_capture_sessions',
  'archive_item_profiles',
  'archive_item_files',
  'archive_text_versions',
  'archive_text_segments',
  'archive_excerpts',
  'archive_entity_proposals',
  'archive_proposal_decisions',
  'archive_source_analyses',
  'archive_place_mentions',
  'archive_place_resolution_decisions',
  'archive_person_mentions',
  'entity_resolutions',
  'archive_integrity_checks',
  'archive_description_templates',
  'archive_audit_log',
  'persons',
  'person_names',
  'person_places',
  'places',
  'events',
  'event_participants',
  'relationships',
  'record_evidence',
  'social_contacts',
  'social_relations',
  'note_folders',
  'notes',
  'note_links',
  'primary_source_note_profiles',
  'primary_source_note_link_snapshots',
  'primary_source_policies',
  'primary_source_citation_settings',
] as const;

function primarySourceTableNames(): string[] {
  return Object.keys(tableInventory()).filter((name) =>
    name.startsWith('archive_') || name.startsWith('primary_source_'));
}

export function insertPrimarySourceRestoreReport(input: Omit<PrimarySourceRestoreReport, 'reportId' | 'createdAt'>): PrimarySourceRestoreReport {
  const report: PrimarySourceRestoreReport = {
    ...input,
    reportId: `psrestore_${uuid()}`,
    createdAt: now(),
  };
  getDb().prepare(
    `INSERT INTO primary_source_restore_reports (
      report_id, package_hash, source_schema, result_vault_id, status,
      missing_files, invalid_files, report_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    report.reportId, report.packageHash, report.sourceSchema, report.resultVaultId,
    report.status, report.missingFiles, report.invalidFiles,
    JSON.stringify({ message: report.message }), report.createdAt
  );
  return report;
}

function listRestoreReports(): PrimarySourceRestoreReport[] {
  return (getDb().prepare(
    'SELECT * FROM primary_source_restore_reports ORDER BY created_at DESC LIMIT 20'
  ).all() as Array<{
    report_id: string;
    package_hash: string;
    source_schema: number | null;
    result_vault_id: string | null;
    status: PrimarySourceRestoreReport['status'];
    missing_files: number;
    invalid_files: number;
    report_json: string;
    created_at: string;
  }>).map((row) => ({
    reportId: row.report_id,
    status: row.status,
    packageHash: row.package_hash,
    sourceSchema: row.source_schema,
    resultVaultId: row.result_vault_id,
    missingFiles: row.missing_files,
    invalidFiles: row.invalid_files,
    message: json<{ message?: string }>(row.report_json, {}).message ?? '',
    createdAt: row.created_at,
  }));
}

export function getPrimarySourceGovernanceWorkspace(): PrimarySourceGovernanceWorkspace {
  const inventory = tableInventory();
  const policySettings = getPrimarySourcePolicySettings();
  const portable = new Set<string>(PRIMARY_SOURCE_PORTABLE_TABLES);
  const operationalOnly = new Set([
    'archive_exports',
    'primary_source_operation_runs',
    'primary_source_export_manifests',
    'primary_source_restore_reports',
    'primary_source_local_metrics',
  ]);
  const recentExports = (getDb().prepare(
    `SELECT e.export_id, e.kind, e.included_files, e.excluded_files, e.manifest_hash,
            e.created_at, m.profile, m.verified_at
       FROM archive_exports e
       LEFT JOIN primary_source_export_manifests m ON m.export_id=e.export_id
      ORDER BY e.created_at DESC LIMIT 20`
  ).all() as Array<{
    export_id: string;
    kind: string;
    included_files: number;
    excluded_files: number;
    manifest_hash: string | null;
    created_at: string;
    profile: string | null;
    verified_at: string | null;
  }>).map((row) => ({
    exportId: row.export_id,
    profile: row.profile ?? row.kind,
    includedFiles: row.included_files,
    excludedFiles: row.excluded_files,
    packageHash: row.manifest_hash,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
  }));
  const noteRows = getDb().prepare(
    `SELECT n.id AS note_id, n.title, p.access_status, p.sensitivity
       FROM notes n
       JOIN primary_source_note_profiles p ON p.note_id=n.id
      ORDER BY n.updated_at DESC`
  ).all() as Array<{
    note_id: string;
    title: string;
    access_status: PrimarySourceGovernanceWorkspace['notes'][number]['accessStatus'];
    sensitivity: PrimarySourceGovernanceWorkspace['notes'][number]['sensitivity'];
  }>;
  const noteItemRows = getDb().prepare(
    `SELECT nl.nodus_id AS note_id,
            CASE
              WHEN nl.target_kind='source' THEN nl.target_id
              WHEN nl.target_kind='excerpt' THEN ex.item_id
              WHEN nl.target_kind='text_version' THEN tv.item_id
              ELSE NULL
            END AS item_id
       FROM note_links nl
       LEFT JOIN archive_excerpts ex
         ON nl.target_kind='excerpt' AND ex.excerpt_id=nl.target_id
       LEFT JOIN archive_text_versions tv
         ON nl.target_kind='text_version' AND tv.text_version_id=nl.target_id`
  ).all() as Array<{ note_id: string; item_id: string | null }>;
  const noteItems = new Map<string, Set<string>>();
  for (const row of noteItemRows) {
    if (!row.item_id) continue;
    const itemIds = noteItems.get(row.note_id) ?? new Set<string>();
    itemIds.add(row.item_id);
    noteItems.set(row.note_id, itemIds);
  }
  const retentionCutoff = new Date(
    Date.now() - policySettings.retainAutomaticResultsDays * 86_400_000
  ).toISOString();
  const retentionReviewDue = {
    textVersions: Number((getDb().prepare(
      `SELECT COUNT(*) AS value FROM archive_text_versions
        WHERE status='automatic' AND created_at<=?`
    ).get(retentionCutoff) as { value: number }).value),
    proposals: Number((getDb().prepare(
      `SELECT COUNT(*) AS value FROM archive_entity_proposals
        WHERE status='pending' AND created_at<=?`
    ).get(retentionCutoff) as { value: number }).value),
  };
  const evidenceTargets: PrimarySourceGovernanceWorkspace['evidenceTargets'] = [
    ...(getDb().prepare(
      `SELECT p.person_id AS id, p.display_name AS label
         FROM persons p
        WHERE EXISTS (
          SELECT 1 FROM record_evidence e
           WHERE e.target_kind='person' AND e.target_id=p.person_id
        )
        ORDER BY p.display_name COLLATE NOCASE`
    ).all() as Array<{ id: string; label: string }>).map((row) => ({
      kind: 'person' as const,
      ...row,
    })),
    ...(getDb().prepare(
      `SELECT e.event_id AS id, COALESCE(e.label, e.type, e.event_id) AS label
         FROM events e
        WHERE EXISTS (
          SELECT 1 FROM record_evidence re
           WHERE re.target_kind='event' AND re.target_id=e.event_id
        )
        ORDER BY label COLLATE NOCASE`
    ).all() as Array<{ id: string; label: string }>).map((row) => ({
      kind: 'event' as const,
      ...row,
    })),
    ...(getDb().prepare(
      `SELECT r.rel_id AS id,
              COALESCE(a.display_name, r.from_person) || ' — ' || r.type || ' — ' ||
              COALESCE(b.display_name, r.to_person) AS label
         FROM relationships r
         LEFT JOIN persons a ON a.person_id=r.from_person
         LEFT JOIN persons b ON b.person_id=r.to_person
        WHERE EXISTS (
          SELECT 1 FROM record_evidence re
           WHERE re.target_kind='relationship' AND re.target_id=r.rel_id
        )
        ORDER BY label COLLATE NOCASE`
    ).all() as Array<{ id: string; label: string }>).map((row) => ({
      kind: 'relationship' as const,
      ...row,
    })),
  ];
  return {
    policy: policySettings,
    citations: getPrimarySourceCitationSettings(),
    operations: PRIMARY_SOURCE_TOOLKIT_OPERATIONS,
    items: listPrimarySourceToolkitItems(),
    notes: noteRows.map((row) => ({
      noteId: row.note_id,
      title: row.title,
      accessStatus: row.access_status,
      sensitivity: row.sensitivity,
      linkedItemIds: [...(noteItems.get(row.note_id) ?? [])],
    })),
    evidenceTargets,
    recentAiAudit: listPrimarySourceAiAudit(),
    recentExports,
    recentRestores: listRestoreReports(),
    retentionReviewDue,
    inventory: {
      schemaVersion: SCHEMA_VERSION,
      tables: inventory,
      classifiedPortableTables: [...portable].filter((name) => name in inventory).sort(),
      unclassifiedPrimarySourceTables: primarySourceTableNames()
        .filter((name) => !portable.has(name) && !operationalOnly.has(name))
        .sort(),
    },
  };
}
