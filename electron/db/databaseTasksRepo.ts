import { randomUUID } from 'node:crypto';
import { getDb } from './database';
import {
  addRelation,
  createRow,
  getColumn,
  getColumns,
  getRow,
  setCell,
} from './databasesRepo';
import { getPageDocumentForRow, savePageDocument } from './pagesRepo';
import { decodeDatabaseDate, encodeDatabaseDate, isReadOnlyDatabaseProperty } from '@shared/databaseProperties';
import {
  databaseTemplateOccurrenceKey,
  nextDatabaseTemplateRun,
  shiftTaskDate,
  type CreateDatabaseRowTemplateInput,
  type DatabaseDuplicateRowInput,
  type DatabaseRowDependency,
  type DatabaseRowHierarchyItem,
  type DatabaseRowTemplate,
  type DatabaseSprint,
  type DatabaseSprintState,
  type DatabaseTaskConfig,
  type DatabaseTaskDateChange,
  type DatabaseTemplateInstantiation,
  type DatabaseTemplateRecurrence,
} from '@shared/databaseTasks';
import type { PageBlockDraft } from '@shared/pages';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
const json = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

function template(row: Row): DatabaseRowTemplate {
  return {
    id: String(row.id), databaseId: String(row.database_id), name: String(row.name),
    icon: row.icon == null ? null : String(row.icon), coverBlobHash: row.cover_blob_hash == null ? null : String(row.cover_blob_hash),
    properties: json(row.properties_json, {}), blocks: json(row.blocks_json, []), defaultRelations: json(row.default_relations_json, []),
    recurrence: String(row.recurrence) as DatabaseTemplateRecurrence, timeZone: String(row.time_zone),
    nextRunAt: row.next_run_at == null ? null : String(row.next_run_at), revision: Number(row.revision),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function validateDatabase(databaseId: string): void {
  if (!getDb().prepare('SELECT 1 FROM db_databases WHERE id = ?').get(databaseId)) throw new Error('Base de datos no encontrada.');
}

function assertTemplateInput(databaseId: string, input: CreateDatabaseRowTemplateInput): void {
  if (!input?.name?.trim()) throw new Error('La plantilla necesita un nombre.');
  const recurrence = input.recurrence ?? 'none';
  if (!['none', 'daily', 'weekly', 'monthly', 'yearly'].includes(recurrence)) throw new Error('Recurrencia de plantilla no válida.');
  if (recurrence !== 'none' && (!input.nextRunAt || !Number.isFinite(Date.parse(input.nextRunAt)))) {
    throw new Error('Una plantilla recurrente necesita su próxima ejecución.');
  }
  const columns = new Map(getColumns(databaseId).map((column) => [column.id, column]));
  for (const [columnId] of Object.entries(input.properties ?? {})) {
    const column = columns.get(columnId);
    if (!column) throw new Error('La plantilla contiene una propiedad de otra base de datos.');
    if (isReadOnlyDatabaseProperty(column.type)) throw new Error('La plantilla no puede fijar propiedades automáticas.');
  }
  for (const relation of input.defaultRelations ?? []) {
    const column = columns.get(relation.columnId);
    if (!column || column.type !== 'relation') throw new Error('La plantilla contiene una relación predeterminada no válida.');
  }
  if ((input.blocks?.length ?? 0) > 10_000) throw new Error('La plantilla supera el límite de 10.000 bloques.');
}

export function listDatabaseRowTemplates(databaseId: string): DatabaseRowTemplate[] {
  return (getDb().prepare('SELECT * FROM db_row_templates WHERE database_id = ? ORDER BY name COLLATE NOCASE, id').all(databaseId) as Row[]).map(template);
}

export function createDatabaseRowTemplate(databaseId: string, input: CreateDatabaseRowTemplateInput): DatabaseRowTemplate {
  validateDatabase(databaseId); assertTemplateInput(databaseId, input);
  const key = id('dtpl'); const timestamp = now();
  getDb().prepare(
    `INSERT INTO db_row_templates
      (id, database_id, name, icon, cover_blob_hash, properties_json, blocks_json, default_relations_json,
       recurrence, time_zone, next_run_at, revision, created_by, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'local', 'local', ?, ?)`,
  ).run(key, databaseId, input.name.trim(), input.icon ?? null, input.coverBlobHash ?? null,
    JSON.stringify(input.properties ?? {}), JSON.stringify(input.blocks ?? []), JSON.stringify(input.defaultRelations ?? []),
    input.recurrence ?? 'none', input.timeZone?.trim() || 'UTC', input.nextRunAt ?? null, timestamp, timestamp);
  return template(getDb().prepare('SELECT * FROM db_row_templates WHERE id = ?').get(key) as Row);
}

export function deleteDatabaseRowTemplate(templateId: string): void {
  getDb().prepare('DELETE FROM db_row_templates WHERE id = ?').run(templateId);
}

function freshBlocks(blocks: PageBlockDraft[]): PageBlockDraft[] {
  const remap = new Map<string, string>();
  for (const block of blocks) if (block.id) remap.set(block.id, id('pblk'));
  return blocks.map((block) => ({
    ...block,
    id: block.id ? remap.get(block.id) : undefined,
    parentBlockId: block.parentBlockId ? remap.get(block.parentBlockId) ?? null : null,
    content: structuredClone(block.content ?? {}),
  }));
}

function instantiate(templateValue: DatabaseRowTemplate, occurrenceKey: string | null, scheduledAt: string | null): DatabaseTemplateInstantiation {
  const db = getDb();
  if (occurrenceKey) {
    const prior = db.prepare('SELECT row_id FROM db_template_runs WHERE template_id = ? AND occurrence_key = ?').get(templateValue.id, occurrenceKey) as { row_id: string } | undefined;
    if (prior) return { templateId: templateValue.id, rowId: prior.row_id, pageId: `row:${prior.row_id}`, occurrenceKey, created: false };
  }
  const row = createRow(templateValue.databaseId);
  for (const [columnId, value] of Object.entries(templateValue.properties)) setCell(row.id, columnId, value);
  for (const relation of templateValue.defaultRelations) addRelation(row.id, relation.columnId, relation.targetKind, relation.targetId, relation.targetVaultId ?? null);
  const document = getPageDocumentForRow(row.id);
  if (!document) throw new Error('No se pudo crear la página universal de la plantilla.');
  if (templateValue.blocks.length) {
    const saved = savePageDocument({ pageId: document.page.id, expectedRevision: document.revision, blocks: freshBlocks(templateValue.blocks), reason: 'template' });
    if (!saved.ok) throw new Error('La página de plantilla produjo un conflicto inesperado.');
  }
  if (templateValue.icon || templateValue.coverBlobHash) db.prepare(
    "UPDATE pages SET icon = ?, cover_blob_hash = ?, revision = revision + 1, updated_by = 'local', updated_at = ? WHERE id = ?",
  ).run(templateValue.icon, templateValue.coverBlobHash, now(), document.page.id);
  if (occurrenceKey) db.prepare(
    'INSERT INTO db_template_runs (template_id, occurrence_key, row_id, scheduled_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(templateValue.id, occurrenceKey, row.id, scheduledAt ?? now(), now());
  return { templateId: templateValue.id, rowId: row.id, pageId: document.page.id, occurrenceKey, created: true };
}

export function instantiateDatabaseRowTemplate(templateId: string, occurrenceKey: string | null = null): DatabaseTemplateInstantiation {
  const db = getDb(); const row = db.prepare('SELECT * FROM db_row_templates WHERE id = ?').get(templateId) as Row | undefined;
  if (!row) throw new Error('Plantilla no encontrada.');
  return db.transaction(() => instantiate(template(row), occurrenceKey, null))();
}

export function runDueDatabaseRowTemplates(at = now(), limit = 100): DatabaseTemplateInstantiation[] {
  if (!Number.isFinite(Date.parse(at))) throw new Error('La fecha de ejecución no es válida.');
  const db = getDb(); const due = db.prepare(
    `SELECT * FROM db_row_templates WHERE recurrence <> 'none' AND next_run_at IS NOT NULL AND next_run_at <= ?
     ORDER BY next_run_at, id LIMIT ?`,
  ).all(at, Math.max(1, Math.min(500, Math.trunc(limit)))) as Row[];
  return due.map((row) => db.transaction(() => {
    const value = template(row); const scheduledAt = value.nextRunAt!;
    const result = instantiate(value, databaseTemplateOccurrenceKey(value.id, scheduledAt), scheduledAt);
    db.prepare("UPDATE db_row_templates SET next_run_at = ?, revision = revision + 1, updated_by = 'scheduler', updated_at = ? WHERE id = ?")
      .run(nextDatabaseTemplateRun(scheduledAt, value.recurrence, value.timeZone), now(), value.id);
    return result;
  })());
}

function rowMeta(rowId: string): { id: string; database_id: string } {
  const row = getDb().prepare('SELECT id, database_id FROM db_rows WHERE id = ?').get(rowId) as { id: string; database_id: string } | undefined;
  if (!row) throw new Error('Fila no encontrada.');
  return row;
}

export function setDatabaseSubitemParent(rowId: string, parentRowId: string | null): void {
  const db = getDb(); const row = rowMeta(rowId);
  if (parentRowId) {
    const parent = rowMeta(parentRowId);
    if (parent.database_id !== row.database_id) throw new Error('Un subitem sólo puede depender de una fila de la misma base.');
    const cycle = db.prepare(
      `WITH RECURSIVE ancestors(row_id) AS (
         SELECT ? UNION ALL SELECT hierarchy.parent_row_id FROM db_row_hierarchy hierarchy JOIN ancestors ON hierarchy.row_id = ancestors.row_id
         WHERE hierarchy.database_id = ? AND hierarchy.parent_row_id IS NOT NULL
       ) SELECT 1 FROM ancestors WHERE row_id = ? LIMIT 1`,
    ).get(parentRowId, row.database_id, rowId);
    if (cycle) throw new Error('La jerarquía de subitems produciría un ciclo.');
  }
  const timestamp = now(); const order = Number((db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) + 1024 AS value FROM db_row_hierarchy WHERE database_id = ? AND parent_row_id IS ?',
  ).get(row.database_id, parentRowId) as { value: number }).value);
  db.prepare(
    `INSERT INTO db_row_hierarchy (database_id, row_id, parent_row_id, sort_order, collapsed, revision, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 1, 'local', ?, ?)
     ON CONFLICT(database_id, row_id) DO UPDATE SET parent_row_id=excluded.parent_row_id, sort_order=excluded.sort_order,
       revision=db_row_hierarchy.revision+1, updated_by='local', updated_at=excluded.updated_at`,
  ).run(row.database_id, rowId, parentRowId, order, timestamp, timestamp);
}

export function setDatabaseSubitemCollapsed(rowId: string, collapsed: boolean): void {
  const row = rowMeta(rowId); const timestamp = now();
  getDb().prepare(
    `INSERT INTO db_row_hierarchy (database_id, row_id, parent_row_id, sort_order, collapsed, revision, updated_by, created_at, updated_at)
     VALUES (?, ?, NULL, 1024, ?, 1, 'local', ?, ?)
     ON CONFLICT(database_id,row_id) DO UPDATE SET collapsed=excluded.collapsed, revision=db_row_hierarchy.revision+1,
       updated_by='local', updated_at=excluded.updated_at`,
  ).run(row.database_id, rowId, Number(collapsed), timestamp, timestamp);
}

export function listDatabaseRowHierarchy(databaseId: string, limit = 500): DatabaseRowHierarchyItem[] {
  validateDatabase(databaseId); const columns = getColumns(databaseId); const title = columns.find((column) => column.type === 'title');
  const rows = getDb().prepare(
    `SELECT row.id, hierarchy.parent_row_id, COALESCE(hierarchy.sort_order, row.position * 1024) AS sort_order,
            COALESCE(hierarchy.collapsed, 0) AS collapsed, COALESCE(hierarchy.revision, 1) AS revision,
            COALESCE(cell.value_text, '') AS title
     FROM db_rows row LEFT JOIN db_row_hierarchy hierarchy ON hierarchy.database_id=row.database_id AND hierarchy.row_id=row.id
     LEFT JOIN db_cells cell ON cell.database_id=row.database_id AND cell.row_id=row.id AND cell.column_id=?
     WHERE row.database_id=? ORDER BY row.position, row.id LIMIT ?`,
  ).all(title?.id ?? '', databaseId, Math.max(1, Math.min(500, Math.trunc(limit)))) as Row[];
  const byId = new Map(rows.map((entry) => [String(entry.id), entry]));
  const depth = (entry: Row) => { let value = 0; let parent = entry.parent_row_id == null ? null : String(entry.parent_row_id); const seen = new Set<string>();
    while (parent && byId.has(parent) && !seen.has(parent)) { seen.add(parent); value += 1; parent = byId.get(parent)!.parent_row_id == null ? null : String(byId.get(parent)!.parent_row_id); }
    return value; };
  return rows.map((entry) => ({ rowId: String(entry.id), parentRowId: entry.parent_row_id == null ? null : String(entry.parent_row_id),
    depth: depth(entry), sortOrder: Number(entry.sort_order), collapsed: Number(entry.collapsed) === 1,
    title: String(entry.title), revision: Number(entry.revision) }));
}

function dependency(row: Row): DatabaseRowDependency {
  return { id: String(row.id), databaseId: String(row.database_id), predecessorRowId: String(row.predecessor_row_id),
    successorRowId: String(row.successor_row_id), lagDays: Number(row.lag_days), revision: Number(row.revision),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function listDatabaseRowDependencies(databaseId: string): DatabaseRowDependency[] {
  return (getDb().prepare('SELECT * FROM db_row_dependencies WHERE database_id=? ORDER BY created_at,id LIMIT 500').all(databaseId) as Row[]).map(dependency);
}

export function addDatabaseRowDependency(predecessorRowId: string, successorRowId: string, lagDays = 0): DatabaseRowDependency {
  const db = getDb(); const predecessor = rowMeta(predecessorRowId); const successor = rowMeta(successorRowId);
  if (predecessor.database_id !== successor.database_id) throw new Error('Las dependencias deben pertenecer a la misma base de datos.');
  if (predecessorRowId === successorRowId) throw new Error('Una fila no puede depender de sí misma.');
  const cycle = db.prepare(
    `WITH RECURSIVE reachable(row_id) AS (
       SELECT successor_row_id FROM db_row_dependencies WHERE database_id=? AND predecessor_row_id=?
       UNION SELECT edge.successor_row_id FROM db_row_dependencies edge JOIN reachable prior ON edge.predecessor_row_id=prior.row_id WHERE edge.database_id=?
     ) SELECT 1 FROM reachable WHERE row_id=? LIMIT 1`,
  ).get(predecessor.database_id, successorRowId, predecessor.database_id, predecessorRowId);
  if (cycle) throw new Error('La dependencia produciría un ciclo.');
  const key = id('ddep'); const timestamp = now();
  db.prepare(
    `INSERT INTO db_row_dependencies (id,database_id,predecessor_row_id,successor_row_id,lag_days,revision,created_by,updated_by,created_at,updated_at)
     VALUES (?,?,?,?,?,1,'local','local',?,?)`,
  ).run(key, predecessor.database_id, predecessorRowId, successorRowId, Math.max(-3650, Math.min(3650, Math.trunc(lagDays))), timestamp, timestamp);
  return dependency(db.prepare('SELECT * FROM db_row_dependencies WHERE id=?').get(key) as Row);
}

export function removeDatabaseRowDependency(idValue: string): void { getDb().prepare('DELETE FROM db_row_dependencies WHERE id=?').run(idValue); }

function config(row: Row): DatabaseTaskConfig {
  return { databaseId: String(row.database_id), dateColumnId: row.date_column_id == null ? null : String(row.date_column_id),
    statusColumnId: row.status_column_id == null ? null : String(row.status_column_id), sprintColumnId: row.sprint_column_id == null ? null : String(row.sprint_column_id),
    subitemView: String(row.subitem_view) as DatabaseTaskConfig['subitemView'], avoidWeekends: Number(row.avoid_weekends) === 1,
    shiftDependents: Number(row.shift_dependents) === 1, revision: Number(row.revision), updatedAt: String(row.updated_at) };
}

export function getDatabaseTaskConfig(databaseId: string): DatabaseTaskConfig {
  validateDatabase(databaseId); const db = getDb(); let row = db.prepare('SELECT * FROM db_task_configs WHERE database_id=?').get(databaseId) as Row | undefined;
  if (!row) { const timestamp = now(); db.prepare(
    `INSERT INTO db_task_configs (database_id,date_column_id,status_column_id,sprint_column_id,subitem_view,avoid_weekends,shift_dependents,revision,updated_by,created_at,updated_at)
     VALUES (?,NULL,NULL,NULL,'nested',0,1,1,'local',?,?)`,
  ).run(databaseId, timestamp, timestamp); row = db.prepare('SELECT * FROM db_task_configs WHERE database_id=?').get(databaseId) as Row; }
  return config(row);
}

export function updateDatabaseTaskConfig(databaseId: string, patch: Partial<Omit<DatabaseTaskConfig, 'databaseId' | 'revision' | 'updatedAt'>>): DatabaseTaskConfig {
  const current = getDatabaseTaskConfig(databaseId); const columns = new Map(getColumns(databaseId).map((column) => [column.id, column]));
  const dateColumnId = patch.dateColumnId === undefined ? current.dateColumnId : patch.dateColumnId;
  const statusColumnId = patch.statusColumnId === undefined ? current.statusColumnId : patch.statusColumnId;
  const sprintColumnId = patch.sprintColumnId === undefined ? current.sprintColumnId : patch.sprintColumnId;
  if (dateColumnId && columns.get(dateColumnId)?.type !== 'date') throw new Error('La fecha de tareas debe usar una propiedad Fecha.');
  if (statusColumnId && !['status','select'].includes(columns.get(statusColumnId)?.type ?? '')) throw new Error('El estado de tareas debe usar Status o Select.');
  if (sprintColumnId && !['select','status'].includes(columns.get(sprintColumnId)?.type ?? '')) throw new Error('Los sprints deben usar Status o Select.');
  const timestamp = now();
  getDb().prepare(
    `UPDATE db_task_configs SET date_column_id=?,status_column_id=?,sprint_column_id=?,subitem_view=?,avoid_weekends=?,shift_dependents=?,
       revision=revision+1,updated_by='local',updated_at=? WHERE database_id=?`,
  ).run(dateColumnId, statusColumnId, sprintColumnId, patch.subitemView ?? current.subitemView,
    Number(patch.avoidWeekends ?? current.avoidWeekends), Number(patch.shiftDependents ?? current.shiftDependents), timestamp, databaseId);
  return getDatabaseTaskConfig(databaseId);
}

function shiftEncodedDate(raw: string | null, deltaDays: number, avoidWeekends: boolean): string | null {
  if (!raw) return raw; const value = decodeDatabaseDate(raw); if (!value) return raw;
  const shift = (text: string | null) => { if (!text) return null; const date = new Date(text); if (!Number.isFinite(date.getTime())) return text;
    const shifted = shiftTaskDate(date, deltaDays, avoidWeekends); return text.includes('T') ? shifted.toISOString() : shifted.toISOString().slice(0, 10); };
  return encodeDatabaseDate({ ...value, start: shift(value.start)!, end: shift(value.end ?? null) });
}

export function shiftDatabaseTaskDates(rowId: string, deltaDays: number): DatabaseTaskDateChange[] {
  if (!Number.isFinite(deltaDays) || Math.abs(deltaDays) > 3650) throw new Error('Desplazamiento de fecha no válido.');
  const row = rowMeta(rowId); const taskConfig = getDatabaseTaskConfig(row.database_id);
  if (!taskConfig.dateColumnId) throw new Error('Configura una propiedad Fecha para desplazar tareas.');
  const db = getDb(); const ids = [rowId];
  if (taskConfig.shiftDependents) {
    const dependent = db.prepare(
      `WITH RECURSIVE affected(row_id) AS (
         SELECT successor_row_id FROM db_row_dependencies WHERE database_id=? AND predecessor_row_id=?
         UNION SELECT edge.successor_row_id FROM db_row_dependencies edge JOIN affected prior ON edge.predecessor_row_id=prior.row_id WHERE edge.database_id=?
       ) SELECT DISTINCT row_id FROM affected LIMIT 10000`,
    ).all(row.database_id, rowId, row.database_id) as Array<{ row_id: string }>;
    ids.push(...dependent.map((entry) => entry.row_id));
  }
  return db.transaction(() => ids.map((target) => { const previous = getRow(target)?.cells[taskConfig.dateColumnId!] ?? null;
    const next = shiftEncodedDate(previous, Math.trunc(deltaDays), taskConfig.avoidWeekends); setCell(target, taskConfig.dateColumnId!, next);
    return { rowId: target, previous, next }; }))();
}

function copyAttachments(sourceRowId: string, targetRowId: string, databaseId: string): void {
  const db = getDb(); const rows = db.prepare('SELECT * FROM db_attachments WHERE row_id=? ORDER BY position,id').all(sourceRowId) as Row[];
  const insert = db.prepare(
    `INSERT INTO db_attachments (id,database_id,row_id,column_id,file_name,mime_type,bytes,blob_hash,blob,content_hash,extracted_text,description,
      ai_generated,ai_prompt,thumb,position,revision,created_by,updated_by,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'local','local',?,?)`,
  );
  for (const value of rows) { const timestamp = now(); insert.run(id('datt'), databaseId, targetRowId, value.column_id, value.file_name, value.mime_type,
    value.bytes, value.blob_hash, value.blob, value.content_hash, value.extracted_text, value.description, value.ai_generated, value.ai_prompt, value.thumb, value.position, timestamp, timestamp); }
}

function duplicateOne(sourceRowId: string, includeContent: boolean): string {
  const source = getRow(sourceRowId); if (!source) throw new Error('Fila no encontrada.'); const target = createRow(source.databaseId);
  for (const column of getColumns(source.databaseId)) if (!isReadOnlyDatabaseProperty(column.type) && source.cells[column.id] != null) setCell(target.id, column.id, source.cells[column.id]);
  const relations = getDb().prepare('SELECT column_id,target_kind,target_id,target_vault_id FROM db_relations WHERE row_id=? ORDER BY position').all(sourceRowId) as Row[];
  for (const relation of relations) addRelation(target.id, String(relation.column_id), String(relation.target_kind) as Parameters<typeof addRelation>[2], String(relation.target_id), relation.target_vault_id == null ? null : String(relation.target_vault_id));
  if (includeContent) {
    copyAttachments(sourceRowId, target.id, source.databaseId);
    const sourcePage = getPageDocumentForRow(sourceRowId); const targetPage = getPageDocumentForRow(target.id);
    if (sourcePage && targetPage) {
      const saved = savePageDocument({ pageId: targetPage.page.id, expectedRevision: targetPage.revision, blocks: freshBlocks(sourcePage.blocks), reason: 'duplicate' });
      if (!saved.ok) throw new Error('El duplicado de página produjo un conflicto inesperado.');
      getDb().prepare("UPDATE pages SET icon=?,cover_blob_hash=?,revision=revision+1,updated_by='local',updated_at=? WHERE id=?")
        .run(sourcePage.page.icon, sourcePage.page.coverBlobHash, now(), targetPage.page.id);
    }
  }
  return target.id;
}

export function duplicateDatabaseRow(input: DatabaseDuplicateRowInput): DatabaseTemplateInstantiation {
  const source = rowMeta(input.rowId); const db = getDb();
  return db.transaction(() => {
    const root = duplicateOne(input.rowId, input.includeContent); const remap = new Map([[input.rowId, root]]);
    if (input.includeChildren) {
      const descendants = db.prepare(
        `WITH RECURSIVE tree(row_id,parent_row_id,depth) AS (
           SELECT row_id,parent_row_id,1 FROM db_row_hierarchy WHERE database_id=? AND parent_row_id=?
           UNION ALL SELECT child.row_id,child.parent_row_id,tree.depth+1 FROM db_row_hierarchy child JOIN tree ON child.parent_row_id=tree.row_id WHERE child.database_id=?
         ) SELECT row_id,parent_row_id FROM tree ORDER BY depth,row_id LIMIT 10000`,
      ).all(source.database_id, input.rowId, source.database_id) as Array<{ row_id: string; parent_row_id: string }>;
      for (const child of descendants) { const copy = duplicateOne(child.row_id, input.includeContent); remap.set(child.row_id, copy); setDatabaseSubitemParent(copy, remap.get(child.parent_row_id) ?? root); }
    }
    return { templateId: '', rowId: root, pageId: `row:${root}`, occurrenceKey: null, created: true };
  })();
}

function sprint(row: Row): DatabaseSprint {
  return { id: String(row.id), databaseId: String(row.database_id), name: String(row.name), startAt: String(row.start_at), endAt: String(row.end_at),
    state: String(row.state) as DatabaseSprintState, rowCount: Number(row.row_count ?? 0), revision: Number(row.revision),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}

export function listDatabaseSprints(databaseId: string): DatabaseSprint[] {
  return (getDb().prepare(
    `SELECT sprint.*,COUNT(link.row_id) AS row_count FROM db_sprints sprint LEFT JOIN db_sprint_rows link ON link.sprint_id=sprint.id
     WHERE sprint.database_id=? GROUP BY sprint.id ORDER BY sprint.start_at DESC,sprint.id`,
  ).all(databaseId) as Row[]).map(sprint);
}

export function createDatabaseSprint(databaseId: string, input: { name: string; startAt: string; endAt: string }): DatabaseSprint {
  validateDatabase(databaseId); if (!input.name.trim()) throw new Error('El sprint necesita un nombre.');
  if (!Number.isFinite(Date.parse(input.startAt)) || !Number.isFinite(Date.parse(input.endAt)) || input.startAt > input.endAt) throw new Error('El intervalo del sprint no es válido.');
  const key = id('dsprint'); const timestamp = now(); getDb().prepare(
    `INSERT INTO db_sprints (id,database_id,name,start_at,end_at,state,revision,created_by,updated_by,created_at,updated_at)
     VALUES (?,?,?,?,?,'planned',1,'local','local',?,?)`,
  ).run(key, databaseId, input.name.trim(), input.startAt, input.endAt, timestamp, timestamp);
  return listDatabaseSprints(databaseId).find((value) => value.id === key)!;
}

export function updateDatabaseSprintState(sprintId: string, state: DatabaseSprintState): DatabaseSprint {
  if (!['planned','active','completed'].includes(state)) throw new Error('Estado de sprint no válido.'); const db = getDb(); const timestamp = now();
  db.transaction(() => { const current = db.prepare('SELECT database_id FROM db_sprints WHERE id=?').get(sprintId) as { database_id: string } | undefined;
    if (!current) throw new Error('Sprint no encontrado.'); if (state === 'active') db.prepare("UPDATE db_sprints SET state='planned',revision=revision+1,updated_at=? WHERE database_id=? AND state='active' AND id<>?").run(timestamp,current.database_id,sprintId);
    db.prepare("UPDATE db_sprints SET state=?,revision=revision+1,updated_by='local',updated_at=? WHERE id=?").run(state,timestamp,sprintId); })();
  const row = db.prepare(`SELECT sprint.*,(SELECT COUNT(*) FROM db_sprint_rows link WHERE link.sprint_id=sprint.id) AS row_count FROM db_sprints sprint WHERE id=?`).get(sprintId) as Row;
  return sprint(row);
}

export function assignDatabaseRowToSprint(sprintId: string, rowId: string): void {
  const db = getDb(); const sprintRow = db.prepare('SELECT database_id FROM db_sprints WHERE id=?').get(sprintId) as { database_id: string } | undefined;
  const row = rowMeta(rowId); if (!sprintRow || sprintRow.database_id !== row.database_id) throw new Error('La fila y el sprint deben pertenecer a la misma base de datos.');
  db.prepare('INSERT OR IGNORE INTO db_sprint_rows (sprint_id,row_id,created_at) VALUES (?,?,?)').run(sprintId,rowId,now());
}
