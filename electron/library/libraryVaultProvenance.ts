import type { LibraryAnalysisReuseComponent, LibraryItemRecord } from '@shared/libraryTypes';
import { getSettings } from '../db/settingsRepo';
import {
  ANALYSIS_PIPELINES,
  analysisFingerprint,
  analysisModelFingerprint,
  upsertLibraryAnalysisProvenance,
} from '../db/libraryAnalysisProvenance';
import { getActiveVault } from '../vaults/vaultRegistry';
import { LibraryCatalog } from './libraryCatalog';
import { configuredLibraryRoot, libraryDeviceId, localLibraryDatabasePath } from './libraryPaths';
import { LibraryDiskStore } from './libraryStorage';

export function libraryRevisionFingerprint(
  item: LibraryItemRecord,
  component: LibraryAnalysisReuseComponent,
): string | null {
  const revision = item.contentRevision;
  if (!revision) return null;
  if (component === 'light') return revision.bibliographicFingerprint;
  if (component === 'summary') return analysisFingerprint({
    bibliographic: revision.bibliographicFingerprint,
    content: revision.contentFingerprint,
  });
  return revision.contentFingerprint;
}

/** Record provenance without importing the full Library service. Analysis workers
 * must stay loadable in the CommonJS recovery harness, and the service owns the
 * extraction engine which intentionally uses native ESM package resolution. */
export function recordLinkedLibraryAnalysis(input: {
  workId: string;
  components: LibraryAnalysisReuseComponent[];
  documentFingerprint: string;
  outputFingerprint?: string;
}): void {
  const root = configuredLibraryRoot();
  if (!root) return;
  const vault = getActiveVault();
  const store = new LibraryDiskStore(root, libraryDeviceId());
  store.initialize();
  const catalog = new LibraryCatalog(localLibraryDatabasePath());
  try {
    const link = catalog.listVaultLinks().find((entry) => entry.vaultId === vault.id && entry.workId === input.workId);
    if (!link) return;
    const item = store.findItemByIdOrAlias(link.itemId);
    if (!item || item.deletedAt) return;
    const settings = getSettings();
    const now = new Date().toISOString();
    const reusableComponents: LibraryAnalysisReuseComponent[] = ['light', 'deep', 'summary', 'ideas', 'passages', 'embeddings'];
    const reuse = Object.fromEntries(reusableComponents.map((component) => [component, link.analysis.reuse?.[component] ?? {
      state: 'pending', reason: `No reusable ${component} output with complete provenance.`,
      sourceVaultId: null, sourceWorkId: null, reusedAt: null,
    }])) as NonNullable<typeof link.analysis.reuse>;
    for (const component of input.components) {
      const revision = libraryRevisionFingerprint(item, component);
      if (!revision) continue;
      upsertLibraryAnalysisProvenance({
        workId: input.workId,
        component,
        documentFingerprint: input.documentFingerprint,
        libraryItemId: item.id,
        libraryRevisionFingerprint: revision,
        pipelineVersion: ANALYSIS_PIPELINES[component],
        modelFingerprint: analysisModelFingerprint(component, settings),
        outputFingerprint: input.outputFingerprint ?? input.documentFingerprint,
        sourceVaultId: vault.id,
        sourceWorkId: input.workId,
        updatedAt: now,
      });
      reuse[component] = {
        state: 'current', reason: `Current ${component} output has complete provenance.`,
        sourceVaultId: vault.id, sourceWorkId: input.workId, reusedAt: null,
      };
    }
    catalog.upsertVaultLinks([{ ...link, analysis: { ...link.analysis, reuse } }]);
  } finally {
    catalog.close();
  }
}
