import { normalizeAcademicMetadata, type AcademicMetadata } from './academicDocument';
import * as Y from 'yjs';
import type { PageBlockDraft } from './pages';
import { BLOCKNOTE_SCHEMA_VERSION, parseNativeDocument, pageBlocksToBlockNote, validateBlockNoteDocument, type BlockNoteDocument } from './blockNoteDocument';

export interface PageYDocumentState {
  nativeDocument?: BlockNoteDocument | null;
  schemaVersion?: number;
  title: string;
  blocks: PageBlockDraft[];
}

export function readPageNativeDocument(doc: Y.Doc): BlockNoteDocument | null {
  return parseNativeDocument(doc.getMap('editor').get('blockNoteDocument'));
}

// Retain shared identities and write only the changed range. Replacing every entry
// on each keystroke bloats updates and makes replay costly in long manuscripts.
function reconcileArray<T>(array: Y.Array<T>, wanted: T[]): void {
  const previous = array.toArray();
  const equal = (left: T, right: T) => JSON.stringify(left) === JSON.stringify(right);
  let start = 0;
  while (start < previous.length && start < wanted.length && equal(previous[start], wanted[start])) start++;
  let end = previous.length, nextEnd = wanted.length;
  while (end > start && nextEnd > start && equal(previous[end - 1], wanted[nextEnd - 1])) { end--; nextEnd--; }
  if (end > start) array.delete(start, end - start);
  if (nextEnd > start) array.insert(start, wanted.slice(start, nextEnd));
}

function reconcileText(node: Y.Text, wanted: string): void {
  const previous = node.toString();
  let start = 0;
  while (start < previous.length && start < wanted.length && previous[start] === wanted[start]) start++;
  let end = previous.length, nextEnd = wanted.length;
  while (end > start && nextEnd > start && previous[end - 1] === wanted[nextEnd - 1]) { end--; nextEnd--; }
  if (end > start) node.delete(start, end - start);
  if (nextEnd > start) node.insert(start, wanted.slice(start, nextEnd));
}

function setChanged(map: Y.Map<unknown>, key: string, value: unknown): void {
  if (JSON.stringify(map.get(key)) !== JSON.stringify(value)) map.set(key, value);
}

export function writePageYDocument(doc: Y.Doc, title: string, blocks: PageBlockDraft[], nativeDocument?: BlockNoteDocument | null, schemaVersion = BLOCKNOTE_SCHEMA_VERSION, academicMetadata?: AcademicMetadata): void {
  doc.transact(() => {
    const editor = doc.getMap('editor');
    if (academicMetadata !== undefined) setChanged(editor, 'academicMetadata', normalizeAcademicMetadata(academicMetadata));
    // Old block consumers update the projection; retain native properties on unchanged blocks.
    const previousNative = readPageNativeDocument(doc);
    const native = nativeDocument === undefined ? (previousNative ? pageBlocksToBlockNote(blocks, previousNative) : null) : nativeDocument;
    if (native) {
      if (!editor.has('academicMetadata')) editor.set('academicMetadata', normalizeAcademicMetadata(null));
      setChanged(editor, 'blockNoteDocument', validateBlockNoteDocument(native));
      setChanged(editor, 'schemaVersion', schemaVersion);
    } else if (nativeDocument === null) {
      editor.delete('blockNoteDocument');
      editor.delete('schemaVersion');
    }
    const yTitle = doc.getText('title');
    reconcileText(yTitle, title);
    const yBlocks = doc.getArray<Record<string, unknown>>('blocks');
    reconcileArray(yBlocks, blocks.map((entry, index) => ({
        id: entry.id ?? '',
        parentBlockId: entry.parentBlockId ?? null,
        order: entry.order ?? (index + 1) * 1024,
        type: entry.type,
        content: entry.content ?? {},
      })));

    // V2 projection: identities live in a map and textual content in Y.Text. The legacy
    // array above remains writable so old snapshots and old clients still round-trip, but
    // new clients read this structure first and therefore merge edits instead of replacing
    // one opaque array value with another.
    const yOrder = doc.getArray<string>('blockOrder');
    const wantedOrder = blocks.map((entry) => entry.id ?? '').filter(Boolean);
    reconcileArray(yOrder, wantedOrder);
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
      setChanged(yBlock, 'parentBlockId', entry.parentBlockId ?? null);
      setChanged(yBlock, 'order', entry.order ?? (index + 1) * 1024);
      setChanged(yBlock, 'type', entry.type);
      const content = { ...(entry.content ?? {}) };
      const text = typeof content.text === 'string' ? content.text : null;
      delete content.text;
      setChanged(yBlock, 'contentJson', JSON.stringify(content));
      if (text !== null) {
        let yText = yBlock.get('text');
        if (!(yText instanceof Y.Text)) {
          yText = new Y.Text();
          yBlock.set('text', yText);
        }
        const textNode = yText as Y.Text;
        reconcileText(textNode, text);
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

export function readPageAcademicMetadata(doc: Y.Doc): AcademicMetadata { return normalizeAcademicMetadata(doc.getMap('editor').get('academicMetadata')); }
