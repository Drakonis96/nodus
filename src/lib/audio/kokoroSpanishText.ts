// Kokoro's official Spanish pipeline uses Misaki's EspeakG2P with language
// code "es". Keep the small compatibility layer separate from the WASM runtime
// so its text transformations can be tested without loading eSpeak NG.

export const KOKORO_SPANISH_VOICE_IDS = ['ef_dora', 'em_alex', 'em_santa'] as const;

export type KokoroSpanishVoiceId = (typeof KOKORO_SPANISH_VOICE_IDS)[number];

const SPANISH_VOICE_IDS = new Set<string>(KOKORO_SPANISH_VOICE_IDS);

/** True for the three Spanish embeddings published with Kokoro v1.0. */
export function isKokoroSpanishVoice(voiceId: string): voiceId is KokoroSpanishVoiceId {
  return SPANISH_VOICE_IDS.has(voiceId);
}

/**
 * Preserve parentheses through eSpeak in the same way as Misaki's EspeakG2P.
 * Existing guillemets become curly quotes; parentheses temporarily become
 * guillemets and are restored after phonemization.
 */
export function prepareKokoroSpanishText(text: string): string {
  return text
    .replaceAll('«', '“')
    .replaceAll('»', '”')
    .replaceAll('(', '«')
    .replaceAll(')', '»');
}

// Exact eSpeak-to-Kokoro substitutions from Misaki's EspeakG2P. The official
// Python backend asks phonemizer for caret ties; piper-phonemize emits the same
// IPA with U+0361 combining ties, so accept both representations.
const ESPEAK_TO_KOKORO: ReadonlyArray<readonly [string, string]> = [
  ['a^ɪ', 'I'],
  ['a^ʊ', 'W'],
  ['d^z', 'ʣ'],
  ['d^ʒ', 'ʤ'],
  ['e^ɪ', 'A'],
  ['o^ʊ', 'O'],
  ['ə^ʊ', 'Q'],
  ['s^s', 'S'],
  ['t^s', 'ʦ'],
  ['t^ʃ', 'ʧ'],
  ['ɔ^ɪ', 'Y'],
];

/** Convert eSpeak NG IPA into the symbol inventory expected by Kokoro v1.0. */
export function normalizeKokoroSpanishPhonemes(phonemes: string): string {
  let normalized = phonemes;
  for (const [source, replacement] of ESPEAK_TO_KOKORO) {
    normalized = normalized
      .replaceAll(source, replacement)
      .replaceAll(source.replace('^', '͡'), replacement);
  }

  return normalized
    .replaceAll('^', '')
    .replaceAll('͡', '')
    .replaceAll('-', '')
    .replaceAll('«', '(')
    .replaceAll('»', ')')
    .trim();
}
