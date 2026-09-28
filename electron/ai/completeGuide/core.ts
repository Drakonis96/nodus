/**
 * Pure orchestrator of the complete study guide. Every model call, cache, checkpoint
 * and audit is injected, so the whole multi-pass flow runs in tests with a fake model.
 *
 *   0 snapshot (given) → 1 reconnaissance map per source → 2 chapters from the user's
 *   units → 3 exhaustive anchored extraction → 4 chapter plans with code-checked
 *   coverage → 5 section writing in typed blocks → 6 verification (KaTeX, numbers,
 *   premise audit) → 7 syllabus map, glossary, formula sheet, timeline, conflicts,
 *   review sheet, coverage and source index → assembled Markdown.
 */
import type { ResearchAuditSource } from '@shared/researchClaimAudit';
import type { PromptLanguage } from '@shared/types';
import type { StudySourceOrganization } from '@shared/studySourceTree';
import { studyOrganizationPaths } from '@shared/studySourceTree';
import type { CompleteGuideConfig } from '@shared/completeGuide/types';
import type { CompleteGuidePassage, CompleteGuideSnapshot, CompleteGuideSnapshotSource } from '@shared/completeGuide/snapshot';
import {
  anchorRawItem,
  finalizeItems,
  looksDense,
  mergeNearDuplicates,
  normalizeRawItem,
  validExtractionResult,
  type CompleteGuideItem,
  type PendingItem,
} from '@shared/completeGuide/items';
import { completeGuideLabels, type CompleteGuideLabels } from '@shared/completeGuide/labels';
import { citationLink, locatorLabel, readMoreRanges } from '@shared/completeGuide/locators';
import {
  coveredItemIds,
  normalizeWrittenBlocks,
  renderBlock,
  validWrittenBlocks,
  type CompleteGuideBlock,
} from '@shared/completeGuide/blocks';
import { normalizeChapterPlan, validChapterPlan, type CompleteGuideChapterPlan, type CompleteGuideSectionPlan } from '@shared/completeGuide/plan';
import { invalidMath, latexError, neutralizeInvalidMath } from '@shared/completeGuide/math';
import {
  renderCheatSheet,
  renderCoverage,
  renderFormulaSheet,
  renderGlossary,
  renderSourceIndex,
  renderTimeline,
  validCheatSheetSelection,
  type SourceCoverage,
} from '@shared/completeGuide/reference';
import type { CompleteGuideStage } from '@shared/completeGuide/estimate';
import {
  CHEAT_SYSTEM,
  CONTINUE_SYSTEM,
  EXTRACT_SYSTEM,
  MAP_SYSTEM,
  PLAN_SYSTEM,
  RECON_SYSTEM,
  RECOVER_SYSTEM,
  REPAIR_LATEX_SYSTEM,
  REVISE_SYSTEM,
  WRITE_SYSTEM,
} from './prompts';

export interface GuideCall<T> {
  stage: CompleteGuideStage;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  validate: (value: unknown) => value is T;
  /** Mechanical passes (reading, audit, repair) run at standard reasoning and without skills. */
  mechanical?: boolean;
}

export interface CompleteGuideProgress {
  stage: 'recon' | 'extract' | 'plan' | 'write' | 'verify' | 'finalize';
  done: number;
  total: number;
  detail?: string;
}

export interface CompleteGuideDeps {
  json<T>(call: GuideCall<T>): Promise<T>;
  /** Vectors for semantic deduplication; null entries are skipped. */
  embed?(texts: string[]): Promise<Array<number[] | null>>;
  /** Premise-based support audit; returns the text with unsupported sentences removed. */
  audit?(markdown: string, sources: ResearchAuditSource[]): Promise<{ markdown: string; removed: number }>;
  conflicts?(statements: string[]): Promise<Array<{ a: number; b: number; reason: string }>>;
  cacheGet<T>(key: string): T | null;
  cachePut(key: string, stage: string, value: unknown): void;
  checkpointGet<T>(stage: string, unit: string): T | null;
  checkpointPut(stage: string, unit: string, value: unknown): void;
  hash(value: string): string;
  progress?(event: CompleteGuideProgress): void;
  /** Throws (e.g. budget exhausted, cancelled) to stop cleanly between calls. */
  checkpoint?(): void;
}

export interface CompleteGuideInput {
  config: CompleteGuideConfig;
  snapshot: CompleteGuideSnapshot;
  organization: StudySourceOrganization;
  language: PromptLanguage;
  /** Provider/model identity used in cache keys. */
  modelKey: string;
  promptVersion: string;
  /** Composed student instructions (already bounded). */
  instructions: string;
  windows?: { reconChars: number; extractChars: number };
  concurrency?: { read: number; write: number; verify: number };
}

export interface CompleteGuideChapterResult {
  unitKey: string;
  title: string;
  overview: string;
  sections: Array<{ id: string; title: string; purpose: string; blocks: CompleteGuideBlock[] }>;
}

