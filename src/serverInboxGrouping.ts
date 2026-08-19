import type { ServerInboxEntry } from '@shared/types';

export type ServerInboxParentKind = 'deep_research' | 'immersion' | 'library_document';

export interface ServerInboxGroup {
  id: string;
  parentKind: ServerInboxParentKind | null;
  parentId: string | null;
  title: string | null;
  entries: ServerInboxEntry[];
  unreadCount: number;
  arrivedAt: string;
}

function parentOf(entry: ServerInboxEntry): {
  kind: ServerInboxParentKind;
  id: string;
  title: string | null;
} | null {
  if (entry.parentEntityKind && entry.parentEntityId) {
    return { kind: entry.parentEntityKind, id: entry.parentEntityId, title: entry.parentTitle };
  }
  // The report mutation is the root itself. This lets its creation/update share the same
  // notification as the annotations that follow it in the ledger.
  if (entry.entityKind === 'deep_research') {
    const id = entry.key[0] == null ? '' : String(entry.key[0]);
    if (id) return { kind: 'deep_research', id, title: entry.title };
  }
  if (entry.entityKind === 'immersion') {
    const id = entry.key[0] == null ? '' : String(entry.key[0]);
    if (id) return { kind: 'immersion', id, title: entry.title };
  }
  // Entries recorded before parent metadata existed still carried the library document id
  // in `title`. Group those too, so upgrading immediately shortens an existing inbox.
  if (entry.entityKind === 'library_annotation' && entry.title) {
    return { kind: 'library_document', id: entry.title, title: null };
  }
  return null;
}

/** Newest-first entries become newest-first notifications; only true parent/child changes merge. */
export function groupServerInboxEntries(entries: ServerInboxEntry[]): ServerInboxGroup[] {
  const groups: ServerInboxGroup[] = [];
  const byParent = new Map<string, ServerInboxGroup>();
  for (const entry of entries) {
    const parent = parentOf(entry);
    if (!parent) {
      groups.push({
        id: `entry:${entry.id}`,
        parentKind: null,
        parentId: null,
        title: entry.title,
        entries: [entry],
        unreadCount: entry.read ? 0 : 1,
        arrivedAt: entry.arrivedAt,
      });
      continue;
    }
    const id = `${parent.kind}:${parent.id}`;
    const existing = byParent.get(id);
    if (existing) {
      existing.entries.push(entry);
      existing.unreadCount += entry.read ? 0 : 1;
      if (!existing.title && parent.title) existing.title = parent.title;
      continue;
    }
    const group: ServerInboxGroup = {
      id,
      parentKind: parent.kind,
      parentId: parent.id,
      title: parent.title,
      entries: [entry],
      unreadCount: entry.read ? 0 : 1,
      arrivedAt: entry.arrivedAt,
    };
    byParent.set(id, group);
    groups.push(group);
  }
  return groups;
}

/** The header badge counts notifications, not every highlight nested inside one. */
export function unreadServerInboxGroupCount(entries: ServerInboxEntry[]): number {
  return groupServerInboxEntries(entries).reduce((count, group) => count + (group.unreadCount > 0 ? 1 : 0), 0);
}
