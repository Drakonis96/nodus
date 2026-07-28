/**
 * The manuscript: counting it, and reading its spine.
 *
 * The section's thesis in one line — **the manuscript is not a new document, it is the
 * column the scene was missing** — means there is very little pure logic here, and that is
 * the point. The order is already `narrative_order`, the dates are already the day chain,
 * what a scene must do is already its beats. What is left is arithmetic: how many words
 * there are, where the chapters start, and how much was written today.
 *
 * Pure, so the two things that would silently lie — a word count and a day's progress — are
 * checked without a database.
 */

import { makeFinding } from './worldFindings';
import type { WorldFinding, WorldSceneStatus } from './types';

// ── Counting words ───────────────────────────────────────────────────────────

// Fenced blocks first, so a stray backtick inside one cannot open an inline span.
const CODE_RE = /(```[\s\S]*?```|`[^`\n]*`)/g;
const LINK_RE = /\[([^\]\n]*)\]\([^)\n]*\)/g;
const IMAGE_RE = /!\[([^\]\n]*)\]\([^)\n]*\)/g;

/**
 * How many words a piece of prose has.
 *
 * NOT `split(' ').length`, and the reason is specific to this vault: the stored text
 * carries RESOLVED links, so a scene that mentions three characters ends up with three
 * `nodus://world/character/prs_7` URLs in it. Counting those inflates every scene, every
 * chapter and the target the author set — the one number in the section nobody would ever
 * think to verify. The label survives the strip, because the reader does read it.
 *
 * A "word" is a run with at least one letter or digit, so an em dash between clauses and a
 * line of asterisks marking a scene break count for nothing.
 */