export interface CompleteGuideResult {
  title: string;
  abstract: string;
  markdown: string;
  cheatSheetMarkdown: string;
  chapters: CompleteGuideChapterResult[];
  items: CompleteGuideItem[];
  bibliography: string[];
  limitations: string[];
  coverage: SourceCoverage[];
  counts: {
    windows: number; failedWindows: number; items: number; itemsUsed: number; blocks: number; aiBlocks: number;
    droppedUnsupported: number; auditedBlocks: number; removedSentences: number; repairedBlocks: number;
    invalidLatex: number; conflicts: number; cacheHits: number;
  };
  syllabus: { overview: string; connections: Array<{ from: string; to: string; relation: string }> };
  warnings: string[];
}

const DEFAULT_WINDOWS = { reconChars: 60_000, extractChars: 22_000 };
const DEFAULT_CONCURRENCY = { read: 4, write: 3, verify: 4 };
const MAX_FAILED_WINDOW_SHARE = 0.1;

/** Bounded, fail-soft concurrency: one failing task never cancels its siblings. */
export async function settlePool<T, R>(tasks: T[], limit: number, run: (task: T, index: number) => Promise<R>): Promise<Array<{ ok: true; value: R } | { ok: false; error: unknown }>> {
  const results: Array<{ ok: true; value: R } | { ok: false; error: unknown }> = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      try { results[index] = { ok: true, value: await run(tasks[index], index) }; } catch (error) { results[index] = { ok: false, error }; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
  return results;
}

function isAbort(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && ((error as { name?: string }).name === 'AbortError' || (error as { code?: string }).code === 'budget_exhausted'));
}

/** Consecutive passages of one source, cut at `maxChars`. */
export function readingWindows(passages: CompleteGuidePassage[], maxChars: number): CompleteGuidePassage[][] {
  const windows: CompleteGuidePassage[][] = [];
  let current: CompleteGuidePassage[] = [];
  let size = 0;
  for (const passage of passages) {
    if (current.length && size + passage.chars > maxChars) { windows.push(current); current = []; size = 0; }
    current.push(passage);
    size += passage.chars;
  }
  if (current.length) windows.push(current);
  return windows;
}

interface ReconMap { outline: Array<{ title: string; firstPassage: string; lastPassage: string; summary: string }>; keyTerms: string[] }

function validRecon(value: unknown): value is ReconMap {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as ReconMap).outline));
}

function passagePayload(passages: CompleteGuidePassage[], labels: CompleteGuideLabels) {
  return passages.map((passage) => ({ id: passage.id, location: locatorLabel(passage.locator, labels), text: passage.text }));
}

