/**
 * What the world talks about but has never defined.
 *
 * The design decision that makes this feature trustworthy: **candidate extraction is
 * deterministic and pure; the model only ranks and describes.** Half of it needs no
 * provider at all, and the half that does cannot invent a term the world does not
 * actually contain.
 *
 * Two producers, and they are not equally strong:
 *  - an unresolved `[[…]]` is a FACT the author already stated — they wrote a link to
 *    something and never made it. It is free, exact, and already a to-do list.
 *  - a capitalised n-gram that recurs is a GUESS. It is offered second, and the UI must
 *    never present it with the confidence of the first.
 */

import { normalizeTitle } from './worldEncyclopedia';
import type { WorldEntry, WorldEntryKey } from './types';

export interface CandidateOccurrence {
  key: WorldEntryKey;
  title: string;
  snippet: string;
}

export interface EntryCandidate {
  term: string;
  termKey: string;
  source: 'unresolved_link' | 'frequency';
  occurrences: CandidateOccurrence[];
}

export interface CandidateBody {
  key: WorldEntryKey;
  title: string;
  field: string;
  text: string;
}

/**
 * Words that start a sentence in Spanish and are capitalised for that reason alone.
 * Deliberately short: a long stoplist starts eating real proper nouns, and the
 * appears-in-two-entries rule already removes most of the noise.
 */
const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'y', 'o', 'a', 'en',
  'con', 'por', 'para', 'sin', 'sobre', 'tras', 'que', 'como', 'cuando', 'donde', 'pero',
  'su', 'sus', 'mi', 'tu', 'al', 'lo', 'se', 'no', 'si', 'ya', 'muy', 'más', 'este', 'esta',
  'estos', 'estas', 'ese', 'esa', 'aquel', 'todo', 'toda', 'todos', 'todas', 'es', 'era',
  'son', 'fue', 'ha', 'han', 'hay', 'desde', 'hasta', 'entre', 'aunque', 'porque', 'nunca',
  'siempre', 'también', 'entonces', 'después', 'antes', 'luego', 'así', 'aún', 'cada',
]);

const WORD = "A-Za-zÁÉÍÓÚÜÑáéíóúüñ";
/**
 * A RUN of up to three capitalised words, not a single one.
 *
 * With single words «Kaelen Vor» is seen as «Kaelen» plus «Vor», neither of which matches
 * the existing character, and the analysis proposes both halves of a name the author has
 * already written. Matching the run greedily means the whole name is consumed as one term
 * and recognised as known.
 */
const CAPITALISED = new RegExp(`[A-ZÁÉÍÓÚÜÑ][${WORD}]+(?:\\s+[A-ZÁÉÍÓÚÜÑ][${WORD}]+){0,2}`, 'g');
const SENTENCE_END = /[.!?¡¿:;\n]\s*$/;

/** `[[X]]` again — but only the shape, since a body reaching this point has already been
 *  through the link parser and the resolved ones were rewritten. */
const PENDING = /\[\[([^\][\n]+)\]\]/g;

export interface CollectOptions {
  /** How many times a guessed term must appear before it is worth offering. */
  minOccurrences?: number;
  /** …and across how many different entries. One entry repeating a word is a style tic. */
  minEntries?: number;
  extraStopwords?: string[];
}

/**
 * Every term the world uses without defining, strongest evidence first.
 *
 * `entries` is what already EXISTS: a candidate matching any title or alias is not a
 * candidate at all, which is what stops the analysis from proposing the cast back to the
 * author on every run.
 */
