// Detección de hablantes: lo que se puede afirmar de una grabación sin preguntarle a nadie.
//
// La tesis de este módulo es que hay DOS cosas distintas y sólo una la sabe la máquina:
//
//   1. DÓNDE cambia la voz. Eso lo dice el audio, y un modelo de segmentación acústica lo
//      resuelve bien: no necesita entender nada, sólo oír que quien habla ya no es el mismo.
//   2. QUIÉN es cada voz. Eso NO lo sabe el audio. Que la voz 2 sea Carmen Ruiz es un dato
//      que aporta quien hizo la entrevista, y ponerlo automáticamente sería inventar la
//      atribución de un testimonio, que es lo más grave que puede hacer este vault.
//
// Por eso aquí no se «asigna» nada: se PROPONE. La función devuelve tramos con una voz
// anónima («Voz 1», «Voz 2») y una cobertura medida, y quien entrevistó dice a quién
// corresponde cada una. Mientras nadie lo diga, la transcripción sigue sin hablante, que es
// la verdad.

/** Un tramo tal y como lo devuelve el modelo acústico, antes de limpiarlo. */
export interface RawDiarizationSpan {
  start: number;
  end: number;
  /** El índice de clase del modelo. `NO_SPEAKER` (silencio) llega como label. */
  label: string;
  confidence: number;
}

/** Un turno ya limpio: un tramo continuo en el que habla una sola voz. */
export interface DiarizationTurn {
  start: number;
  end: number;
  /** Índice estable de la voz dentro de esta grabación, empezando en 1. */
  voice: number;
  confidence: number;
}

export interface DiarizationVoice {
  voice: number;
  /** Segundos totales en los que habla. */
  seconds: number;
  turns: number;
  /** Proporción del habla total, entre 0 y 1. */
  share: number;
}

export interface DiarizationResult {
  turns: DiarizationTurn[];
  voices: DiarizationVoice[];
  /** Segundos con habla detectada; el resto es silencio. */
  speechSeconds: number;
}

/** El label de silencio de pyannote 3.0. No es una voz y no cuenta para nada. */
const SILENCE = 'NO_SPEAKER';

/** Tramos más cortos que esto son parpadeos del modelo, no turnos de conversación. */
const MIN_TURN_SECONDS = 0.35;

/** Dos tramos de la misma voz separados por menos que esto son el mismo turno. */
const MAX_GAP_SECONDS = 0.8;

/**
 * De la salida cruda del modelo a turnos legibles.
 *
 * Tres operaciones, en este orden y por este motivo:
 *   1. Fuera el silencio, que el modelo etiqueta como una clase más.
 *   2. Fuera los parpadeos: un tramo de 0,05 s no es un turno, es el modelo dudando en una
 *      consonante. Si se dejaran, la pantalla enseñaría veinte turnos donde hay cuatro.
 *   3. Unir lo contiguo de la misma voz: una pausa para respirar no cambia de hablante.
 *
 * El orden importa y una prueba lo sujeta: filtrar después de unir dejaría el parpadeo
 * partiendo en dos el turno de quien estaba hablando.
 */
export function diarizationFromSpans(spans: RawDiarizationSpan[]): DiarizationResult {
  // Los parpadeos se van ANTES de unir, no después: un tramo de 0,05 s atribuido a otra voz
  // en mitad de una frase no es un turno, y si sobreviviera hasta la fase de unión partiría
  // en dos el turno de quien sí está hablando — que es peor que el propio parpadeo.
  const clean = spans
    .filter((span) => span.label !== SILENCE && span.end - span.start >= MIN_TURN_SECONDS)
    .map((span) => ({ ...span }))
    .sort((a, b) => a.start - b.start);

  const voiceIndex = new Map<string, number>();
  const merged: DiarizationTurn[] = [];
  for (const span of clean) {
    if (!voiceIndex.has(span.label)) voiceIndex.set(span.label, voiceIndex.size + 1);
    const voice = voiceIndex.get(span.label)!;
    const previous = merged[merged.length - 1];
    if (previous && previous.voice === voice && span.start - previous.end <= MAX_GAP_SECONDS) {
      previous.end = Math.max(previous.end, span.end);
      previous.confidence = Math.max(previous.confidence, span.confidence);
      continue;
    }
    merged.push({ start: span.start, end: span.end, voice, confidence: span.confidence });
  }

  // Y se vuelve a filtrar después de unir, por si la unión dejó algún turno corto suelto.
  const turns = merged.filter((turn) => turn.end - turn.start >= MIN_TURN_SECONDS);

  // Renumerar: si la voz 2 desapareció al filtrar, no puede quedar un hueco en la lista.
  const order = new Map<number, number>();
  for (const turn of turns) if (!order.has(turn.voice)) order.set(turn.voice, order.size + 1);
  for (const turn of turns) turn.voice = order.get(turn.voice)!;

  const speechSeconds = turns.reduce((total, turn) => total + (turn.end - turn.start), 0);
  const voices: DiarizationVoice[] = [...new Set(turns.map((turn) => turn.voice))]
    .sort((a, b) => a - b)
    .map((voice) => {
      const own = turns.filter((turn) => turn.voice === voice);
      const seconds = own.reduce((total, turn) => total + (turn.end - turn.start), 0);
      return {
        voice,
        seconds: Number(seconds.toFixed(2)),
        turns: own.length,
        share: speechSeconds > 0 ? Number((seconds / speechSeconds).toFixed(3)) : 0,
      };
    });

  return { turns, voices, speechSeconds: Number(speechSeconds.toFixed(2)) };
}

