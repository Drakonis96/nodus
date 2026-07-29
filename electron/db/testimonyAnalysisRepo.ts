// Códigos, temas y fragmentos codificados del vault de Testimonios.
//
// EL CATÁLOGO ES DEL VAULT; LA CODIFICACIÓN ES DE LA ENTREVISTA. Un código se crea desde
// la transcripción que se está leyendo — que es el único momento en que uno sabe qué
// nombre ponerle — pero se guarda a nivel de bóveda, porque si no Contrastes no tendría
// nada que cruzar. Esa es toda la razón por la que «Temas y códigos» no es una sección:
// el catálogo existe, pero el sitio donde se usa es el texto.
//
// LA DEFENSA CONTRA EL GEMELO es `normalized_label` con UNIQUE. «Posguerra»,
// «posguerra» y «post-guerra » escritas tres noches distintas producen tres códigos que
// no se cruzan entre sí, y el resultado no es un catálogo sucio: es un contraste que
// devuelve menos de lo que hay y no avisa.
//
// Y la regla que atraviesa toda lectura de fragmentos: el hablante sale con el nombre que
// el ACUERDO permite. Un fragmento es lo que se copia y se cita, y es exactamente donde
// un nombre real bajo seudónimo se escaparía.

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import {
  cleanCodeLabel,
  displayNameFor,
  formatShortId,
  isValidCodeLabel,
  normalizeCodeLabel,
} from '@shared/testimonies';
import { effectiveAttribution } from '@shared/testimonyAccess';
import type {
  TestimonyAnnotation,
  TestimonyAnnotationInput,
  TestimonyAnnotationKind,
  TestimonyCode,
  TestimonyCodeInput,
  TestimonyCodeKind,
  TestimonyContrastFilters,
  TestimonyFragment,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

// ── Códigos y temas ──────────────────────────────────────────────────────────

interface CodeRow {
  id: string;
  label: string;
  normalized_label: string;
  kind: TestimonyCodeKind;
  parent_id: string | null;
  description: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
  usage_count?: number;
  interview_count?: number;
}

function rowToCode(row: CodeRow): TestimonyCode {
  return {
    id: row.id,
    label: row.label,
    normalizedLabel: row.normalized_label,
    kind: row.kind,
    parentId: row.parent_id,
    description: row.description,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usageCount: row.usage_count ?? 0,
    interviewCount: row.interview_count ?? 0,
  };
}

const CODE_SELECT = `
  SELECT c.*,
         (SELECT COUNT(*) FROM testimony_annotation_codes ac WHERE ac.code_id = c.id) AS usage_count,
         (SELECT COUNT(DISTINCT a.interview_id) FROM testimony_annotation_codes ac
            JOIN testimony_annotations a ON a.id = ac.annotation_id
           WHERE ac.code_id = c.id) AS interview_count
    FROM testimony_codes c`;

export function listCodes(): TestimonyCode[] {
  return (getDb().prepare(`${CODE_SELECT} ORDER BY c.kind DESC, c.label COLLATE NOCASE`).all() as CodeRow[]).map(rowToCode);
}

export function getCode(id: string): TestimonyCode | null {
  const row = getDb().prepare(`${CODE_SELECT} WHERE c.id = ?`).get(id) as CodeRow | undefined;
  return row ? rowToCode(row) : null;
}

/**
 * Crear un código, o devolver el que ya existía con ese nombre.
 *
 * Devolver el existente en vez de fallar es deliberado: quien escribe «Hambruna» en la
 * tercera entrevista quiere ETIQUETAR ESE FRAGMENTO, no gestionar un catálogo, y un
 * error de «ya existe» a mitad de una sesión de codificación le enseña a inventar
 * variantes para que le deje seguir.
 */
export function createCode(input: TestimonyCodeInput): TestimonyCode {
  const label = cleanCodeLabel(input.label);
  if (!isValidCodeLabel(label)) throw new Error('El nombre del código no es válido.');
  const normalized = normalizeCodeLabel(label);
  const existing = getDb().prepare(`${CODE_SELECT} WHERE c.normalized_label = ?`).get(normalized) as CodeRow | undefined;
  if (existing) return rowToCode(existing);
  const id = newId('cod');
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO testimony_codes (id, label, normalized_label, kind, parent_id, description, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, label, normalized, input.kind ?? 'code', input.parentId ?? null, input.description ?? null, input.color ?? null, ts, ts);
  return getCode(id)!;
}

export function updateCode(id: string, patch: Partial<TestimonyCodeInput>): TestimonyCode | null {
  const existing = getCode(id);
  if (!existing) return null;
  const label = patch.label !== undefined ? cleanCodeLabel(patch.label) : existing.label;
  if (!isValidCodeLabel(label)) throw new Error('El nombre del código no es válido.');
  const normalized = normalizeCodeLabel(label);
  const clash = getDb()
    .prepare('SELECT id FROM testimony_codes WHERE normalized_label = ? AND id <> ?')
    .get(normalized, id) as { id: string } | undefined;
  if (clash) throw new Error('Ya existe un código con ese nombre. Fusiónalos si son el mismo.');
  // Un código no puede ser su propio antepasado: el panel recorre la jerarquía y un ciclo
  // no da un error, da un cuelgue sin mensaje.
  const parentId = patch.parentId !== undefined ? patch.parentId : existing.parentId;
  if (parentId && wouldCycle(id, parentId)) throw new Error('Un código no puede colgar de sí mismo.');
  getDb()
    .prepare('UPDATE testimony_codes SET label = ?, normalized_label = ?, kind = ?, parent_id = ?, description = ?, color = ?, updated_at = ? WHERE id = ?')
    .run(
      label,
      normalized,
      patch.kind ?? existing.kind,
      parentId,
      patch.description !== undefined ? patch.description : existing.description,
      patch.color !== undefined ? patch.color : existing.color,
      now(),
      id
    );
  return getCode(id);
}

function wouldCycle(codeId: string, parentId: string): boolean {
  const db = getDb();
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === codeId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    const row = db.prepare('SELECT parent_id FROM testimony_codes WHERE id = ?').get(cursor) as { parent_id: string | null } | undefined;
    cursor = row?.parent_id ?? null;
  }
  return false;
}

