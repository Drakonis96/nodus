import { ipcMain, shell, BrowserWindow } from 'electron';
import type {
  AppSettings,
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
  DebateAnalysisRequest,
  RqDecomposeRequest,
  RqMapRequest,
  RqUpdateSubQuestionsRequest,
  RqExportRequest,
} from '@shared/types';
import { getSettings, updateSettings } from './db/settingsRepo';
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
import { extractFromPath } from './extraction/textExtractor';
import { runDeepScan } from './ai/deepScan';
import { summaryContentHash } from './ai/summaryScan';
import { answerResearchChat, generateChatTitle, streamResearchChat } from './ai/researchAssistant';
import { answerTutorStep, buildTutorPlan, streamTutorStep } from './ai/tutor';
import { buildArgumentMap, discoverArgumentRoutes } from './ai/argumentMap';
import { buildWritingWorkshopSnapshot, generateWritingWorkshopDraft } from './ai/writingWorkshop';
import { reprocessConnections } from './ai/reprocessConnections';
import { startEmbedding, reindexAll, pauseEmbedding, resumeEmbedding, stopEmbedding, clearEmbeddingProgress, getEmbeddingSnapshot, onEmbeddingProgress, getWorkEmbeddingStatuses } from './ai/embeddingPipeline';
import { discoverSemanticBridges, isSemanticBridgeRunning, onSemanticBridgeProgress } from './ai/semanticBridges';
import * as chat from './db/chatRepo';
import * as tutorRoutes from './db/tutorRepo';
import * as workSummaries from './db/workSummariesRepo';
import { getDb } from './db/database';
import { exportWritingWorkshopDraft } from './export/writingWorkshopExport';

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
    return next;
  });
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
  h('graph:themes', async () => themes.listGraphThemes());

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
    streamDebateAnalysis(request, (delta) => {
      e.sender.send('debates:analyzeStream:delta', requestId, delta);
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
    streamResearchChat(request, (delta) => {
      e.sender.send('research:chatStream:delta', requestId, delta);
    })
  );

  // writing workshop
  h('writing:snapshot', async (_e, brief: WritingWorkshopBrief) => buildWritingWorkshopSnapshot(brief));
  h('writing:draft', async (_e, request: WritingWorkshopDraftRequest) => generateWritingWorkshopDraft(request));
  h('writing:export', async (_e, request: WritingWorkshopExportRequest) => exportWritingWorkshopDraft(request));

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
    streamTutorStep(request, (delta) => {
      e.sender.send('tutor:stepStream:delta', requestId, delta);
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

  // embedding pipeline
  h('embeddings:start', async (_e, nodusIds?: string[]) => startEmbedding(nodusIds));
  h('embeddings:reindexAll', async () => reindexAll());
  h('embeddings:pause', async () => pauseEmbedding());
  h('embeddings:resume', async () => resumeEmbedding());
  h('embeddings:stop', async () => stopEmbedding());
  h('embeddings:clearProgress', async () => clearEmbeddingProgress());
  h('embeddings:status', async () => getEmbeddingSnapshot());
  h('embeddings:workStatuses', async (_e, nodusIds?: string[]) => getWorkEmbeddingStatuses(nodusIds));

  // semantic bridge discovery
  h('bridges:discover', async (_e, model?: ModelRef | null) => discoverSemanticBridges(model));
  h('bridges:isRunning', async () => isSemanticBridgeRunning());

  // export / import
  h('data:export', async () => exportData());
  h('data:import', async (_e, password: string) => importData(password));
  h('data:resetGraph', async () => {
    // Stop any pending scans first so a finishing job can't repopulate after the wipe.
    scanQueue.clear();
    ideas.resetGraphData();
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

  // Stream semantic bridge progress to the renderer.
  onSemanticBridgeProgress((p) => {
    getWindow()?.webContents.send('bridges:progress', p);
  });
}
