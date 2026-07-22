// Nodus Translate — structure-preserving segment batching.
//
// A document is decomposed into stable-id segments by its format adapter. The model
// sees several segments at once for efficiency and terminology consistency, while the
// sentinel protocol lets us prove that every source segment came back exactly once.
// Missing/mangled segments are retried individually; the pipeline never silently drops
// document content because a model forgot a marker.
import type {
  TranslateMarkupKind,
  TranslateSegment,
  TranslateSegmentResult,
} from '@shared/toolkitTranslateTypes';

export interface SegmentTranslationCall {
  (input: { system: string; user: string; maxTokens: number; temperature: number }): Promise<string>;
}

export interface SegmentTranslationOptions {
  targetLanguage: string;
  sourceLanguage?: string | null;
  glossary?: string;
  maxChars?: number;
  signal?: { cancelled: boolean };
  onProgress?: (done: number, total: number) => void;
}

const DEFAULT_BATCH_CHARS = 7_500;
const OPEN = '<<<NODUS_SEGMENT:';
const CLOSE = '<<<NODUS_END:';

function formatRules(kind: TranslateMarkupKind): string {
  switch (kind) {
    case 'markdown':
      return 'Preserve every Markdown marker, heading level, list marker, table pipe, URL, code span and math expression. Translate only human-readable prose.';
    case 'html':
      return 'Preserve every HTML/XML tag, attribute, entity, URL and element order byte-for-byte where possible. Translate only visible human-readable text between tags.';
    case 'xml':
      return 'Preserve every <n id="…"> and </n> tag with the same id and nesting. Translate only the human-readable text inside those tags.';
    default:
      return 'Return faithful translated prose. Preserve numbers, citation keys, URLs, code and mathematical notation.';
  }
}

function systemPrompt(segments: TranslateSegment[], options: SegmentTranslationOptions): string {
  const kinds = [...new Set(segments.map((segment) => segment.kind))];
  const source = options.sourceLanguage?.trim()
    ? `The source language is ${options.sourceLanguage.trim()}.`
    : 'Detect the source language independently for each segment.';
  const glossary = options.glossary?.trim()
    ? `\nMANDATORY GLOSSARY (source=target, one entry per line):\n${options.glossary.trim()}\n`
    : '';
  return `You are an expert academic and publishing translator. Translate every supplied segment into ${options.targetLanguage}.

${source}
Return ONLY the sentinel-delimited segments, in the same order, with every id exactly once.
Never translate, remove or alter a sentinel line.
Do not summarize, explain, add or omit content.
Keep terminology consistent across all segments in this request.
${kinds.map(formatRules).join('\n')}${glossary}`;
}

function encodeSegment(segment: TranslateSegment): string {
  return `${OPEN}${segment.id}>>>\n${segment.text}\n${CLOSE}${segment.id}>>>`;
}

export function parseTranslatedSegments(output: string): Map<string, string> {
  const parsed = new Map<string, string>();
  const pattern = /<<<NODUS_SEGMENT:([^>\r\n]+)>>>(?:\r?\n)?([\s\S]*?)(?:\r?\n)?<<<NODUS_END:\1>>>/g;
  for (const match of output.matchAll(pattern)) {
    const id = match[1].trim();
    if (id && !parsed.has(id)) parsed.set(id, match[2].trim());
  }
  return parsed;
}

function batchesFor(segments: TranslateSegment[], maxChars: number): TranslateSegment[][] {
  const batches: TranslateSegment[][] = [];
  let current: TranslateSegment[] = [];
  let chars = 0;
  for (const segment of segments) {
    const cost = segment.text.length + segment.id.length * 2 + 64;
    if (current.length && chars + cost > maxChars) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(segment);
    chars += cost;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function translateBatch(
  batch: TranslateSegment[],
  options: SegmentTranslationOptions,
  call: SegmentTranslationCall,
): Promise<Map<string, string>> {
  const output = await call({
    system: systemPrompt(batch, options),
    user: batch.map(encodeSegment).join('\n\n'),
    maxTokens: Math.max(1_500, Math.min(12_000, Math.ceil(batch.reduce((n, s) => n + s.text.length, 0) / 2.2))),
    temperature: 0.15,
  });
  return parseTranslatedSegments(output);
}

/** Translate every segment without accepting silent loss. A malformed batch response
 * gets one isolated retry per missing id, producing a precise error if the chosen model
 * cannot obey the protocol even for a single segment. */
export async function translateSegments(
  segments: TranslateSegment[],
  options: SegmentTranslationOptions,
  call: SegmentTranslationCall,
): Promise<TranslateSegmentResult[]> {
  const nonEmpty = segments.filter((segment) => segment.text.trim());
  const translated = new Map<string, string>();
  const batches = batchesFor(nonEmpty, Math.max(1_000, options.maxChars ?? DEFAULT_BATCH_CHARS));
  options.onProgress?.(0, nonEmpty.length);
  let done = 0;
  for (const batch of batches) {
    if (options.signal?.cancelled) break;
    const parsed = await translateBatch(batch, options, call);
    for (const segment of batch) {
      if (options.signal?.cancelled) break;
      let value = parsed.get(segment.id);
      if (value == null) {
        const retry = await translateBatch([segment], options, call);
        value = retry.get(segment.id);
      }
      if (value == null) {
        throw new Error(`El modelo no devolvió el fragmento ${segment.id}. Prueba con otro modelo o reduce el documento.`);
      }
      translated.set(segment.id, value);
      done += 1;
      options.onProgress?.(done, nonEmpty.length);
    }
  }
  return segments.map((segment) => ({
    ...segment,
    translated: segment.text.trim() ? (translated.get(segment.id) ?? segment.text) : segment.text,
  }));
}