export interface SegmentWindow {
  id: string;
  tStart: number;
  tEnd: number;
}

export interface SpeakerProposal {
  segmentId: string;
  /** `null` cuando el tramo cae en silencio o el reparto está demasiado repartido. */
  voice: number | null;
  /** Cuánto del segmento cubre esa voz, entre 0 y 1. Es la medida, no una corazonada. */
  coverage: number;
  /** `true` cuando dos voces se reparten el segmento y ninguna manda con claridad. */
  disputed: boolean;
}

/** Por debajo de esto no se propone nada: es preferible dejarlo en blanco que acertar por suerte. */
const MIN_COVERAGE = 0.34;

/** Si la segunda voz llega a esta parte de la primera, el tramo está en disputa. */
const DISPUTE_RATIO = 0.7;

/**
 * Qué voz habla en cada segmento de la transcripción.
 *
 * Se mide el solapamiento en segundos entre el segmento y los turnos de cada voz, y gana
 * la que más ocupa. Cuando dos se reparten el segmento —porque la transcripción cortó por
 * frases y el turno cambió a mitad— se marca EN DISPUTA en vez de elegir: quien revisa
 * prefiere ver dos tramos dudosos señalados que veinte asignados a ojo.
 */
export function proposeSpeakers(segments: SegmentWindow[], turns: DiarizationTurn[]): SpeakerProposal[] {
  return segments.map((segment) => {
    const length = Math.max(0, segment.tEnd - segment.tStart);
    if (length <= 0) return { segmentId: segment.id, voice: null, coverage: 0, disputed: false };
    const perVoice = new Map<number, number>();
    for (const turn of turns) {
      const overlap = Math.min(segment.tEnd, turn.end) - Math.max(segment.tStart, turn.start);
      if (overlap <= 0) continue;
      perVoice.set(turn.voice, (perVoice.get(turn.voice) ?? 0) + overlap);
    }
    const ranked = [...perVoice.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return { segmentId: segment.id, voice: null, coverage: 0, disputed: false };
    const [voice, seconds] = ranked[0];
    const coverage = Number((seconds / length).toFixed(3));
    const runnerUp = ranked[1]?.[1] ?? 0;
    const disputed = runnerUp > 0 && runnerUp / seconds >= DISPUTE_RATIO;
    if (coverage < MIN_COVERAGE || disputed) {
      return { segmentId: segment.id, voice: null, coverage, disputed };
    }
    return { segmentId: segment.id, voice, coverage, disputed: false };
  });
}

/** El nombre anónimo de una voz mientras nadie diga de quién es. */
export function voiceLabel(voice: number): string {
  return `Voz ${voice}`;
}

/**
 * Cuánto coincide una propuesta con lo que un humano ya había puesto.
 *
 * Sirve para lo único que importa al revisar: enseñar de antemano cuántos segmentos
 * cambiarían de hablante si se aplica. Un cambio silencioso en una transcripción ya
 * atribuida es exactamente lo que este vault no hace.
 */
export function proposalImpact(
  proposals: SpeakerProposal[],
  current: Map<string, string | null>,
  voiceToLabel: Map<number, string | null>,
): { unchanged: number; filled: number; changed: number; leftBlank: number } {
  let unchanged = 0;
  let filled = 0;
  let changed = 0;
  let leftBlank = 0;
  for (const proposal of proposals) {
    const next = proposal.voice == null ? null : voiceToLabel.get(proposal.voice) ?? null;
    const now = current.get(proposal.segmentId) ?? null;
    if (next == null) { leftBlank += 1; continue; }
    if (now == null) { filled += 1; continue; }
    if (now === next) unchanged += 1;
    else changed += 1;
  }
  return { unchanged, filled, changed, leftBlank };
}
