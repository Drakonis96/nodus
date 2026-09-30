import type { CompleteGuideItem } from '@shared/completeGuide/items';
import { completeGuideLabels } from '@shared/completeGuide/labels';
import { locatorLabel } from '@shared/completeGuide/locators';
import type { CompleteGuideLocator, CompleteGuideSnapshotSource } from '@shared/completeGuide/snapshot';
import type { CompleteGuideEvidenceView } from '@shared/completeGuide/types';
import type { PromptLanguage } from '@shared/types';
import { getCompleteGuideArtifacts } from '../../db/completeGuideRepo';

interface StoredArtifacts {
  items: CompleteGuideItem[];
  sources: CompleteGuideSnapshotSource[];
  passages: Array<{ id: string; sourceKey: string; locator: CompleteGuideLocator }>;
}

/** The exact quotes behind one citation of a saved guide (local sidecar only). */
export function getCompleteGuideEvidence(draftId: string, itemId: string, language: PromptLanguage = 'es'): CompleteGuideEvidenceView | null {
  const artifacts = getCompleteGuideArtifacts<StoredArtifacts>(draftId);
  const item = artifacts?.items.find((entry) => entry.id === itemId);
  if (!artifacts || !item) return null;
  const labels = completeGuideLabels(language);
  const sources = new Map(artifacts.sources.map((source) => [source.sourceKey, source]));
  const passages = new Map(artifacts.passages.map((passage) => [passage.id, passage]));
  return {
    itemId: item.id,
    title: item.title,
    statement: item.statement,
    evidence: item.evidence.map((evidence) => {
      const source = sources.get(evidence.sourceKey);
      const passage = passages.get(evidence.passageId);
      return {
        alias: source?.alias ?? '',
        sourceTitle: source?.title ?? evidence.sourceKey,
        location: passage ? locatorLabel(passage.locator, labels) : '',
        quote: evidence.quote,
        anchor: evidence.anchor,
      };
    }),
  };
}
