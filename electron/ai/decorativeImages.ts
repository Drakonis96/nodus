import { nativeImage } from 'electron';
import { GoogleGenAI } from '@google/genai';
import type {
  DecorativeImage,
  DecorativeImageActionRequest,
  DecorativeImageEntityKind,
  DecorativeImageOption,
  DecorativeImageStyle,
  ImageProvider,
  ModelRef,
} from '@shared/types';
import { buildDecorativeImagePrompt, DEFAULT_DECORATIVE_IMAGE_STYLE } from '@shared/imageStyles';
import { vaultTypeImagePrompt } from '@shared/vaultTypes';
import { getActiveVault } from '../vaults/vaultRegistry';
import { completeText } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import { getApiKey } from '../secrets/secretStore';
import {
  getDecorativeImage,
  markDecorativeImageNotRequested,
  markDecorativeImagePending,
  removeDecorativeImage,
  restorePreviousDecorativeImage,
  saveCustomDecorativeImageReady,
  saveDecorativeImageFailure,
  saveDecorativeImagePrompt,
  saveDecorativeImageReady,
} from '../db/decorativeImagesRepo';
import { getDb } from '../db/database';

const IMAGE_TIMEOUT_MS = 120_000;
const IMAGE_CONTEXT_TIMEOUT_MS = 45_000;
const active = new Map<string, symbol>();

interface ImageSource {
  title: string;
  content: string;
  textModel: ModelRef | null;
}

interface GeneratedImageBytes {
  bytes: Buffer;
  mimeType: string;
}

function taskKey(kind: DecorativeImageEntityKind, id: string): string {
  return `${kind}:${id}`;
}

function parseModel(value: string | null): ModelRef | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ModelRef>;
    return parsed.provider && parsed.model ? (parsed as ModelRef) : null;
  } catch {
    return null;
  }
}

function imageSource(kind: DecorativeImageEntityKind, id: string): ImageSource {
  if (kind === 'immersion') {
    const row = getDb()
      .prepare('SELECT title, topic, plan_json, model_json FROM immersion_sessions WHERE id = ?')
      .get(id) as { title: string; topic: string; plan_json: string; model_json: string | null } | undefined;
    if (!row) throw new Error('La inmersión ya no existe.');
    let plan: { overview?: string; keyTerms?: Array<{ term?: string }> } = {};
    try {
      plan = JSON.parse(row.plan_json) as typeof plan;
    } catch {
      /* the title/topic still provide a safe fallback */
    }
    return {
      title: row.title || row.topic,
      content: [row.topic, plan.overview, plan.keyTerms?.map((term) => term.term).filter(Boolean).join(', ')]
        .filter(Boolean)
        .join('\n')
        .slice(0, 2200),
      textModel: parseModel(row.model_json),
    };
  }
  const row = getDb()
    .prepare('SELECT title, draft_json, model_json FROM writing_saved_drafts WHERE id = ?')
    .get(id) as { title: string; draft_json: string; model_json: string | null } | undefined;
  if (!row) throw new Error('El informe guardado ya no existe.');
  let draft: { abstract?: string; draftMarkdown?: string; brief?: { objective?: string } } = {};
  try {
    draft = JSON.parse(row.draft_json) as typeof draft;
  } catch {
    /* the title still provides a safe fallback */
  }
  return {
    title: row.title,
    content: [draft.brief?.objective, draft.abstract, draft.draftMarkdown]
      .filter(Boolean)
      .join('\n')
      .slice(0, 2400),
    textModel: parseModel(row.model_json),
  };
}

