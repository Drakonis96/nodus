// Las dos operaciones de IA que trabajan SOBRE una entrevista concreta: proponer análisis
// y corregir la transcripción.
//
// Comparten tres reglas que no son negociables en este vault:
//
//   1. LA PUERTA. Ninguna de las dos toca una entrevista sin pasar por `evaluateAccess` en
//      el canal del proveedor. Un acuerdo que no autoriza tratamiento por IA no lo
//      autoriza tampoco «sólo para proponer códigos».
//   2. LA COMPROBACIÓN. El modelo propone y Nodus verifica contra el texto original: una
//      cita que no aparece se descarta, y un segmento cuya corrección cambia palabras se
//      queda como estaba. Las dos comprobaciones son puras y viven en `testimonyAiGuards`.
//   3. NADA SE GUARDA SOLO. Las dos devuelven propuestas. Crear el código, fijar el
//      fragmento o aceptar la versión corregida es siempre un acto de quien investiga.

import { completeJson } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import { getDb } from '../db/database';
import { accessContextFor, getInterview, listSessions } from '../db/testimonyRepo';
import { listSegments, listTranscripts } from '../db/testimonyMediaRepo';
import { evaluateAccess, type AccessChannel } from '@shared/testimonyAccess';
import { isLocalProvider } from '@shared/providers';
import { formatTimecode, preferredTranscript } from '@shared/testimonies';
import { locateQuote, verifyRewrite } from '@shared/testimonyAiGuards';
import type { ModelRef } from '@shared/types';

export interface ProposedCode {
  label: string;
  note: string;
}

export interface ProposedPassage {
  quote: string;
  code: string;
  why: string;
  segmentId: string;
  at: string;
  tStart: number;
}

export interface DiscardedPassage {
  quote: string;
  /** Cuánto de la cita aparecía de verdad en la transcripción, entre 0 y 1. */
  coverage: number;
}

export interface InterviewAnalysis {
  interviewId: string;
  transcriptId: string;
  codes: ProposedCode[];
  passages: ProposedPassage[];
  /** Lo que el modelo dijo y no estaba en la transcripción. Se enseña, no se esconde. */
  discarded: DiscardedPassage[];
  model: string;
}

function channelFor(model: ModelRef | null): AccessChannel {
  return model && isLocalProvider(model.provider) ? 'localAi' : 'externalAi';
}

/** La puerta, con un mensaje que dice qué hacer y no sólo que no. */
function requireAccess(interviewId: string, channel: AccessChannel): void {
  const decision = evaluateAccess(accessContextFor(interviewId), channel, {
    policy: { allowExternalProviders: getSettings().testimonyAllowExternalProviders },
  });
  if (decision.allowed) return;
  const reason = decision.reason ?? 'acceso restringido';
  throw new Error(
    `El acuerdo de esta entrevista no permite tratarla con IA: ${reason}. `
    + 'Documenta el uso «tratamiento por IA» en el acuerdo, o usa un modelo local.'
  );
}

interface TranscriptLine {
  id: string;
  tStart: number;
  text: string;
  speaker: string;
}

/** La versión más autorizada de la entrevista, en líneas con minuto y hablante. */
function transcriptLines(interviewId: string): { transcriptId: string; lines: TranscriptLine[] } {
  const db = getDb();
  const sessions = listSessions(interviewId);
  const media = sessions.flatMap((session) => session.media).filter((item) => !item.deletedAt);
  const transcripts = media.flatMap((item) => listTranscripts(item.id));
  const best = preferredTranscript(transcripts.map((transcript) => ({ id: transcript.id, kind: transcript.kind })));
  if (!best) throw new Error('Esta entrevista todavía no tiene transcripción.');
  const segments = listSegments(best.id);
  if (!segments.length) throw new Error('La transcripción de esta entrevista está vacía.');
  const names = new Map(
    (db
      .prepare(
        `SELECT ip.person_id AS person_id, ip.speaker_label AS label, p.display_name AS name
           FROM testimony_interview_participants ip
           JOIN persons p ON p.person_id = ip.person_id
          WHERE ip.interview_id = ?`
      )
      .all(interviewId) as { person_id: string; label: string | null; name: string }[])
      .map((row) => [row.person_id, row.name] as const)
  );
  return {
    transcriptId: best.id,
    lines: segments.map((segment) => ({
      id: segment.id,
      tStart: segment.tStart,
      text: segment.text,
      speaker: segment.speakerPersonId
        ? names.get(segment.speakerPersonId) ?? segment.speakerLabel ?? 'Hablante'
        : segment.speakerLabel ?? 'Hablante',
    })),
  };
}

