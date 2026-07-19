export type StudyImproveLevel = 'minimal' | 'moderate' | 'deep';
export type StudyImproveLength = 'similar' | 'shorter' | 'develop';
export type StudyImproveMode = 'preserve' | 'free';
export type StudyImproveScope = 'selection' | 'paragraph' | 'section' | 'document';

export type StudyImprovePresetId =
  | 'academic'
  | 'formal'
  | 'clear'
  | 'concise'
  | 'developed'
  | 'outline'
  | 'proofread'
  | 'cohesion'
  | 'neutral'
  | 'popular'
  | 'adapt-level'
  | 'summary'
  | 'notes';

export type StudyStyleCategory = 'academic' | 'clarity' | 'structure' | 'audience' | 'custom';

export interface StudyStyleConfig {
  name: string;
  icon: string;
  color: string;
  description: string;
  prompt: string;
  systemPrompt: string;
  category: StudyStyleCategory;
  language: string;
  level: StudyImproveLevel;
  length: StudyImproveLength;
  modelProvider: string | null;
  modelName: string | null;
  temperature: number;
  maxOutputTokens: number;
  creativity: number;
  locked: boolean;
}

export interface StudyStyle extends StudyStyleConfig {
  id: string;
  shortId: string;
  builtIn: boolean;
  favorite: boolean;
  active: boolean;
  position: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudyStyleInput extends Partial<StudyStyleConfig> {
  name: string;
  prompt: string;
  favorite?: boolean;
  active?: boolean;
  position?: number;
}

export interface StudyStyleVersion {
  id: string;
  shortId: string;
  styleId: string;
  versionNo: number;
  config: StudyStyleConfig;
  reason: 'create' | 'update' | 'restore' | 'import';
  createdAt: string;
}

export type StudyStyleAssociationKind = 'global' | 'subject' | 'document_kind';

export interface StudyStyleAssociation {
  id: string;
  styleId: string;
  kind: StudyStyleAssociationKind;
  targetId: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudyImproveVariables {
  subject?: string;
  topic?: string;
  academicLevel?: string;
  language?: string;
  documentType?: string;
  targetLength?: string;
  selectedText?: string;
}

export type StudyProtectedSpanKind =
  | 'code'
  | 'formula'
  | 'link'
  | 'citation'
  | 'quote'
  | 'number'
  | 'term';

export interface StudyProtectedSpan {
  placeholder: string;
  value: string;
  kind: StudyProtectedSpanKind;
  from: number;
  to: number;
}

export interface StudyProtectedText {
  text: string;
  spans: StudyProtectedSpan[];
}

export interface StudyImproveRequest {
  documentId: string;
  subjectId?: string | null;
  text: string;
  styleId: string;
  scope: StudyImproveScope;
  level: StudyImproveLevel;
  length: StudyImproveLength;
  mode: StudyImproveMode;
  variables?: StudyImproveVariables;
  protectedTerms?: string[];
  model?: { provider: string; model: string } | null;
}

export interface StudyImproveResult {
  logId: string;
  text: string;
  warnings: string[];
  styleId: string;
  modelProvider: string;
  modelName: string;
  originalHash: string;
  resultHash: string;
  protectedSpanCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}

export interface StudyImproveStreamHandlers {
  onDelta: (delta: string) => void;
}

export interface StudyImprovementLog {
  id: string;
  documentId: string;
  styleId: string;
  scope: StudyImproveScope;
  mode: StudyImproveMode;
  level: StudyImproveLevel;
  length: StudyImproveLength;
  modelProvider: string;
  modelName: string;
  originalHash: string;
  resultHash: string;
  originalChars: number;
  resultChars: number;
  warnings: string[];
  action: 'replace' | 'insert_below' | 'rejected' | 'generated';
  createdAt: string;
}

export interface StudyStyleExport {
  format: 'nodus-study-styles';
  version: 1;
  exportedAt: string;
  styles: StudyStyleInput[];
}

const presets: Array<StudyStyleConfig & { id: StudyImprovePresetId }> = [
  { id: 'academic', name: 'Académico', icon: '🎓', color: '#0f766e', category: 'academic', description: 'Registro académico preciso y argumentación ordenada.', prompt: 'Reescribe el texto seleccionado con registro académico, precisión conceptual y transiciones explícitas.', systemPrompt: '', language: 'auto', level: 'moderate', length: 'similar', modelProvider: null, modelName: null, temperature: 0.25, maxOutputTokens: 2400, creativity: 0.15, locked: true },
  { id: 'formal', name: 'Formal', icon: '✒️', color: '#334155', category: 'academic', description: 'Tono formal sin volver el texto artificial.', prompt: 'Eleva el registro y la corrección formal del texto seleccionado.', systemPrompt: '', language: 'auto', level: 'moderate', length: 'similar', modelProvider: null, modelName: null, temperature: 0.2, maxOutputTokens: 2200, creativity: 0.1, locked: true },
  { id: 'clear', name: 'Claro', icon: '💡', color: '#0284c7', category: 'clarity', description: 'Aclara frases densas y ambigüedades.', prompt: 'Haz el texto seleccionado más claro y fácil de seguir sin simplificar sus ideas.', systemPrompt: '', language: 'auto', level: 'moderate', length: 'similar', modelProvider: null, modelName: null, temperature: 0.2, maxOutputTokens: 2200, creativity: 0.1, locked: true },
  { id: 'concise', name: 'Conciso', icon: '✂️', color: '#7c3aed', category: 'clarity', description: 'Elimina redundancias conservando contenido.', prompt: 'Condensa el texto seleccionado y elimina redundancias sin perder ninguna idea o dato.', systemPrompt: '', language: 'auto', level: 'moderate', length: 'shorter', modelProvider: null, modelName: null, temperature: 0.15, maxOutputTokens: 1800, creativity: 0.05, locked: true },
  { id: 'developed', name: 'Desarrollado', icon: '🌿', color: '#15803d', category: 'academic', description: 'Explicita conexiones ya presentes, sin aportar información nueva.', prompt: 'Desarrolla las conexiones implícitas del texto seleccionado usando exclusivamente la información que ya contiene.', systemPrompt: '', language: 'auto', level: 'deep', length: 'develop', modelProvider: null, modelName: null, temperature: 0.25, maxOutputTokens: 3200, creativity: 0.15, locked: true },
  { id: 'outline', name: 'Esquemático', icon: '☷', color: '#475569', category: 'structure', description: 'Convierte el contenido en una estructura jerárquica.', prompt: 'Organiza el texto seleccionado como esquema Markdown jerárquico, preservando todas sus ideas y datos.', systemPrompt: '', language: 'auto', level: 'deep', length: 'similar', modelProvider: null, modelName: null, temperature: 0.1, maxOutputTokens: 2400, creativity: 0.05, locked: true },
  { id: 'proofread', name: 'Ortografía', icon: '✓', color: '#059669', category: 'clarity', description: 'Corrige ortografía, gramática y puntuación.', prompt: 'Corrige únicamente ortografía, gramática y puntuación del texto seleccionado.', systemPrompt: '', language: 'auto', level: 'minimal', length: 'similar', modelProvider: null, modelName: null, temperature: 0, maxOutputTokens: 2200, creativity: 0, locked: true },
  { id: 'cohesion', name: 'Cohesión', icon: '🔗', color: '#0369a1', category: 'structure', description: 'Mejora continuidad y transiciones.', prompt: 'Mejora la cohesión y las transiciones internas del texto seleccionado.', systemPrompt: '', language: 'auto', level: 'moderate', length: 'similar', modelProvider: null, modelName: null, temperature: 0.2, maxOutputTokens: 2200, creativity: 0.1, locked: true },
  { id: 'neutral', name: 'Neutralizar', icon: '⚖️', color: '#64748b', category: 'academic', description: 'Reduce lenguaje valorativo no sustentado.', prompt: 'Neutraliza el tono valorativo del texto seleccionado sin alterar las afirmaciones ni su fuerza epistémica.', systemPrompt: '', language: 'auto', level: 'moderate', length: 'similar', modelProvider: null, modelName: null, temperature: 0.15, maxOutputTokens: 2200, creativity: 0.05, locked: true },
  { id: 'popular', name: 'Divulgativo', icon: '📣', color: '#ea580c', category: 'audience', description: 'Hace accesible el texto a público general.', prompt: 'Adapta el texto seleccionado para público general sin perder precisión ni añadir ejemplos nuevos.', systemPrompt: '', language: 'auto', level: 'deep', length: 'similar', modelProvider: null, modelName: null, temperature: 0.25, maxOutputTokens: 2400, creativity: 0.15, locked: true },
  { id: 'adapt-level', name: 'Adaptar nivel', icon: '🪜', color: '#9333ea', category: 'audience', description: 'Ajusta el texto al nivel académico indicado.', prompt: 'Adapta el texto seleccionado al nivel {{academicLevel}} manteniendo todas las ideas, datos y matices.', systemPrompt: '', language: 'auto', level: 'deep', length: 'similar', modelProvider: null, modelName: null, temperature: 0.2, maxOutputTokens: 2400, creativity: 0.1, locked: true },
  { id: 'summary', name: 'Resumen', icon: '🗜️', color: '#be123c', category: 'structure', description: 'Resume sin introducir afirmaciones.', prompt: 'Resume el texto seleccionado conservando sus tesis, conceptos y datos esenciales.', systemPrompt: '', language: 'auto', level: 'deep', length: 'shorter', modelProvider: null, modelName: null, temperature: 0.1, maxOutputTokens: 1600, creativity: 0.05, locked: true },
  { id: 'notes', name: 'Apuntes', icon: '📝', color: '#0f766e', category: 'structure', description: 'Convierte prosa en apuntes de estudio.', prompt: 'Convierte el texto seleccionado en apuntes Markdown claros y jerárquicos sin omitir ideas ni añadir contenido.', systemPrompt: '', language: 'auto', level: 'deep', length: 'similar', modelProvider: null, modelName: null, temperature: 0.1, maxOutputTokens: 2400, creativity: 0.05, locked: true },
];

export const STUDY_IMPROVE_PRESETS: readonly StudyStyle[] = presets.map((preset, position) => ({
  ...preset,
  id: `builtin:${preset.id}`,
  shortId: `STYLE-${preset.id.toUpperCase()}`,
  builtIn: true,
  favorite: preset.id === 'academic' || preset.id === 'clear',
  active: true,
  position,
  archivedAt: null,
  createdAt: 'builtin',
  updatedAt: 'builtin',
}));

export const STUDY_STYLE_VARIABLES = [
  'subject', 'topic', 'academicLevel', 'language', 'documentType', 'targetLength', 'selectedText',
] as const;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function protectStudyText(source: string, terms: string[] = []): StudyProtectedText {
  const matches: Array<{ from: number; to: number; kind: StudyProtectedSpanKind }> = [];
  const add = (regex: RegExp, kind: StudyProtectedSpanKind) => {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source))) {
      if (match[0]) matches.push({ from: match.index, to: match.index + match[0].length, kind });
      if (!regex.global) break;
    }
  };

  add(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, 'code');
  add(/`[^`\n]+`/g, 'code');
  add(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+\$/g, 'formula');
  add(/\]\((?:[^()\\]|\\.|\([^)]*\))+\)/g, 'link');
  add(/\[(?:\d+[a-z]?|[^\]\n]+,\s*\d{4}[a-z]?(?:,\s*p{1,2}\.\s*\d+(?:[-–]\d+)?)?)\]/gi, 'citation');
  add(/\([^()\n]*\b\d{4}[a-z]?\b[^()\n]*\)/gi, 'citation');
  add(/[“”][^“”\n]+[“”]|«[^»\n]+»|"[^"\n]+"/g, 'quote');
  add(/\b(?:\d{1,4}(?:[./:-]\d{1,4})+|\d+(?:[.,]\d+)?%?|[IVXLCDM]+)\b/g, 'number');
  for (const term of terms.map((value) => value.trim()).filter(Boolean).sort((a, b) => b.length - a.length)) {
    add(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'giu'), 'term');
  }

  const priority: StudyProtectedSpanKind[] = ['code', 'formula', 'link', 'citation', 'quote', 'term', 'number'];
  const accepted: typeof matches = [];
  for (const candidate of matches.sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind) || a.from - b.from || b.to - a.to)) {
    if (!accepted.some((span) => candidate.from < span.to && candidate.to > span.from)) accepted.push(candidate);
  }
  accepted.sort((a, b) => a.from - b.from);

  const spans: StudyProtectedSpan[] = accepted.map((span, index) => ({
    ...span,
    value: source.slice(span.from, span.to),
    placeholder: `⟦NODUS_PROTECTED_${String(index + 1).padStart(4, '0')}⟧`,
  }));
  let text = source;
  for (const span of [...spans].reverse()) text = `${text.slice(0, span.from)}${span.placeholder}${text.slice(span.to)}`;
  return { text, spans };
}

export function missingProtectedSpans(text: string, spans: StudyProtectedSpan[]): StudyProtectedSpan[] {
  return spans.filter((span) => !text.includes(span.placeholder));
}

/** Matches any placeholder minted by `protectStudyText`. */
const PROTECTED_PLACEHOLDER_RE = /⟦NODUS_PROTECTED_\d+⟧/gu;

/**
 * Placeholder→value lookups, cached per span list.
 *
 * Streaming calls this once per chunk with the same `spans` array, so building
 * the map inside the function would rebuild thousands of entries on every
 * token — which is quadratic again, just with a smaller constant.
 */
const lookupCache = new WeakMap<StudyProtectedSpan[], Map<string, string>>();

function placeholderLookup(spans: StudyProtectedSpan[]): Map<string, string> {
  const cached = lookupCache.get(spans);
  if (cached) return cached;
  const built = new Map(spans.map((span) => [span.placeholder, span.value]));
  lookupCache.set(spans, built);
  return built;
}

export function restoreProtectedSpans(text: string, spans: StudyProtectedSpan[]): string {
  if (spans.length === 0) return text;
  // One pass over the text, not one pass per span.
  //
  // The previous `spans.reduce((acc, span) => acc.split(...).join(...))` walked
  // the whole string once for every protected span, so a document with 600
  // spans was scanned 600 times. During streaming that ran on the growing
  // prefix for every token, which measured 84s of blocked main process on a
  // 109k-character document.
  //
  // Replacing in a single pass also removes a subtle hazard: with the reduce,
  // a restored value containing something that looked like a later
  // placeholder would have been substituted again. Here each match is
  // replaced exactly once and the result is never re-scanned.
  const byPlaceholder = placeholderLookup(spans);
  return text.replace(PROTECTED_PLACEHOLDER_RE, (match) => byPlaceholder.get(match) ?? match);
}

export function renderStudyStylePrompt(template: string, variables: StudyImproveVariables): string {
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (token, key: keyof StudyImproveVariables) => {
    const value = variables[key];
    return value == null || value === '' ? token : String(value);
  });
}

export function validateStudyStylePrompt(prompt: string): string[] {
  const warnings: string[] = [];
  const trimmed = prompt.trim();
  if (trimmed.length < 20) warnings.push('El prompt es demasiado breve para controlar la transformación.');
  if (trimmed.length > 5000) warnings.push('El prompt supera 5.000 caracteres.');
  if (/ignora\s+(?:las\s+)?instrucciones|ignore\s+(?:all\s+)?instructions/i.test(trimmed)) warnings.push('El prompt intenta sustituir las reglas de seguridad.');
  if (/añad[ea]|invent[ea]|nuev[oa]s?\s+(?:datos|fuentes|citas|argumentos|ejemplos)|make up|new (?:claims|citations|facts)/i.test(trimmed)) warnings.push('El prompt puede generar información, citas o argumentos nuevos.');
  const unknown = [...trimmed.matchAll(/\{\{\s*([^}]+)\s*\}\}/g)]
    .map((match) => match[1].trim())
    .filter((value) => !(STUDY_STYLE_VARIABLES as readonly string[]).includes(value));
  if (unknown.length) warnings.push(`Variables desconocidas: ${[...new Set(unknown)].join(', ')}.`);
  return warnings;
}

export function studyImprovementWarnings(original: string, result: string, protectedSpans: StudyProtectedSpan[], mode: StudyImproveMode): string[] {
  const warnings: string[] = [];
  if (!result.trim()) warnings.push('El modelo devolvió un resultado vacío.');
  const originalNumbers: string[] = [...(original.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? [])];
  const resultNumbers: string[] = [...(result.match(/\b\d+(?:[.,]\d+)?%?\b/g) ?? [])];
  if (originalNumbers.some((value) => !resultNumbers.includes(value))) warnings.push('Faltan cifras presentes en el original.');
  if (mode === 'preserve' && resultNumbers.some((value) => !originalNumbers.includes(value))) warnings.push('Aparecen cifras que no estaban en el original.');
  if (protectedSpans.some((span) => !result.includes(span.value))) warnings.push('Algún fragmento protegido fue alterado o eliminado.');
  if (mode === 'preserve' && result.length > Math.max(240, original.length * 1.85)) warnings.push('El resultado creció mucho; revisa posibles afirmaciones nuevas.');
  return warnings;
}

export function estimateStudyTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
