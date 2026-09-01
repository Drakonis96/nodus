/**
 * The prompt, the context and the parser for proposing answers to an open question.
 *
 * The second and last place a model is allowed into "Analizar", and the one where the
 * quarantine is STRUCTURAL rather than a column: a proposed option is not canon, it is a
 * pending write that only happens if the author chooses it and presses the button that
 * names what it will do. So there is no accept step here — choosing IS the accept step —
 * and three proposals that nobody picks cost nothing but a row each.
 *
 * Three, and always three. Two reads as a dilemma the model has already resolved; five is a
 * menu, and a menu is what turns a decision into a shrug.
 *
 * Pure: the composition and, above all, the parser are asserted without a provider.
 */

import type { AppLanguage } from './types';
import { normalizeUiLanguage, worldEntryKindLabel, worldFieldLabel } from './worldPromptLanguage';
import { worldOperationSystemPrompt } from './worldOperationPrompts';

export interface WorldQuestionSources {
  question: string;
  anchorTitle: string | null;
  /** The kind, translated: Personaje, Lugar, Facción… */
  anchorKind: string | null;
  /** The field an answer would be written into, translated: Trasfondo, Historia… */
  fieldLabel: string | null;
  /** The line the hole sits in, verbatim. */
  evidence: string | null;
  /** What the anchor's sheet already says. The single biggest reason an option belongs to
   *  this character rather than to a generic one. */
  anchorProse: { field: string; text: string }[];
  /** What the author has already written as options, so the model does not repeat them. */
  existing: string[];
  neighbours: { title: string; kind: string; summary: string | null }[];
  /** The next unwritten scene that leans on this, when there is one. */
  blockedScene: string | null;
}

export const WORLD_QUESTION_OPTIONS_SYSTEM = `Propones respuestas posibles a algo que un autor todavía no ha decidido de su mundo de ficción.

Reglas, sin excepción:
- Lo que consta en el material es CANON. No lo contradigas, no lo "corrijas" y no lo suavices.
- No introduzcas nombres propios (personas, lugares, facciones, objetos) que no aparezcan en el material.
- Copia literalmente los nombres, epítetos y fechas tal como los escribe el autor: no los traduzcas, normalices ni conviertas a un calendario terrestre.
- Propón EXACTAMENTE TRES respuestas, y que sean de verdad distintas: tres variantes de la misma idea no son una decisión.
- Cada respuesta se escribirá tal cual en la ficha del autor, así que redáctala como prosa suya: una o dos frases, en su tercera persona, sin comentarla ni justificarla.
- Debajo de cada una, di en una frase QUÉ ARRASTRA: a qué obliga después, con quién choca, qué deja de ser posible.
- No repitas las respuestas que el autor ya ha escrito.
- Responde solo con este formato, sin preámbulo y sin nada más:
OPCIÓN: <la respuesta>
IMPLICA: <lo que arrastra>`;

/** Localized system contract for direct users of this pure context module. */
export function worldQuestionOptionsSystemPrompt(language: AppLanguage = 'es'): string {
  return worldOperationSystemPrompt('questionOptions', normalizeUiLanguage(language));
}

/**
 * True when there is something to answer.
 *
 * The degenerate case is real and common: a field that contains nothing but `???` becomes a
 * question whose whole text is `???`, and asking a model to answer that produces three
 * pieces of generic fantasy. Either the question says something, or the sheet it hangs off
 * does.
 */
export function hasWorldQuestionMaterial(sources: WorldQuestionSources): boolean {
  const words = sources.question.trim().split(/\s+/).filter((word) => /\p{L}/u.test(word));
  return words.length >= 3 || sources.anchorProse.length > 0 || sources.neighbours.length > 0;
}

export function composeWorldQuestionContext(sources: WorldQuestionSources, language: AppLanguage = 'es'): string {
  const locale = normalizeUiLanguage(language);
  const copy = QUESTION_CONTEXT_COPY[locale];
  const lines: string[] = [];
  lines.push(`${copy.question}: ${sources.question.trim()}`);
  if (sources.anchorTitle) {
    lines.push(
      `${copy.about}: ${sources.anchorTitle}${sources.anchorKind ? ` (${worldEntryKindLabel(sources.anchorKind, locale)})` : ''}${
        sources.fieldLabel ? ` — ${copy.writtenIn} «${worldFieldLabel(sources.fieldLabel, locale)}»` : ''
      }`
    );
  }
  if ((sources.evidence ?? '').trim()) lines.push(`${copy.evidence}: ${sources.evidence!.trim()}`);
  if (sources.blockedScene) lines.push(`${copy.blocksScene}: ${sources.blockedScene}`);

  if (sources.anchorProse.length) {
    lines.push('');
    lines.push(copy.anchorProse);
    for (const block of sources.anchorProse) lines.push(`- ${worldFieldLabel(block.field, locale)}: ${block.text.trim()}`);
  }

  if (sources.neighbours.length) {
    lines.push('');
    lines.push(copy.neighbours);
    for (const neighbour of sources.neighbours) {
      lines.push(`- ${neighbour.title} (${worldEntryKindLabel(neighbour.kind, locale)})${neighbour.summary ? `: ${neighbour.summary}` : ''}`);
    }
  }

  if (sources.existing.length) {
    lines.push('');
    lines.push(copy.existing);
    for (const option of sources.existing) lines.push(`- ${option}`);
  }

  lines.push('');
  lines.push(copy.propose);
  return lines.join('\n');
}

