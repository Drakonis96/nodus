/**
 * Threads and beats: the one statement the vault could not hold.
 *
 * "In this scene, this moves like so." That single sentence is, at the same time, a rule
 * being put to the test, a conflict advancing and an arc turning — which is why they share
 * a table and, more importantly, why they share ONE strip on the scene sheet instead of
 * three panels nobody fills in.
 *
 * Everything here is pure: the vocabularies, and the diagnostics. What is NOT derived, and
 * never will be, is the judgement itself. `world_links` already knows which scenes mention
 * the Blood Mark and `scene_characters` already knows who was in the room; that the law
 * breaks HERE, and that the price is not on the page, only the writer can say.
 */

import { fingerprintOf, type FindingSubject } from './worldFindings';
import type {
  ArcMark,
  BeatMark,
  BeatThreadKind,
  ConflictMark,
  RuleMark,
  ThreadPartySide,
  WorldBeat,
  WorldThread,
  WorldThreadKind,
  WorldThreadScope,
  WorldThreadStatus,
  WorldFinding,
  WorldFindingText,
} from './types';

// ── Vocabulary ───────────────────────────────────────────────────────────────

export const RULE_MARKS: RuleMark[] = ['obeys', 'bends', 'breaks', 'establishes'];
export const CONFLICT_MARKS: ConflictMark[] = ['raise', 'turn', 'ease', 'resolve'];
export const ARC_MARKS: ArcMark[] = ['step', 'turn'];

export function marksFor(kind: BeatThreadKind): BeatMark[] {
  if (kind === 'rule') return [...RULE_MARKS];
  if (kind === 'conflict') return [...CONFLICT_MARKS];
  return [...ARC_MARKS];
}

export const BEAT_MARK_LABEL: Record<BeatMark, string> = {
  obeys: 'Se cumple',
  bends: 'Se dobla',
  breaks: 'Se rompe',
  establishes: 'Se establece',
  raise: 'Sube',
  turn: 'Gira',
  ease: 'Baja',
  resolve: 'Se cierra',
  step: 'Avanza',
};

export const THREAD_KIND_LABEL: Record<WorldThreadKind, string> = {
  conflict: 'Conflicto',
  arc: 'Arco',
};

export const THREAD_STATUS_LABEL: Record<WorldThreadStatus, string> = {
  open: 'En marcha',
  resolved: 'Resuelto',
  archived: 'Archivado',
};

export const THREAD_SCOPE_LABEL: Record<WorldThreadScope, string> = {
  external: 'Entre partes',
  background: 'De fondo',
};

export const PARTY_SIDE_LABEL: Record<ThreadPartySide, string> = {
  subject: 'Protagoniza',
  wants: 'Quiere',
  opposes: 'Se opone',
  caught: 'Lo sufre',
};

/** Only a turn needs explaining; "sube" explains itself. */
export function markNeedsText(mark: BeatMark): boolean {
  return mark === 'turn';
}