export function deleteCode(id: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM testimony_annotation_codes WHERE code_id = ?').run(id);
    db.prepare('UPDATE testimony_codes SET parent_id = NULL WHERE parent_id = ?').run(id);
    db.prepare('DELETE FROM testimony_codes WHERE id = ?').run(id);
  });
  tx();
}

/**
 * Fusionar dos códigos SIN PERDER NINGUNA ANOTACIÓN.
 *
 * `INSERT OR IGNORE` importa: un fragmento puede llevar ya los dos códigos, y sin él la
 * fusión fallaría contra la clave primaria justo en el caso más probable — dos nombres
 * para lo mismo aplicados al mismo pasaje. Los hijos del código absorbido se cuelgan del
 * destino en la misma transacción, para que no queden colgando de un padre inexistente.
 */
export function mergeCodes(sourceId: string, targetId: string): TestimonyCode | null {
  if (sourceId === targetId) return getCode(targetId);
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT OR IGNORE INTO testimony_annotation_codes (annotation_id, code_id, created_at) SELECT annotation_id, ?, created_at FROM testimony_annotation_codes WHERE code_id = ?'
    ).run(targetId, sourceId);
    db.prepare('DELETE FROM testimony_annotation_codes WHERE code_id = ?').run(sourceId);
    db.prepare('UPDATE testimony_codes SET parent_id = ? WHERE parent_id = ?').run(targetId, sourceId);
    db.prepare('DELETE FROM testimony_codes WHERE id = ?').run(sourceId);
  });
  tx();
  return getCode(targetId);
}

// ── Anotaciones ──────────────────────────────────────────────────────────────

