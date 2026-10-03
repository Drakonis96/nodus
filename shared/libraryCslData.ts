// SPDX-License-Identifier: AGPL-3.0-only
import type { LibraryItemRecord } from './libraryTypes';
export function libraryItemCslData(record: LibraryItemRecord): Record<string, unknown> {
  const metadata = record.metadata;
  const creator = (type: string) => metadata.creators.filter((entry) => entry.creatorType === type).map((entry) => entry.name ? { literal: entry.name } : { given: entry.firstName, family: entry.lastName });
  const creators = (...types: string[]) => types.flatMap(creator);
  const primaryCreatorRoles: Partial<Record<LibraryItemRecord['metadata']['itemType'], string[]>> = {
    artwork: ['artist'], map: ['cartographer'], patent: ['inventor'], interview: ['interviewer'],
    film: ['director'], 'video-recording': ['director'], 'audio-recording': ['performer', 'composer'],
    'radio-broadcast': ['director'], 'tv-broadcast': ['director'], podcast: ['podcaster'],
    presentation: ['presenter'], 'computer-program': ['programmer'],
  };
  const typeMap: Partial<Record<LibraryItemRecord['metadata']['itemType'], string>> = {
    'article-journal': 'article-journal', 'journal-article': 'article-journal', 'magazine-article': 'article-magazine',
    'newspaper-article': 'article-newspaper', book: 'book', 'book-chapter': 'chapter', chapter: 'chapter',
    'book-section': 'chapter', 'conference-paper': 'paper-conference', thesis: 'thesis', report: 'report',
    manuscript: 'manuscript', presentation: 'speech', interview: 'interview', letter: 'personal_communication',
    email: 'personal_communication', 'instant-message': 'personal_communication', 'encyclopedia-article': 'entry-encyclopedia',
    'dictionary-entry': 'entry-dictionary', case: 'legal_case', hearing: 'hearing', bill: 'bill', statute: 'legislation',
    patent: 'patent', artwork: 'graphic', map: 'map', film: 'motion_picture', 'audio-recording': 'song',
    'video-recording': 'motion_picture', 'radio-broadcast': 'broadcast', 'tv-broadcast': 'broadcast', podcast: 'broadcast',
    'blog-post': 'post-weblog', 'forum-post': 'post', 'computer-program': 'software', webpage: 'webpage',
    document: 'document', dataset: 'dataset', preprint: 'article', standard: 'standard', other: 'document',
  };
  return {
    id: record.id, type: typeMap[metadata.itemType] ?? 'document', title: metadata.title,
    author: creators('author', ...(primaryCreatorRoles[metadata.itemType] ?? [])),
    editor: creator('editor'),
    translator: creator('translator'),
    'container-author': creator('bookAuthor'),
    'collection-editor': creator('seriesEditor'),
    'reviewed-author': creator('reviewedAuthor'),
    recipient: creator('recipient'),
    interviewer: creator('interviewer'),
    composer: creator('composer'),
    director: creator('director'),
    illustrator: creators('artist', 'illustrator'),
    ...(metadata.year != null ? { issued: { 'date-parts': [[metadata.year]] } } : {}),
    abstract: metadata.abstract, 'container-title': metadata.publicationTitle, publisher: metadata.publisher,
    'publisher-place': metadata.place, volume: metadata.volume, issue: metadata.issue, page: metadata.pages,
    edition: metadata.edition, DOI: metadata.doi, ISBN: metadata.isbn, ISSN: metadata.issn, URL: metadata.url,
    language: metadata.language, keyword: metadata.tags?.join('; '),
    ...Object.fromEntries(Object.entries(metadata.extra ?? {}).map(([key, value]) => [key.replace(/^csl:/, ''), value])),
  };
}

