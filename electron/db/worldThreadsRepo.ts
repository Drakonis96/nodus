// Threads (conflicts and arcs) and beats (schema v99).
//
// A conflict is a thread whose parties oppose; an arc is a thread with one subject. They
// share a table because they are the same machine, and because the alternative was three
// panels on the scene sheet — one per section — filling three tables with the same shape.
//
// NO FOREIGN KEYS ANYWHERE, and that is not laziness. `foreign_keys` is ON, so a
// `REFERENCES` with no declared action uses NO ACTION and ABORTS the parent delete: cutting
// a scene would fail with a constraint error instead of doing what the author asked.
// Ownership lives in the delete transactions below.

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import { entryKey, normalizeTitle, pendingKey } from '@shared/worldEncyclopedia';
// No cycle: the encyclopedia repo reads `world_threads` with its own SQL and never imports
// this file.
import { indexEntryLinks, promoteWorldLinks } from './worldEncyclopediaRepo';
import type { BoardCastMember } from '@shared/worldThreads';
import type {
  BeatMark,
  BeatThreadKind,
  ThreadParty,
  ThreadPartySide,
  WorldBeat,
  WorldBeatInput,
  WorldThread,
  WorldThreadInput,
  WorldThreadKind,
  WorldThreadScope,
  WorldThreadStatus,
} from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${uuid()}`;
}

interface ThreadRow {
  thread_id: string;
  kind: string;
  title: string;
  title_key: string;
  pitch: string | null;
  stakes: string | null;
  scope: string;
  status: string;
  outcome: string | null;
  origin: string;
  created_at: string;
  updated_at: string;
}

interface PartyRow {
  thread_id: string;
  party_kind: string;
  party_id: string;
  side: string;
}

const SIDES = new Set<ThreadPartySide>(['subject', 'wants', 'opposes', 'caught']);

function threadKind(value: string): WorldThreadKind {
  return value === 'arc' ? 'arc' : 'conflict';
}

function threadStatus(value: string): WorldThreadStatus {
  return value === 'resolved' ? 'resolved' : value === 'archived' ? 'archived' : 'open';
}

function threadScope(value: string): WorldThreadScope {
  return value === 'background' ? 'background' : 'external';
}

/**
 * Party names come from two tables, so they are fetched once for the whole list rather
 * than per thread: a world with forty threads would otherwise be eighty round trips.
 */
function partyNames(): Map<string, string> {
  const db = getDb();
  const names = new Map<string, string>();
  for (const row of db.prepare('SELECT person_id, display_name FROM persons').all() as {
    person_id: string;
    display_name: string;
  }[]) {
    names.set(`character:${row.person_id}`, row.display_name);
  }
  for (const row of db.prepare('SELECT group_id, name FROM world_groups').all() as {
    group_id: string;
    name: string;
  }[]) {
    names.set(`group:${row.group_id}`, row.name);
  }
  return names;
}

function rowToThread(row: ThreadRow, parties: ThreadParty[]): WorldThread {
  return {
    threadId: row.thread_id,
    kind: threadKind(row.kind),
    title: row.title,
    titleKey: row.title_key,
    pitch: row.pitch,
    stakes: row.stakes,
    scope: threadScope(row.scope),
    status: threadStatus(row.status),
    outcome: row.outcome,
    origin: row.origin === 'ai' ? 'ai' : 'author',
    parties,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWorldThreads(kind?: WorldThreadKind): WorldThread[] {
  const db = getDb();
  const rows = (
    kind
      ? db.prepare('SELECT * FROM world_threads WHERE kind = ? ORDER BY status, title').all(kind)
      : db.prepare('SELECT * FROM world_threads ORDER BY kind, status, title').all()
  ) as ThreadRow[];
  const names = partyNames();
  const parties = new Map<string, ThreadParty[]>();
  for (const row of db.prepare('SELECT * FROM thread_parties').all() as PartyRow[]) {
    const party: ThreadParty = {
      threadId: row.thread_id,
      partyKind: row.party_kind === 'group' ? 'group' : 'character',
      partyId: row.party_id,
      // A party whose entity was deleted keeps its slot with a placeholder name: the
      // author needs to see what they just orphaned, not a silently shorter list.
      partyName: names.get(`${row.party_kind}:${row.party_id}`) ?? '—',
      side: SIDES.has(row.side as ThreadPartySide) ? (row.side as ThreadPartySide) : 'wants',
    };
    parties.set(row.thread_id, [...(parties.get(row.thread_id) ?? []), party]);
  }
  return rows.map((row) => rowToThread(row, parties.get(row.thread_id) ?? []));
}

export function getWorldThread(threadId: string): WorldThread | null {
  return listWorldThreads().find((thread) => thread.threadId === threadId) ?? null;
}

export function createWorldThread(input: WorldThreadInput): WorldThread {
  const title = (input.title ?? '').trim();
  if (!title) throw new Error('El hilo necesita un título.');
  const db = getDb();
  const id = newId('thr');
  const ts = now();
  db.prepare(
    `INSERT INTO world_threads
       (thread_id, kind, title, title_key, pitch, stakes, scope, status, outcome, origin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'author', ?, ?)`
  ).run(
    id,
    input.kind ?? 'conflict',
    title,
    normalizeTitle(title),
    input.pitch ?? null,
    input.stakes ?? null,
    input.scope ?? 'external',
    input.status ?? 'open',
    input.outcome ?? null,
    ts,
    ts
  );
  return getWorldThread(id) as WorldThread;
}

export function updateWorldThread(threadId: string, patch: WorldThreadInput): WorldThread {
  const current = getWorldThread(threadId);
  if (!current) throw new Error('Hilo no encontrado.');
  const title = patch.title !== undefined ? patch.title.trim() || current.title : current.title;
  const self = { kind: 'conflict' as const, id: threadId };
  // A conflict's prose behaves like an article's: typing `[[Kaelen Vor]]` and saving turns
  // it into a real link, so the author never learns that there are two forms — and so the
  // character's sheet knows it is mentioned.
  const promote = (value: string | null | undefined, fallback: string | null) =>
    value !== undefined ? promoteWorldLinks(value, self).text : fallback;
  getDb()
    .prepare(
      `UPDATE world_threads SET title = ?, title_key = ?, pitch = ?, stakes = ?, scope = ?, status = ?,
          outcome = ?, updated_at = ? WHERE thread_id = ?`
    )
    .run(
      title,
      normalizeTitle(title),
      promote(patch.pitch, current.pitch),
      promote(patch.stakes, current.stakes),
      patch.scope ?? current.scope,
      patch.status ?? current.status,
      promote(patch.outcome, current.outcome),
      now(),
      threadId
    );
  if (current.kind === 'conflict') indexEntryLinks({ kind: 'conflict', id: threadId });
  return getWorldThread(threadId) as WorldThread;
}

export function deleteWorldThread(threadId: string): void {
  const db = getDb();
  const thread = getWorldThread(threadId);
  const run = db.transaction(() => {
    db.prepare('DELETE FROM thread_parties WHERE thread_id = ?').run(threadId);
    db.prepare('DELETE FROM world_beats WHERE thread_kind <> ? AND thread_id = ?').run('rule', threadId);
    // A conflict is an encyclopedia entry, so it owns links out of its pitch, and other
    // bodies may link to it. Its own go; the ones pointing AT it degrade to unresolved, so
    // the author sees in red what they just orphaned.
    db.prepare('DELETE FROM world_links WHERE source_kind = ? AND source_id = ?').run('conflict', threadId);
    if (thread?.kind === 'conflict') {
      db.prepare('UPDATE OR REPLACE world_links SET target_key = ? WHERE target_key = ?').run(
        pendingKey(thread.title),
        entryKey({ kind: 'conflict', id: threadId })
      );
    }
    db.prepare('DELETE FROM world_threads WHERE thread_id = ?').run(threadId);
  });
  run();
}

/**
 * Replace a thread's parties wholesale.
 *
 * Delete-then-insert under a content-derived key, so an unchanged party re-inserts over
 * itself and the tombstone trigger pair nets to zero. With a surrogate id every save of
 * this set would leave one permanent tombstone per party, syncing forever.
 */
export function setThreadParties(
  threadId: string,
  parties: { partyKind: 'character' | 'group'; partyId: string; side: ThreadPartySide }[]
): WorldThread {
  const db = getDb();
  const ts = now();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM thread_parties WHERE thread_id = ?').run(threadId);
    const insert = db.prepare(
      `INSERT INTO thread_parties (thread_id, party_kind, party_id, side, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_id, party_kind, party_id) DO UPDATE SET side = excluded.side, updated_at = excluded.updated_at`
    );
    for (const party of parties) insert.run(threadId, party.partyKind, party.partyId, party.side, ts, ts);
  });
  run();
  return getWorldThread(threadId) as WorldThread;
}

export function threadsForParty(partyKind: 'character' | 'group', partyId: string): WorldThread[] {
  return listWorldThreads().filter((thread) =>
    thread.parties.some((party) => party.partyKind === partyKind && party.partyId === partyId)
  );
}

// ── Beats ────────────────────────────────────────────────────────────────────

interface BeatRow {
  thread_kind: string;
  thread_id: string;
  scene_id: string;
  mark: string;
  text: string | null;
  subject_kind: string | null;
  subject_id: string | null;
  paid: number | null;
}

/**
 * Every beat in the world, with the titles the UI needs already joined.
 *
 * One query for the lot rather than per scene: the diagnostics ("these nine scenes move
 * nothing", "this thread was declared and forgotten") are all whole-manuscript questions,
 * and paying for them one scene at a time is how a structural view becomes too slow to open.
 */
export function listWorldBeats(): WorldBeat[] {
  const db = getDb();
  const names = partyNames();
  const scenes = new Map(
    (db.prepare('SELECT scene_id, title, narrative_order FROM world_scenes').all() as {
      scene_id: string;
      title: string;
      narrative_order: number;
    }[]).map((row) => [row.scene_id, row])
  );
  const threadTitles = new Map<string, string>();
  for (const row of db.prepare('SELECT thread_id, title FROM world_threads').all() as {
    thread_id: string;
    title: string;
  }[]) {
    threadTitles.set(row.thread_id, row.title);
  }
  for (const row of db.prepare('SELECT rule_id, title FROM world_rules').all() as {
    rule_id: string;
    title: string;
  }[]) {
    threadTitles.set(row.rule_id, row.title);
  }

  return (db.prepare('SELECT * FROM world_beats').all() as BeatRow[])
    .map((row): WorldBeat => {
      const scene = scenes.get(row.scene_id);
      return {
        threadKind: (row.thread_kind === 'rule' || row.thread_kind === 'arc'
          ? row.thread_kind
          : 'conflict') as BeatThreadKind,
        threadId: row.thread_id,
        threadTitle: threadTitles.get(row.thread_id) ?? '—',
        sceneId: row.scene_id,
        sceneTitle: scene?.title ?? '—',
        narrativeOrder: scene?.narrative_order ?? 0,
        mark: row.mark as BeatMark,
        text: row.text,
        subjectKind: row.subject_kind === 'group' ? 'group' : row.subject_kind === 'character' ? 'character' : null,
        subjectId: row.subject_id,
        subjectName: row.subject_id ? names.get(`${row.subject_kind}:${row.subject_id}`) ?? null : null,
        // Three states, not two: NULL is "not looked at", 0 is "the price is not on the
        // page". Collapsing them would make every freshly created beat an accusation.
        paid: row.paid == null ? null : row.paid === 1,
      };
    })
    // A beat whose scene was cut is dropped from the read rather than shown at order 0,
    // where it would sit at the head of every list until somebody noticed.
    .filter((beat) => scenes.has(beat.sceneId));
}

export function beatsForScene(sceneId: string): WorldBeat[] {
  return listWorldBeats().filter((beat) => beat.sceneId === sceneId);
}

/** Write one beat. Idempotent: a thread either moves a scene or it does not — a set. */
export function setWorldBeat(input: WorldBeatInput): void {
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO world_beats
         (thread_kind, thread_id, scene_id, mark, text, subject_kind, subject_id, paid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(thread_kind, thread_id, scene_id) DO UPDATE SET
         mark = excluded.mark, text = excluded.text, subject_kind = excluded.subject_kind,
         subject_id = excluded.subject_id, paid = excluded.paid, updated_at = excluded.updated_at`
    )
    .run(
      input.threadKind,
      input.threadId,
      input.sceneId,
      input.mark,
      input.text ?? null,
      input.subjectKind ?? null,
      input.subjectId ?? null,
      input.paid == null ? null : input.paid ? 1 : 0,
      ts,
      ts
    );
}