export function countWords(markdown: string | null | undefined): number {
  const prose = (markdown ?? '')
    .split(CODE_RE)
    .filter((_, index) => index % 2 === 0)
    .join(' ')
    // An image's alt text is not prose the reader reads as words.
    .replace(IMAGE_RE, ' ')
    .replace(LINK_RE, '$1')
    // Markdown marks that sit against a word: headings, emphasis, quotes, list bullets.
    .replace(/[#>*_~]/g, ' ');
  let words = 0;
  for (const token of prose.split(/\s+/)) {
    if (/[\p{L}\p{N}]/u.test(token)) words += 1;
  }
  return words;
}

// ── The spine ────────────────────────────────────────────────────────────────

export interface SpineScene {
  sceneId: string;
  title: string;
  narrativeOrder: number;
  status: WorldSceneStatus;
  wordCount: number;
  /** Present when this scene OPENS a chapter — which is the only way a chapter exists. */
  chapter: { title: string | null; epigraph: string | null } | null;
  /** Present when this scene opens a BOOK. Same idea, one level up. */
  book: { title: string | null; subtitle: string | null; targetWords: number | null } | null;
}

export interface SpineChapter {
  /** The scene that opens it, or null for the run of scenes before the first break. */
  startSceneId: string | null;
  title: string | null;
  epigraph: string | null;
  scenes: SpineScene[];
  wordCount: number;
}

/**
 * The manuscript as chapters, walking the scenes in narrative order.
 *
 * A chapter STARTS at a scene and runs until the next one that starts another. There is no
 * chapter order because there is no chapter row: reordering a chapter is reordering its
 * scenes, and that keeps `narrative_order` the single ordering axis of the whole vault —
 * the one the day chain and the arc lanes already depend on.
 *
 * Scenes before the first break are not an error and are not hidden: they come back in a
 * leading chapter with no title, because a manuscript that has not been divided yet is the
 * normal state of a first draft.
 */
export function groupIntoChapters(scenes: SpineScene[]): SpineChapter[] {
  const ordered = [...scenes].sort((a, b) => a.narrativeOrder - b.narrativeOrder);
  const chapters: SpineChapter[] = [];
  for (const scene of ordered) {
    // `Boolean`, no `!== null`: un llamante que omita el campo pasaría `undefined` y cada
    // escena abriría capítulo. La marca es lo que existe o no, no lo que es exactamente null.
    const opens = Boolean(scene.chapter);
    if (opens || chapters.length === 0) {
      chapters.push({
        startSceneId: opens ? scene.sceneId : null,
        title: scene.chapter?.title ?? null,
        epigraph: scene.chapter?.epigraph ?? null,
        scenes: [],
        wordCount: 0,
      });
    }
    const current = chapters[chapters.length - 1];
    current.scenes.push(scene);
    current.wordCount += scene.wordCount;
  }
  return chapters;
}

export interface SpineBook {
  /** The scene that opens it, or null for the run before the first book mark. */
  startSceneId: string | null;
  title: string | null;
  subtitle: string | null;
  targetWords: number | null;
  chapters: SpineChapter[];
  wordCount: number;
  scenes: number;
}

/**
 * The shelf: several books in one world.
 *
 * Built the same way chapters are, out of the same walk, because a book is the same idea
 * one level up — **a book is where a book starts**. A table of manuscripts with its own
 * order plus a membership row per scene would be a second ordering axis beside
 * `narrative_order`, and the day chain, the arc lanes and the blocked-scene of an open
 * question all hang off that one. The price is that books are CONTIGUOUS runs of the
 * reading order, which is precisely what a shelf is.
 */
export function groupIntoBooks(scenes: SpineScene[]): SpineBook[] {
  const ordered = [...scenes].sort((a, b) => a.narrativeOrder - b.narrativeOrder);
  const runs: { start: SpineScene | null; scenes: SpineScene[] }[] = [];
  for (const scene of ordered) {
    const opens = Boolean(scene.book);
    if (opens || runs.length === 0) runs.push({ start: opens ? scene : null, scenes: [] });
    runs[runs.length - 1].scenes.push(scene);
  }
  return runs.map((run) => ({
    startSceneId: run.start?.sceneId ?? null,
    title: run.start?.book?.title ?? null,
    subtitle: run.start?.book?.subtitle ?? null,
    targetWords: run.start?.book?.targetWords ?? null,
    chapters: groupIntoChapters(run.scenes),
    wordCount: run.scenes.reduce((total, scene) => total + scene.wordCount, 0),
    scenes: run.scenes.length,
  }));
}

export interface ManuscriptTotals {
  words: number;
  scenes: number;
  chapters: number;
  byStatus: Record<WorldSceneStatus, number>;
  /** Scenes with a status of `written` that carry no text at all. */
  writtenButEmpty: number;
}

/**
 * The counts under the progress strip.
 *
 * `byStatus` is what the AUTHOR declared, never derived from the word count: nothing in this
 * vault recalculates behind them, and "you said this was written" is a statement, not a
 * measurement. `writtenButEmpty` is the one place the two are compared, and it is shown as
 * a fact rather than corrected.
 */
export function manuscriptTotals(chapters: SpineChapter[]): ManuscriptTotals {
  const totals: ManuscriptTotals = {
    words: 0,
    scenes: 0,
    chapters: chapters.filter((chapter) => chapter.startSceneId !== null).length,
    byStatus: { outline: 0, draft: 0, written: 0 },
    writtenButEmpty: 0,
  };
  for (const chapter of chapters) {
    for (const scene of chapter.scenes) {
      totals.words += scene.wordCount;
      totals.scenes += 1;
      totals.byStatus[scene.status] += 1;
      if (scene.status === 'written' && scene.wordCount === 0) totals.writtenButEmpty += 1;
    }
  }
  return totals;
}

// ── The day ──────────────────────────────────────────────────────────────────

export interface WordDay {
  day: string;
  totalWords: number;
}

/**
 * How much was written today, against the last day that was recorded.
 *
 * IT CAN BE NEGATIVE, and that is the design: a day spent cutting four hundred words out of
 * a chapter is a day of work, and a counter that only knows how to add turns pruning into a
 * punishment. With no previous day at all the delta is the whole total — the first day is
 * the day everything was written.
 */
export function todayDelta(history: WordDay[], today: string, totalNow: number): number {
  const previous = history
    .filter((entry) => entry.day < today)
    .sort((a, b) => a.day.localeCompare(b.day))
    .pop();
  return totalNow - (previous?.totalWords ?? 0);
}

/** `YYYY-MM-DD` in the author's own timezone: a writing day ends when they go to bed. */
export function localDay(at: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

// ── Lo que el texto dice y la ficha no ──────────────────────────────────────

export interface CastCheckScene {
  sceneId: string;
  sceneTitle: string;
  /** Characters the MANUSCRIPT links to, from the link graph. */
  mentioned: { id: string; title: string }[];
  /** Person ids declared in the scene's cast. */
  cast: string[];
}

/**
 * Alguien que sale en el texto y no está en el reparto.
 *
 * La comprobación que sólo es posible cuando el manuscrito existe, y es aritmética pura: el
 * grafo de enlaces dice a quién nombra la prosa, `scene_characters` dice a quién declaró el
 * autor. No es un error de estilo ni una sospecha — mientras no esté en el reparto, esa
 * persona no cuenta para la cronología, ni para los viajes imposibles, ni para «dónde estaba
 * el día 412». El aviso es que **media bóveda no la está viendo ahí**.
 *
 * Un aviso, nunca una corrección automática: una mención de pasada («los Cuervos hablaban de
 * Kaelen») no pone a nadie en la habitación, y sólo el autor sabe cuál de los dos casos es.
 */
export function checkCast(scenes: CastCheckScene[]): WorldFinding[] {
  const findings: WorldFinding[] = [];
  for (const scene of scenes) {
    const declared = new Set(scene.cast);
    for (const person of scene.mentioned) {
      if (declared.has(person.id)) continue;
      findings.push(
        makeFinding(
          'manuscript.uncastMention',
          'manuscript',
          'gap',
          { key: '{person} sale en el texto de «{scene}» y no en su reparto', vars: { person: person.title, scene: scene.sceneTitle } },
          [
            { kind: 'scene', id: scene.sceneId, title: scene.sceneTitle, field: 'text' },
            { kind: 'character', id: person.id, title: person.title },
          ],
          { key: 'Mientras no esté en el reparto, ni la cronología ni los viajes cuentan con que estuvo ahí.' }
        )
      );
    }
  }
  return findings;
}

// ── Compilar ─────────────────────────────────────────────────────────────────

export interface ManuscriptCompileOptions {
  title: string;
  /** Only what the author marked as written. A partial draft is a real thing to send. */
  onlyWritten?: boolean;
  /** Put the summary of an unwritten scene in its place, marked as such. */
  includeOutlines?: boolean;
  /** The line between scenes inside a chapter. */
  separator?: string;
}

export interface CompileScene {
  title: string;
  status: WorldSceneStatus;
  text: string | null;
  summary: string | null;
}

export interface CompileChapter {
  title: string | null;
  epigraph: string | null;
  scenes: CompileScene[];
}

const RESOLVED_LINK_RE = /\[([^\]\n]*)\]\(nodus:\/\/world\/[a-z]+\/[^)\s]+\)/g;
const PENDING_LINK_RE = /\[\[([^\][\n]+)\]\]/g;

/**
 * Quitar los enlaces del mundo, dejando lo que se lee.
 *
 * La operación inversa de `toRenderableBody`, y la que decide si el manuscrito se puede
 * mandar: el texto guardado lleva `[Kaelen](nodus://world/character/prs_7)` porque eso es lo
 * que hace que un cambio de nombre no rompa nada, pero un archivo que va a una editorial, a
 * un lector cero o a un correo NO PUEDE llevar una URL interna en mitad de una frase. Los
 * `[[…]]` sin resolver se degradan igual: son una nota del autor, no una llamada al lector.
 */
export function stripWorldLinks(markdown: string | null | undefined): string {
  return (markdown ?? '').replace(RESOLVED_LINK_RE, '$1').replace(PENDING_LINK_RE, '$1');
}

/**
 * El manuscrito como un solo documento.
 *
 * Puro: qué entra, en qué orden y con qué separadores es una decisión de composición, y
 * mantenerla aquí es lo que permite probar el degradado de enlaces —la parte que estropea
 * un envío real— sin abrir un diálogo de guardado.
 */
export function compileManuscript(chapters: CompileChapter[], options: ManuscriptCompileOptions): string {
  const separator = options.separator ?? '* * *';
  const parts: string[] = [`# ${options.title.trim() || 'Manuscrito'}`];

  for (const chapter of chapters) {
    const scenes = chapter.scenes.filter((scene) => {
      if (scene.status === 'written' || !options.onlyWritten) {
        return Boolean(stripWorldLinks(scene.text).trim()) || Boolean(options.includeOutlines);
      }
      return false;
    });
    if (scenes.length === 0) continue;

    if (chapter.title) parts.push(`## ${chapter.title}`);
    if (chapter.epigraph) parts.push(`> ${chapter.epigraph.trim().replace(/\n/g, '\n> ')}`);

    scenes.forEach((scene, index) => {
      if (index > 0) parts.push(separator);
      const text = stripWorldLinks(scene.text).trim();
      if (text) {
        parts.push(text);
        return;
      }
      // A scene with no prose is a hole in the middle of the document, and a hole that
      // does not say it is one reads as the end of a chapter.
      const summary = stripWorldLinks(scene.summary).trim();
      parts.push(summary ? `[por escribir — ${scene.title}: ${summary}]` : `[por escribir — ${scene.title}]`);
    });
  }
  return `${parts.join('\n\n')}\n`;
}
