import { v4 as uuid } from 'uuid';
import type {
  ArchiveCaptureSession,
  ArchiveDescriptionUnit,
  ArchiveRepository,
} from '@shared/archiveTypes';
import { validateArchiveHierarchy } from '@shared/archiveTypes';
import { getDb } from './database';

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${uuid()}`;
const json = (value: unknown) => JSON.stringify(value ?? {});
const arrayJson = (value: unknown) => JSON.stringify(Array.isArray(value) ? value : []);
const parseObject = (value: string | null): Record<string, unknown> => {
  try {
    const parsed = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};
const parseArray = (value: string | null): string[] => {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

type RepositoryRow = {
  repository_id: string; name: string; short_name: string | null; identifier: string | null;
  address: string | null; website_url: string | null; catalog_url: string | null;
  country_code: string | null; contact_notes: string | null; access_notes: string | null;
  citation_template: string | null; created_at: string; updated_at: string;
};

function repositoryFromRow(row: RepositoryRow): ArchiveRepository {
  return {
    repositoryId: row.repository_id, name: row.name, shortName: row.short_name,
    identifier: row.identifier, address: row.address, websiteUrl: row.website_url,
    catalogUrl: row.catalog_url, countryCode: row.country_code, contactNotes: row.contact_notes,
    accessNotes: row.access_notes, citationTemplate: row.citation_template,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function createArchiveRepository(
  input: Pick<ArchiveRepository, 'name'> & Partial<Omit<ArchiveRepository, 'repositoryId' | 'name' | 'createdAt' | 'updatedAt'>>
): ArchiveRepository {
  const repositoryId = id('arp');
  const ts = now();
  getDb().prepare(
    `INSERT INTO archive_repositories (
      repository_id, name, short_name, identifier, address, website_url, catalog_url,
      country_code, contact_notes, access_notes, citation_template, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    repositoryId, input.name.trim(), input.shortName ?? null, input.identifier ?? null,
    input.address ?? null, input.websiteUrl ?? null, input.catalogUrl ?? null,
    input.countryCode ?? null, input.contactNotes ?? null, input.accessNotes ?? null,
    input.citationTemplate ?? null, ts, ts
  );
  return getArchiveRepository(repositoryId)!;
}

export function getArchiveRepository(repositoryId: string): ArchiveRepository | null {
  const row = getDb().prepare('SELECT * FROM archive_repositories WHERE repository_id = ?').get(repositoryId) as RepositoryRow | undefined;
  return row ? repositoryFromRow(row) : null;
}

export function listArchiveRepositories(): ArchiveRepository[] {
  return (getDb().prepare('SELECT * FROM archive_repositories ORDER BY name COLLATE NOCASE').all() as RepositoryRow[])
    .map(repositoryFromRow);
}

export function updateArchiveRepository(
  repositoryId: string,
  patch: Partial<Omit<ArchiveRepository, 'repositoryId' | 'createdAt' | 'updatedAt'>>
): ArchiveRepository | null {
  const current = getArchiveRepository(repositoryId);
  if (!current) return null;
  const next = { ...current, ...patch, name: patch.name?.trim() || current.name };
  getDb().prepare(
    `UPDATE archive_repositories SET name=?, short_name=?, identifier=?, address=?,
      website_url=?, catalog_url=?, country_code=?, contact_notes=?, access_notes=?,
      citation_template=?, updated_at=? WHERE repository_id=?`
  ).run(
    next.name, next.shortName, next.identifier, next.address, next.websiteUrl, next.catalogUrl,
    next.countryCode, next.contactNotes, next.accessNotes, next.citationTemplate, now(), repositoryId
  );
  return getArchiveRepository(repositoryId);
}

