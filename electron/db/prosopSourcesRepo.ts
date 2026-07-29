import { v4 as uuid } from 'uuid';
import type {
  ProsopSource,
  ProsopSourceInput,
  ProsopSourceSegment,
  ProsopSourceSegmentInput,
} from '@shared/prosopography';
import { getDb } from './database';

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${uuid()}`;

function source(row: Record<string, unknown>): ProsopSource {
  return {
    sourceId: String(row.source_id), title: String(row.title), sourceKind: String(row.source_kind),
    citation: String(row.citation ?? ''), repository: String(row.repository ?? ''),
    referenceCode: String(row.reference_code ?? ''),
    date: { display: row.date_display == null ? null : String(row.date_display), startSort: row.date_start_sort == null ? null : Number(row.date_start_sort), endSort: row.date_end_sort == null ? null : Number(row.date_end_sort) },
    description: String(row.description ?? ''), coverageNotes: String(row.coverage_notes ?? ''),
    reliabilityNotes: String(row.reliability_notes ?? ''), accessStatus: row.access_status as ProsopSource['accessStatus'],
    rightsNotes: String(row.rights_notes ?? ''), targetVaultId: row.target_vault_id == null ? null : String(row.target_vault_id),
    targetKind: row.target_kind as ProsopSource['targetKind'], targetId: row.target_id == null ? null : String(row.target_id),
    targetLabelSnapshot: row.target_label_snapshot == null ? null : String(row.target_label_snapshot),
    url: row.url == null ? null : String(row.url), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function segment(row: Record<string, unknown>): ProsopSourceSegment {
  return {
    segmentId: String(row.segment_id), sourceId: String(row.source_id), locatorDisplay: String(row.locator_display),
    locator: JSON.parse(String(row.locator_json ?? '{}')), quotedText: String(row.quoted_text ?? ''),
    transcriptionStatus: row.transcription_status as ProsopSourceSegment['transcriptionStatus'],
    language: String(row.language ?? ''), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

export function listProsopSources(): Array<ProsopSource & { segments: ProsopSourceSegment[]; factoidCount: number }> {
  const db = getDb();
  return (db.prepare('SELECT * FROM prosop_sources ORDER BY title').all() as Record<string, unknown>[]).map(source).map((item) => ({
    ...item,
    segments: (db.prepare('SELECT * FROM prosop_source_segments WHERE source_id=? ORDER BY created_at').all(item.sourceId) as Record<string, unknown>[]).map(segment),
    factoidCount: Number((db.prepare('SELECT COUNT(*) AS count FROM prosop_factoids WHERE source_id=?').get(item.sourceId) as { count: number }).count),
  }));
}

export function saveProsopSource(input: ProsopSourceInput): ProsopSource {
  if (!input.title.trim() || !input.sourceKind.trim()) throw new Error('La fuente necesita título y tipo.');
  const ts = now();
  const sourceId = input.sourceId ?? id('psr');
  getDb().prepare(
    `INSERT INTO prosop_sources
     (source_id,title,source_kind,citation,repository,reference_code,date_display,date_start_sort,date_end_sort,
      description,coverage_notes,reliability_notes,access_status,rights_notes,target_vault_id,target_kind,
      target_id,target_label_snapshot,url,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(source_id) DO UPDATE SET title=excluded.title,source_kind=excluded.source_kind,
      citation=excluded.citation,repository=excluded.repository,reference_code=excluded.reference_code,
      date_display=excluded.date_display,date_start_sort=excluded.date_start_sort,date_end_sort=excluded.date_end_sort,
      description=excluded.description,coverage_notes=excluded.coverage_notes,reliability_notes=excluded.reliability_notes,
      access_status=excluded.access_status,rights_notes=excluded.rights_notes,target_vault_id=excluded.target_vault_id,
      target_kind=excluded.target_kind,target_id=excluded.target_id,target_label_snapshot=excluded.target_label_snapshot,
      url=excluded.url,updated_at=excluded.updated_at`
  ).run(
    sourceId,input.title.trim(),input.sourceKind.trim(),input.citation ?? '',input.repository ?? '',input.referenceCode ?? '',
    input.date?.display ?? null,input.date?.startSort ?? null,input.date?.endSort ?? null,input.description ?? '',
    input.coverageNotes ?? '',input.reliabilityNotes ?? '',input.accessStatus ?? 'open',input.rightsNotes ?? '',
    input.targetVaultId ?? null,input.targetKind ?? null,input.targetId ?? null,input.targetLabelSnapshot ?? null,
    input.url ?? null,ts,ts
  );
  return listProsopSources().find((item) => item.sourceId === sourceId)!;
}

export function deleteProsopSource(sourceId: string): void {
  const db = getDb();
  const counts = {
    factoids: Number((db.prepare('SELECT COUNT(*) AS c FROM prosop_factoids WHERE source_id=?').get(sourceId) as { c: number }).c),
    batches: Number((db.prepare('SELECT COUNT(*) AS c FROM prosop_capture_batches WHERE source_id=?').get(sourceId) as { c: number }).c),
  };
  if (counts.factoids || counts.batches) throw new Error('La fuente tiene observaciones o lotes; archívala en vez de eliminarla.');
  const run = db.transaction(() => {
    db.prepare('DELETE FROM prosop_source_segments WHERE source_id=?').run(sourceId);
    db.prepare('DELETE FROM prosop_sources WHERE source_id=?').run(sourceId);
  });
  run();
}

export function saveProsopSourceSegment(input: ProsopSourceSegmentInput): ProsopSourceSegment {
  if (!input.locatorDisplay.trim()) throw new Error('El segmento necesita un localizador.');
  const ts = now();
  const segmentId = input.segmentId ?? id('psg');
  getDb().prepare(
    `INSERT INTO prosop_source_segments
     (segment_id,source_id,locator_display,locator_json,quoted_text,transcription_status,language,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(segment_id) DO UPDATE SET locator_display=excluded.locator_display,
      locator_json=excluded.locator_json,quoted_text=excluded.quoted_text,
      transcription_status=excluded.transcription_status,language=excluded.language,updated_at=excluded.updated_at`
  ).run(segmentId,input.sourceId,input.locatorDisplay.trim(),JSON.stringify(input.locator ?? {}),input.quotedText ?? '',
    input.transcriptionStatus ?? 'literal',input.language ?? '',ts,ts);
  return listProsopSources().flatMap((item) => item.segments).find((item) => item.segmentId === segmentId)!;
}