interface AnnotationRow {
  id: string;
  short_id: string;
  interview_id: string;
  transcript_id: string;
  segment_id: string | null;
  kind: TestimonyAnnotationKind;
  t_start: number;
  t_end: number;
  start_offset: number | null;
  end_offset: number | null;
  quote_snapshot: string | null;
  memo: string | null;
  link_status: 'valid' | 'needs_review';
  created_at: string;
  updated_at: string;
}

function nextAnnotationShortId(): string {
  const row = getDb()
    .prepare("SELECT short_id FROM testimony_annotations WHERE short_id LIKE 'ANN-%' ORDER BY LENGTH(short_id) DESC, short_id DESC LIMIT 1")
    .get() as { short_id: string } | undefined;
  const last = row ? Number(row.short_id.slice(4)) : 0;
  return formatShortId('ANN', (Number.isFinite(last) ? last : 0) + 1);
}

function codesForAnnotations(ids: string[]): Map<string, TestimonyCode[]> {
  const out = new Map<string, TestimonyCode[]>();
  if (ids.length === 0) return out;
  const marks = ids.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT ac.annotation_id AS annotation_id, c.*,
              0 AS usage_count, 0 AS interview_count
         FROM testimony_annotation_codes ac
         JOIN testimony_codes c ON c.id = ac.code_id
        WHERE ac.annotation_id IN (${marks})
        ORDER BY c.label COLLATE NOCASE`
    )
    .all(...ids) as (CodeRow & { annotation_id: string })[];
  for (const row of rows) {
    const list = out.get(row.annotation_id) ?? [];
    list.push(rowToCode(row));
    out.set(row.annotation_id, list);
  }
  return out;
}

function rowToAnnotation(row: AnnotationRow, codes: TestimonyCode[]): TestimonyAnnotation {
  return {
    id: row.id,
    shortId: row.short_id,
    interviewId: row.interview_id,
    transcriptId: row.transcript_id,
    segmentId: row.segment_id,
    kind: row.kind,
    tStart: row.t_start,
    tEnd: row.t_end,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    quoteSnapshot: row.quote_snapshot ?? '',
    memo: row.memo,
    linkStatus: row.link_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    codes,
  };
}

export function createAnnotation(input: TestimonyAnnotationInput): TestimonyAnnotation {
  const db = getDb();
  const id = newId('ann');
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO testimony_annotations
        (id, short_id, interview_id, transcript_id, segment_id, kind, t_start, t_end, start_offset, end_offset,
         quote_snapshot, memo, link_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'valid', ?, ?)`
    ).run(
      id,
      nextAnnotationShortId(),
      input.interviewId,
      input.transcriptId,
      input.segmentId ?? null,
      input.kind ?? 'highlight',
      Math.max(0, input.tStart),
      Math.max(input.tStart, input.tEnd),
      input.startOffset ?? null,
      input.endOffset ?? null,
      input.quoteSnapshot,
      input.memo ?? null,
      ts,
      ts
    );
    setAnnotationCodes(id, input.codeIds ?? []);
  });
  tx();
  return getAnnotation(id)!;
}

export function getAnnotation(id: string): TestimonyAnnotation | null {
  const row = getDb().prepare('SELECT * FROM testimony_annotations WHERE id = ?').get(id) as AnnotationRow | undefined;
  if (!row) return null;
  return rowToAnnotation(row, codesForAnnotations([id]).get(id) ?? []);
}

export function listAnnotations(interviewId: string): TestimonyAnnotation[] {
  const rows = getDb()
    .prepare('SELECT * FROM testimony_annotations WHERE interview_id = ? ORDER BY t_start, created_at')
    .all(interviewId) as AnnotationRow[];
  const codes = codesForAnnotations(rows.map((row) => row.id));
  return rows.map((row) => rowToAnnotation(row, codes.get(row.id) ?? []));
}

function setAnnotationCodes(annotationId: string, codeIds: string[]): void {
  const db = getDb();
  db.prepare('DELETE FROM testimony_annotation_codes WHERE annotation_id = ?').run(annotationId);
  const insert = db.prepare('INSERT OR IGNORE INTO testimony_annotation_codes (annotation_id, code_id, created_at) VALUES (?, ?, ?)');
  const ts = now();
  for (const codeId of [...new Set(codeIds)]) insert.run(annotationId, codeId, ts);
}

