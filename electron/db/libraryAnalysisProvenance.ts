import { createHash } from 'node:crypto';
import type { LibraryAnalysisReuseComponent } from '@shared/libraryTypes';
import type { AppSettings, ModelRef } from '@shared/types';
import { getDb } from './database';

export const ANALYSIS_PIPELINES: Record<LibraryAnalysisReuseComponent, string> = {
  light: 'nodus-light-scan/2',
  deep: 'nodus-deep-scan/2',
  summary: 'nodus-summary/2',
  ideas: 'nodus-deep-scan/2',
  passages: 'nodus-passage-index/2',
  embeddings: 'nodus-embeddings/2',
};

export interface LibraryAnalysisProvenanceRecord {
  workId: string;
  component: LibraryAnalysisReuseComponent;
  documentFingerprint: string;
  libraryItemId: string | null;
  libraryRevisionFingerprint: string | null;
  pipelineVersion: string;
  modelFingerprint: string;
  outputFingerprint: string;
  sourceVaultId: string | null;
  sourceWorkId: string | null;
  updatedAt: string;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function analysisFingerprint(value: unknown): string {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function model(model: ModelRef | null | undefined): Record<string, string | null> | null {
  return model ? {
    provider: model.provider,
    model: model.model,
    reasoningEffort: model.reasoningEffort ?? null,
  } : null;
}

/** The exact configuration gate used both when an analysis is produced and when
 * another vault considers copying it. Prompt changes advance the pipeline ID. */
export function analysisModelFingerprint(component: LibraryAnalysisReuseComponent, settings: AppSettings): string {
  if (component === 'light') return analysisFingerprint({ model: model(settings.extractionModel ?? settings.synthesisModel) });
  if (component === 'deep' || component === 'ideas') return analysisFingerprint({
    extraction: model(settings.extractionModel ?? settings.synthesisModel),
    fusion: model(settings.fusionModel ?? settings.synthesisModel),
    contextMode: settings.deepContextMode,
    standardChunkWords: settings.deepStandardChunkWords,
    longChunkWords: settings.deepLongChunkWords,
  });
  if (component === 'summary') return analysisFingerprint({ model: model(settings.summaryModel ?? settings.synthesisModel) });
  return analysisFingerprint({ provider: settings.embeddingProvider, model: settings.embeddingModel });
}

export function upsertLibraryAnalysisProvenance(record: LibraryAnalysisProvenanceRecord): void {
  getDb().prepare(`
    INSERT INTO library_analysis_provenance (
      work_id, component, document_fingerprint, library_item_id, library_revision_fingerprint,
      pipeline_version, model_fingerprint, output_fingerprint, source_vault_id, source_work_id, updated_at
    ) VALUES (@workId, @component, @documentFingerprint, @libraryItemId, @libraryRevisionFingerprint,
              @pipelineVersion, @modelFingerprint, @outputFingerprint, @sourceVaultId, @sourceWorkId, @updatedAt)
    ON CONFLICT(work_id, component) DO UPDATE SET
      document_fingerprint=excluded.document_fingerprint,
      library_item_id=excluded.library_item_id,
      library_revision_fingerprint=excluded.library_revision_fingerprint,
      pipeline_version=excluded.pipeline_version,
      model_fingerprint=excluded.model_fingerprint,
      output_fingerprint=excluded.output_fingerprint,
      source_vault_id=excluded.source_vault_id,
      source_work_id=excluded.source_work_id,
      updated_at=excluded.updated_at
  `).run(record);
}

export function listLibraryAnalysisProvenance(workId: string): LibraryAnalysisProvenanceRecord[] {
  const rows = getDb().prepare('SELECT * FROM library_analysis_provenance WHERE work_id=? ORDER BY component').all(workId) as Record<string, unknown>[];
  return rows.map((row) => ({
    workId: String(row.work_id), component: row.component as LibraryAnalysisReuseComponent,
    documentFingerprint: String(row.document_fingerprint), libraryItemId: row.library_item_id ? String(row.library_item_id) : null,
    libraryRevisionFingerprint: row.library_revision_fingerprint ? String(row.library_revision_fingerprint) : null,
    pipelineVersion: String(row.pipeline_version), modelFingerprint: String(row.model_fingerprint),
    outputFingerprint: String(row.output_fingerprint), sourceVaultId: row.source_vault_id ? String(row.source_vault_id) : null,
    sourceWorkId: row.source_work_id ? String(row.source_work_id) : null, updatedAt: String(row.updated_at),
  }));
}
