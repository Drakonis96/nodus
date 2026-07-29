// El contexto que la IA puede ver de un vault de Testimonios.
//
// ESTE MÓDULO ES LA PUERTA, y por eso es el ÚNICO camino por el que material de una
// entrevista llega a un prompt. Toda entrevista pasa por `evaluateAccess` en el canal que
// corresponde al proveedor (local o externo), y lo que no pasa NO SE INCLUYE — ni siquiera
// su título recortado, ni «hay una entrevista sobre esto que no puedo enseñarte con
// detalle». El modelo recibe únicamente lo que el acuerdo autoriza.
//
// Lo que ADEMÁS hace, y sin lo cual el filtro sería inútil:
//
//   · Sustituye los nombres. Ninguna cita sale con el nombre real de quien pidió
//     seudónimo, y el nombre de trabajo no aparece en ningún campo.
//   · Deja fuera los documentos de acuerdo y las notas de campo. Un acuerdo escaneado es
//     un documento con firmas; no es material de análisis.
//   · Cita SIEMPRE con hablante, entrevista y minuto, para que el modelo no pueda producir
//     una afirmación sobre el corpus sin decir de dónde sale.
//   · Prefiere la versión más autorizada de cada transcripción. Dar el literal a un modelo
//     y dejar que lo cite como palabras del narrador es convertir un error de
//     reconocimiento en una fuente.

import { getDb } from '../db/database';
import { accessContextFor } from '../db/testimonyRepo';
import { getSettings } from '../db/settingsRepo';
import { evaluateAccess, type AccessChannel } from '@shared/testimonyAccess';
import { displayNameFor, formatTimecode } from '@shared/testimonies';
import { effectiveAttribution } from '@shared/testimonyAccess';

export interface TestimonyAiContext {
  vault: string;
  /** Qué se ha dejado fuera y por qué, para que el modelo NO lo dé por inexistente. */
  withheld: { interviews: number; reason: string }[];
  interviews: {
    shortId: string;
    title: string;
    date: string | null;
    collection: string | null;
    narrators: string[];
    abstract: string | null;
    access: string;
    passages: { speaker: string; at: string; text: string; codes: string[]; cite: string }[];
  }[];
}

const MAX_INTERVIEWS = 8;
const MAX_PASSAGES = 12;
const MAX_PASSAGE_CHARS = 700;

interface Row {
  interview_id: string;
  short_id: string;
  title: string;
  date: string | null;
  collection_label: string | null;
  abstract: string | null;
}

/**
 * Construir el contexto para una pregunta.
 *
 * `channel` decide la exigencia: con un proveedor externo hay que haber documentado el
 * envío fuera del equipo, y el ajuste del vault puede cerrarlo aunque el acuerdo lo abra.
 */
