/**
 * The decisions a world has not taken yet.
 *
 * The section is deliberately the smallest of the five, and the reason is worth stating
 * once: a question about an invented world is not a to-do item, it is a WRITE THAT HAS NOT
 * HAPPENED. So an option is not a bullet — it is a pending write with a destination, and
 * the destination is INFERRED from where the question was captured. The moment the author
 * has to choose a target in a form with three widgets, the section becomes a task list and
 * a task list in a novel is abandoned in a fortnight.
 *
 * Two origins, and only two: what the author typed, and the holes they left in their own
 * prose (`???`, `TBD`, `XXX`, `[…]`). The other five the original design asked for belong
 * to other sections — red links and undeveloped entries to the Encyclopedia, arc gaps to
 * Arcos, contradictions to Continuidad, undated scenes to Escenas — and each of them
 * arrives here through a button on ITS owner, never through a second derivation over the
 * same facts. A second list of the same problems is a dismissal that stays alive somewhere
 * else.
 *
 * Pure. The part that must be right is `planApply`/`canUndo`: this is the only place in the
 * whole "Analizar" group that writes into another section's sheet, and an undo that
 * silently overwrites a paragraph the author wrote afterwards is worse than no undo at all.
 */

import type {
  WorldApplyMode,
  WorldQuestion,
  WorldQuestionFeedItem,
  WorldQuestionOrigin,
  WorldQuestionStatus,
  WorldQuestionUrgency,
} from './types';
import { proseSegments } from './worldEncyclopedia';

// ── Vocabulary ───────────────────────────────────────────────────────────────

export const WORLD_QUESTION_STATUSES: WorldQuestionStatus[] = ['open', 'answered', 'parked'];

export const WORLD_QUESTION_STATUS_LABEL: Record<WorldQuestionStatus, string> = {
  open: 'Sin decidir',
  answered: 'Ya decidido',
  parked: 'Aparcada',
};

export const WORLD_QUESTION_ORIGIN_LABEL: Record<WorldQuestionOrigin, string> = {
  author: 'La preguntaste tú',
  placeholder: 'Un hueco en tu prosa',
};

/**
 * What answering will DO. Named before it happens, on the button itself, because a button
 * that edits a paragraph of somebody's novel has to say so first.
 *
 * `none` is a first-class answer and not a fallback: plenty of decisions are taken and
 * simply remembered, and forcing every one of them to land somewhere would fill the world
 * with articles nobody asked for.
 */
export const WORLD_APPLY_MODE_LABEL: Record<WorldApplyMode, string> = {
  none: 'Solo recordarlo',
  fill_field: 'Escribirlo en la ficha',
  create_article: 'Crear un artículo',
};

export const WORLD_QUESTION_URGENCY_LABEL: Record<WorldQuestionUrgency, string> = {
  blocking: 'No puedo seguir sin esto',
  soon: 'Sale pronto en el relato',
  later: 'Puede esperar',
};

// ── Identity ─────────────────────────────────────────────────────────────────

const ORIGIN_PREFIX: Record<WorldQuestionOrigin, string> = { author: 'au', placeholder: 'ph' };

/**
 * The stable name of a DERIVED question, e.g. `ph:character:prs_7:backstory`.
 *
 * Derived from the content and never from a uuid, because this key is what makes parking
 * one stick: the scan runs again on every open, and a question that came back with a new
 * identity would arrive un-parked every time. It is one key per (entry, field) rather than
 * per occurrence — three `???` in the same backstory are one decision, not three.
 */
export function questionOriginKey(origin: WorldQuestionOrigin, ...parts: string[]): string {
  return [ORIGIN_PREFIX[origin], ...parts].join(':');
}

// ── The holes in the author's own prose ──────────────────────────────────────

/**
 * What counts as a hole. Four marks, all of them things writers already type.
 *
 * `XXX` is also the Roman numeral for thirty, so «el siglo XXX» is a false positive this
 * cannot tell apart from a marker — and that is fine: parking it stores one row and it
 * never comes back. Guessing from the surrounding words would be a rule nobody could
 * predict, which is the worse failure for a check that runs on every open.
 */