export function deleteWorldBeat(threadKind: BeatThreadKind, threadId: string, sceneId: string): void {
  getDb()
    .prepare('DELETE FROM world_beats WHERE thread_kind = ? AND thread_id = ? AND scene_id = ?')
    .run(threadKind, threadId, sceneId);
}

/**
 * Clean-up hooks. These exist because the schema has no cascades — see the header — so
 * every delete path has to remove what it owns, exactly as `deleteImagesFor` does for the
 * polymorphic gallery.
 */
export function deleteBeatsForScene(sceneId: string): void {
  getDb().prepare('DELETE FROM world_beats WHERE scene_id = ?').run(sceneId);
}

export function deletePartiesForEntity(partyKind: 'character' | 'group', partyId: string): void {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM thread_parties WHERE party_kind = ? AND party_id = ?').run(partyKind, partyId);
    // The beat survives — the scene still moved the thread — but it stops claiming it was
    // in favour of somebody who no longer exists.
    db.prepare('UPDATE world_beats SET subject_kind = NULL, subject_id = NULL WHERE subject_kind = ? AND subject_id = ?').run(
      partyKind,
      partyId
    );
  });
  run();
}

// ── The board ────────────────────────────────────────────────────────────────

/**
 * Everything the cast × conflicts board reads, in four queries.
 *
 * The arc fields come along READ-ONLY: they belong to `character_profiles`, and the board
 * shows them so a writer can see "wants nothing here, and wants nothing on their sheet
 * either" in one glance. Copying them into a thread would give two places to edit one
 * sentence.
 */
