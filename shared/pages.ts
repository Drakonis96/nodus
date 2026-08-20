/**
 * Universal page and block contracts shared by SQLite, Electron and the renderer.
 *
 * `content` deliberately stays structured and extensible. A block's `type` is the
 * discriminator; helpers below normalize the few fields every renderer/exporter needs.
 * Unknown Markdown is represented by a `markdown` block, never discarded.
 */

export const PAGE_BLOCK_TYPES = [
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list',
  'numbered_list',
  'task',
  'toggle',
  'quote',
  'callout',
  'divider',
  'code',
  'equation',
  'table',
  'columns',
  'image',
  'file',
  'audio',
  'video',
  'bookmark',
  'embed',
  'subpage',
  'mention',
  'synced_block',
  'database_view',
  'markdown',
] as const;

export type PageBlockType = (typeof PAGE_BLOCK_TYPES)[number];
export type PageOrigin = 'standalone' | 'database_row' | 'note';
export type PageState = 'active' | 'trashed';

export interface Page {
  id: string;
  rowId: string | null;
  noteId: string | null;
  parentPageId: string | null;
  origin: PageOrigin;
  title: string;
  icon: string | null;
  coverBlobHash: string | null;
  state: PageState;
  locked: boolean;
  fullWidth: boolean;
  revision: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface PageBlock {
  id: string;
  pageId: string;
  parentBlockId: string | null;
  order: number;
  type: PageBlockType;
  content: Record<string, unknown>;
  normalizedText: string;
  revision: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
}

export interface PageDocument {
  page: Page;
  blocks: PageBlock[];
  /** Full Yjs state after the last persisted update. */
  yjsState: Uint8Array;
  stateVector: Uint8Array;
  revision: number;
  updateSequence: number;
  snapshotSequence: number;
  markdown: string;
  markdownHash: string;
}

export interface PageRevision {
  id: string;
  pageId: string;
  revision: number;
  sourcePageRevision: number;
  documentRevision: number;
  actorId: string;
  reason: string;
  summary: string;
  propertyChanges: number;
  blockChanges: number;
  restoredFromRevision: number | null;
  hasSnapshot: boolean;
  createdAt: string;
}

export interface PageRevisionPage {
  items: PageRevision[];
  /** Opaque keyset cursor. Null means the end of the history. */
  nextCursor: string | null;
}

export interface PageRevisionSnapshot {
  revision: PageRevision;
  page: Page;
  blocks: PageBlock[];
  markdown: string;
}

export interface PageComment {
  id: string;
  pageId: string;
  blockId: string | null;
  parentCommentId: string | null;
  body: string;
  revision: number;
  createdBy: string;
  updatedBy: string;
  authorName: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  reactions: PageCommentReaction[];
  mentionedActorIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PageCommentReaction {
  emoji: string;
  count: number;
  actorIds: string[];
}

export interface WorkspaceActor {
  id: string;
  displayName: string;
  email: string | null;
  avatar: string | null;
  kind: 'member' | 'guest' | 'system';
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceNotification {
  id: string;
  actorId: string;
  kind: 'mention' | 'comment_reply' | 'comment_resolved' | 'automation';
  pageId: string | null;
  blockId: string | null;
  commentId: string | null;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export type AclRole = 'owner' | 'full_access' | 'edit' | 'edit_content' | 'comment' | 'view';
export type AclResourceType = 'vault' | 'page' | 'database' | 'view' | 'row';
export type AclPrincipalType = 'actor' | 'group';

export interface WorkspaceGroup {
  id: string;
  name: string;
  memberActorIds: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AclEntry {
  id: string;
  resourceType: AclResourceType;
  resourceId: string;
  principalType: AclPrincipalType;
  principalId: string;
  principalName: string;
  role: AclRole;
  revision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EffectiveAcl {
  role: AclRole | null;
  sourceResourceType: AclResourceType | null;
  sourceResourceId: string | null;
  inherited: boolean;
  canView: boolean;
  canComment: boolean;
  canEditContent: boolean;
  canEditStructure: boolean;
  canManageAccess: boolean;
}

export interface WorkspaceShareLink {
  id: string;
  resourceType: 'page' | 'database' | 'view';
  resourceId: string;
  /** Returned only once when the link is created. */
  token: string | null;
  role: 'comment' | 'view';
  passwordProtected: boolean;
  expiresAt: string | null;
  allowIndexing: boolean;
  revision: number;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageBlockDraft {
  id?: string;
  parentBlockId?: string | null;
  order?: number;
  type: PageBlockType;
  content?: Record<string, unknown>;
}

export interface PageConflict {
  kind: 'revision_conflict';
  pageId: string;
  expectedRevision: number;
  actualRevision: number;
  current: PageDocument;
}

export type PageMutationResult =
  | { ok: true; document: PageDocument }
  | { ok: false; conflict: PageConflict };

export interface PageAsset {
  blobHash: string;
  name: string;
  mimeType: string | null;
  bytes: number;
}

export interface PageTreeItem extends Page {
  favorite: boolean;
  childCount: number;
}

export type PageLinkKind = 'subpage' | 'mention' | 'synced_block';

export interface PageBacklink {
  id: string;
  sourcePageId: string;
  sourceBlockId: string;
  sourceTitle: string;
  targetPageId: string | null;
  targetBlockId: string | null;
  kind: PageLinkKind;
  label: string;
  broken: boolean;
}

export interface PageSearchResult {
  entityType: 'page_title' | 'page_block' | 'cell' | 'attachment';
  entityId: string;
  pageId: string | null;
  rowId: string | null;
  title: string;
  snippet: string;
  rank: number;
}

export interface SyncedBlockSource {
  block: PageBlock;
  page: Page;
}

export interface CreatePageInput {
  title?: string;
  parentPageId?: string | null;
  icon?: string | null;
  blocks?: PageBlockDraft[];
  actorId?: string;
}

export interface SavePageDocumentInput {
  pageId: string;
  expectedRevision: number;
  blocks: PageBlockDraft[];
  actorId?: string;
  /** Authenticated principal; separate from the audit actor for compatibility. */
  principalId?: string;
  reason?: string;
}

const text = (content: Record<string, unknown>, key = 'text') =>
  typeof content[key] === 'string' ? String(content[key]) : '';

export function pageBlockNormalizedText(type: PageBlockType, content: Record<string, unknown>): string {
  if (type === 'divider') return '';
  if (type === 'table') {
    const rows = Array.isArray(content.rows) ? content.rows : [];
    return rows.flatMap((row) => Array.isArray(row) ? row : []).map(String).join(' ');
  }
  if (type === 'columns') {
    const columns = Array.isArray(content.columns) ? content.columns : [];
    return columns.map((column) => typeof column === 'string' ? column : '').join(' ');
  }
  if (type === 'markdown') return text(content, 'markdown');
  return [
    text(content), text(content, 'title'), text(content, 'caption'), text(content, 'name'),
    text(content, 'url'), text(content, 'body'), text(content, 'language'),
  ].filter(Boolean).join(' ');
}

function makeId(prefix: string, idFactory?: () => string): string {
  if (idFactory) return idFactory();
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

function block(type: PageBlockType, content: Record<string, unknown>, idFactory?: () => string): PageBlockDraft {
  return { id: makeId('pblk', idFactory), type, content };
}

function assetReference(url: string): { url: string; blobHash?: string } {
  const local = url.match(/^nodus-blob:\/\/([0-9a-f]{64})$/i);
  return local ? { url: '', blobHash: local[1].toLowerCase() } : { url };
}

const SPECIAL_START = /^(?:#{1,3}\s|[-*+]\s|\d+[.)]\s|>\s?|```|~~~|\$\$|---+$|\*\*\*+$|___+$|\|)/;

/**
 * Conservative Markdown projection. Constructs we understand become native blocks;
 * anything ambiguous remains a raw Markdown block so round-tripping cannot lose it.
 */
export function markdownToPageBlocks(markdown: string, idFactory?: () => string): PageBlockDraft[] {
  const source = markdown.replace(/\r\n?/g, '\n');
  if (!source.trim()) return [block('paragraph', { text: '' }, idFactory)];
  const lines = source.split('\n');
  const out: PageBlockDraft[] = [];
  let index = 0;
  const pushParagraph = () => {
    const start = index;
    while (index < lines.length && lines[index].trim() && !SPECIAL_START.test(lines[index].trim())) index++;
    const value = lines.slice(start, index).join('\n');
    if (value) out.push(block('paragraph', { text: value }, idFactory));
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) { index++; continue; }

    const fence = trimmed.match(/^(```|~~~)(.*)$/);
    if (fence) {
      const marker = fence[1];
      const language = fence[2].trim();
      const start = index++;
      const body: string[] = [];
      while (index < lines.length && !lines[index].trim().startsWith(marker)) body.push(lines[index++]);
      if (index >= lines.length) {
        out.push(block('markdown', { markdown: lines.slice(start).join('\n') }, idFactory));
        break;
      }
      index++;
      out.push(block('code', { text: body.join('\n'), language }, idFactory));
      continue;
    }

    if (trimmed === '$$' || trimmed.startsWith('$$')) {
      if (trimmed !== '$$' && trimmed.endsWith('$$') && trimmed.length > 4) {
        out.push(block('equation', { text: trimmed.slice(2, -2).trim() }, idFactory));
        index++;
        continue;
      }
      const start = index++;
      const body: string[] = [];
      while (index < lines.length && lines[index].trim() !== '$$') body.push(lines[index++]);
      if (index >= lines.length) {
        out.push(block('markdown', { markdown: lines.slice(start).join('\n') }, idFactory));
        break;
      }
      index++;
      out.push(block('equation', { text: body.join('\n') }, idFactory));
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      out.push(block(`heading_${heading[1].length}` as PageBlockType, { text: heading[2] }, idFactory));
      index++;
      continue;
    }
    if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
      out.push(block('divider', {}, idFactory));
      index++;
      continue;
    }
    const task = trimmed.match(/^[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (task) {
      out.push(block('task', { text: task[2], checked: task[1].toLowerCase() === 'x' }, idFactory));
      index++;
      continue;
    }
    const bullet = trimmed.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      out.push(block('bulleted_list', { text: bullet[1] }, idFactory));
      index++;
      continue;
    }
    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      out.push(block('numbered_list', { text: numbered[1] }, idFactory));
      index++;
      continue;
    }
    const callout = trimmed.match(/^>\s*\[!([A-Za-z]+)\]\s*(.*)$/);
    if (callout) {
      out.push(block('callout', { text: callout[2], tone: callout[1].toLowerCase() }, idFactory));
      index++;
      continue;
    }
    if (trimmed.startsWith('>')) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('>')) {
        quote.push(lines[index++].trim().replace(/^>\s?/, ''));
      }
      out.push(block('quote', { text: quote.join('\n') }, idFactory));
      continue;
    }

    if (trimmed.startsWith('|') && index + 1 < lines.length && /^\s*\|?\s*:?-+/.test(lines[index + 1])) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith('|')) tableLines.push(lines[index++]);
      const parseRow = (value: string) => value.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      const rows = tableLines.filter((_value, rowIndex) => rowIndex !== 1).map(parseRow);
      out.push(block('table', { rows }, idFactory));
      continue;
    }

    const image = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
    if (image) {
      out.push(block('image', { caption: image[1], ...assetReference(image[2]), title: image[3] ?? '' }, idFactory));
      index++;
      continue;
    }
    const mention = trimmed.match(/^@\[([^\]]+)\]\(nodus:\/\/page\/([^)\s]+)\)$/);
    if (mention) {
      out.push(block('mention', { label: mention[1], pageId: decodeURIComponent(mention[2]) }, idFactory));
      index++;
      continue;
    }
    const link = trimmed.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const pageTarget = link[2].match(/^nodus:\/\/page\/(.+)$/);
      const blobTarget = link[2].match(/^nodus-blob:\/\/([0-9a-f]{64})$/i);
      out.push(block(pageTarget ? 'subpage' : blobTarget ? 'file' : 'bookmark', pageTarget
        ? { title: link[1], pageId: decodeURIComponent(pageTarget[1]) }
        : blobTarget
          ? { name: link[1], ...assetReference(link[2]) }
          : { title: link[1], url: link[2] }, idFactory));
      index++;
      continue;
    }
    if (/^<details[\s>]/i.test(trimmed)) {
      const raw: string[] = [];
      while (index < lines.length) {
        raw.push(lines[index]);
        if (/<\/details>\s*$/i.test(lines[index])) { index++; break; }
        index++;
      }
      const joined = raw.join('\n');
      const summary = joined.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1] ?? '';
      const bodyText = joined.replace(/[\s\S]*?<\/summary>/i, '').replace(/<\/details>\s*$/i, '').trim();
      out.push(block('toggle', { text: summary, body: bodyText }, idFactory));
      continue;
    }
    if (/^<(?:iframe|audio|video)\b/i.test(trimmed)) {
      const kind = /^<audio\b/i.test(trimmed) ? 'audio' : /^<video\b/i.test(trimmed) ? 'video' : 'embed';
      const source = line.match(/\bsrc=["']([^"']+)/i)?.[1] ?? '';
      out.push(block(kind, { html: line, ...assetReference(source) }, idFactory));
      index++;
      continue;
    }
    if (/^<!--\s*nodus:/.test(trimmed)) {
      const native = trimmed.match(/^<!--\s*nodus:(columns|synced|database-view)\s+([\s\S]*?)\s*-->$/);
      if (!native) out.push(block('markdown', { markdown: line }, idFactory));
      else if (native[1] === 'columns') {
        try { out.push(block('columns', { columns: JSON.parse(native[2]) }, idFactory)); }
        catch { out.push(block('markdown', { markdown: line }, idFactory)); }
      } else if (native[1] === 'synced') out.push(block('synced_block', { sourceBlockId: native[2] }, idFactory));
      else {
        try {
          const decoded = decodeURIComponent(native[2]); const content = JSON.parse(decoded);
          out.push(block('database_view', content && typeof content === 'object' && !Array.isArray(content) ? content : { viewId: native[2] }, idFactory));
        } catch { out.push(block('database_view', { viewId: native[2] }, idFactory)); }
      }
      index++;
      continue;
    }
    if (trimmed.startsWith(':::')) {
      const raw = [line];
      index++;
      while (index < lines.length) {
        raw.push(lines[index]);
        if (lines[index].trim() === ':::') { index++; break; }
        index++;
      }
      out.push(block('markdown', { markdown: raw.join('\n') }, idFactory));
      continue;
    }

    const before = index;
    pushParagraph();
    // A special marker not recognized above is preserved raw and advances the loop.
    if (index === before) out.push(block('markdown', { markdown: lines[index++] }, idFactory));
  }
  return out.length ? out : [block('paragraph', { text: source }, idFactory)];
}

function tableMarkdown(content: Record<string, unknown>): string {
  const rows = (Array.isArray(content.rows) ? content.rows : []).map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => String(cell ?? '').replace(/\|/g, '\\|'))
  );
  if (!rows.length) rows.push(['']);
  const width = Math.max(1, ...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));
  return [
    `| ${normalized[0].join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

export function pageBlockToMarkdown(blockValue: Pick<PageBlock, 'type' | 'content'> | PageBlockDraft): string {
  const content = blockValue.content ?? {};
  const value = text(content);
  switch (blockValue.type) {
    case 'paragraph': return value;
    case 'heading_1': return `# ${value}`;
    case 'heading_2': return `## ${value}`;
    case 'heading_3': return `### ${value}`;
    case 'bulleted_list': return `- ${value}`;
    case 'numbered_list': return `1. ${value}`;
    case 'task': return `- [${content.checked ? 'x' : ' '}] ${value}`;
    case 'toggle': return `<details><summary>${value}</summary>\n\n${text(content, 'body')}\n\n</details>`;
    case 'quote': return value.split('\n').map((line) => `> ${line}`).join('\n');
    case 'callout': return `> [!${(text(content, 'tone') || 'NOTE').toUpperCase()}] ${value}`;
    case 'divider': return '---';
    case 'code': return `\`\`\`${text(content, 'language')}\n${value}\n\`\`\``;
    case 'equation': return `$$\n${value}\n$$`;
    case 'table': return tableMarkdown(content);
    case 'columns': return `<!-- nodus:columns ${JSON.stringify(Array.isArray(content.columns) ? content.columns : [])} -->`;
    case 'image': return `![${text(content, 'caption')}](${text(content, 'url') || `nodus-blob://${text(content, 'blobHash')}`})`;
    case 'file': return `[${text(content, 'name') || 'Archivo'}](${text(content, 'url') || `nodus-blob://${text(content, 'blobHash')}`})`;
    case 'audio': return `<audio controls src="${text(content, 'url') || `nodus-blob://${text(content, 'blobHash')}`}"></audio>`;
    case 'video': return `<video controls src="${text(content, 'url') || `nodus-blob://${text(content, 'blobHash')}`}"></video>`;
    case 'bookmark': return `[${text(content, 'title') || text(content, 'url')}](${text(content, 'url')})`;
    case 'embed': return text(content, 'html') || text(content, 'url');
    case 'subpage': return `[${text(content, 'title') || 'Subpágina'}](nodus://page/${encodeURIComponent(text(content, 'pageId'))})`;
    case 'mention': return `@[${text(content, 'label') || 'Página'}](nodus://page/${encodeURIComponent(text(content, 'pageId'))})`;
    case 'synced_block': return `<!-- nodus:synced ${text(content, 'sourceBlockId')} -->`;
    case 'database_view': return `<!-- nodus:database-view ${encodeURIComponent(JSON.stringify(content))} -->`;
    case 'markdown': return text(content, 'markdown');
  }
}

export function pageBlocksToMarkdown(blocks: Array<Pick<PageBlock, 'type' | 'content' | 'parentBlockId' | 'order'> | PageBlockDraft>): string {
  const sorted = [...blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return sorted.map((entry) => pageBlockToMarkdown(entry)).join('\n\n').replace(/\n{4,}/g, '\n\n\n').trimEnd();
}

export function defaultPageBlockContent(type: PageBlockType): Record<string, unknown> {
  if (type === 'task') return { text: '', checked: false };
  if (type === 'toggle') return { text: '', body: '' };
  if (type === 'callout') return { text: '', tone: 'note' };
  if (type === 'divider') return {};
  if (type === 'code') return { text: '', language: '' };
  if (type === 'table') return { rows: [['Columna 1', 'Columna 2'], ['', '']] };
  if (type === 'columns') return { columns: ['', ''] };
  if (['image', 'file', 'audio', 'video'].includes(type)) return { name: '', blobHash: '', mimeType: '', bytes: 0 };
  if (type === 'bookmark') return { title: '', url: '' };
  if (type === 'embed') return { url: '', html: '' };
  if (type === 'subpage') return { title: '', pageId: '' };
  if (type === 'mention') return { label: '', pageId: '' };
  if (type === 'synced_block') return { sourceBlockId: '' };
  if (type === 'database_view') return { viewId: '' };
  if (type === 'markdown') return { markdown: '' };
  return { text: '' };
}
