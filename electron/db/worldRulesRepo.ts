// The hard laws of the world (schema v99).
//
// The rule itself is a small table; what makes this file worth reading is the CONTEXT it
// assembles for the checks: who was tested, which groups they belonged to at that moment,
// and which places contained the scene. That context is the difference between "somebody
// broke a law" and "somebody the law never reached broke it", and it is the only part a
// writer cannot reconstruct from memory.
//
// No cascades and no foreign keys, like everything else in this layer — the delete
// transaction below re-parents orphaned exceptions instead.

import { v4 as uuid } from 'uuid';
import { getDb } from './database';
import { entryKey, normalizeTitle, pendingKey } from '@shared/worldEncyclopedia';
import { indexEntryLinks, promoteWorldLinks } from './worldEncyclopediaRepo';
import { listWorldBeats } from './worldThreadsRepo';
import { checkRules, effectiveRules, toScope, type EffectiveRule, type RuleSubject } from '@shared/worldRules';
import type { RuleHardness, RuleStatus, WorldFinding, WorldRule, WorldRuleInput } from '@shared/types';

function now(): string {
  return new Date().toISOString();
}

interface RuleRow {
  rule_id: string;
  title: string;
  title_key: string;
  statement: string | null;
  cost: string | null;
  limits: string | null;
  hardness: string;
  parent_rule_id: string | null;
  article_id: string | null;
  scope_kind: string;
  scope_id: string | null;
  from_world_day: number | null;
  to_world_day: number | null;
  status: string;
  secret_id: string | null;
  proposed_text: string | null;
  proposed_at: string | null;
  created_at: string;
  updated_at: string;
}

const HARDNESS = new Set<RuleHardness>(['physical', 'costly', 'social']);
const STATUSES = new Set<RuleStatus>(['canon', 'tentative', 'retired']);

