import type { CompassLane, CompassProviderDescriptor, CompassProviderId, CompassPublicationType } from '@shared/compass';

const scholarly: CompassPublicationType[] = ['article', 'book', 'chapter', 'thesis', 'report', 'dataset', 'preprint', 'other'];
const primary: CompassPublicationType[] = ['photograph', 'newspaper', 'map', 'manuscript', 'audio', 'video', 'archive-item', 'book', 'other'];
const descriptor = (id: CompassProviderId, label: string, attribution: string, lanes: CompassLane[], types: CompassPublicationType[], metadataLicense?: string, semantic = false): CompassProviderDescriptor => ({ id, label, attribution, metadataLicense, capabilities: { lanes, types, supportsSemantic: semantic, supportsCursor: true, supportsOpenAccessFilter: lanes.includes('scholarly'), anonymous: true } });

export const COMPASS_PROVIDER_CATALOG: Readonly<Record<string, CompassProviderDescriptor>> = Object.freeze({
  openalex: descriptor('openalex', 'OpenAlex', 'OpenAlex', ['scholarly'], scholarly, 'CC BY 4.0', true),
  core: descriptor('core', 'CORE', 'CORE', ['scholarly'], scholarly), doaj: descriptor('doaj', 'DOAJ', 'Directory of Open Access Journals', ['scholarly'], ['article'], 'CC0'),
  openaire: descriptor('openaire', 'OpenAIRE', 'OpenAIRE', ['scholarly'], scholarly, 'CC BY'),
  openlibrary: descriptor('openlibrary', 'Open Library', 'Open Library', ['scholarly'], ['book'], 'CC0'), doab: descriptor('doab', 'DOAB', 'Directory of Open Access Books', ['scholarly'], ['book', 'chapter'], 'CC0'),
  oapen: descriptor('oapen', 'OAPEN', 'OAPEN Library', ['scholarly'], ['book', 'chapter'], 'CC0'), bnf: descriptor('bnf', 'BnF Catalogue', 'Bibliothèque nationale de France', ['scholarly'], ['book', 'chapter', 'thesis', 'other']),
  hal: descriptor('hal', 'HAL', 'HAL Open Science', ['scholarly'], scholarly), datacite: descriptor('datacite', 'DataCite', 'DataCite', ['scholarly'], scholarly, 'CC0'), zenodo: descriptor('zenodo', 'Zenodo', 'Zenodo', ['scholarly'], scholarly),
  europepmc: descriptor('europepmc', 'Europe PMC', 'Europe PMC', ['scholarly'], ['article', 'preprint'], 'CC0'), arxiv: descriptor('arxiv', 'arXiv', 'arXiv', ['scholarly'], ['article', 'preprint']),
  dblp: descriptor('dblp', 'DBLP', 'DBLP computer science bibliography', ['scholarly'], ['article', 'book', 'other']), semanticscholar: descriptor('semanticscholar', 'Semantic Scholar', 'Semantic Scholar', ['scholarly'], scholarly, undefined, true),
  internetarchive: descriptor('internetarchive', 'Internet Archive', 'Internet Archive', ['primary'], primary), loc: descriptor('loc', 'Library of Congress', 'Library of Congress', ['primary'], primary), gallica: descriptor('gallica', 'Gallica', 'Gallica / BnF', ['primary'], primary),
  crossref: descriptor('crossref', 'Crossref', 'Crossref', ['scholarly'], scholarly, 'CC0'), opencitations: descriptor('opencitations', 'OpenCitations', 'OpenCitations', ['scholarly'], ['article', 'book', 'chapter'], 'CC BY 4.0'),
});

export function providerDescriptor(id: CompassProviderId): CompassProviderDescriptor { const found = COMPASS_PROVIDER_CATALOG[id]; if (!found) throw new Error(`Compass provider ${id} is not active.`); return found; }
export function listProviderDescriptors(): CompassProviderDescriptor[] { return Object.values(COMPASS_PROVIDER_CATALOG); }