export function threadBoardData(): {
  cast: BoardCastMember[];
  threads: WorldThread[];
  affiliations: { personId: string; personName: string; groupId: string; groupName: string }[];
} {
  const db = getDb();
  const sceneCounts = new Map(
    (db.prepare('SELECT person_id, COUNT(*) AS c FROM scene_characters GROUP BY person_id').all() as {
      person_id: string;
      c: number;
    }[]).map((row) => [row.person_id, row.c])
  );

  const cast = (
    db
      .prepare(
        `SELECT p.person_id, p.display_name, c.narrative_role, c.arc_want, c.arc_need, c.accent
           FROM persons p
           LEFT JOIN character_profiles c ON c.person_id = p.person_id
          ORDER BY p.display_name`
      )
      .all() as {
      person_id: string;
      display_name: string;
      narrative_role: string | null;
      arc_want: string | null;
      arc_need: string | null;
      accent: string | null;
    }[]
  ).map((row) => ({
    personId: row.person_id,
    displayName: row.display_name,
    narrativeRole: row.narrative_role,
    arcWant: row.arc_want,
    arcNeed: row.arc_need,
    accent: row.accent,
    sceneCount: sceneCounts.get(row.person_id) ?? 0,
  }));

  const affiliations = (
    db
      .prepare(
        `SELECT a.person_id, p.display_name, a.group_id, g.name AS group_name
           FROM character_affiliations a
           JOIN persons p ON p.person_id = a.person_id
           JOIN world_groups g ON g.group_id = a.group_id`
      )
      .all() as { person_id: string; display_name: string; group_id: string; group_name: string }[]
  ).map((row) => ({
    personId: row.person_id,
    personName: row.display_name,
    groupId: row.group_id,
    groupName: row.group_name,
  }));

  return { cast, threads: listWorldThreads(), affiliations };
}

