// Propose answers to something the author has not decided yet.
//
// Its quarantine is structural rather than a column: what comes back is stored as
// options with `origin='ai'`,
// and an option is not part of the world until the author chooses it and presses the button
// that names what it will write. So there is no accept step here — choosing is the accept
// step — and three proposals nobody picks cost one row each and change nothing.
//
// What makes the answers belong to THIS character rather than to a generic one is the
// context: the sheet's own prose, the line the hole sits in, what the author already wrote
// as options, and the scene this is holding up.

import { completeText } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import { blockedSceneFor, getWorldQuestion, setQuestionOption } from '../db/worldQuestionsRepo';
import { entryProse, linksFrom, listWorldEntries, worldBacklinks } from '../db/worldEncyclopediaRepo';
import {
  composeWorldQuestionContext,
  hasWorldQuestionMaterial,
  parseQuestionOptions,
  type WorldQuestionSources,
} from '@shared/worldQuestionContext';
import { worldOperationSystemPrompt } from '@shared/worldOperationPrompts';
import { findPlaceholders } from '@shared/worldQuestions';
import { entryKey } from '@shared/worldEncyclopedia';
import { worldEntryKindLabel, worldFieldLabel } from '@shared/worldPromptLanguage';
import type { WorldEntryKind, WorldQuestionOptionsResult } from '@shared/types';

/** Beyond this the neighbourhood stops being a neighbourhood and becomes the world. */
const MAX_NEIGHBOURS = 20;

export async function proposeQuestionOptions(questionId: string): Promise<WorldQuestionOptionsResult> {
  const question = getWorldQuestion(questionId);
  if (!question) throw new Error('Pregunta no encontrada.');
  const settings = getSettings();
  const language = settings.promptLanguage ?? 'es';

  const anchor =
    question.anchorKind && question.anchorId && question.anchorTitle
      ? { kind: question.anchorKind as WorldEntryKind, id: question.anchorId, title: question.anchorTitle }
      : null;

  const prose = anchor ? entryProse({ kind: anchor.kind, id: anchor.id }) : [];
  const anchorProse = prose.map((block) => ({
    field: worldFieldLabel(block.field, language),
    text: block.text,
  }));

  // The hole is read from the field it lives in rather than from the whole-world scan: this
  // needs one entry's prose, and the feed's scan reads every body in the vault.
  const evidence =
    anchor && question.anchorField
      ? (findPlaceholders(
          prose
            .filter((block) => block.field === question.anchorField)
            .map((block) => ({ kind: anchor.kind, id: anchor.id, title: anchor.title, field: block.field, text: block.text }))
        )[0]?.evidence ?? null)
      : null;

  const entries = new Map(listWorldEntries().map((entry) => [entry.key, entry]));
  const neighbours: WorldQuestionSources['neighbours'] = [];
  if (anchor) {
    const seen = new Set<string>([entryKey({ kind: anchor.kind, id: anchor.id })]);
    const add = (key: string) => {
      const entry = entries.get(key);
      if (!entry || seen.has(key)) return;
      seen.add(key);
      neighbours.push({ title: entry.title, kind: worldEntryKindLabel(entry.kind, language), summary: entry.summary });
    };
    // Outgoing first: what the sheet itself names is a stronger signal about what it is
    // than whatever happens to mention it.
    for (const link of linksFrom({ kind: anchor.kind, id: anchor.id })) if (link.target) add(entryKey(link.target));
    for (const link of worldBacklinks({ kind: anchor.kind, id: anchor.id })) add(entryKey(link.source));
  }

  const sources: WorldQuestionSources = {
    question: question.question,
    anchorTitle: anchor?.title ?? null,
    anchorKind: anchor ? worldEntryKindLabel(anchor.kind, language) : null,
    fieldLabel: question.anchorField
      ? worldFieldLabel(question.anchorField, language)
      : null,
    evidence,
    anchorProse,
    existing: question.options.map((option) => option.text),
    neighbours: neighbours.slice(0, MAX_NEIGHBOURS),
    blockedScene: blockedSceneFor(anchor)?.title ?? null,
  };

  if (!hasWorldQuestionMaterial(sources)) return { options: [], noMaterial: true };

  const model = settings.synthesisModel ?? settings.extractionModel ?? null;
  const completion = await completeText(
    {
      system: worldOperationSystemPrompt('questionOptions', settings.promptLanguage ?? 'es'),
      user: composeWorldQuestionContext(sources, language),
      plainContext: true,
      // The warmest call in the app, and deliberately so: three answers that differ only
      // in wording are not a decision, and a cold model writes exactly those.
      temperature: 0.9,
      maxTokens: 700,
    },
    model
  );

  const parsed = parseQuestionOptions(completion);
  // Nothing usable comes back as an empty list rather than as an exception. Saying "the
  // model returned nothing I can use" is honest; inventing a fallback option would put a
  // sentence nobody wrote one click away from somebody's manuscript.
  return {
    options: parsed.map((option) =>
      setQuestionOption({
        questionId,
        text: option.text,
        implications: option.implications,
        origin: 'ai',
      })
    ),
    noMaterial: false,
  };
}
