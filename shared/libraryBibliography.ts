// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

import type {
  LibraryColumnId,
  LibraryCreatorRole,
  LibraryItemType,
  LibraryMetadataIdentifierKind,
  LibrarySortField,
} from './libraryTypes';

export interface LibraryItemTypeDefinition {
  id: LibraryItemType;
  zoteroType: string | null;
  label: string;
}

/**
 * Every current citeable Zotero item type, plus Nodus' generic fallback.
 * Legacy Nodus aliases remain readable but are deliberately omitted from creation UIs.
 */
export const LIBRARY_ITEM_TYPES: readonly LibraryItemTypeDefinition[] = [
  { id: 'book', zoteroType: 'book', label: 'Libro' },
  { id: 'book-chapter', zoteroType: 'bookSection', label: 'Capítulo de libro' },
  { id: 'journal-article', zoteroType: 'journalArticle', label: 'Artículo de revista académica' },
  { id: 'magazine-article', zoteroType: 'magazineArticle', label: 'Artículo de revista' },
  { id: 'newspaper-article', zoteroType: 'newspaperArticle', label: 'Artículo de periódico' },
  { id: 'thesis', zoteroType: 'thesis', label: 'Tesis' },
  { id: 'letter', zoteroType: 'letter', label: 'Carta' },
  { id: 'manuscript', zoteroType: 'manuscript', label: 'Manuscrito' },
  { id: 'interview', zoteroType: 'interview', label: 'Entrevista' },
  { id: 'film', zoteroType: 'film', label: 'Película' },
  { id: 'artwork', zoteroType: 'artwork', label: 'Obra de arte' },
  { id: 'webpage', zoteroType: 'webpage', label: 'Página web' },
  { id: 'report', zoteroType: 'report', label: 'Informe' },
  { id: 'bill', zoteroType: 'bill', label: 'Proyecto de ley' },
  { id: 'case', zoteroType: 'case', label: 'Caso' },
  { id: 'hearing', zoteroType: 'hearing', label: 'Audiencia' },
  { id: 'patent', zoteroType: 'patent', label: 'Patente' },
  { id: 'statute', zoteroType: 'statute', label: 'Estatuto' },
  { id: 'email', zoteroType: 'email', label: 'Correo electrónico' },
  { id: 'map', zoteroType: 'map', label: 'Mapa' },
  { id: 'blog-post', zoteroType: 'blogPost', label: 'Entrada de blog' },
  { id: 'instant-message', zoteroType: 'instantMessage', label: 'Mensaje instantáneo' },
  { id: 'forum-post', zoteroType: 'forumPost', label: 'Entrada de foro' },
  { id: 'audio-recording', zoteroType: 'audioRecording', label: 'Grabación de audio' },
  { id: 'presentation', zoteroType: 'presentation', label: 'Presentación' },
  { id: 'video-recording', zoteroType: 'videoRecording', label: 'Grabación de vídeo' },
  { id: 'tv-broadcast', zoteroType: 'tvBroadcast', label: 'Emisión de televisión' },
  { id: 'radio-broadcast', zoteroType: 'radioBroadcast', label: 'Emisión de radio' },
  { id: 'podcast', zoteroType: 'podcast', label: 'Podcast' },
  { id: 'computer-program', zoteroType: 'computerProgram', label: 'Programa informático' },
  { id: 'conference-paper', zoteroType: 'conferencePaper', label: 'Ponencia' },
  { id: 'document', zoteroType: 'document', label: 'Documento' },
  { id: 'encyclopedia-article', zoteroType: 'encyclopediaArticle', label: 'Artículo de enciclopedia' },
  { id: 'dictionary-entry', zoteroType: 'dictionaryEntry', label: 'Entrada de diccionario' },
  { id: 'preprint', zoteroType: 'preprint', label: 'Preprint' },
  { id: 'dataset', zoteroType: 'dataset', label: 'Conjunto de datos' },
  { id: 'standard', zoteroType: 'standard', label: 'Norma' },
  { id: 'other', zoteroType: null, label: 'Otro' },
] as const;

export const LIBRARY_CREATOR_ROLES: readonly LibraryCreatorRole[] = [
  'author', 'bookAuthor', 'contributor', 'editor', 'seriesEditor', 'translator', 'reviewedAuthor',
  'inventor', 'director', 'scriptwriter', 'producer', 'performer', 'castMember', 'composer',
  'wordsBy', 'cartographer', 'programmer', 'artist', 'podcaster', 'guest', 'presenter',
  'interviewer', 'interviewee', 'recipient', 'sponsor', 'counsel', 'attorneyAgent', 'commenter',
] as const;

export interface LibraryColumnDefinition {
  id: LibraryColumnId;
  label: string;
  width: string;
  sort?: LibrarySortField;
}

