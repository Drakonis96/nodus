import path from 'node:path';
import { ipcMain, shell, BrowserWindow, dialog, app } from 'electron';
import type {
  AppSettings,
  AddProjectLinkInput,
  ApplyProjectSuggestionsRequest,
  AuthorSynthesisExportRequest,
  ChapterSuggestionStatus,
  QueueKind,
  WorkFilter,
  AiProvider,
  ModelRef,
  ZoteroItem,
  ResearchChatRequest,
  ReadingPathRequest,
  EmbeddingProvider,
  UpdateCheckResponse,
  ChatMessageRecord,
  ResearchContextSelection,
  ReprocessConnectionsOptions,
  TutorPlanRequest,
  TutorPlan,
  TutorRoute,
  TutorStepRequest,
  ArgumentMapRequest,
  WritingWorkshopBrief,
  WritingWorkshopDraftRequest,
  WritingWorkshopExportRequest,
  WritingWorkshopSaveDraftRequest,
  DeepResearchRequest,
  DebateAnalysisRequest,
  RqDecomposeRequest,
  RqMapRequest,
  RqUpdateSubQuestionsRequest,
  RqExportRequest,
  CreateNoteFolderInput,
  CreateNoteInput,
  UpdateNoteInput,
  ManualIdeaPayload,
  NotesExportOptions,
  CitationRef,
  SemanticSearchOptions,
  SaveSearchInput,
  AnalyzeChapterRelationsRequest,
  CreateProjectInput,
  ExportProjectChapterRequest,
  ExportProjectRequest,
  GenerateProjectSuggestionsRequest,
  ImportProjectChapterInput,
  UpdateProjectInput,
  UpdateProjectSectionInput,
  StudyPlanRequest,
  StudySessionRequest,
  StudyAnswerRequest,
} from '@shared/types';

// Mirrors MANUAL_IDEA_MARKER in shared/types.ts. Defined locally because the
// electron sub-build erases type-only @shared imports but cannot resolve the
// alias for a runtime value import.
const MANUAL_IDEA_MARKER = 'manual-idea';
import { getSettings, updateSettings } from './db/settingsRepo';
import { getMcpStatus, regenerateMcpToken, restartMcpServer, stopMcpServer } from './mcp';
import { getCopilotStatus, regenerateCopilotToken, restartCopilotServer, stopCopilotServer } from './copilot/server';
import { ensureCopilotCert } from './copilot/certs';
import { installCopilotAddin } from './copilot/install';
import { setApiKey, clearApiKey, getApiKey } from './secrets/secretStore';
import { listEmbeddingModels, listModels } from './ai/providers';
import * as zotero from './zotero/zoteroClient';
import * as works from './db/worksRepo';
import * as dedupe from './db/dedupeRepo';
import { listCollectionFacets } from './db/collectionsRepo';
import * as ideas from './db/ideasRepo';
import * as themes from './db/themesRepo';
import { aggregateGaps, getGapDetail } from './db/gapsRepo';
import { getSyncLog } from './db/syncRepo';
import { fullSync, ingestZoteroItem, startRealtimeSync, stopRealtimeSync } from './sync/syncService';
import { scanQueue } from './pipeline/scanQueue';
import { buildIdeaGraph, buildAuthorGraph, getContradictions, getDebates, buildReadingPath } from './graph/graphService';
import { streamDebateAnalysis } from './ai/debate';
import * as rqRepo from './db/researchMapRepo';
import { decomposeQuestion, mapCoverage } from './ai/researchMap';
import { exportResearchCoverage } from './export/researchMapExport';
import { exportData, importData } from './export/exportImport';
import { hasAnyData, seedDemoData, clearDemoData } from './db/demoData';
import { exportNotes } from './export/notesExport';
import { reorderNotesByAI } from './ai/notesOrder';
import { suggestFolderIdeas } from './ai/folderIdeaSuggestions';
import { verifyCitations } from './citations/verifyCitations';
import { globalSearch } from './db/searchRepo';
import { semanticSearch, findSimilarToIdea } from './ai/semanticSearch';
import { listSavedSearches, saveSearch, deleteSavedSearch } from './db/savedSearchesRepo';
import { getCorpusHealth } from './db/corpusHealthRepo';
import { analyzeChapterRelations, getChapterRelations, onChapterRelationsProgress } from './ai/chapterIdeas';
import { suggestGapSearch } from './ai/gapSearch';
import { extractFromPath } from './extraction/textExtractor';
import { runDeepScan } from './ai/deepScan';
import { summaryContentHash } from './ai/summaryScan';
import { answerResearchChat, generateChatTitle, streamResearchChat } from './ai/researchAssistant';
import { answerTutorStep, buildTutorPlan, streamTutorStep } from './ai/tutor';
import { buildArgumentMap, discoverArgumentRoutes } from './ai/argumentMap';
import { listAuthors, buildAuthorDossier, synthesizeAuthorDossier } from './ai/authorDossier';
import { buildSynthesisMatrix, synthesizeMatrixCell } from './ai/synthesisMatrix';
import { exportAuthorSyntheses } from './export/authorSynthesisExport';
import { buildStudyPlan, evaluateStudyAnswer, generateStudySession } from './ai/studyGuide';
import * as studyProgress from './db/studyProgressRepo';
import { buildWritingWorkshopSnapshot, generateWritingWorkshopDraft } from './ai/writingWorkshop';
import { generateDeepResearchReport } from './ai/deepResearch';
import { reprocessConnections } from './ai/reprocessConnections';
import { startEmbedding, reindexAll, pauseEmbedding, resumeEmbedding, stopEmbedding, clearEmbeddingProgress, getEmbeddingSnapshot, onEmbeddingProgress, getWorkEmbeddingStatuses } from './ai/embeddingPipeline';
import {
  startPassageEmbedding,
  pausePassageEmbedding,
  resumePassageEmbedding,
  stopPassageEmbedding,
  clearPassageProgress,
  getPassageSnapshot,
  onPassageProgress,
  getWorkPassageStatuses,
} from './ai/passageEmbeddingPipeline';
import { getPassageDetail } from './db/passagesRepo';
import { discoverSemanticBridges, isSemanticBridgeRunning, onSemanticBridgeProgress } from './ai/semanticBridges';
import * as chat from './db/chatRepo';
import * as notes from './db/notesRepo';
import * as manualIdeas from './db/manualIdeasRepo';
import * as tutorRoutes from './db/tutorRepo';
import * as writingDrafts from './db/writingDraftsRepo';
import * as workSummaries from './db/workSummariesRepo';
import * as projects from './db/projectsRepo';
import { getDb } from './db/database';
import { exportWritingWorkshopDraft } from './export/writingWorkshopExport';
import { generateProjectSuggestions } from './ai/projectInsertion';
import { exportProject, exportProjectChapter } from './export/projectExport';

