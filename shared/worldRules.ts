/**
 * The hard laws of an invented world.
 *
 * A rule exists so that breaking it costs something. That sentence is the whole design:
 * every diagnostic in this file asks one question of every law — **is the price ever on
 * the page** — and the vocabulary, the scope and the exceptions are all in service of
 * answering it.
 *
 * Pure. The arithmetic that decides whether somebody could do something, there and then,
 * is the part that must be right, and it is checked without a database.
 */

import { fingerprintOf, type FindingSubject } from './worldFindings';
import type {
  RuleHardness,
  RuleStatus,
  WorldBeat,
  WorldFinding,
  WorldFindingText,
  WorldRule,
} from './types';

// ── Vocabulary ───────────────────────────────────────────────────────────────

export const RULE_HARDNESS: RuleHardness[] = ['physical', 'costly', 'social'];

/**
 * The contract with the reader, and the ONLY field that changes what a breach means.
 *
 * Three values because a writer picks one of three honestly; offered ten they pick at
 * random. Breaking a physical law is a continuity error, breaking a priced one without
 * paying is a cheat, and breaking a social one is a plot.
 */
export const RULE_HARDNESS_LABEL: Record<RuleHardness, string> = {
  physical: 'Imposible',
  costly: 'Tiene un precio',
  social: 'Está prohibido',
};

export const RULE_HARDNESS_HINT: Record<RuleHardness, string> = {
  physical: 'Aquí no puede pasar. Si pasa, es un error de continuidad.',
  costly: 'Puede pasar, pero cuesta algo. Si no se paga, es trampa.',
  social: 'Se puede, pero está prohibido. Romperlo es una trama.',
};

export const RULE_STATUSES: RuleStatus[] = ['canon', 'tentative', 'retired'];

export const RULE_STATUS_LABEL: Record<RuleStatus, string> = {
  canon: 'Es canon',
  tentative: 'Todavía lo estoy pensando',
  retired: 'Ya no rige',
};

export const RULE_SCOPE_LABEL: Record<string, string> = {
  world: 'Todo el mundo',
  group: 'Una facción',
  place: 'Un lugar',
};

/** What a law looks like from the outside, once its tests are counted. */
export type RuleHealth = 'untested' | 'working' | 'unpaid' | 'overrun';

export const RULE_HEALTH_LABEL: Record<RuleHealth, string> = {
  untested: 'Nunca se pone a prueba',
  working: 'Funciona',
  unpaid: 'Se rompe y no se paga',
  overrun: 'La excepción se la comió',
};

// ── Does it apply, here and now? ─────────────────────────────────────────────

export interface RuleSpan {
  fromWorldDay: number | null;
  toWorldDay: number | null;
  status: RuleStatus;
}

/**
 * Is this law in force on that day?
 *
 * A NULL day gets the benefit of the doubt. Most of a manuscript has no world day at all,
 * and treating "I don't know when" as "outside its validity" would silence every check on
 * every undated scene — which is most of them.
 */
export function ruleInForce(rule: RuleSpan, worldDay: number | null): boolean {
  if (rule.status === 'retired') return false;
  if (worldDay == null) return true;
  if (rule.fromWorldDay != null && worldDay < rule.fromWorldDay) return false;
  if (rule.toWorldDay != null && worldDay > rule.toWorldDay) return false;
  return true;
}

export interface RuleScope extends RuleSpan {
  ruleId: string;
  title: string;
  scopeKind: 'world' | 'group' | 'place';
  scopeId: string | null;
  parentRuleId: string | null;
}

export interface RuleSubject {
  personId: string | null;
  /** The groups they belonged to AT THAT MOMENT, not the ones they belong to now. */
  groupIds: string[];
  /** The place and every place that contains it, so a city law reaches its taverns. */
  placePath: string[];
}

export function ruleAppliesTo(rule: RuleScope, subject: RuleSubject, worldDay: number | null): boolean {
  if (!ruleInForce(rule, worldDay)) return false;
  if (rule.scopeKind === 'world') return true;
  if (!rule.scopeId) return false;
  if (rule.scopeKind === 'group') return subject.groupIds.includes(rule.scopeId);
  // A law of the kingdom reaches the tavern inside the city inside the kingdom, which is
  // why the caller passes the whole containment path and not just the place.
  return subject.placePath.includes(rule.scopeId);
}

export interface EffectiveRule {
  rule: RuleScope;
  /** The narrower rules that bite this one for this subject, right now. */
  overriddenBy: RuleScope[];
}

/**
 * "Could she do this, here, now?"
 *
 * The mother plus whichever exceptions actually reach this subject. An exception is a
 * NARROWER RULE hanging off its mother, so it can itself have an exception — and the
 * answer a writer wants is not "which rules exist" but "which one wins".
 */
