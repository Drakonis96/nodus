// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jorge Pérez Burgueño and Nodus contributors

/**
 * Presentation rules shared by both Connector surfaces:
 *
 * - the Chrome extension popup; and
 * - the trusted Connector built into Nodus Browser.
 *
 * Keep this module free of Chrome, Electron and DOM APIs. A change here must be
 * reflected by both adapters, which is enforced by test-browser-connector.mjs.
 */
export const ITEM_TYPES = [
  ['journal-article', 'Journal article'], ['book', 'Book'], ['book-chapter', 'Book chapter'], ['conference-paper', 'Conference paper'],
  ['thesis', 'Thesis'], ['report', 'Report'], ['manuscript', 'Manuscript'], ['preprint', 'Preprint'], ['dataset', 'Dataset'],
  ['presentation', 'Presentation'], ['newspaper-article', 'Newspaper article'], ['magazine-article', 'Magazine article'],
  ['encyclopedia-article', 'Encyclopedia article'], ['dictionary-entry', 'Dictionary entry'], ['interview', 'Interview'],
  ['letter', 'Letter'], ['email', 'Email'], ['instant-message', 'Instant message'], ['case', 'Case'], ['hearing', 'Hearing'], ['bill', 'Bill'], ['statute', 'Statute'],
  ['patent', 'Patent'], ['artwork', 'Artwork'], ['map', 'Map'], ['film', 'Film'], ['audio-recording', 'Audio recording'],
  ['video-recording', 'Video recording'], ['radio-broadcast', 'Radio broadcast'], ['tv-broadcast', 'TV broadcast'],
  ['podcast', 'Podcast'], ['blog-post', 'Blog post'], ['forum-post', 'Forum post'], ['computer-program', 'Computer program'],
  ['webpage', 'Web page'], ['document', 'Document'], ['standard', 'Standard'], ['other', 'Other'],
];

const ITEM_TYPE_LABELS_ES = {
  'journal-article': 'Artículo académico', book: 'Libro', 'book-chapter': 'Capítulo de libro', 'conference-paper': 'Ponencia',
  thesis: 'Tesis', report: 'Informe', manuscript: 'Manuscrito', preprint: 'Preprint', dataset: 'Conjunto de datos',
  presentation: 'Presentación', 'newspaper-article': 'Artículo de periódico', 'magazine-article': 'Artículo de revista',
  'encyclopedia-article': 'Artículo de enciclopedia', 'dictionary-entry': 'Entrada de diccionario', interview: 'Entrevista',
  letter: 'Carta', email: 'Correo electrónico', 'instant-message': 'Mensaje instantáneo', case: 'Caso', hearing: 'Audiencia',
  bill: 'Proyecto de ley', statute: 'Estatuto', patent: 'Patente', artwork: 'Obra de arte', map: 'Mapa', film: 'Película',
  'audio-recording': 'Grabación de audio', 'video-recording': 'Grabación de vídeo', 'radio-broadcast': 'Emisión de radio',
  'tv-broadcast': 'Emisión de televisión', podcast: 'Podcast', 'blog-post': 'Entrada de blog', 'forum-post': 'Entrada de foro',
  'computer-program': 'Programa informático', webpage: 'Página web', document: 'Documento', standard: 'Norma', other: 'Otro',
};

export function byline(metadata) {
  const names = (metadata.creators || []).slice(0, 3)
    .map((creator) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' '))
    .filter(Boolean);
  return [names.join(', '), metadata.year || metadata.date || '', metadata.publicationTitle || '']
    .filter(Boolean)
    .join(' · ');
}

export function typeLabel(type, spanishUi = false) {
  return (spanishUi ? ITEM_TYPE_LABELS_ES[type] : '') || ITEM_TYPES.find(([id]) => id === type)?.[1] || type;
}

export function typeGlyph(type) {
  if (type === 'book') return 'B';
  if (type.includes('article')) return 'A';
  if (type === 'webpage') return 'W';
  return 'Aa';
}