export function collectEntryCandidates(
  bodies: CandidateBody[],
  entries: WorldEntry[],
  options: CollectOptions = {}
): EntryCandidate[] {
  const minOccurrences = options.minOccurrences ?? 3;
  const minEntries = options.minEntries ?? 2;

  const known = new Set<string>();
  // Every WORD of an existing name counts as known too. Without this, a world containing
  // «Kaelen Vor» and «el Cuervo» still gets «Cuervo» proposed as an undefined term the
  // moment somebody writes it without the article — which is noise of exactly the kind
  // that makes a writer stop reading the panel.
  for (const entry of entries) {
    for (const name of [entry.title, ...entry.aliases]) {
      const key = normalizeTitle(name ?? '');
      if (!key) continue;
      known.add(key);
      for (const part of key.split(' ')) if (part.length >= 4) known.add(part);
    }
  }
  const stop = new Set([...STOPWORDS, ...(options.extraStopwords ?? []).map((word) => word.toLowerCase())]);

  const pending = new Map<string, EntryCandidate>();
  const guessed = new Map<string, EntryCandidate & { entryKeys: Set<string>; sentenceStartOnly: boolean }>();

  for (const body of bodies) {
    const text = body.text ?? '';

    for (const match of text.matchAll(PENDING)) {
      const term = match[1].trim();
      const termKey = normalizeTitle(term);
      // An unresolved link whose text now names something real is not missing: it will be
      // promoted on the next save of that body.
      if (!termKey || known.has(termKey)) continue;
      const candidate = pending.get(termKey) ?? { term, termKey, source: 'unresolved_link' as const, occurrences: [] };
      candidate.occurrences.push({ key: body.key, title: body.title, snippet: windowAround(text, match.index ?? 0) });
      pending.set(termKey, candidate);
    }

    for (const match of text.matchAll(CAPITALISED)) {
      // A capitalised article at the start of a sentence glues itself to the name that
      // follows it: «El Verdugo volvió» and «al Verdugo» would otherwise be counted as two
      // different terms, and neither would reach the threshold the other was carrying.
      const term = stripLeadingStopwords(match[0], stop);
      const termKey = normalizeTitle(term);
      if (!termKey || known.has(termKey) || stop.has(termKey) || term.length < 4) continue;
      const at = match.index ?? 0;
      // A capital after a full stop is grammar, not a name — unless the same word also
      // appears mid-sentence somewhere, which is what `sentenceStartOnly` tracks.
      const atSentenceStart = at === 0 || SENTENCE_END.test(text.slice(Math.max(0, at - 3), at));
      const entryForTerm =
        guessed.get(termKey) ??
        {
          term,
          termKey,
          source: 'frequency' as const,
          occurrences: [] as CandidateOccurrence[],
          entryKeys: new Set<string>(),
          sentenceStartOnly: true,
        };
      if (!atSentenceStart) entryForTerm.sentenceStartOnly = false;
      entryForTerm.entryKeys.add(body.key);
      if (entryForTerm.occurrences.length < 4) {
        entryForTerm.occurrences.push({ key: body.key, title: body.title, snippet: windowAround(text, at) });
      } else {
        // Keep counting past the sample cap, or the threshold below would be a cap on
        // evidence rather than on display.
        entryForTerm.occurrences.push({ key: body.key, title: body.title, snippet: '' });
      }
      guessed.set(termKey, entryForTerm);
    }
  }

  const frequency = [...guessed.values()]
    .filter(
      (candidate) =>
        candidate.occurrences.length >= minOccurrences &&
        candidate.entryKeys.size >= minEntries &&
        !candidate.sentenceStartOnly &&
        // A term the author already wrote as [[…]] is reported once, as the stronger kind.
        !pending.has(candidate.termKey)
    )
    .map(({ term, termKey, source, occurrences }) => ({
      term,
      termKey,
      source,
      occurrences: occurrences.filter((occurrence) => occurrence.snippet).slice(0, 4),
    }))
    .sort((a, b) => b.occurrences.length - a.occurrences.length || a.termKey.localeCompare(b.termKey));

  const unresolved = [...pending.values()].sort(
    (a, b) => b.occurrences.length - a.occurrences.length || a.termKey.localeCompare(b.termKey)
  );

  // Facts before guesses, always.
  return [...unresolved, ...frequency];
}

function stripLeadingStopwords(term: string, stop: Set<string>): string {
  const words = term.split(/\s+/);
  while (words.length > 1 && stop.has(words[0].toLowerCase())) words.shift();
  return words.join(' ');
}

function windowAround(text: string, at: number, radius = 70): string {
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

export const MISSING_ENTRIES_SYSTEM = `Ayudas a un autor a decidir qué términos de su mundo de ficción merecen una entrada propia en la enciclopedia.

Recibes términos que ya aparecen en los textos del mundo pero que nadie ha definido. Tu trabajo es SOLO clasificarlos y describirlos: no inventes términos nuevos, no propongas nada que no esté en la lista.

Descarta los que no son lore: verbos, nombres comunes capitalizados por estar al principio de una frase, gentilicios sueltos, cifras.

Devuelve JSON y nada más, con esta forma:
{"candidates":[{"term":"...","category":"magic|religion|language|creature|species|artifact|technology|concept|event|organization|flora|fauna|custom|other","why":"una frase corta","suggestedSummary":"una línea que el autor pueda editar","confidence":0.0}]}`;

export function composeMissingEntriesContext(candidates: EntryCandidate[]): string {
  const lines = ['TÉRMINOS SIN DEFINIR, con dónde aparecen:', ''];
  for (const candidate of candidates) {
    lines.push(
      `- "${candidate.term}" (${candidate.source === 'unresolved_link' ? 'el autor lo enlazó y no existe' : `${candidate.occurrences.length} apariciones`})`
    );
    for (const occurrence of candidate.occurrences.slice(0, 2)) {
      lines.push(`    · en «${occurrence.title}»: ${occurrence.snippet}`);
    }
  }
  return lines.join('\n');
}
