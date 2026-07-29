import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelRef } from '@shared/types';
import {
  assessPrimarySourceCitation,
  decidePrimarySourcePolicy,
  type PrimarySourceBuiltCitation,
  type PrimarySourceCitationBuildRequest,
  type PrimarySourcePolicyAction,
  type PrimarySourcePolicyResult,
  type PrimarySourceToolkitContextPreview,
  type PrimarySourceToolkitOperationId,
  type PrimarySourceToolkitRequest,
  type PrimarySourceToolkitResult,
} from '@shared/primarySourcesTypes';
import {
  primarySourceExcerptDeepLink,
  primarySourceItemDeepLink,
} from '@shared/primarySourceDeepLink';
import { primarySourceToolkitPrompt } from '@shared/primarySourceToolkitPrompts';
import { isLocalProvider } from '@shared/providers';
import { getSettings } from '../db/settingsRepo';
import { getDb } from '../db/database';
import {
  PRIMARY_SOURCE_TOOLKIT_OPERATIONS,
  createPrimarySourceOperationRun,
  finishPrimarySourceOperationRun,
  getPrimarySourceCitationSettings,
  getPrimarySourcePolicySettings,
  listPrimarySourceToolkitItems,
} from '../db/primarySourceGovernanceRepo';
import { getArchiveFileBlob, listArchiveFiles } from '../db/archiveFilesRepo';
import { createPrimarySourceTextVersion } from '../db/archiveTextsRepo';
import { createEntityProposal } from '../db/archiveProposalsRepo';
import { extractFromPath } from '../extraction/textExtractor';
import { completeText } from '../ai/aiClient';
import { transcribeStudyAudio } from '../ai/studyTranscription';
import { transcribeWhisperCpp } from '../stt/whisperCpp';

type ItemPolicyRow = {
  item_id: string;
  title: string;
  access_status: PrimarySourceToolkitContextPreview['items'][number]['accessStatus'];
  sensitivity: PrimarySourceToolkitContextPreview['items'][number]['sensitivity'];
  embargo_until: string | null;
};

type ContextRecord = {
  itemId: string;
  title: string;
  referenceCode: string | null;
  repositoryName: string | null;
  unitTitle: string | null;
  dateDisplay: string | null;
  creatorDisplay: string | null;
  documentType: string | null;
  description: string | null;
  latestText: string | null;
  latestTextKind: string | null;
  latestTextVersionId: string | null;
};

const EXTERNAL_AI_OPERATIONS = new Set<PrimarySourceToolkitOperationId>([
  'transcribe',
  'translate_text',
  'describe_image',
  'suggest_document_type',
  'extract_mentions',
  'compare_documents',
  'summarize_metadata',
  'critical_questions',
  'normalize_dates',
  'suggest_toponyms',
]);

const LOCAL_AI_OPERATIONS = new Set<PrimarySourceToolkitOperationId>([
  'run_ocr',
  ...EXTERNAL_AI_OPERATIONS,
]);

