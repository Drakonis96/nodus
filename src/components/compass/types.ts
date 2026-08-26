import type { CompassApi } from '@shared/api/compass';
import type {
  CompassFilters, CompassImportProgress, CompassProviderId,
  CompassResultSummary, CompassSearchProgress, CompassSearchResponse, CompassSearchSession,
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
  searchId: null, draft: '', lane: 'scholarly', filters: {}, sort: 'relevance', scrollAnchors: {},
};

export const COMPASS_PROVIDERS: Array<{ id: CompassProviderId; label: string }> = [
  { id: 'openalex', label: 'OpenAlex' }, { id: 'core', label: 'CORE' }, { id: 'doaj', label: 'DOAJ' }, { id: 'openaire', label: 'OpenAIRE' },
  { id: 'openlibrary', label: 'Open Library' }, { id: 'doab', label: 'DOAB' }, { id: 'oapen', label: 'OAPEN' }, { id: 'bnf', label: 'BnF' },
  { id: 'hal', label: 'HAL' }, { id: 'datacite', label: 'DataCite' }, { id: 'zenodo', label: 'Zenodo' }, { id: 'europepmc', label: 'Europe PMC' },
  { id: 'arxiv', label: 'arXiv' }, { id: 'dblp', label: 'DBLP' }, { id: 'semanticscholar', label: 'Semantic Scholar' },
  { id: 'internetarchive', label: 'Internet Archive' }, { id: 'loc', label: 'Library of Congress' }, { id: 'gallica', label: 'Gallica' },
  { id: 'crossref', label: 'Crossref' }, { id: 'opencitations', label: 'OpenCitations' },
];

export type CompassResult = CompassResultSummary;
export type CompassProgressEvent = CompassSearchProgress;
export type CompassSession = CompassSearchSession;
export type CompassResponse = CompassSearchResponse;
export type CompassImportEvent = CompassImportProgress;
