import type { ResearchCorpusCollection, ResearchCorpusDocument } from '@shared/researchCorpus';
import type { Work } from '@shared/types';
import { getDb } from '../db/database';
import { getSettings } from '../db/settingsRepo';
import { getActiveVault } from '../vaults/vaultRegistry';
import { getGlobalLibraryItem, listGlobalLibraryCollections, listGlobalLibraryItems, listGlobalLibraryVaultLinks } from '../library/libraryService';
import { researchFingerprint } from './researchCorpusScope';

export function researchCorpusInventory(): { documents: ResearchCorpusDocument[]; collections: ResearchCorpusCollection[] } {
  const vault = getActiveVault();
  if (vault.type !== 'academic') throw new Error('Research notebooks require an academic vault');
  const documents: ResearchCorpusDocument[] = [];
  const collections: ResearchCorpusCollection[] = [];
  const linkedWorks = new Set<string>();
  const works = getDb().prepare('SELECT * FROM works WHERE archived=0').all() as Work[];
  const availableWorkIds = new Set(works.map(work => work.nodus_id));
  const links = listGlobalLibraryVaultLinks().filter(link => link.vaultId === vault.id);
  const globalMembership = new Map<string, string[]>();
  for (let offset = 0; ; offset += 500) {
    const page = listGlobalLibraryItems({ offset, limit: 500, includeFacets: false });
    for (const summary of page.items) {
      const item = getGlobalLibraryItem(summary.id);
      if (!item || item.deletedAt || item.sourceState === 'library-missing') continue;
      const linkedId = links.find(link => link.itemId === item.id)?.workId ?? item.vaultWorkIds?.[vault.id] ?? null;
      const workId = linkedId && availableWorkIds.has(linkedId) ? linkedId : null;
      if (workId) linkedWorks.add(workId);
      const identity = item.sourceIdentities.find(source => source.source === 'zotero' && (source.libraryType === 'user' || source.libraryType === 'group'));
      documents.push({ id: item.id, workId, libraryItemId: item.id, title: item.metadata.title,
        authors: item.metadata.creators.filter(creator => creator.creatorType === 'author').map(creator => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(' ')),
        year: item.metadata.year ?? null, revision: researchFingerprint({ content: item.contentRevision?.contentFingerprint ?? null, extraction: item.contentRevision?.extractionFingerprint ?? null, metadata: item.metadata, attachments: item.attachments.map(attachment => [attachment.id, attachment.sha256, attachment.sourceVersion]) }),
        attachmentId: item.attachments.length === 1 ? item.attachments[0].id : null,
        origin: identity ? { kind: 'zotero', libraryType: identity.libraryType as 'user' | 'group', libraryId: identity.libraryId, itemKey: identity.itemKey } : { kind: 'nodus', id: item.id },
        permissionRevision: researchFingerprint({ id: item.id, sourceState: item.sourceState ?? 'current', sources: item.sourceIdentities }),
        coverage: summary.readerAvailable ? 'fulltext' : item.metadata.abstract ? 'abstract' : 'metadata' });
      for (const id of item.collectionIds) globalMembership.set(id, [...(globalMembership.get(id) ?? []), item.id]);
    }
    if (offset + page.items.length >= page.total || !page.items.length) break;
  }
  for (const collection of listGlobalLibraryCollections()) collections.push({
    reference: { kind: 'library-collection', id: collection.id }, name: collection.name, parentId: collection.parentId,
    documentIds: globalMembership.get(collection.id) ?? [],
  });
  const userId = getSettings().zoteroUserId || '0';
  for (const work of works) {
    if (linkedWorks.has(work.nodus_id)) continue;
    const match = /^groups:([^:]+):(.+)$/.exec(work.zotero_key);
    const zotero = match || /^[A-Z0-9]{8}$/.test(work.zotero_key);
    const id = zotero ? `zotero:${match ? 'group' : 'user'}:${match?.[1] ?? userId}:${match?.[2] ?? work.zotero_key}` : `vault:${vault.id}:${work.nodus_id}`;
    let authors: string[] = [];
    try { const parsed = JSON.parse(work.authors_json); if (Array.isArray(parsed)) authors = parsed.filter(value => typeof value === 'string'); } catch { /* Legacy metadata. */ }
    documents.push({ id, workId: work.nodus_id, libraryItemId: null, title: work.title, authors, year: work.year, attachmentId: null,
      revision: researchFingerprint([work.zotero_version, work.zotero_fingerprint, work.resolved_text_hash, work.deep_hash]),
      permissionRevision: researchFingerprint([vault.id, work.nodus_id, work.zotero_key, work.archived]),
      origin: zotero ? { kind: 'zotero', libraryType: match ? 'group' : 'user', libraryId: match?.[1] ?? userId, itemKey: match?.[2] ?? work.zotero_key } : { kind: 'nodus', id },
      coverage: work.resolved_source_type === 'abstract_only' ? 'abstract' : work.resolved_text_chars > 0 ? 'fulltext' : 'metadata' });
  }
  const rows = getDb().prepare('SELECT collection_key,name,parent_key FROM collections').all() as { collection_key: string; name: string; parent_key: string | null }[];
  const members = getDb().prepare('SELECT collection_key,nodus_id FROM work_collections').all() as { collection_key: string; nodus_id: string }[];
  for (const row of rows) {
    const match = /^groups:([^:]+):(.+)$/.exec(row.collection_key);
    collections.push({ reference: { kind: 'zotero-collection', id: match?.[2] ?? row.collection_key, libraryType: match ? 'group' : 'user', libraryId: match?.[1] ?? userId },
      name: row.name, parentId: row.parent_key?.replace(/^groups:[^:]+:/, '') ?? null,
      documentIds: members.filter(member => member.collection_key === row.collection_key).flatMap(member => documents.filter(document => document.workId === member.nodus_id).map(document => document.id)) });
  }
  return { documents, collections };
}