export async function runCompleteGuide(input: CompleteGuideInput, deps: CompleteGuideDeps): Promise<CompleteGuideResult> {
  const { config, snapshot, language } = input;
  const labels = completeGuideLabels(language);
  const windowsConfig = input.windows ?? DEFAULT_WINDOWS;
  const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY;
  const warnings: string[] = [];
  const counts: CompleteGuideResult['counts'] = {
    windows: 0, failedWindows: 0, items: 0, itemsUsed: 0, blocks: 0, aiBlocks: 0, droppedUnsupported: 0,
    auditedBlocks: 0, removedSentences: 0, repairedBlocks: 0, invalidLatex: 0, conflicts: 0, cacheHits: 0,
  };
  const guard = () => deps.checkpoint?.();
  const sourcesByKey = new Map(snapshot.sources.map((source) => [source.sourceKey, source]));
  const passagesById = new Map(snapshot.passages.map((passage) => [passage.id, passage]));
  const passageOrder = new Map(snapshot.passages.map((passage, index) => [passage.id, index]));
  const readable = snapshot.passages.filter((passage) => !passage.duplicateOf);
  const cacheKey = (stage: string, parts: string[]) => deps.hash([stage, input.promptVersion, input.modelKey, language, ...parts].join('\0'));
  const cached = <T>(key: string): T | null => {
    if (config.rereadAll) return null;
    const value = deps.cacheGet<T>(key);
    if (value) counts.cacheHits += 1;
    return value;
  };

  // ── Chapters: the user's units, in their organization order ───────────────────
  const paths = studyOrganizationPaths(input.organization);
  const topics = new Map(input.organization.topics.map((topic) => [topic.id, topic]));
  const folders = new Map(input.organization.folders.map((folder) => [folder.id, folder]));
  const subjects = new Map(input.organization.subjects.map((subject) => [subject.id, subject]));
  const unitOfSource = new Map<string, string>();
  const chapterTitles = new Map<string, string>();
  for (const source of snapshot.sources) {
    const scope = source.placement;
    const unitKey = scope.topicId ? `topic:${scope.topicId}` : scope.folderId ? `folder:${scope.folderId}` : scope.subjectId ? `subject:${scope.subjectId}` : 'root';
    unitOfSource.set(source.sourceKey, unitKey);
    if (!chapterTitles.has(unitKey)) {
      const topicChain: string[] = [];
      let topic = scope.topicId ? topics.get(scope.topicId) : undefined;
      const seen = new Set<string>();
      while (topic && !seen.has(topic.id)) { seen.add(topic.id); topicChain.unshift(topic.name); topic = topic.parentId ? topics.get(topic.parentId) : undefined; }
      const title = topicChain.join(' · ')
        || (scope.folderId ? folders.get(scope.folderId)?.name : undefined)
        || (scope.subjectId ? subjects.get(scope.subjectId)?.name : undefined)
        || paths.label(scope)
        || source.title;
      chapterTitles.set(unitKey, title);
    }
  }
  const unitOrder = [...new Set(snapshot.sources.map((source) => unitOfSource.get(source.sourceKey)!))];

  // ── Pass 1: reconnaissance map of every source ─────────────────────────────────
  const reconBySource = new Map<string, ReconMap>();
  const reconTasks = snapshot.sources.flatMap((source) => {
    const sourcePassages = readable.filter((passage) => passage.sourceKey === source.sourceKey);
    return readingWindows(sourcePassages, windowsConfig.reconChars).map((window) => ({ source, window }));
  });
  let reconDone = 0;
  const reconResults = await settlePool(reconTasks, concurrency.read, async ({ source, window }) => {
    guard();
    const key = cacheKey('recon', window.map((passage) => passage.contentHash));
    const hit = cached<ReconMap>(key);
    const result = hit ?? await deps.json<ReconMap>({
      stage: 'recon', system: RECON_SYSTEM, mechanical: true, maxTokens: 4_000, temperature: 0.1, validate: validRecon,
      user: JSON.stringify({ source: { title: source.title, kind: source.kind }, passages: passagePayload(window, labels) }),
    });
    if (!hit) deps.cachePut(key, 'recon', result);
    deps.progress?.({ stage: 'recon', done: ++reconDone, total: reconTasks.length, detail: source.title });
    return { source, result };
  });
  for (const settled of reconResults) {
    if (!settled.ok) { if (isAbort(settled.error)) throw settled.error; continue; }
    const { source, result } = settled.value;
    const current = reconBySource.get(source.sourceKey) ?? { outline: [], keyTerms: [] };
    current.outline.push(...result.outline.filter((entry) => entry && typeof entry.title === 'string'));
    current.keyTerms.push(...(Array.isArray(result.keyTerms) ? result.keyTerms.filter((term) => typeof term === 'string') : []));
    reconBySource.set(source.sourceKey, current);
  }

  // ── Pass 3: exhaustive, anchored extraction ────────────────────────────────────
  interface StoredItems { items: CompleteGuideItem[]; unread: Array<[string, { ranges: string[]; passages: number }]>; windows: number; failedWindows: number }
  const storedItems = deps.checkpointGet<StoredItems>('items', 'all');
  let items: CompleteGuideItem[];
  const unread = new Map<string, { ranges: string[]; passages: number }>();
  if (!storedItems) {
    const extractTasks = snapshot.sources.flatMap((source) => {
      const sourcePassages = readable.filter((passage) => passage.sourceKey === source.sourceKey);
      return readingWindows(sourcePassages, windowsConfig.extractChars).map((window) => ({ source, window }));
    });
    counts.windows = extractTasks.length;
    const extractOnce = async (source: CompleteGuideSnapshotSource, window: CompleteGuidePassage[], system: string, stage: string): Promise<unknown[]> => {
      const recon = reconBySource.get(source.sourceKey);
      const reconHash = deps.hash(JSON.stringify(recon?.outline.map((entry) => entry.title) ?? []));
      const key = cacheKey(stage, [reconHash, ...window.map((passage) => passage.contentHash)]);
      const hit = cached<{ items: unknown[] }>(key);
      if (hit) return hit.items;
      const call = (passages: CompleteGuidePassage[]) => deps.json<{ items: unknown[] }>({
        stage: 'extract', system, mechanical: true, maxTokens: 12_000, temperature: 0.1, validate: validExtractionResult,
        user: JSON.stringify({
          source: { title: source.title, kind: source.kind },
          ...(recon?.outline.length ? { sourceMap: recon.outline.map((entry) => entry.title).slice(0, 80) } : {}),
          passages: passagePayload(passages, labels),
        }),
      });
      // A window that overflows the output or the context is split, never truncated.
      const attempt = async (passages: CompleteGuidePassage[], depth: number): Promise<unknown[]> => {
        guard();
        try { return (await call(passages)).items; } catch (error) {
          if (isAbort(error) || passages.length < 2 || depth >= 2) throw error;
          const middle = Math.ceil(passages.length / 2);
          return [...await attempt(passages.slice(0, middle), depth + 1), ...await attempt(passages.slice(middle), depth + 1)];
        }
      };
      const result = await attempt(window, 0);
      deps.cachePut(key, stage, { items: result });
      return result;
    };
    let extractDone = 0;
    const extractResults = await settlePool(extractTasks, concurrency.read, async ({ source, window }) => {
      const pending: PendingItem[] = [];
      let position = 0;
      const accept = (rawItems: unknown[]) => {
        for (const raw of rawItems) {
          const item = normalizeRawItem(raw);
          if (!item) continue;
          const anchored = anchorRawItem(item, window);
          if (!anchored) continue;
          pending.push({ raw: item, passage: anchored.passage, anchor: anchored.anchor, reconstructed: anchored.reconstructed, position: position++ });
        }
      };
      accept(await extractOnce(source, window, EXTRACT_SYSTEM, 'extract'));
      // Candidate detector: dense passages that produced nothing get a second, focused read.
      const covered = new Set(pending.map((entry) => entry.passage.id));
      const missed = window.filter((passage) => !covered.has(passage.id) && looksDense(passage.text));
      if (missed.length) accept(await extractOnce(source, missed, RECOVER_SYSTEM, 'recover').catch((error) => { if (isAbort(error)) throw error; return []; }));
      deps.progress?.({ stage: 'extract', done: ++extractDone, total: extractTasks.length, detail: source.title });
      return pending;
    });
    const pendingAll: PendingItem[] = [];
    extractResults.forEach((settled, index) => {
      if (settled.ok) { pendingAll.push(...settled.value); return; }
      if (isAbort(settled.error)) throw settled.error;
      counts.failedWindows += 1;
      const { source, window } = extractTasks[index];
      const range = `${locatorLabel(window[0].locator, labels)}–${locatorLabel(window[window.length - 1].locator, labels)}`;
      const entry = unread.get(source.sourceKey) ?? { ranges: [], passages: 0 };
      unread.set(source.sourceKey, { ranges: [...entry.ranges, range], passages: entry.passages + window.length });
    });
    if (extractTasks.length && counts.failedWindows / extractTasks.length > MAX_FAILED_WINDOW_SHARE) {
      throw new Error(`No se pudieron leer ${counts.failedWindows} de ${extractTasks.length} partes de las fuentes. Vuelve a intentarlo: lo ya leído se reutilizará.`);
    }
    items = finalizeItems(pendingAll, passageOrder, unitOfSource);
    if (deps.embed && items.length > 1) {
      guard();
      const vectors = await deps.embed(items.map((item) => `${item.title}: ${item.statement}`)).catch(() => null);
      if (vectors?.length === items.length) items = mergeNearDuplicates(items, vectors).items;
    }
    deps.checkpointPut('items', 'all', { items, unread: [...unread.entries()], windows: counts.windows, failedWindows: counts.failedWindows });
  } else {
    const stored = storedItems;
    items = stored.items;
    for (const [key, ranges] of stored.unread ?? []) unread.set(key, ranges);
    counts.windows = stored.windows ?? 0;
    counts.failedWindows = stored.failedWindows ?? 0;
  }
  counts.items = items.length;
  const itemsById = new Map(items.map((item) => [item.id, item]));

  // ── Citations (code-built) ─────────────────────────────────────────────────────
  const citeCache = new Map<string, string[]>();
  const cite = (itemId: string): string[] => {
    const cachedLinks = citeCache.get(itemId);
    if (cachedLinks) return cachedLinks;
    const item = itemsById.get(itemId);
    const links = (item?.evidence ?? []).flatMap((evidence) => {
      const passage = passagesById.get(evidence.passageId);
      const source = sourcesByKey.get(evidence.sourceKey);
      return passage && source ? [citationLink(source, passage, labels, itemId)] : [];
    });
    const unique = [...new Set(links)];
    citeCache.set(itemId, unique);
    return unique;
  };

  // ── Pass 4: chapter plans ──────────────────────────────────────────────────────
  const chaptersWithItems = unitOrder.map((unitKey) => ({ unitKey, title: chapterTitles.get(unitKey) ?? unitKey, items: items.filter((item) => item.unitKey === unitKey) }));
  let planDone = 0;
  const plans: CompleteGuideChapterPlan[] = [];
  for (const chapter of chaptersWithItems) {
    guard();
    if (!chapter.items.length) {
      plans.push({ unitKey: chapter.unitKey, title: chapter.title, overview: '', sections: [] });
      continue;
    }
    const stored = deps.checkpointGet<CompleteGuideChapterPlan>('plan', chapter.unitKey);
    if (stored) { plans.push(stored); continue; }
    const recon = snapshot.sources.filter((source) => unitOfSource.get(source.sourceKey) === chapter.unitKey)
      .map((source) => ({ source: `${source.alias} ${source.title}`, outline: (reconBySource.get(source.sourceKey)?.outline ?? []).map((entry) => `${entry.title}: ${entry.summary}`).slice(0, 60) }));
    const raw = await deps.json<{ sections: unknown[] }>({
      stage: 'plan', system: PLAN_SYSTEM, maxTokens: 6_000, temperature: 0.15, validate: validChapterPlan,
      user: JSON.stringify({
        unit: chapter.title,
        sourceMaps: recon,
        items: chapter.items.map((item) => ({ id: item.id, type: item.type, title: item.title, importance: item.importance, statement: item.statement.slice(0, 160) })),
        ...(input.instructions ? { studentInstructions: input.instructions } : {}),
      }),
    }).catch((error) => { if (isAbort(error)) throw error; warnings.push(`plan:${chapter.unitKey}`); return { sections: [] }; });
    const plan = normalizeChapterPlan(raw, chapter);
    deps.checkpointPut('plan', chapter.unitKey, plan);
    plans.push(plan);
    deps.progress?.({ stage: 'plan', done: ++planDone, total: chaptersWithItems.length, detail: chapter.title });
  }

  // ── Pass 5 + 6: write and verify every section ─────────────────────────────────
  const sectionTasks = plans.flatMap((plan) => plan.sections.map((section, index) => ({ plan, section, index })));
  let writeDone = 0;
  const writeSection = async (plan: CompleteGuideChapterPlan, section: CompleteGuideSectionPlan, index: number): Promise<CompleteGuideBlock[]> => {
    const stored = deps.checkpointGet<CompleteGuideBlock[]>('section', section.id);
    if (stored) return stored;
    const sectionItems = section.itemIds.map((id) => itemsById.get(id)!).filter(Boolean);
    const validItemIds = new Set(sectionItems.map((item) => item.id));
    const evidencePassages = (list: CompleteGuideItem[]) => {
      const ids = [...new Set(list.flatMap((item) => item.evidence.map((evidence) => evidence.passageId)))].sort((a, b) => (passageOrder.get(a) ?? 0) - (passageOrder.get(b) ?? 0));
      let budget = 18_000;
      return ids.flatMap((id) => {
        const passage = passagesById.get(id);
        if (!passage || budget <= 0) return [];
        budget -= passage.chars;
        return [{ id, location: locatorLabel(passage.locator, labels), text: passage.text }];
      });
    };
    const itemPayload = (list: CompleteGuideItem[]) => list.map((item) => ({
      id: item.id, type: item.type, title: item.title, statement: item.statement, importance: item.importance,
      ...(item.latex ? { latex: item.latex } : {}), ...(item.variables ? { variables: item.variables } : {}),
      ...(item.conditions ? { conditions: item.conditions } : {}), ...(item.steps ? { steps: item.steps } : {}),
      ...(item.solution ? { solution: item.solution } : {}), ...(item.date ? { date: item.date } : {}),
      evidenceQuotes: item.evidence.map((evidence) => evidence.quote).filter(Boolean).slice(0, 3),
    }));
    const context = {
      guideUnit: plan.title,
      section: { title: section.title, purpose: section.purpose, position: `${index + 1}/${plan.sections.length}` },
      previousSection: plan.sections[index - 1]?.title ?? null,
      nextSection: plan.sections[index + 1]?.title ?? null,
      aiExamples: config.aiExamples,
      ...(input.instructions ? { studentInstructions: input.instructions } : {}),
    };
    guard();
    const first = await deps.json<{ blocks: unknown[] }>({
      stage: 'write', system: WRITE_SYSTEM, maxTokens: 12_000, temperature: 0.3, validate: validWrittenBlocks,
      user: JSON.stringify({ ...context, items: itemPayload(sectionItems), evidencePassages: evidencePassages(sectionItems) }),
    });
    const normalized = normalizeWrittenBlocks(first, { validItemIds, items: itemsById, aiExamples: config.aiExamples });
    const blocks = normalized.blocks;
    counts.droppedUnsupported += normalized.dropped.unsupported;
    // Coverage-driven continuation: re-prompt with the items still uncovered.
    for (let round = 0; round < 2; round += 1) {
      const covered = coveredItemIds(blocks);
      const missing = sectionItems.filter((item) => !covered.has(item.id) && item.importance !== 'detail');
      if (!missing.length) break;
      guard();
      const more = await deps.json<{ blocks: unknown[] }>({
        stage: 'write', system: CONTINUE_SYSTEM, maxTokens: 8_000, temperature: 0.3, validate: validWrittenBlocks,
        user: JSON.stringify({ ...context, writtenSoFar: blocks.map((block) => block.markdown || block.question || '').join('\n\n').slice(-6_000), items: itemPayload(missing), evidencePassages: evidencePassages(missing) }),
      }).catch((error) => { if (isAbort(error)) throw error; return { blocks: [] }; });
      const extra = normalizeWrittenBlocks(more, { validItemIds, items: itemsById, aiExamples: config.aiExamples });
      counts.droppedUnsupported += extra.dropped.unsupported;
      if (!extra.blocks.length) break;
      blocks.push(...extra.blocks);
    }
    // Nothing extracted is lost: whatever is still uncovered becomes a cited table.
    const covered = coveredItemIds(blocks);
    const leftover = sectionItems.filter((item) => !covered.has(item.id));
    if (leftover.length) {
      blocks.push({
        kind: 'table', provenance: 'derived', title: labels.additionalDetails, markdown: '', itemIds: leftover.map((item) => item.id), citationsInRows: true,
        table: { headers: [labels.term, labels.meaning, labels.source], rows: leftover.map((item) => [item.title.replace(/\|/g, '\\|'), `${item.latex ? `$${item.latex}$ — ` : ''}${item.statement}`.replace(/\|/g, '\\|'), cite(item.id).slice(0, 2).join('; ')]) },
      });
    }
    const verified = await verifySection(blocks, sectionItems);
    deps.checkpointPut('section', section.id, verified);
    deps.progress?.({ stage: 'write', done: ++writeDone, total: sectionTasks.length, detail: section.title });
    return verified;
  };

  const auditSources = (block: CompleteGuideBlock): ResearchAuditSource[] => block.itemIds.flatMap((id) => {
    const item = itemsById.get(id);
    if (!item) return [];
    const passages = item.evidence.map((evidence) => passagesById.get(evidence.passageId)?.text ?? '').join('\n').slice(0, 3_000);
    return [{ id, label: item.title, citation: cite(id)[0] ?? id, text: [item.statement, item.latex ? `LaTeX: ${item.latex}` : '', item.solution ?? '', ...(item.conditions ?? []), passages].filter(Boolean).join('\n') }];
  });

  const numbersSupported = (block: CompleteGuideBlock): boolean => {
    const text = [block.markdown, ...(block.table?.rows.flat() ?? [])].join(' ').replace(/\$[^$]*\$/g, ' ');
    const numbers = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
    if (!numbers.length) return true;
    const evidence = auditSources(block).map((source) => source.text).join(' ');
    return numbers.every((number) => evidence.includes(number) || evidence.includes(number.replace(',', '.')) || evidence.includes(number.replace('.', ',')));
  };

  const verifySection = async (blocks: CompleteGuideBlock[], sectionItems: CompleteGuideItem[]): Promise<CompleteGuideBlock[]> => {
    // KaTeX: collect failing formulas across the section and repair them in one call.
    const failing: Array<{ block: number; field: 'markdown' | 'answer' | 'question'; tex: string }> = [];
    blocks.forEach((block, index) => {
      for (const field of ['markdown', 'answer', 'question'] as const) {
        for (const span of invalidMath(block[field] ?? '')) failing.push({ block: index, field, tex: span.tex });
      }
    });
    if (failing.length) {
      counts.invalidLatex += failing.length;
      guard();
      const repair = await deps.json<{ fixes: Array<{ index: number; latex: string }> }>({
        stage: 'verify', system: REPAIR_LATEX_SYSTEM, mechanical: true, maxTokens: 3_000, temperature: 0,
        validate: (value): value is { fixes: Array<{ index: number; latex: string }> } => Boolean(value && Array.isArray((value as { fixes?: unknown }).fixes)),
        user: JSON.stringify({ formulas: failing.map((entry, index) => ({ index, latex: entry.tex, error: latexError(entry.tex) })) }),
      }).catch((error) => { if (isAbort(error)) throw error; return { fixes: [] }; });
      for (const fix of repair.fixes) {
        const target = failing[fix.index];
        if (!target || typeof fix.latex !== 'string' || latexError(fix.latex)) continue;
        const block = blocks[target.block];
        block[target.field] = (block[target.field] ?? '').split(target.tex).join(fix.latex);
      }
      for (const block of blocks) for (const field of ['markdown', 'answer', 'question'] as const) if (block[field]) block[field] = neutralizeInvalidMath(block[field]!).markdown;
    }
    // Premise audit: numbers that do not occur in the evidence always trigger it;
    // an exhaustive guide audits every block that claims to come from the materials.
    if (!deps.audit) return blocks;
    const targets = blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.provenance === 'materials' && block.markdown && (config.verification === 'exhaustive' || !numbersSupported(block)));
    await settlePool(targets, concurrency.verify, async ({ block }) => {
      guard();
      const sources = auditSources(block);
      const first = await deps.audit!(block.markdown, sources);
      counts.auditedBlocks += 1;
      block.audit = { checked: true, removedSentences: 0, repaired: false };
      if (!first.removed) return;
      // Repair before removal: rewrite the block from the evidence, then audit again.
      const revised = await deps.json<{ markdown: string }>({
        stage: 'verify', system: REVISE_SYSTEM, maxTokens: 4_000, temperature: 0.1,
        validate: (value): value is { markdown: string } => Boolean(value && typeof (value as { markdown?: unknown }).markdown === 'string'),
        user: JSON.stringify({ block: block.markdown, sources: sources.map((source) => ({ id: source.id, text: source.text })) }),
      }).catch(() => null);
      if (revised?.markdown) {
        const second = await deps.audit!(revised.markdown, sources);
        if (second.removed < first.removed) {
          block.markdown = second.markdown;
          block.audit = { checked: true, removedSentences: second.removed, repaired: true };
          counts.repairedBlocks += 1;
          counts.removedSentences += second.removed;
          return;
        }
      }
      block.markdown = first.markdown;
      block.audit = { checked: true, removedSentences: first.removed, repaired: false };
      counts.removedSentences += first.removed;
    });
    void sectionItems;
    // A block the audit emptied has nothing left to teach.
    return blocks.filter((block) => block.kind === 'selfcheck' || block.kind === 'table' || block.markdown.trim());
  };

  const written = await settlePool(sectionTasks, concurrency.write, ({ plan, section, index }) => writeSection(plan, section, index));
  const sectionBlocks = new Map<string, CompleteGuideBlock[]>();
  written.forEach((settled, index) => {
    const { section } = sectionTasks[index];
    if (settled.ok) { sectionBlocks.set(section.id, settled.value); return; }
    if (isAbort(settled.error)) throw settled.error;
    throw settled.error instanceof Error ? settled.error : new Error(String(settled.error));
  });

  // ── Pass 7: report-level synthesis ─────────────────────────────────────────────
  deps.progress?.({ stage: 'finalize', done: 0, total: 3 });
  const chapters: CompleteGuideChapterResult[] = plans.map((plan) => ({
    unitKey: plan.unitKey, title: plan.title, overview: plan.overview,
    sections: plan.sections.map((section) => ({ id: section.id, title: section.title, purpose: section.purpose, blocks: sectionBlocks.get(section.id) ?? [] })),
  }));
  let syllabus = deps.checkpointGet<CompleteGuideResult['syllabus']>('final', 'map');
  if (!syllabus) {
    guard();
    const raw = await deps.json<CompleteGuideResult['syllabus']>({
      stage: 'finalize', system: MAP_SYSTEM, maxTokens: 2_500, temperature: 0.2,
      validate: (value): value is CompleteGuideResult['syllabus'] => Boolean(value && typeof (value as { overview?: unknown }).overview === 'string'),
      user: JSON.stringify({ units: chapters.map((chapter) => ({ title: chapter.title, overview: chapter.overview || chapter.sections.map((section) => section.title).join('; ') })) }),
    }).catch((error) => { if (isAbort(error)) throw error; return { overview: '', connections: [] }; });
    const titles = new Set(chapters.map((chapter) => chapter.title));
    syllabus = {
      overview: raw.overview.trim(),
      connections: (Array.isArray(raw.connections) ? raw.connections : []).filter((edge) => edge && titles.has(edge.from) && titles.has(edge.to) && typeof edge.relation === 'string').slice(0, 20),
    };
    deps.checkpointPut('final', 'map', syllabus);
  }
  const cheat = new Map<string, Array<{ itemId: string; phrase: string }>>();
  for (const chapter of chaptersWithItems) {
    if (!chapter.items.length) continue;
    const stored = deps.checkpointGet<Array<{ itemId: string; phrase: string }>>('cheat', chapter.unitKey);
    if (stored) { cheat.set(chapter.unitKey, stored); continue; }
    guard();
    const candidates = chapter.items.filter((item) => item.importance !== 'detail').slice(0, 80);
    const raw = await deps.json<{ points: unknown[] }>({
      stage: 'finalize', system: CHEAT_SYSTEM, maxTokens: 2_500, temperature: 0.1, validate: validCheatSheetSelection,
      user: JSON.stringify({ unit: chapter.title, items: candidates.map((item) => ({ id: item.id, type: item.type, title: item.title, statement: item.statement.slice(0, 300), ...(item.latex ? { latex: item.latex } : {}) })) }),
    }).catch((error) => { if (isAbort(error)) throw error; return { points: [] }; });
    const valid = new Set(candidates.map((item) => item.id));
    const points = raw.points.flatMap((point) => {
      const entry = point as { itemId?: unknown; phrase?: unknown };
      const itemId = typeof entry?.itemId === 'string' ? entry.itemId.trim().toUpperCase() : '';
      return valid.has(itemId) ? [{ itemId, phrase: typeof entry.phrase === 'string' ? entry.phrase : '' }] : [];
    }).slice(0, 14);
    cheat.set(chapter.unitKey, points);
    deps.checkpointPut('cheat', chapter.unitKey, points);
  }
  deps.progress?.({ stage: 'finalize', done: 2, total: 3 });

  // Conflicts between sources on definitions and formulas.
  let conflictsMarkdown = '';
  if (deps.conflicts) {
    const candidates = items.filter((item) => (item.type === 'definition' || item.type === 'formula' || item.type === 'rule') && item.importance !== 'detail').slice(0, 80);
    const multiSource = new Set(candidates.map((item) => item.evidence[0]?.sourceKey)).size > 1;
    if (multiSource) {
      guard();
      const statements = candidates.map((item) => `${item.title}: ${item.statement}${item.latex ? ` [${item.latex}]` : ''}`);
      const pairs = await deps.conflicts(statements).catch((error) => { if (isAbort(error)) throw error; warnings.push('conflicts_unchecked'); return []; });
      const lines = pairs.flatMap((pair) => {
        const a = candidates[pair.a];
        const b = candidates[pair.b];
        if (!a || !b || a.evidence[0]?.sourceKey === b.evidence[0]?.sourceKey) return [];
        return [`- **${a.title}** (${cite(a.id).slice(0, 1).join('')}) / **${b.title}** (${cite(b.id).slice(0, 1).join('')}): ${pair.reason}`];
      });
      counts.conflicts = lines.length;
      conflictsMarkdown = lines.join('\n');
    }
  }

  // ── Assembly ───────────────────────────────────────────────────────────────────
  const usedItems = new Set<string>();
  const parts: string[] = [];
  parts.push(`## ${labels.howToUse}\n\n${labels.howToUseBody}`);
  if (syllabus.overview || syllabus.connections.length) {
    parts.push([`## ${labels.syllabusMap}`, syllabus.overview, syllabus.connections.map((edge) => `- **${edge.from}** → **${edge.to}**: ${edge.relation}`).join('\n')].filter(Boolean).join('\n\n'));
  }
  for (const chapter of chapters) {
    const chapterParts: string[] = [`## ${chapter.title}`];
    if (!chapter.sections.length) { chapterParts.push(`*${labels.unitNotCovered}*`); parts.push(chapterParts.join('\n\n')); continue; }
    if (chapter.overview) chapterParts.push(chapter.overview);
    const chapterItems = items.filter((item) => item.unitKey === chapter.unitKey);
    const essentials = chapterItems.filter((item) => item.importance === 'core').slice(0, 10);
    if (essentials.length) chapterParts.push(`**${labels.whatToKnow}**\n\n${essentials.map((item) => `- ${item.title}`).join('\n')}`);
    const answers: string[] = [];
    let selfCheckNumber = 0;
    for (const section of chapter.sections) {
      chapterParts.push(`### ${section.title}`);
      for (const block of section.blocks) {
        const rendered = renderBlock(block, { labels, cite }, block.kind === 'selfcheck' ? ++selfCheckNumber : undefined);
        chapterParts.push(rendered.markdown);
        if (rendered.answer) answers.push(rendered.answer);
        counts.blocks += 1;
        if (block.provenance === 'ai') counts.aiBlocks += 1;
        if (block.provenance !== 'ai') block.itemIds.forEach((id) => usedItems.add(id));
      }
    }
    if (answers.length) chapterParts.push(`**${labels.selfCheckAnswers}**\n\n${answers.join('\n\n')}`);
    const readMore = readMoreRanges(snapshot.sources, chapterItems.flatMap((item) => item.evidence.map((evidence) => passagesById.get(evidence.passageId)!).filter(Boolean)), labels);
    if (readMore.length) chapterParts.push(`**${labels.readMore}:** ${readMore.map(({ source, ranges }) => `${source.alias} — ${source.title} (${ranges})`).join(' · ')}`);
    parts.push(chapterParts.join('\n\n'));
  }
  const chapterItemGroups = chapters.map((chapter) => ({ title: chapter.title, items: items.filter((item) => item.unitKey === chapter.unitKey) }));
  const glossary = renderGlossary(items, cite, labels);
  if (glossary) parts.push(`## ${labels.glossary}\n\n${glossary}`);
  const formulas = renderFormulaSheet(chapterItemGroups, cite, labels);
  if (formulas) parts.push(`## ${labels.formulaSheet}\n\n${formulas}`);
  const timeline = renderTimeline(items, cite, labels);
  if (timeline) parts.push(`## ${labels.timeline}\n\n${timeline}`);
  if (conflictsMarkdown) parts.push(`## ${labels.conflicts}\n\n${conflictsMarkdown}`);
  const cheatSheet = renderCheatSheet(chaptersWithItems.map((chapter) => ({ title: chapter.title, items: chapter.items, points: cheat.get(chapter.unitKey) ?? [] })), cite, labels);
  if (cheatSheet) parts.push(`## ${labels.reviewSheet}\n\n${cheatSheet}`);
  counts.itemsUsed = usedItems.size;
  const coverage: SourceCoverage[] = snapshot.sources.map((source) => {
    const sourcePassages = snapshot.passages.filter((passage) => passage.sourceKey === source.sourceKey);
    const sourceItems = items.filter((item) => item.evidence.some((evidence) => evidence.sourceKey === source.sourceKey));
    const failed = unread.get(source.sourceKey);
    const unreadRanges = failed?.ranges ?? [];
    return {
      source,
      passagesTotal: sourcePassages.length,
      passagesRead: sourcePassages.length - (failed?.passages ?? 0),
      itemsExtracted: sourceItems.length,
      itemsUsed: sourceItems.filter((item) => usedItems.has(item.id)).length,
      duplicates: sourcePassages.filter((passage) => passage.duplicateOf).length,
      unreadRanges,
    };
  });
  parts.push(`## ${labels.coverage}\n\n${renderCoverage(coverage, labels)}`);
  const index = readMoreRanges(snapshot.sources, items.flatMap((item) => item.evidence.map((evidence) => passagesById.get(evidence.passageId)!).filter(Boolean)), labels);
  const indexed = new Set(index.map((entry) => entry.source.sourceKey));
  const sourceIndex = [...index, ...snapshot.sources.filter((source) => !indexed.has(source.sourceKey)).map((source) => ({ source, ranges: '' }))];
  parts.push(`## ${labels.sourceIndex}\n\n${renderSourceIndex(sourceIndex)}`);

  const limitations: string[] = [];
  for (const row of coverage) {
    if (row.source.pages?.empty.length) limitations.push(`${row.source.alias} ${row.source.title}: ${labels.pagesWithoutText}`);
    if (row.unreadRanges.length) limitations.push(`${row.source.alias} ${row.source.title}: ${labels.unreadParts} (${row.unreadRanges.join(', ')})`);
  }
  for (const chapter of chapters) if (!chapter.sections.length) limitations.push(`${chapter.title}: ${labels.unitNotCovered}`);
  const title = `${labels.guideTitle}: ${[...new Set(chapters.map((chapter) => chapter.title))].slice(0, 3).join(', ')}${chapters.length > 3 ? '…' : ''}`;
  deps.progress?.({ stage: 'finalize', done: 3, total: 3 });
  return {
    title,
    abstract: syllabus.overview,
    markdown: parts.join('\n\n'),
    cheatSheetMarkdown: cheatSheet ? `# ${labels.reviewSheet}\n\n${cheatSheet}` : '',
    chapters,
    items,
    bibliography: sourceIndex.map(({ source, ranges }) => `${source.alias} — ${source.title}${ranges ? ` (${ranges})` : ''}`),
    limitations,
    coverage,
    counts,
    syllabus,
    warnings,
  };
}
