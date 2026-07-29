/**
 * El contrato de dominio del vault de Testimonios (historia oral).
 *
 * Este módulo es PURO: sin Electron, sin SQLite, sin React. Todo lo que decide qué
 * es válido en una entrevista vive aquí porque las mismas reglas las necesitan tres
 * consumidores que nunca se ven entre sí — los repositorios del proceso principal,
 * las vistas del renderer y el filtrado de contexto de la IA — y una regla repetida
 * en tres sitios es una regla que se contradice a sí misma el primer día.
 *
 * La tesis del vault, que este archivo codifica en tipos:
 *
 *   El FLUJO de trabajo, el ACUERDO y el ACCESO son tres dimensiones INDEPENDIENTES.
 *
 * Una entrevista puede estar completada y seguir sin acuerdo documentado; puede tener
 * un acuerdo documentado y estar embargada; puede estar en preparación y ser abierta.
 * Colapsarlas en un solo estado — que es lo que hace cualquier hoja de cálculo — es
 * exactamente cómo se pierde el rastro de qué se puede hacer con un testimonio.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Flujo de trabajo
// ─────────────────────────────────────────────────────────────────────────────

export type InterviewWorkflowStatus =
  | 'preparation'
  | 'scheduled'
  | 'recorded'
  | 'transcribing'
  | 'reviewing'
  | 'narrator_review'
  | 'completed'
  | 'archived'
  | 'cancelled';

export const INTERVIEW_WORKFLOW_STATUSES: InterviewWorkflowStatus[] = [
  'preparation',
  'scheduled',
  'recorded',
  'transcribing',
  'reviewing',
  'narrator_review',
  'completed',
  'archived',
  'cancelled',
];

/**
 * Qué transiciones tienen sentido. NO es una máquina de estados que bloquee al
 * investigador: `canTransition` describe el camino normal, y la interfaz lo usa para
 * ORDENAR y SUGERIR, no para prohibir. Una entrevista real vuelve atrás — se cancela
 * una sesión, aparece un archivo perdido, el narrador pide revisar algo que ya se dio
 * por cerrado — y un producto que se lo impida acaba con el usuario inventando
 * estados falsos para poder seguir trabajando.
 *
 * Lo único genuinamente terminal es `archived`: de ahí solo se sale desarchivando.
 */
const FORWARD_TRANSITIONS: Record<InterviewWorkflowStatus, InterviewWorkflowStatus[]> = {
  preparation: ['scheduled', 'recorded', 'cancelled'],
  scheduled: ['recorded', 'preparation', 'cancelled'],
  recorded: ['transcribing', 'reviewing', 'completed', 'cancelled'],
  transcribing: ['reviewing', 'recorded', 'cancelled'],
  reviewing: ['narrator_review', 'completed', 'transcribing', 'cancelled'],
  narrator_review: ['completed', 'reviewing', 'cancelled'],
  completed: ['archived', 'reviewing', 'narrator_review'],
  archived: ['completed'],
  cancelled: ['preparation', 'scheduled'],
};

