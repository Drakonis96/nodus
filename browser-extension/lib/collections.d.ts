import type { LibraryCollectionView } from '../../shared/libraryTypes';

export interface HierarchicalCollectionRow {
  collection: LibraryCollectionView;
  depth: number;
  path: string[];
  pathLabel: string;
}

export function hierarchicalCollections(collections: LibraryCollectionView[]): HierarchicalCollectionRow[];
export function filterCollectionRows(collections: LibraryCollectionView[], query: string): HierarchicalCollectionRow[];
export function normalizeTags(values: string[], limit?: number): string[];
