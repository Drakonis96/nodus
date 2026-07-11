// Shared domain types used by both the Electron main process and the React renderer.
// Keep this file free of any runtime imports from either side.

export type IdeaType = 'claim' | 'finding' | 'construct' | 'method' | 'framework';
export type GraphNodeType = IdeaType | 'theme' | 'author';

export type EdgeType =
  | 'extends'
  | 'contradicts'
  | 'applies_to'
  | 'shares_method'
  | 'precondition_of'
  | 'measures_same'
  | 'supports'
  | 'refutes'
  | 'variant_of'
  | 'refines'
  | 'contains';

export type EdgeBasis = 'explicit' | 'inferred';
export type EvidenceKind = 'explicit' | 'paraphrased';

export type LightStatus = 'none' | 'pending' | 'done' | 'failed';
export type DeepStatus = 'none' | 'pending' | 'done' | 'failed' | 'skipped_no_text';
export type SummaryStatus = 'none' | 'pending' | 'done' | 'failed' | 'skipped_no_text';
export type DeepTrigger = 'tag' | 'manual' | 'both' | null;
export type SourceType = 'pdf' | 'epub' | 'markdown' | 'upload' | 'abstract_only' | 'none';

export type GapKind =
  | 'future_work'
  | 'limitation'
  | 'open_question'
  | 'unresolved_contradiction';

export interface Work {
  nodus_id: string;
  zotero_key: string;
  zotero_version: number | null;
  title: string;
  authors_json: string; // JSON-encoded string[]
  year: number | null;
  item_type: string;
  doi: string | null;
  read_tag: number; // 0|1
  manual_deep: number; // 0|1
  deep_trigger: DeepTrigger;
  source_type: SourceType | null;
  light_status: LightStatus;
  light_at: string | null;
  light_hash: string | null;
  deep_status: DeepStatus;
  deep_at: string | null;
  deep_hash: string | null;
  summary_status: SummaryStatus;
  summary_at: string | null;
  summary_hash: string | null;
  archived: number; // 0|1
  notes: string | null;
}

/** Work with parsed authors + theme labels, as the renderer prefers it. */
export interface WorkView extends Omit<Work, 'authors_json'> {
  authors: string[];
  themes: string[];
  zoteroTags: string[];
  /** How many ideas have been extracted from this work (idea_occurrences count). */
  ideaCount: number;
}

/** One work inside a duplicate group, with enough metadata to choose a canonical. */
export interface DuplicateWorkMember {
  nodus_id: string;
  zotero_key: string | null;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  light_status: LightStatus;
  deep_status: DeepStatus;
  /** How many ideas this work develops — a proxy for how much analysis it holds. */
  ideaCount: number;
  /** True for the richest member; pre-selected as the one to keep on merge. */
  suggestedCanonical: boolean;
}

/** A set of works that look like the same work, grouped for review-and-merge. */
export interface DuplicateWorkGroup {
  /** Why they were grouped: identical DOI, or identical title + year + authors. */
  reason: 'doi' | 'metadata';
  /** Stable group key, used as a React key in the review modal. */
  key: string;
  members: DuplicateWorkMember[];
}

/** One idea inside a duplicate group, with richness signals for review. */
export interface DuplicateIdeaMember {
  global_id: string;
  label: string;
  statement: string;
  type: string;
  /** How many works this idea occurs in. */
  workCount: number;
  /** How many evidence rows support it. */
  evidenceCount: number;
  /** How many graph edges touch it. */
  edgeCount: number;
  /** True for the richest member; pre-selected as the one to keep on merge. */
  suggestedCanonical: boolean;
}

/** A set of ideas that look like the same idea, grouped for review-and-merge. */
export interface DuplicateIdeaGroup {
  /** Why they were grouped. Phase 1 uses 'label' (identical normalized label + type). */
  reason: 'label';
  /** Stable group key, used as a React key in the review modal. */
  key: string;
  members: DuplicateIdeaMember[];
}

/** A non-citable orientation summary derived from already extracted material. */
export interface WorkSummary {
  nodus_id: string;
  summary: string;
  source_level: 'deep' | 'light';
  created_at: string;
  updated_at: string;
}

/** A Zotero tag available in the local library, with its current work count. */
export interface ZoteroTag {
  label: string;
  workCount: number;
}

export interface Theme {
  theme_id: string;
  label: string;
  created_at: string;
  pinned?: number; // 0|1 — user-curated "main theme", protected from auto-pruning
}

/** A theme as shown in the "Temas principales" manager: label + usage counts + curated flag. */
export interface ManagedTheme {
  theme_id: string;
  label: string;
  created_at: string;
  pinned: boolean;
  work_count: number;
  idea_count: number;
}

/** Options for the graph-level reprocess of already-extracted ideas. */
export interface ReprocessConnectionsOptions {
  /** Also re-trace idea↔idea relations (stored as inferred edges) in addition to idea↔theme. */
  relations: boolean;
}

/** Progress event emitted during reprocessConnections. */
export interface ReprocessProgress {
  /** Current phase: 'themes' (idea→theme assignment) or 'relations' (idea↔idea). */
  phase: 'themes' | 'relations';
  /** Human-readable label for the current phase. */
  label: string;
  /** Batch index within the current phase (1-based). */
  current: number;
  /** Total batches in the current phase. */
  total: number;
}

export interface ReprocessConnectionsResult {
  /** Ideas considered (those occurring in at least one non-archived work). */
  ideas: number;
  /** How many of those ideas ended up assigned to at least one theme. */
  themedIdeas: number;
  /** New theme labels the model proposed (only possible when not locked). */
  newThemes: number;
  /** Inferred idea↔idea relations added (0 when the relations option is off). */
  relationsAdded: number;
}

export interface Idea {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  embedding?: number[] | null;
  created_at: string;
}

export interface IdeaOccurrence {
  global_id: string;
  nodus_id: string;
  role: 'principal' | 'secondary';
  development: string;
  confidence: number;
}

export interface Evidence {
  id: string;
  global_id: string;
  nodus_id: string;
  quote: string;
  location: string | null;
  kind: EvidenceKind;
}

export interface Edge {
  id: string;
  from_id: string;
  to_id: string;
  type: EdgeType;
  basis: EdgeBasis;
  confidence: number;
  source_work: string | null;
}

export interface Author {
  author_id: string;
  name: string;
  affiliation: string | null;
}

export interface AuthorRelation {
  from_author: string;
  to_author: string;
  type: string;
  weight: number;
}

export interface Gap {
  id: string;
  nodus_id: string;
  related_idea: string | null;
  kind: GapKind;
  statement: string;
  confidence: number;
  evidence_id: string | null;
}