/** Si `to` es un paso natural desde `from`. Quedarse igual siempre vale. */
export function canTransition(from: InterviewWorkflowStatus, to: InterviewWorkflowStatus): boolean {
  if (from === to) return true;
  return FORWARD_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Los siguientes pasos sugeridos, en el orden en que la interfaz debe ofrecerlos. */
export function suggestedTransitions(from: InterviewWorkflowStatus): InterviewWorkflowStatus[] {
  return [...(FORWARD_TRANSITIONS[from] ?? [])];
}

/**
 * El estado que Nodus PROPONE cuando ocurre un hecho, o null si no propone nada.
 *
 * Proponer, no imponer (decisión 16 del plan): añadir un maestro a una entrevista en
 * preparación significa casi siempre que ya se grabó, pero importar el audio de una
 * entrevista ya completada para archivarlo mejor no debe devolverla a «Grabada».
 */
export function proposedStatusAfter(
  current: InterviewWorkflowStatus,
  event: 'master_added' | 'transcription_started' | 'transcription_ready' | 'narrator_review_sent' | 'narrator_approved',
): InterviewWorkflowStatus | null {
  switch (event) {
    case 'master_added':
      return current === 'preparation' || current === 'scheduled' ? 'recorded' : null;
    case 'transcription_started':
      return current === 'recorded' ? 'transcribing' : null;
    case 'transcription_ready':
      return current === 'transcribing' ? 'reviewing' : null;
    case 'narrator_review_sent':
      return current === 'reviewing' || current === 'recorded' ? 'narrator_review' : null;
    case 'narrator_approved':
      return current === 'narrator_review' ? 'completed' : null;
    default:
      return null;
  }
}

/** Estados que ya no piden trabajo activo: no cuentan como pendientes en Inicio. */
export function isClosedStatus(status: InterviewWorkflowStatus): boolean {
  return status === 'completed' || status === 'archived' || status === 'cancelled';
}

// ─────────────────────────────────────────────────────────────────────────────
// Acuerdo y acceso — las otras dos dimensiones
// ─────────────────────────────────────────────────────────────────────────────

export type AgreementStatus = 'pending' | 'documented' | 'update_required' | 'withdrawn';
export const AGREEMENT_STATUSES: AgreementStatus[] = ['pending', 'documented', 'update_required', 'withdrawn'];

export type AccessLevel = 'private' | 'restricted' | 'embargoed' | 'open';
export const ACCESS_LEVELS: AccessLevel[] = ['private', 'restricted', 'embargoed', 'open'];

export type AttributionMode = 'real_name' | 'public_name' | 'anonymous';
export const ATTRIBUTION_MODES: AttributionMode[] = ['real_name', 'public_name', 'anonymous'];

export type NarratorReviewStatus = 'not_started' | 'sent' | 'changes_requested' | 'approved' | 'unavailable';
export const NARRATOR_REVIEW_STATUSES: NarratorReviewStatus[] = [
  'not_started',
  'sent',
  'changes_requested',
  'approved',
  'unavailable',
];

/**
 * Los usos que un acuerdo puede documentar. NO son un dictamen jurídico: son lo que el
 * investigador declara haber explicado y acordado, que es lo único que un programa
 * local puede saber honestamente. `ai_processing` y `external_processing` están aquí y
 * no en Ajustes precisamente porque son decisiones del narrador, no del equipo.
 */
export type DocumentedUse =
  | 'research'
  | 'teaching'
  | 'publication'
  | 'broadcast'
  | 'web_publication'
  | 'exhibition'
  | 'deposit'
  | 'ai_processing'
  | 'external_processing';

export const DOCUMENTED_USES: DocumentedUse[] = [
  'research',
  'teaching',
  'publication',
  'broadcast',
  'web_publication',
  'exhibition',
  'deposit',
  'ai_processing',
  'external_processing',
];

export function isDocumentedUse(value: unknown): value is DocumentedUse {
  return typeof value === 'string' && (DOCUMENTED_USES as string[]).includes(value);
}

/** Leer `allowed_uses_json` sin que una fila corrupta tumbe la pantalla. */
export function parseDocumentedUses(json: string | null | undefined): DocumentedUse[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDocumentedUse);
  } catch {
    return [];
  }
}

