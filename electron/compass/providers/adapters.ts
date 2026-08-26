import type { CompassProviderAdapter, CompassProviderId } from '@shared/compass';
import { bookAdapters } from './books';
import { disciplineAdapters } from './disciplines';
import { enrichmentAdapters } from './enrichment';
import { generalAdapters } from './general';
import { heritageAdapters } from './heritage';
import { repositoryAdapters } from './repositories';

/** All active adapters are anonymous public services. No credential/configuration
 * object is accepted by design. */
export function createCompassAdapters(): Map<CompassProviderId, CompassProviderAdapter> {
  return new Map([...generalAdapters(), ...bookAdapters(), ...repositoryAdapters(), ...disciplineAdapters(), ...heritageAdapters(), ...enrichmentAdapters()]);
}