async function visualContextFor(source: ImageSource): Promise<string> {
  const settings = getSettings();
  const model = source.textModel ?? settings.synthesisModel ?? null;
  if (!model) throw new Error('No hay un modelo de texto configurado para crear el contexto visual.');
  const response = await completeText(
    {
      system: [
        'Describe una sola escena visual concreta que represente el contenido dado.',
        'Máximo 45 palabras. Solo la escena: sin títulos, texto visible, letras, logos ni explicaciones.',
      ].join('\n'),
      user: `Título: ${source.title}\nContenido: ${source.content}`,
      temperature: 0.2,
      maxTokens: 100,
      noRetry: true,
      timeoutMs: IMAGE_CONTEXT_TIMEOUT_MS,
    },
    model
  );
  const clean = response.replace(/\s+/g, ' ').trim().slice(0, 260);
  if (!clean) throw new Error('El modelo de texto no devolvió un contexto visual.');
  return clean;
}

function providerKey(provider: ImageProvider): string | null {
  if (provider === 'google') return getApiKey('gemini');
  return getApiKey(provider);
}

async function generateGoogle(model: string, prompt: string, key: string): Promise<GeneratedImageBytes> {
  const client = new GoogleGenAI({ apiKey: key });
  const response = await client.interactions.create(
    {
      model,
      input: prompt,
      store: false,
      response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: '16:9', image_size: '1K' },
    },
    { timeout: IMAGE_TIMEOUT_MS, maxRetries: 0 }
  );
  const data = response.output_image?.data;
  if (!data) throw new Error('Google no devolvió datos de imagen.');
  return { bytes: Buffer.from(data, 'base64'), mimeType: 'image/jpeg' };
}

async function postBase64Image(url: string, body: Record<string, unknown>, key: string): Promise<GeneratedImageBytes> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: Array<{ b64_json?: string; media_type?: string }>;
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
    const item = payload.data?.[0];
    const encoded = item?.b64_json;
    if (!encoded) throw new Error('El proveedor no devolvió datos de imagen.');
    return { bytes: Buffer.from(encoded, 'base64'), mimeType: item?.media_type ?? 'image/jpeg' };
  } finally {
    clearTimeout(timer);
  }
}

function generateOpenAI(model: string, prompt: string, key: string): Promise<GeneratedImageBytes> {
  return postBase64Image(
    'https://api.openai.com/v1/images/generations',
    {
      model,
      prompt,
      n: 1,
      size: '1536x1024',
      quality: 'low',
      output_format: 'jpeg',
      output_compression: 82,
    },
    key
  );
}

function generateOpenRouter(model: string, prompt: string, key: string): Promise<GeneratedImageBytes> {
  // Model endpoints expose different optional knobs. Keeping the request to the
  // documented common denominator (plus an explicit single output) prevents a
  // provider-specific parameter from making an otherwise compatible model fail.
  return postBase64Image('https://openrouter.ai/api/v1/images', { model, prompt, n: 1 }, key);
}

async function callImageProvider(provider: ImageProvider, model: string, prompt: string): Promise<GeneratedImageBytes> {
  const key = providerKey(provider);
  if (!key) throw new Error(`Falta la clave de ${provider === 'google' ? 'Google' : provider === 'openai' ? 'OpenAI' : 'OpenRouter'}.`);
  switch (provider) {
    case 'google':
      return generateGoogle(model, prompt, key);
    case 'openai':
      return generateOpenAI(model, prompt, key);
    case 'openrouter':
      return generateOpenRouter(model, prompt, key);
  }
}

