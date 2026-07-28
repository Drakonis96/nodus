// The decisions a world has not taken yet (schema v99).
//
// Two things make this file different from the other four of the "Analizar" group. First,
// half its content is not stored at all: the holes in the author's own prose are scanned on
// every read, exactly like a continuity finding, and only materialise as a row when the
// author does something to one. Second, it is the ONLY place in the group that writes into
// another section's sheet — so the write, the undo and the guard that decides whether the
// undo is still safe all live here, and every one of them is arithmetic over what is
// actually in the field right now.
//
// No foreign keys and no cascades, like the rest of the layer. A question whose anchor was
// deleted keeps its text and degrades to a question about the world: it is the author's
// sentence, and losing it because a character got renamed away would be the one failure
// that teaches somebody not to type here.

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import { parseEntryKey } from '@shared/worldEncyclopedia';
import {
  allWorldBodies,
  createWorldArticle,
  entryProse,
  indexEntryLinks,
  listWorldEntries,
  promoteWorldLinks,
} from './worldEncyclopediaRepo';
import {
  canUndo,
  findPlaceholders,
  inferApplyMode,
  mergeQuestionFeed,
  nextBlockedScene,
  planApply,
  rankQuestionFeed,
  type FeedScene,
  type WorldTextRef,
} from '@shared/worldQuestions';
import type {
  SceneQuestionLoad,
  WorldEntryKind,
  WorldApplyMode,
  WorldQuestion,
  WorldQuestionFeedItem,
  WorldQuestionInput,
  WorldQuestionOption,
  WorldQuestionOptionInput,
  WorldQuestionOrigin,
  WorldQuestionStatus,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

const STATUSES = new Set<WorldQuestionStatus>(['open', 'answered', 'parked']);
const APPLY_MODES = new Set<WorldApplyMode>(['none', 'fill_field', 'create_article']);

interface QuestionRow {
  question_id: string;
  question: string;
  anchor_kind: string | null;
  anchor_id: string | null;
  anchor_field: string | null;
  status: string;
  origin: string;
  origin_key: string | null;
  blocking: number;
  chosen_option_id: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
}

interface OptionRow {
  option_id: string;
  question_id: string;
  text: string;
  implications: string | null;
  origin: string;
  apply_mode: string;
  applied_at: string | null;
  replaced_text: string | null;
  created_at: string;
  updated_at: string;
}

function rowToOption(row: OptionRow): WorldQuestionOption {
  return {
    optionId: row.option_id,
    questionId: row.question_id,
    text: row.text,
    implications: row.implications,
    origin: row.origin === 'ai' ? 'ai' : 'author',
    applyMode: APPLY_MODES.has(row.apply_mode as WorldApplyMode) ? (row.apply_mode as WorldApplyMode) : 'none',
    appliedAt: row.applied_at,
    replacedText: row.replaced_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Every entry's title, keyed by `kind:id` — the join that turns an anchor into a name. */
function anchorTitles(): Map<string, string> {
  return new Map(listWorldEntries().map((entry) => [entry.key, entry.title] as const));
}

function rowToQuestion(row: QuestionRow, titles: Map<string, string>, options: WorldQuestionOption[]): WorldQuestion {
  const key = row.anchor_kind && row.anchor_id ? `${row.anchor_kind}:${row.anchor_id}` : null;
  return {
    questionId: row.question_id,
    question: row.question,
    anchorKind: row.anchor_kind,
    anchorId: row.anchor_id,
    anchorTitle: key ? (titles.get(key) ?? null) : null,
    anchorField: row.anchor_field,
    status: STATUSES.has(row.status as WorldQuestionStatus) ? (row.status as WorldQuestionStatus) : 'open',
    origin: row.origin === 'placeholder' ? 'placeholder' : 'author',
    originKey: row.origin_key,
    blocking: row.blocking === 1,
    chosenOptionId: row.chosen_option_id,
    answeredAt: row.answered_at,
    options,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function optionsByQuestion(): Map<string, WorldQuestionOption[]> {
  const rows = getDb()
    .prepare('SELECT * FROM world_question_options ORDER BY created_at, option_id')
    .all() as OptionRow[];
  const map = new Map<string, WorldQuestionOption[]>();
  for (const row of rows) {
    const option = rowToOption(row);
    map.set(option.questionId, [...(map.get(option.questionId) ?? []), option]);
  }
  return map;
}

export function listWorldQuestions(): WorldQuestion[] {
  const titles = anchorTitles();
  const options = optionsByQuestion();
  return (
    getDb().prepare('SELECT * FROM world_questions ORDER BY created_at DESC').all() as QuestionRow[]
  ).map((row) => rowToQuestion(row, titles, options.get(row.question_id) ?? []));
}

export function getWorldQuestion(questionId: string): WorldQuestion | null {
  const row = getDb().prepare('SELECT * FROM world_questions WHERE question_id = ?').get(questionId) as
    | QuestionRow
    | undefined;
  if (!row) return null;
  const options = (
    getDb()
      .prepare('SELECT * FROM world_question_options WHERE question_id = ? ORDER BY created_at, option_id')
      .all(questionId) as OptionRow[]
  ).map(rowToOption);
  return rowToQuestion(row, anchorTitles(), options);
}

/**
 * Create a question, or hand back the one that already stands for this hole.
 *
 * `origin_key` is deliberately NOT unique in the schema — a duplicate arriving from another
 * machine must not be a failed merge — so the de-duplication is here, where there is a
 * transaction and a caller to hand the existing row back to. Without it, parking a derived
 * question twice would leave two rows and the hole would come back half-silenced.
 */
export function createWorldQuestion(input: WorldQuestionInput): WorldQuestion {
  const question = (input.question ?? '').trim();
  if (!question) throw new Error('La pregunta necesita un texto.');
  if (input.originKey) {
    const existing = getDb()
      .prepare('SELECT question_id FROM world_questions WHERE origin_key = ?')
      .get(input.originKey) as { question_id: string } | undefined;
    if (existing) return getWorldQuestion(existing.question_id) as WorldQuestion;
  }

  const id = `qst_${uuid()}`;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO world_questions
         (question_id, question, anchor_kind, anchor_id, anchor_field, status, origin, origin_key,
          blocking, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      question,
      input.anchorKind ?? null,
      input.anchorId ?? null,
      input.anchorField ?? null,
      input.status ?? 'open',
      input.origin ?? 'author',
      input.originKey ?? null,
      input.blocking ? 1 : 0,
      ts,
      ts
    );
  return getWorldQuestion(id) as WorldQuestion;
}

export function updateWorldQuestion(questionId: string, patch: WorldQuestionInput): WorldQuestion {
  const current = getWorldQuestion(questionId);
  if (!current) throw new Error('Pregunta no encontrada.');
  const question = patch.question !== undefined ? patch.question.trim() || current.question : current.question;
  getDb()
    .prepare(
      `UPDATE world_questions SET question = ?, anchor_kind = ?, anchor_id = ?, anchor_field = ?,
          status = ?, blocking = ?, updated_at = ? WHERE question_id = ?`
    )
    .run(
      question,
      patch.anchorKind !== undefined ? patch.anchorKind : current.anchorKind,
      patch.anchorId !== undefined ? patch.anchorId : current.anchorId,
      patch.anchorField !== undefined ? patch.anchorField : current.anchorField,
      patch.status ?? current.status,
      (patch.blocking ?? current.blocking) ? 1 : 0,
      now(),
      questionId
    );
  return getWorldQuestion(questionId) as WorldQuestion;
}

/** Deleting a question takes its options with it: they are its answers, not the world's. */
export function deleteWorldQuestion(questionId: string): void {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM world_question_options WHERE question_id = ?').run(questionId);
    db.prepare('DELETE FROM world_questions WHERE question_id = ?').run(questionId);
  });
  run();
}

/**
 * Add or edit one competing answer.
 *
 * The apply mode is INFERRED from the question's anchor unless the caller pins it, which is
 * what keeps the destination out of the form: a question captured in a character's
 * backstory writes there, one about the world at large becomes an article, and one hanging
 * off an entity with no field is simply remembered.
 */
export function setQuestionOption(input: WorldQuestionOptionInput): WorldQuestionOption {
  const question = getWorldQuestion(input.questionId);
  if (!question) throw new Error('Pregunta no encontrada.');
  const text = (input.text ?? '').trim();
  if (!text) throw new Error('La opción necesita un texto.');
  const db = getDb();
  const ts = now();

  if (input.optionId) {
    db.prepare(
      'UPDATE world_question_options SET text = ?, implications = ?, apply_mode = ?, updated_at = ? WHERE option_id = ?'
    ).run(
      text,
      input.implications ?? null,
      input.applyMode ?? inferApplyMode(anchorOf(question), question.anchorField),
      ts,
      input.optionId
    );
    return rowToOption(
      db.prepare('SELECT * FROM world_question_options WHERE option_id = ?').get(input.optionId) as OptionRow
    );
  }

  const id = `qop_${uuid()}`;
  db.prepare(
    `INSERT INTO world_question_options
       (option_id, question_id, text, implications, origin, apply_mode, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.questionId,
    text,
    input.implications ?? null,
    input.origin ?? 'author',
    input.applyMode ?? inferApplyMode(anchorOf(question), question.anchorField),
    ts,
    ts
  );
  return rowToOption(db.prepare('SELECT * FROM world_question_options WHERE option_id = ?').get(id) as OptionRow);
}

export function deleteQuestionOption(optionId: string): void {
  const db = getDb();
  const run = db.transaction(() => {
    // A chosen option that is deleted un-answers its question rather than leaving it
    // pointing at a row that is gone.
    db.prepare(
      "UPDATE world_questions SET chosen_option_id = NULL, answered_at = NULL, status = 'open', updated_at = ? WHERE chosen_option_id = ?"
    ).run(now(), optionId);
    db.prepare('DELETE FROM world_question_options WHERE option_id = ?').run(optionId);
  });
  run();
}

/** The anchor as the encyclopedia addresses it. Every kind that can hold prose is a
 *  `WorldEntryKind`, which is what makes one link indexer serve all of them. */
function entryRef(anchor: { kind: string; id: string }): { kind: WorldEntryKind; id: string } {
  return { kind: anchor.kind as WorldEntryKind, id: anchor.id };
}

function anchorOf(question: WorldQuestion): { kind: string; id: string; title: string } | null {
  return question.anchorKind && question.anchorId && question.anchorTitle
    ? { kind: question.anchorKind, id: question.anchorId, title: question.anchorTitle }
    : null;
}

// ── Writing into somebody else's sheet ───────────────────────────────────────

/**
 * Where each prose field actually lives. The mirror of `entryProse`, and the reason it is
 * written out rather than derived: this map is the list of fields an answer is ALLOWED to
 * write into, and a field that grows a new home must be added here on purpose.
 */
const FIELD_HOMES: Record<string, Record<string, { table: string; column: string; key: string }>> = {
  article: {
    summary: { table: 'world_articles', column: 'summary', key: 'article_id' },
    body: { table: 'world_articles', column: 'body', key: 'article_id' },
    notes: { table: 'world_articles', column: 'notes', key: 'article_id' },
  },
  character: {
    appearance: { table: 'character_profiles', column: 'appearance', key: 'person_id' },
    personality: { table: 'character_profiles', column: 'personality', key: 'person_id' },
    backstory: { table: 'character_profiles', column: 'backstory', key: 'person_id' },
    biography: { table: 'persons', column: 'biography', key: 'person_id' },
    notes: { table: 'persons', column: 'notes', key: 'person_id' },
  },
  place: {
    appearance: { table: 'place_profiles', column: 'appearance', key: 'place_id' },
    atmosphere: { table: 'place_profiles', column: 'atmosphere', key: 'place_id' },
    history: { table: 'place_profiles', column: 'history', key: 'place_id' },
    notes: { table: 'places', column: 'notes', key: 'place_id' },
  },
  group: {
    summary: { table: 'world_groups', column: 'summary', key: 'group_id' },
    description: { table: 'world_groups', column: 'description', key: 'group_id' },
    notes: { table: 'world_groups', column: 'notes', key: 'group_id' },
  },
  scene: {
    summary: { table: 'world_scenes', column: 'summary', key: 'scene_id' },
    notes: { table: 'world_scenes', column: 'notes', key: 'scene_id' },
  },
  map: { notes: { table: 'world_maps', column: 'notes', key: 'map_id' } },
  rule: {
    statement: { table: 'world_rules', column: 'statement', key: 'rule_id' },
    cost: { table: 'world_rules', column: 'cost', key: 'rule_id' },
    limits: { table: 'world_rules', column: 'limits', key: 'rule_id' },
  },
  conflict: {
    pitch: { table: 'world_threads', column: 'pitch', key: 'thread_id' },
    stakes: { table: 'world_threads', column: 'stakes', key: 'thread_id' },
    outcome: { table: 'world_threads', column: 'outcome', key: 'thread_id' },
  },
};

export function isWritableField(kind: string | null, field: string | null): boolean {
  return Boolean(kind && field && FIELD_HOMES[kind]?.[field]);
}

function readField(kind: string, id: string, field: string): string | null {
  const home = FIELD_HOMES[kind]?.[field];
  if (!home) return null;
  const row = getDb()
    .prepare(`SELECT ${home.column} AS value FROM ${home.table} WHERE ${home.key} = ?`)
    .get(id) as { value: string | null } | undefined;
  return row?.value ?? null;
}

function hasColumn(table: string, column: string): boolean {
  return (
    (getDb().prepare('SELECT COUNT(*) AS c FROM pragma_table_info(?) WHERE name = ?').get(table, column) as {
      c: number;
    }).c > 0
  );
}

/**
 * Write one prose field of one sheet.
 *
 * The two profile tables are written with an upsert and not an UPDATE, and that is not
 * defensive coding: `character_profiles` and `place_profiles` hang off their parent by a
 * LEFT JOIN everywhere they are read, so a character created before the profile existed has
 * no row at all — and an UPDATE against it would report success and write nothing, which is
 * the worst possible outcome for a button that says it just wrote a paragraph.
 */
function writeField(kind: string, id: string, field: string, text: string): void {
  const home = FIELD_HOMES[kind]?.[field];
  if (!home) throw new Error('Ese campo no se puede escribir desde aquí.');
  const db = getDb();
  const ts = now();
  const touches = hasColumn(home.table, 'updated_at');

  if (home.table === 'character_profiles' || home.table === 'place_profiles') {
    db.prepare(
      `INSERT INTO ${home.table} (${home.key}, ${home.column}, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(${home.key}) DO UPDATE SET ${home.column} = excluded.${home.column}, updated_at = excluded.updated_at`
    ).run(id, text, ts, ts);
  } else if (touches) {
    db.prepare(`UPDATE ${home.table} SET ${home.column} = ?, updated_at = ? WHERE ${home.key} = ?`).run(text, ts, id);
  } else {
    db.prepare(`UPDATE ${home.table} SET ${home.column} = ? WHERE ${home.key} = ?`).run(text, id);
  }
}

/**
 * Answer a question by applying one of its options.
 *
 * Everything the write needs is worked out first, in a pure function, so that the sentence
 * on the button and the change on disk cannot disagree. The old text is stored on the
 * option, which is the whole undo: nobody presses a button that rewrites a paragraph of
 * their own novel unless it can be taken back.
 */
export function applyQuestionOption(optionId: string): WorldQuestion {
  const db = getDb();
  const optionRow = db.prepare('SELECT * FROM world_question_options WHERE option_id = ?').get(optionId) as
    | OptionRow
    | undefined;
  if (!optionRow) throw new Error('Opción no encontrada.');
  const option = rowToOption(optionRow);
  const question = getWorldQuestion(option.questionId);
  if (!question) throw new Error('Pregunta no encontrada.');

  const anchor = anchorOf(question);
  const current =
    anchor && question.anchorField ? readField(anchor.kind, anchor.id, question.anchorField) : null;
  const plan = planApply(
    { question: question.question, anchor, anchorField: question.anchorField },
    option,
    current
  );

  const ts = now();
  const run = db.transaction(() => {
    if (plan && 'create' in plan) {
      const article = createWorldArticle({ title: plan.title, summary: plan.summary });
      // The new article is prose like any other: `[[…]]` in the answer becomes a real
      // link, and the entry appears in everybody's backlinks straight away.
      const promoted = promoteWorldLinks(plan.summary, { kind: 'article', id: article.articleId });
      if (promoted.resolved > 0) {
        db.prepare('UPDATE world_articles SET summary = ? WHERE article_id = ?').run(
          promoted.text,
          article.articleId
        );
      }
      indexEntryLinks({ kind: 'article', id: article.articleId });
      db.prepare('UPDATE world_question_options SET applied_at = ?, replaced_text = NULL, updated_at = ? WHERE option_id = ?').run(
        ts,
        ts,
        optionId
      );
    } else if (plan && anchor && question.anchorField) {
      const promoted = promoteWorldLinks(plan.nextText, entryRef(anchor));
      writeField(anchor.kind, anchor.id, plan.field, promoted.text ?? plan.nextText);
      indexEntryLinks(entryRef(anchor));
      db.prepare('UPDATE world_question_options SET applied_at = ?, replaced_text = ?, updated_at = ? WHERE option_id = ?').run(
        ts,
        plan.replacedText,
        ts,
        optionId
      );
    } else {
      // `none`, or a plan that turned out to be impossible (the anchor is gone, the option
      // is empty). The decision is still taken — it is simply only remembered.
      db.prepare('UPDATE world_question_options SET applied_at = ?, updated_at = ? WHERE option_id = ?').run(
        ts,
        ts,
        optionId
      );
    }
    db.prepare(
      "UPDATE world_questions SET status = 'answered', chosen_option_id = ?, answered_at = ?, updated_at = ? WHERE question_id = ?"
    ).run(optionId, ts, ts, question.questionId);
  });
  run();

  return getWorldQuestion(question.questionId) as WorldQuestion;
}

/**
 * Take it back — but only while it is still safe.
 *
 * `canUndo` is false the moment the field stops containing what was written into it, and
 * this refuses rather than restoring: putting the old paragraph back over prose the author
 * wrote afterwards would destroy work, which is precisely the harm the button exists to
 * prevent.
 */
export function undoQuestionOption(optionId: string): WorldQuestion {
  const db = getDb();
  const optionRow = db.prepare('SELECT * FROM world_question_options WHERE option_id = ?').get(optionId) as
    | OptionRow
    | undefined;
  if (!optionRow) throw new Error('Opción no encontrada.');
  const option = rowToOption(optionRow);
  const question = getWorldQuestion(option.questionId);
  if (!question) throw new Error('Pregunta no encontrada.');
  const anchor = anchorOf(question);
  const current =
    anchor && question.anchorField ? readField(anchor.kind, anchor.id, question.anchorField) : null;

  const ts = now();
  const run = db.transaction(() => {
    if (anchor && question.anchorField && canUndo(option, current)) {
      writeField(anchor.kind, anchor.id, question.anchorField, option.replacedText as string);
      indexEntryLinks(entryRef(anchor));
    }
    db.prepare(
      'UPDATE world_question_options SET applied_at = NULL, replaced_text = NULL, updated_at = ? WHERE option_id = ?'
    ).run(ts, optionId);
    db.prepare(
      "UPDATE world_questions SET status = 'open', chosen_option_id = NULL, answered_at = NULL, updated_at = ? WHERE question_id = ?"
    ).run(ts, question.questionId);
  });
  run();

  return getWorldQuestion(question.questionId) as WorldQuestion;
}

/** Whether the undo would still restore the old text, for the button that offers it. */
export function canUndoOption(optionId: string): boolean {
  const optionRow = getDb().prepare('SELECT * FROM world_question_options WHERE option_id = ?').get(optionId) as
    | OptionRow
    | undefined;
  if (!optionRow) return false;
  const option = rowToOption(optionRow);
  const question = getWorldQuestion(option.questionId);
  const anchor = question ? anchorOf(question) : null;
  if (!question || !anchor || !question.anchorField) return false;
  return canUndo(option, readField(anchor.kind, anchor.id, question.anchorField));
}

// ── The feed ─────────────────────────────────────────────────────────────────

/** Every piece of prose in the world, as the placeholder scan wants it. */
function worldTexts(): WorldTextRef[] {
  const texts: WorldTextRef[] = [];
  for (const body of allWorldBodies()) {
    const ref = parseEntryKey(body.key);
    if (!ref) continue;
    texts.push({ kind: ref.kind, id: ref.id, title: body.title, field: body.field, text: body.text });
  }
  return texts;
}

/**
 * What each scene leans on: its cast, its place, whatever its text links to, and itself.
 *
 * Built once for the whole feed rather than per question, because the alternative is one
 * query per question per open — and this is the input to the only number on the screen the
 * author cannot work out for themselves, «la escena límite».
 */
function feedScenes(): FeedScene[] {
  const db = getDb();
  const scenes = db
    .prepare('SELECT scene_id, title, narrative_order, status, place_id FROM world_scenes')
    .all() as { scene_id: string; title: string; narrative_order: number; status: string; place_id: string | null }[];

  const cast = new Map<string, string[]>();
  for (const row of db.prepare('SELECT scene_id, person_id FROM scene_characters').all() as {
    scene_id: string;
    person_id: string;
  }[]) {
    cast.set(row.scene_id, [...(cast.get(row.scene_id) ?? []), `character:${row.person_id}`]);
  }

  const mentions = new Map<string, string[]>();
  for (const row of db
    .prepare("SELECT source_id, target_key FROM world_links WHERE source_kind = 'scene'")
    .all() as { source_id: string; target_key: string }[]) {
    // Unresolved `?:` links point at nothing yet, so they cannot block anything.
    if (!parseEntryKey(row.target_key)) continue;
    mentions.set(row.source_id, [...(mentions.get(row.source_id) ?? []), row.target_key]);
  }

  return scenes.map((row) => ({
    sceneId: row.scene_id,
    title: row.title,
    narrativeOrder: row.narrative_order,
    // Only what is still unwritten can be blocked: a decision that affects a finished
    // chapter is a revision, and a revision is not what this screen is for.
    written: row.status === 'written',
    leansOn: [
      `scene:${row.scene_id}`,
      ...(row.place_id ? [`place:${row.place_id}`] : []),
      ...(cast.get(row.scene_id) ?? []),
      ...(mentions.get(row.scene_id) ?? []),
    ],
  }));
}

/** How many bodies mention each anchor — the leverage line, straight from the link graph. */
function leverageMap(): Map<string, number> {
  const rows = getDb()
    .prepare('SELECT target_key, COUNT(*) AS c FROM world_links GROUP BY target_key')
    .all() as { target_key: string; c: number }[];
  return new Map(rows.map((row) => [row.target_key, row.c] as const));
}

export function questionFeed(includeSettled = false): WorldQuestionFeedItem[] {
  const stored = listWorldQuestions();
  const derived = findPlaceholders(worldTexts());
  return rankQuestionFeed(
    mergeQuestionFeed(stored, derived, {
      leverage: leverageMap(),
      scenes: feedScenes(),
      includeSettled,
    })
  );
}

/**
 * Materialise a derived hole so it can be parked, answered or edited.
 *
 * Called the first time the author touches one. Nothing is stored before that: a table of
 * every `???` in the manuscript would be a second truth that survives its own correction,
 * which is the same mistake a findings table would be.
 */
export function ensureQuestion(item: {
  question: string;
  originKey?: string | null;
  origin?: WorldQuestionOrigin;
  anchorKind?: string | null;
  anchorId?: string | null;
  anchorField?: string | null;
}): WorldQuestion {
  return createWorldQuestion({
    question: item.question,
    origin: item.origin ?? 'placeholder',
    originKey: item.originKey ?? null,
    anchorKind: item.anchorKind ?? null,
    anchorId: item.anchorId ?? null,
    anchorField: item.anchorField ?? null,
  });
}

/**
 * The holes that are still open somewhere else, after one has been answered.
 *
 * The mark is read out of the option's own `replaced_text` — what the field said before —
 * so no column has to remember it and the answer keeps working after the hole it filled is
 * gone. What comes back is the same mark still sitting in other people's sheets.
 */
export function remainingHoles(optionId: string): { kind: string; id: string; title: string; field: string; evidence: string }[] {
  const optionRow = getDb().prepare('SELECT * FROM world_question_options WHERE option_id = ?').get(optionId) as
    | OptionRow
    | undefined;
  if (!optionRow?.replaced_text) return [];
  const [before] = findPlaceholders([
    { kind: 'x', id: 'x', title: 'x', field: 'x', text: optionRow.replaced_text },
  ]);
  if (!before) return [];
  const question = getWorldQuestion(optionRow.question_id);

  return findPlaceholders(worldTexts())
    .filter(
      (hit) =>
        hit.token.toUpperCase() === before.token.toUpperCase() &&
        !(hit.anchor.id === question?.anchorId && hit.field === question?.anchorField)
    )
    .map((hit) => ({
      kind: hit.anchor.kind,
      id: hit.anchor.id,
      title: hit.anchor.title,
      field: hit.field,
      evidence: hit.evidence,
    }));
}

/**
 * What one scene is waiting on, for the band at the top of its sheet.
 *
 * The same feed, filtered to the anchors this scene leans on. The point of showing it there
 * rather than only in the section is that the author is never asked to visit a screen to
 * feed it: they open the scene they are about to write and the decisions it depends on are
 * already in front of them.
 */
export function sceneQuestionLoad(sceneId: string): SceneQuestionLoad {
  const scene = feedScenes().find((entry) => entry.sceneId === sceneId);
  if (!scene) return { count: 0, blocking: 0, items: [] };
  const leansOn = new Set(scene.leansOn);
  const items = questionFeed().filter(
    (item) => item.status === 'open' && item.anchor && leansOn.has(`${item.anchor.kind}:${item.anchor.id}`)
  );
  return { count: items.length, blocking: items.filter((item) => item.blocking).length, items };
}

/**
 * The next unwritten scene that leans on an anchor.
 *
 * Exported for the model prompt, which wants it without paying for the whole feed: the feed
 * scans every piece of prose in the world for holes, and «what is this blocking» needs only
 * the scenes and what they lean on.
 */
export function blockedSceneFor(anchor: { kind: string; id: string } | null) {
  return nextBlockedScene(anchor, feedScenes());
}

/** The prose of an entry, so the sheet can show the field an answer would write into. */
export function questionAnchorText(kind: string, id: string, field: string): string | null {
  if (!isWritableField(kind, field)) return null;
  const block = entryProse({ kind: kind as WorldEntryKind, id }).find((entry) => entry.field === field);
  return block?.text ?? null;
}

