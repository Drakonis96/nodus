/**
 * Vision analysis of archive images: a consistent, indexable visual description plus
 * a verbatim OCR transcription, so photographed records and pages become searchable.
 * Pure and dependency-free — the prompt, the output guard, and the per-provider
 * multimodal message content builders live here; the electron side supplies the
 * model call.
 *
 * Two provider message shapes are supported: the OpenAI-compatible `image_url`
 * content part (openai, openrouter, gemini, deepseek, xiaomi, ollama, lmstudio) and
 * the Anthropic native `image` block. Both take a base64 data payload.
 */

/** MIME types every supported vision API accepts (OpenAI + Anthropic intersection). */
export const VISION_SUPPORTED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function isVisionMime(mime: string | null | undefined): boolean {
  return VISION_SUPPORTED_MIME.has((mime ?? '').toLowerCase());
}

/**
 * System prompt. The tight word range keeps descriptions consistent in length; the
 * strict JSON shape separates the searchable description from the literal OCR. The
 * output-language directive is appended by the caller, so descriptions follow the
 * user's chosen language.
 */
export const IMAGE_ANALYSIS_SYSTEM = `Eres un archivero que describe imágenes de documentos y fotografías (históricas o familiares) para hacerlas buscables en un archivo de evidencias. Analiza la imagen y devuelve SOLO un objeto JSON con exactamente estos dos campos:

{
  "description": "…",
  "text": "…"
}

- "description": una descripción OBJETIVA y CONSISTENTE de la imagen, en un único párrafo de entre 60 y 100 palabras. Indica qué tipo de material es (fotografía, partida, censo, carta, mapa, grabado…), qué se observa (personas y su disposición, lugar, objetos, vestimenta, época aparente, estado de conservación) y cualquier rasgo visual útil para identificarla o encontrarla. Describe SOLO lo observable; no infieras identidades, nombres ni fechas que no se vean. No empieces con "La imagen muestra" ni añadas preámbulos.
- "text": la transcripción LITERAL de todo el texto legible en la imagen (manuscrito o impreso), tal como aparece, conservando los saltos de línea. Si no hay texto legible, devuelve una cadena vacía "".

No añadas ningún otro campo, comentario ni texto fuera del objeto JSON.`;

export const IMAGE_ANALYSIS_USER = 'Analiza esta imagen y devuelve el JSON con "description" y "text".';

export interface ImageAnalysis {
  description: string;
  text: string;
}

/** Lenient guard: an object; description/text coerced to strings by normalizeAnalysis. */
export function isImageAnalysisShape(v: unknown): v is { description?: unknown; text?: unknown } {
  return !!v && typeof v === 'object';
}

export function normalizeAnalysis(v: { description?: unknown; text?: unknown }): ImageAnalysis {
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '');
  return { description: str(v.description), text: str(v.text) };
}

export interface VisionImagePart {
  base64: string;
  mediaType: string;
}

/** OpenAI-compatible user content: a text part + one image_url part per image. */
export function openAiVisionContent(text: string, images: VisionImagePart[]): unknown[] {
  return [
    { type: 'text', text },
    ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}` } })),
  ];
}

/** Anthropic native user content: a text block + one image block per image. */
export function anthropicVisionContent(text: string, images: VisionImagePart[]): unknown[] {
  return [
    { type: 'text', text },
    ...images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
    })),
  ];
}