export const WORLD_PLACEHOLDER_TOKENS = ['???', 'TBD', 'XXX', '[…]'];

const PLACEHOLDER_RE = /\?{3,}|\bTBD\b|\bXXX\b|\[(?:…|\.\.\.)\]/gi;

export interface WorldTextRef {
  kind: string;
  id: string;
  title: string;
  field: string;
  text: string;
}

export interface PlaceholderHit {
  originKey: string;
  anchor: { kind: string; id: string; title: string };
  field: string;
  /** The mark as typed, so the sheet can say which hole it is talking about. */
  token: string;
  /** The line it sits in, VERBATIM. Never a paraphrase: the author has to recognise their
   *  own sentence to know which decision this is. */
  evidence: string;
  occurrences: number;
}

export function findPlaceholders(texts: WorldTextRef[]): PlaceholderHit[] {
  const hits = new Map<string, PlaceholderHit>();

  for (const ref of texts) {
    for (const segment of proseSegments(ref.text ?? '')) {
      for (const line of segment.split('\n')) {
        PLACEHOLDER_RE.lastIndex = 0;
        const match = PLACEHOLDER_RE.exec(line);
        if (!match) continue;
        const count = line.match(PLACEHOLDER_RE)?.length ?? 1;
        const originKey = questionOriginKey('placeholder', ref.kind, ref.id, ref.field);
        const existing = hits.get(originKey);
        if (existing) {
          existing.occurrences += count;
          continue;
        }
        hits.set(originKey, {
          originKey,
          anchor: { kind: ref.kind, id: ref.id, title: ref.title },
          field: ref.field,
          token: match[0],
          evidence: line.trim(),
          occurrences: count,
        });
      }
    }
  }

  return [...hits.values()];
}

// ── The feed ─────────────────────────────────────────────────────────────────

/** A scene and what it leans on, as `kind:id` keys — its cast, its place and whatever its
 *  text links to. Built once by the repo for every scene, so the pure half never queries. */
export interface FeedScene {
  sceneId: string;
  title: string;
  narrativeOrder: number;
  written: boolean;
  leansOn: string[];
}

export interface QuestionFeedContext {
  /** How many bodies mention each anchor, keyed by `kind:id`. The leverage line. */
  leverage?: Map<string, number>;
  scenes?: FeedScene[];
  /** Answered and parked rows too — the «decisiones tomadas» reading of the same feed. */
  includeSettled?: boolean;
}

/**
 * The next scene the author cannot write without this decision.
 *
 * Read in NARRATIVE order and restricted to what is not written yet, which is the whole
 * point: a decision that only affects chapters already drafted is a revision, and a
 * revision is not what this screen is for. A scene that leans on nothing in particular
 * never blocks anything, so a question with no anchor has no limit scene either.
 */
export function nextBlockedScene(
  anchor: { kind: string; id: string } | null,
  scenes: FeedScene[]
): { sceneId: string; title: string; narrativeOrder: number } | null {
  if (!anchor) return null;
  const key = `${anchor.kind}:${anchor.id}`;
  const blocked = [...scenes]
    .filter((scene) => !scene.written && scene.leansOn.includes(key))
    .sort((a, b) => a.narrativeOrder - b.narrativeOrder)[0];
  return blocked
    ? { sceneId: blocked.sceneId, title: blocked.title, narrativeOrder: blocked.narrativeOrder }
    : null;
}

/**
 * Three levels, and no invented weight.
 *
 * The switch the author flipped wins over everything the app computed — «no puedo seguir
 * sin esto» is knowledge the vault does not have. Below it, the only honest signal is
 * whether an unwritten scene is waiting on it.
 */
export function questionUrgency(item: {
  blocking: boolean;
  blockedScene: { narrativeOrder: number } | null;
}): WorldQuestionUrgency {
  if (item.blocking) return 'blocking';
  return item.blockedScene ? 'soon' : 'later';
}

