import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { ipcMain, shell, BrowserWindow, dialog, app } from 'electron';
import type {
  AppLanguage,
  AppSettings,
  AudioEntityKind,
  AudioProvider,
  AudioSegmentRequest,
  AddProjectLinkInput,
  ApplyManuscriptCitationRequest,
  ApplyProjectSuggestionsRequest,
  AuthorSynthesisExportRequest,
  ChapterSuggestionStatus,
  QueueKind,
  WorkFilter,
  AiProvider,
  LocalProvider,
  ModelRef,
  ZoteroItem,
  ZoteroLibrary,
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
  TranslationEntityKind,
  GenerateTranslationRequest,
  DeepResearchRequest,
  DebateAnalysisRequest,
  RqDecomposeRequest,
  RqMapRequest,
  RqUpdateSubQuestionsRequest,
  RqExportRequest,
  HypothesisLabRequest,
  ManuscriptVerificationRequest,
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
  ImmersionScopeRequest,
  ImmersionRequest,
  ImmersionProgress,
  ImmersionAnswerRequest,
  CreateVaultInput,
  VaultSummary,
  VaultSwitchOptions,
  VaultSwitchResult,
  VaultType,
  PersonInput,
  PlaceInput,
  GazetteerPlace,
  PersonPlaceInput,
  EventInput,
  ParticipantRole,
  HistoricalEventType,
  RecordEvidenceInput,
  RecordEvidenceTargetKind,
  RelationshipType,
  RelationshipProvenance,
  RelationshipSubtype,
  SocialContactInput,
  SocialRelationInput,
  ArchiveItemInput,
  ArchiveEntryCreateInput,
  ArchiveIngestSummary,
  ArchiveListOptions,
  ZoteroArchiveEntryImportInput,
  DecorativeImageActionRequest,
  DecorativeImageEntityKind,
  DecorativeImageStyle,
  SearchResultKind,
  CreateStudyCourseInput,
  CreateStudyDocumentInput,
  CreateStudyFolderInput,
  CreateStudySubjectInput,
  CreateStudyTagInput,
  CreateStudyTemplateInput,
  CreateStudyTopicInput,
  StudyEntityKind,
  StudyEntityMoveInput,
  StudyLifecycleAction,
  StudyPlacementInput,
  StudyWorkspaceOptions,
  StudySchedule,
  StudyAnnotationInput,
  StudyDocUpdateInput,
  StudySttRequest,
  StudyImproveRequest,
  StudyImprovementLog,
  StudyStyleAssociationKind,
  StudyStyleExport,
  StudyStyleInput,
  StudyMaterialAnnotationInput,
  StudyMaterialImportInput,
  ZoteroStudyMaterialImportInput,
  StudyMaterialListOptions,
  StudyMaterialUpdateInput,
  StudyAudioMarkerInput,
  StudyRecordingCreateInput,
  StudyRecordingListOptions,
  StudyRecordingUpdateInput,
  StudyTranscriptInput,
  StudyTranscriptSegmentInput,
  StudySearchOptions,
  StudyAssistantConversationInput,
  StudyAssistantConversationPatch,
  StudyAssistantRequest,
  StudyQuestionExport,
  StudyQuestionFilters,
  StudyQuestionGenerationRequest,
  StudyQuestionInput,
  StudyAssessmentInput,
  StudyAttemptAnswerInput,
  StudyAttemptStartInput,
  StudyTestBuildRequest,
  StudyGradingRequest,
  StudyRubricInput,
  StudyPronunciationEntry,
} from '@shared/types';

// Mirrors MANUAL_IDEA_MARKER in shared/types.ts. Defined locally because the
// electron sub-build erases type-only @shared imports but cannot resolve the
// alias for a runtime value import.
const MANUAL_IDEA_MARKER = 'manual-idea';
import { getSettings, updateSettings } from './db/settingsRepo';
import { getMcpStatus, regenerateMcpToken, restartMcpServer, startMcpServer, stopMcpServer } from './mcp';
import { getCopilotStatus, regenerateCopilotToken, restartCopilotServer, startCopilotServer, stopCopilotServer } from './copilot/server';
import {
  applyMascotWindow,
  beginMascotWindowDrag,
  dragMascotWindow,
  endMascotWindowDrag,
  setMascotTutorialVisible,
  setMascotWindowExpanded,
} from './mascotWindow';
import {
  listNotifications,
  markAllNotificationsRead,
  clearNotifications,
  setNotificationsNotifier,
} from './notifications';
import { getNodiViewContext, setNodiViewContext, streamNodiChat } from './ai/nodiChat';
import type { NodiChatRequest } from '@shared/types';
import { clearNodiConversations, deleteNodiConversation, getNodiConversation, listNodiConversations, saveNodiConversation } from './nodiConversations';
import { ensureCopilotCert } from './copilot/certs';
import { installCopilotAddin, installLibreOfficeCopilot } from './copilot/install';
import { setApiKey, clearApiKey, getApiKey, copyApiKeysBetweenVaults, listApiKeyProvidersForVault, setBackupPassword, clearBackupPassword, hasBackupPassword, getBackupPassword, getBackupRecoveryKey } from './secrets/secretStore';
import { recoverLegacyApiKeys } from './secrets/legacySecretRecovery';
import { runAutoBackupNow } from './export/autoBackup';
import { MIN_BACKUP_PASSWORD_LENGTH } from './export/backupCrypto';
import { listEmbeddingModels, listModels, testLocalProvider } from './ai/providers';
import { listImageModels } from './ai/imageModels';
import {
  applyDecorativeImageOption,
  deleteDecorativeImage,
  generatePersonPortraitFromDescription,
  interruptDecorativeImageGenerations,
  invalidateDecorativeImageGeneration,
  queueDecorativeImageGeneration,
  revertDecorativeImage,
  saveCustomDecorativeImage,
} from './ai/decorativeImages';
import { getDecorativeImage, getDecorativeImageData } from './db/decorativeImagesRepo';
import {
  clearEntityClips,
  deleteClip as deleteAudioClip,
  deleteEntityClips,
  getEntitySegments,
  audioClipPath,
  createStudyAudioBookmark,
  deleteStudyAudioBookmark,
  getStudyPronunciations,
  listStudyAudioBookmarks,
  listStudyAudioPlaylist,
  listEntityClips,
  readClipBytes,
  saveClip,
  setStudyPronunciations,
} from './audio/audioService';
import {
  clearHumeKey,
  humeHasKey,
  listHumeVoices,
  setHumeKey,
  synthesizeHume,
} from './audio/hume';
import * as zotero from './zotero/zoteroClient';
import * as works from './db/worksRepo';
import { reconcileAuthorLayerOnce } from './db/authorsRepo';
import * as dedupe from './db/dedupeRepo';
import * as ideaDedupe from './db/ideaDedupeRepo';
import { listCollectionFacets } from './db/collectionsRepo';
import * as ideas from './db/ideasRepo';
import { setEdgeFeedback, listEdgeFeedback } from './db/edgeFeedbackRepo';
import * as themes from './db/themesRepo';
import { aggregateGaps, aggregateGapsPage, contradictionCount, getGapDetail } from './db/gapsRepo';
import { getSyncLog } from './db/syncRepo';
import { fullSync, ingestZoteroItem, startRealtimeSync, stopRealtimeSync } from './sync/syncService';
import { scanQueue } from './pipeline/scanQueue';
import { buildIdeaGraph, buildIdeaGraphOverview, buildIdeaThemeGraph, buildAuthorGraph, getContradictions, getDebates, buildReadingPath } from './graph/graphService';
import { streamDebateAnalysis } from './ai/debate';
import * as rqRepo from './db/researchMapRepo';
import { decomposeQuestion, mapCoverage } from './ai/researchMap';
import { exportResearchCoverage } from './export/researchMapExport';
import { exportData, importData } from './export/exportImport';
import {
  getRecoveryStatus,
  initializeRecoveryFolder,
  inspectRecoveryFolder,
  restoreRecoverySnapshot,
} from './recovery/recoveryManager';
import { buildSyncPackage, mergeSyncPackage } from './export/syncPackage';
import { parsePageNumber, zoteroOpenPdfUrl, zoteroSelectUrl } from '@shared/pageLocation';
import { hasAnyData, seedDemoData, clearDemoData } from './db/demoData';
import { seedGenealogyDemoData } from './db/genealogyDemoData';
import { seedDatabasesDemoData } from './db/databasesDemoData';
import { seedStudyDemoData } from './db/studyDemoData';
import { generateDemoPortraits, hasDemoPortraitKey } from './ai/genealogyDemoPortraits';
import { exportNotes } from './export/notesExport';
import { reorderNotesByAI } from './ai/notesOrder';
import { suggestFolderIdeas } from './ai/folderIdeaSuggestions';
import { verifyCitations, previewCitation } from './citations/verifyCitations';
import { getSearchResultDetail, globalSearch } from './db/searchRepo';
import { semanticSearch, findSimilarToIdea } from './ai/semanticSearch';
import { listSavedSearches, saveSearch, deleteSavedSearch } from './db/savedSearchesRepo';
import { getCorpusHealth } from './db/corpusHealthRepo';
import { getAcademicHomeStats } from './db/homeRepo';
import { analyzeChapterRelations, getChapterRelations, onChapterRelationsProgress } from './ai/chapterIdeas';
import { applyManuscriptCitation, verifyManuscriptCitations } from './ai/manuscriptVerifier';
import { suggestGapSearch } from './ai/gapSearch';
import { extractFromPath, resolveWorkText } from './extraction/textExtractor';
import { runDeepScan } from './ai/deepScan';
import { summaryContentHash } from './ai/summaryScan';
import { answerResearchChat, generateChatTitle, streamResearchChat } from './ai/researchAssistant';
import { answerTutorStep, buildTutorPlan, streamTutorStep } from './ai/tutor';
import { buildArgumentMap, discoverArgumentRoutes } from './ai/argumentMap';
import { listAuthors, listAuthorsPage, buildAuthorDossier, synthesizeAuthorDossier } from './ai/authorDossier';
import { buildSynthesisMatrix, synthesizeMatrixCell } from './ai/synthesisMatrix';
import { getCachedWorkIdeaSynthesis, synthesizeWorkIdeas } from './ai/workIdeaSynthesis';
import { exportAuthorSyntheses } from './export/authorSynthesisExport';
import { buildStudyPlan, evaluateStudyAnswer, generateStudySession } from './ai/studyGuide';
import { buildImmersionScope, evaluateImmersionAnswer, generateImmersionSession } from './ai/immersion';
import * as immersionRepo from './db/immersionRepo';
import { generateHypothesisLab } from './ai/hypothesisLab';
import * as studyProgress from './db/studyProgressRepo';
import * as studyOrg from './db/studyOrgRepo';
import * as studySchedule from './db/studyScheduleRepo';
import * as studyEditor from './db/studyEditorRepo';
import * as studyStyles from './db/studyStylesRepo';
import * as studyMaterials from './db/studyMaterialsRepo';
import * as studyRecordings from './db/studyRecordingsRepo';
import { transcribeStudyAudio as transcribeOpenAiStudyAudio } from './ai/studyTranscription';
import {
  cancelWhisperCpp,
  deleteWhisperCppModel,
  downloadWhisperCppModel,
  getWhisperCppStatus,
  transcribeWhisperCpp,
  installWhisperCpp, uninstallWhisperCpp,
} from './stt/whisperCpp';
import {
  deleteNodusLocalModel,
  downloadNodusLocalModel,
  getNodusLocalAiStatus,
  installNodusLocalRuntime,
} from './ai/nodusLocalAi';
import { improveStudyText } from './ai/studyImprove';
import * as studySearch from './ai/studySearch';
import * as studyAssistant from './ai/studyAssistant';
import * as studyQuestions from './db/studyQuestionsRepo';
import * as studyLearning from './db/studyLearningRepo';
import * as studyAiUsage from './db/studyAiUsageRepo';
import * as studyDataAdmin from './db/studyDataAdmin';
import { exportStudyScope } from './export/studyExport';
import { annotatedEpubBytes, annotatedPdfBytes } from './export/studyMaterialAnnotations';
import { generateStudyQuestions } from './ai/studyQuestions';
import { onStudyMaterialIndexChanged, queueStudyMaterialIndex, reindexStudyMaterial } from './ai/studyMaterialIndex';
import {
  getStudyKnowledgeProgress,
  onStudyKnowledgeChanged,
  queueStudyKnowledgeSources,
  reanalyzeStudyKnowledgeSource,
} from './ai/studyKnowledge';
import * as studyKnowledgeRepo from './db/studyKnowledgeRepo';
import * as studyAssessments from './db/studyAssessmentsRepo';
import { buildStudyTest } from './ai/studyTests';
import * as studyGrading from './db/studyGradingRepo';
import { gradeStudyAnswer } from './ai/studyGrading';
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
import * as translationsRepo from './db/translationsRepo';
import { TRANSLATION_LANGUAGES } from '@shared/types';
import { translateMarkdown, titleFromMarkdown } from './ai/translate';
import * as workSummaries from './db/workSummariesRepo';
import * as projects from './db/projectsRepo';
import { closeDb, getDb } from './db/database';
import { exportWritingWorkshopDraft } from './export/writingWorkshopExport';
import { generateProjectSuggestions } from './ai/projectInsertion';
import { exportProject, exportProjectChapter } from './export/projectExport';
import {
  createVault,
  createVaultFromDatabaseFile,
  deleteVault,
  getActiveVault,
  getVault,
  listVaults,
  renameVault,
  resetVaultDatabase,
  setActiveVault,
  setVaultType,
} from './vaults/vaultRegistry';
import { reuseVaultAnalysisForWorks } from './vaults/vaultAnalysisImport';
import { initializeVaultModelSelection, validateVaultModelSelection } from './vaults/vaultCreationSettings';
import {
  createPerson,
  updatePerson,
  getPerson,
  listPersons,
  deletePerson,
  addPersonName,
  setPersonPortrait,
  getPersonPortrait,
  updatePortraitFocus,
  clearPersonPortrait,
  setPersonFrame,
  createPlace,
  listPlaces,
  updatePlace,
  findOrCreatePlace,
  findOrCreateGazetteerPlace,
  createEvent,
  updateEvent,
  getEvent,
  deleteEvent,
  listEvents,
  addParticipant,
  removeParticipant,
  addRecordEvidence,
  listEvidenceFor,
  deleteRecordEvidence,
  recordCounts,
} from './db/entitiesRepo';
import {
  createFolder,
  listFolders,
  renameFolder,
  deleteFolder,
  listItemFolders,
  setItemFolders,
  createItem,
  getItem,
  getItemBlob,
  listItems,
  updateItem,
  deleteItem,
  addTag,
  removeTag,
  listTags,
  archiveCounts,
  linkItemPerson,
  unlinkItemPerson,
  listItemsForPerson,
} from './db/archiveRepo';
import { ingestArchiveFile, replaceArchiveFile } from './archive/archiveIngest';
import * as dbMode from './db/databasesRepo';
import * as databaseChatHistory from './db/databaseChatRepo';
import { setPersistentDockIcon } from './dockIcon';
import { closeCrossVaultConnections } from './db/crossVault';
import { runAiCell, runAiColumn } from './ai/databaseAiColumn';
import { runAiImageCell, runAiImageColumn } from './ai/databaseAiImageColumn';
import { getDatabaseProfile, generateAnalysisReport, suggestDatabaseAnalyses, runDatabaseAnalysis, narrateAnalysisResult } from './ai/databaseAnalysis';
import type { AnalysisRequest, AnalysisResult } from '@shared/analysisSpec';
import { streamDatabaseChat, type DatabaseChatRequest } from './ai/databaseChat';
import { exportDatabase } from './export/databaseExport';
import type { ExportFormat } from '@shared/databaseExport';
import { parseCsv, detectDelimiter } from './extraction/tabular';
import { buildCsvImportPlan } from '@shared/databaseCsv';
import { matchFilesToRows } from '@shared/databaseBulk';
import type { DatabaseColumnConfig, DatabaseColumnType, RelationTargetKind } from '@shared/databases';
import type { SavedViewInput } from '@shared/databaseFilters';
import { scanArchiveTextRecords, scanWorkRecords } from './ai/recordsScan';
import { analyzeImageBytes } from './ai/imageAnalysis';
import { generatePersonBiography } from './ai/personBiography';
import { isVisionMime } from '@shared/imageAnalysis';
import {
  addRelationship,
  updateRelationship,
  removeRelationship,
  listRelationshipsForPerson,
  allRelationships,
  kinOf,
} from './db/relationshipsRepo';
import { importGedcom, exportGedcom } from './genealogy/gedcomBridge';
import { findMatchCandidates, mergePersons, dismissMatch } from './db/matchRepo';
import {
  listSocialContacts,
  getSocialContact,
  createSocialContact,
  updateSocialContact,
  deleteSocialContact,
  listSocialRelationsForPerson,
  listSocialRelationsTargetingPerson,
  listSocialRelationsTargetingContact,
  createSocialRelation,
  updateSocialRelation,
  deleteSocialRelation,
  socialGraph,
} from './db/socialRepo';
import { searchGazetteer } from './geo/gazetteer';
import {
  addPersonPlace,
  updatePersonPlace,
  deletePersonPlace,
  listPersonPlaces,
  mapPoints,
} from './db/personPlacesRepo';
import {
  listOpenSuggestions,
  listSuggestionsForPerson,
  confirmSuggestion,
  dismissSuggestion,
  openSuggestionCount,
} from './db/kinshipSuggestionsRepo';
import {
  embedArchiveItem,
  embedArchiveBacklog,
  archiveIndexStatus,
  suggestPersonsForItem,
  suggestDocumentsForPerson,
} from './archive/archiveDiscovery';

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