export function buildTestimonyChatContext(
  question: string,
  options: { vaultName: string; channel?: AccessChannel; now?: Date } = { vaultName: '' },
): TestimonyAiContext {
  const db = getDb();
  const channel: AccessChannel = options.channel ?? 'localAi';
  const now = options.now ?? new Date();
  const policy = { allowExternalProviders: getSettings().testimonyAllowExternalProviders };

  const terms = question
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 4)
    .slice(0, 6);

  const candidates = db
    .prepare(
      `SELECT i.id AS interview_id, i.short_id AS short_id, i.title AS title,
              COALESCE(i.conducted_at, i.scheduled_at) AS date,
              i.collection_label AS collection_label, i.abstract AS abstract
         FROM testimony_interviews i
        WHERE i.deleted_at IS NULL
        ORDER BY i.updated_at DESC
        LIMIT 60`
    )
    .all() as Row[];

  const withheldReasons = new Map<string, number>();
  const interviews: TestimonyAiContext['interviews'] = [];

  for (const row of candidates) {
    if (interviews.length >= MAX_INTERVIEWS) break;
    const decision = evaluateAccess(accessContextFor(row.interview_id), channel, { now, policy });
    if (!decision.allowed) {
      const reason = decision.reason ?? 'access_restricted';
      withheldReasons.set(reason, (withheldReasons.get(reason) ?? 0) + 1);
      continue;
    }

    const agreement = accessContextFor(row.interview_id);
    const people = db
      .prepare(
        `SELECT ip.role AS role, p.display_name AS working_name, pr.public_name AS public_name,
                COALESCE(pr.identity_mode, 'identified') AS identity_mode
           FROM testimony_interview_participants ip
           JOIN persons p ON p.person_id = ip.person_id
           LEFT JOIN testimony_participant_profiles pr ON pr.person_id = ip.person_id
          WHERE ip.interview_id = ? AND ip.role = 'narrator'`
      )
      .all(row.interview_id) as { role: string; working_name: string; public_name: string | null; identity_mode: 'identified' | 'pseudonym' | 'anonymous' }[];

    const narrators = people.map((person) =>
      displayNameFor(
        { workingName: person.working_name, publicName: person.public_name, identityMode: person.identity_mode },
        effectiveAttribution(person.identity_mode, agreement.attributionMode)
      ));

    // Los pasajes se buscan por los términos de la pregunta y, si no hay ninguno, se
    // toman los fragmentos ya codificados: material que el investigador consideró
    // relevante, en vez de los primeros minutos de la grabación.
    const like = terms.map(() => 'seg.text LIKE ?').join(' OR ');
    const params = terms.map((term) => `%${term}%`);
    const passages = db
      .prepare(
        `SELECT seg.text AS text, seg.t_start AS t_start,
                seg.speaker_person_id AS person_id, seg.speaker_label AS speaker_label,
                p.display_name AS working_name, pr.public_name AS public_name,
                COALESCE(pr.identity_mode, 'identified') AS identity_mode,
                (SELECT GROUP_CONCAT(c.label, '; ') FROM testimony_annotations a
                   JOIN testimony_annotation_codes ac ON ac.annotation_id = a.id
                   JOIN testimony_codes c ON c.id = ac.code_id
                  WHERE a.segment_id = seg.id) AS codes
           FROM testimony_transcript_segments seg
           JOIN testimony_transcripts t ON t.id = seg.transcript_id
           JOIN testimony_media m ON m.id = t.media_id
           JOIN testimony_sessions s ON s.id = m.session_id
           LEFT JOIN persons p ON p.person_id = seg.speaker_person_id
           LEFT JOIN testimony_participant_profiles pr ON pr.person_id = seg.speaker_person_id
          WHERE s.interview_id = ?
            AND t.id = (
              SELECT x.id FROM testimony_transcripts x
               WHERE x.media_id = m.id AND x.status = 'ready'
               ORDER BY CASE x.kind
                          WHEN 'approved' THEN 0 WHEN 'reviewed' THEN 1 WHEN 'corrected' THEN 2
                          WHEN 'anonymized' THEN 3 WHEN 'translation' THEN 4 ELSE 5 END,
                        x.version_no DESC
               LIMIT 1)
            ${terms.length > 0 ? `AND (${like})` : ''}
          ORDER BY seg.t_start
          LIMIT ${MAX_PASSAGES}`
      )
      .all(row.interview_id, ...params) as {
        text: string; t_start: number; person_id: string | null; speaker_label: string | null;
        working_name: string | null; public_name: string | null; identity_mode: 'identified' | 'pseudonym' | 'anonymous';
        codes: string | null;
      }[];

    if (passages.length === 0 && terms.length > 0) continue;

    interviews.push({
      shortId: row.short_id,
      title: row.title,
      date: row.date,
      collection: row.collection_label,
      narrators,
      abstract: row.abstract,
      access: agreement.accessLevel,
      passages: passages.map((passage) => {
        const speaker = passage.working_name
          ? displayNameFor(
              { workingName: passage.working_name, publicName: passage.public_name, identityMode: passage.identity_mode },
              effectiveAttribution(passage.identity_mode, agreement.attributionMode)
            )
          : passage.speaker_label ?? 'Sin identificar';
        const at = formatTimecode(passage.t_start);
        return {
          speaker,
          at,
          text: passage.text.slice(0, MAX_PASSAGE_CHARS),
          codes: passage.codes ? passage.codes.split('; ') : [],
          // La cita va MONTADA, no en piezas: si el modelo tuviera que componerla, la
          // compondría mal la primera vez que le falte un campo.
          cite: `${speaker}, ${row.title}, ${at}`,
        };
      }),
    });
  }

  return {
    vault: options.vaultName,
    withheld: [...withheldReasons.entries()].map(([reason, count]) => ({ interviews: count, reason })),
    interviews,
  };
}