export function updateAnnotation(
  id: string,
  patch: { memo?: string | null; kind?: TestimonyAnnotationKind; codeIds?: string[]; linkStatus?: 'valid' | 'needs_review' },
): TestimonyAnnotation | null {
  const existing = getAnnotation(id);
  if (!existing) return null;
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('UPDATE testimony_annotations SET memo = ?, kind = ?, link_status = ?, updated_at = ? WHERE id = ?').run(
      patch.memo !== undefined ? patch.memo : existing.memo,
      patch.kind ?? existing.kind,
      patch.linkStatus ?? existing.linkStatus,
      now(),
      id
    );
    if (patch.codeIds) setAnnotationCodes(id, patch.codeIds);
  });
  tx();
  return getAnnotation(id);
}

export function deleteAnnotation(id: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM testimony_annotation_codes WHERE annotation_id = ?').run(id);
    db.prepare('DELETE FROM testimony_contrast_items WHERE annotation_id = ?').run(id);
    db.prepare("DELETE FROM testimony_note_links WHERE target_kind = 'testimony_annotation' AND target_id = ?").run(id);
    db.prepare('DELETE FROM testimony_annotations WHERE id = ?').run(id);
  });
  tx();
}

// ── Fragmentos ───────────────────────────────────────────────────────────────

interface FragmentRow {
  annotation_id: string;
  short_id: string;
  interview_id: string;
  interview_title: string;
  interview_short_id: string;
  conducted_at: string | null;
  transcript_id: string;
  transcript_kind: TestimonyFragment['transcriptKind'];
  session_id: string | null;
  media_id: string | null;
  t_start: number;
  t_end: number;
  quote_snapshot: string | null;
  memo: string | null;
  link_status: 'valid' | 'needs_review';
  speaker_person_id: string | null;
  speaker_label: string | null;
  working_name: string | null;
  public_name: string | null;
  identity_mode: 'identified' | 'pseudonym' | 'anonymous' | null;
  access_level: TestimonyFragment['accessLevel'];
  agreement_status: TestimonyFragment['agreementStatus'];
  attribution_mode: 'real_name' | 'public_name' | 'anonymous';
}

const FRAGMENT_SELECT = `
  SELECT a.id AS annotation_id, a.short_id AS short_id, a.interview_id AS interview_id,
         i.title AS interview_title, i.short_id AS interview_short_id,
         COALESCE(i.conducted_at, i.scheduled_at) AS conducted_at,
         a.transcript_id AS transcript_id, t.kind AS transcript_kind,
         m.session_id AS session_id, m.id AS media_id,
         a.t_start AS t_start, a.t_end AS t_end, a.quote_snapshot AS quote_snapshot, a.memo AS memo,
         a.link_status AS link_status,
         seg.speaker_person_id AS speaker_person_id, seg.speaker_label AS speaker_label,
         p.display_name AS working_name, pr.public_name AS public_name,
         COALESCE(pr.identity_mode, 'identified') AS identity_mode,
         COALESCE(ag.access_level, 'private') AS access_level,
         COALESCE(ag.status, 'pending') AS agreement_status,
         COALESCE(ag.attribution_mode, 'public_name') AS attribution_mode
    FROM testimony_annotations a
    JOIN testimony_interviews i ON i.id = a.interview_id AND i.deleted_at IS NULL
    LEFT JOIN testimony_transcripts t ON t.id = a.transcript_id
    LEFT JOIN testimony_media m ON m.id = t.media_id
    LEFT JOIN testimony_transcript_segments seg ON seg.id = a.segment_id
    LEFT JOIN persons p ON p.person_id = seg.speaker_person_id
    LEFT JOIN testimony_participant_profiles pr ON pr.person_id = seg.speaker_person_id
    LEFT JOIN testimony_agreements ag ON ag.interview_id = i.id AND ag.is_current = 1`;

