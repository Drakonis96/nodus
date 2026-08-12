// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import type { LibraryCitationStyle, LibraryCitationStyleRecord, LibraryItemMetadata, LibraryItemSource, LibraryItemType } from './libraryTypes';

export type OfficeCitationLocatorLabel =
  | 'act' | 'appendix' | 'article-locator' | 'book' | 'canon' | 'chapter' | 'column'
  | 'elocation' | 'equation' | 'figure' | 'folio' | 'issue' | 'line' | 'note' | 'opus'
  | 'page' | 'paragraph' | 'part' | 'rule' | 'scene' | 'section' | 'sub-verbo'
  | 'supplement' | 'table' | 'timestamp' | 'title-locator' | 'verse' | 'version' | 'volume';

/** One source inside a live citation cluster. Property names mirror citeproc-js. */
export interface OfficeCitationItem {
  id: string;
  locator?: string;
  label?: OfficeCitationLocatorLabel;
  prefix?: string;
  suffix?: string;
  suppressAuthor?: boolean;
  excludeFromBibliography?: boolean;
  /** Keeps a citation editable when a collaborator does not own the source. */
  snapshot?: { citationKey: string | null; metadata: LibraryItemMetadata };
}

/** A citation as it appears in document order. noteIndex is zero for in-text citations. */
export interface OfficeCitationCluster {
  citationId: string;
  citationItems: OfficeCitationItem[];
  noteIndex: number;
  placement: 'in-text' | 'footnote' | 'endnote';
}

export interface OfficeCitationDocumentRequest {
  style: LibraryCitationStyle;
  locale: string;
  citations: OfficeCitationCluster[];
  /** Sources shown in the bibliography even when they are not cited. */
  uncitedItemIds?: string[];
  /** Embedded copies for bibliography-only sources, used when the library is unavailable. */
  uncitedItems?: OfficeCitationItem[];
  /** Cited sources intentionally omitted from the bibliography. */
  excludedItemIds?: string[];
}

export interface OfficeFormattedCitation {
  citationId: string;
  noteIndex: number;
  itemIds: string[];
  text: string;
  html: string;
}

export interface OfficeFormattedBibliography {
  itemIds: string[];
  text: string;
  html: string;
}

export interface OfficeCitationDocumentResult {
  style: LibraryCitationStyle;
  styleTitle: string;
  locale: string;
  citationFormat: LibraryCitationStyleRecord['citationFormat'];
  citations: OfficeFormattedCitation[];
  bibliography: OfficeFormattedBibliography | null;
}

export interface OfficeReferenceSummary {
  id: string;
  citationKey: string | null;
  title: string;
  itemType: LibraryItemType;
  author: string;
  year: number | null;
  publicationTitle: string | null;
  identifiers: string[];
  tags: string[];
  source: LibraryItemSource;
  snapshot: { citationKey: string | null; metadata: LibraryItemMetadata };
}

export interface OfficeDocumentPreferences {
  formatVersion: 1;
  style: LibraryCitationStyle;
  locale: string;
  placement: 'in-text' | 'footnote' | 'endnote';
  automaticUpdates: boolean;
}

export interface OfficeCitationFieldData {
  format: 'nodus.office-reference';
  formatVersion: 1;
  fieldId: string;
  kind: 'citation' | 'bibliography';
  citation?: OfficeCitationCluster;
  uncitedItemIds?: string[];
  uncitedItems?: OfficeCitationItem[];
  excludedItemIds?: string[];
  createdAt: string;
}

export interface OfficeDocumentReferenceState {
  documentId: string;
  preferences: OfficeDocumentPreferences | null;
  citations: OfficeCitationCluster[];
  bibliographyFieldIds: string[];
  bibliographies?: OfficeCitationFieldData[];
  selectedFieldId?: string | null;
}

export interface OfficeEditorCommand {
  command: 'insert-text' | 'insert-citation' | 'insert-bibliography' | 'refresh-references' | 'unlink-references';
  text?: string;
  html?: string;
  asFootnote?: boolean;
  replace?: boolean;
  field?: OfficeCitationFieldData;
  citationUpdates?: OfficeFormattedCitation[];
  bibliography?: OfficeFormattedBibliography | null;
  preferences?: OfficeDocumentPreferences;
}