/** Marks that move a conflict towards someone. Used to tell rising from stalled. */
export function markDirection(mark: BeatMark): 1 | 0 | -1 {
  if (mark === 'raise' || mark === 'breaks') return 1;
  if (mark === 'ease' || mark === 'obeys') return -1;
  return 0;
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

export interface ThreadDiagnosticInput {
  threads: WorldThread[];
  beats: WorldBeat[];
  /** Every scene in narrative order, so "moves nothing" can name them. */
  scenes: { sceneId: string; title: string; narrativeOrder: number }[];
  /** Everyone who could have something at stake. */
  characters: { id: string; name: string; narrativeRole: string | null; sceneCount: number }[];
}

/**
 * The diagnosis a writer cannot make from memory: who is on stage and wants nothing.
 *
 * Sorted by how much page time they already have, because a walk-on with no stake is fine
 * and a character in twenty-one scenes with no stake is the note that rewrites a draft.
 */
export function charactersWithoutStake(
  input: ThreadDiagnosticInput
): { id: string; name: string; sceneCount: number }[] {
  const engaged = new Set<string>();
  for (const thread of input.threads) {
    if (thread.status === 'archived') continue;
    for (const party of thread.parties) {
      if (party.partyKind === 'character') engaged.add(party.partyId);
    }
  }
  return input.characters
    .filter((character) => !engaged.has(character.id) && character.sceneCount > 0)
    .sort((a, b) => b.sceneCount - a.sceneCount || a.name.localeCompare(b.name))
    .map(({ id, name, sceneCount }) => ({ id, name, sceneCount }));
}

/** Scenes that no thread moves. The cut list — and the best single question a structural
 *  tool can ask: what is this scene for? */
export function scenesThatMoveNothing(
  input: ThreadDiagnosticInput
): { sceneId: string; title: string; narrativeOrder: number }[] {
  const moved = new Set(input.beats.map((beat) => beat.sceneId));
  return input.scenes
    .filter((scene) => !moved.has(scene.sceneId))
    .sort((a, b) => a.narrativeOrder - b.narrativeOrder);
}

/** An open thread nobody has moved in any scene: declared, then forgotten. */
export function threadsWithoutBeats(input: ThreadDiagnosticInput): WorldThread[] {
  const moved = new Set(input.beats.map((beat) => `${beat.threadKind}:${beat.threadId}`));
  return input.threads.filter(
    (thread) => thread.status === 'open' && !moved.has(`${thread.kind}:${thread.threadId}`)
  );
}

/**
 * A conflict marked resolved that never rose. Either the resolution is unearned, or the
 * beats were never recorded — and both are worth a sentence to the author.
 */
export function threadsResolvedWithoutRising(input: ThreadDiagnosticInput): WorldThread[] {
  const byThread = new Map<string, WorldBeat[]>();
  for (const beat of input.beats) {
    const key = `${beat.threadKind}:${beat.threadId}`;
    byThread.set(key, [...(byThread.get(key) ?? []), beat]);
  }
  return input.threads.filter((thread) => {
    if (thread.kind !== 'conflict' || thread.status !== 'resolved') return false;
    const beats = byThread.get(`conflict:${thread.threadId}`) ?? [];
    return !beats.some((beat) => markDirection(beat.mark) > 0);
  });
}

/**
 * Where a thread's beats fall across the manuscript, as scene positions.
 *
 * Positions, not percentages: "the last beat is in scene 12 of 48" is a fact a writer can
 * act on; "25 %" is a grade. Used by the arc lanes and by "closes too early".
 */
export function threadSpan(
  thread: WorldThread,
  beats: WorldBeat[],
  totalScenes: number
): { first: number | null; last: number | null; count: number; total: number } {
  const mine = beats
    .filter((beat) => beat.threadId === thread.threadId)
    .map((beat) => beat.narrativeOrder)
    .sort((a, b) => a - b);
  return {
    first: mine.length ? mine[0] : null,
    last: mine.length ? mine[mine.length - 1] : null,
    count: mine.length,
    total: totalScenes,
  };
}

/**
 * Beats grouped by scene, in narrative order — what the scene sheet renders.
 *
 * Keyed by scene so opening a scene answers "what has to move here" in one lookup instead
 * of a scan per thread.
 */
export function beatsByScene(beats: WorldBeat[]): Map<string, WorldBeat[]> {
  const map = new Map<string, WorldBeat[]>();
  for (const beat of beats) {
    map.set(beat.sceneId, [...(map.get(beat.sceneId) ?? []), beat]);
  }
  for (const [, list] of map) {
    list.sort((a, b) => a.threadKind.localeCompare(b.threadKind) || a.threadTitle.localeCompare(b.threadTitle));
  }
  return map;
}

// ── The board ────────────────────────────────────────────────────────────────

export interface BoardCastMember {
  personId: string;
  displayName: string;
  narrativeRole: string | null;
  /** Read from `character_profiles`, never copied: the arc fields belong to Personajes. */
  arcWant: string | null;
  arcNeed: string | null;
  /** The accent TOKEN from `character_profiles`, not a colour and not an id — it is what
   *  `characterAccentHex()` resolves. Passing an id there silently yields the default. */
  accent: string | null;
  sceneCount: number;
}

export interface ThreadBoardRow {
  person: BoardCastMember;
  /** One entry per column, in the same order. `null` means "not in this conflict". */
  cells: (ThreadPartySide | null)[];
  /** How many open threads they are in at all — the number the sort is really about. */
  stakes: number;
}

export interface ThreadBoard {
  columns: WorldThread[];
  rows: ThreadBoardRow[];
}

/**
 * Cast × conflicts.
 *
 * The one thing a writer cannot do in their head past fifteen characters, and the reason
 * this section opens on a board rather than a list: a CRUD screen for conflicts is
 * infrastructure, and the grid is the product.
 *
 * Rows are ordered by the diagnosis, not alphabetically — whoever has the most page time
 * and the least at stake comes first, because that is the note that rewrites a draft.
 */
export function threadBoard(input: {
  cast: BoardCastMember[];
  threads: WorldThread[];
}): ThreadBoard {
  const columns = input.threads
    .filter((thread) => thread.kind === 'conflict' && thread.status !== 'archived')
    .sort((a, b) => a.status.localeCompare(b.status) || a.title.localeCompare(b.title));

  const rows = input.cast
    .map((person): ThreadBoardRow => {
      const cells = columns.map((thread) => {
        const party = thread.parties.find(
          (entry) => entry.partyKind === 'character' && entry.partyId === person.personId
        );
        return party?.side ?? null;
      });
      return { person, cells, stakes: cells.filter(Boolean).length };
    })
    .sort(
      (a, b) =>
        // Nothing at stake first, then by page time: a walk-on with no conflict is fine,
        // a character in twenty-one scenes with none is the finding.
        a.stakes - b.stakes ||
        b.person.sceneCount - a.person.sceneCount ||
        a.person.displayName.localeCompare(b.person.displayName)
    );

  return { columns, rows };
}

export type StakeGapKind = 'silent' | 'thin';

export interface StakeGap {
  personId: string;
  displayName: string;
  sceneCount: number;
  /** `silent` — no conflict AND no arc want. `thin` — one of the two, not both. */
  kind: StakeGapKind;
}

/**
 * Who is on stage wanting nothing.
 *
 * Two grades, because they are two different notes. `silent` is a character with no
 * conflict and no stated want — nothing drives them at all. `thin` has one of the two, and
 * is usually fine: a want with no opposition is a subplot waiting to start.
 */
export function findStakeGaps(input: { cast: BoardCastMember[]; threads: WorldThread[] }): StakeGap[] {
  const engaged = new Set<string>();
  for (const thread of input.threads) {
    if (thread.status === 'archived') continue;
    for (const party of thread.parties) {
      if (party.partyKind === 'character') engaged.add(party.partyId);
    }
  }

  return input.cast
    .filter((person) => person.sceneCount > 0)
    .map((person) => {
      const hasThread = engaged.has(person.personId);
      const hasWant = Boolean((person.arcWant ?? '').trim());
      if (hasThread && hasWant) return null;
      return {
        personId: person.personId,
        displayName: person.displayName,
        sceneCount: person.sceneCount,
        kind: (!hasThread && !hasWant ? 'silent' : 'thin') as StakeGapKind,
      };
    })
    .filter((gap): gap is StakeGap => gap !== null)
    .sort(
      (a, b) =>
        // Silent before thin, then by page time.
        (a.kind === b.kind ? 0 : a.kind === 'silent' ? -1 : 1) ||
        b.sceneCount - a.sceneCount ||
        a.displayName.localeCompare(b.displayName)
    );
}

export interface CrossedLoyalty {
  personId: string;
  personName: string;
  groupId: string;
  groupName: string;
  threadId: string;
  threadTitle: string;
  /** Which side the person is on, and which side their group is on. */
  personSide: ThreadPartySide;
  groupSide: ThreadPartySide;
}

/**
 * Members of a faction who are personally on the other side.
 *
 * A betrayal detector for free, out of two tables that already exist. It is a JOIN, not a
 * model — which is why it can be trusted: every row is something the author typed.
 */
export function findCrossedLoyalties(
  threads: WorldThread[],
  affiliations: { personId: string; personName: string; groupId: string; groupName: string }[]
): CrossedLoyalty[] {
  const crossed: CrossedLoyalty[] = [];
  for (const thread of threads) {
    if (thread.status === 'archived') continue;
    const groups = thread.parties.filter((party) => party.partyKind === 'group');
    if (groups.length === 0) continue;
    for (const party of thread.parties) {
      if (party.partyKind !== 'character') continue;
      for (const group of groups) {
        // Only opposing sides count. Two allies on the same side is loyalty, not a crossing.
        if (party.side === group.side || party.side === 'caught' || group.side === 'caught') continue;
        const member = affiliations.find(
          (entry) => entry.personId === party.partyId && entry.groupId === group.partyId
        );
        if (!member) continue;
        crossed.push({
          personId: party.partyId,
          personName: party.partyName,
          groupId: group.partyId,
          groupName: group.partyName,
          threadId: thread.threadId,
          threadTitle: thread.title,
          personSide: party.side,
          groupSide: group.side,
        });
      }
    }
  }
  return crossed;
}

export interface SceneSuggestion {
  sceneId: string;
  title: string;
  narrativeOrder: number;
  /** Who from this thread was in the room. */
  present: string[];
}

/**
 * Scenes where both sides were in the room and nobody said the conflict moved.
 *
 * Suggestions, never writes. The vault knows who was present; whether the conflict
 * actually advanced there is a judgement, and judgement is the author's whole job.
 */
export function suggestThreadScenes(input: {
  thread: WorldThread;
  beats: WorldBeat[];
  scenes: { sceneId: string; title: string; narrativeOrder: number }[];
  sceneCast: { sceneId: string; personId: string; personName: string }[];
  /** A group party resolves to its members, or a faction war would match no scene at all. */
  membership: { groupId: string; personId: string }[];
}): SceneSuggestion[] {
  const already = new Set(
    input.beats.filter((beat) => beat.threadId === input.thread.threadId).map((beat) => beat.sceneId)
  );

  const sideOf = new Map<string, ThreadPartySide>();
  for (const party of input.thread.parties) {
    if (party.partyKind === 'character') sideOf.set(party.partyId, party.side);
    else {
      for (const member of input.membership) {
        if (member.groupId === party.partyId && !sideOf.has(member.personId)) {
          sideOf.set(member.personId, party.side);
        }
      }
    }
  }
  if (sideOf.size === 0) return [];

  const castByScene = new Map<string, { personId: string; personName: string }[]>();
  for (const entry of input.sceneCast) {
    castByScene.set(entry.sceneId, [...(castByScene.get(entry.sceneId) ?? []), entry]);
  }

  return input.scenes
    .filter((scene) => !already.has(scene.sceneId))
    .map((scene) => {
      const present = (castByScene.get(scene.sceneId) ?? []).filter((person) => sideOf.has(person.personId));
      const sides = new Set(present.map((person) => sideOf.get(person.personId)));
      // BOTH sides, not merely somebody involved: a scene with two allies in it is not a
      // scene where the conflict could have moved.
      if (sides.size < 2) return null;
      return {
        sceneId: scene.sceneId,
        title: scene.title,
        narrativeOrder: scene.narrativeOrder,
        present: present.map((person) => person.personName),
      };
    })
    .filter((suggestion): suggestion is SceneSuggestion => suggestion !== null)
    .sort((a, b) => a.narrativeOrder - b.narrativeOrder);
}

// ── The findings Continuity shows ────────────────────────────────────────────

/**
 * Structural problems with the threads themselves.
 *
 * Produced HERE and merely displayed by Continuity, which does not reimplement a single
 * one of them: two implementations of "this conflict was declared and forgotten" would
 * word it two ways and disagree the first time somebody archived a thread.
 *
 * Nothing here fires without narrative order, and narrative order always exists
 * (`world_scenes.narrative_order` is NOT NULL), so these are safe from the empty-vault
 * problem that makes the presence family silent.
 */
export function checkThreads(input: ThreadDiagnosticInput): (WorldFinding & { family: 'thread' })[] {
  const findings: (WorldFinding & { family: 'thread' })[] = [];
  const add = (
    checkId: string,
    severity: WorldFinding['severity'],
    headline: WorldFindingText,
    subjects: FindingSubject[],
    detail?: WorldFindingText
  ) => {
    findings.push({
      checkId,
      family: 'thread',
      severity,
      headline,
      detail: detail ?? null,
      subjects,
      fingerprint: fingerprintOf(checkId, subjects),
    });
  };

  for (const thread of threadsWithoutBeats(input)) {
    add(
      'thread.noScenes',
      'warning',
      { key: '«{thread}» no se mueve en ninguna escena', vars: { thread: thread.title } },
      [{ kind: 'thread', id: thread.threadId, title: thread.title }],
      { key: 'Está declarado, pero ninguna escena lo hace avanzar.' }
    );
  }

  for (const thread of threadsResolvedWithoutRising(input)) {
    add(
      'thread.resolvedFlat',
      'warning',
      { key: '«{thread}» se cierra sin haber subido nunca', vars: { thread: thread.title } },
      [{ kind: 'thread', id: thread.threadId, title: thread.title }],
      { key: 'O la resolución no está ganada, o los latidos no se registraron.' }
    );
  }

  // An antagonist nobody opposes. The role is declared on the character sheet, so this is
  // a contradiction between two things the author wrote, not a guess about intent.
  const opposed = new Set<string>();
  for (const thread of input.threads) {
    if (thread.status === 'archived') continue;
    const sides = new Set(thread.parties.map((party) => party.side));
    if (!sides.has('opposes')) continue;
    for (const party of thread.parties) {
      if (party.partyKind === 'character') opposed.add(party.partyId);
    }
  }
  for (const character of input.characters) {
    if (character.narrativeRole !== 'antagonist' || character.sceneCount === 0) continue;
    if (opposed.has(character.id)) continue;
    add(
      'thread.antagonistUnopposed',
      'warning',
      { key: '{person} es antagonista y no se opone a nada', vars: { person: character.name } },
      [{ kind: 'character', id: character.id, title: character.name }],
      { key: 'Aparece en escenas, pero no es parte de ningún conflicto abierto.' }
    );
  }

  // A party whose entity was deleted: the thread still names somebody who is gone.
  for (const thread of input.threads) {
    for (const party of thread.parties) {
      if (party.partyName !== '—') continue;
      add(
        'thread.orphanParty',
        'warning',
        { key: '«{thread}» tiene una parte que ya no existe', vars: { thread: thread.title } },
        [{ kind: 'thread', id: thread.threadId, title: thread.title }]
      );
    }
  }

  return findings;
}

// ── Arcs: the lanes ──────────────────────────────────────────────────────────

export interface PlottedBeat {
  sceneId: string;
  sceneTitle: string;
  /** Dense position on the story axis, 0-based. */
  position: number;
  mark: BeatMark;
  text: string | null;
  status: string;
}

export interface PlottedThread {
  thread: WorldThread;
  beats: PlottedBeat[];
  first: number | null;
  last: number | null;
}

export interface SceneRank {
  sceneId: string;
  title: string;
  narrativeOrder: number;
  status: string;
}

/**
 * Rank the scenes densely, 0..n-1, in story order.
 *
 * The RANK, not the raw `narrative_order` integer. Reordering leaves gaps and duplicates
 * in that column all the time, and a lane drawn against the raw value would put two scenes
 * on top of each other and leave a hole where a scene was cut. The reader's position in
 * the manuscript is an ordinal, so that is what the axis is.
 */
export function rankScenes(scenes: SceneRank[]): Map<string, number> {
  return new Map(
    [...scenes]
      .sort((a, b) => a.narrativeOrder - b.narrativeOrder || a.sceneId.localeCompare(b.sceneId))
      .map((scene, index) => [scene.sceneId, index])
  );
}

/** Each thread with its beats placed on the story axis. */
export function plotThreads(
  threads: WorldThread[],
  beats: WorldBeat[],
  scenes: SceneRank[]
): PlottedThread[] {
  const rank = rankScenes(scenes);
  const byId = new Map(scenes.map((scene) => [scene.sceneId, scene]));

  return threads
    .map((thread): PlottedThread => {
      const placed = beats
        .filter((beat) => beat.threadId === thread.threadId)
        .map((beat): PlottedBeat | null => {
          const position = rank.get(beat.sceneId);
          const scene = byId.get(beat.sceneId);
          // A beat whose scene was cut has no position on the axis. Drawing it at 0 would
          // put a phantom milestone at the head of every lane.
          if (position === undefined || !scene) return null;
          return {
            sceneId: beat.sceneId,
            sceneTitle: scene.title,
            position,
            mark: beat.mark,
            text: beat.text,
            status: scene.status,
          };
        })
        .filter((beat): beat is PlottedBeat => beat !== null)
        .sort((a, b) => a.position - b.position);

      return {
        thread,
        beats: placed,
        first: placed.length ? placed[0].position : null,
        last: placed.length ? placed[placed.length - 1].position : null,
      };
    })
    .sort((a, b) => (a.first ?? Infinity) - (b.first ?? Infinity) || a.thread.title.localeCompare(b.thread.title));
}

/**
 * How many beats fall in each stretch of the manuscript.
 *
 * The only drawing in this section that tells the author something they do not already
 * know: where the book is dense and where it goes quiet. Counted over the SCENE axis
 * rather than over the beats, so an empty stretch is visible as an empty stretch.
 */
export function beatDensity(plotted: PlottedThread[], sceneCount: number, buckets = 24): number[] {
  const bars = new Array(Math.max(1, buckets)).fill(0) as number[];
  if (sceneCount <= 0) return bars;
  for (const thread of plotted) {
    for (const beat of thread.beats) {
      const bucket = Math.min(bars.length - 1, Math.floor((beat.position / sceneCount) * bars.length));
      bars[bucket] += 1;
    }
  }
  return bars;
}

export interface InertRun {
  from: number;
  to: number;
  scenes: { sceneId: string; title: string; position: number }[];
}

/**
 * Runs of consecutive scenes that no thread moves.
 *
 * Reported as RUNS, not as a list of scenes: one quiet scene between two loud ones is
 * breathing, and nine in a row is where the book sags. A list would bury the difference.
 *
 * Scenes still in outline are excluded. Nothing has been written there yet, so having no
 * beat is expected, and counting them would make every unwritten act look like a problem.
 */
export function findInertScenes(scenes: SceneRank[], beats: WorldBeat[]): InertRun[] {
  const moved = new Set(beats.map((beat) => beat.sceneId));
  const rank = rankScenes(scenes);
  const ordered = [...scenes]
    .filter((scene) => scene.status !== 'outline')
    .sort((a, b) => (rank.get(a.sceneId) ?? 0) - (rank.get(b.sceneId) ?? 0));

  const runs: InertRun[] = [];
  let current: InertRun | null = null;
  let previousPosition: number | null = null;

  for (const scene of ordered) {
    const position = rank.get(scene.sceneId) as number;
    if (moved.has(scene.sceneId)) {
      current = null;
      previousPosition = position;
      continue;
    }
    // A gap in the positions means an outline scene was skipped: that breaks the run,
    // because "nine in a row" has to mean nine scenes the reader actually reads.
    if (current && previousPosition !== null && position !== previousPosition + 1) current = null;
    if (!current) {
      current = { from: position, to: position, scenes: [] };
      runs.push(current);
    }
    current.to = position;
    current.scenes.push({ sceneId: scene.sceneId, title: scene.title, position });
    previousPosition = position;
  }

  return runs.sort((a, b) => b.scenes.length - a.scenes.length || a.from - b.from);
}

/** The order in which the threads close — the shape of the ending, in one list. */
export function closingOrder(
  plotted: PlottedThread[]
): { thread: WorldThread; last: number | null }[] {
  return [...plotted]
    .map((entry) => ({ thread: entry.thread, last: entry.last }))
    // Threads that never close go LAST, not first: `null` sorting to the top would put
    // the unfinished business at the head of a list about endings.
    .sort((a, b) => (a.last ?? Infinity) - (b.last ?? Infinity) || a.thread.title.localeCompare(b.thread.title));
}

/**
 * The milestone sheet, as plain text.
 *
 * Zero design, daily use: a writer pastes this into whatever they are drafting in. Scene
 * POSITIONS, one-based, never percentages — "closes in scene 44 of 48" is a fact you can
 * act on.
 */
export function milestoneSheet(plotted: PlottedThread[], sceneCount: number): string {
  const lines: string[] = [];
  for (const entry of plotted) {
    lines.push(entry.thread.title);
    if (entry.beats.length === 0) {
      lines.push('  —');
      continue;
    }
    for (const beat of entry.beats) {
      const mark = BEAT_MARK_LABEL[beat.mark] ?? beat.mark;
      lines.push(
        `  ${beat.position + 1}/${sceneCount}  ${mark}  ${beat.sceneTitle}${beat.text ? ` — ${beat.text}` : ''}`
      );
    }
  }
  return lines.join('\n');
}
