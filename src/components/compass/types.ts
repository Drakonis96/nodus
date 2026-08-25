import type { CompassApi } from '@shared/api/compass';
import type {
  CompassFilters, CompassImportProgress, CompassProviderId, CompassProviderStatus,
  CompassResultSummary, CompassSearchProgress, CompassSearchRequest, CompassSearchResponse, CompassSearchSession,
  CompassSnapshot,
} from '@shared/compass';

export type {
  CompassFilters, CompassImportProgress, CompassProviderId, CompassProviderStatus,
  CompassSearchProgress, CompassSearchRequest, CompassSearchResponse,
  CompassSearchSession, CompassSnapshot,
} from '@shared/compass';
export type { CompassApi, CompassApi as CompassWindowApi } from '@shared/api/compass';

/** The renderer consumes only normalized summaries returned by IPC. */
export function getCompassApi(): CompassApi {
  return window.nodus;
}

export const EMPTY_COMPASS_FILTERS: CompassFilters = {};
export const EMPTY_COMPASS_SNAPSHOT: CompassSnapshot = {
  searchId: null, query: '', filters: {}, providerCursors: {}, selectedCanonicalKeys: [], scrollAnchor: undefined,
};

export const COMPASS_PROVIDERS: Array<{ id: CompassProviderId; label: string }> = [
  { id: 'openalex', label: 'OpenAlex' }, { id: 'crossref', label: 'Crossref' },
  { id: 'openaire', label: 'OpenAIRE' }, { id: 'hal', label: 'HAL' },
  { id: 'semanticscholar', label: 'Semantic Scholar' }, { id: 'doab', label: 'DOAB' },
  { id: 'oapen', label: 'OAPEN' }, { id: 'dialnet', label: 'Dialnet' },
  { id: 'openedition', label: 'OpenEdition' }, { id: 'scielo', label: 'SciELO' },
  { id: 'unpaywall', label: 'Unpaywall' }, { id: 'opencitations', label: 'OpenCitations' },
];

export type CompassResult = CompassResultSummary;
export type CompassProgressEvent = CompassSearchProgress;
export type CompassSession = CompassSearchSession;
export type CompassResponse = CompassSearchResponse;
export type CompassImportEvent = CompassImportProgress;
