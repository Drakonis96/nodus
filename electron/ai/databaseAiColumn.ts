// Orchestrates AI columns: builds a row's context, runs the column's prompt against
// the configured model (optionally with an attached image for vision), and writes the
// result back into the cell. The completion is injectable so the logic is unit-tested
// without a provider.

import { getSettings } from '../db/settingsRepo';
import {
  getColumn,
  getDatabaseDetail,
  getRow,
  listAttachments,
  getAttachmentBlob,
  setCell,
  listRows,
} from '../db/databasesRepo';
import { AI_COLUMN_SYSTEM, buildAiCellPrompt, buildAiRowContext } from '@shared/databaseAi';
import { attachmentKind } from '@shared/databases';
import { isVisionMime } from '@shared/imageAnalysis';
import type { ModelRef } from '@shared/types';
import type { VisionImagePart } from '@shared/imageAnalysis';

export interface AiCellDeps {
  /** Injectable completion (defaults to the real model call). */
  complete?: (opts: {
    system: string;
    user: string;
    images?: VisionImagePart[];
    maxTokens?: number;
    temperature?: number;
    plainContext?: boolean;
  }, model?: ModelRef | null) => Promise<string>;
  model?: ModelRef | null;
  visionModel?: ModelRef | null;
}

/** Collect up to `limit` images from the AI column's configured source attachment column. */
function sourceImages(rowId: string, sourceColumnId: string | undefined, limit = 2): VisionImagePart[] {
  if (!sourceColumnId) return [];
  const parts: VisionImagePart[] = [];
  for (const att of listAttachments(rowId, sourceColumnId)) {
    if (attachmentKind(att.mimeType) !== 'image' || !isVisionMime(att.mimeType)) continue;
    const blob = getAttachmentBlob(att.id);
    if (!blob) continue;
    parts.push({ base64: blob.toString('base64'), mediaType: (att.mimeType ?? 'image/png').toLowerCase() });
    if (parts.length >= limit) break;
  }
  return parts;
}

/** Compute one AI cell and persist it; returns the produced text. */
export async function runAiCell(rowId: string, columnId: string, deps: AiCellDeps = {}): Promise<string> {
  const col = getColumn(columnId);
  if (!col || col.type !== 'ai') throw new Error('La columna no es de tipo IA.');
  const prompt = String(col.config.aiPrompt ?? '').trim();
  if (!prompt) throw new Error('Esta columna de IA no tiene un prompt configurado.');

  const detail = getDatabaseDetail(col.databaseId);
  const row = getRow(rowId);
  if (!detail || !row) throw new Error('Fila no encontrada.');

  const context = buildAiRowContext(detail.columns, row, { excludeColumnId: columnId });
  const images = sourceImages(rowId, col.config.aiSourceColumnId as string | undefined);

  const settings = getSettings();
  const model = deps.model ?? settings.chatModel ?? settings.synthesisModel ?? null;
  const visionModel = deps.visionModel ?? settings.visionModel ?? settings.extractionModel ?? settings.synthesisModel ?? model;
  if (!deps.complete && images.length === 0 && !model) {
    throw new Error('No hay un modelo de IA configurado. Elígelo en Ajustes.');
  }

  // Lazy-load the AI client so the module stays light to unit-test with a fake `complete`.
  const complete =
    deps.complete ??
    (async (opts, m) => {
      const { completeText } = await import('./aiClient');
      return completeText(opts, m);
    });
  const text = await complete(
    {
      system: AI_COLUMN_SYSTEM,
      user: buildAiCellPrompt(prompt, context),
      images: images.length ? images : undefined,
      plainContext: true,
      temperature: 0.2,
      maxTokens: 1200,
    },
    images.length ? visionModel : model
  );
  const result = text.trim();
  setCell(rowId, columnId, result || null);
  return result;
}

/** Run an AI column over every row of its database, reporting progress. */
export async function runAiColumn(
  databaseId: string,
  columnId: string,
  onProgress?: (done: number, total: number) => void,
  deps: AiCellDeps = {}
): Promise<{ done: number; failed: number }> {
  const rows = listRows(databaseId);
  let done = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await runAiCell(row.id, columnId, deps);
    } catch {
      failed++;
    }
    done++;
    onProgress?.(done, rows.length);
  }
  return { done, failed };
}
