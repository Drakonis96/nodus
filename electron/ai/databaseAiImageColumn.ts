// Orchestrates 'ai_image' columns: builds a text-to-image prompt from the column's
// instruction plus the row's data, generates an image with the configured image
// provider, and stores the result as an AI-flagged attachment on the cell. The image
// generator is injectable so the logic is unit-tested without a provider.

import { getSettings } from '../db/settingsRepo';
import {
  getColumn,
  getDatabaseDetail,
  getRow,
  listAttachments,
  deleteAttachment,
  addAttachment,
  listRows,
} from '../db/databasesRepo';
import { buildAiImagePrompt, buildAiRowContext } from '@shared/databaseAi';
import type { DatabaseAttachment } from '@shared/databases';
import type { ImageProvider } from '@shared/types';

interface AiImageModelRef {
  provider: ImageProvider;
  model: string;
}

export interface AiImageDeps {
  /** Injectable image generation (defaults to the real multi-provider pipeline). */
  generate?: (prompt: string, model: AiImageModelRef | null) => Promise<{ image: Buffer; mimeType: string }>;
}

const IMAGE_PROVIDERS = new Set<ImageProvider>(['google', 'openai', 'openrouter']);

function configuredImageModel(value: unknown): AiImageModelRef | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<AiImageModelRef>;
  if (!candidate.provider || !IMAGE_PROVIDERS.has(candidate.provider)) return null;
  if (typeof candidate.model !== 'string' || !candidate.model.trim()) return null;
  return { provider: candidate.provider, model: candidate.model.trim() };
}

/** Generate one AI image for a cell and persist it as its (single) attachment. */
export async function runAiImageCell(rowId: string, columnId: string, deps: AiImageDeps = {}): Promise<DatabaseAttachment> {
  const col = getColumn(columnId);
  if (!col || col.type !== 'ai_image') throw new Error('La columna no es de tipo Imagen IA.');
  const prompt = String(col.config.aiPrompt ?? '').trim();
  if (!prompt) throw new Error('Esta columna de Imagen IA no tiene un prompt configurado.');

  const detail = getDatabaseDetail(col.databaseId);
  const row = getRow(rowId);
  if (!detail || !row) throw new Error('Fila no encontrada.');

  const context = buildAiRowContext(detail.columns, row, { excludeColumnId: columnId });
  const fullPrompt = buildAiImagePrompt(prompt, context);

  const generate = deps.generate ?? realGenerate;
  const { image, mimeType } = await generate(fullPrompt, configuredImageModel(col.config.aiImageModel));
  if (!image?.length) throw new Error('El proveedor no devolvió una imagen.');

  // An AI-image cell holds a single current image: replace whatever was there.
  for (const prev of listAttachments(rowId, columnId)) deleteAttachment(prev.id);

  return addAttachment({
    rowId,
    columnId,
    fileName: `${(col.name || 'imagen').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 40)}.jpg`,
    mimeType: mimeType || 'image/jpeg',
    bytes: image.length,
    blob: image,
    aiGenerated: true,
    aiPrompt: fullPrompt,
  });
}

/** Real generation: lazy-loaded so tests never pull the image SDKs. */
async function realGenerate(prompt: string, columnModel: AiImageModelRef | null): Promise<{ image: Buffer; mimeType: string }> {
  const settings = getSettings();
  const provider = columnModel?.provider ?? settings.imageProvider;
  const model = columnModel?.model ?? settings.imageModel;
  if (!provider || !model) {
    throw new Error('Configura un proveedor y modelo de imagen en Ajustes → Proveedores.');
  }
  const { callImageProvider, optimizedJpegs } = await import('./decorativeImages');
  const generated = await callImageProvider(provider, model, prompt);
  const optimized = await optimizedJpegs(generated);
  return { image: optimized.image, mimeType: 'image/jpeg' };
}

/** Generate AI images for every row of an ai_image column, reporting progress. */
export async function runAiImageColumn(
  databaseId: string,
  columnId: string,
  onProgress?: (done: number, total: number) => void,
  deps: AiImageDeps = {}
): Promise<{ done: number; failed: number }> {
  const rows = listRows(databaseId);
  let done = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await runAiImageCell(row.id, columnId, deps);
    } catch {
      failed++;
    }
    done++;
    onProgress?.(done, rows.length);
  }
  return { done, failed };
}
