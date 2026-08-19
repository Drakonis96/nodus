export interface NotionImportNotice {
  kind: 'transformed' | 'omitted' | 'unavailable';
  source: string;
  detail: string;
  count: number;
}

/** Durable, user-facing account of what a Notion export could and could not carry. */
export interface NotionImportReport {
  format: 'nodus.notion-import-report';
  formatVersion: 1;
  sourceFile: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  databases: number;
  rows: number;
  pages: number;
  rowPages: number;
  assets: number;
  deduplicatedAssets: number;
  createdDatabaseIds: string[];
  createdPageIds: string[];
  notices: NotionImportNotice[];
}
