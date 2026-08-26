import type { CompassImportProgress, CompassImportRequest, CompassImportJob, CompassProviderDescriptor, CompassProviderId, CompassProviderStatus, CompassRangeSelectionRequest, CompassResult, CompassSearchProgress, CompassSearchRequest, CompassSearchResponse, CompassSearchSession, CompassResultSummary, CompassViewRequest } from '../compass';

export interface CompassApi {
  startCompassSearch(request: CompassSearchRequest): Promise<CompassSearchResponse>;
  loadMoreCompass(searchId: string, requestId: string, generation: number, offset?: number): Promise<CompassSearchResponse>;
  cancelCompassSearch(searchId?: string, requestId?: string): Promise<void>;
  getCompassSearch(searchId: string): Promise<CompassSearchResponse | null>;
  getCompassResultDetail(searchId: string, canonicalKey: string): Promise<CompassResult | null>;
  updateCompassView(request: CompassViewRequest): Promise<CompassSearchResponse>;
  retryCompassProvider(searchId: string, provider: CompassProviderId): Promise<CompassSearchResponse>;
  retryCompassSearch(searchId: string): Promise<CompassSearchResponse>;
  listCompassResults(searchId: string, offset?: number, limit?: number): Promise<CompassResultSummary[]>;
  listCompassHistory(limit?: number): Promise<CompassSearchSession[]>;
  deleteCompassHistory(searchId: string): Promise<void>;
  clearCompassHistory(): Promise<void>;
  saveCompassCandidate(searchId: string, canonicalKey: string): Promise<void>;
  listCompassSavedCandidates(limit?: number): Promise<CompassResultSummary[]>;
  dismissCompassCandidate(searchId: string, canonicalKey: string): Promise<void>;
  restoreCompassCandidate(searchId: string, canonicalKey: string): Promise<void>;
  setCompassSelection(searchId: string, canonicalKeys: string[], revision: number): Promise<void>;
  selectCompassRange(request: CompassRangeSelectionRequest): Promise<string[]>;
  getCompassSelection(searchId: string): Promise<string[]>;
  startCompassImport(request: CompassImportRequest): Promise<CompassImportJob>;
  getCompassImport(jobId: string): Promise<CompassImportProgress | null>;
  cancelCompassImport(jobId: string): Promise<void>;
  retryCompassImport(jobId: string): Promise<CompassImportJob>;
  listCompassProviderStatus(): Promise<CompassProviderStatus[]>;
  listCompassProviders(): Promise<CompassProviderDescriptor[]>;
  onCompassSearchProgress(callback: (progress: CompassSearchProgress) => void): () => void;
  onCompassImportProgress(callback: (progress: CompassImportProgress) => void): () => void;
}