/** Zotero-style table columns. Array order is the initial chooser order only. */
export const LIBRARY_COLUMNS: readonly LibraryColumnDefinition[] = [
  { id: 'title', label: 'Título', width: 'minmax(14rem,2fr)', sort: 'title' },
  { id: 'creator', label: 'Autoría', width: 'minmax(9rem,1fr)', sort: 'creator' },
  { id: 'itemType', label: 'Tipo', width: '10rem', sort: 'itemType' },
  { id: 'publicationTitle', label: 'Publicación', width: '11rem', sort: 'publicationTitle' },
  { id: 'publisher', label: 'Editorial', width: '10rem', sort: 'publisher' },
  { id: 'date', label: 'Fecha', width: '8rem', sort: 'date' },
  { id: 'year', label: 'Año', width: '4.5rem', sort: 'year' },
  { id: 'edition', label: 'Edición', width: '6rem', sort: 'edition' },
  { id: 'volume', label: 'Volumen', width: '6rem', sort: 'volume' },
  { id: 'issue', label: 'Número', width: '6rem', sort: 'issue' },
  { id: 'pages', label: 'Páginas', width: '7rem', sort: 'pages' },
  { id: 'doi', label: 'DOI', width: '12rem', sort: 'doi' },
  { id: 'isbn', label: 'ISBN', width: '10rem', sort: 'isbn' },
  { id: 'issn', label: 'ISSN', width: '8rem', sort: 'issn' },
  { id: 'pmid', label: 'PMID', width: '8rem', sort: 'pmid' },
  { id: 'pmcid', label: 'PMCID', width: '8rem', sort: 'pmcid' },
  { id: 'arxiv', label: 'arXiv', width: '9rem', sort: 'arxiv' },
  { id: 'url', label: 'URL', width: '12rem', sort: 'url' },
  { id: 'language', label: 'Idioma', width: '7rem', sort: 'language' },
  { id: 'citationKey', label: 'Clave de cita', width: '9rem', sort: 'citationKey' },
  { id: 'tags', label: 'Etiquetas', width: '11rem', sort: 'tags' },
  { id: 'source', label: 'Origen', width: '7rem', sort: 'source' },
  { id: 'status', label: 'Estado', width: '7.5rem', sort: 'extraction' },
  { id: 'attachments', label: 'Adjuntos', width: '5.5rem', sort: 'attachments' },
  { id: 'createdAt', label: 'Añadido', width: '8.5rem', sort: 'createdAt' },
  { id: 'updatedAt', label: 'Modificado', width: '8.5rem', sort: 'updatedAt' },
] as const;

export const LIBRARY_COLUMN_BY_ID = Object.fromEntries(
  LIBRARY_COLUMNS.map((column) => [column.id, column]),
) as Record<LibraryColumnId, LibraryColumnDefinition>;

function compactIdentifier(value: string): string {
  return value.toUpperCase().replace(/[^0-9X]/g, '');
}

function validIsbn(value: string): boolean {
  const compact = compactIdentifier(value);
  if (/^\d{13}$/.test(compact)) {
    const total = [...compact.slice(0, 12)].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0);
    return (10 - total % 10) % 10 === Number(compact[12]);
  }
  if (!/^\d{9}[\dX]$/.test(compact)) return false;
  const total = [...compact].reduce((sum, digit, index) => sum + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0);
  return total % 11 === 0;
}

/** Detects the identifier accepted by the Zotero-style magic-add field. */
export function detectLibraryMetadataIdentifier(raw: string): { kind: LibraryMetadataIdentifierKind; value: string } | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?10\.\d{4,9}\/\S+$/i.test(value)) return { kind: 'doi', value };
  if (/^(?:https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/|arxiv:\s*)?(?:\d{4}\.\d{4,5}|[a-z.-]+\/\d{7})(?:v\d+)?(?:\.pdf)?$/i.test(value)) return { kind: 'arxiv', value };
  if (/^(?:pmcid?:\s*)?PMC\d{1,12}$/i.test(value)) return { kind: 'pmcid', value };
  if (/^pmid:\s*\d{1,12}$/i.test(value)) return { kind: 'pmid', value };
  if (/^issn:\s*\d{4}-?\d{3}[\dX]$/i.test(value) || /^\d{4}-\d{3}[\dX]$/i.test(value)) return { kind: 'issn', value };
  if (/^isbn(?:-1[03])?:/i.test(value) || validIsbn(value)) return { kind: 'isbn', value };
  if (/^\d{1,12}$/.test(value)) return { kind: 'pmid', value };
  return null;
}

export function libraryItemTypeLabel(type: LibraryItemType): string {
  if (type === 'book-section' || type === 'chapter') return 'Capítulo de libro';
  if (type === 'article-journal') return 'Artículo de revista académica';
  return LIBRARY_ITEM_TYPES.find((entry) => entry.id === type)?.label ?? type;
}