export function effectiveRules(
  rules: RuleScope[],
  subject: RuleSubject,
  worldDay: number | null
): EffectiveRule[] {
  const applicable = rules.filter((rule) => ruleAppliesTo(rule, subject, worldDay));
  const applicableIds = new Set(applicable.map((rule) => rule.ruleId));

  return applicable
    // Only the top of each chain is listed. A child that reaches the subject is reported
    // as what bites its mother, not as a separate law — listing both would make one
    // situation look like two contradictory rules.
    .filter((rule) => !rule.parentRuleId || !applicableIds.has(rule.parentRuleId))
    .map((rule) => ({
      rule,
      overriddenBy: applicable.filter((other) => other.parentRuleId === rule.ruleId),
    }));
}

// ── Counting the tests ───────────────────────────────────────────────────────

export interface RuleTally {
  obeys: number;
  bends: number;
  breaks: number;
  establishes: number;
  /** Breaks the author explicitly marked as unpaid. NEVER the ones they never looked at. */
  unpaid: number;
  /** Breaks they have not judged yet — shown as work, never as an accusation. */
  unjudged: number;
  /** Story position of the first `establishes`, and of the first `breaks`. */
  firstEstablished: number | null;
  firstBroken: number | null;
  /** Tests that belong to this rule's exceptions rather than to it. */
  childTests: number;
  /** How many bodies mention it, from the link graph. */
  mentions: number;
}

export function ruleTally(beats: WorldBeat[], childBeats: WorldBeat[], mentions: number): RuleTally {
  const tally: RuleTally = {
    obeys: 0,
    bends: 0,
    breaks: 0,
    establishes: 0,
    unpaid: 0,
    unjudged: 0,
    firstEstablished: null,
    firstBroken: null,
    childTests: childBeats.length,
    mentions,
  };

  for (const beat of [...beats].sort((a, b) => a.narrativeOrder - b.narrativeOrder)) {
    if (beat.mark === 'obeys') tally.obeys += 1;
    else if (beat.mark === 'bends') tally.bends += 1;
    else if (beat.mark === 'establishes') {
      tally.establishes += 1;
      if (tally.firstEstablished === null) tally.firstEstablished = beat.narrativeOrder;
    } else if (beat.mark === 'breaks') {
      tally.breaks += 1;
      if (tally.firstBroken === null) tally.firstBroken = beat.narrativeOrder;
      // THREE STATES, and only the explicit zero is a problem. `null` means the author has
      // not looked yet; counting it as unpaid would make every freshly marked break an
      // accusation, and the section would be shouting from the first minute.
      if (beat.paid === false) tally.unpaid += 1;
      else if (beat.paid == null) tally.unjudged += 1;
    }
  }
  return tally;
}

export function ruleHealth(tally: RuleTally): RuleHealth {
  const tests = tally.obeys + tally.bends + tally.breaks + tally.establishes;
  if (tally.unpaid > 0) return 'unpaid';
  if (tests === 0) return 'untested';
  // A law whose exceptions are tested more than it is has stopped being the law.
  if (tally.childTests > tests) return 'overrun';
  return 'working';
}

// ── The findings ─────────────────────────────────────────────────────────────

export interface RuleCheckInput {
  rules: WorldRule[];
  /** Every beat of kind `rule`, with its scene position already joined. */
  beats: WorldBeat[];
  /** How many bodies mention each rule, keyed by rule id. */
  mentions: Map<string, number>;
  /** Which subject each beat was about, and where and when it happened. */
  context: Map<string, { subject: RuleSubject | null; worldDay: number | null }>;
  /** Scope ids that still exist, so a deleted faction shows up as an orphaned scope. */
  liveScopeIds: Set<string>;
}

/**
 * What is wrong with the laws.
 *
 * Produced here and merely displayed by Continuity, like `checkThreads`. Every one of them
 * is arithmetic over what the author typed: a warning they cannot reproduce is a warning
 * they learn to skip.
 */
