/**
 * Which figures of the student's materials a guide shows. The model never sees
 * images (DeepSeek Flash has no vision); the choice comes from text signals the
 * extraction already anchored: an item of type `figure` (a caption or an explicit
 * reference such as "Figura 3.2") names the page or slide, and image materials are
 * figures in their own right. Caps keep the guide readable.
 */
import type { CompleteGuideItem } from './items';
import type { CompleteGuidePassage, CompleteGuideSnapshotSource } from './snapshot';
import { citationUrl } from './locators';

export interface CompleteGuideFigureRequest {
  itemId: string;
  sourceKey: string;
  materialId: string;
  caption: string;
  /** 1-based page (PDF) or slide (PPTX); null for image materials and unpaged text. */
  page: number | null;
  slide: number | null;
  unitKey: string;
  /** Citation link to the page/slide the figure comes from. */
  source: string;
}

export interface CompleteGuideFigure {
  itemId: string;
  caption: string;
  /** PNG, base64 (no data: prefix). */
  png: string;
  width: number;
  height: number;
  /** A citation link to where the figure is in the material. */
  source: string;
  wholePage: boolean;
}

export const COMPLETE_GUIDE_FIGURES_PER_CHAPTER = 3;
export const COMPLETE_GUIDE_FIGURES_TOTAL = 24;

export function selectFigureRequests(
  items: CompleteGuideItem[],
  passages: ReadonlyMap<string, CompleteGuidePassage>,
  sources: ReadonlyMap<string, CompleteGuideSnapshotSource>,
  limits = { perChapter: COMPLETE_GUIDE_FIGURES_PER_CHAPTER, total: COMPLETE_GUIDE_FIGURES_TOTAL },
): CompleteGuideFigureRequest[] {
  const requests: CompleteGuideFigureRequest[] = [];
  const perChapter = new Map<string, number>();
  const seen = new Set<string>();
  const rank = (item: CompleteGuideItem) => (item.importance === 'core' ? 0 : item.importance === 'support' ? 1 : 2);
  const candidates = items
    .filter((item) => item.type === 'figure' && item.importance !== 'detail')
    .sort((a, b) => rank(a) - rank(b) || a.order - b.order);
  for (const item of candidates) {
    if (requests.length >= limits.total) break;
    if ((perChapter.get(item.unitKey) ?? 0) >= limits.perChapter) continue;
    const evidence = item.evidence[0];
    const passage = evidence ? passages.get(evidence.passageId) : undefined;
    const source = evidence ? sources.get(evidence.sourceKey) : undefined;
    if (!passage || !source || source.kind !== 'material') continue;
    const page = passage.locator.kind === 'page' ? passage.locator.page : null;
    const slide = passage.locator.kind === 'slide' ? passage.locator.slide : null;
    const key = `${source.sourceKey}|${page ?? ''}|${slide ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    perChapter.set(item.unitKey, (perChapter.get(item.unitKey) ?? 0) + 1);
    requests.push({ itemId: item.id, sourceKey: source.sourceKey, materialId: source.sourceId, caption: item.title || item.statement.slice(0, 120), page, slide, unitKey: item.unitKey, source: citationUrl(source, passage.locator, item.id) });
  }
  return requests.sort((a, b) => (items.find((item) => item.id === a.itemId)?.order ?? 0) - (items.find((item) => item.id === b.itemId)?.order ?? 0));
}

/**
 * The document block a figure belongs after: the first block citing its item, else
 * one citing another item from the same passage. Blocks are the document's
 * paragraphs as `documentBlocks` splits them.
 */
export function figureBlockId(
  blocks: Array<{ id: string; markdown: string }>,
  itemId: string,
  siblings: string[] = [],
): string | null {
  const cites = (block: { markdown: string }, id: string) => block.markdown.includes(`e=${id})`) || block.markdown.includes(`e=${id}&`);
  const isHeading = (block: { markdown: string }) => /^\s*#{1,6}\s+[^\n]+$/.test(block.markdown);
  const own = blocks.find((block) => !isHeading(block) && cites(block, itemId));
  if (own) return own.id;
  for (const sibling of siblings) {
    const block = blocks.find((candidate) => !isHeading(candidate) && cites(candidate, sibling));
    if (block) return block.id;
  }
  return null;
}
