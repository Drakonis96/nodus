import type { LibraryCreator, LibraryItemMetadata } from '../../shared/libraryTypes';

export interface BrowserMetadataEdits {
  title: string;
  creators: string;
  date: string;
  publicationTitle: string;
  doi: string;
}

export interface MetadataLabels {
  untitledDocument: string;
}

/** English default; adapters pass the label their UI language renders. */
export const METADATA_LABELS: Readonly<MetadataLabels>;

export function formatCreators(creators: LibraryCreator[] | undefined): string;
export function parseCreators(value: string, limit?: number): LibraryCreator[];
export function applyMetadataEdits(metadata: LibraryItemMetadata, edits: BrowserMetadataEdits, labels?: MetadataLabels): LibraryItemMetadata;
