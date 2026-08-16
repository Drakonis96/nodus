import type { VaultServerConfig } from './serverSyncShared';

type ProjectionFlags = Pick<
  VaultServerConfig,
  'kind' | 'includeUserContent' | 'includePassages' | 'includeLibraryDocuments' | 'includeVectors'
>;

/**
 * Session-local pre-build fingerprint.
 *
 * `total_changes + data_version + user_version` (the databaseRevision input) cannot
 * miss a write made through the long-lived active/pooled connection, including deletes
 * and updates that count/max(rowid) heuristics would miss. It deliberately does not cross
 * connection restarts. Library files live outside SQLite, so that projection safely opts
 * out of the shortcut instead of trusting mtime.
 */
export function publishSourceRevision(databaseRevision: string, config: ProjectionFlags): string | null {
  if (config.includeLibraryDocuments) return null;
  return [
    databaseRevision,
    config.kind,
    Number(config.includeUserContent),
    Number(config.includePassages),
    Number(config.includeVectors),
  ].join(':');
}