const ANALYSIS_SYSTEM = `Eres un ayudante de análisis cualitativo en un proyecto de historia oral.
Tu trabajo es PROPONER códigos temáticos y señalar pasajes que los ilustran.

Reglas que no puedes romper:
- CITA LITERAL. Cada pasaje debe copiarse palabra por palabra de la transcripción. No
  resumas, no arregles la gramática y no juntes frases separadas: si no está tal cual, no
  lo cites.
- NO JUZGUES la credibilidad de quien habla ni la veracidad de lo que cuenta. Un testimonio
  no es una declaración que haya que verificar.
- NO INFIERAS emociones, intenciones ni diagnósticos que la persona no haya expresado.
- NO APRUEBES la transcripción ni sugieras darla por buena.
- Los códigos son temas, no juicios: «silencio familiar» sí, «trauma no resuelto» no.

Devuelve SOLO JSON con esta forma:
{"codes":[{"label":"...","note":"..."}],"passages":[{"quote":"...","code":"...","why":"..."}]}
Entre 3 y 6 códigos, y entre 3 y 10 pasajes.`;

interface RawAnalysis {
  codes: { label?: unknown; note?: unknown }[];
  passages: { quote?: unknown; code?: unknown; why?: unknown }[];
}

function isRawAnalysis(value: unknown): value is RawAnalysis {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as RawAnalysis;
  return Array.isArray(candidate.codes) && Array.isArray(candidate.passages);
}

/**
 * Proponer códigos y pasajes para una entrevista.
 *
 * Lo que devuelve NO está guardado: son propuestas con su ancla ya resuelta a un segmento
 * real, y las que no se pudieron anclar viajan aparte, contadas, para que quien revisa vea
 * cuánto se inventó el modelo en vez de suponer que todo lo que llegó es bueno.
 */
export async function analyzeTestimonyInterview(interviewId: string): Promise<InterviewAnalysis> {
  const interview = getInterview(interviewId);
  if (!interview) throw new Error('Esa entrevista no existe.');
  const settings = getSettings();
  const model = settings.studyModel ?? settings.chatModel ?? settings.synthesisModel ?? null;
  requireAccess(interviewId, channelFor(model));

  const { transcriptId, lines } = transcriptLines(interviewId);
  const body = lines
    .map((line) => `[${formatTimecode(line.tStart)}] ${line.speaker}: ${line.text}`)
    .join('\n');

  const raw = await completeJson<RawAnalysis>(
    {
      system: ANALYSIS_SYSTEM,
      user: `Entrevista: ${interview.title}\n\nTranscripción:\n${body}`,
      maxTokens: 2000,
      temperature: 0.1,
    },
    isRawAnalysis,
    model,
  );

  const codes: ProposedCode[] = raw.codes
    .map((code) => ({ label: String(code.label ?? '').trim(), note: String(code.note ?? '').trim() }))
    .filter((code) => code.label.length > 0)
    .slice(0, 8);

  const passages: ProposedPassage[] = [];
  const discarded: DiscardedPassage[] = [];
  for (const passage of raw.passages) {
    const quote = String(passage.quote ?? '').trim();
    if (!quote) continue;
    // El minuto que diga el modelo da igual: manda dónde APARECE la cita de verdad.
    const match = locateQuote(quote, lines.map((line) => ({ id: line.id, tStart: line.tStart, text: line.text })));
    if (!match.segmentId || match.tStart == null) {
      discarded.push({ quote, coverage: match.coverage });
      continue;
    }
    passages.push({
      quote,
      code: String(passage.code ?? '').trim(),
      why: String(passage.why ?? '').trim(),
      segmentId: match.segmentId,
      tStart: match.tStart,
      at: formatTimecode(match.tStart),
    });
  }

  return {
    interviewId,
    transcriptId,
    codes,
    passages,
    discarded,
    model: model ? `${model.provider}/${model.model}` : 'sin modelo',
  };
}

// ── Corregir la transcripción ────────────────────────────────────────────────