export function checkRules(input: RuleCheckInput): (WorldFinding & { family: 'rule' })[] {
  const findings: (WorldFinding & { family: 'rule' })[] = [];
  const add = (
    checkId: string,
    severity: WorldFinding['severity'],
    headline: WorldFindingText,
    subjects: FindingSubject[],
    detail?: WorldFindingText
  ) => {
    findings.push({
      checkId,
      family: 'rule',
      severity,
      headline,
      detail: detail ?? null,
      subjects,
      fingerprint: fingerprintOf(checkId, subjects),
    });
  };

  const beatsByRule = new Map<string, WorldBeat[]>();
  for (const beat of input.beats) {
    if (beat.threadKind !== 'rule') continue;
    beatsByRule.set(beat.threadId, [...(beatsByRule.get(beat.threadId) ?? []), beat]);
  }
  const childrenOf = new Map<string, WorldRule[]>();
  for (const rule of input.rules) {
    if (!rule.parentRuleId) continue;
    childrenOf.set(rule.parentRuleId, [...(childrenOf.get(rule.parentRuleId) ?? []), rule]);
  }

  for (const rule of input.rules) {
    if (rule.status === 'retired') continue;
    const subject: FindingSubject = { kind: 'rule', id: rule.ruleId, title: rule.title };
    const beats = beatsByRule.get(rule.ruleId) ?? [];
    const childBeats = (childrenOf.get(rule.ruleId) ?? []).flatMap(
      (child) => beatsByRule.get(child.ruleId) ?? []
    );
    const tally = ruleTally(beats, childBeats, input.mentions.get(rule.ruleId) ?? 0);

    // Broken, and the author said the price is NOT on the page.
    if (tally.unpaid > 0) {
      add(
        'rule.unpaid',
        'warning',
        { key: '«{rule}» se rompe y no se paga', vars: { rule: rule.title } },
        [subject],
        {
          key: '{count} veces, marcadas por ti como que el precio no está en la página.',
          vars: { count: String(tally.unpaid) },
        }
      );
    }

    // Broken before the reader was ever told the law existed.
    if (
      tally.firstBroken !== null &&
      tally.firstEstablished !== null &&
      tally.firstBroken < tally.firstEstablished
    ) {
      add(
        'rule.brokenBeforeEstablished',
        'warning',
        { key: '«{rule}» se rompe antes de explicarse', vars: { rule: rule.title } },
        [subject],
        {
          key: 'Se rompe en la escena {broken} y no se establece hasta la {established}.',
          vars: { broken: String(tally.firstBroken + 1), established: String(tally.firstEstablished + 1) },
        }
      );
    }

    // Canon, never tested, never mentioned: a law nobody in the book has met.
    if (rule.status === 'canon' && tally.mentions === 0 && beats.length === 0) {
      add(
        'rule.dead',
        'gap',
        { key: '«{rule}» no aparece en ninguna parte', vars: { rule: rule.title } },
        [subject],
        { key: 'Ni una escena la pone a prueba, ni un texto la menciona.' }
      );
    }

    // The exception ate the rule.
    if (ruleHealth(tally) === 'overrun') {
      add(
        'rule.overrun',
        'warning',
        { key: 'Las excepciones de «{rule}» pesan más que la regla', vars: { rule: rule.title } },
        [subject],
        { key: 'Una regla con más excepciones que casos es una regla mal escrita.' }
      );
    }

    // A scope pointing at something that no longer exists.
    if (rule.scopeKind !== 'world' && rule.scopeId && !input.liveScopeIds.has(rule.scopeId)) {
      add(
        'rule.orphanScope',
        'warning',
        { key: '«{rule}» rige sobre algo que ya no existe', vars: { rule: rule.title } },
        [subject]
      );
    }

    // Somebody the law did not reach doing the thing anyway.
    for (const beat of beats) {
      if (beat.mark !== 'breaks' && beat.mark !== 'obeys') continue;
      const context = input.context.get(`${beat.threadId}:${beat.sceneId}`);
      if (!context?.subject || !beat.subjectName) continue;
      if (ruleAppliesTo(toScope(rule), context.subject, context.worldDay)) continue;
      add(
        'rule.appliedToOutsider',
        'warning',
        {
          key: '{person} pone a prueba «{rule}», que no le alcanzaba',
          vars: { person: beat.subjectName, rule: rule.title },
        },
        [subject, { kind: 'scene', id: beat.sceneId, title: beat.sceneTitle }],
        { key: 'Ni por el ámbito de la regla ni por su vigencia en ese momento.' }
      );
    }
  }

  return findings;
}

export function toScope(rule: WorldRule): RuleScope {
  return {
    ruleId: rule.ruleId,
    title: rule.title,
    scopeKind: rule.scopeKind,
    scopeId: rule.scopeId,
    parentRuleId: rule.parentRuleId,
    fromWorldDay: rule.fromWorldDay,
    toWorldDay: rule.toWorldDay,
    status: rule.status,
  };
}

/**
 * Suggestions for an empty section — TITLES ONLY, and written by the author's click.
 *
 * Deliberately not "seeds" that fill statement, cost and limits with Spanish prose. The
 * character archetype templates learned that the hard way: prefilled prose has to be
 * DELETED before it can be answered, and it lands in the database outside the reach of
 * i18n. These are `t()`-translated at the moment the author picks one, so what gets stored
 * is what they read and chose.
 */
export const RULE_SUGGESTIONS: string[] = [
  'La magia cobra un precio',
  'Nadie puede mentir bajo juramento',
  'Los muertos no vuelven',
  'El hierro frío corta lo que no es de este mundo',
  'Solo la sangre de la casa abre la puerta',
  'Cruzar la frontera exige un salvoconducto',
  'Un juramento roto marca a quien lo rompe',
  'Nadie recuerda lo que ocurre bajo la niebla',
];
