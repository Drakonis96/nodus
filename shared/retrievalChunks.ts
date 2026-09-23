/** Canonical documentary chunker, shared by extraction and background preparation. */
export const RETRIEVAL_CHUNKER_VERSION = "words-280-overlap-60/source-locators/1";
export const RETRIEVAL_CHUNK_WORDS = 280;
export const RETRIEVAL_OVERLAP_WORDS = 60;
function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export interface RetrievalChunk {
  text: string;
  /** The most recent PDF page marker that precedes this chunk, if present. */
  pageLabel: string | null;
  sourceRef: string | null;
  pageNumber: number | null;
}

/**
 * Fine-grained chunks for semantic retrieval. PDF page markers are retained in
 * extraction text, but stripped from the embedded passage and converted to a
 * compact citation location.
 */
export function planRetrievalChunks(
  text: string,
  opts: { chunkWords?: number; overlapWords?: number; sourceMap?: Record<string, string> } = {}
): RetrievalChunk[] {
  const chunkWords = clampInt(opts.chunkWords, RETRIEVAL_CHUNK_WORDS, 80, 1000);
  const overlapWords = clampInt(opts.overlapWords, RETRIEVAL_OVERLAP_WORDS, 0, Math.max(0, chunkWords - 1));
  const tokens: { value: string; pageLabel: string | null; sourceRef: string | null; pageNumber: number | null }[] = [];
  let pageLabel: string | null = null;
  let pageNumber: number | null = null;
  let sourceRef: string | null = null;
  const rawTokens = text.match(/\[\[src:[^\]\s]+(?:\s+p\.\s*\d+)?\]\]|\[\[p\.\s*\d+\]\]|\S+/gi) ?? [];
  for (const raw of rawTokens) {
    const sourceMarker = raw.match(/^\[\[src:([^\]\s]+)(?:\s+p\.\s*(\d+))?\]\]$/i);
    if (sourceMarker) {
      sourceRef = opts.sourceMap?.[sourceMarker[1]] ?? sourceMarker[1];
      pageNumber = sourceMarker[2] ? Number(sourceMarker[2]) : null;
      pageLabel = pageNumber == null ? null : `p. ${pageNumber}`;
      continue;
    }
    const marker = raw.match(/^\[\[p\.\s*(\d+)\]\]$/i);
    if (marker) {
      pageNumber = Number(marker[1]);
      pageLabel = `p. ${pageNumber}`;
      continue;
    }
    tokens.push({ value: raw, pageLabel, sourceRef, pageNumber });
  }
  if (tokens.length === 0) return [];

  const chunks: RetrievalChunk[] = [];
  for (let start = 0; start < tokens.length; ) {
    let sourceEnd = start + 1;
    while (sourceEnd < tokens.length && tokens[sourceEnd].sourceRef === tokens[start].sourceRef) sourceEnd++;
    const end = Math.min(start + chunkWords, sourceEnd);
    const slice = tokens.slice(start, end);
    chunks.push({
      text: slice.map((token) => token.value).join(' '),
      pageLabel: slice[0]?.pageLabel ?? null,
      sourceRef: slice[0]?.sourceRef ?? null,
      pageNumber: slice[0]?.pageNumber ?? null,
    });
    if (end >= sourceEnd) start = sourceEnd;
    else start = Math.max(start + 1, end - overlapWords);
  }
  return chunks;
}