function rowToFragment(row: FragmentRow, codes: TestimonyCode[]): TestimonyFragment {
  const speakerName = row.working_name
    ? displayNameFor(
        { workingName: row.working_name, publicName: row.public_name, identityMode: row.identity_mode ?? 'identified' },
        effectiveAttribution(row.identity_mode ?? 'identified', row.attribution_mode)
      )
    : row.speaker_label ?? 'Sin identificar';
  return {
    annotationId: row.annotation_id,
    shortId: row.short_id,
    interviewId: row.interview_id,
    interviewTitle: row.interview_title,
    interviewShortId: row.interview_short_id,
    transcriptId: row.transcript_id,
    transcriptKind: row.transcript_kind ?? 'machine_literal',
    sessionId: row.session_id,
    mediaId: row.media_id,
    speakerName,
    speakerPersonId: row.speaker_person_id,
    tStart: row.t_start,
    tEnd: row.t_end,
    text: row.quote_snapshot ?? '',
    memo: row.memo,
    codes,
    accessLevel: row.access_level,
    agreementStatus: row.agreement_status,
    linkStatus: row.link_status,
    conductedAt: row.conducted_at,
  };
}

/**
 * Los fragmentos que cumplen unos filtros. Es la consulta que alimentan Contrastes,
 * Buscar y el panel de análisis, y por eso vive aquí una sola vez.
 *
 * `reviewedOnly` NO es un adorno: comparar testimonios sobre transcripciones automáticas
 * sin revisar significa comparar errores de reconocimiento, y el investigador tiene que
 * poder decir «solo lo que he revisado».
 */
export function listFragments(filters: TestimonyContrastFilters): TestimonyFragment[] {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.interviewIds?.length) {
    where.push(`a.interview_id IN (${filters.interviewIds.map(() => '?').join(',')})`);
    params.push(...filters.interviewIds);
  }
  if (filters.codeIds?.length) {
    where.push(
      `EXISTS (SELECT 1 FROM testimony_annotation_codes ac WHERE ac.annotation_id = a.id AND ac.code_id IN (${filters.codeIds.map(() => '?').join(',')}))`
    );
    params.push(...filters.codeIds);
  }
  if (filters.personIds?.length) {
    where.push(
      `(seg.speaker_person_id IN (${filters.personIds.map(() => '?').join(',')})
        OR EXISTS (SELECT 1 FROM testimony_interview_participants ip WHERE ip.interview_id = a.interview_id AND ip.person_id IN (${filters.personIds.map(() => '?').join(',')})))`
    );
    params.push(...filters.personIds, ...filters.personIds);
  }
  if (filters.search) {
    where.push('(a.quote_snapshot LIKE ? OR COALESCE(a.memo, "") LIKE ?)');
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.languages?.length) {
    where.push(`i.language IN (${filters.languages.map(() => '?').join(',')})`);
    params.push(...filters.languages);
  }
  if (filters.collections?.length) {
    where.push(`i.collection_label IN (${filters.collections.map(() => '?').join(',')})`);
    params.push(...filters.collections);
  }
  if (filters.from) {
    where.push('COALESCE(i.conducted_at, i.scheduled_at) >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('COALESCE(i.conducted_at, i.scheduled_at) <= ?');
    params.push(filters.to);
  }
  if (filters.reviewedOnly) {
    where.push("t.kind IN ('reviewed', 'approved', 'corrected')");
  }

  const rows = getDb()
    .prepare(`${FRAGMENT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.title, a.t_start`)
    .all(...params) as FragmentRow[];
  const codes = codesForAnnotations(rows.map((row) => row.annotation_id));
  return rows.map((row) => rowToFragment(row, codes.get(row.annotation_id) ?? []));
}

export function getFragment(annotationId: string): TestimonyFragment | null {
  const row = getDb().prepare(`${FRAGMENT_SELECT} WHERE a.id = ?`).get(annotationId) as FragmentRow | undefined;
  if (!row) return null;
  return rowToFragment(row, codesForAnnotations([annotationId]).get(annotationId) ?? []);
}
