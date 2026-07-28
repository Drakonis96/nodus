// Read the scene and say which of its declared beats are actually on the page.
//
// The third and last model call of the worldbuilding vault, and the one A9 turned down for
// lack of an input: back then its source was `world_scenes.summary`, which is NULLABLE and
// empty most of the time in a real vault. The manuscript created the input.
//
// It never rewrites and never judges the prose. The beats are the author's own statement of
// what this scene has to do; the model only reads and reports. Anything more would be a
// model with opinions about somebody else's novel.

import { completeText } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import { getSceneText } from '../db/worldManuscriptRepo';
import { beatsForScene } from '../db/worldThreadsRepo';
import { getDb } from '../db/database';
import {
  WORLD_PROSE_REVIEW_SYSTEM,
  composeProseReviewContext,
  hasProseReviewMaterial,
  parseProseReview,
  type ProseReviewSources,
} from '@shared/worldProseReview';
import { BEAT_MARK_LABEL, THREAD_KIND_LABEL } from '@shared/worldThreads';
import type { BeatThreadKind } from '@shared/types';
import { stripWorldLinks } from '@shared/worldManuscript';
import type { ProseReviewResult } from '@shared/types';

/** A beat hangs off a rule as well as off a thread, and `THREAD_KIND_LABEL` only knows the
 *  two kinds of thread. Naming the third here beats widening a vocabulary that is correct. */
function kindLabel(kind: BeatThreadKind): string {
  return kind === 'rule' ? 'regla' : (THREAD_KIND_LABEL[kind] ?? kind);
}

export async function reviewWorldProse(sceneId: string): Promise<ProseReviewResult> {
  const scene = getDb().prepare('SELECT title FROM world_scenes WHERE scene_id = ?').get(sceneId) as
    | { title: string }
    | undefined;
  if (!scene) throw new Error('Escena no encontrada.');

  const beats = beatsForScene(sceneId);
  const sources: ProseReviewSources = {
    sceneTitle: scene.title,
    beats: beats.map((beat) => ({
      threadLabel: `${kindLabel(beat.threadKind)}: ${beat.threadTitle}`,
      mark: BEAT_MARK_LABEL[beat.mark] ?? beat.mark,
      text: beat.text,
    })),
    // The model reads what a reader would read, so the internal links go out first: a
    // `nodus://` URL mid-sentence is noise it would try to interpret.
    prose: stripWorldLinks(getSceneText(sceneId).text),
  };

  if (!hasProseReviewMaterial(sources)) return { beats: [], noMaterial: true };

  const settings = getSettings();
  const model = settings.synthesisModel ?? settings.extractionModel ?? null;
  const completion = await completeText(
    {
      system: WORLD_PROSE_REVIEW_SYSTEM,
      user: composeProseReviewContext(sources),
      // Cold. This is a reading, not a piece of writing: everything true in the answer is
      // already on the page.
      temperature: 0.2,
      maxTokens: 600,
    },
    model
  );

  // Zipped by POSITION, and short-circuited when the model returned fewer lines than beats:
  // a beat with no verdict comes back as unread rather than as a guess. Telling an author
  // that something is on the page when nobody checked is the one failure this exists to
  // avoid.
  const verdicts = parseProseReview(completion);
  return {
    beats: beats.map((beat, index) => ({
      threadKind: beat.threadKind,
      threadId: beat.threadId,
      threadTitle: beat.threadTitle,
      mark: BEAT_MARK_LABEL[beat.mark] ?? beat.mark,
      present: verdicts[index]?.present ?? null,
      note: verdicts[index]?.note ?? null,
    })),
    noMaterial: false,
  };
}
