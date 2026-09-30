import type { ModelRef } from '../types';
import type { ResearchEffort } from '../researchReasoning';
import type { CompleteGuideEstimate } from './estimate';
import type { CompleteGuideSnapshot } from './snapshot';
import type { StudySourceOrganization } from '../studySourceTree';
import type { CompleteGuideCatalogSource, CompleteGuideResolvedSelection, CompleteGuideSourceKind } from './types';

export interface CompleteGuideCatalog {
  sources: CompleteGuideCatalogSource[];
  organization: StudySourceOrganization;
}

/** Composer → main: what would a guide over this selection read, and at what cost? */
export interface CompleteGuidePreviewRequest {
  completeGuide: unknown;
  model?: ModelRef | null;
  thinkingEffort?: ResearchEffort | null;
}

export interface CompleteGuidePreview {
  sources: Array<{ sourceKey: string; kind: CompleteGuideSourceKind; title: string; alias: string; path: string; chars: number; pages: number | null; passages: number }>;
  unavailable: CompleteGuideResolvedSelection['unavailable'];
  superseded: CompleteGuideResolvedSelection['superseded'];
  issues: CompleteGuideSnapshot['issues'];
  totals: CompleteGuideSnapshot['totals'];
  subjects: number;
  units: number;
  estimate: CompleteGuideEstimate;
}