/**
 * The stored rows plus the holes that are not stored yet, as one list.
 *
 * A derived hit whose `origin_key` already has a row DISAPPEARS behind that row: the row is
 * the author's — they may have parked it, answered it or rewritten its wording — and the
 * scan must never overrule it. Stored rows are kept even when their hole is gone, because
 * by then they carry options, an answer, or at the very least a decision to ignore it.
 */
export function mergeQuestionFeed(
  stored: WorldQuestion[],
  derived: PlaceholderHit[],
  context: QuestionFeedContext = {}
): WorldQuestionFeedItem[] {
  const scenes = context.scenes ?? [];
  const leverage = context.leverage ?? new Map<string, number>();
  const claimed = new Set(stored.map((question) => question.originKey).filter(Boolean) as string[]);
  const evidenceOf = new Map(derived.map((hit) => [hit.originKey, hit] as const));
  const items: WorldQuestionFeedItem[] = [];

  const build = (
    partial: Omit<WorldQuestionFeedItem, 'leverage' | 'blockedScene' | 'urgency'>
  ): WorldQuestionFeedItem => {
    const anchorKey = partial.anchor ? `${partial.anchor.kind}:${partial.anchor.id}` : null;
    const blockedScene = nextBlockedScene(partial.anchor, scenes);
    return {
      ...partial,
      leverage: anchorKey ? (leverage.get(anchorKey) ?? 0) : 0,
      blockedScene,
      urgency: questionUrgency({ blocking: partial.blocking, blockedScene }),
    };
  };

  for (const question of stored) {
    if (!context.includeSettled && question.status !== 'open') continue;
    const hit = question.originKey ? evidenceOf.get(question.originKey) : undefined;
    items.push(
      build({
        questionId: question.questionId,
        originKey: question.originKey,
        question: question.question,
        origin: question.origin,
        status: question.status,
        // A title is what proves the anchor is still there. The repo joins it live, and
        // a question whose character was deleted degrades to a question about the world
        // rather than pointing at a sheet nobody can open — and, because `planApply`
        // needs an anchor, its pending write quietly becomes «solo recordarlo» instead
        // of writing into a row that no longer exists.
        anchor:
          question.anchorKind && question.anchorId && question.anchorTitle
            ? { kind: question.anchorKind, id: question.anchorId, title: question.anchorTitle }
            : null,
        anchorField: question.anchorField,
        blocking: question.blocking,
        // Re-read from today's prose. A hole that has since been filled leaves the row
        // without evidence rather than with a sentence that no longer exists anywhere.
        evidence: hit?.evidence ?? null,
        options: question.options,
        chosenOptionId: question.chosenOptionId,
        updatedAt: question.updatedAt,
      })
    );
  }

  for (const hit of derived) {
    if (claimed.has(hit.originKey)) continue;
    items.push(
      build({
        questionId: null,
        originKey: hit.originKey,
        // The hole cannot phrase its own question, so the sentence it sits in IS the
        // question. Inventing one («¿Qué va aquí?») would read the same on all of them.
        question: hit.evidence,
        origin: 'placeholder',
        status: 'open',
        anchor: hit.anchor,
        anchorField: hit.field,
        blocking: false,
        evidence: hit.evidence,
        options: [],
        chosenOptionId: null,
        updatedAt: null,
      })
    );
  }

  return items;
}

const URGENCY_ORDER: Record<WorldQuestionUrgency, number> = { blocking: 0, soon: 1, later: 2 };

/**
 * Order for reading top to bottom.
 *
 * Urgency, then how soon the blocked scene arrives, then how much of the world hangs off
 * the anchor. Every tier is something the author can predict from what is on screen — a
 * ranking they cannot reproduce makes them read the whole list every time, which is the
 * same as having no ranking.
 */