async function optimizedJpegs(generated: GeneratedImageBytes): Promise<{ image: Buffer; thumbnail: Buffer }> {
  const source = nativeImage.createFromBuffer(generated.bytes);
  if (!source.isEmpty()) {
    const size = source.getSize();
    const fullWidth = Math.min(1280, size.width);
    const image = source.resize({ width: fullWidth, quality: 'best' }).toJPEG(84);
    const thumbnail = source.resize({ width: Math.min(360, size.width), quality: 'good' }).toJPEG(72);
    return { image, thumbnail };
  }

  // OpenRouter can legitimately return WebP or SVG. Electron's nativeImage is
  // intentionally conservative, so rasterize those documented image outputs
  // through the already-bundled local canvas library before persistence.
  try {
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');
    const loaded = await loadImage(generated.bytes);
    if (!loaded.width || !loaded.height) throw new Error('Tamaño de imagen no válido.');
    const render = (width: number, quality: number): Buffer => {
      const height = Math.max(1, Math.round(width * (loaded.height / loaded.width)));
      const canvas = createCanvas(width, height);
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(loaded, 0, 0, width, height);
      return canvas.toBuffer('image/jpeg', quality);
    };
    return {
      image: render(Math.min(1280, loaded.width), 84),
      thumbnail: render(Math.min(360, loaded.width), 72),
    };
  } catch {
    throw new Error(`El proveedor devolvió una imagen ${generated.mimeType || 'desconocida'} que no pudo procesarse.`);
  }
}

async function runGeneration(
  request: DecorativeImageActionRequest,
  token: symbol,
  onChanged?: (image: DecorativeImage) => void
): Promise<void> {
  const key = taskKey(request.entityKind, request.entityId);
  try {
    if (active.get(key) !== token) return;
    const pending = getDecorativeImage(request.entityKind, request.entityId);
    if (!pending?.provider || !pending.model) throw new Error('No hay proveedor o modelo de imagen seleccionado.');
    let prompt = pending.prompt;
    if (!prompt) {
      const context = pending.visualContext || await visualContextFor(imageSource(request.entityKind, request.entityId));
      if (active.get(key) !== token) return;
      prompt = buildDecorativeImagePrompt(pending.style, context, vaultTypeImagePrompt(getActiveVault().type));
      saveDecorativeImagePrompt(request.entityKind, request.entityId, context, prompt);
    }
    if (active.get(key) !== token) return;
    const generated = await callImageProvider(pending.provider, pending.model, prompt);
    const optimized = await optimizedJpegs(generated);
    // A delete or a newer attempt invalidates this task. The provider call may
    // already have completed, but stale work must never restore or overwrite an
    // image the user removed/regenerated in the meantime.
    if (active.get(key) !== token) return;
    onChanged?.(saveDecorativeImageReady(request.entityKind, request.entityId, optimized.image, optimized.thumbnail));
  } catch (error) {
    if (active.get(key) !== token) return;
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'La generación superó el tiempo máximo. Puedes reintentarlo manualmente.'
      : error instanceof Error
        ? error.message
        : String(error);
    onChanged?.(saveDecorativeImageFailure(request.entityKind, request.entityId, message));
  } finally {
    if (active.get(key) === token) active.delete(key);
  }
}

/** Persist pending immediately, then run entirely outside the owner workflow. */
export function queueDecorativeImageGeneration(
  request: DecorativeImageActionRequest,
  onChanged?: (image: DecorativeImage) => void
): DecorativeImage {
  const key = taskKey(request.entityKind, request.entityId);
  const current = getDecorativeImage(request.entityKind, request.entityId);
  if (active.has(key) && current) return current;
  if (request.action === 'generate' && current?.status === 'ready') return current;
  if (request.action === 'retry' && current?.status !== 'failed') return current ?? markNotRequested(request.entityKind, request.entityId);

  const settings = getSettings();
  const provider = request.action === 'retry' && current?.provider ? current.provider : settings.imageProvider;
  const model = request.action === 'retry' && current?.model ? current.model : settings.imageModel;
  // A retry repeats the exact failed request. Changing style is a regeneration,
  // which the UI confirms as a new cost.
  const style = request.action === 'retry' && current?.style
    ? current.style
    : request.style ?? current?.style ?? settings.imageStyle ?? DEFAULT_DECORATIVE_IMAGE_STYLE;
  // A user-edited scene description overrides the stored context; the prompt is
  // rebuilt for the chosen style so the "no text" guardrails always survive.
  const editedContext = request.action !== 'retry' ? request.visualContext?.replace(/\s+/g, ' ').trim() : undefined;
  const pending = markDecorativeImagePending({
    entityKind: request.entityKind,
    entityId: request.entityId,
    provider,
    model,
    style,
    preserveContext: !editedContext && (request.action === 'retry' || request.action === 'regenerate'),
    preservePrompt: request.action === 'retry',
  });
  if (editedContext) {
    const context = editedContext.slice(0, 260);
    saveDecorativeImagePrompt(request.entityKind, request.entityId, context, buildDecorativeImagePrompt(style, context));
  }
  const token = Symbol(key);
  active.set(key, token);
  setTimeout(() => void runGeneration(request, token, onChanged), 0);
  return editedContext ? getDecorativeImage(request.entityKind, request.entityId) ?? pending : pending;
}