/** Scenes and their cast, for the "could have happened in" suggestions. */
export function threadSceneContext(): {
  scenes: { sceneId: string; title: string; narrativeOrder: number }[];
  sceneCast: { sceneId: string; personId: string; personName: string }[];
  membership: { groupId: string; personId: string }[];
} {
  const db = getDb();
  return {
    scenes: (
      db.prepare('SELECT scene_id, title, narrative_order FROM world_scenes ORDER BY narrative_order').all() as {
        scene_id: string;
        title: string;
        narrative_order: number;
      }[]
    ).map((row) => ({ sceneId: row.scene_id, title: row.title, narrativeOrder: row.narrative_order })),
    sceneCast: (
      db
        .prepare(
          `SELECT sc.scene_id, sc.person_id, p.display_name
             FROM scene_characters sc JOIN persons p ON p.person_id = sc.person_id`
        )
        .all() as { scene_id: string; person_id: string; display_name: string }[]
    ).map((row) => ({ sceneId: row.scene_id, personId: row.person_id, personName: row.display_name })),
    membership: (
      db.prepare('SELECT group_id, person_id FROM character_affiliations').all() as {
        group_id: string;
        person_id: string;
      }[]
    ).map((row) => ({ groupId: row.group_id, personId: row.person_id })),
  };
}
