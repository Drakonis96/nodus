import * as Y from 'yjs';
import type { PageBlockDraft } from './pages';

export interface PageYDocumentState {
  title: string;
  blocks: PageBlockDraft[];
}

export function writePageYDocument(doc: Y.Doc, title: string, blocks: PageBlockDraft[]): void {
  doc.transact(() => {
    const yTitle = doc.getText('title');
    if (yTitle.length) yTitle.delete(0, yTitle.length);
    if (title) yTitle.insert(0, title);
    const yBlocks = doc.getArray<Record<string, unknown>>('blocks');
    if (yBlocks.length) yBlocks.delete(0, yBlocks.length);
    if (blocks.length) {
      yBlocks.insert(0, blocks.map((entry, index) => ({
        id: entry.id ?? '',
        parentBlockId: entry.parentBlockId ?? null,
        order: entry.order ?? (index + 1) * 1024,
        type: entry.type,
        content: entry.content ?? {},
      })));
    }

    // V2 projection: identities live in a map and textual content in Y.Text. The legacy
    // array above remains writable so old snapshots and old clients still round-trip, but
    // new clients read this structure first and therefore merge edits instead of replacing
    // one opaque array value with another.
    const yOrder = doc.getArray<string>('blockOrder');
    const wantedOrder = blocks.map((entry) => entry.id ?? '').filter(Boolean);
    if (yOrder.length) yOrder.delete(0, yOrder.length);
    if (wantedOrder.length) yOrder.insert(0, wantedOrder);
    const yById = doc.getMap<Y.Map<unknown>>('blockById');
    const wanted = new Set(wantedOrder);
    for (const key of [...yById.keys()]) if (!wanted.has(key)) yById.delete(key);
    for (const [index, entry] of blocks.entries()) {
      const id = entry.id ?? '';
      if (!id) continue;
      let yBlock = yById.get(id);
      if (!(yBlock instanceof Y.Map)) {
        yBlock = new Y.Map<unknown>();
        yById.set(id, yBlock);
      }
      yBlock.set('parentBlockId', entry.parentBlockId ?? null);
      yBlock.set('order', entry.order ?? (index + 1) * 1024);
      yBlock.set('type', entry.type);
      const content = { ...(entry.content ?? {}) };
      const text = typeof content.text === 'string' ? content.text : null;
      delete content.text;
      yBlock.set('contentJson', JSON.stringify(content));
      if (text !== null) {
        let yText = yBlock.get('text');
        if (!(yText instanceof Y.Text)) {
          yText = new Y.Text();
          yBlock.set('text', yText);
        }
        const textNode = yText as Y.Text;
        if (textNode.length) textNode.delete(0, textNode.length);
        if (text) textNode.insert(0, text);
      } else if (yBlock.has('text')) {
        yBlock.delete('text');
      }
    }
  }, 'nodus-page-projection');
}

export function readPageYDocument(doc: Y.Doc): PageYDocumentState {
  const yOrder = doc.getArray<string>('blockOrder');
  const yById = doc.getMap<Y.Map<unknown>>('blockById');
  if (yById.size > 0) {
    const ordered = [...yOrder.toArray(), ...[...yById.keys()].filter((id) => !yOrder.toArray().includes(id)).sort()];
    return {
      title: doc.getText('title').toString(),
      blocks: ordered.flatMap((id) => {
        const entry = yById.get(id);
        if (!(entry instanceof Y.Map)) return [];
        let content: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(String(entry.get('contentJson') ?? '{}'));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) content = parsed as Record<string, unknown>;
        } catch { /* an invalid remote fragment becomes an empty content object */ }
        const yText = entry.get('text');
        if (yText instanceof Y.Text) content.text = yText.toString();
        return [{
          id,
          parentBlockId: typeof entry.get('parentBlockId') === 'string' ? String(entry.get('parentBlockId')) : null,
          order: typeof entry.get('order') === 'number' ? Number(entry.get('order')) : undefined,
          type: entry.get('type') as PageBlockDraft['type'],
          content,
        }];
      }),
    };
  }
  return {
    title: doc.getText('title').toString(),
    blocks: doc.getArray<Record<string, unknown>>('blocks').toArray().map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : undefined,
      parentBlockId: typeof entry.parentBlockId === 'string' ? entry.parentBlockId : null,
      order: typeof entry.order === 'number' ? entry.order : undefined,
      type: entry.type as PageBlockDraft['type'],
      content: entry.content && typeof entry.content === 'object' && !Array.isArray(entry.content)
        ? entry.content as Record<string, unknown>
        : {},
    })),
  };
}

export function createPageYState(title: string, blocks: PageBlockDraft[]): {
  state: Uint8Array;
  stateVector: Uint8Array;
} {
  const doc = new Y.Doc();
  writePageYDocument(doc, title, blocks);
  return { state: Y.encodeStateAsUpdate(doc), stateVector: Y.encodeStateVector(doc) };
}

export { Y };