const QUESTION_CONTEXT_COPY: Record<AppLanguage, {
  question: string; about: string; writtenIn: string; evidence: string; blocksScene: string;
  anchorProse: string; neighbours: string; existing: string; propose: string;
}> = {
  es: { question: 'LO QUE FALTA POR DECIDIR', about: 'SOBRE', writtenIn: 'se escribirá en', evidence: 'LA FRASE DONDE ESTÁ EL HUECO', blocksScene: 'BLOQUEA LA ESCENA', anchorProse: 'LO QUE LA FICHA YA DICE (respétalo; la respuesta tiene que encajar aquí):', neighbours: 'EL MUNDO ALREDEDOR (úsalo; no inventes nada fuera de aquí):', existing: 'LO QUE EL AUTOR YA HA ESCRITO COMO RESPUESTA (no lo repitas):', propose: 'Propón tres respuestas posibles.' },
  en: { question: 'WHAT REMAINS UNDECIDED', about: 'ABOUT', writtenIn: 'will be written in', evidence: 'THE SENTENCE WITH THE GAP', blocksScene: 'BLOCKS THE SCENE', anchorProse: 'WHAT THE RECORD ALREADY SAYS (respect it; the answer must fit here):', neighbours: 'THE WORLD AROUND IT (use it; invent nothing beyond it):', existing: 'WHAT THE AUTHOR HAS ALREADY WRITTEN AS AN ANSWER (do not repeat it):', propose: 'Propose three possible answers.' },
  fr: { question: 'CE QUI RESTE À DÉCIDER', about: 'À PROPOS DE', writtenIn: 'sera écrit dans', evidence: 'LA PHRASE OÙ SE TROUVE LE TROU', blocksScene: 'BLOQUE LA SCÈNE', anchorProse: 'CE QUE DIT DÉJÀ LA FICHE (respecte-le ; la réponse doit s’y accorder) :', neighbours: 'LE MONDE AUTOUR (utilise-le ; n’invente rien au-delà) :', existing: 'CE QUE L’AUTEUR A DÉJÀ ÉCRIT COMME RÉPONSE (ne le répète pas) :', propose: 'Propose trois réponses possibles.' },
  de: { question: 'NOCH NICHT ENTSCHIEDEN', about: 'ZU', writtenIn: 'wird eingetragen in', evidence: 'DER SATZ MIT DER LÜCKE', blocksScene: 'BLOCKIERT DIE SZENE', anchorProse: 'WAS IM EINTRAG BEREITS STEHT (beachten; die Antwort muss hierher passen):', neighbours: 'DIE WELT DARUM (verwenden; nichts darüber hinaus erfinden):', existing: 'WAS DIE AUTORIN ODER DER AUTOR BEREITS ALS ANTWORT GESCHRIEBEN HAT (nicht wiederholen):', propose: 'Schlage drei mögliche Antworten vor.' },
  pt: { question: 'O QUE FALTA DECIDIR', about: 'SOBRE', writtenIn: 'será escrito em', evidence: 'A FRASE ONDE ESTÁ A LACUNA', blocksScene: 'BLOQUEIA A CENA', anchorProse: 'O QUE A FICHA JÁ DIZ (respeita-o; a resposta tem de se encaixar aqui):', neighbours: 'O MUNDO À VOLTA (usa-o; não inventes para além dele):', existing: 'O QUE O AUTOR JÁ ESCREVEU COMO RESPOSTA (não repitas):', propose: 'Propõe três respostas possíveis.' },
  'pt-BR': { question: 'O QUE FALTA DECIDIR', about: 'SOBRE', writtenIn: 'será escrito em', evidence: 'A FRASE ONDE ESTÁ A LACUNA', blocksScene: 'BLOQUEIA A CENA', anchorProse: 'O QUE A FICHA JÁ DIZ (respeite; a resposta precisa se encaixar aqui):', neighbours: 'O MUNDO AO REDOR (use-o; não invente além dele):', existing: 'O QUE O AUTOR JÁ ESCREVEU COMO RESPOSTA (não repita):', propose: 'Proponha três respostas possíveis.' },
  it: { question: 'COSA RESTA DA DECIDERE', about: 'RIGUARDO A', writtenIn: 'sarà scritto in', evidence: 'LA FRASE CON IL VUOTO', blocksScene: 'BLOCCA LA SCENA', anchorProse: 'COSA DICE GIÀ LA SCHEDA (rispettalo; la risposta deve adattarsi):', neighbours: 'IL MONDO INTORNO (usalo; non inventare oltre):', existing: 'COSA HA GIÀ SCRITTO L’AUTORE COME RISPOSTA (non ripeterlo):', propose: 'Proponi tre risposte possibili.' },
  tr: { question: 'KARAR VERİLMEYEN KISIM', about: 'HAKKINDA', writtenIn: 'şuraya yazılacak', evidence: 'BOŞLUĞUN BULUNDUĞU CÜMLE', blocksScene: 'SAHNEYİ ENGELLİYOR', anchorProse: 'KAYDIN ZATEN SÖYLEDİKLERİ (uy; yanıt buraya oturmalı):', neighbours: 'ÇEVRESİNDEKİ DÜNYA (kullan; bunun dışında bir şey uydurma):', existing: 'YAZARIN YANIT OLARAK ZATEN YAZDIKLARI (tekrarlama):', propose: 'Üç olası yanıt öner.' },
};

