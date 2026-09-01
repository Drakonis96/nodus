/**
 * «De los latidos que declaraste para esta escena, ¿cuáles no aparecen en lo que has
 * escrito?»
 *
 * La tercera y última llamada a un modelo de todo el vault de worldbuilding, y la que A9
 * rechazó **por falta de entrada**: su fuente entonces era `world_scenes.summary`, que es
 * NULLABLE y en un vault real está vacío casi siempre. El manuscrito la creó.
 *
 * La pregunta es deliberadamente estrecha, y esa estrechez es lo que la hace defendible:
 * el autor ya declaró qué tiene que moverse en esta escena (los latidos son suyos, no de
 * nadie más), y lo único que se le pide al modelo es LEER y decir si eso está en la página.
 * No juzga la prosa, no propone reescrituras, no sugiere frases. Si contestara «tu diálogo
 * es plano» estaría opinando sobre una novela que no es suya.
 *
 * Puro: el prompt y —sobre todo— la lectura de la respuesta se prueban sin proveedor.
 */

export interface ProseReviewBeat {
  /** `conflicto: La guerra por el vado`, `regla: La sangre paga la sangre`… */
  threadLabel: string;
  /** The four-word mark, translated: sube la presión, la rompe, gira… */
  mark: string;
  /** What the author said would change, when they wrote it down. */
  text: string | null;
}

export interface ProseReviewSources {
  sceneTitle: string;
  beats: ProseReviewBeat[];
  prose: string;
}

import { proseReviewContextCopy } from './worldContextPromptPacks';
import type { PromptLanguage } from './types';

export const WORLD_PROSE_REVIEW_SYSTEM = `Lees una escena de una novela y dices, de una lista de cosas que el autor dijo que tenían que pasar en ella, cuáles aparecen de verdad en el texto y cuáles no.

Reglas, sin excepción:
- NO opinas sobre la prosa. No la juzgas, no la reescribes, no propones frases ni das consejos de estilo. Sólo dices si cada cosa está o no está.
- «Está» significa que un lector se enteraría leyendo SOLO este texto. Que se pueda deducir del resto del libro no cuenta: aquí se comprueba la página.
- Una insinuación deliberada cuenta como que está, y lo dices en la nota.
- No inventes nombres ni hechos que no estén en el texto.
- Responde SOLO con este formato, una línea por cada cosa de la lista y en el mismo orden, sin preámbulo:
LATIDO: <sí | no> — <por qué, en una frase corta>`;

/** Sin latidos declarados no hay nada contra lo que leer, y sin prosa tampoco. */
export function hasProseReviewMaterial(sources: ProseReviewSources): boolean {
  return sources.beats.length > 0 && sources.prose.trim().length > 0;
}

export function composeProseReviewContext(sources: ProseReviewSources, language: PromptLanguage = 'es'): string {
  const copy = proseReviewContextCopy(language);
  const lines: string[] = [`${copy.scene}: ${sources.sceneTitle}`, '', `${copy.declaredBeats}:`];
  sources.beats.forEach((beat, index) => {
    lines.push(`${index + 1}. ${beat.threadLabel} — ${beat.mark}${beat.text ? `: ${beat.text}` : ''}`);
  });
  lines.push('', `${copy.sceneText}:`, sources.prose.trim(), '');
  lines.push(copy.ask(sources.beats.length));
  return lines.join('\n');
}

// ── Leer la respuesta ────────────────────────────────────────────────────────

const LINE_RE = /^[\s>*\-–—•\d.)]*\*{0,2}\s*latido\s*\d*\s*\*{0,2}\s*[:.\-–—]\s*(.+)$/i;
// `\b` es ASCII: detrás de «sí» y delante de «:» NO hay frontera de palabra para JS, así
// que la versión con \b descartaba en silencio TODOS los síes en español y dejaba cada
// latido sin leer. La condición correcta es «no le sigue otra letra», con el flag unicode.
const YES_RE = /^\s*\*{0,2}\s*(s[ií]|yes|aparece)(?![\p{L}\p{N}])/iu;
const NO_RE = /^\s*\*{0,2}\s*(no|falta|ausente)(?![\p{L}\p{N}])/iu;

export interface ProseReviewVerdict {
  present: boolean;
  note: string | null;
}

/**
 * Los veredictos, en el orden de la lista.
 *
 * Lo que NO hace es rellenar: si el modelo devuelve tres líneas para cuatro latidos, vuelven
 * tres y el cuarto se queda sin leer. Inventar un «sí» por defecto sería decirle al autor
 * que algo está en la página cuando nadie lo ha comprobado, que es exactamente el error que
 * esta comprobación existe para no cometer. Y una línea sin un sí/no reconocible se descarta
 * entera por la misma razón.
 */
export function parseProseReview(text: string): ProseReviewVerdict[] {
  const verdicts: ProseReviewVerdict[] = [];
  for (const line of (text ?? '').split(/\r?\n/)) {
    const match = LINE_RE.exec(line);
    if (!match) continue;
    const body = match[1].trim();
    const present = YES_RE.test(body);
    if (!present && !NO_RE.test(body)) continue;
    const note = body
      .replace(present ? YES_RE : NO_RE, '')
      .replace(/^\s*[—–\-:,.]\s*/, '')
      .replace(/\*{2,}/g, '')
      .trim();
    verdicts.push({ present, note: note || null });
  }
  return verdicts;
}