function withVaultKeyProviders(vault: VaultSummary): VaultSummary {
  return { ...vault, apiKeyProviders: listApiKeyProvidersForVault(vault.id) };
}

function vaultBusyMessage(): string | null {
  if (scanQueue.isBusy()) {
    return 'No se puede cambiar de bóveda con la cola de análisis activa. Pausa o termina los trabajos pendientes antes de cargar otra bóveda.';
  }
  if (getEmbeddingSnapshot().running) {
    return 'No se puede cambiar de bóveda mientras se están indexando embeddings de ideas.';
  }
  if (getPassageSnapshot().running) {
    return 'No se puede cambiar de bóveda mientras se están indexando pasajes.';
  }
  if (isSemanticBridgeRunning()) {
    return 'No se puede cambiar de bóveda mientras se descubren relaciones semánticas.';
  }
  return null;
}

function vaultSwitchMessage(base: string, copiedProviders: VaultSwitchResult['copiedProviders']): string {
  const parts = [base];
  if (copiedProviders.length > 0) parts.push(`Claves API copiadas: ${copiedProviders.length}.`);
  return parts.join(' ');
}

/** Best-effort MIME type from a file extension, for database attachments. */
function dbGuessMime(ext: string): string | null {
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.epub': 'application/epub+zip',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.csv': 'text/csv',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.json': 'application/json',
  };
  return map[ext.toLowerCase()] ?? null;
}

async function importStudyMaterialPaths(paths: string[], input: StudyMaterialImportInput = {}) {
  const results: Awaited<ReturnType<typeof studyMaterials.importStudyMaterialFile>>[] = [];
  const visit = async (filePath: string): Promise<void> => {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(filePath, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        await visit(path.join(filePath, entry.name));
      }
      return;
    }
    if (path.extname(filePath).toLowerCase() === '.zip') {
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nodus-study-import-'));
      try {
        const entries = new AdmZip(filePath).getEntries().filter((entry) => !entry.isDirectory);
        let index = 0;
        for (const entry of entries) {
          const name = path.basename(entry.entryName);
          if (!name || !studyMaterials.supportsStudyMaterial(name)) continue;
          const extracted = path.join(temp, `${String(index++).padStart(4, '0')}-${name}`);
          fs.writeFileSync(extracted, entry.getData());
          results.push(await studyMaterials.importStudyMaterialFile(extracted, input));
        }
      } finally { fs.rmSync(temp, { recursive: true, force: true }); }
      return;
    }
    if (studyMaterials.supportsStudyMaterial(filePath)) results.push(await studyMaterials.importStudyMaterialFile(filePath, input));
  };
  for (const selected of paths) await visit(selected);
  return results;
}

