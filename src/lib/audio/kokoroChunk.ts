// Kokoro's tokenizer caps input at ~512 tokens and `generate()` /
// `generate_from_ids()` clamp the token dimension to 509 — anything longer is
// SILENTLY truncated, cutting narration off mid-sentence, even mid-word. A single
// Deep Research segment can be ~2600 characters, far past that ceiling, so we
// split it into short, sentence-aligned pieces before synthesis and concatenate
// the audio back together. Kept free of the kokoro-js runtime so the pure text /
// PCM helpers can be unit-tested without loading the WASM model.

// Conservative character budget per synthesis call. Kokoro phoneme tokens track
// characters closely (≈1 token per phoneme symbol), so ~360 source characters
// stays comfortably under the 509-token ceiling with margin for phoneme
// expansion — no truncation, while keeping the number of pieces (and seams) low.
const MAX_CHUNK_CHARS = 360;

/**
 * Sentence-aware splitter that never drops text. Returns whole sentences (text up
 * to and including a terminator) plus, for a trailing clause with no terminator,
 * the entire remaining run — never just its last word.
 */
export function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?…]+[.!?…]+(?:["'”’)\]]+)?|[^.!?…]+$/g);
  const sentences = (matches ?? [text]).map((s) => s.trim()).filter(Boolean);
  return sentences.length ? sentences : [];
}

/** Break an over-long single sentence on word boundaries so no piece exceeds the
 *  budget. A lone word longer than the budget (rare) is hard-sliced as a last
 *  resort — far better than the model truncating an unbounded tail. */
function hardWrap(sentence: string, limit: number): string[] {
  if (sentence.length <= limit) return [sentence];
  const out: string[] = [];
  let line = '';
  for (const word of sentence.split(/\s+/)) {
    if (!word) continue;
    if (word.length > limit) {
      if (line) { out.push(line); line = ''; }
      for (let i = 0; i < word.length; i += limit) out.push(word.slice(i, i + limit));
      continue;
    }
    if (line && line.length + 1 + word.length > limit) { out.push(line); line = ''; }
    line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/**
 * Split narration text into synthesis-sized pieces, aligned to sentence
 * boundaries and each within the token budget. Whitespace is normalised so
 * paragraph breaks do not inflate the character count.
 */
export function chunkForKokoro(text: string, limit = MAX_CHUNK_CHARS): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= limit) return [clean];

  const chunks: string[] = [];
  let current = '';
  for (const sentence of splitSentences(clean)) {
    for (const piece of hardWrap(sentence, limit)) {
      if (current && current.length + 1 + piece.length > limit) {
        chunks.push(current);
        current = '';
      }
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Concatenate the mono PCM of several synthesis calls into one buffer, inserting
 * a short silence between pieces so consecutive sentences do not butt together.
 */
export function concatAudio(parts: Float32Array[], sampleRate: number, gapMs = 60): Float32Array {
  const usable = parts.filter((part) => part.length > 0);
  if (usable.length === 0) return new Float32Array(0);
  if (usable.length === 1) return usable[0];
  const gap = Math.max(0, Math.round((gapMs / 1000) * sampleRate));
  const total = usable.reduce((n, part) => n + part.length, 0) + gap * (usable.length - 1);
  const out = new Float32Array(total);
  let offset = 0;
  usable.forEach((part, index) => {
    out.set(part, offset);
    offset += part.length + (index < usable.length - 1 ? gap : 0);
  });
  return out;
}
