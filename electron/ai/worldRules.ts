// Draft the statement of a law, and never anything else.
//
// This is a narrow drafting call. Every diagnostic in the "Analizar" group is arithmetic
// over what the author typed — a warning they cannot
// reproduce is a warning they learn to skip — so the model is not asked to audit, judge or
// find anything. It is asked for a first sentence to disagree with.
//
// The draft lands in `world_rules.proposed_text` and NEVER in `statement`. Accepting is a
// separate call the author makes, from a panel that shows the two side by side; the price
// and the limits are other fields and stay untouched, because the diagnostics ask a
// different question of each and a model that filled all three would be inventing two
// answers to buy one.

import { completeText } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import { getWorldRule, listWorldRules, setRuleProposedText } from '../db/worldRulesRepo';
import { listWorldBeats } from '../db/worldThreadsRepo';
import { listWorldGroups } from '../db/worldGroupsRepo';
import { listWorldPlaces } from '../db/worldPlacesRepo';
import { getWorldCalendar } from '../db/worldCalendarRepo';
import { listWorldEntries, worldBacklinks } from '../db/worldEncyclopediaRepo';
import {
  WORLD_RULE_SYSTEM,
  composeWorldRuleContext,
  hasWorldRuleMaterial,
  type WorldRuleSources,
  type WorldRuleTest,
} from '@shared/worldRuleContext';
import { withWorldPromptLanguage } from '@shared/worldPromptLanguage';
import { RULE_HARDNESS_HINT, RULE_HARDNESS_LABEL, RULE_SCOPE_LABEL } from '@shared/worldRules';
import { BEAT_MARK_LABEL } from '@shared/worldThreads';
import { WORLD_ENTRY_KIND_LABEL, entryKey } from '@shared/worldEncyclopedia';
import type { WorldRuleDraftResult } from '@shared/types';

/** Beyond this the prompt stops being how the story uses the law and becomes the story. */
const MAX_TESTS = 20;
const MAX_MENTIONS = 15;

export async function draftWorldRule(ruleId: string): Promise<WorldRuleDraftResult> {
  const rule = getWorldRule(ruleId);
  if (!rule) throw new Error('Regla no encontrada.');

  const scopeName =
    rule.scopeKind === 'group'
      ? (listWorldGroups().find((group) => group.groupId === rule.scopeId)?.name ?? null)
      : rule.scopeKind === 'place'
        ? (listWorldPlaces().find((place) => place.placeId === rule.scopeId)?.name ?? null)
        : null;

  const tests: WorldRuleTest[] = listWorldBeats()
    .filter((beat) => beat.threadKind === 'rule' && beat.threadId === ruleId)
    .sort((a, b) => a.narrativeOrder - b.narrativeOrder)
    .slice(0, MAX_TESTS)
    .map((beat) => ({
      mark: BEAT_MARK_LABEL[beat.mark] ?? beat.mark,
      sceneTitle: beat.sceneTitle,
      text: beat.text,
      subjectName: beat.subjectName,
      paid: beat.paid,
    }));

  const entries = new Map(listWorldEntries().map((entry) => [entry.key, entry]));
  const mentions = worldBacklinks({ kind: 'rule', id: ruleId })
    .map((link) => entries.get(entryKey(link.source)))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .slice(0, MAX_MENTIONS)
    .map((entry) => ({
      title: entry.title,
      kind: WORLD_ENTRY_KIND_LABEL[entry.kind],
      summary: entry.summary,
    }));

  // `getWorldCalendar()` always returns a shape, so emptiness is what decides whether the
  // model hears about a calendar at all: a vault without one must not be handed an empty
  // list of eras to interpret.
  const calendar = getWorldCalendar();
  const sources: WorldRuleSources = {
    title: rule.title,
    hardness: RULE_HARDNESS_LABEL[rule.hardness],
    hardnessHint: RULE_HARDNESS_HINT[rule.hardness],
    scope: scopeName ?? RULE_SCOPE_LABEL[rule.scopeKind] ?? RULE_SCOPE_LABEL.world,
    statement: rule.statement,
    cost: rule.cost,
    limits: rule.limits,
    exceptions: listWorldRules()
      .filter((other) => other.parentRuleId === ruleId)
      .map((other) => other.title),
    tests,
    mentions,
    calendar: calendar.eras.length ? { eras: calendar.eras.map((era) => era.name) } : null,
  };

  if (!hasWorldRuleMaterial(sources)) return { text: null, noMaterial: true };

  const settings = getSettings();
  const model = settings.synthesisModel ?? settings.extractionModel ?? null;
  const completion = await completeText(
    {
      system: withWorldPromptLanguage(WORLD_RULE_SYSTEM, settings.uiLanguage),
      user: composeWorldRuleContext(sources),
      // Warm: this is a sentence about an invented world, not a cautious reading of
      // records. Cold, the model returns the title back as a sentence.
      temperature: 0.8,
      maxTokens: 400,
    },
    model
  );

  const text = completion.trim() || null;
  setRuleProposedText(ruleId, text);
  return { text, noMaterial: false };
}
