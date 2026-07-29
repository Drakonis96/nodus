import { v4 as uuid } from 'uuid';
import type { ArchiveExcerpt, ArchiveReviewStatus } from '@shared/archiveTypes';
import type {
  PrimarySourceAnalysis,
  PrimarySourceEvidence,
  PrimarySourceEvidenceRole,
  PrimarySourceEvidenceTargetKind,
  PrimarySourceExcerptCreateInput,
  PrimarySourceNoteLink,
  PrimarySourcePersonMention,
  PrimarySourcePlaceMention,
} from '@shared/primarySourcesTypes';
import { validateArchiveLocator } from '@shared/archiveTypes';
import { getDb } from './database';
import { getArchiveTextVersion, listArchiveTextSegments } from './archiveTextsRepo';
import { recordArchiveAudit } from './archiveAuditRepo';
import { updatePrimarySourceProfile } from './primarySourcesRepo';

const now = () => new Date().toISOString();
const parseObject = <T extends object>(value: string | null, fallback: T): T => {
  try {
    const parsed = value ? JSON.parse(value) : fallback;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : fallback;
  } catch {
    return fallback;
  }
};

type ExcerptRow = {
  excerpt_id: string; item_id: string; file_id: string | null; text_version_id: string | null;
  segment_id: string | null; locator_display: string; locator_json: string; quoted_text: string | null;
  language_code: string | null; description: string | null; review_status: ArchiveReviewStatus;
  created_by: string | null; created_at: string; updated_at: string;
};
const excerptFromRow = (row: ExcerptRow): ArchiveExcerpt => ({
  excerptId: row.excerpt_id, itemId: row.item_id, fileId: row.file_id,
  textVersionId: row.text_version_id, segmentId: row.segment_id,
  locatorDisplay: row.locator_display, locator: parseObject(row.locator_json, {}),
  quotedText: row.quoted_text, languageCode: row.language_code, description: row.description,
  reviewStatus: row.review_status, createdBy: row.created_by,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

export function createArchiveExcerpt(
  input: Omit<ArchiveExcerpt, 'excerptId' | 'createdAt' | 'updatedAt'>
): ArchiveExcerpt {
  const issues = validateArchiveLocator(input.locator);
  if (!input.locatorDisplay.trim() || issues.length) {
    throw new Error(`Localizador no válido: ${issues[0]?.code ?? 'missing_display'}`);
  }
  const excerptId = `aex_${uuid()}`;
  const ts = now();
  getDb().prepare(
    `INSERT INTO archive_excerpts (
      excerpt_id, item_id, file_id, text_version_id, segment_id, locator_display,
      locator_json, quoted_text, language_code, description, review_status,
      created_by, created_at, updated_at
    ) VALUES (${Array.from({ length: 14 }, () => '?').join(',')})`
  ).run(
    excerptId, input.itemId, input.fileId, input.textVersionId, input.segmentId,
    input.locatorDisplay.trim(), JSON.stringify(input.locator), input.quotedText,
    input.languageCode, input.description, input.reviewStatus, input.createdBy, ts, ts
  );
  recordArchiveAudit({
    itemId: input.itemId,
    fileId: input.fileId,
    action: 'excerpt_created',
    createdBy: input.createdBy,
    details: {
      excerptId,
      textVersionId: input.textVersionId,
      segmentId: input.segmentId,
      locatorDisplay: input.locatorDisplay.trim(),
      reviewStatus: input.reviewStatus,
      snapshotCharacters: input.quotedText?.length ?? 0,
    },
  });
  return getArchiveExcerpt(excerptId)!;
}

export function createStableArchiveExcerpt(
  input: PrimarySourceExcerptCreateInput
): ArchiveExcerpt {
  const version = getArchiveTextVersion(input.textVersionId);
  if (!version || version.itemId !== input.itemId) {
    throw new Error('La versión de texto no pertenece a esta fuente.');
  }
  if (
    !Number.isInteger(input.startOffset)
    || !Number.isInteger(input.endOffset)
    || input.startOffset < 0
    || input.endOffset <= input.startOffset
    || input.endOffset > version.content.length
  ) {
    throw new Error('Selecciona un intervalo de texto válido.');
  }
  const segment = input.segmentId
    ? listArchiveTextSegments(version.textVersionId).find(
      (candidate) => candidate.segmentId === input.segmentId
    ) ?? null
    : null;
  if (input.segmentId && !segment) {
    throw new Error('El segmento no pertenece a la versión seleccionada.');
  }
  const fileId = input.fileId === undefined
    ? segment?.fileId ?? version.fileId
    : input.fileId;
  if (fileId) {
    const file = getDb().prepare(
      'SELECT item_id FROM archive_item_files WHERE file_id=?'
    ).get(fileId) as { item_id: string } | undefined;
    if (!file || file.item_id !== input.itemId) {
      throw new Error('El archivo del localizador no pertenece a esta fuente.');
    }
  }
  const quotedText = version.content.slice(input.startOffset, input.endOffset);
  const locator = {
    ...(input.locator ?? {}),
    ...(segment?.pageLabel && !input.locator?.pageLabel
      ? { pageLabel: segment.pageLabel }
      : {}),
    ...(segment?.timeStartMs !== null
      && segment?.timeStartMs !== undefined
      && segment.timeEndMs !== null
      && segment.timeEndMs !== undefined
      && !input.locator?.timeRangeMs
      ? { timeRangeMs: { start: segment.timeStartMs, end: segment.timeEndMs } }
      : {}),
    segmentId: segment?.segmentId ?? input.segmentId ?? undefined,
    textRange: { start: input.startOffset, end: input.endOffset },
  };
  return createArchiveExcerpt({
    itemId: input.itemId,
    fileId: fileId ?? null,
    textVersionId: version.textVersionId,
    segmentId: segment?.segmentId ?? input.segmentId ?? null,
    locatorDisplay: input.locatorDisplay,
    locator,
    quotedText,
    languageCode: input.languageCode ?? version.languageCode,
    description: input.description ?? null,
    reviewStatus: input.reviewStatus ?? 'unreviewed',
    createdBy: input.createdBy ?? 'primary_sources_user',
  });
}

export function getArchiveExcerpt(excerptId: string): ArchiveExcerpt | null {
  const row = getDb().prepare('SELECT * FROM archive_excerpts WHERE excerpt_id=?').get(excerptId) as ExcerptRow | undefined;
  return row ? excerptFromRow(row) : null;
}

export function listArchiveExcerpts(itemId: string): ArchiveExcerpt[] {
  return (getDb().prepare(
    'SELECT * FROM archive_excerpts WHERE item_id=? ORDER BY created_at'
  ).all(itemId) as ExcerptRow[]).map(excerptFromRow);
}

export function setArchiveExcerptReviewStatus(
  excerptId: string,
  reviewStatus: ArchiveReviewStatus
): ArchiveExcerpt | null {
  const current = getArchiveExcerpt(excerptId);
  if (!current) return null;
  const ts = now();
  getDb().prepare(
    'UPDATE archive_excerpts SET review_status=?, updated_at=? WHERE excerpt_id=?'
  ).run(reviewStatus, ts, excerptId);
  recordArchiveAudit({
    itemId: current.itemId,
    fileId: current.fileId,
    action: 'excerpt_review_status_changed',
    createdBy: 'primary_sources_user',
    details: {
      excerptId,
      from: current.reviewStatus,
      to: reviewStatus,
      textVersionId: current.textVersionId,
    },
  });
  return getArchiveExcerpt(excerptId);
}

type EvidenceRow = {
  id: string; target_kind: PrimarySourceEvidenceTargetKind; target_id: string; nodus_id: string | null;
  excerpt_id: string | null; evidence_role: PrimarySourceEvidenceRole; certainty: number | null;
  review_status: ArchiveReviewStatus; source_version_id: string | null; quote: string | null;
  location: string | null; created_by: string | null; created_at: string; updated_at: string | null;
};
const evidenceFromRow = (row: EvidenceRow): PrimarySourceEvidence => ({
  evidenceId: row.id, targetKind: row.target_kind, targetId: row.target_id,
  itemId: row.nodus_id ?? '', excerptId: row.excerpt_id, evidenceRole: row.evidence_role,
  certainty: row.certainty, reviewStatus: row.review_status, sourceVersionId: row.source_version_id,
  quote: row.quote, location: row.location, createdBy: row.created_by,
  createdAt: row.created_at, updatedAt: row.updated_at ?? row.created_at,
});

export function createPrimarySourceEvidence(input: Omit<PrimarySourceEvidence, 'evidenceId' | 'createdAt' | 'updatedAt'>): PrimarySourceEvidence {
  const db = getDb();
  const excerpt = input.excerptId ? getArchiveExcerpt(input.excerptId) : null;
  if (input.excerptId && !excerpt) throw new Error('Fragmento no encontrado.');
  if (excerpt && excerpt.itemId !== input.itemId) throw new Error('La evidencia y el fragmento pertenecen a fuentes distintas.');
  const evidenceId = `rev_${uuid()}`;
  const ts = now();
  db.prepare(
    `INSERT INTO record_evidence (
      id, target_kind, target_id, nodus_id, source_kind, quote, location, confidence,
      created_at, excerpt_id, evidence_role, certainty, review_status, source_version_id,
      created_by, updated_at
    ) VALUES (?, ?, ?, ?, 'archive', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    evidenceId, input.targetKind, input.targetId, input.itemId,
    input.quote ?? excerpt?.quotedText ?? null, input.location ?? excerpt?.locatorDisplay ?? null,
    input.certainty, ts, input.excerptId, input.evidenceRole, input.certainty,
    input.reviewStatus, input.sourceVersionId, input.createdBy, ts
  );
  return getPrimarySourceEvidence(evidenceId)!;
}

export function getPrimarySourceEvidence(evidenceId: string): PrimarySourceEvidence | null {
  const row = getDb().prepare('SELECT * FROM record_evidence WHERE id=?').get(evidenceId) as EvidenceRow | undefined;
  return row ? evidenceFromRow(row) : null;
}

export function listPrimarySourceEvidence(targetKind: PrimarySourceEvidenceTargetKind, targetId: string): PrimarySourceEvidence[] {
  return (getDb().prepare(
    'SELECT * FROM record_evidence WHERE target_kind=? AND target_id=? ORDER BY created_at'
  ).all(targetKind, targetId) as EvidenceRow[]).map(evidenceFromRow);
}

export function listPrimarySourceEvidenceForItem(itemId: string): PrimarySourceEvidence[] {
  return (getDb().prepare(
    `SELECT * FROM record_evidence
     WHERE source_kind='archive' AND nodus_id=?
     ORDER BY created_at DESC, id DESC`
  ).all(itemId) as EvidenceRow[]).map(evidenceFromRow);
}

type AnalysisRow = {
  analysis_id: string; item_id: string; origin_notes: string | null; purpose_audience: string | null;
  content_form: string | null; perspective_bias: string | null; silences_limits: string | null;
  authenticity_notes: string | null; representativeness: string | null; corroboration: string | null;
  questions: string | null; status: PrimarySourceAnalysis['status']; created_at: string; updated_at: string;
};
const analysisFromRow = (row: AnalysisRow): PrimarySourceAnalysis => ({
  analysisId: row.analysis_id, itemId: row.item_id, originNotes: row.origin_notes,
  purposeAudience: row.purpose_audience, contentForm: row.content_form,
  perspectiveBias: row.perspective_bias, silencesLimits: row.silences_limits,
  authenticityNotes: row.authenticity_notes, representativeness: row.representativeness,
  corroboration: row.corroboration, questions: row.questions, status: row.status,
  createdAt: row.created_at, updatedAt: row.updated_at,
});

export function getPrimarySourceAnalysis(itemId: string): PrimarySourceAnalysis | null {
  const row = getDb().prepare(
    'SELECT * FROM archive_source_analyses WHERE item_id=?'
  ).get(itemId) as AnalysisRow | undefined;
  return row ? analysisFromRow(row) : null;
}

export function savePrimarySourceAnalysis(
  itemId: string,
  patch: Partial<Omit<PrimarySourceAnalysis, 'analysisId' | 'itemId' | 'createdAt' | 'updatedAt'>>
): PrimarySourceAnalysis {
  const db = getDb();
  const row = db.prepare('SELECT * FROM archive_source_analyses WHERE item_id=?').get(itemId) as AnalysisRow | undefined;
  const current = row ? analysisFromRow(row) : null;
  const next = {
    originNotes: patch.originNotes ?? current?.originNotes ?? null,
    purposeAudience: patch.purposeAudience ?? current?.purposeAudience ?? null,
    contentForm: patch.contentForm ?? current?.contentForm ?? null,
    perspectiveBias: patch.perspectiveBias ?? current?.perspectiveBias ?? null,
    silencesLimits: patch.silencesLimits ?? current?.silencesLimits ?? null,
    authenticityNotes: patch.authenticityNotes ?? current?.authenticityNotes ?? null,
    representativeness: patch.representativeness ?? current?.representativeness ?? null,
    corroboration: patch.corroboration ?? current?.corroboration ?? null,
    questions: patch.questions ?? current?.questions ?? null,
    status: patch.status ?? current?.status ?? 'draft',
  };
  const ts = now();
  db.prepare(
    `INSERT INTO archive_source_analyses (
      analysis_id, item_id, origin_notes, purpose_audience, content_form, perspective_bias,
      silences_limits, authenticity_notes, representativeness, corroboration, questions,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      origin_notes=excluded.origin_notes, purpose_audience=excluded.purpose_audience,
      content_form=excluded.content_form, perspective_bias=excluded.perspective_bias,
      silences_limits=excluded.silences_limits, authenticity_notes=excluded.authenticity_notes,
      representativeness=excluded.representativeness, corroboration=excluded.corroboration,
      questions=excluded.questions, status=excluded.status, updated_at=excluded.updated_at`
  ).run(
    current?.analysisId ?? `asa_${uuid()}`, itemId, next.originNotes, next.purposeAudience,
    next.contentForm, next.perspectiveBias, next.silencesLimits, next.authenticityNotes,
    next.representativeness, next.corroboration, next.questions, next.status,
    current?.createdAt ?? ts, ts
  );
  updatePrimarySourceProfile(itemId, {
    analysisStatus: next.status === 'reviewed' ? 'reviewed' : 'draft',
  });
  recordArchiveAudit({
    itemId,
    action: 'source_analysis_saved',
    createdBy: 'primary_sources_user',
    details: {
      analysisId: current?.analysisId ?? null,
      status: next.status,
      completedFields: [
        next.originNotes,
        next.purposeAudience,
        next.contentForm,
        next.perspectiveBias,
        next.silencesLimits,
        next.authenticityNotes,
        next.representativeness,
        next.corroboration,
        next.questions,
      ].filter((value) => Boolean(value?.trim())).length,
    },
  });
  return analysisFromRow(
    db.prepare('SELECT * FROM archive_source_analyses WHERE item_id=?').get(itemId) as AnalysisRow
  );
}

export function createPersonMention(
  input: Omit<PrimarySourcePersonMention, 'mentionId' | 'createdAt' | 'updatedAt'>
): PrimarySourcePersonMention {
  const mentionId = `apm_${uuid()}`;
  const ts = now();
  getDb().prepare(
    `INSERT INTO archive_person_mentions (
      mention_id, item_id, excerpt_id, person_id, original_label, role, certainty,
      identity_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    mentionId, input.itemId, input.excerptId, input.personId, input.originalLabel,
    input.role, input.certainty, input.identityStatus, ts, ts
  );
  return { ...input, mentionId, createdAt: ts, updatedAt: ts };
}

export function createPlaceMention(
  input: Omit<PrimarySourcePlaceMention, 'mentionId' | 'createdAt' | 'updatedAt'>
): PrimarySourcePlaceMention {
  const mentionId = `alm_${uuid()}`;
  const ts = now();
  getDb().prepare(
    `INSERT INTO archive_place_mentions (
      mention_id, item_id, excerpt_id, place_id, original_label, role, certainty,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    mentionId, input.itemId, input.excerptId, input.placeId, input.originalLabel,
    input.role, input.certainty, input.status, ts, ts
  );
  return { ...input, mentionId, createdAt: ts, updatedAt: ts };
}

export function createNoteLink(
  input: Omit<PrimarySourceNoteLink, 'linkId' | 'createdAt'>
): PrimarySourceNoteLink {
  const linkId = `nlk_${uuid()}`;
  const createdAt = now();
  getDb().prepare(
    `INSERT INTO note_links (
      link_id, nodus_id, target_kind, target_id, excerpt_id, relation_kind, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(nodus_id, target_kind, target_id, relation_kind) DO UPDATE SET excerpt_id=excluded.excerpt_id`
  ).run(linkId, input.nodusId, input.targetKind, input.targetId, input.excerptId, input.relationKind, createdAt);
  const row = getDb().prepare(
    `SELECT * FROM note_links WHERE nodus_id=? AND target_kind=? AND target_id=? AND relation_kind=?`
  ).get(input.nodusId, input.targetKind, input.targetId, input.relationKind) as {
    link_id: string; nodus_id: string; target_kind: PrimarySourceNoteLink['targetKind'];
    target_id: string; excerpt_id: string | null; relation_kind: PrimarySourceNoteLink['relationKind']; created_at: string;
  };
  return {
    linkId: row.link_id, nodusId: row.nodus_id, targetKind: row.target_kind,
    targetId: row.target_id, excerptId: row.excerpt_id,
    relationKind: row.relation_kind, createdAt: row.created_at,
  };
}
