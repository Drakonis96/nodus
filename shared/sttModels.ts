export type StudySttProvider = 'local' | 'openai';

export interface StudySttModel {
  id: string;
  label: string;
  sizeMb: number;
  ramMb: number;
  speed: 'muy_rapido' | 'rapido' | 'equilibrado' | 'preciso';
  accuracy: 'basica' | 'buena' | 'alta' | 'muy_alta';
  multilingual: boolean;
}

export const STUDY_STT_MODELS: readonly StudySttModel[] = [
  { id: 'Xenova/whisper-tiny', label: 'Whisper Tiny', sizeMb: 75, ramMb: 420, speed: 'muy_rapido', accuracy: 'basica', multilingual: true },
  { id: 'Xenova/whisper-base', label: 'Whisper Base', sizeMb: 142, ramMb: 650, speed: 'rapido', accuracy: 'buena', multilingual: true },
  { id: 'Xenova/whisper-small', label: 'Whisper Small', sizeMb: 466, ramMb: 1500, speed: 'equilibrado', accuracy: 'alta', multilingual: true },
  { id: 'Xenova/whisper-medium', label: 'Whisper Medium', sizeMb: 1500, ramMb: 3900, speed: 'preciso', accuracy: 'muy_alta', multilingual: true },
] as const;

export interface StudySttDeviceProfile {
  memoryGb?: number | null;
  logicalCores?: number | null;
}

export function recommendStudySttModel(profile: StudySttDeviceProfile): StudySttModel {
  const memory = profile.memoryGb ?? 4;
  const cores = profile.logicalCores ?? 4;
  if (memory >= 16 && cores >= 8) return STUDY_STT_MODELS[2];
  if (memory >= 8 && cores >= 4) return STUDY_STT_MODELS[1];
  return STUDY_STT_MODELS[0];
}

export function getStudySttModel(id: string): StudySttModel {
  return STUDY_STT_MODELS.find((model) => model.id === id) ?? STUDY_STT_MODELS[0];
}

const WHISPER_LANGUAGES: Record<string, string> = {
  es: 'spanish', 'es-es': 'spanish', en: 'english', 'en-us': 'english', 'en-gb': 'english',
  fr: 'french', 'fr-fr': 'french', pt: 'portuguese', 'pt-pt': 'portuguese', 'pt-br': 'portuguese',
  de: 'german', it: 'italian', ca: 'catalan', eu: 'basque', gl: 'galician',
};

export function whisperLanguageName(language: string): string | undefined {
  const normalized = language.trim().toLocaleLowerCase();
  return WHISPER_LANGUAGES[normalized] ?? WHISPER_LANGUAGES[normalized.split('-')[0]];
}

export type StudyDictationAction = 'finish' | 'undo' | 'delete_last_sentence' | null;

export interface StudyDictationTransformOptions {
  removeFillers?: boolean;
  customDictionary?: string[];
}

export interface StudyDictationTransform {
  text: string;
  action: StudyDictationAction;
}

const ACTIONS: Array<[RegExp, Exclude<StudyDictationAction, null>]> = [
  [/^(?:finalizar|terminar dictado|finish dictation)$/iu, 'finish'],
  [/^(?:deshacer|undo)$/iu, 'undo'],
  [/^(?:borrar (?:la )?última frase|delete (?:the )?last sentence)$/iu, 'delete_last_sentence'],
];

const SPOKEN_PUNCTUATION: Array<[RegExp, string]> = [
  [/(?:^|\s)(?:nuevo párrafo|new paragraph)(?=\s|$)/giu, '\n\n'],
  [/(?:^|\s)(?:punto y coma|semicolon)(?=\s|$)/giu, '; '],
  [/(?:^|\s)(?:dos puntos|colon)(?=\s|$)/giu, ': '],
  [/(?:^|\s)(?:punto|period|full stop)(?=\s|$)/giu, '. '],
  [/(?:^|\s)(?:coma|comma)(?=\s|$)/giu, ', '],
];

function capitalizeSentences(value: string): string {
  return value.replace(/(^|[.!?]\s+|\n+)(\p{Ll})/gu, (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase()}`);
}

function preserveDictionaryCase(value: string, dictionary: string[]): string {
  return dictionary.reduce((text, term) => {
    const clean = term.trim();
    if (!clean) return text;
    const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`\\b${escaped}\\b`, 'giu'), clean);
  }, value);
}

export function transformStudyDictation(raw: string, options: StudyDictationTransformOptions = {}): StudyDictationTransform {
  const clean = raw.replace(/\s+/g, ' ').trim();
  for (const [pattern, action] of ACTIONS) {
    if (pattern.test(clean)) return { text: '', action };
  }
  const structural = clean.match(/^(título|title|subtítulo|subtitle|lista|list)\s+(.+)$/iu);
  if (structural) {
    const marker = /^(título|title)$/iu.test(structural[1]) ? '# ' : /^(subtítulo|subtitle)$/iu.test(structural[1]) ? '## ' : '- ';
    return { text: `${marker}${capitalizeSentences(preserveDictionaryCase(structural[2], options.customDictionary ?? []))}`, action: null };
  }
  let text = clean;
  for (const [pattern, replacement] of SPOKEN_PUNCTUATION) text = text.replace(pattern, replacement);
  if (options.removeFillers) {
    text = text.replace(/(?:^|\s)(?:eh+|em+|mmm+|um+|este(?:ee)*)(?=\s|$)/giu, ' ');
  }
  text = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
  text = capitalizeSentences(preserveDictionaryCase(text, options.customDictionary ?? []));
  return { text, action: null };
}

export function deleteLastStudySentence(markdown: string): string {
  const clean = markdown.trimEnd();
  const matches = [...clean.matchAll(/[.!?](?=\s|$)/g)];
  if (matches.length < 2) return '';
  return clean.slice(0, (matches.at(-2)?.index ?? -1) + 1).trimEnd();
}

export function insertStudyDictation(markdown: string, text: string, cursor: number): { markdown: string; from: number; to: number } {
  const at = Math.max(0, Math.min(markdown.length, cursor));
  const before = markdown.slice(0, at);
  const after = markdown.slice(at);
  const prefix = before && !/[\s\n]$/.test(before) && !/^[,.;:!?]/.test(text) ? ' ' : '';
  const suffix = after && !/^\s/.test(after) && !/[\s\n]$/.test(text) ? ' ' : '';
  const inserted = `${prefix}${text}${suffix}`;
  return { markdown: `${before}${inserted}${after}`, from: at + prefix.length, to: at + prefix.length + text.length };
}

export function buildStudySttPrompt(vocabulary: string[], limit = 80): string {
  const unique = [...new Set(vocabulary.map((term) => term.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, limit);
  return unique.length ? `Vocabulario del curso: ${unique.join(', ')}.` : '';
}

export interface StudySttRequest {
  audioBytes: Uint8Array;
  mimeType: string;
  model?: string | null;
  language?: string | null;
  prompt?: string | null;
}

export interface StudySttResult {
  text: string;
  provider: StudySttProvider;
  model: string;
}