export function markNotRequested(
  entityKind: DecorativeImageEntityKind,
  entityId: string,
  style: DecorativeImageStyle = getSettings().imageStyle
): DecorativeImage {
  return markDecorativeImageNotRequested(entityKind, entityId, style);
}

export function applyDecorativeImageOption(
  entityKind: DecorativeImageEntityKind,
  entityId: string,
  option: DecorativeImageOption | undefined,
  onChanged?: (image: DecorativeImage) => void
): DecorativeImage {
  if (!option?.enabled) return markNotRequested(entityKind, entityId, option?.style);
  return queueDecorativeImageGeneration(
    { entityKind, entityId, action: 'generate', style: option.style },
    onChanged
  );
}

export function deleteDecorativeImage(entityKind: DecorativeImageEntityKind, entityId: string): DecorativeImage {
  invalidateDecorativeImageGeneration(entityKind, entityId);
  return removeDecorativeImage(entityKind, entityId);
}

/** Persist a user-supplied image. The renderer pre-shrinks it; here it goes
 *  through the same JPEG/thumbnail pipeline as generated images so storage stays
 *  small and consistent regardless of the original file. */
export async function saveCustomDecorativeImage(
  entityKind: DecorativeImageEntityKind,
  entityId: string,
  bytes: Buffer,
  style?: DecorativeImageStyle
): Promise<DecorativeImage> {
  // Any in-flight generation must not overwrite the image the user just chose.
  invalidateDecorativeImageGeneration(entityKind, entityId);
  if (!bytes.length) throw new Error('El archivo de imagen está vacío.');
  const optimized = await optimizedJpegs({ bytes, mimeType: 'image/jpeg' });
  return saveCustomDecorativeImageReady(
    entityKind,
    entityId,
    optimized.image,
    optimized.thumbnail,
    style ?? getDecorativeImage(entityKind, entityId)?.style ?? getSettings().imageStyle
  );
}

/** Restore the image that preceded the last regeneration or upload. */
export function revertDecorativeImage(entityKind: DecorativeImageEntityKind, entityId: string): DecorativeImage {
  // Discard any pending generation so it cannot clobber the restored image.
  invalidateDecorativeImageGeneration(entityKind, entityId);
  return restorePreviousDecorativeImage(entityKind, entityId);
}

export function invalidateDecorativeImageGeneration(
  entityKind: DecorativeImageEntityKind,
  entityId: string
): void {
  active.delete(taskKey(entityKind, entityId));
}

/** End process-local tasks before a vault switch/reset or app shutdown. */
export function interruptDecorativeImageGenerations(
  reason = 'La generación se interrumpió al cambiar de bóveda o cerrar la aplicación. Puedes reintentarlo manualmente.'
): void {
  for (const key of active.keys()) {
    const separator = key.indexOf(':');
    const entityKind = key.slice(0, separator) as DecorativeImageEntityKind;
    const entityId = key.slice(separator + 1);
    const current = getDecorativeImage(entityKind, entityId);
    if (current?.status === 'pending') saveDecorativeImageFailure(entityKind, entityId, reason);
  }
  active.clear();
}