export function serializeDocumentedUses(uses: readonly DocumentedUse[]): string {
  return JSON.stringify([...new Set(uses)].filter(isDocumentedUse));
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrevistas, sesiones, medios
// ─────────────────────────────────────────────────────────────────────────────

export type InterviewKind = 'life_history' | 'thematic' | 'follow_up' | 'group' | 'other';
export const INTERVIEW_KINDS: InterviewKind[] = ['life_history', 'thematic', 'follow_up', 'group', 'other'];

export type InterviewMode = 'in_person' | 'remote' | 'phone' | 'other';
export const INTERVIEW_MODES: InterviewMode[] = ['in_person', 'remote', 'phone', 'other'];

export type ParticipantRole = 'narrator' | 'interviewer' | 'facilitator' | 'translator' | 'technician' | 'other';
export const PARTICIPANT_ROLES: ParticipantRole[] = [
  'narrator',
  'interviewer',
  'facilitator',
  'translator',
  'technician',
  'other',
];

export type IdentityMode = 'identified' | 'pseudonym' | 'anonymous';
export const IDENTITY_MODES: IdentityMode[] = ['identified', 'pseudonym', 'anonymous'];

export type SessionStatus = 'planned' | 'recorded' | 'processed' | 'cancelled';
export const SESSION_STATUSES: SessionStatus[] = ['planned', 'recorded', 'processed', 'cancelled'];

export type MediaKind = 'audio' | 'video' | 'document' | 'image';
export const MEDIA_KINDS: MediaKind[] = ['audio', 'video', 'document', 'image'];

export type MediaRole = 'master' | 'access_copy' | 'related';
export const MEDIA_ROLES: MediaRole[] = ['master', 'access_copy', 'related'];

// ─────────────────────────────────────────────────────────────────────────────
// Transcripciones
// ─────────────────────────────────────────────────────────────────────────────

export type TranscriptKind =
  | 'machine_literal'
  | 'corrected'
  | 'reviewed'
  | 'approved'
  | 'anonymized'
  | 'translation';

export const TRANSCRIPT_KINDS: TranscriptKind[] = [
  'machine_literal',
  'corrected',
  'reviewed',
  'approved',
  'anonymized',
  'translation',
];

export type TranscriptStatus = 'pending' | 'processing' | 'ready' | 'error' | 'cancelled';
export const TRANSCRIPT_STATUSES: TranscriptStatus[] = ['pending', 'processing', 'ready', 'error', 'cancelled'];

/**
 * El original no se corrige (principio 3.3). La transcripción automática literal y la
 * versión aprobada son INMUTABLES; para cambiarlas hay que derivar otra versión, y ese
 * derivado guarda de quién viene. Esto no es una preferencia de interfaz: `isEditable`
 * lo comprueba también el repositorio, porque un `UPDATE` directo desde otra ruta
 * destruiría la única copia literal de lo que la persona dijo.
 */
export function isEditableTranscriptKind(kind: TranscriptKind): boolean {
  return kind !== 'machine_literal' && kind !== 'approved';
}

/** Qué derivados admite una versión. El literal es la raíz de todo el linaje. */
export function allowedDerivations(kind: TranscriptKind): TranscriptKind[] {
  switch (kind) {
    case 'machine_literal':
      return ['corrected', 'reviewed', 'anonymized', 'translation'];
    case 'corrected':
      return ['reviewed', 'anonymized', 'translation'];
    case 'reviewed':
      return ['approved', 'anonymized', 'translation'];
    case 'approved':
      // Una aprobada se «reabre» derivando una revisión nueva, nunca editándola.
      return ['reviewed', 'anonymized', 'translation'];
    case 'anonymized':
      return ['translation'];
    case 'translation':
      return ['corrected', 'reviewed'];
    default:
      return [];
  }
}

export function canDeriveTranscript(from: TranscriptKind, to: TranscriptKind): boolean {
  return allowedDerivations(from).includes(to);
}

/**
 * Qué versión debe abrirse por defecto al citar o al buscar. Prioridad descendente:
 * lo aprobado manda sobre lo revisado, lo revisado sobre lo corregido, y el literal es
 * el último recurso — nunca el primero, porque un error de reconocimiento citado como
 * palabras del narrador es exactamente el fallo que este vault existe para evitar.
 */
const TRANSCRIPT_PREFERENCE: TranscriptKind[] = [
  'approved',
  'reviewed',
  'corrected',
  'anonymized',
  'translation',
  'machine_literal',
];

export function preferredTranscript<T extends { kind: TranscriptKind; status?: TranscriptStatus; versionNo?: number }>(
  transcripts: readonly T[],
): T | null {
  const usable = transcripts.filter((tr) => tr.status === undefined || tr.status === 'ready');
  for (const kind of TRANSCRIPT_PREFERENCE) {
    const matching = usable.filter((tr) => tr.kind === kind);
    if (matching.length === 0) continue;
    return matching.reduce((best, candidate) =>
      (candidate.versionNo ?? 0) > (best.versionNo ?? 0) ? candidate : best,
    );
  }
  return null;
}

/** Un tramo tal y como lo devuelve Whisper. */
export interface WhisperChunk {
  text: string;
  timestamp: [number | null, number | null] | null;
}

export interface RawSegment {
  tStart: number;
  tEnd: number;
  text: string;
  speakerLabel?: string | null;
}

/**
 * Convertir la salida de Whisper en tramos con tiempo.
 *
 * NO se reparte el texto en párrafos ni se limpia: el literal es literal, y una
 * «mejora» aquí sería una corrección que nadie pidió y que después nadie sabría
 * distinguir de lo que el modelo oyó.
 *
 * Cuando el modelo no da marcas de tiempo, el reparto proporcional a la longitud es una
 * ESTIMACIÓN, no una medida — pero un tramo aproximado que lleva al minuto correcto vale
 * infinitamente más que un texto sin ningún punto de entrada al audio.
 */
export function segmentsFromWhisper(
  chunks: readonly WhisperChunk[] | undefined,
  text: string,
  durationSeconds: number,
): RawSegment[] {
  const valid = (chunks ?? [])
    .map((chunk) => ({
      text: chunk.text.replace(/\s+/g, ' ').trim(),
      tStart: Math.max(0, Number(chunk.timestamp?.[0] ?? 0)),
      tEnd: Math.max(0, Number(chunk.timestamp?.[1] ?? chunk.timestamp?.[0] ?? 0)),
    }))
    .filter((chunk) => chunk.text);
  if (valid.length > 0) {
    return valid.map((chunk, index) => ({
      ...chunk,
      tEnd: Math.max(chunk.tStart, chunk.tEnd || valid[index + 1]?.tStart || durationSeconds || chunk.tStart),
    }));
  }
  const sentences = text.split(/(?<=[.!?])\s+|\n+/u).map((part) => part.trim()).filter(Boolean);
  if (sentences.length === 0) return [];
  const totalWeight = sentences.reduce((sum, sentence) => sum + Math.max(1, sentence.length), 0);
  let cursor = 0;
  return sentences.map((sentence, index) => {
    const start = durationSeconds > 0 ? (cursor / totalWeight) * durationSeconds : index * 8;
    cursor += Math.max(1, sentence.length);
    const end = durationSeconds > 0 ? (cursor / totalWeight) * durationSeconds : start + 8;
    return { tStart: start, tEnd: end, text: sentence };
  });
}

/**
 * Corregir un literal sin reescribir la forma de hablar.
 *
 * Espacios sobrantes, puntuación pegada y mayúscula tras punto. NADA MÁS. La tentación
 * es «arreglar» la sintaxis oral — las repeticiones, los anacolutos, las frases sin
 * terminar — y eso es exactamente lo que NO puede hacer un programa: en historia oral la
 * forma de contar es parte de lo que se cuenta, y una transcripción pulida borra al
 * narrador y deja al corrector.
 */
export function correctedTranscriptText(literal: string): string {
  return literal
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([.!?])\s*(\p{Ll})/gu, (_match, punctuation: string, letter: string) => `${punctuation} ${letter.toLocaleUpperCase()}`)
    .replace(/(^|\n)(\p{Ll})/gu, (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase()}`)
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Códigos y temas
// ─────────────────────────────────────────────────────────────────────────────

export type CodeKind = 'code' | 'theme';
export const CODE_KINDS: CodeKind[] = ['code', 'theme'];

/**
 * La clave de deduplicación de un código. Sin esto, «Posguerra», «posguerra» y
 * «post-guerra » son tres códigos distintos en tres entrevistas, y Contrastes —
 * cuyo trabajo entero es cruzar códigos entre entrevistas — deja de servir para nada.
 *
 * Se quitan diacríticos a propósito: quien codifica a las 23:40 escribe «hambruna» sin
 * tilde tan a menudo como con ella, y no hay ningún par de códigos útiles que se
 * distingan SOLO por un acento.
 */
export function normalizeCodeLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Si dos etiquetas escritas por humanos son el mismo código. */
export function sameCode(a: string, b: string): boolean {
  return normalizeCodeLabel(a) === normalizeCodeLabel(b);
}

/** Etiqueta legible: sin espacios de más, sin puntuación al final. */
export function cleanCodeLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
}

export function isValidCodeLabel(label: string): boolean {
  return normalizeCodeLabel(label).length > 0 && cleanCodeLabel(label).length <= 120;
}

/**
 * Ordena sugerencias de autocompletado: primero lo que empieza igual, después lo que
 * contiene el texto, y a igualdad de forma gana el código más usado. El recuento manda
 * sobre el alfabeto porque el objetivo del autocompletado no es listar el catálogo,
 * es que el usuario reutilice el código que ya existe en vez de crear un gemelo.
 */
export function rankCodeSuggestions<T extends { label: string; usageCount?: number }>(
  codes: readonly T[],
  query: string,
): T[] {
  const needle = normalizeCodeLabel(query);
  if (!needle) return [...codes].sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));
  return codes
    .map((code) => {
      const normalized = normalizeCodeLabel(code.label);
      if (normalized === needle) return { code, rank: 0 };
      if (normalized.startsWith(needle)) return { code, rank: 1 };
      if (normalized.includes(needle)) return { code, rank: 2 };
      return { code, rank: -1 };
    })
    .filter((entry) => entry.rank >= 0)
    .sort((a, b) => a.rank - b.rank || (b.code.usageCount ?? 0) - (a.code.usageCount ?? 0))
    .map((entry) => entry.code);
}

// ─────────────────────────────────────────────────────────────────────────────
// Anotaciones (fragmentos codificados)
// ─────────────────────────────────────────────────────────────────────────────

export type AnnotationKind = 'highlight' | 'memo' | 'redaction';
export const ANNOTATION_KINDS: AnnotationKind[] = ['highlight', 'memo', 'redaction'];

export type AnnotationLinkStatus = 'valid' | 'needs_review';

/**
 * Reanclar un fragmento cuando nace una versión nueva de la transcripción.
 *
 * El principio (6.7): NUNCA mover una cita en silencio. Si el texto guardado sigue
 * apareciendo en el mismo tramo temporal de la versión nueva, el fragmento se reancla;
 * si no, se marca `needs_review` y el usuario decide. Devolver un tramo «parecido» sin
 * avisar convertiría una cita textual en algo que la persona no dijo, que es el peor
 * fallo posible en historia oral y además indetectable meses después.
 *
 * La tolerancia temporal existe porque dos pasadas del mismo modelo cortan los
 * segmentos en sitios ligeramente distintos; no es margen para «encontrar algo».
 */
export interface RemapCandidateSegment {
  id: string;
  tStart: number;
  tEnd: number;
  text: string;
}

export interface RemapResult {
  segmentId: string | null;
  tStart: number;
  tEnd: number;
  status: AnnotationLinkStatus;
}

export function normalizeQuoteText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function remapAnnotation(
  annotation: { tStart: number; tEnd: number; quoteSnapshot: string },
  segments: readonly RemapCandidateSegment[],
  toleranceSeconds = 5,
): RemapResult {
  const needle = normalizeQuoteText(annotation.quoteSnapshot);
  const fallback: RemapResult = {
    segmentId: null,
    tStart: annotation.tStart,
    tEnd: annotation.tEnd,
    status: 'needs_review',
  };
  if (!needle) return fallback;

  // Solo se consideran segmentos que solapan la ventana original ampliada por la
  // tolerancia. Buscar el texto en toda la entrevista encontraría la misma frase dicha
  // en otro momento, que es una cita distinta.
  const windowStart = annotation.tStart - toleranceSeconds;
  const windowEnd = annotation.tEnd + toleranceSeconds;
  const nearby = segments.filter((seg) => seg.tEnd >= windowStart && seg.tStart <= windowEnd);
  if (nearby.length === 0) return fallback;

  const exact = nearby.find((seg) => normalizeQuoteText(seg.text).includes(needle));
  if (exact) {
    return { segmentId: exact.id, tStart: exact.tStart, tEnd: exact.tEnd, status: 'valid' };
  }

  // La cita puede cruzar un corte de segmento distinto: se prueba la concatenación de
  // los segmentos cercanos consecutivos antes de rendirse.
  const joined = normalizeQuoteText(nearby.map((seg) => seg.text).join(' '));
  if (joined.includes(needle)) {
    return {
      segmentId: nearby[0].id,
      tStart: Math.min(...nearby.map((seg) => seg.tStart)),
      tEnd: Math.max(...nearby.map((seg) => seg.tEnd)),
      status: 'valid',
    };
  }
  return fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiempos y citas
// ─────────────────────────────────────────────────────────────────────────────

/** `hh:mm:ss` — siempre con horas, para que dos tiempos se ordenen como texto. */
export function formatTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function parseTimecode(value: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(value.trim());
  if (!match) return null;
  const [, h, m, s, frac] = match;
  const minutes = Number(m);
  const secs = Number(s);
  if (minutes > 59 || secs > 59) return null;
  return Number(h ?? 0) * 3600 + minutes * 60 + secs + (frac ? Number(`0.${frac}`) : 0);
}

/** Duración legible y compacta para tablas: `1 h 12 min` / `47 min` / `38 s`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (total >= 60) return `${Math.max(1, m)} min`;
  return `${total} s`;
}

export interface CitationParts {
  /** El nombre que DEBE mostrarse: ya resuelto contra el modo de atribución. */
  displayName: string;
  interviewerName?: string;
  interviewTitle?: string;
  dateText?: string;
  tStart: number;
  tEnd?: number;
  vaultName?: string;
}

/**
 * La cita humana. La plantilla es una función y no una cadena en la interfaz porque el
 * mismo fragmento se cita desde Notas, desde Contrastes, desde el portapapeles y desde
 * una exportación, y cuatro plantillas distintas producen cuatro citas distintas del
 * mismo testimonio.
 *
 * Nunca recibe el nombre real: quien la llama ya ha pasado por `displayNameFor`.
 */
export function formatCitation(parts: CitationParts): string {
  const chunks: string[] = [parts.displayName];
  if (parts.interviewerName) chunks.push(`entrevista por ${parts.interviewerName}`);
  else if (parts.interviewTitle) chunks.push(parts.interviewTitle);
  if (parts.dateText) chunks.push(parts.dateText);
  const range = parts.tEnd != null && parts.tEnd > parts.tStart
    ? `${formatTimecode(parts.tStart)}–${formatTimecode(parts.tEnd)}`
    : formatTimecode(parts.tStart);
  chunks.push(range);
  if (parts.vaultName) chunks.push(`Bóveda «${parts.vaultName}»`);
  return chunks.join(', ') + '.';
}

// ─────────────────────────────────────────────────────────────────────────────
// Identificadores cortos
// ─────────────────────────────────────────────────────────────────────────────

export type ShortIdPrefix = 'INT' | 'SES' | 'MED' | 'TRN' | 'SEG' | 'ANN' | 'CTR';

/** `INT-0001`. Cuatro dígitos con desbordamiento natural, no truncado. */
export function formatShortId(prefix: ShortIdPrefix, sequence: number): string {
  return `${prefix}-${String(Math.max(1, Math.floor(sequence))).padStart(4, '0')}`;
}

export function parseShortId(value: string): { prefix: ShortIdPrefix; sequence: number } | null {
  const match = /^(INT|SES|MED|TRN|SEG|ANN|CTR)-(\d{1,9})$/.exec(value.trim().toUpperCase());
  if (!match) return null;
  return { prefix: match[1] as ShortIdPrefix, sequence: Number(match[2]) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Título propuesto
// ─────────────────────────────────────────────────────────────────────────────

/** «Entrevista a {nombre público} — {fecha}», con los huecos que falten omitidos. */
export function proposeInterviewTitle(publicName: string | null | undefined, dateText: string | null | undefined): string {
  const name = (publicName ?? '').trim();
  const date = (dateText ?? '').trim();
  if (name && date) return `Entrevista a ${name} — ${date}`;
  if (name) return `Entrevista a ${name}`;
  if (date) return `Entrevista — ${date}`;
  return 'Entrevista sin título';
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtros de la tabla y vistas guardadas
// ─────────────────────────────────────────────────────────────────────────────

export interface InterviewFilters {
  search?: string;
  workflowStatus?: InterviewWorkflowStatus[];
  transcriptionStatus?: ('none' | 'pending' | 'processing' | 'ready' | 'reviewed' | 'error')[];
  agreementStatus?: AgreementStatus[];
  accessLevel?: AccessLevel[];
  personId?: string;
  interviewerId?: string;
  codeId?: string;
  language?: string;
  collectionLabel?: string;
  interviewKind?: InterviewKind[];
  from?: string;
  to?: string;
  includeArchived?: boolean;
  includeDeleted?: boolean;
}

export type InterviewSort = 'upcoming' | 'recent' | 'updated' | 'title' | 'duration';

export interface SavedInterviewView {
  id: string;
  label: string;
  filters: InterviewFilters;
  sort: InterviewSort;
}

/**
 * Las vistas que el vault trae de fábrica. Son las siete preguntas que un investigador
 * de historia oral se hace cada vez que abre el proyecto, y por eso son fijas: si
 * fueran configurables desde el primer día, el vault llegaría vacío y sin enseñar qué
 * estados existen.
 */
export const DEFAULT_INTERVIEW_VIEWS: SavedInterviewView[] = [
  { id: 'all', label: 'Todas', filters: {}, sort: 'updated' },
  {
    id: 'upcoming',
    label: 'Próximas',
    filters: { workflowStatus: ['preparation', 'scheduled'] },
    sort: 'upcoming',
  },
  {
    id: 'pending-transcription',
    label: 'Pendientes de transcripción',
    filters: { workflowStatus: ['recorded', 'transcribing'], transcriptionStatus: ['none', 'pending', 'processing', 'error'] },
    sort: 'updated',
  },
  { id: 'reviewing', label: 'En revisión', filters: { workflowStatus: ['reviewing'] }, sort: 'updated' },
  {
    id: 'narrator',
    label: 'Pendientes del narrador',
    filters: { workflowStatus: ['narrator_review'] },
    sort: 'updated',
  },
  { id: 'completed', label: 'Completadas', filters: { workflowStatus: ['completed'] }, sort: 'recent' },
  {
    id: 'restricted',
    label: 'Con restricciones',
    filters: { accessLevel: ['private', 'restricted', 'embargoed'] },
    sort: 'updated',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Validación de entradas
// ─────────────────────────────────────────────────────────────────────────────

export interface NewInterviewInput {
  title: string;
  workflowStatus?: InterviewWorkflowStatus;
  interviewKind?: InterviewKind;
  narratorIds?: string[];
  interviewerIds?: string[];
  scheduledAt?: string | null;
  language?: string | null;
  collectionLabel?: string | null;
}

export function validateNewInterview(input: NewInterviewInput): string | null {
  if (!input.title || !input.title.trim()) return 'El título es obligatorio.';
  if (input.title.trim().length > 300) return 'El título es demasiado largo.';
  if (input.workflowStatus && !INTERVIEW_WORKFLOW_STATUSES.includes(input.workflowStatus)) {
    return 'Estado de flujo desconocido.';
  }
  if (input.interviewKind && !INTERVIEW_KINDS.includes(input.interviewKind)) {
    return 'Tipo de entrevista desconocido.';
  }
  return null;
}

/**
 * El nombre que puede mostrarse, dado el perfil del participante y el modo de
 * atribución del acuerdo vigente. Es la ÚNICA puerta por la que un nombre real llega a
 * una pantalla, una cita o una exportación: si el acuerdo dice anónimo, ni el perfil ni
 * la interfaz pueden reintroducirlo.
 */
export function displayNameFor(
  profile: { workingName: string; publicName?: string | null; identityMode: IdentityMode },
  attribution: AttributionMode,
): string {
  const pseudonym = (profile.publicName ?? '').trim();
  if (profile.identityMode === 'anonymous' || attribution === 'anonymous') {
    return pseudonym || 'Narrador anónimo';
  }
  if (profile.identityMode === 'pseudonym' || attribution === 'public_name') {
    return pseudonym || profile.workingName;
  }
  return profile.workingName;
}