function rowToRule(row: RuleRow): WorldRule {
  return {
    ruleId: row.rule_id,
    title: row.title,
    titleKey: row.title_key,
    statement: row.statement,
    cost: row.cost,
    limits: row.limits,
    hardness: HARDNESS.has(row.hardness as RuleHardness) ? (row.hardness as RuleHardness) : 'costly',
    parentRuleId: row.parent_rule_id,
    articleId: row.article_id,
    scopeKind: row.scope_kind === 'group' ? 'group' : row.scope_kind === 'place' ? 'place' : 'world',
    scopeId: row.scope_id,
    fromWorldDay: row.from_world_day,
    toWorldDay: row.to_world_day,
    status: STATUSES.has(row.status as RuleStatus) ? (row.status as RuleStatus) : 'canon',
    secretId: row.secret_id,
    proposedText: row.proposed_text,
    proposedAt: row.proposed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listWorldRules(): WorldRule[] {
  return (getDb().prepare('SELECT * FROM world_rules ORDER BY title').all() as RuleRow[]).map(rowToRule);
}

export function getWorldRule(ruleId: string): WorldRule | null {
  const row = getDb().prepare('SELECT * FROM world_rules WHERE rule_id = ?').get(ruleId) as RuleRow | undefined;
  return row ? rowToRule(row) : null;
}

export function createWorldRule(input: WorldRuleInput): WorldRule {
  const title = (input.title ?? '').trim();
  if (!title) throw new Error('La regla necesita un título.');
  const id = `rul_${uuid()}`;
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO world_rules
         (rule_id, title, title_key, statement, cost, limits, hardness, parent_rule_id, article_id,
          scope_kind, scope_id, from_world_day, to_world_day, status, secret_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      title,
      normalizeTitle(title),
      input.statement ?? null,
      input.cost ?? null,
      input.limits ?? null,
      input.hardness ?? 'costly',
      input.parentRuleId ?? null,
      input.articleId ?? null,
      input.scopeKind ?? 'world',
      input.scopeId ?? null,
      input.fromWorldDay ?? null,
      input.toWorldDay ?? null,
      input.status ?? 'canon',
      input.secretId ?? null,
      ts,
      ts
    );
  indexEntryLinks({ kind: 'rule', id });
  return getWorldRule(id) as WorldRule;
}

export function updateWorldRule(ruleId: string, patch: WorldRuleInput): WorldRule {
  const current = getWorldRule(ruleId);
  if (!current) throw new Error('Regla no encontrada.');
  const title = patch.title !== undefined ? patch.title.trim() || current.title : current.title;
  const self = { kind: 'rule' as const, id: ruleId };
  // The statement, the price and the limits are prose like any other: typing `[[Kaelen]]`
  // and saving turns it into a real link, so a character's sheet knows which laws name it.
  const promote = (value: string | null | undefined, fallback: string | null) =>
    value !== undefined ? promoteWorldLinks(value, self).text : fallback;

  getDb()
    .prepare(
      `UPDATE world_rules SET title = ?, title_key = ?, statement = ?, cost = ?, limits = ?, hardness = ?,
          parent_rule_id = ?, scope_kind = ?, scope_id = ?, from_world_day = ?, to_world_day = ?,
          status = ?, secret_id = ?, updated_at = ? WHERE rule_id = ?`
    )
    .run(
      title,
      normalizeTitle(title),
      promote(patch.statement, current.statement),
      promote(patch.cost, current.cost),
      promote(patch.limits, current.limits),
      patch.hardness ?? current.hardness,
      patch.parentRuleId !== undefined ? patch.parentRuleId : current.parentRuleId,
      patch.scopeKind ?? current.scopeKind,
      patch.scopeId !== undefined ? patch.scopeId : current.scopeId,
      patch.fromWorldDay !== undefined ? patch.fromWorldDay : current.fromWorldDay,
      patch.toWorldDay !== undefined ? patch.toWorldDay : current.toWorldDay,
      patch.status ?? current.status,
      patch.secretId !== undefined ? patch.secretId : current.secretId,
      now(),
      ruleId
    );
  indexEntryLinks({ kind: 'rule', id: ruleId });
  return getWorldRule(ruleId) as WorldRule;
}

/**
 * Delete a rule and RE-PARENT its exceptions to their grandmother.
 *
 * Not cascade-delete: an exception is usually the best-written half of the section, and
 * dropping it silently because its mother was rewritten is the kind of loss a writer only
 * notices weeks later. Re-parenting to `null` makes it a law in its own right, which is
 * what it effectively becomes.
 */
export function deleteWorldRule(ruleId: string): void {
  const db = getDb();
  const rule = getWorldRule(ruleId);
  const run = db.transaction(() => {
    const grandmother = rule?.parentRuleId ?? null;
    db.prepare('UPDATE world_rules SET parent_rule_id = ? WHERE parent_rule_id = ?').run(grandmother, ruleId);
    db.prepare("DELETE FROM world_beats WHERE thread_kind = 'rule' AND thread_id = ?").run(ruleId);
    db.prepare("DELETE FROM world_links WHERE source_kind = 'rule' AND source_id = ?").run(ruleId);
    if (rule) {
      // Links pointing AT it degrade to unresolved rather than vanishing, so the author
      // sees in red what they just orphaned.
      db.prepare('UPDATE OR REPLACE world_links SET target_key = ? WHERE target_key = ?').run(
        pendingKey(rule.title),
        entryKey({ kind: 'rule', id: ruleId })
      );
    }
    db.prepare('DELETE FROM world_rules WHERE rule_id = ?').run(ruleId);
  });
  run();
}

/** Quarantined AI draft, exactly as `world_articles.body_proposed`. */
export function setRuleProposedText(ruleId: string, text: string | null): void {
  getDb()
    .prepare('UPDATE world_rules SET proposed_text = ?, proposed_at = ? WHERE rule_id = ?')
    .run(text, text ? now() : null, ruleId);
}

export function acceptRuleProposedText(ruleId: string): WorldRule {
  const current = getWorldRule(ruleId);
  if (!current) throw new Error('Regla no encontrada.');
  updateWorldRule(ruleId, { statement: current.proposedText ?? current.statement });
  getDb().prepare('UPDATE world_rules SET proposed_text = NULL, proposed_at = NULL WHERE rule_id = ?').run(ruleId);
  return getWorldRule(ruleId) as WorldRule;
}

// ── The context the checks need ──────────────────────────────────────────────

/** Every place that contains this one, itself included — so a kingdom law reaches a tavern. */
function placePath(placeId: string | null): string[] {
  if (!placeId) return [];
  const db = getDb();
  const path: string[] = [];
  const seen = new Set<string>();
  let current: string | null = placeId;
  while (current && !seen.has(current)) {
    seen.add(current);
    path.push(current);
    const row = db.prepare('SELECT parent_id FROM places WHERE place_id = ?').get(current) as
      | { parent_id: string | null }
      | undefined;
    current = row?.parent_id ?? null;
  }
  return path;
}

/**
 * Which groups somebody belonged to on a given day.
 *
 * AT THAT MOMENT, not now. "She could not have invoked it, she was not a Crow yet" is the
 * whole reason `character_affiliations` carries a window, and reading today's membership
 * would turn a correct scene into a warning every time somebody changes sides.
 */
function groupsAt(personId: string, worldDay: number | null): string[] {
  const rows = getDb()
    .prepare('SELECT group_id, from_world_day, to_world_day FROM character_affiliations WHERE person_id = ?')
    .all(personId) as { group_id: string; from_world_day: number | null; to_world_day: number | null }[];
  return rows
    .filter((row) => {
      if (worldDay == null) return true;
      if (row.from_world_day != null && worldDay < row.from_world_day) return false;
      if (row.to_world_day != null && worldDay > row.to_world_day) return false;
      return true;
    })
    .map((row) => row.group_id);
}

/**
 * The laws that reach somebody, somewhere, on a given day — and which exception bites each.
 *
 * Exported for the world chat, which must never ask a model «¿le alcanzaba esta ley?». That
 * question is arithmetic over a scope tree, a membership window and a validity range, and a
 * model gets it confidently wrong; this returns the answer as a fact instead.
 */
export function rulesReaching(
  subject: { personId: string | null; placeId: string | null },
  worldDay: number | null
): EffectiveRule[] {
  const groupIds = subject.personId ? groupsAt(subject.personId, worldDay) : [];
  return effectiveRules(
    listWorldRules().map(toScope),
    { personId: subject.personId, groupIds, placePath: placePath(subject.placeId) },
    worldDay
  );
}

export function ruleFindings(): WorldFinding[] {
  const db = getDb();
  const rules = listWorldRules();
  if (rules.length === 0) return [];

  const beats = listWorldBeats().filter((beat) => beat.threadKind === 'rule');
  const scenes = new Map(
    (db.prepare('SELECT scene_id, place_id, world_day FROM world_scenes').all() as {
      scene_id: string;
      place_id: string | null;
      world_day: number | null;
    }[]).map((row) => [row.scene_id, row])
  );

  const context = new Map<string, { subject: RuleSubject | null; worldDay: number | null }>();
  for (const beat of beats) {
    const scene = scenes.get(beat.sceneId);
    const worldDay = scene?.world_day ?? null;
    const subject: RuleSubject | null = beat.subjectId
      ? {
          personId: beat.subjectKind === 'character' ? beat.subjectId : null,
          groupIds:
            beat.subjectKind === 'character'
              ? groupsAt(beat.subjectId, worldDay)
              : [beat.subjectId],
          placePath: placePath(scene?.place_id ?? null),
        }
      : null;
    context.set(`${beat.threadId}:${beat.sceneId}`, { subject, worldDay });
  }

  const mentions = new Map<string, number>();
  for (const rule of rules) {
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM world_links WHERE target_key = ?')
      .get(entryKey({ kind: 'rule', id: rule.ruleId })) as { c: number };
    mentions.set(rule.ruleId, row.c);
  }

  const liveScopeIds = new Set<string>([
    ...(db.prepare('SELECT group_id FROM world_groups').all() as { group_id: string }[]).map((row) => row.group_id),
    ...(db.prepare('SELECT place_id FROM places').all() as { place_id: string }[]).map((row) => row.place_id),
  ]);

  return checkRules({ rules, beats, mentions, context, liveScopeIds });
}

/**
 * The rules a scene puts in play, prepopulated.
 *
 * From the link graph plus the scene's place: the laws this scene's text already mentions,
 * and the laws of where it happens. The author ANSWERS rather than adds, which is the
 * difference between a panel that gets used and one that gets skipped.
 */
export function rulesInPlay(sceneId: string): WorldRule[] {
  const db = getDb();
  const scene = db.prepare('SELECT place_id, world_day FROM world_scenes WHERE scene_id = ?').get(sceneId) as
    | { place_id: string | null; world_day: number | null }
    | undefined;
  if (!scene) return [];

  const mentioned = new Set(
    (
      db
        .prepare("SELECT target_key FROM world_links WHERE source_kind = 'scene' AND source_id = ?")
        .all(sceneId) as { target_key: string }[]
    )
      .map((row) => row.target_key)
      .filter((key) => key.startsWith('rule:'))
      .map((key) => key.slice('rule:'.length))
  );

  const path = new Set(placePath(scene.place_id));
  const cast = (
    db.prepare('SELECT person_id FROM scene_characters WHERE scene_id = ?').all(sceneId) as {
      person_id: string;
    }[]
  ).map((row) => row.person_id);
  const groups = new Set(cast.flatMap((personId) => groupsAt(personId, scene.world_day)));

  // A world-wide law is in play EVERYWHERE, by definition. An earlier version excluded it
  // whenever the scene had a place or a cast, which is precisely backwards: it hid the
  // laws of the world from every scene that happens somewhere.
  //
  // The ones the scene names, or that govern its place or its factions, come first —
  // ordering is what keeps this from reading as a wall of laws, not exclusion.
  const rank = (rule: WorldRule): number => {
    if (mentioned.has(rule.ruleId)) return 0;
    if (rule.scopeKind === 'place' && rule.scopeId && path.has(rule.scopeId)) return 1;
    if (rule.scopeKind === 'group' && rule.scopeId && groups.has(rule.scopeId)) return 1;
    return rule.scopeKind === 'world' ? 2 : 3;
  };

  return listWorldRules()
    .filter((rule) => rule.status !== 'retired' && rank(rule) < 3)
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}