/**
 * Queue the full analysis chain for one work: themes (if missing) → ideas, marked
 * with `chain: true` so the scan queue continues into summary, indexing (ideas +
 * passages) and semantic bridge discovery even when the auto-* settings are off.
 */
function processFullChain(nodusId: string, model?: ModelRef | null): void {
  const w = works.getWork(nodusId);
  if (!w) return;
  if (w.light_status !== 'done') {
    works.setLightPending(nodusId);
    scanQueue.enqueue(nodusId, w.title, 'light', model);
  }
  if (w.deep_status === 'done') ideas.purgeDeepData(nodusId);
  works.setManualDeep(nodusId, true);
  works.setDeepPending(nodusId);
  scanQueue.enqueue(nodusId, w.title, 'deep', model, { chain: true });
}

/** Register every IPC channel backing the window.nodus API. */
export function registerIpc(
  getWindow: () => BrowserWindow | null,
  checkForUpdates: () => Promise<UpdateCheckResponse>,
  installUpdate: () => Promise<UpdateCheckResponse>
): void {
  const h = ipcMain.handle.bind(ipcMain);

  // settings + secrets
  h('settings:get', async () => getSettings());
  h('settings:update', async (_e, patch: Partial<AppSettings>) => {
    const next = updateSettings(patch);
    if (patch.syncMode) {
      if (next.syncMode === 'realtime') startRealtimeSync();
      else stopRealtimeSync();
    }
    if (patch.mcpEnabled !== undefined || patch.mcpPort !== undefined || patch.mcpToken !== undefined) {
      if (next.mcpEnabled) await restartMcpServer();
      else await stopMcpServer();
    }
    if (patch.copilotEnabled !== undefined || patch.copilotPort !== undefined) {
      if (next.copilotEnabled) await restartCopilotServer();
      else await stopCopilotServer();
    }
    return next;
  });
  h('mcp:status', async () => getMcpStatus());
  h('mcp:regenerateToken', async () => regenerateMcpToken());
  h('copilot:status', async () => getCopilotStatus());
  h('copilot:regenerateToken', async () => regenerateCopilotToken());
  h('copilot:ensureCert', async () => {
    const result = await ensureCopilotCert(app.getAppPath());
    if (result.ok && getSettings().copilotEnabled) await restartCopilotServer();
    return result;
  });
  h('copilot:installAddin', async () => installCopilotAddin(app.getAppPath(), app.getVersion()));
  h('settings:setApiKey', async (_e, provider: AiProvider, key: string) => setApiKey(provider, key));
  h('settings:clearApiKey', async (_e, provider: AiProvider) => clearApiKey(provider));

  // AI model discovery (OpenRouter needs no key; others use the stored key).
  h('ai:listModels', async (_e, provider: AiProvider) => listModels(provider, getApiKey(provider)));
  h('ai:listEmbeddingModels', async (_e, provider: EmbeddingProvider) =>
    listEmbeddingModels(provider, getApiKey(provider))
  );

  // zotero
  h('zotero:ping', async () => {
    const res = await zotero.ping();
    // Local API always uses users/0; persist that so all later calls address it correctly.
    if (res.ok) updateSettings({ zoteroUserId: zotero.LOCAL_USER_ID });
    return res;
  });
  h('zotero:collections', async () => {
    const { zoteroUserId } = getSettings();
    return zotero.topCollections(zoteroUserId);
  });
  h('zotero:childCollections', async (_e, parentKey: string) => {
    const { zoteroUserId } = getSettings();
    return zotero.childCollections(zoteroUserId, parentKey);
  });
  h('zotero:collectionItems', async (_e, collectionKey: string, opts?: { query?: string; recursive?: boolean }) => {
    const { zoteroUserId } = getSettings();
    return opts?.recursive
      ? zotero.collectionItemsRecursive(zoteroUserId, collectionKey, opts)
      : zotero.collectionItems(zoteroUserId, collectionKey, opts);
  });

  // works / library
  h('works:list', async (_e, filter?: WorkFilter) => works.listWorks(filter));
  h('works:listZoteroTags', async () => works.listZoteroTags());
  h('works:get', async (_e, nodusId: string) => works.getWork(nodusId));
  h('works:ingestZoteroItems', async (_e, items: ZoteroItem[]) => {
    const { readTag } = getSettings();
    const out = [];
    for (const item of items) {
      const { nodusId } = ingestZoteroItem(item, readTag);
      const w = works.getWork(nodusId);
      if (w) out.push(w);
    }
    return out;
  });
  h('works:setManualDeep', async (_e, nodusId: string, value: boolean, model?: ModelRef | null) => {
    works.setManualDeep(nodusId, value);
    const w = works.getWork(nodusId);
    if (value && w) {
      works.setDeepPending(nodusId);
      // A light scan first captures the broad "research line" parent themes that group
      // sibling ideas in the graph; the deep scan then preserves them.
      if (w.light_status !== 'done') {
        works.setLightPending(nodusId);
        scanQueue.enqueue(nodusId, w.title, 'light', model);
      }
      scanQueue.enqueue(nodusId, w.title, 'deep', model);
    }
  });
  h('works:setManualDeepBulk', async (_e, nodusIds: string[], value: boolean, model?: ModelRef | null) => {
    for (const id of nodusIds) {
      works.setManualDeep(id, value);
      if (value) {
        const w = works.getWork(id);
        if (w) {
          works.setDeepPending(id);
          if (w.light_status !== 'done') {
            works.setLightPending(id);
            scanQueue.enqueue(id, w.title, 'light', model);
          }
          scanQueue.enqueue(id, w.title, 'deep', model);
        }
      }
    }
  });
  h('works:analyzeBoth', async (_e, nodusId: string, model?: ModelRef | null) => {
    const w = works.getWork(nodusId);
    if (!w) return;
    // Themes first, then ideas — each as its own queue job so progress is visible.
    works.setLightPending(nodusId);
    scanQueue.enqueue(nodusId, w.title, 'light', model);
    if (w.deep_status === 'done') ideas.purgeDeepData(nodusId);
    works.setManualDeep(nodusId, true);
    works.setDeepPending(nodusId);
    scanQueue.enqueue(nodusId, w.title, 'deep', model);
  });
  h('works:analyzeBothBulk', async (_e, nodusIds: string[], model?: ModelRef | null) => {
    for (const id of nodusIds) {
      const w = works.getWork(id);
      if (!w) continue;
      works.setLightPending(id);
      scanQueue.enqueue(id, w.title, 'light', model);
      if (w.deep_status === 'done') ideas.purgeDeepData(id);
      works.setManualDeep(id, true);
      works.setDeepPending(id);
      scanQueue.enqueue(id, w.title, 'deep', model);
    }
  });
  h('works:processFull', async (_e, nodusId: string, model?: ModelRef | null) => {
    processFullChain(nodusId, model);
  });
  h('works:processFullBulk', async (_e, nodusIds: string[], model?: ModelRef | null) => {
    for (const id of nodusIds) processFullChain(id, model);
  });
  h('works:reassignThemes', async (_e, model?: ModelRef | null) => {
    // Re-run the cheap (title+abstract) theme scan for every work so older works pick
    // up the broad parent themes that group their ideas in the graph. Each light scan
    // replaces that work's broad themes so stale one-off labels disappear over time.
    const all = getDb().prepare('SELECT nodus_id, title FROM works WHERE archived = 0').all() as {
      nodus_id: string;
      title: string;
    }[];
    for (const w of all) {
      works.setLightPending(w.nodus_id);
      scanQueue.enqueue(w.nodus_id, w.title, 'light', model);
    }
    return all.length;
  });
  h('works:meta', async (_e, nodusId: string) => {
    const w = works.getWork(nodusId);
    if (!w) return null;
    const { zoteroUserId } = getSettings();
    const meta = await zotero.getItemMeta(zoteroUserId, w.zotero_key).catch(() => null);
    if (!meta) return null;
    return meta;
  });
  h('works:rescan', async (_e, nodusId: string, kind: QueueKind, model?: ModelRef | null) => {
    const w = works.getWork(nodusId);
    if (!w) return;
    if (kind === 'deep') {
      ideas.purgeDeepData(nodusId);
      works.setDeepPending(nodusId);
    } else if (kind === 'summary') {
      works.setSummaryPending(nodusId);
    } else {
      works.setLightPending(nodusId);
    }
    scanQueue.enqueue(nodusId, w.title, kind, model);
  });
  h('works:summarize', async (_e, nodusId: string, model?: ModelRef | null) => {
    const work = works.getWork(nodusId);
    if (!work) return;
    works.setSummaryPending(nodusId);
    scanQueue.enqueue(nodusId, work.title, 'summary', model);
  });
  h('works:summarizeBulk', async (_e, nodusIds: string[], model?: ModelRef | null) => {
    for (const nodusId of nodusIds) {
      const work = works.getWork(nodusId);
      if (!work) continue;
      works.setSummaryPending(nodusId);
      scanQueue.enqueue(nodusId, work.title, 'summary', model);
    }
  });
  h('works:summarizeAll', async (_e, model?: ModelRef | null) => {
    const all = works.listWorks();
    let enqueued = 0;
    for (const work of all) {
      if (
        work.summary_status === 'done' &&
        work.summary_hash === summaryContentHash(work, model) &&
        workSummaries.getWorkSummary(work.nodus_id)
      ) continue;
      works.setSummaryPending(work.nodus_id);
      scanQueue.enqueue(work.nodus_id, work.title, 'summary', model);
      enqueued++;
    }
    return enqueued;
  });
  h('works:getSummary', async (_e, nodusId: string) => workSummaries.getWorkSummary(nodusId));
  h('works:collectionFacets', async () => listCollectionFacets());
  h('works:listDuplicates', async () => dedupe.listDuplicateWorks());
  h('works:merge', async (_e, canonicalId: string, duplicateIds: string[]) =>
    dedupe.mergeWorks(canonicalId, duplicateIds)
  );
  h('works:openInZotero', async (_e, zoteroKey: string) => {
    const { zoteroUserId } = getSettings();
    await shell.openExternal(`zotero://select/library/items/${zoteroKey}`);
    return zoteroUserId;
  });
  h('shell:openExternal', async (_e, url: string) => {
    // Only follow web/mail links rendered from Markdown — never arbitrary schemes.
    if (typeof url === 'string' && /^(https?:|mailto:)/i.test(url.trim())) {
      await shell.openExternal(url.trim());
    }
  });
  h('works:uploadText', async (_e, nodusId: string, filePath: string) => {
    const w = getDb().prepare('SELECT * FROM works WHERE nodus_id = ?').get(nodusId) as any;
    if (!w) return;
    const s = getSettings();
    const doc = await extractFromPath(filePath, {
      ocr: { enabled: s.ocrEnabled, languages: s.ocrLanguages, maxPages: s.ocrMaxPages },
      perf: { nodusId, title: w.title },
    });
    works.setDeepPending(nodusId);
    await runDeepScan(w, doc);
  });

  // sync
  h('sync:now', async () => fullSync('manual'));
  h('sync:log', async () => getSyncLog());

  // queue
  h('queue:get', async () => scanQueue.snapshot());
  h('queue:pause', async () => scanQueue.pause());
  h('queue:resume', async () => scanQueue.resume());
  h('queue:cancelItem', async (_e, id: string) => scanQueue.cancelItem(id));
  h('queue:removeItem', async (_e, id: string) => scanQueue.removeItem(id));
  h('queue:moveToTop', async (_e, id: string) => scanQueue.moveToTop(id));
  h('queue:clear', async () => scanQueue.clear());
  h('queue:stopAll', async () => scanQueue.stopAll());
  h('queue:retryFailed', async () => scanQueue.retryFailed());
  h('queue:enqueueBridge', async (_e, model?: ModelRef | null) => scanQueue.enqueueBridge(model));

  // graph
  h('graph:get', async (_e, lens: 'ideas' | 'authors') =>
    lens === 'authors' ? buildAuthorGraph() : buildIdeaGraph()
  );
  h('graph:ideaDetail', async (_e, globalId: string) => ideas.getIdeaDetail(globalId));
  h('graph:edgeDetail', async (_e, edgeId: string) => ideas.getEdgeDetail(edgeId));
  h('graph:ideaEdges', async (_e, globalId: string) => ideas.getIdeaEdges(globalId));
  h('works:ideasByWork', async (_e, nodusId: string, limit: number, offset: number) =>
    ideas.getIdeasByWork(nodusId, limit, offset)
  );
  h('graph:themes', async () => themes.listGraphThemes());

  // authors (dossier + synthesis matrix)
  h('authors:list', async () => listAuthors());
  h('authors:dossier', async (_e, authorId: string) => buildAuthorDossier(authorId));
  h('authors:synthesize', async (_e, authorId: string, model?: ModelRef | null) =>
    synthesizeAuthorDossier(authorId, model)
  );
  h('authors:matrix', async () => buildSynthesisMatrix());
  h('authors:matrixCell', async (_e, authorId: string, themeId: string, model?: ModelRef | null) =>
    synthesizeMatrixCell(authorId, themeId, model)
  );
  h('authors:exportSyntheses', async (_e, request: AuthorSynthesisExportRequest) => exportAuthorSyntheses(request));

  // study guide
  h('study:plan', async (_e, request?: StudyPlanRequest) => buildStudyPlan(request ?? {}));
  h('study:progress:set', async (_e, record: {
    targetKind: 'author' | 'work' | 'idea' | 'theme';
    targetId: string;
    status: 'pending' | 'in_progress' | 'understood' | 'needs_full_read' | 'review';
    note?: string | null;
  }) => studyProgress.setStudyProgress(record));
  h('study:session', async (_e, request: StudySessionRequest) => generateStudySession(request));
  h('study:answer', async (_e, request: StudyAnswerRequest) => evaluateStudyAnswer(request));

  // main-theme management ("temas principales")
  h('themes:listManaged', async () => themes.listManagedThemes());
  h('themes:add', async (_e, label: string) => {
    themes.addManualTheme(label);
    return themes.listManagedThemes();
  });
  h('themes:rename', async (_e, themeId: string, label: string) => {
    themes.renameTheme(themeId, label);
    return themes.listManagedThemes();
  });
  h('themes:setPinned', async (_e, themeId: string, pinned: boolean) => {
    themes.setThemePinned(themeId, pinned);
    return themes.listManagedThemes();
  });
  h('themes:delete', async (_e, themeId: string) => {
    themes.deleteTheme(themeId);
    return themes.listManagedThemes();
  });
  h('themes:reprocess', async (e, options: ReprocessConnectionsOptions, model?: ModelRef | null) =>
    // Re-group the already-extracted ideas under the curated/existing themes (and
    // optionally re-trace idea↔idea relations) with the model. No document re-reading.
    reprocessConnections(options ?? { relations: false }, model, (p) => {
      e.sender.send('themes:reprocess:progress', p);
    })
  );

  // gaps + reading path
  h('gaps:aggregate', async () => aggregateGaps());
  h('gaps:detail', async (_e, gapId: string) => getGapDetail(gapId));
  h('gaps:contradictions', async () => getContradictions());
  h('reading:path', async (_e, request?: ReadingPathRequest) => buildReadingPath(request));

  // debates (contradiction face-offs)
  h('debates:list', async () => getDebates());
  h('debates:analyzeStream', async (e, requestId: string, request: DebateAnalysisRequest) =>
    streamDebateAnalysis(request, (delta, kind) => {
      const channel = kind === 'reasoning' ? 'debates:analyzeStream:reasoning' : 'debates:analyzeStream:delta';
      e.sender.send(channel, requestId, delta);
    })
  );

  // research coverage map (question-driven research)
  h('research:rq:list', async () => rqRepo.listResearchQuestions());
  h('research:rq:get', async (_e, id: string) => rqRepo.getResearchQuestionDetail(id));
  h('research:rq:create', async (_e, input: { question: string; notes?: string }) =>
    rqRepo.createResearchQuestion(input.question, input.notes)
  );
  h('research:rq:decompose', async (_e, request: RqDecomposeRequest) => decomposeQuestion(request));
  h('research:rq:updateSubs', async (_e, request: RqUpdateSubQuestionsRequest) => {
    rqRepo.replaceSubQuestions(request.rqId, request.subQuestions);
    return rqRepo.getResearchQuestionDetail(request.rqId);
  });
  h('research:rq:map', async (e, requestId: string, request: RqMapRequest) =>
    mapCoverage(request, (p) => e.sender.send('research:rq:map:progress', requestId, p))
  );
  h('research:rq:delete', async (_e, id: string) => {
    rqRepo.deleteResearchQuestion(id);
  });
  h('research:rq:export', async (_e, request: RqExportRequest) => exportResearchCoverage(request));

  // research assistant
  h('research:chat', async (_e, request: ResearchChatRequest) => answerResearchChat(request));
  h('research:chatStream', async (e, requestId: string, request: ResearchChatRequest) =>
    streamResearchChat(request, (delta, kind) => {
      const channel = kind === 'reasoning' ? 'research:chatStream:reasoning' : 'research:chatStream:delta';
      e.sender.send(channel, requestId, delta);
    })
  );

  // writing workshop
  h('writing:snapshot', async (_e, brief: WritingWorkshopBrief) => buildWritingWorkshopSnapshot(brief));
  h('writing:draft', async (_e, request: WritingWorkshopDraftRequest) => generateWritingWorkshopDraft(request));
  h('writing:export', async (_e, request: WritingWorkshopExportRequest) => exportWritingWorkshopDraft(request));
  h('writing:saved:list', async () => writingDrafts.listWritingWorkshopDrafts());
  h('writing:saved:save', async (_e, request: WritingWorkshopSaveDraftRequest) => writingDrafts.saveWritingWorkshopDraft(request));
  h('writing:saved:delete', async (_e, id: string) => writingDrafts.deleteWritingWorkshopDraft(id));

  // deep research (orchestrated, coverage-guided multi-page report)
  h('research:deep', async (e, requestId: string, request: DeepResearchRequest) =>
    generateDeepResearchReport(request, (p) => e.sender.send('research:deep:progress', requestId, p))
  );

  // tutor mode (AI-guided graph walkthrough)
  h('tutor:plan', async (_e, request: TutorPlanRequest) => buildTutorPlan(request));
  h('tutor:routes:list', async () => tutorRoutes.listTutorRoutes());
  h('tutor:routes:save', async (_e, plan: TutorPlan, route: TutorRoute, model: ModelRef | null, rating: number) =>
    tutorRoutes.saveTutorRoute(plan, route, model, rating)
  );
  h('tutor:routes:rate', async (_e, routeId: string, rating: number | null) => tutorRoutes.rateTutorRoute(routeId, rating));
  h('tutor:routes:played', async (_e, routeId: string) => tutorRoutes.markTutorRoutePlayed(routeId));
  h('tutor:routes:delete', async (_e, routeId: string) => tutorRoutes.deleteTutorRoute(routeId));
  h('tutor:step', async (_e, request: TutorStepRequest) => answerTutorStep(request));
  h('tutor:stepStream', async (e, requestId: string, request: TutorStepRequest) =>
    streamTutorStep(request, (delta, kind) => {
      const channel = kind === 'reasoning' ? 'tutor:stepStream:reasoning' : 'tutor:stepStream:delta';
      e.sender.send(channel, requestId, delta);
    })
  );

  // argument map (AI-traced hierarchical outline around a seed idea)
  h('argumentMap:build', async (_e, request: ArgumentMapRequest) =>
    buildArgumentMap(request, request.model)
  );
  h('argumentMap:discover', async () => discoverArgumentRoutes());

  // research chat history
  h('chat:list', async (_e, includeArchived?: boolean) => chat.listConversations(includeArchived ?? false));
  h('chat:get', async (_e, id: string) => chat.getConversation(id));
  h('chat:create', async (_e, input: { model?: ModelRef | null; selection?: ResearchContextSelection | null }) =>
    chat.createConversation(input ?? {})
  );
  h(
    'chat:saveMessages',
    async (
      _e,
      id: string,
      messages: ChatMessageRecord[],
      meta?: { model?: ModelRef | null; selection?: ResearchContextSelection | null }
    ) => chat.saveMessages(id, messages, meta)
  );
  h('chat:generateTitle', async (_e, id: string, model?: ModelRef | null) => {
    const conversation = chat.getConversation(id);
    if (!conversation) return '';
    const title = await generateChatTitle(conversation.messages, model ?? conversation.model);
    chat.renameConversation(id, title);
    return title;
  });
  h('chat:rename', async (_e, id: string, title: string) => chat.renameConversation(id, title));
  h('chat:archive', async (_e, id: string, archived: boolean) => chat.setArchived(id, archived));
  h('chat:delete', async (_e, id: string) => chat.deleteConversation(id));

  // notes (user-structured folders/subfolders with markdown + captured AI content)
  h('notes:tree', async () => notes.getNotesTree());
  h('notes:folders:create', async (_e, input: CreateNoteFolderInput) => notes.createNoteFolder(input));
  h('notes:folders:rename', async (_e, id: string, name: string) => notes.renameNoteFolder(id, name));
  h('notes:folders:move', async (_e, id: string, parentId: string | null) => notes.moveNoteFolder(id, parentId ?? null));
  h('notes:folders:delete', async (_e, id: string) => {
    notes.deleteNoteFolder(id);
  });
  h('notes:create', async (_e, input: CreateNoteInput) => notes.createNote(input));
  h('notes:get', async (_e, id: string) => notes.getNote(id));
  h('notes:update', async (_e, input: UpdateNoteInput) => notes.updateNote(input));
  h('notes:move', async (_e, id: string, folderId: string | null) => notes.moveNote(id, folderId ?? null));
  h('notes:delete', async (_e, id: string) => {
    // A manual idea is owned by its note: deleting the note purges the idea and
    // everything indexed for it (occurrences, evidence, edges, embedding).
    const note = notes.getNote(id);
    if (note?.source?.note === MANUAL_IDEA_MARKER && note.source.ref) {
      manualIdeas.deleteManualIdea(note.source.ref);
    }
    notes.deleteNote(id);
  });

  // manual ideas (user-authored, note-owned graph ideas)
  h('manualIdeas:create', async (_e, input: { folderId: string | null; title?: string }) =>
    manualIdeas.createManualIdea(input)
  );
  h('manualIdeas:save', async (_e, payload: ManualIdeaPayload) => {
    manualIdeas.saveManualIdea(payload);
  });
  h('manualIdeas:autoIndex', async (_e, input: { globalId: string; title: string; summary: string; excludeIds?: string[] }) =>
    manualIdeas.autoIndexManualIdea(input)
  );
  h('manualIdeas:searchCandidates', async (_e, query: string, excludeIds?: string[], limit?: number) =>
    manualIdeas.searchIdeaCandidates(query, excludeIds ?? [], limit ?? 20)
  );

  // notes export + reordering
  h('notes:export', async (_e, options: NotesExportOptions) => exportNotes(options));
  h('notes:reorder', async (_e, noteIds: string[]) => {
    notes.reorderNotes(noteIds);
  });
  h('notes:reorderByAI', async (_e, noteIds: string[]) => reorderNotesByAI(noteIds));
  h('notes:folders:updateSummary', async (_e, id: string, summary: string) =>
    notes.updateNoteFolderSummary(id, summary ?? '')
  );
  h('notes:folders:suggestIdeas', async (_e, folderId: string) => suggestFolderIdeas(folderId));
  h('citations:verify', async (_e, refs: CitationRef[]) => verifyCitations(refs ?? []));
  h('search:global', async (_e, query: string, limitPerKind?: number) =>
    globalSearch(query ?? '', limitPerKind ?? 8)
  );
  h('search:semantic', async (_e, query: string, options?: SemanticSearchOptions) =>
    semanticSearch(query ?? '', options ?? {})
  );
  h('search:similarIdea', async (_e, globalId: string, limit?: number) =>
    findSimilarToIdea(globalId, limit ?? 12)
  );
  h('search:saved:list', async () => listSavedSearches());
  h('search:saved:create', async (_e, input: SaveSearchInput) => saveSearch(input));
  h('search:saved:delete', async (_e, id: string) => {
    deleteSavedSearch(id);
  });
  h('corpus:health', async () => getCorpusHealth());
  h('gaps:suggestSearch', async (_e, statement: string, workTitles?: string[]) =>
    suggestGapSearch(statement ?? '', workTitles ?? [])
  );

  // projects / manuscripts
  h('projects:list', async () => projects.listProjects());
  h('projects:get', async (_e, id: string) => projects.getProjectDetail(id));
  h('projects:create', async (_e, input: CreateProjectInput) => projects.createProject(input));
  h('projects:update', async (_e, input: UpdateProjectInput) => projects.updateProject(input));
  h('projects:delete', async (_e, id: string) => {
    projects.deleteProject(id);
  });
  h('projects:sections:update', async (_e, input: UpdateProjectSectionInput) => projects.updateSection(input));
  h('projects:links:add', async (_e, input: AddProjectLinkInput) => projects.addLink(input));
  h('projects:links:delete', async (_e, id: string) => {
    projects.deleteLink(id);
  });
  h('projects:chapters:import', async (_e, input: ImportProjectChapterInput) => {
    let filePath = input.filePath?.trim() || null;
    if (!filePath) {
      const result = await dialog.showOpenDialog({
        title: 'Importar capitulo',
        properties: ['openFile'],
        filters: [
          { name: 'Documentos de texto', extensions: ['docx', 'pdf', 'epub', 'md', 'markdown', 'txt'] },
          { name: 'Todos los archivos', extensions: ['*'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      filePath = result.filePaths[0];
    }
    const settings = getSettings();
    const doc = await extractFromPath(filePath, {
      ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages },
      perf: { title: path.basename(filePath), nodusId: input.projectId },
    });
    if (!doc.text.trim()) throw new Error('No se pudo extraer texto util del capitulo.');
    return projects.createChapter({
      projectId: input.projectId,
      sectionId: input.sectionId ?? null,
      title: input.title?.trim() || path.basename(filePath, path.extname(filePath)),
      sourceFormat: projects.sourceFormatFromPath(filePath),
      originalFileName: path.basename(filePath),
      text: doc.text,
    });
  });
  h('projects:chapters:update', async (_e, chapterId: string, markdown: string) =>
    projects.updateChapterMarkdown(chapterId, markdown, { versionLabel: 'Antes de guardar edicion manual' })
  );
  h('projects:suggestions:list', async (_e, chapterId: string) => projects.listSuggestions(chapterId));
  h('projects:suggestions:generate', async (_e, request: GenerateProjectSuggestionsRequest) =>
    generateProjectSuggestions(request)
  );
  h('projects:suggestions:updateStatus', async (_e, id: string, status: ChapterSuggestionStatus) =>
    projects.updateSuggestionStatus(id, status)
  );
  h('projects:suggestions:apply', async (_e, request: ApplyProjectSuggestionsRequest) =>
    projects.applySuggestions(request.chapterId, request.suggestionIds)
  );
  h('projects:versions:list', async (_e, chapterId: string) => projects.listChapterVersions(chapterId));
  h('projects:versions:restore', async (_e, versionId: string) => projects.restoreChapterVersion(versionId));
  h('projects:chapterRelations:get', async (_e, chapterId: string) => getChapterRelations(chapterId));
  h('projects:chapterRelations:analyze', async (_e, request: AnalyzeChapterRelationsRequest) =>
    analyzeChapterRelations(request)
  );
  h('projects:export', async (_e, request: ExportProjectRequest) => exportProject(request));
  h('projects:chapters:export', async (_e, request: ExportProjectChapterRequest) =>
    exportProjectChapter(request)
  );

  // embedding pipeline
  h('embeddings:start', async (_e, nodusIds?: string[]) => startEmbedding(nodusIds));
  h('embeddings:reindexAll', async () => reindexAll());
  h('embeddings:pause', async () => pauseEmbedding());
  h('embeddings:resume', async () => resumeEmbedding());
  h('embeddings:stop', async () => stopEmbedding());
  h('embeddings:clearProgress', async () => clearEmbeddingProgress());
  h('embeddings:status', async () => getEmbeddingSnapshot());
  h('embeddings:workStatuses', async (_e, nodusIds?: string[]) => getWorkEmbeddingStatuses(nodusIds));

  // Full-text passage index
  h('passages:start', async (_e, nodusIds?: string[]) => startPassageEmbedding(nodusIds));
  h('passages:pause', async () => pausePassageEmbedding());
  h('passages:resume', async () => resumePassageEmbedding());
  h('passages:stop', async () => stopPassageEmbedding());
  h('passages:clearProgress', async () => clearPassageProgress());
  h('passages:status', async () => getPassageSnapshot());
  h('passages:workStatuses', async (_e, nodusIds?: string[]) => getWorkPassageStatuses(nodusIds));
  h('passages:get', async (_e, passageId: string) => getPassageDetail(passageId));

  // semantic bridge discovery
  h('bridges:discover', async (_e, model?: ModelRef | null) => discoverSemanticBridges(model));
  h('bridges:isRunning', async () => isSemanticBridgeRunning());

  // export / import
  h('data:export', async () => exportData());
  h('data:import', async (_e, password: string) => {
    const result = await importData(password);
    // Imports intentionally restore MCP as disabled and tokenless. Stop any
    // listener from the previous local profile once the swap succeeds.
    if (result.ok) await stopMcpServer();
    return result;
  });
  h('data:resetGraph', async () => {
    // Stop any pending scans first so a finishing job can't repopulate after the wipe.
    scanQueue.clear();
    ideas.resetGraphData();
  });

  // demo mode: a curated sample corpus, only offered on an empty database.
  h('data:hasData', async () => hasAnyData());
  h('data:seedDemo', async () => seedDemoData());
  h('data:clearDemo', async () => {
    scanQueue.clear();
    clearDemoData();
  });

  h('updates:check', async () => checkForUpdates());
  h('updates:install', async () => installUpdate());

  // Stream queue progress to the renderer.
  scanQueue.onProgress((p) => {
    getWindow()?.webContents.send('queue:progress', p);
  });

  // Stream embedding pipeline progress to the renderer.
  onEmbeddingProgress((p) => {
    getWindow()?.webContents.send('embeddings:progress', p);
  });

  onPassageProgress((p) => {
    getWindow()?.webContents.send('passages:progress', p);
  });

  onChapterRelationsProgress((p) => {
    getWindow()?.webContents.send('projects:chapterRelations:progress', p);
  });

  // Stream semantic bridge progress to the renderer.
  onSemanticBridgeProgress((p) => {
    getWindow()?.webContents.send('bridges:progress', p);
  });
}
