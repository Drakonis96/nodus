/**
 * Chapter planning. The model proposes sections for a unit and assigns items; code
 * guarantees the contract: every item belongs to exactly one section, invented ids
 * are dropped, empty sections disappear and oversized ones are split, so nothing
 * the extraction found can silently fall out of the guide.
 */
import type { CompleteGuideItem } from './items';

export interface CompleteGuideSectionPlan {
  id: string;
  title: string;
  purpose: string;
  itemIds: string[];
}

export interface CompleteGuideChapterPlan {
  unitKey: string;
  title: string;
  overview: string;
  sections: CompleteGuideSectionPlan[];
}

export const COMPLETE_GUIDE_MAX_SECTION_ITEMS = 36;

export function validChapterPlan(value: unknown): value is { sections: unknown[] } {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as { sections?: unknown }).sections));
}

const clean = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function normalizeChapterPlan(
  raw: unknown,
  chapter: { unitKey: string; title: string; items: CompleteGuideItem[] },
  maxItems = COMPLETE_GUIDE_MAX_SECTION_ITEMS,
): CompleteGuideChapterPlan {
  const valid = new Set(chapter.items.map((item) => item.id));
  const taken = new Set<string>();
  const overview = raw && typeof raw === 'object' ? clean((raw as { overview?: unknown }).overview, 1_200) : '';
  const planned: CompleteGuideSectionPlan[] = [];
  for (const entry of validChapterPlan(raw) ? raw.sections : []) {
    if (!entry || typeof entry !== 'object') continue;
    const input = entry as Record<string, unknown>;
    const title = clean(input.title, 160);
    if (!title) continue;
    const itemIds: string[] = [];
    for (const id of (Array.isArray(input.itemIds) ? input.itemIds : []).map((value) => String(value).trim().toUpperCase())) {
      if (!valid.has(id) || taken.has(id)) continue;
      taken.add(id);
      itemIds.push(id);
    }
    planned.push({ id: '', title, purpose: clean(input.purpose, 400), itemIds });
  }
  if (!planned.length) planned.push({ id: '', title: chapter.title, purpose: '', itemIds: [] });
  assignMissingItems(planned, chapter.items, taken);
  const order = new Map(chapter.items.map((item) => [item.id, item.order]));
  const sections = planned
    .filter((section) => section.itemIds.length)
    .flatMap((section) => splitSection({ ...section, itemIds: [...section.itemIds].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)) }, maxItems));
  return {
    unitKey: chapter.unitKey,
    title: chapter.title,
    overview,
    sections: sections.map((section, index) => ({ ...section, id: `${chapter.unitKey}#${index + 1}` })),
  };
}

/** An unassigned item joins the section holding its nearest neighbour in reading order. */
export function assignMissingItems(sections: CompleteGuideSectionPlan[], items: CompleteGuideItem[], taken: Set<string>): void {
  const order = new Map(items.map((item) => [item.id, item.order]));
  for (const item of items) {
    if (taken.has(item.id)) continue;
    let best = sections[sections.length - 1];
    let distance = Number.POSITIVE_INFINITY;
    for (const section of sections) {
      for (const id of section.itemIds) {
        const gap = Math.abs((order.get(id) ?? 0) - item.order);
        if (gap < distance) { distance = gap; best = section; }
      }
    }
    best.itemIds.push(item.id);
    taken.add(item.id);
  }
}

function splitSection(section: CompleteGuideSectionPlan, maxItems: number): CompleteGuideSectionPlan[] {
  if (section.itemIds.length <= maxItems) return [section];
  const parts = Math.ceil(section.itemIds.length / maxItems);
  const size = Math.ceil(section.itemIds.length / parts);
  return Array.from({ length: parts }, (_, index) => ({
    ...section,
    title: `${section.title} (${index + 1}/${parts})`,
    itemIds: section.itemIds.slice(index * size, (index + 1) * size),
  }));
}
