import crypto from 'node:crypto';
import { v4 as uuid } from 'uuid';
import type {
  ProsopCaptureBatch,
  ProsopCaptureRow,
  ProsopCaptureTemplate,
  ProsopSourcesWorkspace,
} from '@shared/prosopography';
import { parseProsopDelimited } from '@shared/prosopographyCapture';
import { getDb } from './database';
import { ensureProsopStudy } from './prosopStudyRepo';
import { listProsopSources } from './prosopSourcesRepo';

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${uuid()}`;

function template(row: Record<string, unknown>): ProsopCaptureTemplate {
  return { templateId: String(row.template_id), studyId: String(row.study_id), name: String(row.name),
    sourceKind: String(row.source_kind), questionnaireVersionId: row.questionnaire_version_id == null ? null : String(row.questionnaire_version_id),
    fields: JSON.parse(String(row.fields_json ?? '[]')), mapping: JSON.parse(String(row.mapping_json ?? '{}')),
    version: Number(row.version), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function batch(row: Record<string, unknown>): ProsopCaptureBatch {
  return { batchId: String(row.batch_id), sourceId: row.source_id == null ? null : String(row.source_id),
    templateId: row.template_id == null ? null : String(row.template_id), questionnaireVersionId: row.questionnaire_version_id == null ? null : String(row.questionnaire_version_id),
    fileName: String(row.file_name), contentHash: String(row.content_hash), status: row.status as ProsopCaptureBatch['status'],
    rowCount: Number(row.row_count), acceptedCount: Number(row.accepted_count), errorCount: Number(row.error_count),
    createdBy: String(row.created_by), createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
}
function captureRow(row: Record<string, unknown>): ProsopCaptureRow {
  return { captureRowId: String(row.capture_row_id), batchId: String(row.batch_id), rowNo: Number(row.row_no),
    locatorDisplay: row.locator_display == null ? null : String(row.locator_display), raw: JSON.parse(String(row.raw_json)),
    status: row.status as ProsopCaptureRow['status'], error: row.error_json ? JSON.parse(String(row.error_json)) : null,
    createdAt: String(row.created_at), reviewedAt: row.reviewed_at == null ? null : String(row.reviewed_at) };
}

export function listProsopTemplates(): ProsopCaptureTemplate[] {
  return (getDb().prepare('SELECT * FROM prosop_capture_templates ORDER BY name').all() as Record<string, unknown>[]).map(template);
}
export function listProsopBatches(): Array<ProsopCaptureBatch & { rows: ProsopCaptureRow[] }> {
  const db = getDb();
  return (db.prepare('SELECT * FROM prosop_capture_batches ORDER BY created_at DESC').all() as Record<string, unknown>[]).map(batch).map((item) => ({
    ...item, rows: (db.prepare('SELECT * FROM prosop_capture_rows WHERE batch_id=? ORDER BY row_no').all(item.batchId) as Record<string, unknown>[]).map(captureRow),
  }));
}
export function getProsopSourcesWorkspace(): ProsopSourcesWorkspace {
  return { sources: listProsopSources(), templates: listProsopTemplates(), batches: listProsopBatches() };
}

export function saveProsopCaptureTemplate(input: Partial<ProsopCaptureTemplate> & { name: string; sourceKind: string }): ProsopCaptureTemplate {
  if (!input.name.trim()) throw new Error('La plantilla necesita un nombre.');
  const study = ensureProsopStudy(); const ts = now(); const templateId = input.templateId ?? id('pct');
  getDb().prepare(
    `INSERT INTO prosop_capture_templates
     (template_id,study_id,name,source_kind,questionnaire_version_id,fields_json,mapping_json,version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(template_id) DO UPDATE SET name=excluded.name,source_kind=excluded.source_kind,
      questionnaire_version_id=excluded.questionnaire_version_id,fields_json=excluded.fields_json,
      mapping_json=excluded.mapping_json,version=excluded.version,updated_at=excluded.updated_at`
  ).run(templateId,study.studyId,input.name.trim(),input.sourceKind,input.questionnaireVersionId ?? study.currentQuestionnaireVersionId,
    JSON.stringify(input.fields ?? []),JSON.stringify(input.mapping ?? {}),input.version ?? 1,input.createdAt ?? ts,ts);
  return listProsopTemplates().find((item) => item.templateId === templateId)!;
}

export function importProsopDelimited(input: {
  sourceId?: string | null; templateId?: string | null; fileName: string; text: string;
  locatorColumn?: string | null; createdBy?: string;
}): ProsopCaptureBatch & { rows: ProsopCaptureRow[] } {
  if (input.text.length > 25_000_000) throw new Error('El archivo supera el límite de 25 MB.');
  const parsed = parseProsopDelimited(input.text);
  if (!parsed.headers.length) throw new Error('El archivo no contiene encabezados.');
  if (parsed.rows.length > 100_000) throw new Error('El lote supera el límite de 100 000 filas.');
  const hash = crypto.createHash('sha256').update(input.text).digest('hex');
  const db = getDb(); const study = ensureProsopStudy(); const ts = now(); const batchId = id('pcb');
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO prosop_capture_batches
       (batch_id,source_id,template_id,questionnaire_version_id,file_name,content_hash,status,row_count,
        accepted_count,error_count,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,'staging',?,0,0,?,?,?)`
    ).run(batchId,input.sourceId ?? null,input.templateId ?? null,study.currentQuestionnaireVersionId,
      input.fileName,hash,parsed.rows.length,input.createdBy ?? 'human',ts,ts);
    const insert = db.prepare(
      `INSERT INTO prosop_capture_rows
       (capture_row_id,batch_id,row_no,locator_display,raw_json,status,created_at)
       VALUES (?,?,?,?,?,'pending',?)`
    );
    parsed.rows.forEach((row, index) => insert.run(id('pcrw'),batchId,index + 2,input.locatorColumn ? String(row[input.locatorColumn] ?? '') : null,JSON.stringify(row),ts));
  });
  run();
  return listProsopBatches().find((item) => item.batchId === batchId)!;
}

export function reviewProsopCaptureRow(captureRowId: string, status: 'accepted' | 'rejected'): ProsopCaptureRow {
  const db = getDb(); const ts = now();
  const row = db.prepare('SELECT batch_id FROM prosop_capture_rows WHERE capture_row_id=?').get(captureRowId) as { batch_id: string } | undefined;
  if (!row) throw new Error('Fila de captura no encontrada.');
  const run = db.transaction(() => {
    db.prepare('UPDATE prosop_capture_rows SET status=?, reviewed_at=? WHERE capture_row_id=?').run(status,ts,captureRowId);
    db.prepare(
      `UPDATE prosop_capture_batches SET
       accepted_count=(SELECT COUNT(*) FROM prosop_capture_rows WHERE batch_id=? AND status='accepted'),
       error_count=(SELECT COUNT(*) FROM prosop_capture_rows WHERE batch_id=? AND status='error'),
       updated_at=? WHERE batch_id=?`
    ).run(row.batch_id,row.batch_id,ts,row.batch_id);
  });
  run();
  return listProsopBatches().flatMap((item) => item.rows).find((item) => item.captureRowId === captureRowId)!;
}