// ── Reading the answer back ──────────────────────────────────────────────────

// Two labelled lines rather than JSON, and that is a decision about which models this has
// to work with, not a shortcut. This is the warmest call in the app (temperature 0.9), and
// JSON mode fights warmth: the escalation path of `completeJson` lowers the temperature
// until the model complies, which for a creative call means paying for three turns to get
// the dullest of the three. Local models are worse still — most of the ones a writer
// actually runs emit prose around their JSON, or nothing at all. Two prefixes survive a
// preamble, a numbered list, markdown bold and a trailing apology.
const OPTION_RE = /^[\s>*\-–—•\d.)]*\*{0,2}\s*opci[oó]n\s*\d*\s*\*{0,2}\s*[:.\-–—]\s*(.+)$/i;
const IMPLIES_RE = /^[\s>*\-–—•]*\*{0,2}\s*implica(?:ciones)?\s*\*{0,2}\s*[:.\-–—]\s*(.+)$/i;
/** A wrapped line: indented and unlabelled. The indentation is what tells a continuation
 *  apart from the model's closing pleasantry, which is never indented. */
const CONTINUATION_RE = /^\s+(\S.*)$/;

function clean(value: string): string {
  return value.replace(/\*{2,}/g, '').replace(/^["“«\s]+|["”»\s]+$/g, '').trim();
}

/**
 * The options a reply contains, in order, capped at three.
 *
 * Anything before the first `OPCIÓN:` is dropped, an `IMPLICA:` with no option above it is
 * dropped, and an option with no implications is KEPT: the answer is the part that gets
 * written into the world, and losing three usable answers because the model forgot the
 * second line would be the parser deciding it knows better.
 */
export function parseQuestionOptions(text: string): { text: string; implications: string | null }[] {
  const options: { text: string; implications: string | null }[] = [];
  /** Which half of the last option a wrapped line belongs to. */
  let open: 'text' | 'implications' | null = null;

  const append = (slot: 'text' | 'implications', body: string) => {
    const current = options[options.length - 1];
    const previous = current[slot];
    current[slot] = previous ? `${previous} ${body}` : body;
  };

  for (const line of (text ?? '').split(/\r?\n/)) {
    const option = OPTION_RE.exec(line);
    if (option) {
      const body = clean(option[1]);
      if (body) {
        options.push({ text: body, implications: null });
        open = 'text';
      }
      continue;
    }

    const implies = IMPLIES_RE.exec(line);
    if (implies) {
      const body = clean(implies[1]);
      if (body && options.length > 0) {
        append('implications', body);
        open = 'implications';
      }
      continue;
    }

    // A wrapped continuation of whichever half was last open. Only indented lines qualify,
    // so the model's «espero que te sirvan» stays out of somebody's manuscript.
    const wrapped = CONTINUATION_RE.exec(line);
    if (wrapped && open && options.length > 0) {
      const body = clean(wrapped[1]);
      if (body) append(open, body);
      continue;
    }
    // An unindented line that is neither: the block is over.
    if (line.trim()) open = null;
  }
  return options.slice(0, 3);
}
