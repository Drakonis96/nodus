import type {
  CompassFilters, CompassImportProgress, CompassImportRequest, CompassImportJob,
  CompassProviderId, CompassProviderStatus, CompassSearchProgress, CompassSearchRequest, CompassSearchResponse,
  CompassSearchSession, CompassResultSummary,
} from '../compass';

export interface CompassApi {
  startCompassSearch(request: CompassSearchRequest): Promise<CompassSearchResponse>;
  loadMoreCompass(searchId: string, requestId: string, generation: number, offset?: number): Promise<CompassSearchResponse>;
  cancelCompassSearch(searchId?: string, requestId?: string): Promise<void>;
  getCompassSearch(searchId: string): Promise<CompassSearchResponse | null>;
  listCompassResults(searchId: string, offset?: number, limit?: number): Promise<CompassResultSummary[]>;
  listCompassHistory(limit?: number): Promise<CompassSearchSession[]>;
  deleteCompassHistory(searchId: string): Promise<void>;
  clearCompassHistory(): Promise<void>;
  saveCompassCandidate(searchId: string, canonicalKey: string): Promise<void>;
  listCompassSavedCandidates(limit?: number): Promise<CompassResultSummary[]>;
  dismissCompassCandidate(searchId: string, canonicalKey: string): Promise<void>;
  restoreCompassCandidate(searchId: string, canonicalKey: string): Promise<void>;
  setCompassSelection(searchId: string, canonicalKeys: string[], revision: number): Promise<void>;
  getCompassSelection(searchId: string): Promise<string[]>;
  startCompassImport(request: CompassImportRequest): Promise<CompassImportJob>;
  getCompassImport(jobId: string): Promise<CompassImportProgress | null>;
  cancelCompassImport(jobId: string): Promise<void>;
  retryCompassImport(jobId: string): Promise<CompassImportJob>;
  listCompassProviderStatus(): Promise<CompassProviderStatus[]>;
  setCompassProviderKey(provider: CompassProviderId, key: string): Promise<void>;
  clearCompassProviderKey(provider: CompassProviderId): Promise<void>;
  onCompassSearchProgress(callback: (progress: CompassSearchProgress) => void): () => void;
  onCompassImportProgress(callback: (progress: CompassImportProgress) => void): () => void;
}