export function rankQuestionFeed(items: WorldQuestionFeedItem[]): WorldQuestionFeedItem[] {
  return [...items].sort(
    (a, b) =>
      URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
      (a.blockedScene?.narrativeOrder ?? Number.MAX_SAFE_INTEGER) -
        (b.blockedScene?.narrativeOrder ?? Number.MAX_SAFE_INTEGER) ||
      b.leverage - a.leverage ||
      a.question.localeCompare(b.question)
  );
}

// ── The pending write ────────────────────────────────────────────────────────

export interface QuestionFieldWrite {
  field: string;
  nextText: string;
  /** What the field said BEFORE, whole. This is the undo. */
  replacedText: string;
}

export interface QuestionArticleWrite {
  create: 'article';
  title: string;
  summary: string;
}

export type QuestionWrite = QuestionFieldWrite | QuestionArticleWrite;

/**
 * What the destination is, given where the question was captured. Inferred, never asked.
 *
 *  - captured in a field of a sheet  → that field
 *  - about the world at large        → a new article, since there is no sheet to hold it
 *  - about an entity but no field    → nothing; the decision is simply remembered
 */
export function inferApplyMode(anchor: { kind: string } | null, anchorField: string | null): WorldApplyMode {
  if (anchor && anchorField) return 'fill_field';
  return anchor ? 'none' : 'create_article';
}

/** An article title out of a question: «¿La magia deja marca?» → «La magia deja marca». */
export function questionTitle(question: string): string {
  const clean = (question ?? '').trim().replace(/^[¿?¡!\s]+/, '').replace(/[¿?¡!\s]+$/, '');
  return clean.length > 120 ? `${clean.slice(0, 117).trimEnd()}…` : clean;
}

/**
 * The write an option would perform, worked out before anything is written.
 *
 * Returned rather than executed so the button can NAME it («Se escribirá en Kaelen →
 * Trasfondo») and so the same arithmetic is unit-tested without a database. When the field
 * still holds the hole, the option REPLACES it; otherwise it is appended as its own
 * paragraph. Overwriting a field that says something else would lose prose, and this is the
 * only code in the group allowed near somebody's manuscript.
 */
export function planApply(
  question: { question: string; anchor: { kind: string; id: string; title: string } | null; anchorField: string | null },
  option: { text: string; implications?: string | null; applyMode: WorldApplyMode },
  currentText: string | null
): QuestionWrite | null {
  const text = (option.text ?? '').trim();
  if (!text) return null;

  if (option.applyMode === 'create_article') {
    const title = questionTitle(question.question);
    if (!title) return null;
    return {
      create: 'article',
      title,
      summary: option.implications ? `${text}\n\n${option.implications.trim()}` : text,
    };
  }

  if (option.applyMode !== 'fill_field') return null;
  if (!question.anchor || !question.anchorField) return null;

  const current = currentText ?? '';
  PLACEHOLDER_RE.lastIndex = 0;
  const hole = PLACEHOLDER_RE.exec(current);
  const nextText = hole
    ? `${current.slice(0, hole.index)}${text}${current.slice(hole.index + hole[0].length)}`
    : current.trim()
      ? `${current.trimEnd()}\n\n${text}`
      : text;

  if (nextText === current) return null;
  return { field: question.anchorField, nextText, replacedText: current };
}

/**
 * Whether undoing is still safe.
 *
 * Only if the field STILL CONTAINS what was written into it. The author may have rewritten
 * the paragraph, translated it, folded it into a longer sentence — and restoring the old
 * text then would destroy work that was done after the answer, which is exactly the harm
 * an undo button exists to prevent. When this is false the option stays answered and the
 * button disappears; nothing is offered that cannot be honoured.
 */
export function canUndo(
  option: { text: string; appliedAt: string | null; replacedText: string | null },
  currentText: string | null
): boolean {
  if (!option.appliedAt || option.replacedText === null) return false;
  const text = (option.text ?? '').trim();
  return Boolean(text) && (currentText ?? '').includes(text);
}
