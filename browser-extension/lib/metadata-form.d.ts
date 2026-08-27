import type { LibraryCreator, LibraryItemMetadata } from '../../shared/libraryTypes';

export interface BrowserMetadataEdits {
  title: string;
  creators: string;
  date: string;
  publicationTitle: string;
  doi: string;
}

export function formatCreators(creators: LibraryCreator[] | undefined): string;
export function parseCreators(value: string, limit?: number): LibraryCreator[];
export function applyMetadataEdits(metadata: LibraryItemMetadata, edits: BrowserMetadataEdits): LibraryItemMetadata;