/** Register every IPC channel backing the window.nodus API. */
export function registerIpc(
  getWindow: () => BrowserWindow | null,
  checkForUpdates: () => Promise<UpdateCheckResponse>,
  installUpdate: () => Promise<UpdateCheckResponse>
): void {
  const h = ipcMain.handle.bind(ipcMain);

  // In-flight research-chat streams, keyed by requestId, so the renderer's Stop
  // button (`research:chatStream:cancel`) can abort the provider mid-answer.
  const chatAborters = new Map<string, AbortController>();
  const nodiChatAborters = new Map<string, AbortController>();
  const studyImproveAborters = new Map<string, AbortController>();
  const studyAssistantAborters = new Map<string, AbortController>();
  const studyGradingAborters = new Map<string, AbortController>();

  const emitVaultChanged = () => {
    const payload = withVaultKeyProviders(getActiveVault());
    // Broadcast to every window (main + the Nodi overlay) so Nodi's per-vault look
    // updates live wherever it is shown.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('vaults:changed', payload);
    }
  };

  const switchVaultSafely = async (id: string, options?: VaultSwitchOptions): Promise<VaultSwitchResult> => {
    const target = getVault(id);
    if (!target) {
      return { ok: false, message: 'Bóveda no encontrada.', copiedProviders: [] };
    }

    const sourceVaultId = options?.copyApiKeysFromVaultId?.trim() || null;
    if (sourceVaultId && sourceVaultId !== id && !getVault(sourceVaultId)) {
      return { ok: false, message: 'No se encontró la bóveda de origen de las claves API.', copiedProviders: [] };
    }

    let copiedProviders: VaultSwitchResult['copiedProviders'] = [];
    if (getActiveVault().id === id) {
      if (sourceVaultId && sourceVaultId !== id) {
        copiedProviders = copyApiKeysBetweenVaults(sourceVaultId, id);
      }
      const activeVault = withVaultKeyProviders(getActiveVault());
      emitVaultChanged();
      return {
        ok: true,
        message: vaultSwitchMessage('Esta bóveda ya está cargada.', copiedProviders),
        activeVault,
        copiedProviders,
      };
    }

    const busy = vaultBusyMessage();
    if (busy) return { ok: false, message: busy, copiedProviders: [] };

    if (sourceVaultId && sourceVaultId !== id) {
      if (!getVault(sourceVaultId)) {
        return { ok: false, message: 'No se encontró la bóveda de origen de las claves API.', copiedProviders: [] };
      }
      copiedProviders = copyApiKeysBetweenVaults(sourceVaultId, id);
    }

    stopRealtimeSync();
    await stopMcpServer();
    await stopCopilotServer();
    interruptDecorativeImageGenerations();
    closeCrossVaultConnections(); // drop read-only handles to sibling vaults before switching
    closeDb();
    setActiveVault(id);
    getDb();
    reconcileAuthorLayerOnce();

    const settings = getSettings();
    if (settings.syncMode === 'realtime') startRealtimeSync();
    if (settings.mcpEnabled) void startMcpServer();
    if (settings.copilotEnabled) void startCopilotServer();

    const activeVault = withVaultKeyProviders(getActiveVault());
    emitVaultChanged();
    return {
      ok: true,
      message: vaultSwitchMessage('Bóveda cargada.', copiedProviders),
      activeVault,
      copiedProviders,
    };
  };

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
    if (patch.mascotEnabled !== undefined || patch.mascotAlwaysOnTop !== undefined) {
      applyMascotWindow();
    }
    // Let other windows (the Nodi overlay) react to setting changes, e.g. costumes.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('settings:changed', next);
    }
    return next;
  });

  // Nodi companion: notifications, chat, and overlay-window helpers.
  h('nodi:tutorialVisible', (_e, visible: boolean) => setMascotTutorialVisible(Boolean(visible)));
  setNotificationsNotifier(() => {
    const list = listNotifications();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('nodi:notifications:changed', list);
    }
  });
  h('nodi:notifications:list', async () => listNotifications());
  h('nodi:notifications:markRead', async () => {
    markAllNotificationsRead();
    return listNotifications();
  });
  h('nodi:notifications:clear', async () => {
    clearNotifications();
    return listNotifications();
  });
  h('nodi:conversations:list', async () => listNodiConversations());
  h('nodi:conversations:get', async (_e, id: string) => getNodiConversation(id));
  h('nodi:conversations:save', async (_e, input) => saveNodiConversation(input));
  h('nodi:conversations:delete', async (_e, id: string) => deleteNodiConversation(id));
  h('nodi:conversations:clear', async () => clearNodiConversations());
  h('nodi:chatStream', async (e, requestId: string, request: NodiChatRequest) => {
    const controller = new AbortController();
    nodiChatAborters.set(requestId, controller);
    try {
      return await streamNodiChat(request, (delta) => e.sender.send('nodi:chatStream:delta', requestId, delta), controller.signal);
    } finally {
      nodiChatAborters.delete(requestId);
    }
  });
  h('nodi:chatStream:cancel', async (_e, requestId: string) => {
    nodiChatAborters.get(requestId)?.abort();
  });
  h('nodi:viewContext:set', async (_e, context) => setNodiViewContext(context));
  h('nodi:viewContext:get', async () => getNodiViewContext());
  // The transparent always-on-top overlay forwards mouse events except where Nodi
  // (or an open panel) sits, so clicks pass through to the apps behind it.
  h('nodi:setMouseIgnore', async (e, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
  });
  h('nodi:setExpanded', async (e, expanded: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { x: 16, y: 16, horizontal: 'left', vertical: 'up' };
    const nextPlacement = setMascotWindowExpanded(win, Boolean(expanded));
    win.setIgnoreMouseEvents(!expanded, { forward: true });
    if (expanded) win.focus();
    return nextPlacement;
  });
  h('nodi:openMainWindow', async () => {
    const win = getWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  h('nodi:openSettings', async () => {
    const win = getWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('nodi:navigate', 'settings');
    }
  });
  h('nodi:windowDrag:begin', async (e, screenX: number, screenY: number) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { x: 16, y: 16, horizontal: 'left', vertical: 'up' };
    return beginMascotWindowDrag(win, screenX, screenY);
  });
  h('nodi:windowDrag:move', async (e, screenX: number, screenY: number) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { x: 16, y: 16, horizontal: 'left', vertical: 'up' };
    return dragMascotWindow(win, screenX, screenY);
  });
  h('nodi:windowDrag:end', async () => {
    endMascotWindowDrag();
  });
  h('vaults:list', async () => listVaults().map(withVaultKeyProviders));
  h('vaults:getActive', async () => withVaultKeyProviders(getActiveVault()));
  h('vaults:create', async (_e, input: CreateVaultInput) => {
    const modelSelection = validateVaultModelSelection(input);
    const vault = createVault(input.name, input.type);
    try {
      if (modelSelection) initializeVaultModelSelection(vault.path, modelSelection);
    } catch (cause) {
      deleteVault(vault.id, true);
      throw cause;
    }
    return { vault: withVaultKeyProviders(vault) };
  });
  h('vaults:rename', async (_e, id: string, name: string) => withVaultKeyProviders(renameVault(id, name)));
  h('vaults:setType', async (_e, id: string, type: VaultType) => withVaultKeyProviders(setVaultType(id, type)));
  h('vaults:switch', async (_e, id: string, options?: VaultSwitchOptions) => switchVaultSafely(id, options));
  h('vaults:duplicate', async (_e, id: string, name: string, options?: VaultSwitchOptions) => {
    const source = getVault(id);
    if (!source) throw new Error('Bóveda no encontrada.');
    const tmp = path.join(app.getPath('temp'), `nodus-vault-copy-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    try {
      if (source.active) {
        await getDb().backup(tmp);
      } else {
        fs.copyFileSync(source.path, tmp);
      }
      const vault = createVaultFromDatabaseFile(tmp, name, source.type);
      const hasExplicitSource = options && Object.prototype.hasOwnProperty.call(options, 'copyApiKeysFromVaultId');
      const keySource = hasExplicitSource ? options.copyApiKeysFromVaultId ?? null : id;
      const copiedProviders = keySource && keySource !== vault.id ? copyApiKeysBetweenVaults(keySource, vault.id) : [];
      return { vault: withVaultKeyProviders(vault), copiedProviders };
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  });
  h('vaults:delete', async (_e, id: string, deleteFiles?: boolean) => {
    deleteVault(id, Boolean(deleteFiles));
  });
  h('vaults:reset', async (_e, id: string) => {
    const target = getVault(id);
    if (!target) throw new Error('Bóveda no encontrada.');
    if (target.active) {
      const busy = vaultBusyMessage();
      if (busy) throw new Error(busy);
      stopRealtimeSync();
      await stopMcpServer();
      await stopCopilotServer();
      interruptDecorativeImageGenerations();
      closeDb();
      const reset = resetVaultDatabase(id);
      getDb();
      reconcileAuthorLayerOnce();
      const settings = getSettings();
      if (settings.syncMode === 'realtime') startRealtimeSync();
      if (settings.mcpEnabled) void startMcpServer();
      if (settings.copilotEnabled) void startCopilotServer();
      emitVaultChanged();
      return withVaultKeyProviders(reset);
    }
    return withVaultKeyProviders(resetVaultDatabase(id));
  });
  h('vaults:reuseAnalysis', async (_e, nodusIds: string[]) => {
    const busy = vaultBusyMessage();
    if (busy) throw new Error(busy);
    return reuseVaultAnalysisForWorks(nodusIds);
  });
  h('vaults:copyApiKeys', async (_e, sourceVaultId: string, targetVaultId: string) => ({
    copiedProviders: copyApiKeysBetweenVaults(sourceVaultId, targetVaultId),
  }));
  // ── Records ontology (persons / places / events / evidence) ────────────────
  h('entities:counts', async () => recordCounts());
  h('entities:listPersons', async (_e, search?: string) => listPersons({ search }));
  h('entities:getPerson', async (_e, id: string) => getPerson(id));
  h('entities:createPerson', async (_e, input: PersonInput) => createPerson(input));
  h('entities:updatePerson', async (_e, id: string, patch: Partial<PersonInput>) => updatePerson(id, patch));
  h('entities:deletePerson', async (_e, id: string) => {
    deletePerson(id);
  });
  h('entities:addPersonName', async (_e, id: string, name: string, kind?: string | null) =>
    addPersonName(id, name, kind ?? null)
  );
  // Portraits
  h('entities:setPersonPortraitFromFile', async (_e, personId: string) => {
    const win = getWindow();
    const picked = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Elegir retrato',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const filePath = picked.filePaths[0];
    const bytes = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.bmp' ? 'image/bmp' : ext === '.tif' || ext === '.tiff' ? 'image/tiff' : 'image/jpeg';
    setPersonPortrait(personId, bytes, mime);
    return getPerson(personId);
  });
  h('entities:getPersonPortrait', async (_e, personId: string) => getPersonPortrait(personId));
  h('entities:updatePortraitFocus', async (
    _e,
    personId: string,
    focus: { focusX: number; focusY: number; scale: number }
  ) => {
    updatePortraitFocus(personId, focus);
  });
  h('entities:clearPersonPortrait', async (_e, personId: string) => {
    clearPersonPortrait(personId);
  });
  h('entities:generatePersonPortraitReference', async (_e, personId: string, description: string) => {
    await generatePersonPortraitFromDescription(personId, description);
    return getPerson(personId);
  });
  h('entities:listPlaces', async () => listPlaces());
  h('entities:createPlace', async (_e, input: PlaceInput) => createPlace(input));
  h('entities:findOrCreatePlace', async (_e, name: string, kind?: string | null) => findOrCreatePlace(name, kind ?? null));
  h('entities:updatePlace', async (_e, id: string, patch: Partial<PlaceInput>) => updatePlace(id, patch));
  // Offline gazetteer + per-person place records (map)
  h('geo:search', async (_e, query: string, limit?: number) => searchGazetteer(query, limit ?? 12));
  h('geo:resolve', async (_e, place: GazetteerPlace) =>
    findOrCreateGazetteerPlace({
      gazetteerId: place.gazetteerId,
      name: place.name,
      admin1: place.admin1,
      country: place.country,
      countryCode: place.countryCode,
      latitude: place.latitude,
      longitude: place.longitude,
    })
  );
  h('places:listForPerson', async (_e, personId: string) => listPersonPlaces(personId));
  h('places:add', async (_e, input: PersonPlaceInput) => addPersonPlace(input));
  h('places:update', async (_e, id: string, patch: Partial<PersonPlaceInput>) => updatePersonPlace(id, patch));
  h('places:delete', async (_e, id: string) => {
    deletePersonPlace(id);
  });
  h('places:mapPoints', async (_e, personIds?: string[]) => mapPoints(personIds));
  h('entities:listEvents', async (
    _e,
    opts?: { personId?: string; type?: HistoricalEventType; from?: string; to?: string }
  ) => listEvents(opts ?? {}));
  h('entities:getEvent', async (_e, id: string) => getEvent(id));
  h('entities:createEvent', async (_e, input: EventInput) => createEvent(input));
  h('entities:updateEvent', async (_e, id: string, patch: Partial<EventInput>) => updateEvent(id, patch));
  h('entities:deleteEvent', async (_e, id: string) => {
    deleteEvent(id);
  });
  h('entities:addParticipant', async (_e, eventId: string, personId: string, role: ParticipantRole) =>
    addParticipant(eventId, personId, role)
  );
  h('entities:removeParticipant', async (_e, eventId: string, personId: string, role: ParticipantRole) =>
    removeParticipant(eventId, personId, role)
  );
  h('entities:addEvidence', async (_e, input: RecordEvidenceInput) => addRecordEvidence(input));
  h('entities:listEvidence', async (_e, targetKind: RecordEvidenceTargetKind, targetId: string) =>
    listEvidenceFor(targetKind, targetId)
  );
  h('entities:deleteEvidence', async (_e, id: string) => {
    deleteRecordEvidence(id);
  });
  // kinship (genealogy)
  h('entities:addRelationship', async (
    _e,
    fromPerson: string,
    toPerson: string,
    type: RelationshipType,
    provenance?: RelationshipProvenance,
    subtype?: RelationshipSubtype
  ) => addRelationship(fromPerson, toPerson, type, provenance ?? 'user_asserted', subtype ?? null));
  h('entities:updateRelationship', async (
    _e,
    relId: string,
    fromPerson: string,
    toPerson: string,
    type: RelationshipType,
    subtype?: RelationshipSubtype
  ) => updateRelationship(relId, fromPerson, toPerson, type, subtype ?? null));
  h('entities:setPersonFrame', async (_e, personId: string, frameStyle: string | null) => {
    setPersonFrame(personId, frameStyle);
  });
  h('entities:generateBiography', async (_e, personId: string) => generatePersonBiography(personId));
  h('entities:removeRelationship', async (_e, relId: string) => {
    removeRelationship(relId);
  });
  h('entities:listRelationships', async (_e, personId: string) => listRelationshipsForPerson(personId));
  h('entities:allRelationships', async () => allRelationships());
  h('entities:kinOf', async (_e, personId: string) => kinOf(personId));
  // Identity matching (record linkage)
  h('entities:findMatches', async () => findMatchCandidates());
  h('entities:mergePersons', async (_e, targetId: string, sourceId: string) => mergePersons(targetId, sourceId));
  h('entities:dismissMatch', async (_e, a: string, b: string) => {
    dismissMatch(a, b);
  });
  // Social-relations network (independent from kinship)
  h('social:listContacts', async (_e, search?: string) => listSocialContacts({ search }));
  h('social:getContact', async (_e, id: string) => getSocialContact(id));
  h('social:createContact', async (_e, input: SocialContactInput) => createSocialContact(input));
  h('social:updateContact', async (_e, id: string, patch: Partial<SocialContactInput>) => updateSocialContact(id, patch));
  h('social:deleteContact', async (_e, id: string) => {
    deleteSocialContact(id);
  });
  h('social:listRelationsForPerson', async (_e, personId: string) => listSocialRelationsForPerson(personId));
  h('social:listRelationsTargetingPerson', async (_e, personId: string) => listSocialRelationsTargetingPerson(personId));
  h('social:listRelationsTargetingContact', async (_e, contactId: string) => listSocialRelationsTargetingContact(contactId));
  h('social:createRelation', async (_e, input: SocialRelationInput) => createSocialRelation(input));
  h('social:updateRelation', async (_e, id: string, patch: Partial<SocialRelationInput>) => updateSocialRelation(id, patch));
  h('social:deleteRelation', async (_e, id: string) => {
    deleteSocialRelation(id);
  });
  h('social:graph', async () => socialGraph());
  // Evidence-driven kinship suggestions (AI proposes, the user disposes)
  h('kinship:listSuggestions', async () => listOpenSuggestions());
  h('kinship:suggestionsForPerson', async (_e, personId: string) => listSuggestionsForPerson(personId));
  h('kinship:suggestionCount', async () => openSuggestionCount());
  h('kinship:confirmSuggestion', async (_e, suggestionId: string) => confirmSuggestion(suggestionId));
  h('kinship:dismissSuggestion', async (_e, suggestionId: string) => dismissSuggestion(suggestionId));
  // Records lens on a Zotero library work (genealogy/primary-source vaults): resolve
  // the work's text like a deep scan, then extract persons/places/events from it, so
  // published/secondary sources feed the same tree as the evidence archive.
  h('works:scanRecords', async (_e, nodusId: string) => {
    const work = works.getWork(nodusId);
    if (!work) throw new Error('Obra no encontrada.');
    const settings = getSettings();
    const doc = await resolveWorkText(
      settings.zoteroUserId,
      work.zotero_key,
      settings.zoteroStoragePath,
      null,
      work.doi ?? null,
      {
        unpaywallEmail: settings.unpaywallEmail,
        preferZoteroFulltext: settings.preferZoteroFulltext,
        ocr: { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages },
      },
      work.item_type
    );
    if (!doc.text || !doc.text.trim()) return { persons: 0, places: 0, events: 0, evidence: 0, linked: 0, suggestions: 0, noText: true };
    const model = settings.extractionModel ?? settings.synthesisModel ?? undefined;
    const result = await scanWorkRecords(nodusId, doc.text, model);
    return { ...result, noText: false };
  });
  // Archive → person link discovery (proposals only)
  h('archive:suggestPersonsForItem', async (_e, itemId: string) => suggestPersonsForItem(itemId));
  h('archive:suggestDocumentsForPerson', async (_e, personId: string) => suggestDocumentsForPerson(personId));
  h('archive:index', async () => embedArchiveBacklog());
  h('archive:indexStatus', async () => archiveIndexStatus());
  // GEDCOM import / export
  h('genealogy:importGedcom', async () => {
    const win = getWindow();
    const picked = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Importar GEDCOM',
      properties: ['openFile'],
      filters: [{ name: 'GEDCOM', extensions: ['ged', 'gedcom'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const text = fs.readFileSync(picked.filePaths[0], 'utf8');
    return importGedcom(text);
  });
  h('genealogy:exportGedcom', async () => {
    const win = getWindow();
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Exportar GEDCOM',
      defaultPath: 'nodus.ged',
      filters: [{ name: 'GEDCOM', extensions: ['ged'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, exportGedcom(), 'utf8');
    return { path: picked.filePath };
  });

  // ── Evidence archive ───────────────────────────────────────────────────────
  const createArchiveEntries = async (
    input: ArchiveEntryCreateInput,
    filePaths: string[] = input.paths ?? []
  ): Promise<ArchiveIngestSummary> => {
    const paths = [...new Set(filePaths.filter((filePath) => typeof filePath === 'string' && filePath.trim()))];
    const settings = getSettings();
    const ocr = { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages };
    const visionModel = settings.visionModel ?? settings.extractionModel ?? settings.synthesisModel ?? null;
    let added = 0;
    let duplicates = 0;
    const items = [];

    if (paths.length === 0) {
      const item = createItem({
        title: input.title.trim() || 'Entrada sin título',
        kind: 'text',
        folderId: input.folderIds?.[0] ?? null,
        description: input.description?.trim() || null,
        source: input.source?.trim() || null,
        extractedText: input.extractedText?.trim() || null,
        docType: input.docType ?? null,
        metadata: input.metadata ?? null,
        tags: input.tags,
      });
      setItemFolders(item.itemId, input.folderIds ?? []);
      for (const personId of input.personIds ?? []) linkItemPerson(item.itemId, personId);
      items.push(getItem(item.itemId) ?? item);
      added = 1;
    } else {
      for (const filePath of paths) {
        const result = await ingestArchiveFile(filePath, {
          folderId: input.folderIds?.[0] ?? null,
          title: paths.length === 1 ? input.title.trim() || undefined : undefined,
          tags: input.tags,
          ocr,
          visionModel,
          docType: input.docType ?? null,
        });
        if (result.duplicate) {
          duplicates += 1;
          items.push(result.item);
          continue;
        }
        added += 1;
        const updated = updateItem(result.item.itemId, {
          description: input.description?.trim() || result.item.description,
          source: input.source?.trim() || null,
          extractedText: input.extractedText?.trim() || result.item.extractedText,
          docType: input.docType ?? null,
          metadata: input.metadata ?? null,
        }) ?? result.item;
        setItemFolders(updated.itemId, input.folderIds ?? []);
        for (const personId of input.personIds ?? []) linkItemPerson(updated.itemId, personId);
        items.push(getItem(updated.itemId) ?? updated);
      }
    }
    void embedArchiveBacklog().catch(() => undefined);
    return { added, duplicates, items };
  };

  h('archive:counts', async () => archiveCounts());
  h('archive:listFolders', async () => listFolders());
  h('archive:createFolder', async (_e, name: string, parentId?: string | null) => createFolder(name, parentId ?? null));
  h('archive:renameFolder', async (_e, id: string, name: string) => renameFolder(id, name));
  h('archive:deleteFolder', async (_e, id: string) => {
    deleteFolder(id);
  });
  h('archive:listItemFolders', async (_e, itemId: string) => listItemFolders(itemId));
  h('archive:setItemFolders', async (_e, itemId: string, folderIds: string[]) => setItemFolders(itemId, folderIds));
  h('archive:listItems', async (_e, opts?: ArchiveListOptions) => listItems(opts ?? {}));
  h('archive:getItem', async (_e, id: string) => getItem(id));
  h('archive:getItemBlob', async (_e, id: string) => getItemBlob(id));
  h('archive:createItem', async (_e, input: ArchiveItemInput) => createItem(input));
  h('archive:updateItem', async (_e, id: string, patch: Partial<ArchiveItemInput>) => updateItem(id, patch));
  h('archive:deleteItem', async (_e, id: string) => {
    deleteItem(id);
  });
  h('archive:addTag', async (_e, id: string, tag: string) => {
    addTag(id, tag);
  });
  h('archive:removeTag', async (_e, id: string, tag: string) => {
    removeTag(id, tag);
  });
  h('archive:listTags', async () => listTags());
  h('archive:linkPerson', async (_e, itemId: string, personId: string) => {
    linkItemPerson(itemId, personId);
  });
  h('archive:unlinkPerson', async (_e, itemId: string, personId: string) => {
    unlinkItemPerson(itemId, personId);
  });
  h('archive:listItemsForPerson', async (_e, personId: string) => listItemsForPerson(personId));
  h('archive:scanItem', async (_e, itemId: string) => {
    const item = getItem(itemId);
    if (!item) throw new Error('Elemento no encontrado.');
    if (!item.extractedText || !item.extractedText.trim()) {
      return { persons: 0, places: 0, events: 0, evidence: 0, noText: true };
    }
    const settings = getSettings();
    const model = settings.extractionModel ?? settings.synthesisModel ?? undefined;
    const result = await scanArchiveTextRecords(itemId, item.extractedText, model);
    // Index the item so it can be discovered semantically (best-effort).
    await embedArchiveItem(itemId).catch(() => false);
    return { ...result, noText: false };
  });
  h('archive:pickAndIngest', async (_e, folderId?: string | null, docType?: string | null) => {
    const win = getWindow();
    const picked = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Añadir al archivo de evidencias',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documentos y datos', extensions: ['pdf', 'epub', 'txt', 'md', 'csv', 'xlsx'] },
        { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp', 'bmp'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { added: 0, duplicates: 0, items: [] };
    const settings = getSettings();
    const ocr = { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages };
    const visionModel = settings.visionModel ?? settings.extractionModel ?? settings.synthesisModel ?? null;
    let added = 0;
    let duplicates = 0;
    const items = [];
    for (const filePath of picked.filePaths) {
      const result = await ingestArchiveFile(filePath, { folderId: folderId ?? null, ocr, visionModel, docType: docType ?? null });
      if (result.duplicate) duplicates++;
      else added++;
      items.push(result.item);
    }
    // Index the freshly ingested text for semantic discovery, in the background.
    void embedArchiveBacklog().catch(() => undefined);
    return { added, duplicates, items };
  });
  h('archive:chooseEntryFiles', async () => {
    const picked = await dialog.showOpenDialog(getWindow() ?? undefined!, {
      title: 'Adjuntar archivos a la entrada genealógica',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Todos los archivos', extensions: ['*'] }],
    });
    return picked.canceled ? [] : picked.filePaths;
  });
  h('archive:createEntry', async (_e, input: ArchiveEntryCreateInput) => createArchiveEntries(input));
  h('archive:importZoteroEntry', async (_e, input: ZoteroArchiveEntryImportInput) => {
    const { zoteroUserId } = getSettings();
    const canonicalItemKey = input.library.type === 'group' ? `groups:${input.library.id}:${input.itemKey}` : input.itemKey;
    const item = await zotero.getItem(zoteroUserId, canonicalItemKey, input.library);
    if (!item) throw new Error('El elemento ya no está disponible en Zotero.');
    const attachments = await zotero.itemAttachments(zoteroUserId, canonicalItemKey, input.library);
    const attachment = attachments.find((candidate) => candidate.itemKey === input.attachmentKey || candidate.key === input.attachmentKey);
    if (!attachment) throw new Error('Elige un adjunto para importarlo a Nodus.');
    const filePath = await zotero.attachmentFilePath(zoteroUserId, attachment.key);
    if (!filePath || !fs.existsSync(filePath)) throw new Error('El adjunto no está descargado en este equipo. Ábrelo o descárgalo primero desde Zotero.');
    return createArchiveEntries({
      ...input,
      title: input.title.trim() || item.title,
      source: input.source?.trim() || item.url || `Zotero · ${item.title}`,
      tags: input.tags?.length ? input.tags : item.tags,
    }, [filePath]);
  });
  // A typed text entry (diary page, note, memoir) with no file to upload.
  h('archive:createTextEntry', async (
    _e,
    input: { title: string; content: string; folderId?: string | null; docType?: string | null; metadata?: Record<string, string> | null; source?: string | null; tags?: string[] }
  ) =>
    createItem({
      title: input.title,
      kind: 'text',
      folderId: input.folderId ?? null,
      extractedText: input.content?.trim() ? input.content : null,
      docType: input.docType ?? null,
      metadata: input.metadata ?? null,
      source: input.source ?? null,
      tags: input.tags,
    })
  );
  h('archive:replaceFile', async (_e, itemId: string) => {
    const item = getItem(itemId);
    if (!item) throw new Error('Elemento no encontrado.');
    const win = getWindow();
    const picked = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Reemplazar el archivo adjunto',
      properties: ['openFile'],
      filters: [
        { name: 'Documentos y datos', extensions: ['pdf', 'epub', 'txt', 'md', 'csv', 'xlsx'] },
        { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'webp', 'bmp'] },
        { name: 'Todos los archivos', extensions: ['*'] },
      ],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { replaced: false, item };
    const settings = getSettings();
    const ocr = { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages };
    const visionModel = settings.visionModel ?? settings.extractionModel ?? settings.synthesisModel ?? null;
    const updated = await replaceArchiveFile(itemId, picked.filePaths[0], { ocr, visionModel });
    if (updated) await embedArchiveItem(itemId).catch(() => false);
    return { replaced: Boolean(updated), item: updated ?? item };
  });
  h('archive:analyzeItem', async (_e, itemId: string) => {
    const item = getItem(itemId);
    if (!item) throw new Error('Elemento no encontrado.');
    if (item.kind !== 'image' || !isVisionMime(item.mimeType)) return { unsupported: true, description: null };
    const blob = getItemBlob(itemId);
    if (!blob) return { unsupported: true, description: null };
    const settings = getSettings();
    const model = settings.visionModel ?? settings.extractionModel ?? settings.synthesisModel ?? null;
    if (!model) throw new Error('No hay un modelo de visión configurado. Elígelo en Ajustes.');
    const analysis = await analyzeImageBytes(blob, item.mimeType!, model);
    if (!analysis) return { unsupported: true, description: null };
    updateItem(itemId, {
      description: analysis.description || null,
      extractedText: analysis.text.trim() ? analysis.text : item.extractedText,
    });
    await embedArchiveItem(itemId).catch(() => false);
    return { unsupported: false, description: analysis.description || null };
  });

  // ── Databases mode (Notion-like structured data) ───────────────────────────
  h('db:list', async () => dbMode.listDatabases());
  h('db:search', async (_e, query: string, includeContent: boolean) => dbMode.searchDatabases(query, includeContent));
  h('db:searchRows', async (_e, query: string, limit?: number) => dbMode.searchDatabaseRows(query, limit));
  h('db:get', async (_e, id: string) => dbMode.getDatabase(id));
  h('db:detail', async (_e, id: string) => dbMode.getDatabaseDetail(id));
  h('db:stats', async (_e, id: string) => dbMode.databaseStats(id));
  h('db:create', async (_e, name: string, icon?: string | null) => dbMode.createDatabase(name, icon ?? null));
  h('db:rename', async (_e, id: string, name: string) => dbMode.renameDatabase(id, name));
  h('db:setIcon', async (_e, id: string, icon: string | null) => dbMode.setDatabaseIcon(id, icon));
  h('db:delete', async (_e, id: string) => {
    dbMode.deleteDatabase(id);
  });
  h('db:reorder', async (_e, ids: string[]) => {
    dbMode.reorderDatabases(ids);
  });
  h('db:createColumn', async (_e, databaseId: string, name: string, type: DatabaseColumnType, config?: DatabaseColumnConfig) =>
    dbMode.createColumn(databaseId, name, type, config ?? {})
  );
  h('db:updateColumn', async (_e, id: string, patch: { name?: string; type?: DatabaseColumnType; config?: DatabaseColumnConfig }) =>
    dbMode.updateColumn(id, patch)
  );
  h('db:deleteColumn', async (_e, id: string) => {
    dbMode.deleteColumn(id);
  });
  h('db:reorderColumns', async (_e, databaseId: string, ids: string[]) => {
    dbMode.reorderColumns(databaseId, ids);
  });
  h('db:addOption', async (_e, columnId: string, label: string, color?: string | null) =>
    dbMode.addOption(columnId, label, color ?? null)
  );
  h('db:updateOption', async (_e, id: string, patch: { label?: string; color?: string | null }) => {
    dbMode.updateOption(id, patch);
  });
  h('db:deleteOption', async (_e, id: string) => {
    dbMode.deleteOption(id);
  });
  h('db:reorderOptions', async (_e, columnId: string, ids: string[]) => {
    dbMode.reorderOptions(columnId, ids);
  });
  h('db:listRows', async (_e, databaseId: string, opts?: { sort?: dbMode.DatabaseRowSort; limit?: number; offset?: number }) =>
    dbMode.listRows(databaseId, opts ?? {})
  );
  h('db:getRow', async (_e, id: string) => dbMode.getRow(id));
  h('db:createRow', async (_e, databaseId: string) => dbMode.createRow(databaseId));
  h('db:deleteRow', async (_e, id: string) => {
    dbMode.deleteRow(id);
  });
  h('db:setCell', async (_e, rowId: string, columnId: string, raw: string | null) => dbMode.setCell(rowId, columnId, raw));
  h('db:listAttachments', async (_e, rowId: string, columnId: string) => dbMode.listAttachments(rowId, columnId));
  h('db:getAttachmentBlob', async (_e, id: string) => dbMode.getAttachmentBlob(id));
  h('db:deleteAttachment', async (_e, id: string) => {
    dbMode.deleteAttachment(id);
  });
  h('db:downloadAttachment', async (_e, id: string) => {
    const att = dbMode.getAttachment(id);
    const blob = dbMode.getAttachmentBlob(id);
    if (!att || !blob) return { canceled: true, path: null };
    const win = getWindow();
    const picked = await dialog.showSaveDialog(win ?? undefined!, {
      title: 'Descargar adjunto',
      defaultPath: att.fileName ?? 'adjunto',
    });
    if (picked.canceled || !picked.filePath) return { canceled: true, path: null };
    fs.writeFileSync(picked.filePath, blob);
    return { canceled: false, path: picked.filePath };
  });
  h('db:runAiCell', async (_e, rowId: string, columnId: string) => runAiCell(rowId, columnId));
  h('db:runAiColumn', async (_e, databaseId: string, columnId: string) =>
    runAiColumn(databaseId, columnId, (done, total) =>
      getWindow()?.webContents.send('db:aiProgress', { columnId, done, total })
    )
  );
  h('db:generateAiImage', async (_e, rowId: string, columnId: string) => runAiImageCell(rowId, columnId));
  h('db:generateAiImageColumn', async (_e, databaseId: string, columnId: string) =>
    runAiImageColumn(databaseId, columnId, (done, total) =>
      getWindow()?.webContents.send('db:aiProgress', { columnId, done, total })
    )
  );
  h('db:pickBulkFiles', async () => {
    const win = getWindow();
    const picked = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Elegir archivos para subida masiva',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Todos los archivos', extensions: ['*'] }],
    });
    if (picked.canceled) return [];
    return picked.filePaths.map((p) => ({ name: path.basename(p), path: p }));
  });
  h('db:bulkAttach', async (_e, databaseId: string, refColumnId: string, attachmentColumnId: string, files: { name: string; path: string }[]) => {
    const rows = dbMode.listRows(databaseId).map((r) => ({ rowId: r.id, refValue: r.cells[refColumnId] ?? null }));
    const matches = matchFilesToRows(files.map((f) => f.name), rows);
    const rowByFile = new Map(matches.map((m) => [m.fileName, m.rowId]));
    const settings = getSettings();
    const ocr = { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages };
    const total = files.length;
    let attached = 0;
    let matched = 0;
    let done = 0;
    for (const f of files) {
      const rowId = rowByFile.get(f.name) ?? null;
      if (rowId) {
        matched++;
        try {
          const buf = fs.readFileSync(f.path);
          const contentHash = crypto.createHash('sha256').update(buf).digest('hex');
          if (!dbMode.attachmentExists(rowId, attachmentColumnId, contentHash)) {
            let extractedText: string | null = null;
            try {
              const doc = await extractFromPath(f.path, { ocr });
              extractedText = doc.text && doc.text.trim() ? doc.text : null;
            } catch {
              /* keep the blob even if extraction fails */
            }
            dbMode.addAttachment({
              rowId,
              columnId: attachmentColumnId,
              fileName: f.name,
              mimeType: dbGuessMime(path.extname(f.path)),
              bytes: buf.length,
              blob: buf,
              contentHash,
              extractedText,
            });
            attached++;
          }
        } catch {
          /* unreadable file — skip */
        }
      }
      done++;
      getWindow()?.webContents.send('db:bulkProgress', { databaseId, done, total, attached, matched, finished: false });
    }
    getWindow()?.webContents.send('db:bulkProgress', { databaseId, done: total, total, attached, matched, finished: true });
    return { attached, matched, unmatched: total - matched };
  });
  h('db:parseCsvForImport', async () => {
    const win = getWindow();
    const picked = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Importar CSV',
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv', 'tsv', 'txt'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const filePath = picked.filePaths[0];
    const text = fs.readFileSync(filePath, 'utf8');
    const parsed = parseCsv(text, detectDelimiter(text));
    return { fileName: path.basename(filePath), ...buildCsvImportPlan(parsed) };
  });
  h('db:createFromCsv', async (_e, name: string, headers: string[], rows: string[][], types: DatabaseColumnType[]) =>
    dbMode.createDatabaseFromCsv(name, headers, rows, types)
  );
  h('db:export', async (_e, databaseId: string, format: ExportFormat) => {
    const result = exportDatabase(databaseId, format);
    if (!result) return { canceled: true };
    const win = getWindow();
    const picked = await dialog.showSaveDialog(win ?? undefined!, { title: 'Exportar base de datos', defaultPath: result.fileName });
    if (picked.canceled || !picked.filePath) return { canceled: true };
    fs.writeFileSync(picked.filePath, result.content);
    return { canceled: false, path: picked.filePath };
  });
  h('db:profile', async (_e, databaseId: string) => getDatabaseProfile(databaseId));
  h('db:analyzeReport', async (_e, databaseId: string) => generateAnalysisReport(databaseId));
  h('db:suggestAnalyses', async (_e, databaseId: string) => suggestDatabaseAnalyses(databaseId));
  h('db:runAnalysis', async (_e, databaseId: string, request: AnalysisRequest) => runDatabaseAnalysis(databaseId, request));
  h('db:narrateAnalysis', async (_e, result: AnalysisResult) => narrateAnalysisResult(result));
  h('db:chatStream', async (e, requestId: string, request: DatabaseChatRequest) => {
    const controller = new AbortController();
    chatAborters.set(requestId, controller);
    try {
      return await streamDatabaseChat(request, (delta) => e.sender.send('db:chatStream:delta', requestId, delta), controller.signal);
    } finally {
      chatAborters.delete(requestId);
    }
  });
  h('db:chatStream:cancel', async (_e, requestId: string) => {
    chatAborters.get(requestId)?.abort();
  });
  h('db:chatHistory:list', async () => databaseChatHistory.listDatabaseChatConversations());
  h('db:chatHistory:get', async (_e, id: string) => databaseChatHistory.getDatabaseChatConversation(id));
  h('db:chatHistory:create', async (_e, input: { title: string; databaseIds: string[] }) => databaseChatHistory.createDatabaseChatConversation(input));
  h('db:chatHistory:save', async (_e, id: string, messages: import('@shared/types').DbChatTurn[], databaseIds: string[]) => databaseChatHistory.saveDatabaseChatConversation(id, messages, databaseIds));
  h('db:chatHistory:delete', async (_e, id: string) => databaseChatHistory.deleteDatabaseChatConversation(id));
  h('db:listViews', async (_e, databaseId: string) => dbMode.listViews(databaseId));
  h('db:createView', async (_e, databaseId: string, input: SavedViewInput) => dbMode.createView(databaseId, input));
  h('db:updateView', async (_e, id: string, patch: Partial<SavedViewInput>) => dbMode.updateView(id, patch));
  h('db:deleteView', async (_e, id: string) => {
    dbMode.deleteView(id);
  });
  h('db:listRelations', async (_e, rowId: string, columnId: string) => dbMode.listRelations(rowId, columnId));
  h('db:addRelation', async (_e, rowId: string, columnId: string, targetKind: RelationTargetKind, targetId: string, targetVaultId?: string | null) =>
    dbMode.addRelation(rowId, columnId, targetKind, targetId, targetVaultId ?? null)
  );
  h('db:removeRelation', async (_e, id: string) => {
    dbMode.removeRelation(id);
  });
  h('db:searchRelationTargets', async (_e, kind: RelationTargetKind, query: string, databaseId?: string) =>
    dbMode.searchRelationTargets(kind, query, { databaseId })
  );
  h('db:pickAndAttach', async (_e, rowId: string, columnId: string) => {
    const win = getWindow();
    const picked = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Adjuntar archivos',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Todos los archivos', extensions: ['*'] },
        { name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'tif', 'tiff', 'webp', 'bmp'] },
        { name: 'Documentos y datos', extensions: ['pdf', 'epub', 'txt', 'md', 'csv', 'xlsx', 'docx'] },
      ],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { added: 0, attachments: dbMode.listAttachments(rowId, columnId) };
    const settings = getSettings();
    const ocr = { enabled: settings.ocrEnabled, languages: settings.ocrLanguages, maxPages: settings.ocrMaxPages };
    let added = 0;
    for (const filePath of picked.filePaths) {
      const buf = fs.readFileSync(filePath);
      const contentHash = crypto.createHash('sha256').update(buf).digest('hex');
      if (dbMode.attachmentExists(rowId, columnId, contentHash)) continue;
      let extractedText: string | null = null;
      try {
        const doc = await extractFromPath(filePath, { ocr });
        extractedText = doc.text && doc.text.trim() ? doc.text : null;
      } catch {
        /* non-extractable file (e.g. an image with OCR off) — keep the blob anyway */
      }
      dbMode.addAttachment({
        rowId,
        columnId,
        fileName: path.basename(filePath),
        mimeType: dbGuessMime(path.extname(filePath)),
        bytes: buf.length,
        blob: buf,
        contentHash,
        extractedText,
      });
      added++;
    }
    return { added, attachments: dbMode.listAttachments(rowId, columnId) };
  });

  h('mcp:status', async () => getMcpStatus());
  h('mcp:regenerateToken', async () => regenerateMcpToken());
  h('copilot:status', async () => getCopilotStatus());
  h('copilot:regenerateToken', async () => regenerateCopilotToken());
  h('copilot:ensureCert', async () => {
    const result = await ensureCopilotCert();
    if (result.ok && getSettings().copilotEnabled) await restartCopilotServer();
    return result;
  });
  h('copilot:installAddin', async () => installCopilotAddin(app.getAppPath(), app.getVersion()));
  h('copilot:installLibreOffice', async () => installLibreOfficeCopilot(app.getAppPath()));
  h('app:info', async () => {
    const osName =
      process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : process.platform === 'linux' ? 'Linux' : process.platform;
    return {
      version: app.getVersion(),
      platform: process.platform,
      osName,
      osVersion: os.release(),
      arch: process.arch,
      electron: process.versions.electron ?? '',
    };
  });
  h('settings:setApiKey', async (_e, provider: AiProvider, key: string) => setApiKey(provider, key));
  h('settings:clearApiKey', async (_e, provider: AiProvider) => clearApiKey(provider));
  h('settings:recoverApiKeys', async (event) => {
    const result = await recoverLegacyApiKeys();
    if (result.recoveredProviders.length > 0) {
      const settings = getSettings();
      if (settings.autoBackupEnabled && settings.autoBackupFolder) await runAutoBackupNow(app.getVersion());
    }
    event.sender.send('settings:apiKeysRecovered', result);
    return result;
  });

  // AI model discovery (OpenRouter needs no key; others use the stored key).
  h('ai:listModels', async (_e, provider: AiProvider) => listModels(provider, getApiKey(provider)));
  h('ai:listEmbeddingModels', async (_e, provider: EmbeddingProvider) =>
    listEmbeddingModels(provider, getApiKey(provider))
  );
  h('ai:testLocalProvider', async (_e, provider: LocalProvider) => testLocalProvider(provider, getApiKey(provider)));
  h('ai:listImageModels', async () => listImageModels());
  h('ai:nodusLocal:status', async () => getNodusLocalAiStatus());
  h('ai:nodusLocal:installRuntime', async (event, requestId: string) =>
    installNodusLocalRuntime((fraction) => event.sender.send('ai:nodusLocal:progress', requestId, fraction)));
  h('ai:nodusLocal:downloadModel', async (event, requestId: string, model: string) =>
    downloadNodusLocalModel(model, (fraction) => event.sender.send('ai:nodusLocal:progress', requestId, fraction)));
  h('ai:nodusLocal:deleteModel', async (_event, model: string) => deleteNodusLocalModel(model));
  h('images:get', async (_e, entityKind: DecorativeImageEntityKind, entityId: string) =>
    getDecorativeImage(entityKind, entityId)
  );
  h('images:data', async (_e, entityKind: DecorativeImageEntityKind, entityId: string, thumbnail?: boolean) => {
    const data = getDecorativeImageData(entityKind, entityId, thumbnail);
    return data ? `data:${data.mimeType};base64,${data.bytes.toString('base64')}` : null;
  });
  h('images:queue', async (e, request: DecorativeImageActionRequest) =>
    queueDecorativeImageGeneration(request, (image) => {
      if (!e.sender.isDestroyed()) e.sender.send('images:changed', image);
    })
  );
  h('images:upload', async (e, entityKind: DecorativeImageEntityKind, entityId: string, bytes: Uint8Array, style?: DecorativeImageStyle) => {
    const image = await saveCustomDecorativeImage(entityKind, entityId, Buffer.from(bytes), style);
    if (!e.sender.isDestroyed()) e.sender.send('images:changed', image);
    return image;
  });
  h('images:revert', async (e, entityKind: DecorativeImageEntityKind, entityId: string) => {
    const image = revertDecorativeImage(entityKind, entityId);
    if (!e.sender.isDestroyed()) e.sender.send('images:changed', image);
    return image;
  });
  h('images:delete', async (_e, entityKind: DecorativeImageEntityKind, entityId: string) =>
    deleteDecorativeImage(entityKind, entityId)
  );

  // audio / text-to-speech. Synthesis runs in the renderer (Piper via WebAssembly);
  // the main process supplies the speakable segments and persists the resulting WAVs.
  h('audio:segments', async (_e, entityKind: AudioEntityKind, entityId: string, request?: AudioSegmentRequest) =>
    getEntitySegments(entityKind, entityId, request)
  );
  h('audio:listClips', async (_e, entityKind: AudioEntityKind, entityId: string) =>
    listEntityClips(entityKind, entityId)
  );
  h('audio:clearClips', async (_e, entityKind: AudioEntityKind, entityId: string) => {
    clearEntityClips(entityKind, entityId);
  });
  h('audio:saveClip', async (
    _e,
    entityKind: AudioEntityKind,
    entityId: string,
    input: { segmentIndex: number; segmentLabel: string; provider: AudioProvider; voice: string; language: string; bytes: Uint8Array }
  ) => saveClip(entityKind, entityId, { ...input, bytes: input.bytes }));
  h('audio:clipData', async (_e, clipId: string) => {
    const data = readClipBytes(clipId);
    return data ? `data:${data.mime};base64,${data.bytes.toString('base64')}` : null;
  });
  h('audio:deleteClip', async (_e, clipId: string) => {
    deleteAudioClip(clipId);
  });
  h('audio:deleteEntityClips', async (_e, entityKind: AudioEntityKind, entityId: string) => {
    deleteEntityClips(entityKind, entityId);
  });
  h('audio:exportClip', async (_e, clipId: string) => {
    const source = audioClipPath(clipId); if (!source) return null;
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, { title: 'Guardar audio', defaultPath: path.basename(source), filters: [{ name: 'Audio WAV', extensions: ['wav'] }] });
    if (picked.canceled || !picked.filePath) return null; fs.copyFileSync(source, picked.filePath); return { path: picked.filePath };
  });
  h('audio:study:bookmarks', async (_e, kind: AudioEntityKind, id: string) => listStudyAudioBookmarks(kind, id));
  h('audio:study:bookmark:create', async (_e, kind: AudioEntityKind, id: string, segmentIndex: number, label: string) => createStudyAudioBookmark(kind, id, segmentIndex, label));
  h('audio:study:bookmark:delete', async (_e, id: string) => deleteStudyAudioBookmark(id));
  h('audio:study:pronunciations', async (_e, subjectId: string) => getStudyPronunciations(subjectId));
  h('audio:study:pronunciations:set', async (_e, subjectId: string, entries: StudyPronunciationEntry[]) => setStudyPronunciations(subjectId, entries));
  h('audio:study:playlist', async (_e, subjectId: string) => listStudyAudioPlaylist(subjectId));

  // Hume (cloud TTS): key stays in the main process; the renderer only sees
  // whether a key exists, the voice list, and the resulting audio bytes.
  h('audio:humeStatus', async () => ({ hasKey: humeHasKey() }));
  h('audio:humeSetKey', async (_e, key: string) => {
    setHumeKey(key);
    return { hasKey: humeHasKey() };
  });
  h('audio:humeClearKey', async () => {
    clearHumeKey();
    return { hasKey: humeHasKey() };
  });
  h('audio:humeVoices', async (_e, language?: string) => listHumeVoices(language));
  h('audio:humeSynthesize', async (_e, voiceId: string, provider: 'HUME_AI' | 'CUSTOM_VOICE', text: string) => {
    const bytes = await synthesizeHume(voiceId, provider, text);
    return new Uint8Array(bytes);
  });

  // AI translations. The renderer assembles an entity's Markdown and passes it in;
  // the main process translates it (chunked, preserving citations) and stores one
  // copy per language.
  h('translations:list', async (_e, entityKind: TranslationEntityKind, entityId: string) =>
    translationsRepo.listContentTranslations(entityKind, entityId)
  );
  h('translations:get', async (_e, id: string) => translationsRepo.getContentTranslation(id));
  h('translations:generate', async (_e, request: GenerateTranslationRequest) => {
    const language = TRANSLATION_LANGUAGES.find((l) => l.code === request.language);
    if (!language) throw new Error(`Idioma de traducción no soportado: ${request.language}`);
    const source = request.sourceMarkdown.trim();
    if (!source) throw new Error('No hay contenido para traducir.');
    const pending = translationsRepo.beginContentTranslation({ entityKind: request.entityKind, entityId: request.entityId, language: language.code, languageLabel: language.nativeName, sourceTitle: request.sourceTitle, model: request.model ?? null });
    try {
      const markdown = await translateMarkdown({ markdown: source, language, model: request.model });
      return translationsRepo.upsertContentTranslation({
        entityKind: request.entityKind, entityId: request.entityId, language: language.code, languageLabel: language.nativeName,
        title: titleFromMarkdown(markdown, request.sourceTitle), markdown, model: request.model ?? null,
      });
    } catch (cause) {
      translationsRepo.failContentTranslation(pending.id, cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  });
  h('translations:delete', async (_e, id: string) => {
    translationsRepo.deleteContentTranslation(id);
  });

  // zotero
  h('zotero:ping', async () => {
    const res = await zotero.ping();
    // Local API always uses users/0; persist that so all later calls address it correctly.
    if (res.ok) updateSettings({ zoteroUserId: zotero.LOCAL_USER_ID });
    return res;
  });
  h('zotero:libraries', async () => zotero.libraries());
  h('zotero:collections', async (_e, library?: ZoteroLibrary) => {
    const { zoteroUserId } = getSettings();
    return zotero.topCollections(zoteroUserId, library);
  });
  h('zotero:childCollections', async (_e, parentKey: string, library?: ZoteroLibrary) => {
    const { zoteroUserId } = getSettings();
    return zotero.childCollections(zoteroUserId, parentKey, library);
  });
  h('zotero:collectionItems', async (_e, collectionKey: string, opts?: { query?: string; recursive?: boolean; library?: ZoteroLibrary }) => {
    const { zoteroUserId } = getSettings();
    return opts?.recursive
      ? zotero.collectionItemsRecursive(zoteroUserId, collectionKey, opts)
      : zotero.collectionItems(zoteroUserId, collectionKey, opts);
  });
  h('zotero:searchItems', async (_e, library: ZoteroLibrary, query: string) => zotero.searchItems(library, query));
  h('zotero:itemAttachments', async (_e, itemKey: string, library?: ZoteroLibrary) => {
    const { zoteroUserId } = getSettings();
    return zotero.itemAttachments(zoteroUserId, itemKey, library);
  });

  // works / library
  h('home:academicSnapshot', async () => {
    const stats = getAcademicHomeStats();
    return {
      stats,
      health: getCorpusHealth(),
      queue: scanQueue.snapshot(),
      latestSync: getSyncLog(1)[0] ?? null,
    };
  });
  h('works:list', async (_e, filter?: WorkFilter) => works.listWorks(filter));
  h('works:listPage', async (_e, filter, request) => works.listWorksPage(filter, request));
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
  h('works:rescanDegraded', async (_e, model?: ModelRef | null) => {
    // Re-scan works that only ever saw the abstract (e.g. the PDF wasn't attached/
    // indexed when they were first analysed). A bare enqueue is idempotent: if the
    // resolved text is unchanged, runDeepScan is a no-op and no tokens are spent.
    const rows = getDb()
      .prepare(
        "SELECT nodus_id, title FROM works WHERE archived = 0 AND deep_status = 'done' AND source_type IN ('abstract_only','none')"
      )
      .all() as { nodus_id: string; title: string }[];
    for (const w of rows) scanQueue.enqueue(w.nodus_id, w.title, 'deep', model);
    return rows.length;
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
  h('ideas:listDuplicates', async () => ideaDedupe.listDuplicateIdeas());
  h('ideas:merge', async (_e, canonicalId: string, duplicateIds: string[]) =>
    ideaDedupe.mergeIdeas(canonicalId, duplicateIds)
  );
  h('ideas:backup', async () => ideaDedupe.backupDatabase());
  h('works:openInZotero', async (_e, zoteroKey: string) => {
    const { zoteroUserId } = getSettings();
    await shell.openExternal(zoteroSelectUrl(zoteroKey));
    return zoteroUserId;
  });
  // Evidence → the exact PDF page in Zotero's reader. The [[p. N]] markers the
  // extractor writes are physical 1-based page indices, which is exactly what
  // zotero://open-pdf expects; when the location has no parseable page (or the
  // work has no PDF attachment) we fall back to selecting the item.
  h('works:openAtPage', async (_e, nodusId: string, location: string | null) => {
    const work = works.getWork(nodusId);
    if (!work?.zotero_key) return { ok: false, mode: 'none' as const };
    const page = parsePageNumber(location);
    if (page !== null) {
      const attachmentKey = await zotero.resolvePdfAttachmentKey(getSettings().zoteroUserId, work.zotero_key);
      if (attachmentKey) {
        await shell.openExternal(zoteroOpenPdfUrl(attachmentKey, page));
        return { ok: true, mode: 'pdf-page' as const, page };
      }
    }
    await shell.openExternal(zoteroSelectUrl(work.zotero_key));
    return { ok: true, mode: 'select' as const, page };
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
  h('graph:overview', async () => buildIdeaGraphOverview());
  h('graph:theme', async (_e, theme: string, cap?: number) => buildIdeaThemeGraph(theme, cap));
  h('ideas:listPage', async (_e, request) => ideas.listIdeasPage(request));
  h('ideas:connections', async (_e, globalId: string) => ideas.listIdeaConnections(globalId));
  h('graph:ideaDetail', async (_e, globalId: string) => ideas.getIdeaDetail(globalId));
  h('graph:edgeDetail', async (_e, edgeId: string) => ideas.getEdgeDetail(edgeId));
  h('graph:ideaEdges', async (_e, globalId: string) => ideas.getIdeaEdges(globalId));
  h('graph:edgeFeedback:set', async (_e, fromId: string, toId: string, type: string, verdict: 'rejected' | 'confirmed' | null, note?: string) =>
    setEdgeFeedback(fromId, toId, type, verdict, note ?? '')
  );
  h('graph:edgeFeedback:list', async () => listEdgeFeedback());
  h('works:ideasByWork', async (_e, nodusId: string, limit: number, offset: number) =>
    ideas.getIdeasByWork(nodusId, limit, offset)
  );
  h('works:getIdeaSynthesis', async (_e, nodusId: string) => getCachedWorkIdeaSynthesis(nodusId));
  h('works:synthesizeIdeas', async (_e, nodusId: string, model?: ModelRef | null) =>
    synthesizeWorkIdeas(nodusId, model)
  );
  h('graph:themes', async () => themes.listGraphThemes());

  // authors (dossier + synthesis matrix)
  h('authors:list', async () => listAuthors());
  h('authors:listPage', async (_e, request) => listAuthorsPage(request));
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
  h('study:workspace', async (_e, options?: StudyWorkspaceOptions) => studyOrg.getStudyWorkspace(options));
  h('study:schedule:get', async () => studySchedule.getStudySchedule());
  h('study:schedule:save', async (_e, schedule: StudySchedule) => studySchedule.saveStudySchedule(schedule));
  h('study:course:create', async (_e, input: CreateStudyCourseInput) => studyOrg.createStudyCourse(input));
  h('study:subject:create', async (_e, input: CreateStudySubjectInput) => studyOrg.createStudySubject(input));
  h('study:topic:create', async (_e, input: CreateStudyTopicInput) => studyOrg.createStudyTopic(input));
  h('study:folder:create', async (_e, input: CreateStudyFolderInput) => studyOrg.createStudyFolder(input));
  h('study:document:create', async (_e, input: CreateStudyDocumentInput) => {
    const result = studyOrg.createStudyDocument(input); queueStudyKnowledgeSources('document', [result.id]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:entity:update', async (_e, kind: StudyEntityKind, id: string, patch: Record<string, unknown>) =>
    studyOrg.updateStudyEntity(kind, id, patch));
  h('study:entity:move', async (_e, kind: 'subject' | 'folder' | 'topic', id: string, input: StudyEntityMoveInput) => {
    const result = studyOrg.moveStudyEntity(kind, id, input);
    const materialIds = (getDb().prepare('SELECT id FROM study_materials WHERE deleted_at IS NULL').all() as Array<{ id: string }>).map((row) => row.id);
    const documentIds = (getDb().prepare('SELECT id FROM study_docs WHERE deleted_at IS NULL').all() as Array<{ id: string }>).map((row) => row.id);
    for (const sourceId of materialIds) studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('material', sourceId);
    for (const sourceId of documentIds) studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('document', sourceId);
    queueStudyKnowledgeSources('material', materialIds); queueStudyKnowledgeSources('document', documentIds); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:placement:add', async (_e, documentId: string, input: StudyPlacementInput) => {
    const result = studyOrg.addStudyPlacement(documentId, input); studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('document', documentId);
    queueStudyKnowledgeSources('document', [documentId]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:placement:setPrimary', async (_e, documentId: string, input: StudyPlacementInput) => {
    const result = studyOrg.setPrimaryStudyPlacement(documentId, input); studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('document', documentId);
    queueStudyKnowledgeSources('document', [documentId]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:placement:remove', async (_e, id: string) => {
    const row = getDb().prepare('SELECT document_id FROM study_placements WHERE id=?').get(id) as { document_id: string } | undefined;
    const result = studyOrg.removeStudyPlacement(id); if (row) { studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('document', row.document_id); queueStudyKnowledgeSources('document', [row.document_id]); studySearch.queueStudySearchIndexRefresh(); }
    return result;
  });
  h('study:lifecycle:set', async (_e, kind: StudyEntityKind, id: string, action: StudyLifecycleAction) => {
    const result = studyOrg.setStudyLifecycle(kind, id, action);
    if (kind === 'document') { studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('document', id); if (action === 'restore' || action === 'recover') queueStudyKnowledgeSources('document', [id]); studySearch.queueStudySearchIndexRefresh(); }
    else {
      const materialIds = (getDb().prepare('SELECT id FROM study_materials WHERE deleted_at IS NULL').all() as Array<{ id: string }>).map((row) => row.id);
      const documentIds = (getDb().prepare('SELECT id FROM study_docs WHERE deleted_at IS NULL').all() as Array<{ id: string }>).map((row) => row.id);
      for (const sourceId of materialIds) studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('material', sourceId);
      for (const sourceId of documentIds) studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('document', sourceId);
      if (action === 'restore' || action === 'recover') { queueStudyKnowledgeSources('material', materialIds); queueStudyKnowledgeSources('document', documentIds); }
      studySearch.queueStudySearchIndexRefresh();
    }
    return result;
  });
  h('study:tree:duplicate', async (_e, kind: StudyEntityKind, id: string) => studyOrg.duplicateStudyTree(kind, id));
  h('study:tag:create', async (_e, input: CreateStudyTagInput) => studyOrg.createStudyTag(input));
  h('study:tag:update', async (_e, id: string, patch: Partial<CreateStudyTagInput> & { favorite?: boolean; position?: number }) =>
    studyOrg.updateStudyTag(id, patch));
  h('study:tag:delete', async (_e, id: string) => studyOrg.deleteStudyTag(id));
  h('study:document:setTags', async (_e, documentId: string, tagIds: string[]) =>
    studyOrg.setStudyDocumentTags(documentId, tagIds));
  h('study:template:create', async (_e, input: CreateStudyTemplateInput) => studyOrg.createStudyTemplate(input));
  h('study:template:update', async (_e, id: string, patch: Partial<CreateStudyTemplateInput> & { favorite?: boolean; position?: number }) =>
    studyOrg.updateStudyTemplate(id, patch));
  h('study:template:delete', async (_e, id: string) => studyOrg.deleteStudyTemplate(id));
  h('study:template:apply', async (_e, id: string, name?: string) => studyOrg.applyStudyTemplate(id, name));
  h('study:editor:data', async (_e, documentId: string) => studyEditor.getStudyDocEditorData(documentId));
  h('study:editor:update', async (_e, documentId: string, input: StudyDocUpdateInput) => {
    const result = studyEditor.updateStudyDoc(documentId, input);
    if (process.env.NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI !== '1') {
      queueStudyKnowledgeSources('document', [documentId]);
      studySearch.queueStudySearchIndexRefresh();
    }
    return result;
  });
  h('study:editor:restore', async (_e, documentId: string, versionId: string) => {
    const result = studyEditor.restoreStudyDocVersion(documentId, versionId);
    if (process.env.NODUS_E2E_DISABLE_STUDY_BACKGROUND_AI !== '1') {
      queueStudyKnowledgeSources('document', [documentId]);
      studySearch.queueStudySearchIndexRefresh();
    }
    return result;
  });
  h('study:annotation:create', async (_e, documentId: string, input: StudyAnnotationInput) => studyEditor.createStudyAnnotation(documentId, input));
  h('study:annotation:update', async (_e, id: string, patch: Partial<StudyAnnotationInput> & { resolved?: boolean }) =>
    studyEditor.updateStudyAnnotation(id, patch));
  h('study:annotation:delete', async (_e, id: string) => studyEditor.deleteStudyAnnotation(id));
  h('study:stt:transcribe', async (event, request: StudySttRequest) => {
    const provider = request.provider ?? getSettings().sttProvider;
    let result;
    if (provider === 'whisper_cpp') {
      result = await transcribeWhisperCpp(request, {
        onProgress: (fraction) => event.sender.send('study:stt:progress', request.requestId, fraction),
        onPartial: (text) => event.sender.send('study:stt:partial', request.requestId, text),
      });
    } else if (provider === 'openai') {
      result = await transcribeOpenAiStudyAudio(request);
    } else {
      throw new Error('Transformers.js se ejecuta en el worker local del renderer.');
    }
    event.sender.send('study:stt:complete', request.requestId);
    return result;
  });
  h('study:stt:cancel', async (_event, requestId: string) => cancelWhisperCpp(requestId));
  h('study:stt:whisperCpp:status', async () => getWhisperCppStatus());
  h('study:stt:whisperCpp:install', async () => installWhisperCpp());
  h('study:stt:whisperCpp:uninstall', async () => uninstallWhisperCpp());
  h('study:stt:whisperCpp:chooseExecutable', async () => {
    const picked = await dialog.showOpenDialog(getWindow() ?? undefined!, {
      title: 'Seleccionar whisper-cli',
      properties: ['openFile'],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    updateSettings({ sttWhisperCppExecutable: picked.filePaths[0] });
    return picked.filePaths[0];
  });
  h('study:stt:whisperCpp:download', async (event, requestId: string, model: string) =>
    downloadWhisperCppModel(model, (fraction) => event.sender.send('study:stt:modelProgress', requestId, fraction)));
  h('study:stt:whisperCpp:delete', async (_event, model: string) => deleteWhisperCppModel(model));
  h('study:styles:list', async (_e, options?: { includeArchived?: boolean; search?: string }) => studyStyles.listStudyStyles(options));
  h('study:styles:create', async (_e, input: StudyStyleInput) => studyStyles.createStudyStyle(input));
  h('study:styles:update', async (_e, id: string, patch: Partial<StudyStyleInput>) => studyStyles.updateStudyStyle(id, patch));
  h('study:styles:duplicate', async (_e, id: string) => studyStyles.duplicateStudyStyle(id));
  h('study:styles:archive', async (_e, id: string, archived: boolean) => studyStyles.archiveStudyStyle(id, archived));
  h('study:styles:delete', async (_e, id: string) => studyStyles.deleteStudyStyle(id));
  h('study:styles:versions', async (_e, styleId: string) => studyStyles.listStudyStyleVersions(styleId));
  h('study:styles:restore', async (_e, styleId: string, versionId: string) => studyStyles.restoreStudyStyleVersion(styleId, versionId));
  h('study:styles:associations', async () => studyStyles.listStudyStyleAssociations());
  h('study:styles:associate', async (_e, styleId: string, kind: StudyStyleAssociationKind, targetId?: string, isDefault?: boolean) =>
    studyStyles.setStudyStyleAssociation(styleId, kind, targetId, isDefault));
  h('study:styles:default', async (_e, subjectId?: string | null, documentKind?: string | null) =>
    studyStyles.resolveStudyStyleDefault(subjectId, documentKind));
  h('study:styles:export', async (_e, styleIds?: string[]) => {
    const payload = studyStyles.exportStudyStyles(styleIds);
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: 'Exportar estilos de estudio', defaultPath: 'nodus-study-styles.json', filters: [{ name: 'Nodus Study Styles', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { path: picked.filePath };
  });
  h('study:styles:import', async () => {
    const picked = await dialog.showOpenDialog(getWindow() ?? undefined!, {
      title: 'Importar estilos de estudio', properties: ['openFile'], filters: [{ name: 'Nodus Study Styles', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return [];
    const payload = JSON.parse(fs.readFileSync(picked.filePaths[0], 'utf8')) as StudyStyleExport;
    return studyStyles.importStudyStyles(payload);
  });
  h('study:improve', async (e, requestId: string, request: StudyImproveRequest) => {
    const controller = new AbortController();
    studyImproveAborters.set(requestId, controller);
    try {
      return await improveStudyText(request, (delta) => {
        if (!e.sender.isDestroyed()) e.sender.send('study:improve:delta', requestId, delta);
      }, controller.signal);
    } finally {
      studyImproveAborters.delete(requestId);
    }
  });
  h('study:improve:cancel', async (_e, requestId: string) => studyImproveAborters.get(requestId)?.abort());
  h('study:improve:log', async (_e, documentId: string) => studyStyles.listStudyImprovementLog(documentId));
  h('study:improve:action', async (_e, id: string, action: StudyImprovementLog['action']) => studyStyles.updateStudyImprovementAction(id, action));
  h('study:materials:list', async (_e, options?: StudyMaterialListOptions) => studyMaterials.listStudyMaterials(options));
  h('study:materials:get', async (_e, id: string) => studyMaterials.getStudyMaterial(id));
  h('study:materials:content', async (_e, id: string) => studyMaterials.getStudyMaterialContent(id));
  h('study:materials:download', async (_e, id: string) => {
    const material = studyMaterials.getStudyMaterial(id);
    if (material.origin === 'zotero_link') throw new Error('Este material es un enlace de Zotero y no contiene un fichero local que descargar.');
    const content = studyMaterials.getStudyMaterialContent(id);
    const safeName = path.basename(material.fileName).replace(/[\\/:*?"<>|]+/g, '-') || `material.${material.extension || 'bin'}`;
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: 'Descargar material',
      defaultPath: safeName,
      filters: material.extension ? [{ name: material.extension.toUpperCase(), extensions: [material.extension] }] : undefined,
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, Buffer.from(content.bytes));
    return { path: picked.filePath };
  });
  h('study:materials:import', async (_e, input?: StudyMaterialImportInput) => {
    const picked = await dialog.showOpenDialog(getWindow() ?? undefined!, {
      title: 'Añadir materiales de estudio', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Materiales de estudio', extensions: ['pdf', 'docx', 'md', 'markdown', 'pptx', 'txt', 'html', 'htm', 'epub', 'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'mp3', 'wav', 'm4a', 'ogg', 'zip'] }],
    });
    if (picked.canceled) return [];
    const results = await importStudyMaterialPaths(picked.filePaths, input);
    queueStudyMaterialIndex(results.map((result) => result.material.id));
    queueStudyKnowledgeSources('material', results.map((result) => result.material.id));
    return results;
  });
  h('study:materials:importFolder', async (_e, input?: StudyMaterialImportInput) => {
    const picked = await dialog.showOpenDialog(getWindow() ?? undefined!, { title: 'Añadir carpeta de materiales', properties: ['openDirectory'] });
    if (picked.canceled) return [];
    const results = await importStudyMaterialPaths(picked.filePaths, input);
    queueStudyMaterialIndex(results.map((result) => result.material.id));
    queueStudyKnowledgeSources('material', results.map((result) => result.material.id));
    return results;
  });
  h('study:materials:choosePaths', async (_e, folder?: boolean) => {
    const picked = await dialog.showOpenDialog(getWindow() ?? undefined!, folder ? {
      title: 'Seleccionar carpeta de materiales', properties: ['openDirectory'],
    } : {
      title: 'Seleccionar materiales de estudio', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Materiales de estudio', extensions: ['pdf', 'docx', 'md', 'markdown', 'pptx', 'txt', 'html', 'htm', 'epub', 'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'mp3', 'wav', 'm4a', 'ogg', 'zip'] }],
    });
    return picked.canceled ? [] : picked.filePaths;
  });
  h('study:materials:importPaths', async (_e, paths: string[], input?: StudyMaterialImportInput) => {
    const safePaths = [...new Set(paths.filter((filePath): filePath is string => typeof filePath === 'string' && filePath.trim().length > 0))];
    const results = await importStudyMaterialPaths(safePaths, input);
    queueStudyMaterialIndex(results.map((result) => result.material.id));
    queueStudyKnowledgeSources('material', results.map((result) => result.material.id));
    return results;
  });
  h('study:materials:importZotero', async (_e, input: ZoteroStudyMaterialImportInput) => {
    const { zoteroUserId } = getSettings();
    const canonicalItemKey = input.library.type === 'group' ? `groups:${input.library.id}:${input.itemKey}` : input.itemKey;
    const item = await zotero.getItem(zoteroUserId, canonicalItemKey, input.library);
    if (!item) throw new Error('El elemento ya no está disponible en Zotero.');
    const attachments = await zotero.itemAttachments(zoteroUserId, canonicalItemKey, input.library);
    const attachment = input.attachmentKey
      ? attachments.find((candidate) => candidate.itemKey === input.attachmentKey || candidate.key === input.attachmentKey) ?? null
      : attachments[0] ?? null;
    const placement: StudyMaterialImportInput = {
      courseId: input.courseId, subjectId: input.subjectId, topicId: input.topicId,
      folderId: input.folderId, documentId: input.documentId, readState: input.readState,
      tags: input.tags, ocr: input.ocr,
    };
    if (input.mode === 'link') {
      return studyMaterials.linkStudyMaterialFromZotero(input.library, item, attachment, placement);
    }
    if (!attachment) throw new Error('Elige un adjunto para importarlo a Nodus.');
    const filePath = await zotero.attachmentFilePath(zoteroUserId, attachment.key);
    if (!filePath || !fs.existsSync(filePath)) throw new Error('El adjunto no está descargado en este equipo. Ábrelo o descárgalo primero desde Zotero.');
    if (!studyMaterials.supportsStudyMaterial(filePath)) throw new Error(`Formato no compatible: .${path.extname(filePath).replace(/^\./, '') || '?'}`);
    const result = await studyMaterials.importStudyMaterialFromZotero(filePath, input.library, item, attachment, placement);
    queueStudyMaterialIndex([result.material.id]);
    queueStudyKnowledgeSources('material', [result.material.id]);
    return result;
  });
  h('study:materials:openZotero', async (_e, id: string) => {
    const material = studyMaterials.getStudyMaterial(id);
    if (!material.zoteroItemKey || !material.zoteroLibraryType || !material.zoteroLibraryId) throw new Error('Este material no conserva un enlace con Zotero.');
    const key = material.zoteroLibraryType === 'group'
      ? `groups:${material.zoteroLibraryId}:${material.zoteroAttachmentKey || material.zoteroItemKey}`
      : material.zoteroAttachmentKey || material.zoteroItemKey;
    await shell.openExternal(zoteroSelectUrl(key));
  });
  h('study:materials:replace', async (_e, id: string, ocr?: boolean) => {
    const picked = await dialog.showOpenDialog(getWindow() ?? undefined!, {
      title: 'Sustituir fichero del material', properties: ['openFile'],
      filters: [{ name: 'Materiales de estudio', extensions: ['pdf', 'docx', 'md', 'markdown', 'pptx', 'txt', 'html', 'htm', 'epub', 'png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'mp3', 'wav', 'm4a', 'ogg'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return null;
    const updated = await studyMaterials.replaceStudyMaterialFile(id, picked.filePaths[0], Boolean(ocr));
    queueStudyMaterialIndex([id]);
    queueStudyKnowledgeSources('material', [id], true);
    return updated;
  });
  h('study:materials:update', async (_e, id: string, patch: StudyMaterialUpdateInput) => {
    const updated = studyMaterials.updateStudyMaterial(id, patch);
    if (patch.title !== undefined || patch.description !== undefined || patch.metadata !== undefined || patch.bibliography !== undefined) { queueStudyMaterialIndex([id]); queueStudyKnowledgeSources('material', [id]); }
    return updated;
  });
  h('study:materials:reindex', async (_e, id: string) => reindexStudyMaterial(id));
  h('study:materials:version:restore', async (_e, id: string, versionId: string) => {
    const restored = studyMaterials.restoreStudyMaterialVersion(id, versionId);
    queueStudyMaterialIndex([id]);
    queueStudyKnowledgeSources('material', [id], true);
    return restored;
  });
  h('study:materials:placement:add', async (_e, id: string, input: StudyMaterialImportInput) => {
    const result = studyMaterials.addStudyMaterialPlacement(id, input); studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('material', id);
    queueStudyKnowledgeSources('material', [id]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:materials:placement:setPrimary', async (_e, id: string, input: StudyMaterialImportInput) => {
    const result = studyMaterials.setPrimaryStudyMaterialPlacement(id, input); studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('material', id);
    queueStudyKnowledgeSources('material', [id]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:materials:placement:remove', async (_e, id: string, placementId: string) => {
    const result = studyMaterials.removeStudyMaterialPlacement(id, placementId); studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('material', id);
    queueStudyKnowledgeSources('material', [id]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:materials:annotation:create', async (_e, materialId: string, input: StudyMaterialAnnotationInput) => studyMaterials.createStudyMaterialAnnotation(materialId, input));
  h('study:materials:annotation:update', async (_e, id: string, patch: Partial<StudyMaterialAnnotationInput>) => studyMaterials.updateStudyMaterialAnnotation(id, patch));
  h('study:materials:annotation:delete', async (_e, id: string) => studyMaterials.deleteStudyMaterialAnnotation(id));
  h('study:materials:annotation:export', async (_e, id: string) => {
    const material = studyMaterials.getStudyMaterial(id);
    const content = studyMaterials.getStudyMaterialContent(id);
    const isPdf = material.extension === 'pdf';
    const isEpub = material.extension === 'epub';
    if (!isPdf && !isEpub) throw new Error('La exportación anotada solo está disponible para PDF y EPUB.');
    const extension = isPdf ? 'pdf' : 'epub';
    const baseName = path.basename(material.fileName, path.extname(material.fileName)).replace(/[\\/:*?"<>|]+/g, '-') || 'material';
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: 'Descargar material anotado', defaultPath: `${baseName}-anotado.${extension}`,
      filters: [{ name: isPdf ? 'PDF anotado' : 'EPUB anotado', extensions: [extension] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    const bytes = isPdf ? await annotatedPdfBytes(content, material) : annotatedEpubBytes(content, material);
    fs.writeFileSync(picked.filePath, Buffer.from(bytes));
    return { path: picked.filePath };
  });
  h('study:materials:note:create', async (_e, materialId: string, annotationId?: string | null, title?: string) => {
    const result = studyMaterials.createStudyNoteFromMaterial(materialId, annotationId, title); queueStudyKnowledgeSources('document', [result.documentId]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:materials:lifecycle', async (_e, id: string, action: 'archive' | 'restore' | 'trash' | 'recover' | 'delete') => {
    if (action === 'delete') studyKnowledgeRepo.purgeStudyKnowledgeSource('material', id);
    const result = studyMaterials.setStudyMaterialLifecycle(id, action);
    if (action !== 'delete') { studyKnowledgeRepo.syncStudyKnowledgeSourceScopes('material', id); if (action === 'restore' || action === 'recover') queueStudyKnowledgeSources('material', [id]); }
    studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:recordings:list', async (_e, options?: StudyRecordingListOptions) => studyRecordings.listStudyRecordings(options));
  h('study:recordings:get', async (_e, id: string) => studyRecordings.getStudyRecording(id));
  h('study:recordings:content', async (_e, id: string) => studyRecordings.getStudyRecordingContent(id));
  h('study:recordings:create', async (_e, input: StudyRecordingCreateInput) => studyRecordings.createStudyRecording(input));
  h('study:recordings:import', async (_e, scope?: Omit<StudyRecordingCreateInput, 'bytes' | 'fileName' | 'mimeType'>) => {
    const picked = await dialog.showOpenDialog(getWindow() ?? undefined!, {
      title: 'Añadir grabaciones de clase', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Grabaciones de audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'webm'] }],
    });
    if (picked.canceled) return [];
    return picked.filePaths.map((filePath) => studyRecordings.importStudyRecordingFile(filePath, scope));
  });
  h('study:recordings:update', async (_e, id: string, patch: StudyRecordingUpdateInput) => studyRecordings.updateStudyRecording(id, patch));
  h('study:recordings:marker:create', async (_e, recordingId: string, input: StudyAudioMarkerInput) => studyRecordings.createStudyAudioMarker(recordingId, input));
  h('study:recordings:marker:update', async (_e, id: string, patch: Partial<StudyAudioMarkerInput>) => studyRecordings.updateStudyAudioMarker(id, patch));
  h('study:recordings:marker:delete', async (_e, id: string) => studyRecordings.deleteStudyAudioMarker(id));
  h('study:recordings:transcript:save', async (_e, recordingId: string, input: StudyTranscriptInput) => studyRecordings.saveStudyTranscript(recordingId, input));
  h('study:recordings:transcript:update', async (_e, id: string, contentMarkdown: string, segments?: StudyTranscriptSegmentInput[]) => studyRecordings.updateStudyTranscript(id, contentMarkdown, segments));
  h('study:recordings:segment:update', async (_e, id: string, patch: Partial<StudyTranscriptSegmentInput>) => studyRecordings.updateStudyTranscriptSegment(id, patch));
  h('study:recordings:transcript:delete', async (_e, id: string) => studyRecordings.deleteStudyTranscript(id));
  h('study:recordings:note:create', async (_e, recordingId: string, transcriptId: string, placements?: StudyPlacementInput[]) => {
    const result = studyRecordings.createStudyNoteFromTranscript(recordingId, transcriptId, placements); queueStudyKnowledgeSources('document', [result.documentId]); studySearch.queueStudySearchIndexRefresh(); return result;
  });
  h('study:recordings:audio:delete', async (_e, id: string) => studyRecordings.deleteStudyRecordingAudio(id));
  h('study:recordings:lifecycle', async (_e, id: string, action: 'archive' | 'restore' | 'trash' | 'recover' | 'delete') => studyRecordings.setStudyRecordingLifecycle(id, action));
  h('study:search:query', async (_e, query: string, options?: StudySearchOptions) => studySearch.searchStudyCorpus(query, options));
  h('study:search:status', async () => studySearch.getStudySearchIndexStatus());
  h('study:search:rebuild', async (e) => {
    const off = studySearch.onStudySearchProgress((next) => { if (!e.sender.isDestroyed()) e.sender.send('study:search:progress', next); });
    try { return await studySearch.rebuildStudySearchIndex(); } finally { off(); }
  });
  h('study:search:pause', async () => studySearch.pauseStudySearchIndex());
  h('study:search:resume', async () => studySearch.resumeStudySearchIndex());
  h('study:search:stop', async () => studySearch.stopStudySearchIndex());
  h('study:search:deleteIndex', async () => studySearch.deleteStudySearchIndex());
  h('study:search:exclude', async (_e, sourceId: string, excluded: boolean) => studySearch.setStudySearchSourceExcluded(sourceId, excluded));
  h('study:search:saved:list', async () => studySearch.listStudySavedSearches());
  h('study:search:saved:create', async (_e, name: string, query: string, options: StudySearchOptions) => studySearch.saveStudySearch(name, query, options));
  h('study:search:saved:delete', async (_e, id: string) => studySearch.deleteStudySavedSearch(id));
  h('study:search:history:list', async () => studySearch.listStudySearchHistory());
  h('study:search:history:clear', async () => studySearch.clearStudySearchHistory());
  h('study:knowledge:ideas', async (_e, subjectId: string, query?: string) => studyKnowledgeRepo.listStudyIdeas(subjectId, query));
  h('study:knowledge:idea', async (_e, id: string) => studyKnowledgeRepo.getStudyIdeaDetail(id));
  h('study:knowledge:graph', async (_e, subjectId: string) => studyKnowledgeRepo.getStudyKnowledgeGraph(subjectId));
  h('study:knowledge:jobs', async (_e, subjectId?: string) => studyKnowledgeRepo.listStudyKnowledgeJobs(subjectId));
  h('study:knowledge:progress', async () => getStudyKnowledgeProgress());
  h('study:knowledge:reanalyze', async (_e, sourceKind: 'material' | 'document', sourceId: string) => reanalyzeStudyKnowledgeSource(sourceKind, sourceId));
  h('study:assistant:sources', async () => studyAssistant.getStudyAssistantSources());
  h('study:assistant:list', async (_e, includeArchived?: boolean) => studyAssistant.listStudyAssistantConversations(Boolean(includeArchived)));
  h('study:assistant:get', async (_e, id: string) => studyAssistant.getStudyAssistantConversation(id));
  h('study:assistant:create', async (_e, input?: StudyAssistantConversationInput) => studyAssistant.createStudyAssistantConversation(input));
  h('study:assistant:update', async (_e, id: string, patch: StudyAssistantConversationPatch) => studyAssistant.updateStudyAssistantConversation(id, patch));
  h('study:assistant:delete', async (_e, id: string) => studyAssistant.deleteStudyAssistantConversation(id));
  h('study:assistant:stream', async (e, requestId: string, request: StudyAssistantRequest) => {
    const controller = new AbortController(); studyAssistantAborters.set(requestId, controller);
    try {
      return await studyAssistant.streamStudyAssistant(request, (delta, kind) => {
        if (!e.sender.isDestroyed()) e.sender.send(kind === 'reasoning' ? 'study:assistant:reasoning' : 'study:assistant:delta', requestId, delta);
      }, controller.signal);
    } finally { studyAssistantAborters.delete(requestId); }
  });
  h('study:assistant:cancel', async (_e, requestId: string) => studyAssistantAborters.get(requestId)?.abort());
  h('study:assistant:export', async (_e, id: string) => {
    const conversation = studyAssistant.getStudyAssistantConversation(id); if (!conversation) return null;
    const safeTitle = conversation.title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'chat-estudio';
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: 'Exportar conversación de estudio', defaultPath: `${safeTitle}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, studyAssistant.renderStudyAssistantConversation(conversation), 'utf8');
    return { path: picked.filePath };
  });
  h('study:questions:list', async (_e, filters?: StudyQuestionFilters) => studyQuestions.listStudyQuestions(filters));
  h('study:questions:get', async (_e, id: string) => studyQuestions.getStudyQuestion(id));
  h('study:questions:create', async (_e, input: StudyQuestionInput) => studyQuestions.createStudyQuestion(input));
  h('study:questions:update', async (_e, id: string, patch: Partial<StudyQuestionInput>) => studyQuestions.updateStudyQuestion(id, patch));
  h('study:questions:duplicate', async (_e, id: string) => studyQuestions.duplicateStudyQuestion(id));
  h('study:questions:versions', async (_e, id: string) => studyQuestions.listStudyQuestionVersions(id));
  h('study:questions:restore', async (_e, id: string, versionId: string) => studyQuestions.restoreStudyQuestionVersion(id, versionId));
  h('study:questions:lifecycle', async (_e, id: string, action: 'archive' | 'restore' | 'trash' | 'recover' | 'delete') => studyQuestions.setStudyQuestionLifecycle(id, action));
  h('study:questions:generate', async (_e, request: StudyQuestionGenerationRequest) => generateStudyQuestions(request));
  h('study:questions:export', async (_e, ids?: string[]) => {
    const payload = studyQuestions.exportStudyQuestions(ids);
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: 'Exportar banco de preguntas', defaultPath: 'nodus-preguntas.json', filters: [{ name: 'Nodus Study Questions', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { path: picked.filePath };
  });
  h('study:questions:import', async () => {
    const picked = await dialog.showOpenDialog(getWindow() ?? undefined!, {
      title: 'Importar banco de preguntas', properties: ['openFile'], filters: [{ name: 'Nodus Study Questions', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return [];
    return studyQuestions.importStudyQuestions(JSON.parse(fs.readFileSync(picked.filePaths[0], 'utf8')) as StudyQuestionExport);
  });
  h('study:questions:collections:list', async () => studyQuestions.listStudyQuestionCollections());
  h('study:questions:collections:create', async (_e, name: string, description?: string) => studyQuestions.createStudyQuestionCollection(name, description));
  h('study:questions:collections:setItems', async (_e, collectionId: string, questionIds: string[]) => studyQuestions.setStudyQuestionCollectionItems(collectionId, questionIds));
  h('study:questions:collections:delete', async (_e, id: string) => studyQuestions.deleteStudyQuestionCollection(id));
  h('study:questions:analytics', async (_e, id: string) => studyQuestions.getStudyQuestionAnalytics(id));
  h('study:questions:similar', async (_e, id: string, threshold?: number) => studyQuestions.findSimilarStudyQuestions(id, threshold));
  h('study:assessments:list', async (_e, kind?: 'test' | 'exam', includeArchived?: boolean) => studyAssessments.listStudyAssessments(kind, includeArchived));
  h('study:assessments:get', async (_e, id: string) => studyAssessments.getStudyAssessment(id));
  h('study:assessments:create', async (_e, input: StudyAssessmentInput) => studyAssessments.createStudyAssessment(input));
  h('study:assessments:buildTest', async (_e, input: StudyTestBuildRequest) => buildStudyTest(input));
  h('study:assessments:update', async (_e, id: string, patch: Partial<Omit<StudyAssessmentInput, 'questionIds'>> & { archived?: boolean }) => studyAssessments.updateStudyAssessment(id, patch));
  h('study:assessments:delete', async (_e, id: string) => studyAssessments.deleteStudyAssessment(id));
  h('study:attempts:list', async (_e, assessmentId?: string) => studyAssessments.listStudyAttempts(assessmentId));
  h('study:attempts:get', async (_e, id: string) => studyAssessments.getStudyAttempt(id));
  h('study:attempts:start', async (_e, input: StudyAttemptStartInput) => studyAssessments.startStudyAttempt(input));
  h('study:attempts:answer', async (_e, id: string, input: StudyAttemptAnswerInput) => studyAssessments.saveStudyAttemptAnswer(id, input));
  h('study:attempts:submit', async (_e, id: string, expired?: boolean) => studyAssessments.submitStudyAttempt(id, expired));
  h('study:attempts:abandon', async (_e, id: string) => studyAssessments.abandonStudyAttempt(id));
  h('study:assessments:export', async (_e, id: string, includeAnswers?: boolean) => {
    const assessment = studyAssessments.getStudyAssessment(id); if (!assessment) return null;
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: 'Exportar test de estudio', defaultPath: `${assessment.title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'test'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, studyAssessments.renderStudyAssessmentMarkdown(assessment, Boolean(includeAnswers)), 'utf8');
    return { path: picked.filePath };
  });
  h('study:grading:rubrics:list', async (_e, includeArchived?: boolean) => studyGrading.listStudyRubrics(includeArchived));
  h('study:grading:rubrics:create', async (_e, input: StudyRubricInput) => studyGrading.createStudyRubric(input));
  h('study:grading:rubrics:update', async (_e, id: string, patch: Partial<StudyRubricInput> & { archived?: boolean }) => studyGrading.updateStudyRubric(id, patch));
  h('study:grading:rubrics:duplicate', async (_e, id: string) => studyGrading.duplicateStudyRubric(id));
  h('study:grading:rubrics:delete', async (_e, id: string) => studyGrading.deleteStudyRubric(id));
  h('study:grading:runs:list', async (_e, attemptAnswerId?: string) => studyGrading.listStudyGradingRuns(attemptAnswerId));
  h('study:grading:run', async (e, requestId: string, request: StudyGradingRequest) => {
    const controller = new AbortController(); studyGradingAborters.set(requestId, controller);
    try { return await gradeStudyAnswer(request, (delta, kind) => { if (!e.sender.isDestroyed()) e.sender.send(kind === 'reasoning' ? 'study:grading:reasoning' : 'study:grading:delta', requestId, delta); }, controller.signal); }
    finally { studyGradingAborters.delete(requestId); }
  });
  h('study:grading:cancel', async (_e, requestId: string) => studyGradingAborters.get(requestId)?.abort());
  h('study:grading:manual', async (_e, id: string, score: number, comment?: string) => studyGrading.setStudyGradingManualScore(id, score, comment));
  h('study:flashcards:list', async (_e, options) => studyLearning.listStudyFlashcards(options));
  h('study:flashcards:create', async (_e, input) => studyLearning.createStudyFlashcard(input));
  h('study:flashcards:update', async (_e, id: string, patch) => studyLearning.updateStudyFlashcard(id, patch));
  h('study:flashcards:fromQuestions', async (_e, ids: string[]) => studyLearning.createStudyFlashcardsFromQuestions(ids));
  h('study:flashcards:review', async (_e, input) => studyLearning.reviewStudyFlashcard(input));
  h('study:flashcards:state', async (_e, id: string, action) => studyLearning.setStudyFlashcardState(id, action));
  h('study:learning:progress', async () => studyLearning.getStudyProgressDashboard());
  h('study:planner:get', async () => studyLearning.getStudyPlanner());
  h('study:planner:create', async (_e, input) => studyLearning.createStudyPlan(input));
  h('study:planner:block:create', async (_e, input) => studyLearning.createStudyPlanBlock(input));
  h('study:planner:event:create', async (_e, input) => studyLearning.createStudyCalendarEvent(input));
  h('study:planner:event:update', async (_e, id: string, input) => studyLearning.updateStudyCalendarEvent(id, input));
  h('study:planner:event:delete', async (_e, id: string) => studyLearning.deleteStudyCalendarEvent(id));
  h('study:planner:event:external', async (_e, id: string, target: 'google' | 'icloud') => {
    const event = studyLearning.getStudyPlanner().events.find((item) => item.id === id);
    if (!event) throw new Error('Evento no encontrado.');
    if (target === 'google') {
      const stamp = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
      const dates = `${stamp(event.startsAt)}/${stamp(event.endsAt ?? event.startsAt)}`;
      const params = new URLSearchParams({ action: 'TEMPLATE', text: event.title, dates, details: event.description || event.notes });
      params.append('sprop', 'name:Nodus');
      if (event.url) params.set('location', event.url);
      await shell.openExternal(`https://calendar.google.com/calendar/render?${params.toString()}`);
      return;
    }
    const filePath = path.join(os.tmpdir(), `nodus-${event.id}.ics`);
    fs.writeFileSync(filePath, studyLearning.renderStudyCalendarEventIcs(id), 'utf8');
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
  });
  h('study:planner:goal:create', async (_e, input) => studyLearning.createStudyGoal(input));
  h('study:planner:item:update', async (_e, kind, id: string, patch) => studyLearning.updateStudyPlannerItem(kind, id, patch));
  h('study:planner:session:start', async (_e, input) => studyLearning.startStudySession(input));
  h('study:planner:session:finish', async (_e, id: string, input) => studyLearning.finishStudySession(id, input));
  h('study:planner:exportIcs', async () => {
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, { title: 'Exportar calendario de estudio', defaultPath: 'nodus-estudio.ics', filters: [{ name: 'iCalendar', extensions: ['ics'] }] });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, studyLearning.renderStudyPlannerIcs(), 'utf8'); return { path: picked.filePath };
  });
  h('study:ai:usage:list', async (_e, limit?: number) => studyAiUsage.listStudyAiUsage(limit));
  h('study:ai:usage:summary', async () => studyAiUsage.getStudyAiUsageSummary());
  h('study:ai:usage:clear', async () => studyAiUsage.clearStudyAiUsage());

  h('study:plan', async (_e, request?: StudyPlanRequest) => buildStudyPlan(request ?? {}));
  h('study:progress:set', async (_e, record: {
    targetKind: 'author' | 'work' | 'idea' | 'theme';
    targetId: string;
    status: 'pending' | 'in_progress' | 'understood' | 'needs_full_read' | 'review';
    note?: string | null;
  }) => studyProgress.setStudyProgress(record));
  h('study:session', async (_e, request: StudySessionRequest) => generateStudySession(request));
  h('study:answer', async (_e, request: StudyAnswerRequest) => evaluateStudyAnswer(request));

  // inmersión (guided topic mastery: scope → generate → resume/replay forever)
  h('immersion:scope', async (_e, request: ImmersionScopeRequest) => buildImmersionScope(request));
  h('immersion:generate', async (e, requestId: string, request: ImmersionRequest) => {
    const session = await generateImmersionSession(request, (p) =>
      e.sender.send('immersion:generate:progress', requestId, p)
    );
    // Content has already been committed. This only persists/queues the optional
    // decoration and therefore cannot roll back or delay the immersion.
    const image = applyDecorativeImageOption('immersion', session.id, request.decorativeImage, (next) => {
      if (!e.sender.isDestroyed()) e.sender.send('images:changed', next);
    });
    return { ...session, image };
  });
  h('immersion:list', async () => immersionRepo.listImmersionSessions());
  h('immersion:get', async (_e, id: string) => immersionRepo.getImmersionSession(id));
  h('immersion:restart', async (_e, id: string) => immersionRepo.restartImmersionSession(id));
  h('immersion:progress:set', async (_e, id: string, progress: ImmersionProgress) =>
    immersionRepo.setImmersionProgress(id, progress)
  );
  h('immersion:answer', async (_e, request: ImmersionAnswerRequest) => evaluateImmersionAnswer(request));
  h('immersion:delete', async (_e, id: string) => {
    invalidateDecorativeImageGeneration('immersion', id);
    translationsRepo.deleteEntityTranslations('immersion', id);
    immersionRepo.deleteImmersionSession(id);
  });

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
  h('gaps:listPage', async (_e, offset: number, limit: number) => aggregateGapsPage(offset, limit));
  h('gaps:contradictionCount', async () => contradictionCount());
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

  // hypothesis lab
  h('hypothesis:generate', async (_e, request: HypothesisLabRequest) => generateHypothesisLab(request));

  // research assistant
  h('research:chat', async (_e, request: ResearchChatRequest) => answerResearchChat(request));
  h('research:chatStream', async (e, requestId: string, request: ResearchChatRequest) => {
    // Track the in-flight stream so `research:chatStream:cancel` can abort it. On
    // abort the provider stops mid-answer and streamResearchChat returns whatever
    // partial text had streamed, which the renderer keeps.
    const controller = new AbortController();
    chatAborters.set(requestId, controller);
    try {
      return await streamResearchChat(
        request,
        (delta, kind) => {
          const channel = kind === 'reasoning' ? 'research:chatStream:reasoning' : 'research:chatStream:delta';
          e.sender.send(channel, requestId, delta);
        },
        controller.signal
      );
    } finally {
      chatAborters.delete(requestId);
    }
  });
  h('research:chatStream:cancel', async (_e, requestId: string) => {
    chatAborters.get(requestId)?.abort();
  });

  // writing workshop
  h('writing:snapshot', async (_e, brief: WritingWorkshopBrief) => buildWritingWorkshopSnapshot(brief));
  h('writing:draft', async (_e, request: WritingWorkshopDraftRequest) => generateWritingWorkshopDraft(request));
  h('writing:export', async (_e, request: WritingWorkshopExportRequest) => exportWritingWorkshopDraft(request));
  h('writing:saved:list', async () => writingDrafts.listWritingWorkshopDrafts());
  h('writing:saved:save', async (e, request: WritingWorkshopSaveDraftRequest) => {
    const saved = writingDrafts.saveWritingWorkshopDraft(request);
    if (saved.brief.kind !== 'deep_research') return saved;
    // Like Inmersión, the complete report is durable before image work begins.
    const image = applyDecorativeImageOption('deep_research', saved.id, request.decorativeImage, (next) => {
      if (!e.sender.isDestroyed()) e.sender.send('images:changed', next);
    });
    return { ...saved, image };
  });
  h('writing:saved:delete', async (_e, id: string) => {
    invalidateDecorativeImageGeneration('deep_research', id);
    translationsRepo.deleteEntityTranslations('deep_research', id);
    return writingDrafts.deleteWritingWorkshopDraft(id);
  });

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
  h('citations:preview', async (_e, ref: CitationRef) => (ref ? previewCitation(ref) : null));
  h('search:global', async (_e, query: string, limitPerKind?: number) =>
    globalSearch(query ?? '', limitPerKind ?? 8)
  );
  h('search:detail', async (_e, kind: SearchResultKind, id: string) => getSearchResultDetail(kind, id));
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
        title: 'Importar capítulo',
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
    if (!doc.text.trim()) throw new Error('No se pudo extraer texto útil del capítulo.');
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
  h('projects:manuscript:verify', async (_e, request: ManuscriptVerificationRequest) =>
    verifyManuscriptCitations(request)
  );
  h('projects:manuscript:applyCitation', async (_e, request: ApplyManuscriptCitationRequest) =>
    applyManuscriptCitation(request)
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
  h('data:exportSync', async () => {
    if (getActiveVault().type === 'estudio' && !getSettings().studySyncEnabled) throw new Error('La sincronización del vault de estudio está desactivada en Ajustes.');
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Exportar paquete de sincronización',
      defaultPath: path.join(app.getPath('documents'), `nodus-sync-${new Date().toISOString().slice(0, 10)}.nodussync`),
      filters: [{ name: 'Nodus Sync', extensions: ['nodussync'] }],
    });
    if (canceled || !filePath) return null;
    const { buffer, counts } = buildSyncPackage(app.getVersion());
    fs.writeFileSync(filePath, buffer);
    return { path: filePath, counts };
  });
  // automatic encrypted backups (master password lives in the OS keychain)
  h('backup:setPassword', async (_e, password: string) => {
    const clean = password.trim();
    if (clean.length < MIN_BACKUP_PASSWORD_LENGTH) {
      throw new Error(`La contraseña maestra debe tener al menos ${MIN_BACKUP_PASSWORD_LENGTH} caracteres.`);
    }
    setBackupPassword(clean);
  });
  h('backup:clearPassword', async () => clearBackupPassword());
  h('backup:hasPassword', async () => hasBackupPassword());
  h('backup:chooseFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Elegir carpeta para copias automáticas',
      properties: ['openDirectory', 'createDirectory'],
    });
    return canceled || filePaths.length === 0 ? null : filePaths[0];
  });
  h('backup:runNow', async () => runAutoBackupNow(app.getVersion()));
  h('backup:saveRecoveryKit', async () => {
    const password = getBackupPassword();
    const recoveryKey = getBackupRecoveryKey();
    const language = getSettings().uiLanguage;
    const es = language !== 'en';
    if (!password) return { ok: false, message: es ? 'No hay contraseña maestra configurada.' : 'No master password is configured.' };
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: es ? 'Guardar kit de recuperación' : 'Save recovery kit',
      defaultPath: path.join(app.getPath('documents'), es ? 'nodus-kit-de-recuperacion.txt' : 'nodus-recovery-kit.txt'),
      filters: [{ name: es ? 'Texto' : 'Text', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { ok: false, message: es ? 'Cancelado' : 'Cancelled' };
    fs.writeFileSync(
      filePath,
      (es ? [
        'NODUS — KIT DE RECUPERACIÓN DE COPIAS DE SEGURIDAD', '',
        `Contraseña maestra: ${password}`,
        `Clave de recuperación independiente: ${recoveryKey ?? 'No disponible en copias antiguas'}`, '',
        'Puedes restaurar las copias nuevas con cualquiera de las dos credenciales.',
        'Guárdalas fuera de este dispositivo, preferiblemente en un gestor de contraseñas',
        'o impresas en un lugar seguro. Las copias cifradas incluyen todo Nodus,',
        'también las claves API. El token MCP local nunca se exporta.',
        `Generado: ${new Date().toISOString()}`,
      ] : [
        'NODUS — BACKUP RECOVERY KIT', '',
        `Master password: ${password}`,
        `Independent recovery key: ${recoveryKey ?? 'Not available for legacy snapshots'}`, '',
        'New snapshots can be restored with either credential.',
        'Store them away from this device, preferably in a password manager or',
        'printed in a safe place. Encrypted snapshots include all of Nodus, including',
        'API keys. The local MCP token is never exported.',
        `Generated: ${new Date().toISOString()}`,
      ]).join('\n')
    );
    return { ok: true, message: filePath };
  });
  h('recovery:status', async () => getRecoveryStatus());
  h('recovery:chooseFolder', async (_e, mode: 'create' | 'restore', language: AppLanguage = 'es') => {
    const titles: Record<AppLanguage, string> = {
      en: mode === 'restore' ? 'Select a Nodus recovery folder' : 'Select an empty folder to protect Nodus',
      es: mode === 'restore' ? 'Seleccionar una carpeta de recuperación de Nodus' : 'Seleccionar una carpeta vacía para proteger Nodus',
      fr: mode === 'restore' ? 'Sélectionner un dossier de récupération Nodus' : 'Sélectionner un dossier vide pour protéger Nodus',
    };
    const { canceled, filePaths } = await dialog.showOpenDialog(getWindow() ?? undefined!, {
      title: titles[language],
      properties: mode === 'restore' ? ['openDirectory'] : ['openDirectory', 'createDirectory'],
    });
    return canceled || filePaths.length === 0 ? null : inspectRecoveryFolder(filePaths[0], language);
  });
  h('recovery:initialize', async (_e, folder: string, password: string, language: 'es' | 'en' = 'es') =>
    initializeRecoveryFolder(folder, password, app.getVersion(), language)
  );
  h('recovery:restore', async (_e, root: string, fileName: string, password: string, language: 'es' | 'en' = 'es') => {
    const result = await restoreRecoverySnapshot(root, fileName, password, app.getVersion(), language);
    if (result.ok) await stopMcpServer();
    return result;
  });

  h('data:importSync', async () => {
    if (getActiveVault().type === 'estudio' && !getSettings().studySyncEnabled) throw new Error('La sincronización del vault de estudio está desactivada en Ajustes.');
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Importar paquete de sincronización',
      properties: ['openFile'],
      filters: [{ name: 'Nodus Sync', extensions: ['nodussync'] }],
    });
    if (canceled || filePaths.length === 0) return null;
    return mergeSyncPackage(fs.readFileSync(filePaths[0]));
  });
  h('study:data:overview', async () => studyDataAdmin.getStudyDataOverview());
  h('study:data:exportScope', async (_e, scope, format) => {
    if (!getSettings().studySharingEnabled) throw new Error('La exportación para compartir está desactivada en Ajustes.');
    return exportStudyScope(scope, format);
  });
  h('study:data:maintain', async (_e, action: 'rebuild-indexes' | 'clear-embeddings' | 'empty-trash' | 'repair') => {
    if (action === 'rebuild-indexes') return studyDataAdmin.rebuildStudyIndexes();
    if (action === 'clear-embeddings') { studySearch.deleteStudySearchIndex(); return studyDataAdmin.clearStudyEmbeddingCache(); }
    if (action === 'empty-trash') return studyDataAdmin.emptyStudyTrash();
    if (action === 'repair') return studyDataAdmin.repairStudyData();
    throw new Error('Acción de mantenimiento no válida.');
  });
  h('study:data:diagnostic', async () => {
    const picked = await dialog.showSaveDialog(getWindow() ?? undefined!, {
      title: 'Exportar diagnóstico del vault de estudio', defaultPath: 'nodus-estudio-diagnostico.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    fs.writeFileSync(picked.filePath, JSON.stringify(studyDataAdmin.buildStudyDiagnostic(), null, 2), 'utf8');
    return { path: picked.filePath };
  });
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
  // Genealogy demo: seeds the Serrano–Vidal family (tree, archive, evidence, open
  // kinship suggestions) and flips the vault to the genealogy type. Portraits are
  // generated in the background with the cheap Gemini model when a key is present.
  h('data:seedGenealogyDemo', async () => {
    const seeded = seedGenealogyDemoData();
    const willGeneratePortraits = seeded && hasDemoPortraitKey();
    if (willGeneratePortraits) {
      void generateDemoPortraits({
        onProgress: (done, total) => getWindow()?.webContents.send('demo:portraits', { done, total }),
      }).catch(() => undefined);
    }
    return { seeded, willGeneratePortraits };
  });
  h('data:generateDemoPortraits', async () =>
    generateDemoPortraits({
      onProgress: (done, total) => getWindow()?.webContents.send('demo:portraits', { done, total }),
    })
  );
  // Databases demo: seeds three sample databases covering every column type and flips
  // the vault to the databases type.
  h('data:seedDatabasesDemo', async () => seedDatabasesDemoData());
  // Study demo stays entirely local and is only accepted by an empty study vault.
  h('data:seedStudyDemo', async () => seedStudyDemoData());

  h('updates:check', async () => checkForUpdates());
  h('updates:install', async () => installUpdate());

  // Dynamic macOS dock icon. The renderer rasterises a themed, vault-coloured
  // Nodus mark to a PNG data URL and pushes it here; only macOS exposes
  // app.dock. No-op (and never throws) on Windows/Linux.
  h('dock:setIcon', async (_e, pngDataUrl: string) => {
    setPersistentDockIcon(pngDataUrl);
  });

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

  onStudyMaterialIndexChanged((materialId) => {
    getWindow()?.webContents.send('study:materials:indexChanged', materialId);
  });

  onStudyKnowledgeChanged((next) => {
    getWindow()?.webContents.send('study:knowledge:changed', next);
  });

  onChapterRelationsProgress((p) => {
    getWindow()?.webContents.send('projects:chapterRelations:progress', p);
  });

  // Stream semantic bridge progress to the renderer.
  onSemanticBridgeProgress((p) => {
    getWindow()?.webContents.send('bridges:progress', p);
  });
}
