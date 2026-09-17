// The processing-log slice of the window.nodus contract: extraction, OCR, indexing,
// embeddings and the provider/JSON/connection failures around them.
//
// The log is local diagnostics rather than vault content — one global file, never backed
// up nor synced — so this slice is deliberately small: read a filtered page, delete what a
// filter selects, and hand the main process the finished text to save. The text is built by
// the renderer because only there do the translation tables exist and only there is the
// reader's chosen log language known.
import type {
  PipelineLogEntry,
  PipelineLogFacets,
  PipelineLogFilter,
  PipelineLogQuery,
  PipelineLogRetention,
} from '../pipelineLogs';

export interface PipelineLogStats {
  entries: number;
  oldestAt: string | null;
  newestAt: string | null;
  bytes: number;
}

export interface PipelineLogPage {
  entries: PipelineLogEntry[];
  /** Entries matching the filter, not the page. */
  total: number;
  /** Counts over the whole store, so a filter never changes the numbers beside it. */
  facets: PipelineLogFacets;
  revision: number;
  stats: PipelineLogStats;
  /** The policy in force, echoed so the modal can render it without a second round trip. */
  retention: PipelineLogRetention;
  maxEntries: number;
}

export interface PipelineLogChange {
  revision: number;
  total: number;
}

export interface LogsApi {
  /**
   * A filtered, ordered page of the processing log. Lines are stored as a catalogue id
   * plus values, so `search` matches the language-neutral fields only (codes, model,
   * provider, ids, document title and the provider's own message); everything else is
   * reached through the filters.
   */
  getPipelineLogs(query?: PipelineLogQuery): Promise<PipelineLogPage>;
  /** Delete every entry the filter selects. An empty filter deletes the whole log. */
  deletePipelineLogs(filter?: PipelineLogFilter): Promise<{ removed: number; total: number }>;
  clearPipelineLogs(): Promise<{ removed: number; total: number }>;
  /**
   * Save the text the renderer formatted, through the native save dialog. `defaultName` is
   * used verbatim, so the caller owns the file name (including its extension).
   */
  exportPipelineLogs(text: string, defaultName?: string): Promise<{ canceled: boolean; path?: string }>;
  /** Fires whenever the store changed: grouped repeats, pruning and deletions included. */
  onPipelineLogsChanged(cb: (change: PipelineLogChange) => void): () => void;
}
