// Entrevistas, sesiones, participaciones y acuerdos del vault de Testimonios (v105).
//
// Dos invariantes viven aquí y en ningún otro sitio, porque el esquema no puede
// imponerlas solo:
//
//   1. UN SOLO ACUERDO VIGENTE por entrevista. El índice único parcial lo garantiza a
//      nivel de base; lo que este repositorio garantiza es que crear una versión nueva
//      BAJA la anterior en la misma transacción, para que nunca exista un instante con
//      dos vigentes ni con ninguno.
//
//   2. LA PROPIEDAD EN CASCADA. La migración no lleva claves foráneas a propósito (ver
//      su comentario), así que borrar una entrevista tiene que arrastrar sus sesiones,
//      archivos, transcripciones, segmentos, anotaciones, acuerdos y enlaces AQUÍ, en
//      una transacción. Un borrado parcial dejaría fragmentos apuntando a una
//      transcripción que ya no existe, que es exactamente la clase de basura silenciosa
//      que hace inútil un archivo.
//
// Y una regla que atraviesa todas las lecturas: NINGÚN nombre sale de aquí sin pasar por
// el acuerdo vigente. `displayNameFor` es la única puerta; el nombre de trabajo viaja
// aparte y explícitamente marcado, para las pantallas del propio investigador.

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import {
  displayNameFor,
  formatShortId,
  parseDocumentedUses,
  proposedStatusAfter,
  serializeDocumentedUses,
  validateNewInterview,
  type InterviewWorkflowStatus,
  type ShortIdPrefix,
} from '@shared/testimonies';
import { effectiveAttribution, pendingAccessContext, type AccessContext } from '@shared/testimonyAccess';
import type {
  InterviewKind,
  InterviewMode,
  TestimonySessionStatus,
  TestimonyAgreement,
  TestimonyAgreementInput,
  TestimonyDeletionImpact,
  TestimonyInterview,
  TestimonyInterviewFilters,
  TestimonyInterviewInput,
  TestimonyInterviewParticipant,
  TestimonyInterviewRow,
  TestimonyInterviewSort,
  TestimonyParticipantRole,
  TestimonySession,
  TestimonySessionInput,
  TestimonyTranscriptionState,
} from '@shared/types';
import { listMediaForSessions } from './testimonyMediaRepo';
import { getSettings } from './settingsRepo';

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

/**
 * El siguiente identificador corto de una tabla.
 *
 * Se calcula del máximo existente y no de un contador guardado: un contador se
 * desincroniza en cuanto una copia de seguridad restaura filas, y un `INT-0007`
 * duplicado rompe el único identificador que el investigador escribe a mano en sus
 * papeles. El UNIQUE de la columna es la red debajo.
 */
export function nextShortId(prefix: ShortIdPrefix, table: string): string {
  const row = getDb()
    .prepare(`SELECT short_id FROM ${table} WHERE short_id LIKE ? ORDER BY LENGTH(short_id) DESC, short_id DESC LIMIT 1`)
    .get(`${prefix}-%`) as { short_id: string } | undefined;
  const last = row ? Number(row.short_id.slice(prefix.length + 1)) : 0;
  return formatShortId(prefix, (Number.isFinite(last) ? last : 0) + 1);
}

// ── Entrevistas ──────────────────────────────────────────────────────────────

interface InterviewRow {
  id: string;
  short_id: string;
  title: string;
  interview_kind: InterviewKind;
  workflow_status: InterviewWorkflowStatus;
  collection_label: string | null;
  scheduled_at: string | null;
  conducted_at: string | null;
  location_text: string | null;
  interview_mode: InterviewMode | null;
  language: string | null;
  objective: string | null;
  context_markdown: string | null;
  guide_markdown: string | null;
  abstract: string | null;
  repository_name: string | null;
  accession_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

function rowToInterview(row: InterviewRow): TestimonyInterview {
  return {
    id: row.id,
    shortId: row.short_id,
    title: row.title,
    interviewKind: row.interview_kind,
    workflowStatus: row.workflow_status,
    collectionLabel: row.collection_label,
    scheduledAt: row.scheduled_at,
    conductedAt: row.conducted_at,
    locationText: row.location_text,
    interviewMode: row.interview_mode,
    language: row.language,
    objective: row.objective,
    contextMarkdown: row.context_markdown,
    guideMarkdown: row.guide_markdown,
    abstract: row.abstract,
    repositoryName: row.repository_name,
    accessionId: row.accession_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
  };
}

export function createInterview(input: TestimonyInterviewInput): TestimonyInterview {
  const error = validateNewInterview(input);
  if (error) throw new Error(error);
  const db = getDb();
  const id = newId('int');
  const ts = now();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO testimony_interviews
        (id, short_id, title, interview_kind, workflow_status, collection_label, scheduled_at, conducted_at,
         location_text, interview_mode, language, objective, context_markdown, guide_markdown, abstract,
         repository_name, accession_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      nextShortId('INT', 'testimony_interviews'),
      input.title.trim(),
      input.interviewKind ?? 'thematic',
      input.workflowStatus ?? 'preparation',
      input.collectionLabel ?? null,
      input.scheduledAt ?? null,
      input.conductedAt ?? null,
      input.locationText ?? null,
      input.interviewMode ?? null,
      input.language ?? (getSettings().testimonyDefaultLanguage || null),
      input.objective ?? null,
      input.contextMarkdown ?? null,
      input.guideMarkdown ?? null,
      input.abstract ?? null,
      input.repositoryName ?? (getSettings().testimonyRepositoryName || null),
      input.accessionId ?? null,
      ts,
      ts
    );
    let position = 0;
    for (const personId of input.narratorIds ?? []) {
      addParticipantRow(id, personId, 'narrator', position === 0, position);
      position += 1;
    }
    position = 0;
    for (const personId of input.interviewerIds ?? []) {
      addParticipantRow(id, personId, 'interviewer', position === 0, position);
      position += 1;
    }
    // Toda entrevista nace con un acuerdo PENDIENTE. El hueco entre crear una entrevista y
    // documentar su acuerdo no puede ser un hueco permisivo: sin fila, cada consumidor
    // tendría que acordarse de tratar la ausencia como restricción, y basta que uno lo
    // olvide para que material sin acuerdo salga por una exportación.
    //
    // El NIVEL y la ATRIBUCIÓN sí toman el valor por omisión del proyecto, porque son una
    // política real («en esta colección todo es restringido hasta el depósito»); el ESTADO
    // no, porque nadie ha documentado nada todavía y decir lo contrario sería mentir.
    const prefs = getSettings();
    insertAgreementRow(id, {
      interviewId: id,
      status: 'pending',
      accessLevel: prefs.testimonyDefaultAccess ?? 'private',
      attributionMode: prefs.testimonyDefaultAttribution ?? 'public_name',
      narratorReviewRequired: prefs.testimonyNarratorReviewDefault ?? false,
      allowedUses: [],
    }, 1);
  });
  tx();
  return getInterview(id)!;
}