export interface ExternalRef {
  id: string;
  nodus_id: string;
  from_idea: string;
  cited_work: string;
  type: EdgeType;
  basis: EdgeBasis;
  confidence: number;
  evidence_id: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

export type AiProvider =
  | 'anthropic'
  | 'openai'
  | 'openrouter'
  | 'deepseek'
  | 'gemini'
  | 'xiaomi'
  | 'ollama'
  | 'lmstudio';
/** Providers that run on the user's machine (or LAN) via a configurable base URL.
 *  They need no API key (an optional token is supported for secured instances). */
export type LocalProvider = Extract<AiProvider, 'ollama' | 'lmstudio'>;
export type EmbeddingProvider = Extract<AiProvider, 'openai' | 'openrouter' | 'gemini' | 'ollama' | 'lmstudio'>;
export type ImageProvider = 'google' | 'openai' | 'openrouter';

/** User-editable connection settings for a local provider. The base URL includes
 *  scheme, host and port (e.g. "http://localhost:11434"); no trailing "/v1". */
export interface LocalProviderConfig {
  baseUrl: string;
}

/** Result of pinging a local provider from Settings ("Test connection"). */
export interface LocalProviderTestResult {
  ok: boolean;
  /** Server version when the provider exposes it (Ollama). */
  version?: string;
  /** How many models the server currently reports. */
  modelCount?: number;
  /** Human-readable error when `ok` is false. */
  message?: string;
}
export type DecorativeImageEntityKind = 'immersion' | 'deep_research';
export type DecorativeImageStatus = 'not_requested' | 'pending' | 'ready' | 'failed';
export type DecorativeImageStyle =
  | 'antique_book'
  | 'colored_engraving'
  | 'classic_scientific'
  | 'watercolor'
  | 'historical_collage'
  | 'modernist_poster'
  | 'contemporary_editorial'
  | 'realistic_photo'
  | 'vintage_photograph'
  | 'black_and_white'
  | 'cinematic'
  | 'oil_painting';

/** The opt-in choice stored with one generation request. */
export interface DecorativeImageOption {
  enabled: boolean;
  style: DecorativeImageStyle;
}

/** How the current ready image was produced. */
export type DecorativeImageSource = 'ai' | 'custom';

/** Metadata only: image bytes stay in the main process and are loaded lazily. */
export interface DecorativeImage {
  entityKind: DecorativeImageEntityKind;
  entityId: string;
  requested: boolean;
  status: DecorativeImageStatus;
  provider: ImageProvider | null;
  model: string | null;
  style: DecorativeImageStyle;
  visualContext: string | null;
  prompt: string | null;
  assetRef: string | null;
  mimeType: string | null;
  error: string | null;
  /** Whether the current image was generated by AI or uploaded by the user. */
  source: DecorativeImageSource | null;
  /** A previous image is stored and can be restored (single-level undo). */
  hasPrevious: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ImageModelInfo {
  provider: ImageProvider;
  id: string;
  name: string;
  /** Standard USD prices per one million tokens. Null means not published. */
  inputPriceUsdPerMillion: number | null;
  outputPriceUsdPerMillion: number | null;
  /** Direct per-generation price, only when published; compared within a provider. */
  imagePriceUsd: number | null;
  /** Provider-native pricing detail, e.g. resolution/quality or per-image variants. */
  imagePriceLabel: string | null;
  sourceUrl: string;
}

export interface DecorativeImageActionRequest {
  entityKind: DecorativeImageEntityKind;
  entityId: string;
  action: 'generate' | 'retry' | 'regenerate';
  style?: DecorativeImageStyle;
  /** Optional user-edited scene description. Rebuilds the prompt for this style. */
  visualContext?: string;
}
export type SyncMode = 'realtime' | 'manual';
/** 'system' follows the OS light/dark preference and reacts to changes at runtime. */
export type ThemeMode = 'dark' | 'light' | 'system';
export type DeepContextMode = 'standard' | 'long';
/** Languages Nodus can speak. `uiLanguage` localizes the interface; `promptLanguage`
 *  is injected into the AI prompts and so determines the language of generated content
 *  (ideas, themes, tutor narrative, drafts, assistant answers). */
export type AppLanguage = 'es' | 'en';

/** A concrete model selection: which provider + which model id. */
export interface ModelRef {
  provider: AiProvider;
  model: string;
}

/** One model as returned by a provider's model-list endpoint. */
export interface ModelInfo {
  id: string;
  name?: string;
  /** For OpenRouter: the upstream provider segment of the id (e.g. "anthropic"). */
  group?: string;
  /** For OpenRouter: true when the model is a reasoning model (slower for scans). */
  reasoning?: boolean;
  // ── Local-provider metadata (Ollama / LM Studio). All optional; other
  //    providers omit them and the UI only renders what is present. ────────────
  /** On-disk size in bytes (Ollama). */
  sizeBytes?: number;
  /** Parameter count label, e.g. "8B" (Ollama). */
  paramSize?: string;
  /** Quantization label, e.g. "Q4_K_M" (Ollama / LM Studio). */
  quantization?: string;
  /** Max context length in tokens (LM Studio). */
  contextLength?: number;
  /** Whether the model is currently loaded into memory (LM Studio). */
  loaded?: boolean;
  /** Model kind reported by LM Studio: chat/vision vs embeddings. */
  kind?: 'llm' | 'vlm' | 'embeddings' | 'other';
}

/** How hard a model should "think" before answering. `off` skips the chain-of-thought
 *  on reasoning models where the provider supports it (much faster for scanning). */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high';

// ── Audio / text-to-speech ───────────────────────────────────────────────────
/** Audio (text-to-speech) backends. Both current providers run fully local in the
 *  renderer via WebAssembly (cross-platform, offline). Piper has native-sounding
 *  per-language voices (incl. Spanish); Kokoro is a single English model with many
 *  high-quality voices. More providers (e.g. a cloud API) slot in behind the same
 *  settings + generation surface without changing callers. */
export type AudioProvider = 'piper' | 'kokoro' | 'hume';

/** The two content kinds that can be narrated. Values match DecorativeImageEntityKind. */
export type AudioEntityKind = 'deep_research' | 'immersion';

/** One Hume voice as returned by the voice-list endpoint. `humeProvider` says which
 *  Hume library it belongs to (needed to synthesize with it). */
export interface HumeVoiceInfo {
  id: string;
  name: string;
  humeProvider: 'HUME_AI' | 'CUSTOM_VOICE';
  /** Octave model versions the voice supports (e.g. ["octave-2"]). */
  models: string[];
}

/** One generated audio file for a segment (stage/section) of a report or immersion. */
export interface AudioClip {
  id: string;
  entityKind: AudioEntityKind;
  entityId: string;
  /** 0-based order within the entity (a report section or an immersion stage). */
  segmentIndex: number;
  /** Human label of the segment, e.g. "Resumen" or "Estación 2 · El viajero". */
  segmentLabel: string;
  provider: AudioProvider;
  voice: string;
  language: string;
  /** File name (relative to the vault audio dir). */
  fileName: string;
  bytes: number;
  durationSec: number;
  sampleRate: number;
  createdAt: string;
  /** True when the metadata row exists but the audio file is gone (e.g. after a
   *  restore from backup, which never carries the regenerable audio files). */
  missing: boolean;
}

/** A speakable segment extracted from an entity: the plain prose to narrate. */
export interface AudioSegment {
  index: number;
  label: string;
  text: string;
}

// ── AI translations ─────────────────────────────────────────────────────────
// A Deep Research report or an immersion can be translated to another language
// with AI. The source content is assembled to Markdown in the renderer and sent
// to the main process, which translates it (chunked, preserving structure and
// citations) and stores the result. Translations reuse the two content kinds and
// are keyed one-per-language, so regenerating replaces the stored copy.
export type TranslationEntityKind = AudioEntityKind;

/** One selectable target language for AI translation. `code` is a BCP-47-ish tag
 *  used as the stable key; `name` (English) guides the model; `nativeName` labels
 *  the picker. */
export interface TranslationLanguage {
  code: string;
  name: string;
  nativeName: string;
}

/** The curated languages offered for AI translation. English name drives the
 *  prompt; native name labels the dropdown. Kept in shared so main and renderer
 *  agree on the exact set and codes. */
export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'pt-BR', name: 'Brazilian Portuguese', nativeName: 'Português (Brasil)' },
  { code: 'ca', name: 'Catalan', nativeName: 'Català' },
  { code: 'gl', name: 'Galician', nativeName: 'Galego' },
  { code: 'eu', name: 'Basque', nativeName: 'Euskara' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'zh', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
];

/** A stored AI translation of a report/immersion, full Markdown body included. */
export interface ContentTranslation {
  id: string;
  entityKind: TranslationEntityKind;
  entityId: string;
  /** Target language code (matches a TRANSLATION_LANGUAGES entry). */
  language: string;
  /** Native-name label captured at generation time (for display). */
  languageLabel: string;
  /** Translated document title. */
  title: string;
  /** Full translated document as Markdown. */
  markdown: string;
  model: ModelRef | null;
  createdAt: string;
  updatedAt: string;
}

/** Translation metadata without the (potentially large) Markdown body. */
export type ContentTranslationSummary = Omit<ContentTranslation, 'markdown'>;

/** Request to (re)generate a translation. The renderer assembles and passes the
 *  source so the main process never has to re-derive an entity's Markdown. */
export interface GenerateTranslationRequest {
  entityKind: TranslationEntityKind;
  entityId: string;
  language: string;
  sourceTitle: string;
  sourceMarkdown: string;
  model?: ModelRef | null;
}

export interface AppSettings {
  embeddingProvider: EmbeddingProvider;
  embeddingModel: string;
  // Per-provider key presence (the keys themselves never cross IPC).
  providerKeys: Record<AiProvider, boolean>;
  // Connection settings for local providers (Ollama, LM Studio). The base URL is
  // user-editable; an optional access token, when set, is stored like an API key.
  localProviders: Record<LocalProvider, LocalProviderConfig>;
  // Favorite models the user pinned. Workload and feature selectors below are
  // deliberately independent: changing one must never retarget another flow.
  favorites: ModelRef[];
  /** @deprecated Legacy global selector, retained only for one-time migration. */
  defaultModel: ModelRef | null;
  extractionModel: ModelRef | null;
  // General long-form synthesis and initial fallback for feature-local pickers.
  synthesisModel: ModelRef | null;
  // Short orientation summaries of individual works. Falls back to synthesisModel.
  summaryModel: ModelRef | null;
  // Fusion: the many small dedup/relate calls during deep scan. Kept separate from
  // synthesisModel so a fast model can be used here without slowing long-form output.
  // Falls back to synthesisModel when unset.
  fusionModel: ModelRef | null;
  // Per-feature choices. Null means "seed from synthesisModel until the user
  // chooses inside that feature"; once chosen, each value persists separately.
  chatModel: ModelRef | null;
  deepResearchModel: ModelRef | null;
  immersionModel: ModelRef | null;
  writingModel: ModelRef | null;
  argumentMapModel: ModelRef | null;
  authorModel: ModelRef | null;
  studyModel: ModelRef | null;
  tutorModel: ModelRef | null;
  hypothesisModel: ModelRef | null;
  /** Provider/model used only for optional decorative image generation. */
  imageProvider: ImageProvider;
  imageModel: string;
  imageStyle: DecorativeImageStyle;
  /** Audio narration backend: 'piper' / 'kokoro' (local WASM) or 'hume' (cloud, BYO key). */
  audioProvider: AudioProvider;
  /** Selected Piper voice id (e.g. "es_ES-sharvard-medium"). Empty until chosen. */
  audioVoice: string;
  /** Playback/synthesis speed multiplier (1.0 = natural). Clamped 0.7–1.3. */
  audioSpeed: number;
  syncMode: SyncMode;
  readTag: string; // Zotero tag that can be used by the opt-in deep-scan automation.
  // All automatic analysis is opt-in. Manual sync can ingest Zotero metadata without spending tokens.
  autoLightScan: boolean;
  autoDeepScanOnReadTag: boolean;
  // After a deep scan completes, auto-generate the work's orientation summary.
  autoSummaryAfterDeep: boolean;
  // When the queue drains after deep scans, auto-run semantic bridge discovery.
  autoBridgeAfterQueue: boolean;
  autoResumeQueue: boolean;
  zoteroUserId: string;
  zoteroStoragePath: string;
  monitoredCollections: string[]; // collection keys
  theme: ThemeMode;
  // Interface language (localizes all UI text).
  uiLanguage: AppLanguage;
  // Language injected into AI prompts → language of generated ideas/themes/answers.
  promptLanguage: AppLanguage;
  animationSpeed: number; // 0..1
  concurrency: number;
  // Reasoning effort for interactive long-form calls (chat, tutor, debate, writing).
  // Scans always run with reasoning off for speed, regardless of this value.
  chatReasoning: ReasoningEffort;
  // When using OpenRouter, bias routing toward the fastest upstream provider.
  openRouterThroughput: boolean;
  unpaywallEmail: string;
  onboardingComplete: boolean;
  // First-run usage tour (distinct from the setup onboarding above).
  tourComplete: boolean;
  // Advanced research-workflow walkthrough. Opt-in (never auto-shown): defaults
  // to true so it only appears when the researcher launches it from Settings.
  advancedTourComplete: boolean;
  // True while the app is showing the seeded sample corpus. Only ever set on an
  // empty database; cleared (and the demo rows wiped) when the user leaves demo mode.
  demoMode: boolean;
  // Large-PDF / extraction strategy
  preferZoteroFulltext: boolean;
  ocrEnabled: boolean;
  ocrLanguages: string;
  ocrMaxPages: number;
  // Deep scan chunking strategy. Standard preserves the legacy chunk size.
  deepContextMode: DeepContextMode;
  deepStandardChunkWords: number;
  deepLongChunkWords: number;
  // When true, light/deep scans only assign works to the existing curated themes and
  // never invent new ones. Toggled from the "Temas principales" manager.
  themesLocked: boolean;
  /** Opt-in local Model Context Protocol server for external AI clients. */
  mcpEnabled: boolean;
  /** Localhost TCP port used by the MCP Streamable HTTP endpoint. */
  mcpPort: number;
  /** Bearer token for the local MCP endpoint. This is intentionally visible in Settings. */
  mcpToken: string;
  /** Opt-in local HTTPS server that serves the Word writing-copilot add-in + its JSON API. */
  copilotEnabled: boolean;
  /** Localhost TCP port for the copilot HTTPS server (serves /addin and /api). */
  copilotPort: number;
  /** Bearer token for the copilot API. Intentionally visible in Settings. */
  copilotToken: string;
  /**
   * User-defined order of the sidebar sections, as view ids. Excludes 'home'
   * (always pinned first) and 'settings' (always pinned last). Empty means the
   * default order. Unknown/missing ids are reconciled against the canonical nav
   * list at render time.
   */
  sidebarOrder: string[];
  /**
   * View ids the user has hidden from the sidebar. 'home' and 'settings' can
   * never be hidden. Hidden sections are simply not rendered in the sidebar nav;
   * they can be shown again from Settings.
   */
  sidebarHidden: string[];
  // ── Automatic encrypted backups ────────────────────────────────────────────
  // Scheduled backups to a user-chosen folder (point it at iCloud Drive /
  // Google Drive to get off-machine copies for free). Encrypted with the
  // master backup password stored in the OS keychain; unlike the manual
  // export, automatic backups NEVER include API keys or tokens.
  autoBackupEnabled: boolean;
  autoBackupFolder: string;
  autoBackupIntervalHours: number;
  lastAutoBackupAt: string | null;
  lastAutoBackupStatus: string | null;
}

/** Outcome of a manual or scheduled automatic backup run. */
export interface AutoBackupResult {
  ok: boolean;
  message: string;
  path?: string;
  prunedCount?: number;
}

export interface VaultSummary {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  lastOpenedAt: string;
  active: boolean;
  legacy: boolean;
  apiKeyProviders: AiProvider[];
}

export interface CreateVaultInput {
  name: string;
}

export interface VaultSwitchOptions {
  copyApiKeysFromVaultId?: string | null;
}

export type VaultAnalysisReuseKind =
  | 'themes'
  | 'ideas'
  | 'ideaEmbeddings'
  | 'summary'
  | 'passages'
  | 'relations'
  | 'authors'
  | 'synthesis';

export interface VaultAnalysisReuseWorkResult {
  nodusId: string;
  matchedVaultId: string | null;
  matchedVaultName: string | null;
  matchedSourceNodusId: string | null;
  imported: VaultAnalysisReuseKind[];
  importedRows: number;
  tableRows: Record<string, number>;
}

export interface VaultAnalysisReuseResult {
  requested: number;
  matched: number;
  imported: number;
  works: VaultAnalysisReuseWorkResult[];
}

export interface VaultSwitchResult {
  ok: boolean;
  message: string;
  activeVault?: VaultSummary;
  copiedProviders: AiProvider[];
}

export interface VaultCreateResult {
  vault: VaultSummary;
}

export interface VaultDuplicateResult {
  vault: VaultSummary;
  copiedProviders: AiProvider[];
}

/** Runtime state of the opt-in localhost MCP server. Never includes the bearer token. */
export interface McpServerStatus {
  running: boolean;
  port: number | null;
  url: string | null;
  error: string | null;
}

/** Runtime state of the opt-in localhost copilot HTTPS server (for the Word add-in). */
export interface CopilotServerStatus {
  running: boolean;
  port: number | null;
  /** URL of the add-in task pane (what the Word manifest points at). */
  addinUrl: string | null;
  /** Whether a trusted localhost TLS certificate was found/loaded. */
  certReady: boolean;
  error: string | null;
}

/** Result of installing/updating the local Word add-in manifest from Settings. */
export interface CopilotInstallResult {
  ok: boolean;
  message: string;
  manifestPath: string | null;
  /** Number of stale Nodus add-in cache entries removed from Office's Wef cache. */
  cacheEntriesRemoved?: number;
}

/** Navigation request emitted by the local Word add-in server into the renderer. */
export interface CopilotOpenIdeaTarget {
  ideaId: string;
  label: string | null;
}

/** One typed relation between the edited paragraph and a library entity (Word copilot). */
export interface LiveRelation {
  relation: ChapterRelationType;
  targetKind: ChapterRelationTargetKind;
  targetId: string;
  targetLabel: string;
  targetSubtitle: string | null;
  similarity: number;
  confidence: number;
  /** Final affinity score used for ordering and display in the Word copilot. */
  rankScore: number;
  /** Statement/text of the target, so idea cards never render empty. */
  targetStatement: string | null;
  /** Retrieval route that surfaced the target. */
  source: 'semantic' | 'lexical' | 'graph' | 'support';
  rationale: string;
  /** Zotero item key of the underlying work, when resolvable. */
  zoteroKey: string | null;
  /** "Surname, Year" style label for inline insertion. */
  authorYear: string | null;
  /** A precise search string (author + year + title) for Zotero's quick search. */
  searchString: string | null;
  /** Verifiable nodus:// citation for the target. */
  citation: string;
  /** Optional one-line paraphrase to insert. */
  proposedText: string | null;
}

export interface LiveRelationsResult {
  /** False when no embedding provider/key is configured. */
  available: boolean;
  relations: LiveRelation[];
}

export type ExtractStrategy = 'zotero_fulltext' | 'digital' | 'hybrid' | 'scanned' | 'empty';

export interface PdfAnalysis {
  pageCount: number;
  sampledPages: number;
  textPages: number;
  textCoverage: number; // 0..1 ratio of sampled pages with a usable text layer
  avgCharsPerTextPage: number;
  strategy: ExtractStrategy;
}

// ─────────────────────────────────────────────────────────────────────────────
// Zotero
// ─────────────────────────────────────────────────────────────────────────────

export interface ZoteroCollection {
  key: string;
  name: string;
  parentCollection: string | false;
  itemCount: number; // direct items only (Zotero meta.numItems)
  subCount: number; // number of subcollections (Zotero meta.numCollections)
}

/** Rich bibliographic metadata for one work, read live from Zotero for the detail panel. */
export interface WorkMeta {
  itemType: string;
  authors: string[];
  year: number | null;
  container: string | null; // journal / book / proceedings the item appears in
  publisher: string | null;
  pages: string | null; // page range, e.g. "12-34"
  numPages: number | null;
  volume: string | null;
  issue: string | null;
  edition: string | null;
  place: string | null;
  doi: string | null;
  url: string | null;
  language: string | null;
}

export interface ZoteroItem {
  key: string;
  version: number;
  title: string;
  creators: ZoteroCreator[];
  year: number | null;
  itemType: string;
  doi: string | null;
  abstract: string | null;
  tags: string[];
  collections: string[];
}

/** A raw Zotero creator. `creatorType` distinguishes author/editor/translator/… */
export interface ZoteroCreator {
  lastName: string;
  firstName?: string;
  name?: string;
  creatorType?: string;
}

/** Persisted per work (works.creators_json): structured creators kept for building
 *  canonical author identity. `role` is the collapsed Zotero creatorType we care
 *  about for the author layer. */
export interface WorkCreator {
  lastName: string;
  firstName: string;
  name: string | null;
  role: 'author' | 'editor';
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue / pipeline
// ─────────────────────────────────────────────────────────────────────────────

export type QueueKind = 'light' | 'deep' | 'summary' | 'bridge';
export type QueueState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'paused';

export interface QueueItem {
  id: string;
  nodus_id: string;
  title: string;
  kind: QueueKind;
  state: QueueState;
  error: string | null;
  enqueued_at: string;
  /** Sub-step detail for the running item, e.g. "OCR p. 12/340" or "Extrayendo p. 8/22". */
  detail?: string | null;
  /** 0..1 progress within the current item (extraction/OCR), when known. */
  subPct?: number | null;
  /** Optional explicit override; null lets the job resolve its workload setting. */
  model?: ModelRef | null;
  /**
   * When set on a deep job, forces the full chain (summary + index + bridge discovery)
   * to run on completion regardless of the auto-* settings. Used by "Procesar todo".
   */
  chain?: boolean;
}

export interface QueueProgress {
  paused: boolean;
  /** When the queue auto-paused on a misconfiguration (no model / invalid key), why. */
  pausedReason: string | null;
  total: number;
  done: number;
  failed: number;
  current: { title: string; kind: QueueKind } | null;
  items: QueueItem[];
}

export interface SyncLogEntry {
  id: number;
  at: string;
  mode: string;
  summary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph payloads (renderer consumes these directly)
// ─────────────────────────────────────────────────────────────────────────────

export interface GraphNode {
  id: string; // global_id (idea) or author_id (author lens)
  label: string;
  type: GraphNodeType;
  /** When the underlying research object entered Nodus; drives graph history playback. */
  createdAt?: string | null;
  statement?: string;
  workCount: number;
  workIds?: string[];
  read: boolean; // true when every linked work has the user's read tag
  themes: string[];
  years: number[];
  authors: string[];
  maxConfidence: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType | string;
  basis: EdgeBasis;
  confidence: number;
  /** User audit verdict. Rejected edges never reach the graph, so only 'confirmed' appears here. */
  verdict?: EdgeFeedbackVerdict;
}

// ── Edge audit feedback ──────────────────────────────────────────────────────
// A user verdict over a derived relation. Keyed by idea pair + relation type
// (not by edges.id) so it survives rescans that recreate edge rows.

export type EdgeFeedbackVerdict = 'rejected' | 'confirmed';

export interface EdgeFeedback {
  from_id: string;
  to_id: string;
  type: string;
  verdict: EdgeFeedbackVerdict;
  note: string;
  created_at: string;
}

/** Feedback row enriched with idea labels for listing in the UI. */
export interface EdgeFeedbackView extends EdgeFeedback {
  from_label: string;
  to_label: string;
}

// ── User-layer sync package (multi-machine) ─────────────────────────────────

export interface SyncTableCounts {
  inserted: number;
  updated: number;
  skipped: number;
}

/** Per-table outcome of merging a sync package. Merges are additive: nothing local is deleted. */
export interface SyncMergeSummary {
  noteFolders: SyncTableCounts;
  notes: SyncTableCounts;
  writingDrafts: SyncTableCounts;
  savedSearches: SyncTableCounts;
  edgeFeedback: SyncTableCounts;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface IdeaDetail {
  idea: Idea;
  occurrences: (IdeaOccurrence & { work: WorkView })[];
  evidence: Evidence[];
}

/** One idea anchored to a work, with that idea↔work occurrence's fields. */
export interface IdeaByWork {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  role: 'principal' | 'secondary';
  confidence: number;
  development: string;
}

/** A page of a work's ideas plus the total count, for paginated listing. */
export interface IdeaByWorkPage {
  ideas: IdeaByWork[];
  total: number;
}

export interface EdgeDetail {
  edge: Edge;
  fromLabel: string;
  toLabel: string;
  explanation?: string | null;
  evidence: Evidence[];
  trace?: EdgeTrace | null;
  /** Current audit verdict for this relation, if the user has set one. */
  feedback?: EdgeFeedback | null;
}

export interface EdgeTrace {
  edgeId: string;
  method: 'deep' | 'fusion' | 'bridge' | 'reprocess' | string;
  model: ModelRef | null;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  similarity: number | null;
  rationale: string | null;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Debate (contradiction face-off) — a contradicts/refutes edge rendered as two
// opposing positions, each with the works/authors/evidence that back it, plus a
// chronology of the dispute. All derived from existing edges/ideas/works — no
// new persistence is required.
// ─────────────────────────────────────────────────────────────────────────────

export type DebateRelation = 'contradicts' | 'refutes';
/** `leaning` when later `supports` edges favour one side; otherwise `open`. */
export type DebateStatus = 'open' | 'leaning';
export type DebateSideKey = 'A' | 'B';

/** One work that develops a side of a debate, with its anchored evidence. */
export interface DebateWork {
  nodus_id: string;
  title: string;
  zotero_key: string;
  authors: string[];
  year: number | null;
  role: 'principal' | 'secondary';
  development: string;
  evidence: Evidence[];
}

/** One position in a debate: an idea plus the works/authors/evidence backing it. */
export interface DebateSide {
  ideaId: string; // global_id
  type: IdeaType;
  label: string;
  statement: string;
  authors: string[]; // union of authors across backing works (the "bando")
  works: DebateWork[];
  earliestYear: number | null;
  latestYear: number | null;
}

/** One marker on the dispute timeline: a work taking a side in a given year. */
export interface DebateTimelineEntry {
  year: number | null;
  side: DebateSideKey;
  nodus_id: string;
  title: string;
  authors: string[];
}

/** A contradicts/refutes relation rendered as a face-off with chronology. */
export interface Debate {
  id: string; // edge id
  relation: DebateRelation;
  basis: EdgeBasis;
  confidence: number;
  /** Connected-component id grouping debates that share ideas (multi-sided debates). */
  clusterId: string;
  clusterSize: number;
  status: DebateStatus;
  leaningSide: DebateSideKey | null;
  sharedThemes: string[];
  /** True when the same single work develops both sides (internal tension, not a cross-author debate). */
  internal: boolean;
  sideA: DebateSide;
  sideB: DebateSide;
  timeline: DebateTimelineEntry[];
  /** Rule-based, no-AI summary of the tension (always present). */
  tension: string;
  trace?: EdgeTrace | null;
}

/** Optional, user-triggered AI synthesis of a single debate. */
export interface DebateAnalysisRequest {
  debateId: string;
  model?: ModelRef | null;
}
export interface DebateAnalysisStreamHandlers {
  onDelta(delta: string): void;
  /** Reasoning/thinking trace, streamed for live display only. */
  onReasoning?(delta: string): void;
}
export interface DebateAnalysisResponse {
  analysis: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Research coverage map (question-driven research) — decompose a thesis question
// into sub-questions and map which the local corpus answers, partially answers,
// leaves uncovered, or only covers with internal disputes. Persisted artifact.
// ─────────────────────────────────────────────────────────────────────────────

export type RqStatus = 'draft' | 'decomposed' | 'mapped';
export type RqCoverageStatus = 'covered' | 'partial' | 'uncovered' | 'disputed';
export type RqLinkKind = 'idea' | 'work' | 'gap' | 'debate';

export interface ResearchQuestion {
  id: string;
  question: string;
  notes: string | null;
  model: ModelRef | null;
  status: RqStatus;
  /** Corpus size snapshot at the last mapping — used to flag stale coverage. */
  corpusIdeas: number;
  corpusWorks: number;
  createdAt: string;
  updatedAt: string;
  mappedAt: string | null;
}

export interface RqCoverageLink {
  id: string;
  kind: RqLinkKind;
  refId: string;
  label: string;
  score: number | null;
  /** For idea/work links: whether the backing work(s) have been deep-read (priority #2). */
  readState: 'read' | 'unread' | null;
}

export interface RqSubQuestion {
  id: string;
  text: string;
  rationale: string | null;
  orderIdx: number;
  coverageStatus: RqCoverageStatus | null;
  justification: string | null;
  links: RqCoverageLink[];
}

export interface ResearchCoverageSummary {
  covered: number;
  partial: number;
  uncovered: number;
  disputed: number;
  unmapped: number;
}

export interface ResearchQuestionDetail {
  rq: ResearchQuestion;
  subQuestions: RqSubQuestion[];
  /** True when the corpus grew since the last mapping (freshness hint). */
  stale: boolean;
  summary: ResearchCoverageSummary;
}

export interface RqDecomposeRequest {
  rqId: string;
  model?: ModelRef | null;
}
export interface RqMapRequest {
  rqId: string;
  model?: ModelRef | null;
}
export interface RqSubQuestionInput {
  id?: string;
  text: string;
  rationale?: string | null;
}
export interface RqUpdateSubQuestionsRequest {
  rqId: string;
  subQuestions: RqSubQuestionInput[];
}
export interface RqExportRequest {
  rqId: string;
}
export interface RqMapProgress {
  index: number;
  total: number;
  phase: 'retrieving' | 'classifying' | 'done';
  subQuestion: string;
}
export interface RqMapHandlers {
  onProgress?(progress: RqMapProgress): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hypothesis lab — turns gaps, debates and supporting ideas into testable,
// evidence-backed research hypotheses. Not persisted as its own table: users can
// save a generated dossier into Notes, where nodus:// citations remain clickable.
// ─────────────────────────────────────────────────────────────────────────────

export type HypothesisLabMode = 'exploratory' | 'causal' | 'comparative' | 'methodological' | 'intervention';
export type HypothesisMaturity = 'seed' | 'promising' | 'testable' | 'ready';
export type HypothesisEvidenceKind = 'gap' | 'idea' | 'debate' | 'work' | 'passage' | 'project';
export type HypothesisEvidenceRole = 'gap' | 'support' | 'contrast' | 'method' | 'scope' | 'source';

export interface HypothesisLabRequest {
  objective: string;
  mode: HypothesisLabMode;
  projectId?: string | null;
  language?: AppLanguage;
  maxCandidates?: number;
  model?: ModelRef | null;
}

export interface HypothesisEvidenceLink {
  kind: HypothesisEvidenceKind;
  role: HypothesisEvidenceRole;
  refId: string;
  label: string;
  citation: string;
  quote?: string | null;
  score?: number | null;
}

export interface HypothesisVariable {
  name: string;
  role: 'phenomenon' | 'context' | 'condition' | 'mechanism' | 'outcome' | 'case' | 'method';
  description: string;
}

export interface HypothesisCandidate {
  id: string;
  title: string;
  hypothesis: string;
  rationale: string;
  maturity: HypothesisMaturity;
  score: number;
  novelty: number;
  support: number;
  testability: number;
  risk: number;
  variables: HypothesisVariable[];
  evidence: HypothesisEvidenceLink[];
  methods: string[];
  predictions: string[];
  counterArguments: string[];
  nextSteps: string[];
  searchQueries: string[];
  draftAbstract: string;
}

export interface HypothesisLabStats {
  works: number;
  ideas: number;
  gaps: number;
  debates: number;
  passages: number;
  projectLinked: boolean;
  aiRefined: boolean;
  contextChars: number;
}

export interface HypothesisLabResult {
  generatedAt: string;
  request: HypothesisLabRequest;
  stats: HypothesisLabStats;
  candidates: HypothesisCandidate[];
  warnings: string[];
}

export interface GapAggregate {
  kind: GapKind;
  statement: string;
  count: number;
  works: { nodus_id: string; title: string; zotero_key: string }[];
  /** Individual records behind this normalized aggregate; use one with `nodus_get_gap`. */
  gapIds: string[];
}

export interface GapDetail {
  gap: Gap;
  work: {
    nodus_id: string;
    title: string;
    zotero_key: string;
    authors: string[];
    year: number | null;
    item_type: string;
  };
  relatedIdea: Pick<Idea, 'global_id' | 'type' | 'label' | 'statement'> | null;
  evidence: Evidence | null;
}

export type ReadingPathStrategy =
  | 'research_relevance'
  | 'gaps'
  | 'foundational'
  | 'recent'
  | 'connected_authors'
  | 'bridges';

export interface ReadingPathRequest {
  strategy?: ReadingPathStrategy;
  researchBrief?: string;
  limit?: number;
  includeRead?: boolean;
}

export interface ReadingAnalysisStatus {
  lightStatus: LightStatus;
  deepStatus: DeepStatus;
  summaryStatus: SummaryStatus;
  hasThemes: boolean;
  hasIdeas: boolean;
  hasContradictions: boolean;
  hasGaps: boolean;
  hasExternalRefs: boolean;
  themeCount: number;
  ideaCount: number;
  relationCount: number;
  contradictionCount: number;
  gapCount: number;
  externalRefCount: number;
}

export interface ReadingPathEntry {
  nodus_id: string;
  title: string;
  authors: string[];
  year: number | null;
  themes: string[];
  /** Orientation only; it must not be treated as evidence or a citation. */
  orientationSummary: string | null;
  readTag: boolean;
  read: boolean;
  analysis: ReadingAnalysisStatus;
  score: number;
  priority: number;
  phase: string;
  strategyScore: number;
  gapScore: number;
  foundationalScore: number;
  recencyScore: number;
  authorConnectivityScore: number;
  bridgeScore: number;
  interestScore: number;
  diversityKey: string | null;
  relatedGaps: string[];
  relatedIdeas: string[];
  connectedAuthors: string[];
  reason: string;
}

export interface ReadingPathPhase {
  id: string;
  title: string;
  objective: string;
  entries: ReadingPathEntry[];
  totalCandidates: number;
  omitted: number;
}

export interface ReadingPathPlan {
  strategy: ReadingPathStrategy;
  researchBrief: string;
  generatedAt: string;
  totalWorks: number;
  shownWorks: number;
  readCount: number;
  unreadCount: number;
  analyzedCount: number;
  pendingAnalysisCount: number;
  summary: string;
  phases: ReadingPathPhase[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Research assistant
// ─────────────────────────────────────────────────────────────────────────────

export interface ResearchGraphPartsSelection {
  ideaNodes: boolean;
  themeNodes: boolean;
  ideaEdges: boolean;
  authorGraph: boolean;
}

export interface ResearchContextSelection {
  ideas: boolean;
  themes: boolean;
  contradictions: boolean;
  gaps: boolean;
  readingPath: boolean;
  authors: boolean;
  documents: boolean;
  /** Fine-grained full-text evidence retrieved from the local passage index. */
  passages: boolean;
  graph: boolean;
  graphParts: ResearchGraphPartsSelection;
}

export interface ResearchChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ResearchChatRequest {
  messages: ResearchChatMessage[];
  selection: ResearchContextSelection;
  model?: ModelRef | null;
}

export interface ResearchContextStats {
  sections: string[];
  works: number;
  documents: number;
  summaries: number;
  passages: number;
  contextChars: number;
  truncated: boolean;
}

export interface ResearchChatResponse {
  answer: string;
  stats: ResearchContextStats;
}

export interface ResearchChatStreamHandlers {
  onDelta(delta: string): void;
  /** Reasoning/thinking trace, streamed for live display only. */
  onReasoning?(delta: string): void;
  onStats?(stats: ResearchContextStats): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tutor mode — AI-guided, step-by-step walkthrough of the idea graph
// ─────────────────────────────────────────────────────────────────────────────

export type TutorMode = 'overview' | 'prompt';

/** What a tour stop is anchored to in the graph. */
export type TutorStopKind = 'theme' | 'idea' | 'connection';

export interface TutorStop {
  id: string;
  kind: TutorStopKind;
  title: string;
  /** One line: why we pause here / what to notice. */
  focus: string;
  /** Graph node ids to spotlight: an idea `global_id` or `theme:<id>`. A connection lists both endpoints. */
  nodeIds: string[];
  /** Edge id when the stop is a connection between two ideas. */
  edgeId: string | null;
}

export interface TutorRoute {
  id: string;
  title: string;
  description: string;
  /** 1..5 — relative weight/centrality of this route in the corpus. */
  weight: number;
  /** Short human label for the weight, e.g. "línea principal". */
  weightLabel: string;
  themes: string[];
  stops: TutorStop[];
}

export interface TutorPlan {
  generatedAt: string;
  mode: TutorMode;
  prompt: string;
  /** Map-level welcome that mentions everything important before the routes. */
  overview: string;
  totalThemes: number;
  totalIdeas: number;
  totalConnections: number;
  /** Distinct idea nodes referenced by at least one route stop. */
  coveredIdeas: number;
  routes: TutorRoute[];
  /** True when the graph was too large to send whole (some nodes/edges omitted). */
  truncated: boolean;
}

export interface TutorSavedRoute {
  id: string;
  planId: string;
  generatedAt: string;
  updatedAt: string;
  lastPlayedAt: string | null;
  mode: TutorMode;
  prompt: string;
  model: ModelRef | null;
  overview: string;
  totalThemes: number;
  totalIdeas: number;
  totalConnections: number;
  route: TutorRoute;
  rating: number | null;
}

export interface TutorPlanRequest {
  mode: TutorMode;
  prompt?: string;
  model?: ModelRef | null;
}

export interface TutorStepRequest {
  /** The route being toured (sent on each call so the backend stays stateless). */
  route: TutorRoute;
  stopIndex: number;
  overview: string;
  /** Titles of stops already visited, for narrative continuity. */
  history: string[];
  /** Tail of the immediately previous stop's narration, so the discourse continues without repeating. */
  previousText?: string;
  model?: ModelRef | null;
}

export interface TutorStepResponse {
  explanation: string;
}

export interface TutorStepStreamHandlers {
  onDelta(delta: string): void;
  /** Reasoning/thinking trace, streamed for live display only. */
  onReasoning?(delta: string): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Argument map (AI-traced hierarchical block outline around a seed idea)
// ─────────────────────────────────────────────────────────────────────────────

/** One block in the argument map tree. Synthetic ids are assigned by the backend. */
export interface ArgumentBlock {
  id: string;
  /** global_id of the underlying idea, or null for a synthetic framing block. */
  ideaId: string | null;
  label: string;
  statement: string;
  type: IdeaType | 'framing';
  /** One-line gloss from the model explaining this block's role. */
  summary: string;
  /** How this block relates to its parent (a real edge type, or 'root'/'framing'). */
  relation: EdgeType | 'root' | 'framing' | 'related';
  children: ArgumentBlock[];
}

export interface ArgumentMap {
  seedIdeaId: string;
  seedLabel: string;
  overview: string;
  root: ArgumentBlock;
  generatedAt: string;
  /** True when the local subgraph sent to the model was capped. */
  truncated: boolean;
  ideaCount: number;
}

export interface ArgumentMapRequest {
  seedIdeaId: string;
  model?: ModelRef | null;
  /** 'ai' traces the tree with the model; 'auto' builds it structurally from the
   *  real graph edges (no model needed). Defaults to 'ai'. */
  mode?: 'ai' | 'auto';
}

/** A ranked seed candidate for the automatic argument-map mode. */
export interface ArgumentRouteSuggestion {
  ideaId: string;
  label: string;
  statement: string;
  type: IdeaType;
  /** Number of idea↔idea connections. */
  degree: number;
  /** Connections that are contradictions or refutations (debate hubs surface higher). */
  debateCount: number;
  /** Average confidence across the idea's connections. */
  avgConfidence: number;
  /** Relation-type breakdown, most frequent first. */
  topRelations: { type: EdgeType; count: number }[];
  /** Up to a few neighbour labels, for a quick preview of the route. */
  neighborLabels: string[];
}


// ─────────────────────────────────────────────────────────────────────────────
// Research chat history (persisted conversations)
// ─────────────────────────────────────────────────────────────────────────────

/** One persisted chat message. `stats`/`selectionKey`/`error` mirror the in-memory UI message. */
export interface ChatMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  selectionKey?: string | null;
  stats?: ResearchContextStats | null;
  error?: boolean;
}

/** Conversation list entry (no messages) for the history sidebar. */
export interface ChatConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived: boolean;
  model: ModelRef | null;
  messageCount: number;
}

/** A full conversation with its messages and the context selection it was using. */
export interface ChatConversation extends ChatConversationSummary {
  selection: ResearchContextSelection | null;
  messages: ChatMessageRecord[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Notes (user-structured workspace: folders/subfolders + markdown/AI notes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Where a note's content came from. `markdown` is a hand-written note; the others
 * carry content captured from another surface (assistant answer, writing workshop
 * draft, debate synthesis, or a single idea) whose Markdown keeps `nodus://`
 * citations so they stay clickable inside the notes editor.
 */
export type NoteKind = 'markdown' | 'assistant' | 'writing' | 'debate' | 'idea' | 'hypothesis';

/** Optional provenance metadata kept alongside a captured note (model, source ids…). */
export interface NoteSource {
  origin: NoteKind;
  model?: ModelRef | null;
  /** Free-form references back to the originating object (idea id, draft title…). */
  ref?: string | null;
  note?: string | null;
}

export interface NoteFolder {
  id: string;
  parentId: string | null;
  name: string;
  /** Free-text brief: the ideas this folder is meant to hold. Drives AI idea suggestions. */
  summary: string;
  orderIdx: number;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  folderId: string | null;
  title: string;
  kind: NoteKind;
  content: string;
  source: NoteSource | null;
  orderIdx: number;
  createdAt: string;
  updatedAt: string;
}

/** Whole notes workspace in one payload so the view can build the tree client-side. */
export interface NotesTree {
  folders: NoteFolder[];
  notes: Note[];
}

export interface CreateNoteFolderInput {
  name: string;
  parentId?: string | null;
}

export interface CreateNoteInput {
  title: string;
  content: string;
  kind?: NoteKind;
  folderId?: string | null;
  source?: NoteSource | null;
}

export interface UpdateNoteInput {
  id: string;
  title?: string;
  content?: string;
  folderId?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manual ideas — user-authored ideas that live in the graph, owned by a note.
// The note's `source.note` carries MANUAL_IDEA_MARKER and `source.ref` the idea
// id, so deleting the note also purges the idea and its indexing.
// ─────────────────────────────────────────────────────────────────────────────

export const MANUAL_IDEA_MARKER = 'manual-idea';

/** A work the manual idea is developed in, plus the user's note on how. */
export interface ManualIdeaWorkLink {
  nodusId: string;
  development: string;
}

/** An anchored quote, optionally tied to one of the linked works. */
export interface ManualIdeaEvidence {
  nodusId: string | null;
  quote: string;
  location: string | null;
}

/** A connection from this idea to another idea (manual or accepted suggestion). */
export interface ManualIdeaConnection {
  toId: string;
  toLabel: string;
  type: EdgeType;
  confidence: number;
  /** 'inferred' when accepted from the auto-index search, 'explicit' when hand-added. */
  basis: EdgeBasis;
}

export interface ManualIdeaPayload {
  globalId: string;
  noteId: string;
  title: string;
  summary: string;
  works: ManualIdeaWorkLink[];
  evidence: ManualIdeaEvidence[];
  connections: ManualIdeaConnection[];
}

/** A candidate idea returned by the connection search or the auto-index suggestions. */
export interface IdeaCandidate {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  similarity?: number;
}

export interface AutoIndexResult {
  indexed: boolean;
  /** Null when no embedding provider is configured / embedding failed. */
  message: string | null;
  suggestions: IdeaCandidate[];
}

/** How a work's bibliography is rendered in a notes export. */
export type NotesExportBibliography = 'full' | 'zotero' | 'none';

/** Granular options for the structured notes export. */
export interface NotesExportOptions {
  format: 'markdown' | 'json';
  /** Root of the export: a folder id (its whole subtree) or null for every note. */
  folderId: string | null;
  /** Include each note's raw Markdown body. */
  includeContent: boolean;
  /** Include anchored evidence for idea notes. */
  includeEvidence: boolean;
  /** Include the connections of idea notes. */
  includeRelations: boolean;
  /** Per-work bibliography detail: full citation, Zotero item key only, or nothing. */
  bibliography: NotesExportBibliography;
}

/** Result of an AI logical reorder of the notes in one scope. */
export interface NotesReorderResult {
  orderedIds: string[];
}

/**
 * One idea Nodus proposes integrating into a folder, with the AI's justification.
 * Produced by matching the folder's summary against the whole idea base.
 */
export interface FolderIdeaSuggestion {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  /** Semantic cosine similarity to the folder summary (null when surfaced only via a graph edge). */
  similarity: number | null;
  /** True when the idea was reached by expanding a conceptual connection rather than direct similarity. */
  viaConnection: boolean;
  /** The AI's short reason for why this idea belongs in the folder. */
  reason: string;
  /** The AI's 0..1 fit score, used to order the list. */
  score: number;
}

/** Result of analysing every available idea against a folder's summary. */
export interface FolderIdeaSuggestionsResult {
  ok: boolean;
  /** Null on success; a human-readable explanation when no suggestions could be produced. */
  message: string | null;
  suggestions: FolderIdeaSuggestion[];
  /** Ideas already present in the folder subtree, excluded from the analysis. */
  excludedCount: number;
  /** Candidate ideas considered before the AI curation step. */
  consideredCount: number;
}

/** The kinds of sources an inline `nodus://` citation can point to. */
export type CitationKind = 'idea' | 'work' | 'gap' | 'contradiction' | 'passage';

/** A single inline citation to verify against the local graph/corpus. */
export interface CitationRef {
  kind: CitationKind;
  id: string;
}

/**
 * Lightweight preview of a cited source, shown in the hover-card that appears
 * over an inline citation before the user commits to opening the full source
 * modal. All strings come straight from the corpus (already Spanish); the
 * caller adds the localized kind label.
 */
export interface CitationPreview {
  kind: CitationKind;
  title: string;
  subtitle?: string;
  snippet?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Global search
// ─────────────────────────────────────────────────────────────────────────────

/** The entity types the global search spans, each of which links elsewhere. */
export type SearchResultKind = 'note' | 'idea' | 'work' | 'gap' | 'theme' | 'author' | 'passage';

/** A single match. `id` and the optional fields carry what the UI needs to route
 * to the right destination (graph node, work, note, gaps view, …). */
export interface GlobalSearchResult {
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle?: string | null;
  snippet?: string | null;
  /** Works/passages: to open in Zotero / focus the reading graph. */
  zoteroKey?: string | null;
  /** Passages: the work this passage belongs to, to route into its reading graph. */
  nodusId?: string | null;
  /** Passages: page label for the citation chip. */
  pageLabel?: string | null;
  /** Ideas only: node type, for the badge. */
  ideaType?: string | null;
  /** Gaps only: gap kind, for the badge. */
  gapKind?: GapKind | null;
  /** Themes only: the theme label used as a graph filter. */
  themeLabel?: string | null;
  /** Semantic results only: cosine similarity in [0,1]. */
  similarity?: number | null;
}

/** Common, type-adaptive detail payload used by the global-search modal. */
export interface SearchResultDetail {
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  metadata: Array<{ label: string; value: string }>;
  sections: Array<{ title: string; content: string }>;
}

export interface GlobalSearchResponse {
  query: string;
  results: GlobalSearchResult[];
}

/** Which retrieval strategy the search box uses. */
export type SearchMode = 'text' | 'semantic';

export interface SemanticSearchOptions {
  /** Which result kinds to include. Empty/undefined ⇒ ideas, passages and works. */
  kinds?: SearchResultKind[];
  /** Max results per kind. */
  limit?: number;
  /** Minimum cosine similarity to keep a match. */
  minSimilarity?: number;
}

export interface SemanticSearchResponse {
  /** False when no embedding provider/key is configured, so nothing could be embedded. */
  available: boolean;
  results: GlobalSearchResult[];
}

/** A reusable search the user pinned: query + mode + kind filters. */
export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  mode: SearchMode;
  kinds: SearchResultKind[];
  created_at: string;
}

export interface SaveSearchInput {
  name: string;
  query: string;
  mode: SearchMode;
  kinds: SearchResultKind[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Corpus health (Home dashboard)
// ─────────────────────────────────────────────────────────────────────────────

export interface CorpusHealthWork {
  nodus_id: string;
  title: string;
  year: number | null;
  zotero_key: string | null;
}

/** One health dimension: how many works fall in it plus a small clickable sample. */
export interface CorpusHealthBucket {
  count: number;
  sample: CorpusHealthWork[];
}

/** The work-level corpus-health buckets that can be replayed as a Library filter. */
export type CorpusHealthBucketId = 'withoutText' | 'lightOnly' | 'deepPriority' | 'pdfsToRecover';

export interface CorpusHealth {
  totalWorks: number;
  /** Works with no usable full text (abstract-only, no source, or extraction skipped). */
  withoutText: CorpusHealthBucket;
  /** Works analysed only lightly (themes done) but never deep-analysed, although text exists. */
  lightOnly: CorpusHealthBucket;
  /** Works flagged as important (read tag or manual) still missing deep analysis. */
  deepPriority: CorpusHealthBucket;
  /** Works whose text could not be extracted but a recovery path (OCR / DOI) exists. */
  pdfsToRecover: CorpusHealthBucket;
  embeddings: {
    totalIdeas: number;
    embeddedIdeas: number;
    pendingIdeas: number;
    /** Non-archived works with at least one idea still lacking a current embedding. */
    incompleteWorks: number;
    /** Works with text whose full-text passage index is missing or outdated. */
    passagesPendingWorks: number;
  };
}

/** AI-suggested ways to find literature that would fill a research gap. */
export interface GapSearchSuggestions {
  keywords: string[];
  queries: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Projects / manuscripts — a project is a research-writing container layered on
// top of Notes, coverage maps, writing drafts and verifiable graph material.
// ─────────────────────────────────────────────────────────────────────────────

export type ProjectKind = 'thesis' | 'article' | 'chapter' | 'literature_review' | 'theoretical_framework' | 'other';
export type ProjectStatus = 'active' | 'paused' | 'done';
export type ProjectSectionRole =
  | 'brief'
  | 'coverage'
  | 'literature'
  | 'debates'
  | 'gaps'
  | 'drafts'
  | 'manuscript'
  | 'custom';
export type ProjectSectionStatus = 'empty' | 'in_progress' | 'review' | 'ready' | 'discarded';
export type ProjectLinkKind =
  | 'note'
  | 'folder'
  | 'idea'
  | 'work'
  | 'gap'
  | 'debate'
  | 'tutor_route'
  | 'writing_draft'
  | 'research_question'
  | 'chapter';
export type ProjectLinkRole =
  | 'evidence'
  | 'argument'
  | 'counterargument'
  | 'pending'
  | 'discarded'
  | 'key_citation'
  | 'source'
  | 'draft'
  | 'context';
export type ChapterSourceFormat = 'docx' | 'pdf' | 'epub' | 'markdown' | 'txt' | 'unknown';
export type ChapterSuggestionKind = 'idea' | 'gap' | 'debate' | 'work' | 'note';
export type ChapterSuggestionOperation = 'insert_after' | 'insert_before' | 'replace' | 'comment';
export type ChapterSuggestionStatus = 'suggested' | 'accepted' | 'rejected' | 'applied' | 'blocked';
export type ChapterSuggestionMode = 'suggest' | 'insert';
export type ProjectExportFormat = 'markdown' | 'json';
export type ChapterExportFormat = 'markdown' | 'txt' | 'docx' | 'pdf';

export interface Project {
  id: string;
  title: string;
  kind: ProjectKind;
  status: ProjectStatus;
  brief: string;
  researchQuestionId: string | null;
  rootFolderId: string | null;
  model: ModelRef | null;
  targetWords: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSection {
  id: string;
  projectId: string;
  folderId: string | null;
  title: string;
  role: ProjectSectionRole;
  status: ProjectSectionStatus;
  targetWords: number | null;
  orderIdx: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectLink {
  id: string;
  projectId: string;
  sectionId: string | null;
  kind: ProjectLinkKind;
  refId: string;
  label: string;
  role: ProjectLinkRole;
  createdAt: string;
}

export interface ProjectChapter {
  id: string;
  projectId: string;
  sectionId: string | null;
  noteId: string | null;
  title: string;
  sourceFormat: ChapterSourceFormat;
  originalFileName: string | null;
  originalTextHash: string;
  originalText: string;
  currentMarkdown: string;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectChapterChunk {
  id: string;
  chapterId: string;
  orderIdx: number;
  headingPath: string;
  text: string;
  startOffset: number;
  endOffset: number;
  wordCount: number;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingDim: number | null;
  embeddingTextHash: string | null;
}

export interface ProjectInsertionSuggestion {
  id: string;
  projectId: string;
  chapterId: string;
  targetChunkId: string | null;
  kind: ChapterSuggestionKind;
  refId: string;
  refLabel: string;
  operation: ChapterSuggestionOperation;
  proposedText: string;
  citationRefs: CitationRef[];
  rationale: string;
  confidence: number;
  status: ChapterSuggestionStatus;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectChapterVersion {
  id: string;
  chapterId: string;
  label: string;
  markdown: string;
  createdAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapter ideas: ideas distilled from the uploaded chapter text, kept separate
// from the curated graph, and their typed relations with the library.
// ─────────────────────────────────────────────────────────────────────────────

export type ChapterIdeaType = 'claim' | 'finding' | 'construct' | 'method' | 'framework';
/** How a chapter idea relates to a library entity. */
export type ChapterRelationType = 'supports' | 'contradicts' | 'refines' | 'extends' | 'related';
/** Which library entity a chapter idea relates to. */
export type ChapterRelationTargetKind = 'idea' | 'note' | 'passage' | 'work';

export interface ProjectChapterIdea {
  id: string;
  chapterId: string;
  projectId: string;
  type: ChapterIdeaType;
  label: string;
  statement: string;
  orderIdx: number;
  createdAt: string;
}

/** A typed relation from a chapter idea to a library entity, with display metadata. */
export interface ChapterIdeaRelation {
  id: string;
  chapterIdeaId: string;
  targetKind: ChapterRelationTargetKind;
  targetId: string;
  relation: ChapterRelationType;
  similarity: number;
  confidence: number;
  rationale: string;
  /** Human-readable title of the target (idea label, note title, work title…). */
  targetLabel: string;
  /** Short context for the target (author·year, snippet…). */
  targetSubtitle: string | null;
}

/** A chapter idea bundled with its discovered relations, for the relations view. */
export interface ChapterIdeaWithRelations {
  idea: ProjectChapterIdea;
  relations: ChapterIdeaRelation[];
}

export interface ChapterRelationsResult {
  chapterId: string;
  /** True once ideas have been extracted at least once for the current text. */
  analyzed: boolean;
  /** False when no embedding provider/key is configured. */
  available: boolean;
  ideas: ChapterIdeaWithRelations[];
}

/** Progress event while analysing a chapter's ideas and relations. */
export interface ChapterRelationsProgress {
  chapterId: string;
  phase: 'extracting' | 'embedding' | 'relating' | 'done' | 'error';
  current: number;
  total: number;
  message: string | null;
}

export interface AnalyzeChapterRelationsRequest {
  chapterId: string;
  model?: ModelRef | null;
  /** Re-extract and recompute even if cached for the current text hash. */
  force?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Manuscript verifier: sentence-level claim checks against indexed/listed corpus
// ideas and full-text passages. It is deliberately not a "send whole manuscript
// to the model" feature: the main process extracts candidate claims first and
// only sends compact claim+evidence batches for optional classification.
// ─────────────────────────────────────────────────────────────────────────────

export type ManuscriptClaimStatus = 'missing_citation' | 'covered' | 'own_argument' | 'weak_match';
export type ManuscriptClaimSeverity = 'high' | 'medium' | 'low' | 'info';
export type ManuscriptEvidenceKind = 'idea' | 'passage';

export interface ManuscriptEvidenceCandidate {
  kind: ManuscriptEvidenceKind;
  refId: string;
  label: string;
  citation: string;
  snippet: string;
  score: number;
  workTitle?: string | null;
  pageLabel?: string | null;
  /** True when the AI review confirmed this candidate as direct support for the claim. */
  aiEndorsed?: boolean;
}

export interface ManuscriptClaimCheck {
  id: string;
  excerpt: string;
  paragraphIndex: number;
  sentenceIndex: number;
  hasCitation: boolean;
  existingCitations: string[];
  status: ManuscriptClaimStatus;
  severity: ManuscriptClaimSeverity;
  rationale: string;
  suggestedCitations: ManuscriptEvidenceCandidate[];
  replacementHint?: string | null;
}

export interface ManuscriptVerificationSummary {
  totalClaims: number;
  checkedClaims: number;
  missingCitations: number;
  covered: number;
  ownArguments: number;
  weakMatches: number;
  citedClaims: number;
}

export interface ManuscriptVerificationResult {
  chapterId: string;
  generatedAt: string;
  /** False only when there is no chapter text or no corpus signal to compare against. */
  available: boolean;
  /** True when an AI pass refined the deterministic retrieval result. */
  aiReviewed: boolean;
  summary: ManuscriptVerificationSummary;
  claims: ManuscriptClaimCheck[];
  warnings: string[];
}

export interface ManuscriptVerificationRequest {
  chapterId: string;
  model?: ModelRef | null;
  language?: AppLanguage;
  maxClaims?: number;
}

export interface ApplyManuscriptCitationRequest {
  chapterId: string;
  /** Claim sentence as returned by the verifier; located in the draft with whitespace tolerance. */
  excerpt: string;
  /** Citation markdown to append to the sentence, e.g. `[label](nodus://idea/...)`. */
  citationMarkdown: string;
}

export interface ApplyManuscriptCitationResult {
  /** False when the sentence could not be located in the current draft. */
  applied: boolean;
  chapter: ProjectChapter | null;
}

export interface ProjectDetail {
  project: Project;
  sections: ProjectSection[];
  links: ProjectLink[];
  chapters: ProjectChapter[];
  stats: {
    sections: number;
    links: number;
    chapters: number;
    suggestions: number;
    appliedSuggestions: number;
  };
}

export interface CreateProjectInput {
  title: string;
  kind?: ProjectKind;
  brief?: string;
  researchQuestionId?: string | null;
  model?: ModelRef | null;
  targetWords?: number | null;
}

export interface UpdateProjectInput {
  id: string;
  title?: string;
  kind?: ProjectKind;
  status?: ProjectStatus;
  brief?: string;
  researchQuestionId?: string | null;
  model?: ModelRef | null;
  targetWords?: number | null;
}

export interface UpdateProjectSectionInput {
  id: string;
  title?: string;
  role?: ProjectSectionRole;
  status?: ProjectSectionStatus;
  targetWords?: number | null;
}

export interface AddProjectLinkInput {
  projectId: string;
  sectionId?: string | null;
  kind: ProjectLinkKind;
  refId: string;
  label?: string;
  role?: ProjectLinkRole;
}

export interface ImportProjectChapterInput {
  projectId: string;
  sectionId?: string | null;
  /** Optional explicit file path; when omitted the main process opens a file picker. */
  filePath?: string | null;
  title?: string;
}

export interface GenerateProjectSuggestionsRequest {
  projectId: string;
  chapterId: string;
  sectionId?: string | null;
  mode: ChapterSuggestionMode;
  model?: ModelRef | null;
  limit?: number;
}

export interface ApplyProjectSuggestionsRequest {
  chapterId: string;
  suggestionIds: string[];
}

export interface ExportProjectRequest {
  projectId: string;
  format: ProjectExportFormat;
}

export interface ExportProjectChapterRequest {
  chapterId: string;
  format: ChapterExportFormat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing workshop
// ─────────────────────────────────────────────────────────────────────────────

export type WritingWorkshopKind =
  | 'literature_review'
  | 'theoretical_framework'
  | 'debate'
  | 'gap_justification'
  | 'chapter_section'
  | 'research_question'
  | 'deep_research';

export interface WritingWorkshopBrief {
  kind: WritingWorkshopKind;
  objective: string;
  audience?: string;
  tone?: 'academic' | 'synthetic' | 'critical' | 'exploratory';
  language?: 'es' | 'en' | 'fr';
}

export interface WritingWorkshopSelection {
  ideaIds: string[];
  themeIds: string[];
  gapIds: string[];
  contradictionIds: string[];
  workIds: string[];
  /** Full-text evidence deliberately selected from semantic retrieval. */
  passageIds: string[];
  tutorRouteIds: string[];
}

export interface WritingWorkshopCandidateBase {
  id: string;
  label: string;
  summary: string;
  score: number;
  reason: string;
}

export interface WritingWorkshopIdeaCandidate extends WritingWorkshopCandidateBase {
  type: IdeaType;
  statement: string;
  themes: string[];
  workCount: number;
  evidenceCount: number;
  works: { nodus_id: string; title: string; authors: string[]; year: number | null; zotero_key: string }[];
}

export interface WritingWorkshopThemeCandidate extends WritingWorkshopCandidateBase {
  workCount: number;
  ideaCount: number;
  pinned: boolean;
}

export interface WritingWorkshopGapCandidate extends WritingWorkshopCandidateBase {
  kind: GapKind;
  work: { nodus_id: string; title: string; authors: string[]; year: number | null; zotero_key: string };
  relatedIdea: string | null;
  confidence: number;
}

export interface WritingWorkshopContradictionCandidate extends WritingWorkshopCandidateBase {
  fromLabel: string;
  toLabel: string;
  type: EdgeType | string;
  basis: EdgeBasis;
  confidence: number;
}

export interface WritingWorkshopWorkCandidate extends WritingWorkshopCandidateBase {
  title: string;
  authors: string[];
  year: number | null;
  zotero_key: string;
  themes: string[];
  deepStatus: DeepStatus;
  /** Orientation only; never evidence or a citation target. */
  orientationSummary?: string | null;
  ideaCount: number;
  gapCount: number;
}

export interface WritingWorkshopPassageCandidate extends WritingWorkshopCandidateBase {
  nodus_id: string;
  pageLabel: string | null;
  authors: string[];
  year: number | null;
  zotero_key: string;
  citation: string;
}

export interface WritingWorkshopRouteCandidate extends WritingWorkshopCandidateBase {
  routeTitle: string;
  mode: TutorMode;
  prompt: string;
  themes: string[];
  stops: number;
  rating: number | null;
}

export interface WritingWorkshopSnapshot {
  generatedAt: string;
  brief: WritingWorkshopBrief;
  stats: {
    ideas: number;
    themes: number;
    gaps: number;
    contradictions: number;
    works: number;
    passages: number;
    tutorRoutes: number;
  };
  recommendedSelection: WritingWorkshopSelection;
  ideas: WritingWorkshopIdeaCandidate[];
  themes: WritingWorkshopThemeCandidate[];
  gaps: WritingWorkshopGapCandidate[];
  contradictions: WritingWorkshopContradictionCandidate[];
  works: WritingWorkshopWorkCandidate[];
  passages: WritingWorkshopPassageCandidate[];
  tutorRoutes: WritingWorkshopRouteCandidate[];
}

export interface WritingWorkshopSection {
  id: string;
  title: string;
  purpose: string;
  keyClaims: string[];
  sources: string[];
}

export interface WritingWorkshopMatrixRow {
  claim: string;
  role: 'support' | 'contrast' | 'gap' | 'method' | 'definition' | 'context';
  sourceLabel: string;
  citation: string;
  evidence: string;
  notes: string;
}

export interface WritingWorkshopDraft {
  generatedAt: string;
  brief: WritingWorkshopBrief;
  selection: WritingWorkshopSelection;
  title: string;
  abstract: string;
  outline: WritingWorkshopSection[];
  draftMarkdown: string;
  matrix: WritingWorkshopMatrixRow[];
  bibliography: string[];
  nextSteps: string[];
  limitations: string[];
  stats: {
    selectedIdeas: number;
    selectedThemes: number;
    selectedGaps: number;
    selectedContradictions: number;
    selectedWorks: number;
    selectedPassages: number;
    selectedTutorRoutes: number;
    contextChars: number;
    truncated: boolean;
  };
}

export interface WritingWorkshopDraftRequest {
  brief: WritingWorkshopBrief;
  selection: WritingWorkshopSelection;
  model?: ModelRef | null;
}

export type WritingWorkshopExportFormat = 'markdown' | 'pdf';

export interface WritingWorkshopExportRequest {
  draft: WritingWorkshopDraft;
  /** Output format. Defaults to `'markdown'` when omitted. */
  format?: WritingWorkshopExportFormat;
}

/** A locally saved workshop draft, including the exact prompt and selected evidence. */
export interface WritingWorkshopSavedDraft {
  id: string;
  title: string;
  brief: WritingWorkshopBrief;
  selection: WritingWorkshopSelection;
  model: ModelRef | null;
  draft: WritingWorkshopDraft;
  image: DecorativeImage | null;
  createdAt: string;
  updatedAt: string;
}

export interface WritingWorkshopSaveDraftRequest {
  draft: WritingWorkshopDraft;
  model?: ModelRef | null;
  /** Defaults to the generated draft title when omitted. */
  title?: string;
  /** Only Deep Research uses this. Undefined keeps ordinary workshop saves unchanged. */
  decorativeImage?: DecorativeImageOption;
}

export interface WritingWorkshopStreamHandlers {
  onDelta(delta: string): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep Research — orchestrated, coverage-guided multi-page report
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How ambitious the report should be. `adaptive` (default) sizes the page target
 * from the amount of relevant material in the corpus; the fixed buckets let the
 * user pin a range. Every bucket is clamped to the professional 5–20 page window.
 */
export type DeepResearchTargetLength = 'adaptive' | 'concise' | 'standard' | 'exhaustive';

/**
 * How the number of report sections is decided. `'auto'` lets the model/heuristic
 * pick from the corpus size; a positive number is a soft ceiling — the planner aims
 * for at most that many sections and may exceed it by one only when strictly needed.
 * The bibliography, abstract and limitations never count as sections.
 */
export type DeepResearchSectionLimit = 'auto' | number;

export interface DeepResearchRequest {
  /** The research idea/question the whole report must develop. */
  objective: string;
  language?: 'es' | 'en' | 'fr';
  audience?: string;
  targetLength?: DeepResearchTargetLength;
  /**
   * Upper bound on the number of sections. `'auto'` (default) sizes it from the
   * corpus; a number caps it (with a one-section grace). Fewer, longer sections are
   * preferred over many short ones.
   */
  sectionLimit?: DeepResearchSectionLimit;
  model?: ModelRef | null;
  decorativeImage?: DecorativeImageOption;
}

/** One live progress event emitted while a report is being orchestrated. */
export interface DeepResearchProgress {
  phase: 'snapshot' | 'planning' | 'section' | 'coverage' | 'assembling' | 'done';
  message: string;
  /** 1-based index of the section being written (phase === 'section'). */
  sectionIndex?: number;
  sectionTotal?: number;
  sectionTitle?: string;
  wordsSoFar?: number;
  pagesSoFar?: number;
}

/** Coverage + budget accounting attached to a finished report. */
export interface DeepResearchMeta {
  sections: number;
  words: number;
  pages: number;
  ideasCovered: number;
  ideasConsidered: number;
  worksCited: number;
  targetPages: { min: number; max: number };
  /** Non-null when the loop stopped before covering everything (budget cap, cap on sections, etc.). */
  stoppedReason: string | null;
}

/**
 * A finished report. `draft` reuses the Writing Workshop draft shape so the whole
 * downstream stack (renderer, citation modal, export, local save) works unchanged;
 * `meta` carries the deep-research-specific accounting.
 */
export interface DeepResearchReport {
  draft: WritingWorkshopDraft;
  meta: DeepResearchMeta;
}

export interface DeepResearchStreamHandlers {
  onProgress?(progress: DeepResearchProgress): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Updates
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateCheckStatus =
  | 'disabled'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error';

export interface UpdateCheckResponse {
  status: UpdateCheckStatus;
  message: string;
  version?: string;
  progress?: number | null;
  bytesPerSecond?: number | null;
  transferred?: number | null;
  total?: number | null;
}

export interface UpdateProgressEvent extends UpdateCheckResponse {
  at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Author Dossier ("Ficha de autor") — a per-author study surface that assembles
// what one author claims across the corpus plus how they relate to the others.
// Assembly is pure DB; the `synthesis` block is an on-demand, cached AI pass.
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthorSummary {
  author_id: string;
  /** Sort form as stored ("Surname, Given"). */
  name: string;
  /** Given name(s), for name-order sorting. */
  firstName: string;
  /** Surname(s), for surname sorting. */
  lastName: string;
  /** Natural reading order ("Given Surname") for display. */
  fullName: string;
  affiliation: string | null;
  workCount: number;
  ideaCount: number;
  relationCount: number;
  topThemes: string[];
  read: boolean;
  hasSynthesis: boolean;
}

export interface AuthorDossierWork {
  nodus_id: string;
  title: string;
  authors: string[];
  year: number | null;
  itemType: string | null;
  doi: string | null;
  zoteroKey: string | null;
  sourceType: SourceType | null;
  lightStatus: LightStatus;
  deepStatus: DeepStatus;
  summaryStatus: SummaryStatus;
  notes: string | null;
  read: boolean;
  /** How this person is credited on the work (from Zotero). */
  role: 'author' | 'editor';
}

export interface AuthorDossierIdea {
  global_id: string;
  type: IdeaType;
  label: string;
  statement: string;
  development: string;
  role: 'principal' | 'secondary';
  confidence: number;
  workId: string;
  workTitle: string;
  year: number | null;
  themes: string[];
  evidence: Evidence[];
}

export interface AuthorDossierRelation {
  author_id: string;
  name: string;
  /** contradicts | extends | supports | refutes (from the derived author_relations layer). */
  type: string;
  weight: number;
  sharedThemes: string[];
}

export interface AuthorDossierSynthesis {
  /** 1–2 sentence central thesis of the author across their works. */
  thesis: string;
  /** Short "what to remember" bullets for fast retention under time pressure. */
  remember: string[];
  /** One paragraph narrating how this author relates to the connected authors. */
  positioning: string;
  model: ModelRef | null;
  generatedAt: string;
  /** True when the underlying ideas/relations changed since this was generated. */
  stale: boolean;
}

export interface WorkIdeaSynthesis {
  /** 1–2 sentence central thesis of one work across its extracted ideas. */
  thesis: string;
  /** Short "what to remember" bullets for fast retention under time pressure. */
  remember: string[];
  /** One paragraph placing the work within its internal themes and tensions. */
  positioning: string;
  model: ModelRef | null;
  generatedAt: string;
  stale: boolean;
}

export interface AuthorDossier {
  author: Author;
  /** Natural reading order ("Given Surname") for the card heading. */
  fullName: string;
  firstName: string;
  lastName: string;
  works: AuthorDossierWork[];
  ideas: AuthorDossierIdea[];
  relations: AuthorDossierRelation[];
  themes: string[];
  synthesis: AuthorDossierSynthesis | null;
}

export interface AuthorSynthesisExportRequest {
  /** Authors to export. Empty = every author that has a generated synthesis. */
  authorIds: string[];
  format: 'markdown' | 'pdf';
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthesis Matrix ("Matriz de síntesis") — the classic literature matrix:
// rows = authors, columns = themes, cells = that author's ideas on that theme.
// Counts/labels are pure DB; the per-cell `stance` is an on-demand, cached AI pass.
// ─────────────────────────────────────────────────────────────────────────────

export interface SynthesisMatrixAuthor {
  author_id: string;
  name: string;
  workCount: number;
}

export interface SynthesisMatrixTheme {
  theme_id: string;
  label: string;
}

export interface SynthesisMatrixCellIdea {
  global_id: string;
  label: string;
  type: IdeaType;
}

export interface SynthesisMatrixCell {
  authorId: string;
  themeId: string;
  ideaCount: number;
  ideas: SynthesisMatrixCellIdea[];
  /** One-sentence synthesized stance; null until generated. */
  stance: string | null;
}

export interface SynthesisMatrix {
  authors: SynthesisMatrixAuthor[];
  themes: SynthesisMatrixTheme[];
  /** Sparse — only cells where the author develops at least one idea in the theme. */
  cells: SynthesisMatrixCell[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Study Guide ("Modo Estudio") — a guided layer for mastering a whole corpus:
// author-by-author learning goals, ranked Zotero works, progress tracking and
// optional AI tutor sessions grounded in the existing graph + indexed passages.
// ─────────────────────────────────────────────────────────────────────────────

export type StudyProgressKind = 'author' | 'work' | 'idea' | 'theme';
export type StudyProgressStatus = 'pending' | 'in_progress' | 'understood' | 'needs_full_read' | 'review';

export interface StudyProgressRecord {
  targetKind: StudyProgressKind;
  targetId: string;
  status: StudyProgressStatus;
  note: string | null;
  updatedAt: string;
}

export interface StudyPlanRequest {
  objective?: string;
  sessionMinutes?: number;
  authorLimit?: number;
  worksPerAuthor?: number;
  includeCompleted?: boolean;
  /** User-triggered semantic focus. Uses embeddings when configured; never required. */
  semanticFocus?: boolean;
}

export interface StudyGuideStats {
  totalAuthors: number;
  shownAuthors: number;
  totalWorks: number;
  totalIdeas: number;
  completedAuthors: number;
  reviewAuthors: number;
  fullReadWorks: number;
  zoteroLinkedWorks: number;
}

export interface StudyKeyIdea {
  globalId: string;
  type: IdeaType;
  label: string;
  statement: string;
  workId: string;
  workTitle: string;
}

export interface StudyRecommendedWork {
  nodusId: string;
  title: string;
  authors: string[];
  year: number | null;
  zoteroKey: string | null;
  read: boolean;
  sourceType: SourceType | null;
  deepStatus: DeepStatus;
  summaryStatus: SummaryStatus;
  ideaCount: number;
  principalIdeaCount: number;
  passageCount: number;
  score: number;
  reasons: string[];
  progressStatus: StudyProgressStatus | null;
  summary: string | null;
}

export interface StudyAuthorPlan {
  authorId: string;
  name: string;
  fullName: string;
  rank: number;
  score: number;
  progressStatus: StudyProgressStatus | null;
  progressNote: string | null;
  workCount: number;
  ideaCount: number;
  relationCount: number;
  topThemes: string[];
  coverage: {
    analyzedWorks: number;
    totalWorks: number;
    fullTextWorks: number;
    zoteroLinkedWorks: number;
    readWorks: number;
  };
  recommendedWorks: StudyRecommendedWork[];
  keyIdeas: StudyKeyIdea[];
  learningGoals: string[];
  reviewQuestions: string[];
  reasons: string[];
  nextAction: string;
}

export interface StudyGuidePhase {
  id: 'orientacion' | 'autores' | 'contrastes' | 'lectura_profunda' | 'repaso';
  title: string;
  objective: string;
  authorIds: string[];
}

export interface StudyGuidePlan {
  generatedAt: string;
  objective: string;
  sessionMinutes: number;
  stats: StudyGuideStats;
  summary: string;
  nextAuthorId: string | null;
  authors: StudyAuthorPlan[];
  phases: StudyGuidePhase[];
  coverageWarnings: string[];
  semanticFocusAvailable: boolean;
  semanticFocusUsed: boolean;
  semanticFocusSummary: string | null;
}

export interface StudySessionRequest {
  authorId: string;
  objective?: string;
  sessionMinutes?: number;
  useFullText?: boolean;
  model?: ModelRef | null;
}

export interface StudySessionPassage {
  passageId: string;
  workId: string;
  workTitle: string;
  zoteroKey: string | null;
  pageLabel: string | null;
  snippet: string;
  similarity: number | null;
}

export interface StudySessionStep {
  title: string;
  body: string;
  workIds: string[];
  ideaIds: string[];
  minutes: number;
}

export interface StudyQuizQuestion {
  id: string;
  question: string;
  expected: string;
  ideaIds: string[];
  workIds: string[];
}

export interface StudySession {
  authorId: string;
  authorName: string;
  generatedAt: string;
  model: ModelRef | null;
  usedFullText: boolean;
  guide: string;
  sequence: StudySessionStep[];
  recommendedWorks: StudyRecommendedWork[];
  keyIdeas: StudyKeyIdea[];
  passages: StudySessionPassage[];
  quiz: StudyQuizQuestion[];
  fullReadCandidates: StudyRecommendedWork[];
  nextActions: string[];
}

export interface StudyAnswerRequest {
  authorId: string;
  question: string;
  answer: string;
  objective?: string;
  model?: ModelRef | null;
}

export interface StudyAnswerAssessment {
  verdict: 'solid' | 'partial' | 'weak';
  score: number;
  feedback: string;
  missing: string[];
  nextReview: string[];
  model: ModelRef | null;
  generatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inmersión — a fully guided topic-mastery session. Phase 0 (the scope) is pure
// embeddings + graph, no AI; the generated plan stores every AI answer verbatim
// so a session can be resumed and replayed forever without new AI calls.
// ─────────────────────────────────────────────────────────────────────────────

export interface ImmersionScopeRequest {
  topic: string;
  /** Chosen time budget, so the station estimate matches the depth tier. */
  minutes?: number;
}

/** One idea inside the topic territory, ranked by relevance (no AI involved). */
export interface ImmersionScopeIdea {
  id: string;
  type: IdeaType;
  label: string;
  statement: string;
  score: number;
  themes: string[];
  authors: string[];
  workIds: string[];
}

export interface ImmersionScopeWork {
  nodusId: string;
  title: string;
  authors: string[];
  year: number | null;
  zoteroKey: string | null;
  score: number;
  ideaCount: number;
}

export interface ImmersionScopeAuthor {
  authorId: string | null;
  name: string;
  ideaCount: number;
  workCount: number;
}

/** Phase 0 — the map of what the corpus knows about a topic (embeddings + graph only). */
export interface ImmersionScope {
  topic: string;
  generatedAt: string;
  embeddingAvailable: boolean;
  /** Whether the configured immersion/synthesis model has a usable API key; without it generation would degrade to structural content. */
  aiKeyAvailable: boolean;
  ideas: ImmersionScopeIdea[];
  works: ImmersionScopeWork[];
  authors: ImmersionScopeAuthor[];
  themes: string[];
  debateCount: number;
  gapCount: number;
  passageCount: number;
  /** The topic subgraph (idea nodes + edges among them), ready for the renderer. */
  graph: GraphData;
  estimatedStations: number;
  warnings: string[];
}

export interface ImmersionRequest {
  topic: string;
  language?: 'es' | 'en';
  /** Total time budget for the whole immersion, in minutes. */
  minutes: number;
  /** Whether stations and the final exam carry retrieval questions (always skippable). */
  includeQuiz: boolean;
  model?: ModelRef | null;
  decorativeImage?: DecorativeImageOption;
}

/**
 * A literal quote re-read from the stored full text. `text` always comes from the
 * database, never from the model — the model only picks the passage and explains
 * why it matters.
 */
export interface ImmersionCitation {
  passageId: string;
  workId: string;
  workTitle: string;
  authors: string[];
  year: number | null;
  zoteroKey: string | null;
  pageLabel: string | null;
  text: string;
  whyItMatters: string;
  /** Guided close reading: what to notice in this quote and how it bears on the sub-question. */
  commentary: string;
}

export interface ImmersionAuthorPosition {
  authorId: string | null;
  name: string;
  position: string;
  ideaIds: string[];
}

export interface ImmersionQuizQuestion {
  id: string;
  kind: 'choice' | 'open';
  question: string;
  /** Choice questions: the options shown; empty for open questions. */
  options: string[];
  /** Choice questions: index into `options`; null for open questions. */
  correctIndex: number | null;
  /** Choice questions: shown after answering. */
  explanation: string;
  /** Open questions: what a solid answer must recover. */
  expected: string;
  ideaIds: string[];
}

/**
 * One guided stop of the immersion — a complete mini-lesson: framing context,
 * a long threaded lesson, guided close reading of literal quotes, author
 * positions, takeaways to retain and optional retrieval questions.
 */
export interface ImmersionStation {
  id: string;
  title: string;
  question: string;
  minutes: number;
  /** Why this sub-question matters inside the topic (framing before the lesson). */
  context: string;
  /** The main lesson: markdown with nodus:// citations, validated against the corpus. */
  synthesis: string;
  citations: ImmersionCitation[];
  positions: ImmersionAuthorPosition[];
  /** The sentences the reader must retain from this station. */
  takeaways: string[];
  /** The ideas this station covers; drives the embedded graph excerpt. */
  ideaIds: string[];
  quiz: ImmersionQuizQuestion[];
}

export interface ImmersionKeyTerm {
  term: string;
  definition: string;
}

export interface ImmersionContrastCell {
  author: string;
  authorId: string | null;
  /** One-sentence stance; empty when this author has no known position. */
  stance: string;
  ideaIds: string[];
}

export interface ImmersionContrastRow {
  stationId: string;
  question: string;
  cells: ImmersionContrastCell[];
}

export interface ImmersionContrasts {
  authors: string[];
  rows: ImmersionContrastRow[];
}

export interface ImmersionFrontier {
  kind: 'gap' | 'thin_coverage';
  statement: string;
  detail: string;
  workTitle: string | null;
}

export interface ImmersionExam {
  questions: ImmersionQuizQuestion[];
  /** The "explain it in your own words" closing prompt. */
  feynman: string;
}

/** Compact idea reference stored in the plan so answers can be assessed later without the live graph. */
export interface ImmersionIdeaRef {
  id: string;
  label: string;
  statement: string;
  authors: string[];
  workTitles: string[];
}

export interface ImmersionPlanStats {
  stations: number;
  ideas: number;
  works: number;
  authors: number;
  citations: number;
  quizQuestions: number;
}

export interface ImmersionPlan {
  topic: string;
  title: string;
  language: 'es' | 'en';
  minutes: number;
  generatedAt: string;
  model: ModelRef | null;
  /** Phase 1 panorama: markdown with nodus:// citations. */
  overview: string;
  keyTerms: ImmersionKeyTerm[];
  stations: ImmersionStation[];
  contrasts: ImmersionContrasts;
  frontiers: ImmersionFrontier[];
  exam: ImmersionExam;
  /** The topic subgraph; stations select node subsets from it via ideaIds. */
  graph: GraphData;
  ideaIndex: ImmersionIdeaRef[];
  stats: ImmersionPlanStats;
  /** Non-null when generation degraded somewhere (a model failure fell back to structural content). */
  stoppedReason: string | null;
}

export interface ImmersionAssessment {
  verdict: 'solid' | 'partial' | 'weak';
  score: number;
  feedback: string;
  missing: string[];
}

export interface ImmersionAnswerRecord {
  questionId: string;
  kind: 'choice' | 'open';
  answer: string;
  /** Choice questions: whether the chosen option was right. */
  correct: boolean | null;
  /** Open questions: the AI (or heuristic) assessment. */
  assessment: ImmersionAssessment | null;
  answeredAt: string;
}

export interface ImmersionProgress {
  currentStep: number;
  furthestStep: number;
  completedSteps: number[];
  answers: ImmersionAnswerRecord[];
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ImmersionSession {
  id: string;
  topic: string;
  language: 'es' | 'en';
  minutes: number;
  model: ModelRef | null;
  plan: ImmersionPlan;
  progress: ImmersionProgress;
  image: DecorativeImage | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImmersionSessionSummary {
  id: string;
  topic: string;
  title: string;
  language: 'es' | 'en';
  minutes: number;
  stats: ImmersionPlanStats;
  progressPct: number;
  finished: boolean;
  image: DecorativeImage | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImmersionBuildProgress {
  phase: 'material' | 'curriculum' | 'panorama' | 'station' | 'contrasts' | 'frontiers' | 'exam' | 'assembling' | 'done';
  message: string;
  stationIndex?: number;
  stationTotal?: number;
  stationTitle?: string;
}

export interface ImmersionStreamHandlers {
  onProgress?(progress: ImmersionBuildProgress): void;
}

export interface ImmersionAnswerRequest {
  sessionId: string;
  questionId: string;
  answer: string;
  model?: ModelRef | null;
}

/** The recorded answer (with assessment when open) plus the persisted progress. */
export interface ImmersionAnswerResult {
  record: ImmersionAnswerRecord;
  progress: ImmersionProgress;
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC API surface exposed on window.nodus via the preload bridge.
// ─────────────────────────────────────────────────────────────────────────────

export interface NodusApi {
  // settings + secrets
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  listVaults(): Promise<VaultSummary[]>;
  getActiveVault(): Promise<VaultSummary>;
  createVault(input: CreateVaultInput): Promise<VaultCreateResult>;
  renameVault(id: string, name: string): Promise<VaultSummary>;
  switchVault(id: string, options?: VaultSwitchOptions): Promise<VaultSwitchResult>;
  duplicateVault(id: string, name: string, options?: VaultSwitchOptions): Promise<VaultDuplicateResult>;
  deleteVault(id: string, deleteFiles?: boolean): Promise<void>;
  resetVault(id: string): Promise<VaultSummary>;
  reuseVaultAnalysis(nodusIds: string[]): Promise<VaultAnalysisReuseResult>;
  copyVaultApiKeys(sourceVaultId: string, targetVaultId: string): Promise<{ copiedProviders: AiProvider[] }>;
  getMcpStatus(): Promise<McpServerStatus>;
  regenerateMcpToken(): Promise<string>;
  getCopilotStatus(): Promise<CopilotServerStatus>;
  regenerateCopilotToken(): Promise<string>;
  /** Generate + trust a localhost TLS cert for the copilot server (idempotent). */
  ensureCopilotCert(): Promise<{ ok: boolean; message: string }>;
  /** Copy a port-aware Nodus Copilot manifest into Word's local add-in catalog. */
  installCopilotAddin(): Promise<CopilotInstallResult>;
  /** Fired when the Word add-in asks Nodus to open an idea in the graph. */
  onCopilotOpenIdea(cb: (target: CopilotOpenIdeaTarget) => void): () => void;
  setApiKey(provider: AiProvider, key: string): Promise<void>;
  clearApiKey(provider: AiProvider): Promise<void>;

  // AI model discovery
  listModels(provider: AiProvider): Promise<ModelInfo[]>;
  listEmbeddingModels(provider: EmbeddingProvider): Promise<ModelInfo[]>;
  listImageModels(): Promise<ImageModelInfo[]>;
  /** Ping a local provider (Ollama / LM Studio) to verify its base URL is reachable. */
  testLocalProvider(provider: LocalProvider): Promise<LocalProviderTestResult>;
  getDecorativeImage(entityKind: DecorativeImageEntityKind, entityId: string): Promise<DecorativeImage | null>;
  getDecorativeImageDataUrl(entityKind: DecorativeImageEntityKind, entityId: string, thumbnail?: boolean): Promise<string | null>;
  queueDecorativeImage(request: DecorativeImageActionRequest): Promise<DecorativeImage>;
  /** Store a user-supplied image (already lightly pre-compressed) as the decorative image. */
  uploadDecorativeImage(
    entityKind: DecorativeImageEntityKind,
    entityId: string,
    bytes: Uint8Array,
    style?: DecorativeImageStyle
  ): Promise<DecorativeImage>;
  /** Restore the image that preceded the last regeneration or upload. */
  revertDecorativeImage(entityKind: DecorativeImageEntityKind, entityId: string): Promise<DecorativeImage>;
  deleteDecorativeImage(entityKind: DecorativeImageEntityKind, entityId: string): Promise<DecorativeImage>;
  onDecorativeImageChanged(cb: (image: DecorativeImage) => void): () => void;

  // audio / text-to-speech (synthesis runs in the renderer; main persists WAVs)
  getAudioSegments(entityKind: AudioEntityKind, entityId: string): Promise<AudioSegment[]>;
  listAudioClips(entityKind: AudioEntityKind, entityId: string): Promise<AudioClip[]>;
  clearAudioClips(entityKind: AudioEntityKind, entityId: string): Promise<void>;
  saveAudioClip(
    entityKind: AudioEntityKind,
    entityId: string,
    input: { segmentIndex: number; segmentLabel: string; provider: AudioProvider; voice: string; language: string; bytes: Uint8Array }
  ): Promise<AudioClip>;
  getAudioClipDataUrl(clipId: string): Promise<string | null>;
  deleteAudioClip(clipId: string): Promise<void>;
  deleteEntityAudioClips(entityKind: AudioEntityKind, entityId: string): Promise<void>;
  // AI translations of a report/immersion (source Markdown supplied by the renderer).
  listContentTranslations(
    entityKind: TranslationEntityKind,
    entityId: string
  ): Promise<ContentTranslationSummary[]>;
  getContentTranslation(id: string): Promise<ContentTranslation | null>;
  generateContentTranslation(request: GenerateTranslationRequest): Promise<ContentTranslationSummary>;
  deleteContentTranslation(id: string): Promise<void>;
  // Hume cloud TTS (BYO-key). The key is stored in the main process; the renderer
  // only learns whether one exists, the voice list, and the audio bytes.
  humeStatus(): Promise<{ hasKey: boolean }>;
  humeSetKey(key: string): Promise<{ hasKey: boolean }>;
  humeClearKey(): Promise<{ hasKey: boolean }>;
  humeVoices(language?: string): Promise<HumeVoiceInfo[]>;
  humeSynthesize(voiceId: string, provider: 'HUME_AI' | 'CUSTOM_VOICE', text: string): Promise<Uint8Array>;

  // zotero
  zoteroPing(): Promise<{ ok: boolean; userId?: string; message?: string }>;
  zoteroCollections(): Promise<ZoteroCollection[]>;
  zoteroChildCollections(parentKey: string): Promise<ZoteroCollection[]>;
  zoteroCollectionItems(
    collectionKey: string,
    opts?: { query?: string; recursive?: boolean }
  ): Promise<ZoteroItem[]>;

  // works / library
  listWorks(filter?: WorkFilter): Promise<WorkView[]>;
  listZoteroTags(): Promise<ZoteroTag[]>;
  getWork(nodusId: string): Promise<WorkView | null>;
  ingestZoteroItems(items: ZoteroItem[]): Promise<WorkView[]>;
  setManualDeep(nodusId: string, value: boolean, model?: ModelRef | null): Promise<void>;
  setManualDeepBulk(nodusIds: string[], value: boolean, model?: ModelRef | null): Promise<void>;
  /** Analyse themes (light) and then ideas (deep) for one work, as two queue jobs. */
  analyzeBoth(nodusId: string, model?: ModelRef | null): Promise<void>;
  analyzeBothBulk(nodusIds: string[], model?: ModelRef | null): Promise<void>;
  /** Run the full chain (themes + ideas + summary + index + relationship discovery) for one work. */
  processFull(nodusId: string, model?: ModelRef | null): Promise<void>;
  processFullBulk(nodusIds: string[], model?: ModelRef | null): Promise<void>;
  /** Re-run the cheap theme scan over the whole library to backfill broad parent themes. */
  reassignThemes(model?: ModelRef | null): Promise<number>;
  rescan(nodusId: string, kind: QueueKind, model?: ModelRef | null): Promise<void>;
  /** Re-scan every work that degraded to abstract-only, to pick up full text that
   *  became available since. Idempotent: works whose text is unchanged are no-ops.
   *  Returns the number of works re-enqueued. */
  rescanDegraded(model?: ModelRef | null): Promise<number>;
  summarizeWork(nodusId: string, model?: ModelRef | null): Promise<void>;
  summarizeBulk(nodusIds: string[], model?: ModelRef | null): Promise<void>;
  summarizeAll(model?: ModelRef | null): Promise<void>;
  getWorkSummary(nodusId: string): Promise<WorkSummary | null>;
  /** Zotero collections (with work counts) available as Library filters. */
  listCollectionFacets(): Promise<CollectionFacet[]>;
  /** Groups of works that look like the same work (same DOI, or same title+year+authors). */
  listDuplicateWorks(): Promise<DuplicateWorkGroup[]>;
  /** Merge duplicate works into the chosen canonical, re-pointing all derived data. */
  mergeWorks(canonicalId: string, duplicateIds: string[]): Promise<{ merged: number }>;
  /** Groups of ideas that look like the same idea (identical normalized label + type). */
  listDuplicateIdeas(): Promise<DuplicateIdeaGroup[]>;
  /** Merge duplicate ideas into the chosen canonical, re-pointing all derived data and the graph. */
  mergeIdeas(canonicalId: string, duplicateIds: string[]): Promise<{ merged: number }>;
  /** Snapshot the DB into userData/backups before a destructive maintenance action; returns the path. */
  backupDatabase(): Promise<string>;
  /** Live bibliographic metadata for a work (journal/book, pages, publisher, …). */
  getWorkMeta(nodusId: string): Promise<WorkMeta | null>;
  openInZotero(zoteroKey: string): Promise<void>;
  /** Open a work's PDF in Zotero at the page parsed from an evidence/passage location; falls back to selecting the item. */
  openEvidenceAtPage(nodusId: string, location: string | null): Promise<{ ok: boolean; mode: 'pdf-page' | 'select' | 'none'; page?: number | null }>;
  /** Open an http(s)/mailto link in the user's default browser (used by rendered Markdown). */
  openExternal(url: string): Promise<void>;
  uploadText(nodusId: string, filePath: string): Promise<void>;

  // sync
  syncNow(): Promise<SyncLogEntry>;
  getSyncLog(): Promise<SyncLogEntry[]>;

  // queue
  getQueue(): Promise<QueueProgress>;
  pauseQueue(): Promise<void>;
  resumeQueue(): Promise<void>;
  cancelQueueItem(id: string): Promise<void>;
  removeQueueItem(id: string): Promise<void>;
  moveQueueItemToTop(id: string): Promise<void>;
  clearQueue(): Promise<void>;
  stopQueue(): Promise<void>;
  retryFailed(): Promise<void>;
  /** Enqueue a semantic bridge discovery job into the scan queue. */
  enqueueBridgeDiscovery(model?: ModelRef | null): Promise<void>;
  onQueueProgress(cb: (p: QueueProgress) => void): () => void;

  // graph
  getGraph(lens: 'ideas' | 'authors'): Promise<GraphData>;
  getIdeaDetail(globalId: string): Promise<IdeaDetail | null>;
  getEdgeDetail(edgeId: string): Promise<EdgeDetail | null>;
  /** Every direct idea↔idea edge touching an idea (its connections). */
  getIdeaEdges(globalId: string): Promise<EdgeDetail[]>;
  /** Set (or clear with null) the audit verdict for a relation. */
  setEdgeFeedback(fromId: string, toId: string, type: string, verdict: EdgeFeedbackVerdict | null, note?: string): Promise<void>;
  /** Every audit verdict, newest first, with idea labels. */
  listEdgeFeedback(): Promise<EdgeFeedbackView[]>;
  /** Paginated list of the ideas a work develops. */
  getIdeasByWork(nodusId: string, limit: number, offset: number): Promise<IdeaByWorkPage>;
  /** Cached narrated synthesis for the ideas extracted from one work, if present. */
  getWorkIdeaSynthesis(nodusId: string): Promise<WorkIdeaSynthesis | null>;
  /** Generate a narrated synthesis for the ideas extracted from one work. */
  synthesizeWorkIdeas(nodusId: string, model?: ModelRef | null): Promise<WorkIdeaSynthesis>;
  getThemes(): Promise<Theme[]>;

  // authors (dossier + synthesis matrix)
  /** Lightweight list of every author with their corpus footprint. */
  listAuthors(): Promise<AuthorSummary[]>;
  /** Full study card for one author (ideas, relations, themes, cached synthesis). */
  getAuthorDossier(authorId: string): Promise<AuthorDossier | null>;
  /** Generate (and cache) the AI thesis/remember/positioning for one author. */
  synthesizeAuthor(authorId: string, model?: ModelRef | null): Promise<AuthorDossierSynthesis>;
  /** Authors × themes matrix with idea counts/labels and any cached stances. */
  getSynthesisMatrix(): Promise<SynthesisMatrix>;
  /** Generate (and cache) the one-sentence stance for one author×theme cell. */
  synthesizeMatrixCell(authorId: string, themeId: string, model?: ModelRef | null): Promise<SynthesisMatrixCell>;
  /** Export cached author syntheses (selected or all) to Markdown or PDF. */
  exportAuthorSyntheses(request: AuthorSynthesisExportRequest): Promise<{ path: string } | null>;

  // study guide
  /** Guided corpus mastery plan over authors, ideas and Zotero-linked works. */
  getStudyPlan(request?: StudyPlanRequest): Promise<StudyGuidePlan>;
  /** Persist study progress for an author/work/idea/theme. */
  setStudyProgress(record: {
    targetKind: StudyProgressKind;
    targetId: string;
    status: StudyProgressStatus;
    note?: string | null;
  }): Promise<StudyProgressRecord>;
  /** Optional AI tutor session for one author, grounded in graph data and indexed passages. */
  generateStudySession(request: StudySessionRequest): Promise<StudySession>;

  // inmersión (guided topic mastery)
  buildImmersionScope(request: ImmersionScopeRequest): Promise<ImmersionScope>;
  generateImmersionSession(request: ImmersionRequest, handlers?: ImmersionStreamHandlers): Promise<ImmersionSession>;
  listImmersionSessions(): Promise<ImmersionSessionSummary[]>;
  getImmersionSession(id: string): Promise<ImmersionSession | null>;
  setImmersionProgress(id: string, progress: ImmersionProgress): Promise<void>;
  answerImmersionQuestion(request: ImmersionAnswerRequest): Promise<ImmersionAnswerResult>;
  deleteImmersionSession(id: string): Promise<void>;
  /** Evaluate a learner's answer against the selected author's extracted ideas. */
  evaluateStudyAnswer(request: StudyAnswerRequest): Promise<StudyAnswerAssessment>;

  // main-theme management ("temas principales")
  listManagedThemes(): Promise<ManagedTheme[]>;
  addManualTheme(label: string): Promise<ManagedTheme[]>;
  renameTheme(themeId: string, label: string): Promise<ManagedTheme[]>;
  setThemePinned(themeId: string, pinned: boolean): Promise<ManagedTheme[]>;
  deleteTheme(themeId: string): Promise<ManagedTheme[]>;
  /**
   * Re-group the already-extracted ideas under the curated/existing themes using the
   * model (no document re-reading). Optionally also re-traces idea↔idea relations.
   */
  reprocessThemeConnections(
    options: ReprocessConnectionsOptions,
    model?: ModelRef | null,
    onProgress?: (p: ReprocessProgress) => void
  ): Promise<ReprocessConnectionsResult>;

  // gaps + reading path
  getGaps(): Promise<GapAggregate[]>;
  getGapDetail(gapId: string): Promise<GapDetail | null>;
  getContradictions(): Promise<EdgeDetail[]>;
  getReadingPath(request?: ReadingPathRequest): Promise<ReadingPathPlan>;

  // debates (contradiction face-offs)
  /** Contradicts/refutes edges as two-sided debates with authors, evidence and chronology. */
  getDebates(): Promise<Debate[]>;
  /** Optional, user-triggered streamed AI synthesis of one debate (grounded in its evidence). */
  analyzeDebate(request: DebateAnalysisRequest, handlers: DebateAnalysisStreamHandlers): Promise<DebateAnalysisResponse>;

  // research coverage map (question-driven research)
  listResearchQuestions(): Promise<ResearchQuestion[]>;
  getResearchQuestion(id: string): Promise<ResearchQuestionDetail | null>;
  createResearchQuestion(input: { question: string; notes?: string }): Promise<ResearchQuestionDetail>;
  /** Break the question into sub-questions with the model (replaces existing ones). */
  decomposeResearchQuestion(request: RqDecomposeRequest): Promise<ResearchQuestionDetail>;
  /** Manually edit the sub-questions; coverage is preserved where the text is unchanged. */
  updateResearchSubQuestions(request: RqUpdateSubQuestionsRequest): Promise<ResearchQuestionDetail>;
  /** Map each sub-question against the local corpus (semantic + lexical retrieval + classification). */
  mapResearchCoverage(request: RqMapRequest, handlers?: RqMapHandlers): Promise<ResearchQuestionDetail>;
  deleteResearchQuestion(id: string): Promise<void>;
  exportResearchCoverage(request: RqExportRequest): Promise<{ path: string } | null>;

  // hypothesis lab
  /** Generate evidence-backed, testable hypotheses from gaps, ideas, debates, works and an optional project. */
  generateHypothesisLab(request: HypothesisLabRequest): Promise<HypothesisLabResult>;

  // research assistant
  researchChat(request: ResearchChatRequest): Promise<ResearchChatResponse>;
  researchChatStream(request: ResearchChatRequest, handlers: ResearchChatStreamHandlers): Promise<ResearchChatResponse>;
  /**
   * Abort the research-chat stream currently in flight. The pending
   * {@link researchChatStream} promise then resolves with whatever partial
   * answer had streamed so far (never rejects), so the UI can keep the text.
   */
  cancelResearchChat(): Promise<void>;

  // writing workshop
  getWritingWorkshopSnapshot(brief: WritingWorkshopBrief): Promise<WritingWorkshopSnapshot>;
  generateWritingWorkshopDraft(request: WritingWorkshopDraftRequest): Promise<WritingWorkshopDraft>;
  exportWritingWorkshopDraft(request: WritingWorkshopExportRequest): Promise<{ path: string } | null>;
  listWritingWorkshopDrafts(): Promise<WritingWorkshopSavedDraft[]>;
  saveWritingWorkshopDraft(request: WritingWorkshopSaveDraftRequest): Promise<WritingWorkshopSavedDraft>;
  deleteWritingWorkshopDraft(id: string): Promise<void>;

  // deep research (orchestrated, coverage-guided multi-page report over the whole corpus)
  /** Plan → write section by section (guided by coverage) → assemble a fully cited 5–20 page report. */
  generateDeepResearchReport(request: DeepResearchRequest, handlers?: DeepResearchStreamHandlers): Promise<DeepResearchReport>;

  // tutor mode (AI-guided graph walkthrough)
  /** Analyse the whole idea graph and propose weighted guided routes (overview or prompt-driven). */
  tutorPlan(request: TutorPlanRequest): Promise<TutorPlan>;
  listTutorRoutes(): Promise<TutorSavedRoute[]>;
  /** Save a completed route with the user's required 1–5 rating. */
  saveTutorRoute(plan: TutorPlan, route: TutorRoute, model: ModelRef | null, rating: number): Promise<TutorSavedRoute | null>;
  rateTutorRoute(routeId: string, rating: number | null): Promise<TutorSavedRoute | null>;
  markTutorRoutePlayed(routeId: string): Promise<TutorSavedRoute | null>;
  deleteTutorRoute(routeId: string): Promise<void>;
  /** Narrate one stop of a route, grounded in that node's ideas/evidence. */
  tutorStep(request: TutorStepRequest): Promise<TutorStepResponse>;
  tutorStepStream(request: TutorStepRequest, handlers: TutorStepStreamHandlers): Promise<TutorStepResponse>;

  // argument map (AI-traced hierarchical outline around a seed idea)
  /** Trace a hierarchical block outline of the ideas connected to a seed idea. */
  buildArgumentMap(request: ArgumentMapRequest): Promise<ArgumentMap>;
  /** Rank idea hubs by connectivity for the automatic mode (no AI, no model). */
  discoverArgumentRoutes(): Promise<ArgumentRouteSuggestion[]>;

  // research chat history
  listConversations(includeArchived?: boolean): Promise<ChatConversationSummary[]>;
  getConversation(id: string): Promise<ChatConversation | null>;
  createConversation(input: {
    model?: ModelRef | null;
    selection?: ResearchContextSelection | null;
  }): Promise<ChatConversation>;
  saveConversationMessages(
    id: string,
    messages: ChatMessageRecord[],
    meta?: { model?: ModelRef | null; selection?: ResearchContextSelection | null }
  ): Promise<void>;
  /** Ask the model for a short title from the conversation so far; persists + returns it. */
  generateConversationTitle(id: string, model?: ModelRef | null): Promise<string>;
  renameConversation(id: string, title: string): Promise<void>;
  archiveConversation(id: string, archived: boolean): Promise<void>;
  deleteConversation(id: string): Promise<void>;

  // notes (user-structured folders/subfolders with markdown + captured AI content)
  /** Load every folder and note in one payload; the renderer builds the tree. */
  getNotesTree(): Promise<NotesTree>;
  createNoteFolder(input: CreateNoteFolderInput): Promise<NoteFolder>;
  renameNoteFolder(id: string, name: string): Promise<NoteFolder | null>;
  /** Re-parent a folder (null = root). Cycles are rejected and return the folder unchanged. */
  moveNoteFolder(id: string, parentId: string | null): Promise<NoteFolder | null>;
  /** Delete a folder and, recursively, its subfolders and all their notes. */
  deleteNoteFolder(id: string): Promise<void>;
  createNote(input: CreateNoteInput): Promise<Note>;
  getNote(id: string): Promise<Note | null>;
  updateNote(input: UpdateNoteInput): Promise<Note | null>;
  /** Move a note to another folder (null = unfiled / root). */
  moveNote(id: string, folderId: string | null): Promise<Note | null>;
  deleteNote(id: string): Promise<void>;

  // manual ideas (user-authored, note-owned graph ideas)
  /** Create an empty manual idea plus the note that owns it. */
  createManualIdea(input: { folderId: string | null; title?: string }): Promise<{ note: Note; globalId: string }>;
  /** Replace the structured data (title, summary, works, evidence, connections) of a manual idea. */
  saveManualIdea(payload: ManualIdeaPayload): Promise<void>;
  /** Embed the idea and return semantically related ideas to connect to. */
  autoIndexManualIdea(input: { globalId: string; title: string; summary: string; excludeIds?: string[] }): Promise<AutoIndexResult>;
  /** Keyword search over existing ideas to add a manual connection. */
  searchIdeaCandidates(query: string, excludeIds?: string[], limit?: number): Promise<IdeaCandidate[]>;

  /** Export notes (and their ideas/relations/bibliography) to a structured file. */
  exportNotes(options: NotesExportOptions): Promise<{ path: string } | null>;
  /** Persist an explicit note order (order_idx = position). Used for AI reorder + undo. */
  reorderNotes(noteIds: string[]): Promise<void>;
  /** Ask the AI to order the given notes into a logical sequence; persists and returns it. */
  reorderNotesByAI(noteIds: string[]): Promise<NotesReorderResult>;
  /** Update a folder's summary brief (the ideas it is meant to hold). */
  updateNoteFolderSummary(id: string, summary: string): Promise<NoteFolder | null>;
  /** Match the folder summary against every idea (semantic + connections + AI) and suggest ideas to integrate. */
  suggestFolderIdeas(folderId: string): Promise<FolderIdeaSuggestionsResult>;
  /** Check which inline citations resolve to a real source. Key is `${kind}:${id}`. */
  verifyCitations(refs: CitationRef[]): Promise<Record<string, boolean>>;
  /** Lightweight preview (title + snippet) of a cited source for its hover-card. Null if it no longer resolves. */
  getCitationPreview(ref: CitationRef): Promise<CitationPreview | null>;
  /** Search across ideas, works, gaps, themes, authors and notes. */
  globalSearch(query: string, limitPerKind?: number): Promise<GlobalSearchResult[]>;
  getSearchResultDetail(kind: SearchResultKind, id: string): Promise<SearchResultDetail | null>;
  /** Search by meaning over embedded ideas, passages and works. */
  semanticSearch(query: string, options?: SemanticSearchOptions): Promise<SemanticSearchResponse>;
  /** Find ideas whose meaning is closest to the given idea ("ideas parecidas a esta"). */
  findSimilarToIdea(globalId: string, limit?: number): Promise<SemanticSearchResponse>;
  /** Saved searches (query + mode + kind filters), newest first. */
  listSavedSearches(): Promise<SavedSearch[]>;
  saveSearch(input: SaveSearchInput): Promise<SavedSearch>;
  deleteSavedSearch(id: string): Promise<void>;
  /** Operational health of the corpus for the Home dashboard. */
  getCorpusHealth(): Promise<CorpusHealth>;
  /** Ask the AI for keywords/queries to find literature filling a research gap. */
  suggestGapSearch(statement: string, workTitles: string[]): Promise<GapSearchSuggestions>;

  // projects / manuscripts
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<ProjectDetail | null>;
  createProject(input: CreateProjectInput): Promise<ProjectDetail>;
  updateProject(input: UpdateProjectInput): Promise<Project | null>;
  deleteProject(id: string): Promise<void>;
  updateProjectSection(input: UpdateProjectSectionInput): Promise<ProjectSection | null>;
  addProjectLink(input: AddProjectLinkInput): Promise<ProjectLink>;
  deleteProjectLink(id: string): Promise<void>;
  importProjectChapter(input: ImportProjectChapterInput): Promise<ProjectChapter | null>;
  updateProjectChapter(chapterId: string, markdown: string): Promise<ProjectChapter | null>;
  listProjectChapterSuggestions(chapterId: string): Promise<ProjectInsertionSuggestion[]>;
  generateProjectSuggestions(request: GenerateProjectSuggestionsRequest): Promise<ProjectInsertionSuggestion[]>;
  updateProjectSuggestionStatus(id: string, status: ChapterSuggestionStatus): Promise<ProjectInsertionSuggestion | null>;
  applyProjectSuggestions(request: ApplyProjectSuggestionsRequest): Promise<ProjectChapter | null>;
  listProjectChapterVersions(chapterId: string): Promise<ProjectChapterVersion[]>;
  restoreProjectChapterVersion(versionId: string): Promise<ProjectChapter | null>;
  /** Cached chapter ideas + their typed relations with the library (no AI call). */
  getChapterRelations(chapterId: string): Promise<ChapterRelationsResult>;
  /** Extract chapter ideas, embed them and discover typed relations with the library. */
  analyzeChapterRelations(request: AnalyzeChapterRelationsRequest): Promise<ChapterRelationsResult>;
  onChapterRelationsProgress(cb: (p: ChapterRelationsProgress) => void): () => void;
  /** Check uncited manuscript claims against indexed/listed corpus ideas and passages. */
  verifyManuscriptCitations(request: ManuscriptVerificationRequest): Promise<ManuscriptVerificationResult>;
  /** Insert a chosen citation into the draft at the claim sentence, saving a recoverable version. */
  applyManuscriptCitation(request: ApplyManuscriptCitationRequest): Promise<ApplyManuscriptCitationResult>;
  exportProject(request: ExportProjectRequest): Promise<{ path: string } | null>;
  exportProjectChapter(request: ExportProjectChapterRequest): Promise<{ path: string } | null>;

  // export / import
  exportData(): Promise<{ path: string; password: string } | null>;
  importData(password: string): Promise<{ ok: boolean; message: string }>;
  /** Export the user layer (notes, drafts, saved searches, edge verdicts) as a portable sync package. */
  exportSyncPackage(): Promise<{ path: string; counts: Record<string, number> } | null>;
  /** Merge a sync package from another machine. Additive; newest row wins; never deletes local data. */
  importSyncPackage(): Promise<SyncMergeSummary | null>;
  /** Set (≥8 chars) the master password that encrypts every automatic backup. Stored in the OS keychain. */
  setBackupPassword(password: string): Promise<void>;
  clearBackupPassword(): Promise<void>;
  hasBackupPassword(): Promise<boolean>;
  /** Folder picker for the automatic-backup destination. Returns the chosen path or null. */
  chooseBackupFolder(): Promise<string | null>;
  /** Run one automatic-style backup immediately (no secrets, master password, prune). */
  runBackupNow(): Promise<AutoBackupResult>;
  /** Write a plaintext recovery kit (master password) to a user-chosen file. */
  saveBackupRecoveryKit(): Promise<{ ok: boolean; message: string }>;
  /** Wipe all derived graph data (ideas, themes, edges, authors, gaps) and reset scan
   *  status on every work. The library and settings are kept. */
  resetGraph(): Promise<void>;

  // demo mode
  /** Whether the database holds any user content (works, notes or ideas). */
  hasAnyData(): Promise<boolean>;
  /** Seed the curated demo corpus. Returns false (no-op) if data already exists. */
  seedDemoData(): Promise<boolean>;
  /** Remove every demo row and leave demo mode. */
  clearDemoData(): Promise<void>;

  // embedding pipeline
  /** Start embedding generation for the given works (or all non-archived works if empty). */
  startEmbedding(nodusIds?: string[]): Promise<void>;
  /** Clear all existing embeddings and regenerate from scratch. */
  reindexAll(): Promise<void>;
  pauseEmbedding(): Promise<void>;
  resumeEmbedding(): Promise<void>;
  stopEmbedding(): Promise<void>;
  /** Hide a completed/stopped embedding queue without deleting generated embeddings. */
  clearEmbeddingProgress(): Promise<void>;
  getEmbeddingStatus(): Promise<EmbeddingPipelineProgress>;
  /** Per-work embedding counts for the library table. */
  getWorkEmbeddingStatuses(nodusIds?: string[]): Promise<WorkEmbeddingStatus[]>;
  onEmbeddingProgress(cb: (p: EmbeddingPipelineProgress) => void): () => void;

  // full-text passage index
  /** Index full-text passages for the chosen works; analysis in the idea graph is not required. */
  startPassageEmbedding(nodusIds?: string[]): Promise<void>;
  pausePassageEmbedding(): Promise<void>;
  resumePassageEmbedding(): Promise<void>;
  stopPassageEmbedding(): Promise<void>;
  clearPassageProgress(): Promise<void>;
  getPassageStatus(): Promise<PassageEmbeddingProgress>;
  getWorkPassageStatuses(nodusIds?: string[]): Promise<WorkPassageStatus[]>;
  onPassageProgress(cb: (p: PassageEmbeddingProgress) => void): () => void;
  getPassage(passageId: string): Promise<PassageDetail | null>;

  // semantic bridge discovery
  discoverSemanticBridges(model?: ModelRef | null): Promise<SemanticBridgeResult>;
  isSemanticBridgeRunning(): Promise<boolean>;
  onSemanticBridgeProgress(cb: (p: SemanticBridgeProgress) => void): () => void;

  // app updates
  checkForUpdates(): Promise<UpdateCheckResponse>;
  installUpdate(): Promise<UpdateCheckResponse>;
  onUpdateProgress(cb: (event: UpdateProgressEvent) => void): () => void;
}

export interface WorkFilter {
  search?: string;
  lightStatus?: LightStatus | 'all';
  deepStatus?: DeepStatus | 'all';
  summaryStatus?: SummaryStatus | 'all';
  /** Presence conditions that must all be satisfied (AND). `!` prefix = NOT. */
  statusFlags?: Array<'deep' | 'summary' | 'ideas' | 'passages' | '!deep' | '!summary' | '!ideas' | '!passages'>;
  /** Restrict to a corpus-health bucket (works without text, light-only, etc.). */
  healthBucket?: CorpusHealthBucketId;
  theme?: string;
  /** Zotero tags to match. Multiple tags can use any-match (default) or all-match. */
  zoteroTags?: string[];
  zoteroTagMode?: 'any' | 'all';
  /** Zotero collection keys to match (selecting a parent includes its subcollections). */
  collections?: string[];
  collectionMode?: 'any' | 'all';
  yearMin?: number;
  yearMax?: number;
  includeArchived?: boolean;
}

/** A Zotero collection available as a Library filter, flattened with its depth. */
export interface CollectionFacet {
  key: string;
  name: string;
  parentKey: string | null;
  /** Indentation level in the flattened tree (0 = top-level). */
  depth: number;
  /** Works in this collection and its subcollections. */
  workCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Embedding pipeline
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbeddingPipelineProgress {
  running: boolean;
  paused: boolean;
  /** Index of the work currently being processed (0-based). */
  currentWorkIndex: number;
  /** Total works queued for embedding. */
  totalWorks: number;
  /** Title of the work currently being processed. */
  currentWorkTitle: string | null;
  /** Number of ideas embedded so far across all works. */
  ideasEmbedded: number;
  /** Total ideas to embed across all works. */
  totalIdeas: number;
  /** Index of the idea being processed within the current work (0-based). */
  currentIdeaIndex: number;
  /** Total ideas in the current work. */
  currentWorkIdeas: number;
  /** Error message if the pipeline stopped on error. */
  error: string | null;
}

/** Per-work embedding status for display in the library table. */
export interface WorkEmbeddingStatus {
  nodus_id: string;
  totalIdeas: number;
  embeddedIdeas: number;
  /** true if all ideas have embeddings. */
  complete: boolean;
}

/** Progress state for the manual full-text passage indexing pipeline. */
export interface PassageEmbeddingProgress {
  running: boolean;
  paused: boolean;
  currentWorkIndex: number;
  totalWorks: number;
  currentWorkTitle: string | null;
  passagesEmbedded: number;
  totalPassages: number;
  currentPassageIndex: number;
  currentWorkPassages: number;
  error: string | null;
}

export interface WorkPassageStatus {
  nodus_id: string;
  totalPassages: number;
  status: 'complete' | 'outdated' | 'missing';
}

export interface PassageDetail {
  passage_id: string;
  nodus_id: string;
  text: string;
  page_label: string | null;
  chunk_index: number;
  work: {
    title: string;
    authors: string[];
    year: number | null;
    zotero_key: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic bridge discovery
// ─────────────────────────────────────────────────────────────────────────────

export interface SemanticBridgeProgress {
  phase: 'scan' | 'validation' | 'done';
  label: string;
  current: number;
  total: number;
  candidatesFound: number;
  bridgesAdded: number;
}

export interface SemanticBridgeResult {
  candidatesScanned: number;
  crossThemeCandidates: number;
  validated: number;
  added: number;
}
