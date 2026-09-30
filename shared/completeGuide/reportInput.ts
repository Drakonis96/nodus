/**
 * A saved complete study guide as the professional Deep Research document: same
 * cover, contents and section rules, one numbered section per top-level part of the
 * guide (how to use it, syllabus map, each chapter, glossary, formula sheet, review
 * sheet, coverage, source index). Chapters and the review sheet start on a new page.
 */
import type { ProfessionalReportInput, ProfessionalReportSection, ProfessionalReportTheme } from '../professionalReport';
import { DEEP_LABELS } from '../deepResearchReport';
import { stripLeadingAbstract } from '../writingDocument';
import type { PromptLanguage, WritingWorkshopDraft } from '../types';
import { completeGuideLabels } from './labels';
import { GUIDE_PRINT_CSS, guideMarkdownToHtml, reviewSheetHtml } from './guideHtml';

export const STUDY_GUIDE_THEME: ProfessionalReportTheme = {
  accent: '#4338ca',
  accentDark: '#312e81',
  accentSoft: '#eef2ff',
  accentRgb: [67 / 255, 56 / 255, 202 / 255],
};

function localizedDate(iso: string, language: string): string {
  try {
    return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

/** Split the guide at its `## ` headings, keeping each part's Markdown. */
export function guideParts(markdown: string): Array<{ title: string; markdown: string }> {
  const parts: Array<{ title: string; markdown: string }> = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      if (current) parts.push({ title: current.title, markdown: current.lines.join('\n').trim() });
      current = { title: heading[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else if (line.trim()) {
      current = { title: '', lines: [line] };
    }
  }
  if (current) parts.push({ title: current.title, markdown: current.lines.join('\n').trim() });
  return parts.filter((part) => part.title || part.markdown);
}

export function completeGuideReportInput(
  draft: WritingWorkshopDraft,
  image: { dataUrl: string | null; credit: string | null } = { dataUrl: null, credit: null },
  /** Guide Markdown with figure lines already inserted, and their bytes by URL. */
  figures?: { markdown: string; resolve: (url: string) => string | null },
): ProfessionalReportInput {
  const language = (draft.brief.language ?? 'es') as PromptLanguage;
  const deep = DEEP_LABELS[language] ?? DEEP_LABELS.es;
  const labels = completeGuideLabels(language);
  // The parts that are not chapters. The last three titles are the ones older guides carry.
  const reference = new Set([labels.howToUse, labels.glossary, labels.formulaSheet, labels.timeline, labels.conflicts, labels.webSources, labels.sourcesAndCoverage, labels.syllabusMap, labels.coverage, labels.sourceIndex]);
  const body = figures?.markdown ?? stripLeadingAbstract(draft.draftMarkdown, draft.abstract);
  const sections: ProfessionalReportSection[] = guideParts(body).map((part, index) => {
    const rendered = guideMarkdownToHtml(part.markdown, `part-${index + 1}`, figures?.resolve);
    const chapter = !reference.has(part.title) && part.title !== labels.reviewSheet;
    return {
      id: `part-${index + 1}`,
      number: String(index + 1).padStart(2, '0'),
      title: part.title || draft.title,
      html: `${index === 0 ? `<style>${GUIDE_PRINT_CSS}</style>` : ''}<div class="prose guide-prose">${rendered.html}</div>`,
      ...(rendered.headings.length ? { tocChildren: rendered.headings } : {}),
      pageBreakBefore: index > 0 && (chapter || part.title === labels.reviewSheet || part.title === labels.glossary),
      className: chapter ? 'guide-chapter' : 'guide-reference',
    };
  });
  const words = draft.draftMarkdown.split(/\s+/).filter(Boolean).length;
  const guide = draft.completeGuide;
  return {
    title: draft.title,
    subtitle: draft.abstract || undefined,
    kindLabel: labels.guideTitle,
    language,
    generatedLabel: deep.generated,
    generatedAt: localizedDate(draft.generatedAt, language),
    ...(guide?.config.instructions ? { objectiveLabel: deep.objective, objective: guide.config.instructions } : {}),
    imageDataUrl: image.dataUrl,
    imageCredit: image.credit,
    contentsLabel: deep.contents,
    metrics: [
      // Topics (chapters), not parts: the contents lists every part, references included.
      { value: String(draft.outline.length), label: labels.units },
      { value: String(guide?.sources.length ?? draft.stats.selectedWorks), label: deep.sources },
      { value: words.toLocaleString(language), label: deep.words },
    ],
    sections,
    theme: STUDY_GUIDE_THEME,
  };
}

/** The review sheet on its own: compact, two columns, no cover. */
export function completeGuideReviewSheetHtml(draft: WritingWorkshopDraft): string | null {
  const markdown = draft.completeGuide?.cheatSheetMarkdown;
  if (!markdown) return null;
  const language = draft.brief.language ?? 'es';
  const labels = completeGuideLabels(language as PromptLanguage);
  return reviewSheetHtml({ title: `${labels.reviewSheet} · ${draft.title}`, subtitle: localizedDate(draft.generatedAt, language), markdown, language });
}

/** Markdown export: the guide as written (callouts, LaTeX, tables, labelled links). */
export function completeGuideMarkdown(draft: WritingWorkshopDraft): string {
  return [`# ${draft.title}`, '', draft.abstract, '', stripLeadingAbstract(draft.draftMarkdown, draft.abstract), ''].filter((line, index, list) => line || list[index - 1]).join('\n');
}