export interface ImprovedSegment {
  segmentId: string;
  before: string;
  after: string;
  /** `false` cuando el modelo cambió palabras y por eso se conserva el original. */
  accepted: boolean;
  /** Qué cambió, cuando no se aceptó. */
  removed: string[];
  added: string[];
}

export interface TranscriptImprovement {
  transcriptId: string;
  segments: ImprovedSegment[];
  accepted: number;
  rejected: number;
  model: string;
}

const IMPROVE_SYSTEM = `Corriges transcripciones automáticas de entrevistas de historia oral.

Tu trabajo es SOLO este:
- puntuar y poner mayúsculas,
- separar en frases lo que el reconocedor dejó seguido,
- arreglar la ortografía de palabras mal reconocidas.

Lo que NO puedes hacer:
- cambiar, quitar ni añadir palabras,
- resumir, reordenar ni «mejorar» la manera de hablar de nadie,
- quitar repeticiones, titubeos ni muletillas: son parte del testimonio.

Devuelve SOLO JSON: {"segments":[{"i":0,"text":"..."}]} con un objeto por cada línea que
recibas, en el mismo orden y con el mismo índice.`;

interface RawImprovement {
  segments: { i?: unknown; text?: unknown }[];
}

function isRawImprovement(value: unknown): value is RawImprovement {
  return !!value && typeof value === 'object' && Array.isArray((value as RawImprovement).segments);
}

/** Cuántos tramos van en cada llamada: suficientes para que haya contexto y pocos para que quepan. */
const IMPROVE_BATCH = 25;

/**
 * Proponer una corrección de la transcripción, tramo a tramo.
 *
 * Cada tramo pasa por `verifyRewrite`. Lo que el modelo reescribe de más NO se acepta y se
 * devuelve el original, con la lista de palabras que quiso quitar o añadir: en un
 * testimonio, «lo mismo pero mejor dicho» es exactamente el error que no se puede cometer.
 */
export async function improveTestimonyTranscript(transcriptId: string): Promise<TranscriptImprovement> {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT t.id AS id, s.interview_id AS interview_id
         FROM testimony_transcripts t
         JOIN testimony_media m ON m.id = t.media_id
         JOIN testimony_sessions s ON s.id = m.session_id
        WHERE t.id = ?`
    )
    .get(transcriptId) as { id: string; interview_id: string } | undefined;
  if (!row) throw new Error('Esa versión de la transcripción no existe.');

  const settings = getSettings();
  const model = settings.improveModel ?? settings.chatModel ?? settings.synthesisModel ?? null;
  requireAccess(row.interview_id, channelFor(model));

  const segments = listSegments(transcriptId);
  if (!segments.length) throw new Error('Esta versión no tiene tramos que corregir.');

  const out: ImprovedSegment[] = [];
  for (let start = 0; start < segments.length; start += IMPROVE_BATCH) {
    const batch = segments.slice(start, start + IMPROVE_BATCH);
    const numbered = batch.map((segment, index) => `${index}. ${segment.text}`).join('\n');
    const raw = await completeJson<RawImprovement>(
      { system: IMPROVE_SYSTEM, user: numbered, maxTokens: 2500, temperature: 0 },
      isRawImprovement,
      model,
    );
    const byIndex = new Map<number, string>();
    for (const item of raw.segments) {
      const index = Number(item.i);
      if (Number.isInteger(index) && typeof item.text === 'string') byIndex.set(index, item.text.trim());
    }
    batch.forEach((segment, index) => {
      const proposed = byIndex.get(index);
      if (!proposed) {
        out.push({ segmentId: segment.id, before: segment.text, after: segment.text, accepted: false, removed: [], added: [] });
        return;
      }
      const verdict = verifyRewrite(segment.text, proposed);
      out.push({
        segmentId: segment.id,
        before: segment.text,
        after: verdict.accepted ? proposed : segment.text,
        accepted: verdict.accepted,
        removed: verdict.removed.slice(0, 6),
        added: verdict.added.slice(0, 6),
      });
    });
  }

  return {
    transcriptId,
    segments: out,
    accepted: out.filter((segment) => segment.accepted).length,
    rejected: out.filter((segment) => !segment.accepted).length,
    model: model ? `${model.provider}/${model.model}` : 'sin modelo',
  };
}