type UnitRow = {
  unit_id: string; repository_id: string | null; parent_unit_id: string | null; level: ArchiveDescriptionUnit['level'];
  local_level_label: string | null; reference_code: string | null; title: string; title_type: ArchiveDescriptionUnit['titleType'];
  date_display: string | null; date_start_sort: string | null; date_end_sort: string | null;
  date_certainty: ArchiveDescriptionUnit['date']['certainty']; creator_display: string | null;
  extent_display: string | null; scope_content: string | null; arrangement: string | null;
  administrative_biographical_history: string | null; custodial_history: string | null;
  acquisition_info: string | null; access_conditions: string | null; reproduction_conditions: string | null;
  language_codes_json: string | null; script_codes_json: string | null; physical_characteristics: string | null;
  finding_aids: string | null; related_units: string | null; source_catalog_url: string | null;
  position: number; metadata_json: string | null; created_at: string; updated_at: string;
};

function unitFromRow(row: UnitRow): ArchiveDescriptionUnit {
  return {
    unitId: row.unit_id, repositoryId: row.repository_id, parentUnitId: row.parent_unit_id,
    level: row.level, localLevelLabel: row.local_level_label, referenceCode: row.reference_code,
    title: row.title, titleType: row.title_type,
    date: {
      display: row.date_display, startSort: row.date_start_sort, endSort: row.date_end_sort,
      certainty: row.date_certainty,
    },
    creatorDisplay: row.creator_display, extentDisplay: row.extent_display,
    scopeContent: row.scope_content, arrangement: row.arrangement,
    administrativeBiographicalHistory: row.administrative_biographical_history,
    custodialHistory: row.custodial_history, acquisitionInfo: row.acquisition_info,
    accessConditions: row.access_conditions, reproductionConditions: row.reproduction_conditions,
    languageCodes: parseArray(row.language_codes_json), scriptCodes: parseArray(row.script_codes_json),
    physicalCharacteristics: row.physical_characteristics, findingAids: row.finding_aids,
    relatedUnits: row.related_units, sourceCatalogUrl: row.source_catalog_url,
    position: row.position, metadata: parseObject(row.metadata_json),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export type ArchiveUnitCreateInput = Pick<ArchiveDescriptionUnit, 'title' | 'level'> &
  Partial<Omit<ArchiveDescriptionUnit, 'unitId' | 'title' | 'level' | 'createdAt' | 'updatedAt'>>;

export function createArchiveUnit(input: ArchiveUnitCreateInput): ArchiveDescriptionUnit {
  const unitId = id('adu');
  const ts = now();
  const date = input.date ?? { display: null, startSort: null, endSort: null, certainty: 'unknown' as const };
  const unit: ArchiveDescriptionUnit = {
    unitId, repositoryId: input.repositoryId ?? null, parentUnitId: input.parentUnitId ?? null,
    level: input.level, localLevelLabel: input.localLevelLabel ?? null,
    referenceCode: input.referenceCode ?? null, title: input.title.trim() || 'Sin título',
    titleType: input.titleType ?? 'unknown', date,
    creatorDisplay: input.creatorDisplay ?? null, extentDisplay: input.extentDisplay ?? null,
    scopeContent: input.scopeContent ?? null, arrangement: input.arrangement ?? null,
    administrativeBiographicalHistory: input.administrativeBiographicalHistory ?? null,
    custodialHistory: input.custodialHistory ?? null, acquisitionInfo: input.acquisitionInfo ?? null,
    accessConditions: input.accessConditions ?? null, reproductionConditions: input.reproductionConditions ?? null,
    languageCodes: input.languageCodes ?? [], scriptCodes: input.scriptCodes ?? [],
    physicalCharacteristics: input.physicalCharacteristics ?? null, findingAids: input.findingAids ?? null,
    relatedUnits: input.relatedUnits ?? null, sourceCatalogUrl: input.sourceCatalogUrl ?? null,
    position: input.position ?? 0, metadata: input.metadata ?? {}, createdAt: ts, updatedAt: ts,
  };
  const prospective = [...listArchiveUnits(), unit];
  const issues = validateArchiveHierarchy(prospective).filter((issue) => issue.unitId === unitId);
  if (issues.length) throw new Error(`Jerarquía archivística no válida: ${issues[0].code}`);
  getDb().prepare(
    `INSERT INTO archive_description_units (
      unit_id, repository_id, parent_unit_id, level, local_level_label, reference_code,
      title, title_type, date_display, date_start_sort, date_end_sort, date_certainty,
      creator_display, extent_display, scope_content, arrangement,
      administrative_biographical_history, custodial_history, acquisition_info,
      access_conditions, reproduction_conditions, language_codes_json, script_codes_json,
      physical_characteristics, finding_aids, related_units, source_catalog_url, position,
      metadata_json, created_at, updated_at
    ) VALUES (${Array.from({ length: 31 }, () => '?').join(',')})`
  ).run(
    unit.unitId, unit.repositoryId, unit.parentUnitId, unit.level, unit.localLevelLabel,
    unit.referenceCode, unit.title, unit.titleType, unit.date.display, unit.date.startSort,
    unit.date.endSort, unit.date.certainty, unit.creatorDisplay, unit.extentDisplay,
    unit.scopeContent, unit.arrangement, unit.administrativeBiographicalHistory,
    unit.custodialHistory, unit.acquisitionInfo, unit.accessConditions,
    unit.reproductionConditions, arrayJson(unit.languageCodes), arrayJson(unit.scriptCodes),
    unit.physicalCharacteristics, unit.findingAids, unit.relatedUnits, unit.sourceCatalogUrl,
    unit.position, json(unit.metadata), unit.createdAt, unit.updatedAt
  );
  return getArchiveUnit(unitId)!;
}

export function getArchiveUnit(unitId: string): ArchiveDescriptionUnit | null {
  const row = getDb().prepare('SELECT * FROM archive_description_units WHERE unit_id = ?').get(unitId) as UnitRow | undefined;
  return row ? unitFromRow(row) : null;
}

export function listArchiveUnits(options: { repositoryId?: string | null; parentUnitId?: string | null } = {}): ArchiveDescriptionUnit[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options.repositoryId !== undefined) {
    clauses.push(options.repositoryId === null ? 'repository_id IS NULL' : 'repository_id = ?');
    if (options.repositoryId !== null) params.push(options.repositoryId);
  }
  if (options.parentUnitId !== undefined) {
    clauses.push(options.parentUnitId === null ? 'parent_unit_id IS NULL' : 'parent_unit_id = ?');
    if (options.parentUnitId !== null) params.push(options.parentUnitId);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  return (getDb().prepare(`SELECT * FROM archive_description_units${where} ORDER BY parent_unit_id, position, title COLLATE NOCASE`).all(...params) as UnitRow[])
    .map(unitFromRow);
}

export function listArchiveUnitsByIds(unitIds: string[]): ArchiveDescriptionUnit[] {
  const ids = [...new Set(unitIds)].slice(0, 2_000);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = getDb().prepare(
    `SELECT * FROM archive_description_units
     WHERE unit_id IN (${placeholders})`
  ).all(...ids) as UnitRow[];
  const byId = new Map(rows.map((row) => [row.unit_id, unitFromRow(row)]));
  return ids.map((unitId) => byId.get(unitId))
    .filter((unit): unit is ArchiveDescriptionUnit => Boolean(unit));
}

export function updateArchiveUnit(unitId: string, patch: Partial<ArchiveUnitCreateInput>): ArchiveDescriptionUnit | null {
  const current = getArchiveUnit(unitId);
  if (!current) return null;
  const next: ArchiveDescriptionUnit = {
    ...current, ...patch,
    date: patch.date ? { ...current.date, ...patch.date } : current.date,
    title: patch.title?.trim() || current.title,
    updatedAt: now(),
  };
  const prospective = listArchiveUnits().map((unit) => unit.unitId === unitId ? next : unit);
  const issues = validateArchiveHierarchy(prospective).filter((issue) => issue.unitId === unitId);
  if (issues.length) throw new Error(`Jerarquía archivística no válida: ${issues[0].code}`);
  getDb().prepare(
    `UPDATE archive_description_units SET repository_id=?, parent_unit_id=?, level=?,
      local_level_label=?, reference_code=?, title=?, title_type=?, date_display=?,
      date_start_sort=?, date_end_sort=?, date_certainty=?, creator_display=?, extent_display=?,
      scope_content=?, arrangement=?, administrative_biographical_history=?, custodial_history=?,
      acquisition_info=?, access_conditions=?, reproduction_conditions=?, language_codes_json=?,
      script_codes_json=?, physical_characteristics=?, finding_aids=?, related_units=?,
      source_catalog_url=?, position=?, metadata_json=?, updated_at=? WHERE unit_id=?`
  ).run(
    next.repositoryId, next.parentUnitId, next.level, next.localLevelLabel, next.referenceCode,
    next.title, next.titleType, next.date.display, next.date.startSort, next.date.endSort,
    next.date.certainty, next.creatorDisplay, next.extentDisplay, next.scopeContent,
    next.arrangement, next.administrativeBiographicalHistory, next.custodialHistory,
    next.acquisitionInfo, next.accessConditions, next.reproductionConditions,
    arrayJson(next.languageCodes), arrayJson(next.scriptCodes), next.physicalCharacteristics,
    next.findingAids, next.relatedUnits, next.sourceCatalogUrl, next.position,
    json(next.metadata), next.updatedAt, unitId
  );
  return getArchiveUnit(unitId);
}

export function moveArchiveUnit(unitId: string, parentUnitId: string | null, position: number): ArchiveDescriptionUnit | null {
  const db = getDb();
  const tx = db.transaction(() => updateArchiveUnit(unitId, { parentUnitId, position }));
  return tx();
}

export function deleteArchiveUnit(unitId: string): void {
  const db = getDb();
  const descendants = db.prepare('SELECT 1 FROM archive_description_units WHERE parent_unit_id = ? LIMIT 1').get(unitId);
  if (descendants) throw new Error('La unidad tiene descendientes y no puede eliminarse sin reasignarlos.');
  db.prepare('DELETE FROM archive_description_units WHERE unit_id = ?').run(unitId);
}

type SessionRow = {
  session_id: string; repository_id: string | null; title: string; session_kind: ArchiveCaptureSession['sessionKind'];
  started_on: string | null; ended_on: string | null; researcher: string | null; device: string | null;
  fonds_scope: string | null; reference_scope: string | null; reproduction_terms: string | null;
  naming_pattern: string | null; notes: string | null; created_at: string; updated_at: string;
};

const sessionFromRow = (row: SessionRow): ArchiveCaptureSession => ({
  sessionId: row.session_id, repositoryId: row.repository_id, title: row.title,
  sessionKind: row.session_kind, startedOn: row.started_on, endedOn: row.ended_on,
  researcher: row.researcher, device: row.device, fondsScope: row.fonds_scope,
  referenceScope: row.reference_scope, reproductionTerms: row.reproduction_terms,
  namingPattern: row.naming_pattern, notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at,
});

export function createCaptureSession(
  input: Pick<ArchiveCaptureSession, 'title'> & Partial<Omit<ArchiveCaptureSession, 'sessionId' | 'title' | 'createdAt' | 'updatedAt'>>
): ArchiveCaptureSession {
  const sessionId = id('acs');
  const ts = now();
  getDb().prepare(
    `INSERT INTO archive_capture_sessions (
      session_id, repository_id, title, session_kind, started_on, ended_on, researcher,
      device, fonds_scope, reference_scope, reproduction_terms, naming_pattern, notes,
      created_at, updated_at
    ) VALUES (${Array.from({ length: 15 }, () => '?').join(',')})`
  ).run(
    sessionId, input.repositoryId ?? null, input.title.trim(), input.sessionKind ?? 'other',
    input.startedOn ?? null, input.endedOn ?? null, input.researcher ?? null,
    input.device ?? null, input.fondsScope ?? null, input.referenceScope ?? null,
    input.reproductionTerms ?? null, input.namingPattern ?? null, input.notes ?? null, ts, ts
  );
  const row = getDb().prepare('SELECT * FROM archive_capture_sessions WHERE session_id=?').get(sessionId) as SessionRow;
  return sessionFromRow(row);
}

export function listCaptureSessions(): ArchiveCaptureSession[] {
  return (getDb().prepare('SELECT * FROM archive_capture_sessions ORDER BY started_on DESC, created_at DESC').all() as SessionRow[])
    .map(sessionFromRow);
}
