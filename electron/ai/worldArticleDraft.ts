// Write or expand an encyclopedia article from the world around it.
//
// The quarantine here is STRICTER than the character biography's, and deliberately so.
// That one writes `persons.biography` directly in its faithful mode, because a biography
// is one field of a sheet the author is looking at. An article body is the whole entry:
// once accepted it is indistinguishable from something the author wrote, and there is no
// surrounding sheet to judge it against. So both modes land in `body_proposed` and need a
// click to become canon.
//
// The worldbuilding prompt pack (the author is the source of truth, pronouns verbatim, the
// invented calendar left alone) is applied automatically by the completion path.

import { completeText } from './aiClient';
import { getSettings } from '../db/settingsRepo';
import {
  getWorldArticle,
  getWorldEntry,
  listWorldEntries,
  setArticleProposedBody,
} from '../db/worldEncyclopediaRepo';
import { getWorldCalendar } from '../db/worldCalendarRepo';
import {
  WORLD_ARTICLE_EXPAND_SYSTEM,
  WORLD_ARTICLE_SYSTEM,
  composeWorldArticleContext,
  hasWorldArticleMaterial,
  type WorldArticleNeighbour,
  type WorldArticleSources,
} from '@shared/worldArticleContext';
import { ARTICLE_CATEGORY_LABEL, WORLD_ENTRY_KIND_LABEL, entryKey } from '@shared/worldEncyclopedia';
import type { WorldArticleDraftMode, WorldArticleDraftResult } from '@shared/types';

/** How many neighbours are worth sending. Beyond this the context stops being a
 *  neighbourhood and starts being the whole world, which is both expensive and vaguer. */
const MAX_NEIGHBOURS = 30;

export async function draftWorldArticle(
  articleId: string,
  mode: WorldArticleDraftMode = 'draft'
): Promise<WorldArticleDraftResult> {
  const article = getWorldArticle(articleId);
  if (!article) throw new Error('Artículo no encontrado.');

  const detail = getWorldEntry({ kind: 'article', id: articleId });
  const entries = new Map(listWorldEntries().map((entry) => [entry.key, entry]));

  const neighbours: WorldArticleNeighbour[] = [];
  const seen = new Set<string>();
  const add = (key: string, direction: 'outgoing' | 'incoming') => {
    const entry = entries.get(key);
    if (!entry || seen.has(key) || key === entryKey({ kind: 'article', id: articleId })) return;
    seen.add(key);
    neighbours.push({
      title: entry.title,
      kind: WORLD_ENTRY_KIND_LABEL[entry.kind],
      summary: entry.summary,
      direction,
    });
  };
  // Outgoing first: what the author chose to link is a stronger signal about what this
  // entry is than what happens to mention it.
  for (const link of detail?.links ?? []) if (link.target) add(entryKey(link.target), 'outgoing');
  for (const link of detail?.backlinks ?? []) add(entryKey(link.source), 'incoming');

  // `getWorldCalendar()` always returns a shape, so emptiness is what decides whether the
  // model is told about a calendar at all — a vault with none must not be handed an empty
  // list of months to interpret.
  const calendar = getWorldCalendar();
  const hasCalendar = calendar.eras.length > 0 || calendar.months.length > 0;
  const sources: WorldArticleSources = {
    title: article.title,
    category: ARTICLE_CATEGORY_LABEL[article.category] ?? article.category,
    aliases: (article.aka ?? '').split(/\r?\n/).map((name) => name.trim()).filter(Boolean),
    summary: article.summary,
    body: mode === 'expand' ? article.body : null,
    neighbours: neighbours.slice(0, MAX_NEIGHBOURS),
    calendar: hasCalendar
      ? { eras: calendar.eras.map((era) => era.name), months: calendar.months.map((month) => month.name) }
      : null,
  };

  if (!hasWorldArticleMaterial(sources)) return { body: null, noMaterial: true };

  const settings = getSettings();
  const model = settings.synthesisModel ?? settings.extractionModel ?? null;
  const text = await completeText(
    {
      system: mode === 'expand' ? WORLD_ARTICLE_EXPAND_SYSTEM : WORLD_ARTICLE_SYSTEM,
      user: composeWorldArticleContext(sources),
      // As warm as the character biography: this is prose about an invented thing, not a
      // cautious reading of records.
      temperature: 0.7,
      maxTokens: 1400,
    },
    model
  );
  const body = text.trim() || null;
  setArticleProposedBody(articleId, body);
  return { body, noMaterial: false };
}