export function getInterview(id: string): TestimonyInterview | null {
  const row = getDb().prepare('SELECT * FROM testimony_interviews WHERE id = ?').get(id) as InterviewRow | undefined;
  return row ? rowToInterview(row) : null;
}

const INTERVIEW_PATCH_COLUMNS: Record<keyof TestimonyInterviewInput, string | null> = {
  title: 'title',
  interviewKind: 'interview_kind',
  workflowStatus: 'workflow_status',
  collectionLabel: 'collection_label',
  scheduledAt: 'scheduled_at',
  conductedAt: 'conducted_at',
  locationText: 'location_text',
  interviewMode: 'interview_mode',
  language: 'language',
  objective: 'objective',
  contextMarkdown: 'context_markdown',
  guideMarkdown: 'guide_markdown',
  abstract: 'abstract',
  repositoryName: 'repository_name',
  accessionId: 'accession_id',
  narratorIds: null,
  interviewerIds: null,
};

export function updateInterview(id: string, patch: Partial<TestimonyInterviewInput>): TestimonyInterview | null {
  const existing = getInterview(id);
  if (!existing) return null;
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(INTERVIEW_PATCH_COLUMNS)) {
    if (!column) continue;
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(typeof value === 'string' && key === 'title' ? value.trim() : value);
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    values.push(now(), id);
    getDb().prepare(`UPDATE testimony_interviews SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }
  if (patch.narratorIds) setParticipantsForRole(id, 'narrator', patch.narratorIds);
  if (patch.interviewerIds) setParticipantsForRole(id, 'interviewer', patch.interviewerIds);
  return getInterview(id);
}

/**
 * Aplicar un cambio de estado PROPUESTO por un hecho (llegó un maestro, terminó una
 * transcripción). Devuelve el estado resultante, o null si no había nada que proponer.
 * Nunca fuerza: `proposedStatusAfter` decide, y decide que no en cuanto el usuario ya
 * ha avanzado la entrevista por su cuenta.
 */
export function applyProposedStatus(
  interviewId: string,
  event: Parameters<typeof proposedStatusAfter>[1],
): InterviewWorkflowStatus | null {
  const interview = getInterview(interviewId);
  if (!interview) return null;
  const proposed = proposedStatusAfter(interview.workflowStatus, event);
  if (!proposed) return null;
  getDb()
    .prepare('UPDATE testimony_interviews SET workflow_status = ?, updated_at = ? WHERE id = ?')
    .run(proposed, now(), interviewId);
  return proposed;
}

export function archiveInterview(id: string, archived: boolean): TestimonyInterview | null {
  getDb()
    .prepare('UPDATE testimony_interviews SET archived_at = ?, workflow_status = ?, updated_at = ? WHERE id = ?')
    .run(archived ? now() : null, archived ? 'archived' : 'completed', now(), id);
  return getInterview(id);
}

/** Papelera lógica. No borra nada: solo la retira de las listas. */
export function trashInterview(id: string, trashed: boolean): TestimonyInterview | null {
  getDb()
    .prepare('UPDATE testimony_interviews SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .run(trashed ? now() : null, now(), id);
  return getInterview(id);
}

/**
 * Qué desaparece si se borra de verdad. Se calcula ANTES de preguntar, porque «¿seguro?»
 * sin cifras no es una pregunta: es un trámite que el usuario aprende a despachar.
 */
export function deletionImpact(id: string): TestimonyDeletionImpact | null {
  const interview = getInterview(id);
  if (!interview) return null;
  const db = getDb();
  const one = (sql: string, ...params: unknown[]): number =>
    ((db.prepare(sql).get(...params) as { n: number } | undefined)?.n ?? 0);
  return {
    interviewId: id,
    title: interview.title,
    sessions: one('SELECT COUNT(*) AS n FROM testimony_sessions WHERE interview_id = ?', id),
    media: one(
      'SELECT COUNT(*) AS n FROM testimony_media WHERE session_id IN (SELECT id FROM testimony_sessions WHERE interview_id = ?)',
      id
    ),
    masterMedia: one(
      "SELECT COUNT(*) AS n FROM testimony_media WHERE role = 'master' AND session_id IN (SELECT id FROM testimony_sessions WHERE interview_id = ?)",
      id
    ),
    transcripts: one(
      `SELECT COUNT(*) AS n FROM testimony_transcripts WHERE media_id IN
        (SELECT id FROM testimony_media WHERE session_id IN (SELECT id FROM testimony_sessions WHERE interview_id = ?))`,
      id
    ),
    segments: one(
      `SELECT COUNT(*) AS n FROM testimony_transcript_segments WHERE transcript_id IN
        (SELECT id FROM testimony_transcripts WHERE media_id IN
          (SELECT id FROM testimony_media WHERE session_id IN (SELECT id FROM testimony_sessions WHERE interview_id = ?)))`,
      id
    ),
    annotations: one('SELECT COUNT(*) AS n FROM testimony_annotations WHERE interview_id = ?', id),
    agreements: one('SELECT COUNT(*) AS n FROM testimony_agreements WHERE interview_id = ?', id),
    contrastItems: one(
      'SELECT COUNT(*) AS n FROM testimony_contrast_items WHERE annotation_id IN (SELECT id FROM testimony_annotations WHERE interview_id = ?)',
      id
    ),
    noteLinks: one(
      `SELECT COUNT(*) AS n FROM testimony_note_links WHERE (target_kind = 'testimony_interview' AND target_id = ?)
        OR (target_kind = 'testimony_annotation' AND target_id IN (SELECT id FROM testimony_annotations WHERE interview_id = ?))`,
      id,
      id
    ),
    bytes: (
      (db
        .prepare(
          'SELECT COALESCE(SUM(size_bytes), 0) AS n FROM testimony_media WHERE session_id IN (SELECT id FROM testimony_sessions WHERE interview_id = ?)'
        )
        .get(id) as { n: number } | undefined)?.n ?? 0
    ),
  };
}

/**
 * El borrado definitivo. Toda la cascada en UNA transacción, porque la migración no
 * lleva claves foráneas: si esto se hiciera en varias llamadas, un fallo a mitad dejaría
 * segmentos huérfanos apuntando a transcripciones inexistentes.
 *
 * Los enlaces de Notas se borran, pero el TEXTO de la nota no se toca: una nota
 * interpretativa sobrevive a su fragmento y debe mostrar un enlace roto, no desaparecer
 * con él. Esa asimetría es deliberada — lo que el investigador escribió es suyo.
 */
export function purgeInterview(id: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    const sessions = db.prepare('SELECT id FROM testimony_sessions WHERE interview_id = ?').all(id) as { id: string }[];
    const sessionIds = sessions.map((s) => s.id);
    const mediaIds = sessionIds.length
      ? (db
          .prepare(`SELECT id FROM testimony_media WHERE session_id IN (${sessionIds.map(() => '?').join(',')})`)
          .all(...sessionIds) as { id: string }[]).map((m) => m.id)
      : [];
    const transcriptIds = mediaIds.length
      ? (db
          .prepare(`SELECT id FROM testimony_transcripts WHERE media_id IN (${mediaIds.map(() => '?').join(',')})`)
          .all(...mediaIds) as { id: string }[]).map((t) => t.id)
      : [];
    const annotationIds = (db.prepare('SELECT id FROM testimony_annotations WHERE interview_id = ?').all(id) as { id: string }[])
      .map((a) => a.id);

    if (transcriptIds.length) {
      const marks = transcriptIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM testimony_transcript_segments WHERE transcript_id IN (${marks})`).run(...transcriptIds);
      db.prepare(`DELETE FROM testimony_transcripts WHERE id IN (${marks})`).run(...transcriptIds);
    }
    if (mediaIds.length) {
      db.prepare(`DELETE FROM testimony_media WHERE id IN (${mediaIds.map(() => '?').join(',')})`).run(...mediaIds);
    }
    if (annotationIds.length) {
      const marks = annotationIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM testimony_annotation_codes WHERE annotation_id IN (${marks})`).run(...annotationIds);
      db.prepare(`DELETE FROM testimony_contrast_items WHERE annotation_id IN (${marks})`).run(...annotationIds);
      db.prepare(`DELETE FROM testimony_note_links WHERE target_kind = 'testimony_annotation' AND target_id IN (${marks})`).run(...annotationIds);
      db.prepare(`DELETE FROM testimony_annotations WHERE id IN (${marks})`).run(...annotationIds);
    }
    db.prepare('DELETE FROM testimony_sessions WHERE interview_id = ?').run(id);
    db.prepare('DELETE FROM testimony_agreements WHERE interview_id = ?').run(id);
    db.prepare('DELETE FROM testimony_interview_participants WHERE interview_id = ?').run(id);
    db.prepare("DELETE FROM testimony_note_links WHERE target_kind = 'testimony_interview' AND target_id = ?").run(id);
    db.prepare('DELETE FROM testimony_interviews WHERE id = ?').run(id);
  });
  tx();
}

// ── Participaciones ──────────────────────────────────────────────────────────

function addParticipantRow(
  interviewId: string,
  personId: string,
  role: TestimonyParticipantRole,
  isPrimary: boolean,
  position: number,
  speakerLabel: string | null = null,
): void {
  getDb()
    .prepare(
      `INSERT INTO testimony_interview_participants
        (interview_id, person_id, role, speaker_label, is_primary, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(interview_id, person_id, role) DO UPDATE SET
         speaker_label = excluded.speaker_label, is_primary = excluded.is_primary, position = excluded.position`
    )
    .run(interviewId, personId, role, speakerLabel, isPrimary ? 1 : 0, position, now());
}

export function addParticipant(
  interviewId: string,
  personId: string,
  role: TestimonyParticipantRole,
  options: { isPrimary?: boolean; speakerLabel?: string | null } = {},
): void {
  const count = (getDb()
    .prepare('SELECT COUNT(*) AS n FROM testimony_interview_participants WHERE interview_id = ? AND role = ?')
    .get(interviewId, role) as { n: number }).n;
  addParticipantRow(interviewId, personId, role, options.isPrimary ?? count === 0, count, options.speakerLabel ?? null);
  touchInterview(interviewId);
}

export function removeParticipant(interviewId: string, personId: string, role: TestimonyParticipantRole): void {
  getDb()
    .prepare('DELETE FROM testimony_interview_participants WHERE interview_id = ? AND person_id = ? AND role = ?')
    .run(interviewId, personId, role);
  touchInterview(interviewId);
}

function setParticipantsForRole(interviewId: string, role: TestimonyParticipantRole, personIds: string[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM testimony_interview_participants WHERE interview_id = ? AND role = ?').run(interviewId, role);
    personIds.forEach((personId, index) => addParticipantRow(interviewId, personId, role, index === 0, index));
  });
  tx();
}

function touchInterview(interviewId: string): void {
  getDb().prepare('UPDATE testimony_interviews SET updated_at = ? WHERE id = ?').run(now(), interviewId);
}

interface ParticipantJoinRow {
  interview_id: string;
  person_id: string;
  role: TestimonyParticipantRole;
  speaker_label: string | null;
  is_primary: number;
  position: number;
  display_name: string;
  public_name: string | null;
  identity_mode: 'identified' | 'pseudonym' | 'anonymous';
}

const PARTICIPANT_SELECT = `
  SELECT ip.interview_id, ip.person_id, ip.role, ip.speaker_label, ip.is_primary, ip.position,
         p.display_name,
         pr.public_name, COALESCE(pr.identity_mode, 'identified') AS identity_mode
  FROM testimony_interview_participants ip
  JOIN persons p ON p.person_id = ip.person_id
  LEFT JOIN testimony_participant_profiles pr ON pr.person_id = ip.person_id`;

function rowToParticipant(row: ParticipantJoinRow, attribution: AccessContext['attributionMode']): TestimonyInterviewParticipant {
  return {
    interviewId: row.interview_id,
    personId: row.person_id,
    role: row.role,
    speakerLabel: row.speaker_label,
    isPrimary: row.is_primary === 1,
    position: row.position,
    workingName: row.display_name,
    displayName: displayNameFor(
      { workingName: row.display_name, publicName: row.public_name, identityMode: row.identity_mode },
      effectiveAttribution(row.identity_mode, attribution)
    ),
    identityMode: row.identity_mode,
  };
}

export function listParticipants(interviewId: string): TestimonyInterviewParticipant[] {
  const attribution = currentAgreement(interviewId)?.attributionMode ?? 'public_name';
  const rows = getDb()
    .prepare(`${PARTICIPANT_SELECT} WHERE ip.interview_id = ? ORDER BY ip.role, ip.position`)
    .all(interviewId) as ParticipantJoinRow[];
  return rows.map((row) => rowToParticipant(row, attribution));
}

// ── Acuerdos ─────────────────────────────────────────────────────────────────

interface AgreementRow {
  id: string;
  interview_id: string;
  version_no: number;
  is_current: number;
  status: TestimonyAgreement['status'];
  documented_at: string | null;
  access_level: TestimonyAgreement['accessLevel'];
  embargo_until: string | null;
  attribution_mode: TestimonyAgreement['attributionMode'];
  allowed_uses_json: string;
  narrator_review_required: number;
  narrator_review_status: TestimonyAgreement['narratorReviewStatus'];
  narrator_review_sent_at: string | null;
  narrator_review_notes: string | null;
  restrictions_markdown: string | null;
  document_media_id: string | null;
  created_at: string;
  updated_at: string;
}

function rowToAgreement(row: AgreementRow): TestimonyAgreement {
  return {
    id: row.id,
    interviewId: row.interview_id,
    versionNo: row.version_no,
    isCurrent: row.is_current === 1,
    status: row.status,
    documentedAt: row.documented_at,
    accessLevel: row.access_level,
    embargoUntil: row.embargo_until,
    attributionMode: row.attribution_mode,
    allowedUses: parseDocumentedUses(row.allowed_uses_json),
    narratorReviewRequired: row.narrator_review_required === 1,
    narratorReviewStatus: row.narrator_review_status,
    narratorReviewSentAt: row.narrator_review_sent_at,
    narratorReviewNotes: row.narrator_review_notes,
    restrictionsMarkdown: row.restrictions_markdown,
    documentMediaId: row.document_media_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function insertAgreementRow(interviewId: string, input: TestimonyAgreementInput, versionNo: number): string {
  const id = newId('agr');
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO testimony_agreements
        (id, interview_id, version_no, is_current, status, documented_at, access_level, embargo_until,
         attribution_mode, allowed_uses_json, narrator_review_required, narrator_review_status,
         narrator_review_sent_at, narrator_review_notes, restrictions_markdown, document_media_id,
         created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      interviewId,
      versionNo,
      input.status ?? 'pending',
      input.documentedAt ?? null,
      input.accessLevel ?? 'private',
      input.embargoUntil ?? null,
      input.attributionMode ?? 'public_name',
      serializeDocumentedUses(input.allowedUses ?? []),
      input.narratorReviewRequired ? 1 : 0,
      input.narratorReviewStatus ?? 'not_started',
      input.narratorReviewSentAt ?? null,
      input.narratorReviewNotes ?? null,
      input.restrictionsMarkdown ?? null,
      input.documentMediaId ?? null,
      ts,
      ts
    );
  return id;
}

export function currentAgreement(interviewId: string): TestimonyAgreement | null {
  const row = getDb()
    .prepare('SELECT * FROM testimony_agreements WHERE interview_id = ? AND is_current = 1')
    .get(interviewId) as AgreementRow | undefined;
  return row ? rowToAgreement(row) : null;
}

export function agreementHistory(interviewId: string): TestimonyAgreement[] {
  const rows = getDb()
    .prepare('SELECT * FROM testimony_agreements WHERE interview_id = ? ORDER BY version_no DESC')
    .all(interviewId) as AgreementRow[];
  return rows.map(rowToAgreement);
}

/**
 * Documentar un cambio de acuerdo. SIEMPRE crea una versión nueva; nunca sobrescribe.
 *
 * Un acuerdo no es un formulario que se corrige, es un hecho fechado: «en marzo autorizó
 * la difusión, en septiembre pidió un embargo» tiene que poder leerse dentro de cinco
 * años. Bajar la anterior y subir la nueva ocurre en la misma transacción para que el
 * índice único parcial nunca vea dos vigentes.
 */
export function saveAgreement(input: TestimonyAgreementInput): TestimonyAgreement {
  const db = getDb();
  const tx = db.transaction(() => {
    const current = currentAgreement(input.interviewId);
    const next = (current?.versionNo ?? 0) + 1;
    db.prepare('UPDATE testimony_agreements SET is_current = 0, updated_at = ? WHERE interview_id = ? AND is_current = 1')
      .run(now(), input.interviewId);
    // Lo no especificado se hereda de la versión vigente: cambiar el nivel de acceso no
    // puede vaciar en silencio la lista de usos que el narrador autorizó.
    insertAgreementRow(input.interviewId, {
      ...input,
      status: input.status ?? current?.status ?? 'pending',
      accessLevel: input.accessLevel ?? current?.accessLevel ?? 'private',
      attributionMode: input.attributionMode ?? current?.attributionMode ?? 'public_name',
      allowedUses: input.allowedUses ?? current?.allowedUses ?? [],
      embargoUntil: input.embargoUntil !== undefined ? input.embargoUntil : current?.embargoUntil ?? null,
      narratorReviewRequired: input.narratorReviewRequired ?? current?.narratorReviewRequired ?? false,
      narratorReviewStatus: input.narratorReviewStatus ?? current?.narratorReviewStatus ?? 'not_started',
      narratorReviewSentAt: input.narratorReviewSentAt !== undefined ? input.narratorReviewSentAt : current?.narratorReviewSentAt ?? null,
      narratorReviewNotes: input.narratorReviewNotes !== undefined ? input.narratorReviewNotes : current?.narratorReviewNotes ?? null,
      restrictionsMarkdown: input.restrictionsMarkdown !== undefined ? input.restrictionsMarkdown : current?.restrictionsMarkdown ?? null,
      documentMediaId: input.documentMediaId !== undefined ? input.documentMediaId : current?.documentMediaId ?? null,
      documentedAt: input.documentedAt !== undefined
        ? input.documentedAt
        : (input.status ?? current?.status) === 'documented' ? now() : current?.documentedAt ?? null,
    }, next);
    touchInterview(input.interviewId);
  });
  tx();
  return currentAgreement(input.interviewId)!;
}

/** El contexto que la puerta de acceso necesita, con el hueco resuelto de forma segura. */
export function accessContextFor(interviewId: string): AccessContext {
  const agreement = currentAgreement(interviewId);
  if (!agreement) return pendingAccessContext();
  return {
    agreementStatus: agreement.status,
    accessLevel: agreement.accessLevel,
    attributionMode: agreement.attributionMode,
    embargoUntil: agreement.accessLevel === 'embargoed' ? agreement.embargoUntil : undefined,
    documentedUses: agreement.allowedUses,
    narratorReviewRequired: agreement.narratorReviewRequired,
    narratorReviewStatus: agreement.narratorReviewStatus,
  };
}

// ── Sesiones ─────────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  short_id: string;
  interview_id: string;
  sequence_no: number;
  title: string | null;
  status: TestimonySessionStatus;
  scheduled_at: string | null;
  recorded_at: string | null;
  location_text: string | null;
  mode: InterviewMode | null;
  language: string | null;
  field_notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSession(row: SessionRow): Omit<TestimonySession, 'media'> {
  return {
    id: row.id,
    shortId: row.short_id,
    interviewId: row.interview_id,
    sequenceNo: row.sequence_no,
    title: row.title,
    status: row.status,
    scheduledAt: row.scheduled_at,
    recordedAt: row.recorded_at,
    locationText: row.location_text,
    mode: row.mode,
    language: row.language,
    fieldNotes: row.field_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSession(input: TestimonySessionInput): TestimonySession {
  const db = getDb();
  const id = newId('ses');
  const ts = now();
  const next = ((db
    .prepare('SELECT COALESCE(MAX(sequence_no), 0) AS n FROM testimony_sessions WHERE interview_id = ?')
    .get(input.interviewId) as { n: number }).n) + 1;
  db.prepare(
    `INSERT INTO testimony_sessions
      (id, short_id, interview_id, sequence_no, title, status, scheduled_at, recorded_at, location_text, mode, language, field_notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    nextShortId('SES', 'testimony_sessions'),
    input.interviewId,
    next,
    input.title ?? null,
    input.status ?? 'planned',
    input.scheduledAt ?? null,
    input.recordedAt ?? null,
    input.locationText ?? null,
    input.mode ?? null,
    input.language ?? null,
    input.fieldNotes ?? null,
    ts,
    ts
  );
  touchInterview(input.interviewId);
  return getSession(id)!;
}

export function getSession(id: string): TestimonySession | null {
  const row = getDb().prepare('SELECT * FROM testimony_sessions WHERE id = ?').get(id) as SessionRow | undefined;
  if (!row) return null;
  const media = listMediaForSessions([id]);
  return { ...rowToSession(row), media: media.get(id) ?? [] };
}

export function listSessions(interviewId: string): TestimonySession[] {
  const rows = getDb()
    .prepare('SELECT * FROM testimony_sessions WHERE interview_id = ? ORDER BY sequence_no')
    .all(interviewId) as SessionRow[];
  const media = listMediaForSessions(rows.map((row) => row.id));
  return rows.map((row) => ({ ...rowToSession(row), media: media.get(row.id) ?? [] }));
}

const SESSION_PATCH_COLUMNS: Record<string, string> = {
  title: 'title',
  status: 'status',
  scheduledAt: 'scheduled_at',
  recordedAt: 'recorded_at',
  locationText: 'location_text',
  mode: 'mode',
  language: 'language',
  fieldNotes: 'field_notes',
};

export function updateSession(id: string, patch: Partial<TestimonySessionInput>): TestimonySession | null {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(SESSION_PATCH_COLUMNS)) {
    const value = (patch as Record<string, unknown>)[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(value);
  }
  if (sets.length === 0) return getSession(id);
  sets.push('updated_at = ?');
  values.push(now(), id);
  getDb().prepare(`UPDATE testimony_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  const session = getSession(id);
  if (session) touchInterview(session.interviewId);
  return session;
}

/** Borrar una sesión arrastra sus archivos, transcripciones y segmentos, en transacción. */
export function deleteSession(id: string): void {
  const db = getDb();
  const tx = db.transaction(() => {
    const mediaIds = (db.prepare('SELECT id FROM testimony_media WHERE session_id = ?').all(id) as { id: string }[])
      .map((row) => row.id);
    if (mediaIds.length) {
      const marks = mediaIds.map(() => '?').join(',');
      const transcriptIds = (db
        .prepare(`SELECT id FROM testimony_transcripts WHERE media_id IN (${marks})`)
        .all(...mediaIds) as { id: string }[]).map((row) => row.id);
      if (transcriptIds.length) {
        const tMarks = transcriptIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM testimony_transcript_segments WHERE transcript_id IN (${tMarks})`).run(...transcriptIds);
        // Las anotaciones que apuntan a una transcripción eliminada se van con ella: una
        // cita sin transcripción no puede volver al audio, que es lo único que la hacía
        // una cita.
        const annIds = (db
          .prepare(`SELECT id FROM testimony_annotations WHERE transcript_id IN (${tMarks})`)
          .all(...transcriptIds) as { id: string }[]).map((row) => row.id);
        if (annIds.length) {
          const aMarks = annIds.map(() => '?').join(',');
          db.prepare(`DELETE FROM testimony_annotation_codes WHERE annotation_id IN (${aMarks})`).run(...annIds);
          db.prepare(`DELETE FROM testimony_contrast_items WHERE annotation_id IN (${aMarks})`).run(...annIds);
          db.prepare(`DELETE FROM testimony_note_links WHERE target_kind = 'testimony_annotation' AND target_id IN (${aMarks})`).run(...annIds);
          db.prepare(`DELETE FROM testimony_annotations WHERE id IN (${aMarks})`).run(...annIds);
        }
        db.prepare(`DELETE FROM testimony_transcripts WHERE id IN (${tMarks})`).run(...transcriptIds);
      }
      db.prepare(`DELETE FROM testimony_media WHERE id IN (${marks})`).run(...mediaIds);
    }
    db.prepare('DELETE FROM testimony_sessions WHERE id = ?').run(id);
  });
  tx();
}