function operation(id: PrimarySourceToolkitOperationId) {
  const found = PRIMARY_SOURCE_TOOLKIT_OPERATIONS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Operación de fuentes primarias desconocida: ${id}`);
  return found;
}

function selectedModel(id: PrimarySourceToolkitOperationId): ModelRef | null {
  const settings = getSettings();
  if (id === 'describe_image') return settings.visionModel ?? settings.extractionModel ?? settings.synthesisModel;
  if (id === 'transcribe') {
    return settings.transcriptionModel?.provider === 'openai' ? settings.transcriptionModel : {
      provider: 'openai',
      model: 'gpt-4o-transcribe',
    };
  }
  return settings.extractionModel ?? settings.synthesisModel;
}

function policyAction(request: PrimarySourceToolkitRequest): PrimarySourcePolicyAction {
  if (request.processingLocation === 'external') return 'external_ai';
  return LOCAL_AI_OPERATIONS.has(request.operationId) ? 'local_ai' : 'view_local';
}

function loadPolicyRows(itemIds: string[]): ItemPolicyRow[] {
  const unique = [...new Set(itemIds.filter((value) => typeof value === 'string' && value.trim()))];
  if (!unique.length) return [];
  const placeholders = unique.map(() => '?').join(',');
  return getDb().prepare(
    `SELECT ai.item_id, ai.title, p.access_status, p.sensitivity, p.embargo_until
       FROM archive_items ai
       JOIN archive_item_profiles p ON p.item_id=ai.item_id
      WHERE ai.item_id IN (${placeholders})`
  ).all(...unique) as ItemPolicyRow[];
}

function contextStats(itemIds: string[], operationId: PrimarySourceToolkitOperationId): {
  filesSent: number;
  textVersionsSent: number;
  contextBytes: number;
  compatibleFileItemIds: string[];
} {
  if (!itemIds.length) {
    return { filesSent: 0, textVersionsSent: 0, contextBytes: 0, compatibleFileItemIds: [] };
  }
  const placeholders = itemIds.map(() => '?').join(',');
  const includeFiles = operationId === 'run_ocr' || operationId === 'transcribe' || operationId === 'describe_image';
  const fileRows = includeFiles ? getDb().prepare(
    `SELECT item_id, mime_type, byte_size
       FROM archive_item_files
      WHERE item_id IN (${placeholders}) AND superseded_at IS NULL
        AND role IN ('master','access') AND content_blob IS NOT NULL
      ORDER BY item_id, CASE role WHEN 'master' THEN 0 ELSE 1 END, sequence_no, version_no DESC`
  ).all(...itemIds) as Array<{
    item_id: string;
    mime_type: string | null;
    byte_size: number;
  }> : [];
  const selectedFiles: typeof fileRows = [];
  const perItem = new Map<string, number>();
  let selectedBytes = 0;
  for (const file of fileRows) {
    const count = perItem.get(file.item_id) ?? 0;
    const compatible = operationId === 'transcribe'
      ? Boolean(file.mime_type?.startsWith('audio/') || file.mime_type?.startsWith('video/'))
      : operationId === 'describe_image'
        ? ['image/png', 'image/jpeg', 'image/webp'].includes(file.mime_type ?? '')
          && file.byte_size <= 10 * 1024 * 1024
        : operationId === 'run_ocr'
          ? Boolean(file.mime_type === 'application/pdf' || file.mime_type?.startsWith('image/'))
          : true;
    const limit = operationId === 'describe_image' ? 4 : 1;
    if (
      !compatible
      || count >= limit
      || (
        operationId === 'describe_image'
        && (selectedFiles.length >= 8 || selectedBytes + file.byte_size > 30 * 1024 * 1024)
      )
    ) continue;
    selectedFiles.push(file);
    selectedBytes += file.byte_size;
    perItem.set(file.item_id, count + 1);
  }
  const selectedFileBytes = selectedFiles.reduce((sum, file) => sum + Number(file.byte_size), 0);
  // Text operations send the complete bounded JSON context, not only the latest
  // text body. Vision sends that JSON plus image bytes. Record the actual outbound
  // payload so metadata-only sources never appear as a misleading "0 bytes".
  const sendsMetadataPayload = !includeFiles || operationId === 'describe_image';
  const contexts = sendsMetadataPayload ? loadContexts(itemIds) : [];
  // Comparison is one multi-source request. All remaining model operations are
  // deliberately isolated per source so their outputs cannot bleed into another
  // dossier; count the exact serialized payload shape sent by that path.
  const metadataPayloadBytes = !sendsMetadataPayload
    ? 0
    : operationId === 'compare_documents'
      ? Buffer.byteLength(contextPayload(contexts), 'utf8')
      : contexts.reduce(
        (sum, context) => sum + Buffer.byteLength(contextPayload([context]), 'utf8'),
        0,
      );
  return {
    filesSent: includeFiles ? selectedFiles.length : 0,
    textVersionsSent: includeFiles
      ? 0
      : contexts.filter((context) => context.latestTextVersionId).length,
    contextBytes: selectedFileBytes + metadataPayloadBytes,
    compatibleFileItemIds: [...new Set(selectedFiles.map((file) => file.item_id))],
  };
}

export function previewPrimarySourceToolkitOperation(
  raw: PrimarySourceToolkitRequest,
): PrimarySourceToolkitContextPreview {
  const spec = operation(raw.operationId);
  const request: PrimarySourceToolkitRequest = {
    ...raw,
    itemIds: [...new Set(raw.itemIds)].slice(0, 100),
    authorizedItemIds: [...new Set(raw.authorizedItemIds ?? [])],
  };
  const rows = loadPolicyRows(request.itemIds);
  const byId = new Map(rows.map((row) => [row.item_id, row]));
  const items = listPrimarySourceToolkitItems().filter((item) => request.itemIds.includes(item.itemId));
  const policySettings = getPrimarySourcePolicySettings();
  const action = policyAction(request);
  const authorizations = new Set(request.authorizedItemIds ?? []);
  const policy: PrimarySourceToolkitContextPreview['policy'] = [];
  const blockedItemIds: string[] = [];
  const confirmationItemIds: string[] = [];
  const includedItemIds: string[] = [];
  for (const itemId of request.itemIds) {
    const row = byId.get(itemId);
    if (!row) continue;
    let result: PrimarySourcePolicyResult = decidePrimarySourcePolicy({
      accessStatus: row.access_status,
      sensitivity: row.sensitivity,
      action,
      embargoUntil: row.embargo_until,
      allowRestrictedLocalAi: policySettings.allowRestrictedLocalAi,
      allowPrivateExternalAi: policySettings.allowPrivateExternalAi,
    });
    // Every outbound context is shown and explicitly authorised. A vault-level
    // private-content preference changes the explanation, never this final consent.
    if (
      request.processingLocation === 'external'
      && policySettings.requireExternalConfirmation
      && result.decision === 'allow'
      && !authorizations.has(itemId)
    ) {
      result = { decision: 'confirm', reason: 'vault_policy' };
    }
    policy.push({ itemId, decision: result.decision, reason: result.reason });
    if (result.decision === 'block' || result.decision === 'redact') {
      blockedItemIds.push(itemId);
      continue;
    }
    if (result.decision === 'confirm' && !authorizations.has(itemId)) {
      confirmationItemIds.push(itemId);
      continue;
    }
    includedItemIds.push(itemId);
  }
  const model = selectedModel(request.operationId);
  const modelIsLocal = model ? isLocalProvider(model.provider) || model.provider === 'nodus' : false;
  const incompatibleLocation = request.processingLocation === 'external'
    ? !spec.externalCapable || !model || modelIsLocal
    : !spec.localCapable || (
      request.operationId === 'translate_text' && (!model || !modelIsLocal)
    );
  const stats = contextStats(includedItemIds, request.operationId);
  const requiresCompatibleFile = request.operationId === 'run_ocr'
    || request.operationId === 'transcribe'
    || request.operationId === 'describe_image';
  const compatibleFileItems = new Set(stats.compatibleFileItemIds);
  const incompatibleItemIds = requiresCompatibleFile
    ? includedItemIds.filter((itemId) => !compatibleFileItems.has(itemId))
    : [];
  return {
    request,
    items,
    includedItemIds,
    blockedItemIds,
    confirmationItemIds,
    incompatibleItemIds,
    filesSent: stats.filesSent,
    textVersionsSent: stats.textVersionsSent,
    contextBytes: stats.contextBytes,
    provider: request.processingLocation === 'external' ? model?.provider ?? null : (
      request.operationId === 'run_ocr' ? 'tesseract.js' :
        request.operationId === 'transcribe' ? 'whisper.cpp' :
          modelIsLocal ? model?.provider ?? null : 'nodus-rules'
    ),
    model: request.processingLocation === 'external'
      ? model?.model ?? null
      : request.operationId === 'transcribe'
        ? getSettings().sttWhisperCppModel
        : modelIsLocal ? model?.model ?? null : null,
    leavesDevice: request.processingLocation === 'external',
    estimatedCost: request.processingLocation === 'external'
      ? 'Depende del proveedor y del modelo configurados.'
      : null,
    expectedResult: spec.resultKind,
    policy,
    canRun: !incompatibleLocation
      && incompatibleItemIds.length === 0
      && confirmationItemIds.length === 0
      && includedItemIds.length >= spec.minItems,
  };
}

function loadContexts(itemIds: string[]): ContextRecord[] {
  if (!itemIds.length) return [];
  const placeholders = itemIds.map(() => '?').join(',');
  const rows = getDb().prepare(
    `SELECT ai.item_id, ai.title, ai.description, ai.doc_type,
            u.reference_code, u.title AS unit_title, u.date_display, u.creator_display,
            r.name AS repository_name,
            (SELECT tv.content FROM archive_text_versions tv
              WHERE tv.item_id=ai.item_id ORDER BY
                CASE tv.status WHEN 'reviewed' THEN 0 WHEN 'closed' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
                tv.created_at DESC LIMIT 1) AS latest_text,
            (SELECT tv.kind FROM archive_text_versions tv
              WHERE tv.item_id=ai.item_id ORDER BY
                CASE tv.status WHEN 'reviewed' THEN 0 WHEN 'closed' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
                tv.created_at DESC LIMIT 1) AS latest_text_kind,
            (SELECT tv.text_version_id FROM archive_text_versions tv
              WHERE tv.item_id=ai.item_id ORDER BY
                CASE tv.status WHEN 'reviewed' THEN 0 WHEN 'closed' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,
                tv.created_at DESC LIMIT 1) AS latest_text_version_id
       FROM archive_items ai
       LEFT JOIN archive_description_units u ON u.unit_id=(
         SELECT iu.unit_id FROM archive_item_units iu
          WHERE iu.item_id=ai.item_id AND iu.relation_kind='describes'
          ORDER BY iu.position LIMIT 1
       )
       LEFT JOIN archive_repositories r ON r.repository_id=u.repository_id
      WHERE ai.item_id IN (${placeholders})`
  ).all(...itemIds) as Array<{
    item_id: string;
    title: string;
    description: string | null;
    doc_type: string | null;
    reference_code: string | null;
    unit_title: string | null;
    date_display: string | null;
    creator_display: string | null;
    repository_name: string | null;
    latest_text: string | null;
    latest_text_kind: string | null;
    latest_text_version_id: string | null;
  }>;
  const order = new Map(itemIds.map((id, index) => [id, index]));
  return rows.map((row) => ({
    itemId: row.item_id,
    title: row.title,
    referenceCode: row.reference_code,
    repositoryName: row.repository_name,
    unitTitle: row.unit_title,
    dateDisplay: row.date_display,
    creatorDisplay: row.creator_display,
    documentType: row.doc_type,
    description: row.description,
    latestText: row.latest_text,
    latestTextKind: row.latest_text_kind,
    latestTextVersionId: row.latest_text_version_id,
  })).sort((a, b) => (order.get(a.itemId) ?? 0) - (order.get(b.itemId) ?? 0));
}

function contextPayload(contexts: ContextRecord[]): string {
  return JSON.stringify(contexts.map((context) => ({
    sourceId: context.itemId,
    title: context.title,
    repository: context.repositoryName,
    reference: context.referenceCode,
    archivalUnit: context.unitTitle,
    literalDate: context.dateDisplay,
    creator: context.creatorDisplay,
    documentType: context.documentType,
    description: context.description,
    text: context.latestText?.slice(0, 40_000) ?? null,
    textKind: context.latestTextKind,
  })), null, 2).slice(0, 120_000);
}

function visionContextImages(itemIds: string[]): Array<{ base64: string; mediaType: string }> {
  const images: Array<{ base64: string; mediaType: string }> = [];
  let bytes = 0;
  for (const itemId of itemIds) {
    let itemImages = 0;
    for (const file of listArchiveFiles(itemId)) {
      if (
        file.supersededAt
        || !['master', 'access'].includes(file.role)
        || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType ?? '')
        || file.byteSize > 10 * 1024 * 1024
        || itemImages >= 4
        || images.length >= 8
        || bytes + file.byteSize > 30 * 1024 * 1024
      ) continue;
      const blob = getArchiveFileBlob(file.fileId);
      if (!blob) continue;
      images.push({
        base64: blob.toString('base64'),
        mediaType: file.mimeType!,
      });
      itemImages += 1;
      bytes += blob.byteLength;
    }
  }
  return images;
}

function technicalLocalResult(
  operationId: PrimarySourceToolkitOperationId,
  context: ContextRecord,
  all: ContextRecord[],
): string {
  if (operationId === 'suggest_document_type') {
    const probe = `${context.title} ${context.description ?? ''}`.toLocaleLowerCase();
    const suggestion = /carta|letter|correspond/.test(probe) ? 'correspondencia'
      : /acta|minute|sesión/.test(probe) ? 'acta'
        : /foto|photograph|imagen/.test(probe) ? 'fotografía'
          : /mapa|map|plano/.test(probe) ? 'mapa o plano'
            : 'tipo pendiente de revisión';
    return `Propuesta de tipo documental: ${suggestion}. Indicios: título, descripción y formato disponibles; requiere revisión humana.`;
  }
  if (operationId === 'summarize_metadata') {
    return [
      context.repositoryName && `Repositorio: ${context.repositoryName}`,
      context.referenceCode && `Referencia: ${context.referenceCode}`,
      context.unitTitle && `Unidad: ${context.unitTitle}`,
      context.creatorDisplay && `Creador literal: ${context.creatorDisplay}`,
      context.dateDisplay && `Fecha literal: ${context.dateDisplay}`,
      context.documentType && `Tipo: ${context.documentType}`,
      !context.repositoryName || !context.referenceCode ? 'Advertencia: procedencia o referencia incompleta.' : null,
    ].filter(Boolean).join(' · ');
  }
  if (operationId === 'critical_questions') {
    return [
      '¿Quién creó el documento, en qué función y con qué propósito?',
      '¿A quién iba dirigido y qué condiciona su forma?',
      '¿Qué afirma literalmente y qué omite?',
      '¿Qué términos, fechas o identidades siguen siendo inciertos?',
      '¿Qué otra fuente permitiría corroborar o contradecir esta información?',
    ].join('\n');
  }
  if (operationId === 'normalize_dates') {
    return context.dateDisplay
      ? `Fecha literal preservada: ${context.dateDisplay}. Propuesta: revisar y registrar un intervalo de ordenación; no convertir la expresión en fecha exacta sin evidencia.`
      : 'No hay fecha literal. No se propone una fecha por ausencia de evidencia.';
  }
  if (operationId === 'suggest_toponyms') {
    const mentions = getDb().prepare(
      `SELECT original_label, role, status FROM archive_place_mentions
        WHERE item_id=? ORDER BY created_at`
    ).all(context.itemId) as Array<{ original_label: string; role: string; status: string }>;
    return mentions.length
      ? mentions.map((mention) => `${mention.original_label} · ${mention.role} · ${mention.status}; conservar alternativas históricas.`).join('\n')
      : 'No hay menciones explícitas de lugar sobre las que proponer candidatos.';
  }
  if (operationId === 'describe_image') {
    const files = listArchiveFiles(context.itemId).filter((file) => !file.supersededAt);
    return files.map((file) =>
      `Representación ${file.sequenceNo + 1}: ${file.mimeType ?? 'formato desconocido'}, ${file.byteSize} bytes, rol ${file.role}. Descripción visual pendiente de revisión; no se identifica ninguna persona.`
    ).join('\n');
  }
  if (operationId === 'extract_mentions') {
    const text = context.latestText ?? '';
    const dates = [...new Set(text.match(/\b(?:\d{1,2}[/-])?(?:\d{1,2}[/-])?\d{4}\b/g) ?? [])].slice(0, 20);
    const names = [...new Set(text.match(/\b[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){1,3}\b/gu) ?? [])].slice(0, 30);
    return `Menciones candidatas (no identidades resueltas):\nNombres: ${names.join('; ') || 'ninguno'}\nFechas literales: ${dates.join('; ') || 'ninguna'}.`;
  }
  if (operationId === 'compare_documents') {
    const basis = new Set((context.latestText ?? '').toLocaleLowerCase().match(/\p{L}{4,}/gu) ?? []);
    return all.filter((candidate) => candidate.itemId !== context.itemId).map((candidate) => {
      const other = new Set((candidate.latestText ?? '').toLocaleLowerCase().match(/\p{L}{4,}/gu) ?? []);
      const shared = [...basis].filter((word) => other.has(word));
      const denominator = new Set([...basis, ...other]).size || 1;
      return `${candidate.title}: solapamiento léxico ${(shared.length / denominator * 100).toFixed(1)} %; ${shared.slice(0, 12).join(', ') || 'sin vocabulario común suficiente'}. No implica duplicidad ni corroboración.`;
    }).join('\n');
  }
  if (operationId === 'detect_duplicates') {
    const files = listArchiveFiles(context.itemId).filter((file) => file.role === 'master' && !file.supersededAt);
    const hashes = files.map((file) => file.contentHash).filter(Boolean);
    const matches = hashes.length ? getDb().prepare(
      `SELECT DISTINCT ai.title FROM archive_item_files f
         JOIN archive_items ai ON ai.item_id=f.item_id
        WHERE f.content_hash IN (${hashes.map(() => '?').join(',')})
          AND f.item_id<>?`
    ).all(...hashes, context.itemId) as Array<{ title: string }> : [];
    return matches.length
      ? `Hash de máster coincidente con: ${matches.map((match) => match.title).join('; ')}. Propuesta de revisión; no se fusionó nada.`
      : 'No se encontraron hashes de máster coincidentes en la selección.';
  }
  if (operationId === 'review_description_quality') {
    const missing = [
      !context.repositoryName && 'repositorio',
      !context.referenceCode && 'referencia',
      !context.unitTitle && 'unidad descriptiva',
      !context.dateDisplay && 'fecha literal',
      !context.documentType && 'tipo documental',
    ].filter(Boolean);
    return missing.length
      ? `Calidad descriptiva: faltan ${missing.join(', ')}.`
      : 'Calidad descriptiva: los campos mínimos están presentes; revisar contenido y restricciones.';
  }
  if (operationId === 'prepare_table' || operationId === 'generate_inventory') {
    return [
      context.title,
      context.repositoryName ?? 'sin repositorio',
      context.referenceCode ?? 'sin referencia',
      context.dateDisplay ?? 'sin fecha',
      context.documentType ?? 'sin tipo',
    ].join(' | ');
  }
  return 'Resultado automático local pendiente de revisión.';
}

function createReportProposal(
  context: ContextRecord,
  operationId: PrimarySourceToolkitOperationId,
  summary: string,
  provider: string | null,
  model: string | null,
) {
  return createEntityProposal({
    itemId: context.itemId,
    excerptId: null,
    proposalKind: 'document_reference',
    payload: {
      operationId,
      result: summary,
      interpretation: true,
      canonicalWrite: false,
    },
    matchedTargetId: null,
    confidence: null,
    rationale: `primary_sources_toolkit:${operationId}`,
    sourceEngine: provider ?? 'nodus-rules',
    sourceModel: model,
  });
}

async function runOcr(itemId: string): Promise<PrimarySourceToolkitResult['outputs'][number]> {
  const file = listArchiveFiles(itemId).find((candidate) =>
    !candidate.supersededAt && ['master', 'access'].includes(candidate.role) && candidate.hasContent
  );
  if (!file) throw new Error('La fuente no tiene una representación legible disponible.');
  const blob = getArchiveFileBlob(file.fileId);
  if (!blob) throw new Error('La representación seleccionada no contiene bytes preservados.');
  const extension = path.extname(file.originalFileName ?? '') || (
    file.mimeType === 'application/pdf' ? '.pdf' : file.mimeType?.startsWith('image/') ? `.${file.mimeType.split('/')[1]}` : '.bin'
  );
  const temp = path.join(os.tmpdir(), `nodus-primary-ocr-${randomUUID()}${extension}`);
  try {
    fs.writeFileSync(temp, blob, { flag: 'wx' });
    const settings = getSettings();
    const extracted = await extractFromPath(temp, {
      ocr: {
        enabled: true,
        languages: settings.ocrLanguages,
        maxPages: settings.ocrMaxPages,
      },
    });
    if (!extracted.text.trim()) throw new Error(extracted.notes || 'El OCR no reconoció texto.');
    const created = createPrimarySourceTextVersion({
      itemId,
      fileId: file.fileId,
      kind: 'ocr',
      languageCode: null,
      content: extracted.text,
      status: 'automatic',
      engine: 'tesseract.js',
      model: settings.ocrLanguages,
      editorialConventions: 'Resultado automático sin revisar. Se preservaron los marcadores de página generados por el motor.',
      createdBy: 'primary_sources_toolkit',
    });
    return {
      itemId,
      label: 'OCR automático creado',
      summary: `${created.version.content.length} caracteres. El máster no se modificó.`,
      targetId: created.version.textVersionId,
      targetKind: 'text_version',
    };
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

async function runTranscription(
  itemId: string,
  location: 'local' | 'external',
): Promise<PrimarySourceToolkitResult['outputs'][number]> {
  const file = listArchiveFiles(itemId).find((candidate) =>
    !candidate.supersededAt
    && ['master', 'access'].includes(candidate.role)
    && Boolean(candidate.mimeType?.startsWith('audio/') || candidate.mimeType?.startsWith('video/'))
    && candidate.hasContent
  );
  if (!file) throw new Error('La fuente no tiene audio o vídeo disponible.');
  const blob = getArchiveFileBlob(file.fileId);
  if (!blob) throw new Error('La representación audiovisual no contiene bytes preservados.');
  const request = {
    audioBytes: new Uint8Array(blob),
    mimeType: file.mimeType ?? 'audio/wav',
    language: 'auto',
    requestId: `primary-source-${randomUUID()}`,
  };
  const result = location === 'external'
    ? await transcribeStudyAudio(request)
    : await transcribeWhisperCpp(request);
  let cursor = 0;
  const segments = result.chunks?.map((chunk, index) => {
    const startOffset = result.text.indexOf(chunk.text, cursor);
    const safeStart = startOffset >= 0 ? startOffset : cursor;
    const endOffset = safeStart + chunk.text.length;
    cursor = endOffset;
    const timestamp = chunk.timestamp;
    return {
      fileId: file.fileId,
      sequenceNo: index,
      startOffset: safeStart,
      endOffset,
      content: result.text.slice(safeStart, endOffset),
      timeStartMs: timestamp?.[0] != null ? Math.round(timestamp[0] * 1000) : undefined,
      timeEndMs: timestamp?.[1] != null ? Math.round(timestamp[1] * 1000) : undefined,
      speakerLabel: chunk.speaker,
    };
  });
  const created = createPrimarySourceTextVersion({
    itemId,
    fileId: file.fileId,
    kind: 'transcription',
    content: result.text,
    status: 'automatic',
    engine: result.provider,
    model: result.model,
    editorialConventions: 'Transcripción automática sin revisar; las marcas temporales se conservan como segmentos.',
    createdBy: 'primary_sources_toolkit',
    segments,
  });
  return {
    itemId,
    label: 'Transcripción automática creada',
    summary: `${created.version.content.length} caracteres. El archivo audiovisual no se modificó.`,
    targetId: created.version.textVersionId,
    targetKind: 'text_version',
  };
}

function runPageSegmentation(
  context: ContextRecord,
): PrimarySourceToolkitResult['outputs'][number] {
  if (!context.latestTextVersionId) {
    throw new Error('La fuente no tiene una versión de texto que segmentar.');
  }
  const source = getDb().prepare(
    `SELECT text_version_id, file_id, kind, language_code, content
       FROM archive_text_versions WHERE text_version_id=?`
  ).get(context.latestTextVersionId) as {
    text_version_id: string;
    file_id: string | null;
    kind: 'ocr' | 'transcription' | 'diplomatic' | 'normalized' | 'translation';
    language_code: string | null;
    content: string;
  } | undefined;
  if (!source) throw new Error('La versión de texto de origen ya no existe.');

  const starts = [0];
  const marker = /(?:^|\n)(?=(?:-{2,}\s*)?(?:p[aá]gina|page|seite|pagina|sayfa)\s+[\wIVXLCDM.-]+)/giu;
  for (const match of source.content.matchAll(marker)) {
    const offset = (match.index ?? 0) + (match[0].startsWith('\n') ? 1 : 0);
    if (offset > 0 && !starts.includes(offset)) starts.push(offset);
  }
  const ordered = starts.sort((a, b) => a - b);
  const segments = ordered.map((startOffset, index) => {
    const endOffset = ordered[index + 1] ?? source.content.length;
    const content = source.content.slice(startOffset, endOffset);
    const heading = content.split(/\r?\n/, 1)[0]?.trim();
    return {
      fileId: source.file_id,
      sequenceNo: index,
      pageLabel: heading && heading.length <= 80 ? heading : `${index + 1}`,
      startOffset,
      endOffset,
      content,
    };
  }).filter((segment) => segment.content.length > 0);
  const created = createPrimarySourceTextVersion({
    itemId: context.itemId,
    fileId: source.file_id,
    parentVersionId: source.text_version_id,
    kind: source.kind,
    languageCode: source.language_code,
    content: source.content,
    status: 'automatic',
    engine: 'nodus-page-segmentation',
    editorialConventions: 'Segmentación automática por marcadores de página; texto literal sin cambios.',
    createdBy: 'primary_sources_toolkit',
    segments,
  });
  return {
    itemId: context.itemId,
    label: 'Segmentación automática creada',
    summary: `${created.segments.length} segmentos. La versión de origen no se modificó.`,
    targetId: created.version.textVersionId,
    targetKind: 'text_version',
  };
}

export async function runPrimarySourceToolkitOperation(
  request: PrimarySourceToolkitRequest,
): Promise<PrimarySourceToolkitResult> {
  const preview = previewPrimarySourceToolkitOperation(request);
  const spec = operation(request.operationId);
  const context = loadContexts(preview.includedItemIds);
  const payload = contextPayload(context);
  const contextHash = createHash('sha256').update(payload).digest('hex');
  const policySummary = Object.entries(
    preview.policy.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.decision] = (counts[entry.decision] ?? 0) + 1;
      return counts;
    }, {})
  ).map(([decision, count]) => `${decision}:${count}`).join(',');
  const runId = createPrimarySourceOperationRun({
    operationId: request.operationId,
    processingLocation: request.processingLocation,
    itemIds: request.itemIds,
    provider: preview.provider,
    model: preview.model,
    contextHash,
    contextBytes: preview.contextBytes,
    leftDevice: preview.leavesDevice,
    policyDecision: policySummary,
    status: preview.canRun ? 'running' : 'blocked',
    resultKind: spec.resultKind,
    errorCode: preview.canRun ? null : 'policy_or_capability',
  });
  if (!preview.canRun) {
    return {
      runId,
      operationId: request.operationId,
      status: 'blocked',
      resultKind: spec.resultKind,
      outputs: [],
      preview,
      completedAt: new Date().toISOString(),
    };
  }
  try {
    const outputs: PrimarySourceToolkitResult['outputs'] = [];
    if (request.operationId === 'run_ocr') {
      for (const itemId of preview.includedItemIds) outputs.push(await runOcr(itemId));
    } else if (request.operationId === 'transcribe') {
      for (const itemId of preview.includedItemIds) {
        outputs.push(await runTranscription(itemId, request.processingLocation));
      }
    } else if (request.operationId === 'segment_pages') {
      for (const item of context) outputs.push(runPageSegmentation(item));
    } else if (
      EXTERNAL_AI_OPERATIONS.has(request.operationId)
      && selectedModel(request.operationId)
      && (
        request.processingLocation === 'external'
        || isLocalProvider(selectedModel(request.operationId)!.provider)
        || selectedModel(request.operationId)!.provider === 'nodus'
      )
    ) {
      const model = selectedModel(request.operationId);
      if (!model) throw new Error('No hay un modelo configurado para esta operación.');
      const system = primarySourceToolkitPrompt(
        getSettings().promptLanguage ?? 'es',
        request.operationId as Parameters<typeof primarySourceToolkitPrompt>[1],
      );
      if (request.operationId === 'translate_text') {
        for (const item of context) {
          if (!item.latestText || !item.latestTextVersionId) {
            throw new Error('La fuente no tiene una versión de texto que traducir.');
          }
          const answer = await completeText({
            system,
            user: contextPayload([item]),
            temperature: 0,
            maxTokens: 6000,
          }, model);
          const source = getDb().prepare(
            'SELECT file_id FROM archive_text_versions WHERE text_version_id=?'
          ).get(item.latestTextVersionId) as { file_id: string | null } | undefined;
          const created = createPrimarySourceTextVersion({
            itemId: item.itemId,
            fileId: source?.file_id ?? null,
            parentVersionId: item.latestTextVersionId,
            kind: 'translation',
            languageCode: getSettings().uiLanguage,
            content: answer,
            status: 'automatic',
            engine: model.provider,
            model: model.model,
            editorialConventions: 'Traducción automática separada; el texto literal de origen no se modificó.',
            createdBy: 'primary_sources_toolkit',
          });
          outputs.push({
            itemId: item.itemId,
            label: spec.label,
            summary: `${created.version.content.length} caracteres; requiere revisión humana.`,
            targetId: created.version.textVersionId,
            targetKind: 'text_version',
          });
        }
      } else if (request.operationId === 'compare_documents') {
        const answer = await completeText({
          system,
          user: payload,
          temperature: 0.1,
          maxTokens: 3000,
        }, model);
        for (const item of context) {
          const proposal = createReportProposal(item, request.operationId, answer, model.provider, model.model);
          outputs.push({
            itemId: item.itemId,
            label: spec.label,
            summary: answer.slice(0, 500),
            targetId: proposal.proposalId,
            targetKind: 'proposal',
          });
        }
      } else {
        // Every non-comparison result belongs to exactly one source. Keeping the
        // provider request source-scoped prevents a model response about document A
        // from being stored as a proposal on document B.
        for (const item of context) {
          const images = request.operationId === 'describe_image'
            ? visionContextImages([item.itemId])
            : undefined;
          if (request.operationId === 'describe_image' && !images?.length) {
            throw new Error(`La fuente «${item.title}» no contiene imágenes PNG, JPEG o WebP compatibles.`);
          }
          const answer = await completeText({
            system,
            user: contextPayload([item]),
            temperature: 0.1,
            maxTokens: 3000,
            images,
          }, model);
          const proposal = createReportProposal(item, request.operationId, answer, model.provider, model.model);
          outputs.push({
            itemId: item.itemId,
            label: spec.label,
            summary: answer.slice(0, 500),
            targetId: proposal.proposalId,
            targetKind: 'proposal',
          });
        }
      }
    } else {
      for (const item of context) {
        const summary = technicalLocalResult(request.operationId, item, context);
        const proposal = createReportProposal(item, request.operationId, summary, preview.provider, preview.model);
        outputs.push({
          itemId: item.itemId,
          label: spec.label,
          summary,
          targetId: proposal.proposalId,
          targetKind: spec.resultKind === 'inventory' || spec.resultKind === 'quality_report' ? 'report' : 'proposal',
        });
      }
    }
    finishPrimarySourceOperationRun(runId, 'completed', spec.resultKind);
    return {
      runId,
      operationId: request.operationId,
      status: 'completed',
      resultKind: spec.resultKind,
      outputs,
      preview,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    const code = error instanceof Error
      ? createHash('sha256').update(error.name).digest('hex').slice(0, 12)
      : 'unknown_error';
    finishPrimarySourceOperationRun(runId, 'failed', spec.resultKind, code);
    throw error;
  }
}

type CitationRow = {
  item_id: string;
  title: string;
  unit_id: string | null;
  unit_title: string | null;
  parent_unit_id: string | null;
  reference_code: string | null;
  date_display: string | null;
  repository_id: string | null;
  repository_name: string | null;
  has_master: number;
};

function citationHierarchy(unitId: string | null): string[] {
  if (!unitId) return [];
  const rows = getDb().prepare(
    'SELECT unit_id, parent_unit_id, title FROM archive_description_units'
  ).all() as Array<{ unit_id: string; parent_unit_id: string | null; title: string }>;
  const byId = new Map(rows.map((row) => [row.unit_id, row]));
  const hierarchy: string[] = [];
  const seen = new Set<string>();
  let current = unitId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const row = byId.get(current);
    if (!row) break;
    hierarchy.unshift(row.title);
    current = row.parent_unit_id ?? '';
  }
  return hierarchy;
}

export function buildPrimarySourceCitation(
  request: PrimarySourceCitationBuildRequest,
): PrimarySourceBuiltCitation {
  const row = getDb().prepare(
    `SELECT ai.item_id, ai.title, u.unit_id, u.title AS unit_title, u.parent_unit_id,
            u.reference_code, u.date_display, r.repository_id, r.name AS repository_name,
            EXISTS(
              SELECT 1 FROM archive_item_files f
               WHERE f.item_id=ai.item_id AND f.role='master'
                 AND f.superseded_at IS NULL AND f.content_blob IS NOT NULL
            ) AS has_master
       FROM archive_items ai
       LEFT JOIN archive_description_units u ON u.unit_id=(
         SELECT iu.unit_id FROM archive_item_units iu
          WHERE iu.item_id=ai.item_id AND iu.relation_kind='describes'
          ORDER BY iu.position LIMIT 1
       )
       LEFT JOIN archive_repositories r ON r.repository_id=u.repository_id
      WHERE ai.item_id=?`
  ).get(request.itemId) as CitationRow | undefined;
  if (!row) throw new Error('La fuente ya no existe.');
  const excerpt = request.excerptId ? getDb().prepare(
    `SELECT excerpt_id, item_id, locator_display
       FROM archive_excerpts WHERE excerpt_id=?`
  ).get(request.excerptId) as { excerpt_id: string; item_id: string; locator_display: string } | undefined : undefined;
  if (excerpt && excerpt.item_id !== request.itemId) {
    throw new Error('El fragmento no pertenece a esta fuente.');
  }
  const settings = getPrimarySourceCitationSettings();
  const hierarchy = citationHierarchy(row.unit_id);
  const repository = settings.repositoryAliases[row.repository_id ?? '']
    ?? settings.repositoryAliases[row.repository_name ?? '']
    ?? row.repository_name;
  const deepLink = excerpt
    ? primarySourceExcerptDeepLink(request.itemId, excerpt.excerpt_id)
    : primarySourceItemDeepLink(request.itemId);
  const structured: PrimarySourceBuiltCitation['structured'] = {
    repository: repository ?? undefined,
    hierarchy: hierarchy.length > 1 ? hierarchy.slice(0, -1).join(', ') : undefined,
    reference: row.reference_code ?? undefined,
    title: row.unit_title ?? row.title,
    date: row.date_display ?? undefined,
    locator: excerpt?.locator_display,
    version_url: deepLink,
    accessed: settings.includeAccessedDate
      ? (request.accessedAt ?? new Date().toISOString()).slice(0, 10)
      : undefined,
  };
  const parts = settings.fieldOrder.flatMap((field) => {
    const value = structured[field]?.trim();
    return value ? [{ field, value }] : [];
  });
  const generated = parts.map(({ field, value }) =>
    field === 'title' ? `“${value}”` : value
  ).join(', ');
  const text = request.customText?.trim() || generated;
  const baseAssessment = assessPrimarySourceCitation({
    repositoryName: repository,
    referenceCode: row.reference_code,
    unitTitle: row.unit_title ?? row.title,
    excerpt: excerpt ? { locatorDisplay: excerpt.locator_display } : null,
    hasPreservedMaster: Boolean(row.has_master),
  });
  const requiredAssessmentFields = new Set(
    settings.requiredFields.map((field) => field === 'title' ? 'unit' : field)
  );
  const missing = baseAssessment.missing.filter((field) => requiredAssessmentFields.has(field));
  const assessment: PrimarySourceBuiltCitation['assessment'] = {
    missing,
    status: missing.length === 0
      ? 'ready'
      : missing.length === 1 && missing[0] === 'locator'
        ? 'general_locator'
        : 'not_ready',
  };
  return {
    itemId: request.itemId,
    excerptId: excerpt?.excerpt_id ?? null,
    text,
    markdown: `[${text}](${deepLink})`,
    deepLink,
    structured,
    assessment,
    editedText: Boolean(request.customText?.trim()),
  };
}