// ── La tabla de entrevistas ──────────────────────────────────────────────────

/**
 * El estado agregado de transcripción de una entrevista.
 *
 * Se calcula, no se guarda: una columna con este valor tendría que actualizarse desde
 * seis sitios distintos (importar, encolar, terminar, fallar, derivar, borrar) y bastaría
 * olvidar uno para que la tabla mintiera. El orden importa — un error se anuncia aunque
 * otra sesión vaya bien, porque es lo único que pide una acción.
 */
function transcriptionStateFor(counts: {
  media: number;
  error: number;
  processing: number;
  pending: number;
  ready: number;
  reviewed: number;
}): TestimonyTranscriptionState {
  if (counts.error > 0) return 'error';
  if (counts.processing > 0) return 'processing';
  if (counts.pending > 0) return 'pending';
  if (counts.reviewed > 0) return 'reviewed';
  if (counts.ready > 0) return 'ready';
  return 'none';
}

export interface ListInterviewsOptions {
  filters?: TestimonyInterviewFilters;
  sort?: TestimonyInterviewSort;
  limit?: number;
}

export function listInterviews(options: ListInterviewsOptions = {}): TestimonyInterviewRow[] {
  const filters = options.filters ?? {};
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (!filters.includeDeleted) where.push('i.deleted_at IS NULL');
  if (!filters.includeArchived) where.push('i.archived_at IS NULL');
  if (filters.workflowStatus?.length) {
    where.push(`i.workflow_status IN (${filters.workflowStatus.map(() => '?').join(',')})`);
    params.push(...filters.workflowStatus);
  }
  if (filters.interviewKind?.length) {
    where.push(`i.interview_kind IN (${filters.interviewKind.map(() => '?').join(',')})`);
    params.push(...filters.interviewKind);
  }
  if (filters.language) {
    where.push('i.language = ?');
    params.push(filters.language);
  }
  if (filters.collectionLabel) {
    where.push('i.collection_label = ?');
    params.push(filters.collectionLabel);
  }
  if (filters.from) {
    where.push('COALESCE(i.conducted_at, i.scheduled_at) >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('COALESCE(i.conducted_at, i.scheduled_at) <= ?');
    params.push(filters.to);
  }
  if (filters.search) {
    where.push('(i.title LIKE ? OR i.short_id LIKE ? OR COALESCE(i.abstract, "") LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }
  if (filters.personId) {
    where.push('EXISTS (SELECT 1 FROM testimony_interview_participants ip WHERE ip.interview_id = i.id AND ip.person_id = ?)');
    params.push(filters.personId);
  }
  if (filters.interviewerId) {
    where.push(
      "EXISTS (SELECT 1 FROM testimony_interview_participants ip WHERE ip.interview_id = i.id AND ip.person_id = ? AND ip.role = 'interviewer')"
    );
    params.push(filters.interviewerId);
  }
  if (filters.codeId) {
    where.push(
      `EXISTS (SELECT 1 FROM testimony_annotations a
                JOIN testimony_annotation_codes ac ON ac.annotation_id = a.id
               WHERE a.interview_id = i.id AND ac.code_id = ?)`
    );
    params.push(filters.codeId);
  }
  if (filters.agreementStatus?.length) {
    where.push(
      `EXISTS (SELECT 1 FROM testimony_agreements ag WHERE ag.interview_id = i.id AND ag.is_current = 1
                AND ag.status IN (${filters.agreementStatus.map(() => '?').join(',')}))`
    );
    params.push(...filters.agreementStatus);
  }
  if (filters.accessLevel?.length) {
    where.push(
      `EXISTS (SELECT 1 FROM testimony_agreements ag WHERE ag.interview_id = i.id AND ag.is_current = 1
                AND ag.access_level IN (${filters.accessLevel.map(() => '?').join(',')}))`
    );
    params.push(...filters.accessLevel);
  }

  const order = ((): string => {
    switch (options.sort) {
      case 'upcoming':
        return 'COALESCE(i.scheduled_at, i.conducted_at) IS NULL, COALESCE(i.scheduled_at, i.conducted_at) ASC';
      case 'recent':
        return 'COALESCE(i.conducted_at, i.scheduled_at) IS NULL, COALESCE(i.conducted_at, i.scheduled_at) DESC';
      case 'title':
        return 'i.title COLLATE NOCASE ASC';
      case 'duration':
        return 'duration_seconds DESC';
      case 'updated':
      default:
        return 'i.updated_at DESC';
    }
  })();

  const rows = db
    .prepare(
      `SELECT i.*,
              (SELECT COUNT(*) FROM testimony_sessions s WHERE s.interview_id = i.id) AS session_count,
              (SELECT COUNT(*) FROM testimony_media m
                 JOIN testimony_sessions s ON s.id = m.session_id
                WHERE s.interview_id = i.id AND m.deleted_at IS NULL) AS media_count,
              (SELECT COALESCE(SUM(m.duration_seconds), 0) FROM testimony_media m
                 JOIN testimony_sessions s ON s.id = m.session_id
                WHERE s.interview_id = i.id AND m.role = 'master' AND m.deleted_at IS NULL) AS duration_seconds,
              (SELECT COUNT(*) FROM testimony_annotations a WHERE a.interview_id = i.id) AS annotation_count,
              (SELECT COUNT(*) FROM testimony_annotations a WHERE a.interview_id = i.id AND a.link_status = 'needs_review') AS needs_review_count
         FROM testimony_interviews i
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY ${order}
        ${options.limit ? 'LIMIT ?' : ''}`
    )
    .all(...(options.limit ? [...params, options.limit] : params)) as (InterviewRow & {
      session_count: number;
      media_count: number;
      duration_seconds: number;
      annotation_count: number;
      needs_review_count: number;
    })[];

  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const marks = ids.map(() => '?').join(',');

  const agreements = new Map<string, TestimonyAgreement>();
  for (const row of db
    .prepare(`SELECT * FROM testimony_agreements WHERE is_current = 1 AND interview_id IN (${marks})`)
    .all(...ids) as AgreementRow[]) {
    agreements.set(row.interview_id, rowToAgreement(row));
  }

  const participants = new Map<string, ParticipantJoinRow[]>();
  for (const row of db
    .prepare(`${PARTICIPANT_SELECT} WHERE ip.interview_id IN (${marks}) ORDER BY ip.role, ip.position`)
    .all(...ids) as ParticipantJoinRow[]) {
    const list = participants.get(row.interview_id) ?? [];
    list.push(row);
    participants.set(row.interview_id, list);
  }

  const stateCounts = new Map<string, { media: number; error: number; processing: number; pending: number; ready: number; reviewed: number }>();
  for (const row of db
    .prepare(
      `SELECT s.interview_id AS interview_id, t.kind AS kind, t.status AS status, COUNT(*) AS n
         FROM testimony_transcripts t
         JOIN testimony_media m ON m.id = t.media_id
         JOIN testimony_sessions s ON s.id = m.session_id
        WHERE s.interview_id IN (${marks})
        GROUP BY s.interview_id, t.kind, t.status`
    )
    .all(...ids) as { interview_id: string; kind: string; status: string; n: number }[]) {
    const entry = stateCounts.get(row.interview_id) ?? { media: 0, error: 0, processing: 0, pending: 0, ready: 0, reviewed: 0 };
    if (row.status === 'error') entry.error += row.n;
    else if (row.status === 'processing') entry.processing += row.n;
    else if (row.status === 'pending') entry.pending += row.n;
    else if (row.status === 'ready') {
      // Una versión revisada, aprobada o corregida ya no es «pendiente de revisar».
      if (row.kind === 'machine_literal') entry.ready += row.n;
      else entry.reviewed += row.n;
    }
    stateCounts.set(row.interview_id, entry);
  }

  return rows.map((row) => {
    const agreement = agreements.get(row.id) ?? null;
    const attribution = agreement?.attributionMode ?? 'public_name';
    const people = (participants.get(row.id) ?? []).map((p) => rowToParticipant(p, attribution));
    const counts = stateCounts.get(row.id) ?? { media: 0, error: 0, processing: 0, pending: 0, ready: 0, reviewed: 0 };
    return {
      ...rowToInterview(row),
      participants: people,
      narratorNames: people.filter((p) => p.role === 'narrator').map((p) => p.displayName),
      interviewerNames: people.filter((p) => p.role === 'interviewer').map((p) => p.displayName),
      sessionCount: row.session_count,
      mediaCount: row.media_count,
      durationSeconds: row.duration_seconds,
      transcriptionState: row.media_count === 0 ? 'none' : transcriptionStateFor({ ...counts, media: row.media_count }),
      agreement,
      annotationCount: row.annotation_count,
      needsReviewCount: row.needs_review_count,
    };
  });
}

/** Una fila completa por id, para el dossier. */
export function getInterviewRow(id: string): TestimonyInterviewRow | null {
  const rows = listInterviews({ filters: { includeArchived: true, includeDeleted: true } });
  return rows.find((row) => row.id === id) ?? null;
}

/** Las colecciones y los idiomas que el vault usa de verdad, para los filtros. */
export function interviewFacets(): { collections: string[]; languages: string[] } {
  const db = getDb();
  const collections = (db
    .prepare("SELECT DISTINCT collection_label AS v FROM testimony_interviews WHERE collection_label IS NOT NULL AND collection_label <> '' ORDER BY v")
    .all() as { v: string }[]).map((row) => row.v);
  const languages = (db
    .prepare("SELECT DISTINCT language AS v FROM testimony_interviews WHERE language IS NOT NULL AND language <> '' ORDER BY v")
    .all() as { v: string }[]).map((row) => row.v);
  return { collections, languages };
}
