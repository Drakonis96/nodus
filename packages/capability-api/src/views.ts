import { LIMITS } from './limits';
import { SLUG, exactKeys, plainText } from './json';

/** The only thing a worker may return for display. It is data, not markup: there is no
 *  HTML, no script, no CSS and no component reference anywhere in the tree, so a plugin
 *  cannot reach into the renderer even by accident. */

export type ViewTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface ViewSpan {
  text: string;
  emphasis?: 'strong' | 'em' | 'code';
  /** Only https. Rendered as an external link, never auto-followed. */
  href?: string;
}

export type ViewNode =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { kind: 'paragraph'; spans: ViewSpan[] }
  | { kind: 'list'; ordered?: boolean; items: ViewSpan[][] }
  | { kind: 'badges'; items: Array<{ label: string; tone?: ViewTone }> }
  | { kind: 'notice'; tone: ViewTone; title?: string; spans: ViewSpan[] }
  | { kind: 'svg'; svg: string; title: string; alt: string }
  | { kind: 'table'; caption?: string; columns: Array<{ label: string; align?: 'start' | 'end' }>; rows: Array<Array<string | number | null>> }
  | { kind: 'code'; language?: string; text: string }
  | { kind: 'links'; items: Array<{ href: string; label: string; description?: string }> }
  | { kind: 'details'; summary: string; children: ViewNode[] }
  | { kind: 'download'; attachmentId: string; label: string; name: string; mimeType: string; bytes: number }
  | { kind: 'status'; state: 'ok' | 'pending' | 'failed'; label: string; description?: string };

export interface ViewDocumentV1 {
  schemaVersion: 1;
  title?: string;
  /** Read by screen readers in place of the whole document when it is a drawing. */
  summary: string;
  nodes: ViewNode[];
}

const TONES = ['neutral', 'info', 'success', 'warning', 'danger'];

function validateSpans(input: unknown, budget: { nodes: number }): ViewSpan[] {
  if (!Array.isArray(input) || !input.length || input.length > 200) throw new Error('Invalid view spans.');
  return input.map(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !exactKeys(raw, ['text', 'emphasis', 'href'])) throw new Error('Invalid view span.');
    const span = raw as ViewSpan;
    if (typeof span.text !== 'string' || !span.text.length || span.text.length > LIMITS.viewTextChars) throw new Error('Invalid view span text.');
    if (span.emphasis !== undefined && !['strong', 'em', 'code'].includes(span.emphasis)) throw new Error('Invalid view span emphasis.');
    if (span.href !== undefined) assertHttps(span.href);
    budget.nodes += 1;
    return structuredClone(span);
  });
}

function assertHttps(href: unknown): void {
  let url: URL;
  try { url = new URL(String(href)); } catch { throw new Error('Invalid view link.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('View links must be https.');
}

function validateNode(input: unknown, budget: { nodes: number }, depth: number): ViewNode {
  if (++budget.nodes > LIMITS.viewNodes) throw new Error('View document is too large.');
  if (depth > LIMITS.viewDepth) throw new Error('View document is too deeply nested.');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid view node.');
  const node = input as ViewNode;
  switch (node.kind) {
    case 'heading':
      if (!exactKeys(node, ['kind', 'level', 'text']) || ![1, 2, 3, 4].includes(node.level) || !plainText(node.text, 300)) throw new Error('Invalid view heading.');
      return { kind: 'heading', level: node.level, text: node.text };
    case 'paragraph':
      if (!exactKeys(node, ['kind', 'spans'])) throw new Error('Invalid view paragraph.');
      return { kind: 'paragraph', spans: validateSpans(node.spans, budget) };
    case 'list':
      if (!exactKeys(node, ['kind', 'ordered', 'items']) && !exactKeys(node, ['kind', 'items'])) throw new Error('Invalid view list.');
      if (!Array.isArray(node.items) || !node.items.length || node.items.length > 200) throw new Error('Invalid view list items.');
      return { kind: 'list', ...(node.ordered ? { ordered: true } : {}), items: node.items.map(item => validateSpans(item, budget)) };
    case 'badges':
      if (!exactKeys(node, ['kind', 'items']) || !Array.isArray(node.items) || !node.items.length || node.items.length > 40) throw new Error('Invalid view badges.');
      return { kind: 'badges', items: node.items.map(item => {
        if (!item || !exactKeys(item, ['label', 'tone']) && !exactKeys(item, ['label'])) throw new Error('Invalid view badge.');
        if (!plainText(item.label, 80) || (item.tone !== undefined && !TONES.includes(item.tone))) throw new Error('Invalid view badge.');
        return structuredClone(item);
      }) };
    case 'notice':
      if (!exactKeys(node, ['kind', 'tone', 'title', 'spans']) && !exactKeys(node, ['kind', 'tone', 'spans'])) throw new Error('Invalid view notice.');
      if (!TONES.includes(node.tone) || (node.title !== undefined && !plainText(node.title, 200))) throw new Error('Invalid view notice.');
      return { kind: 'notice', tone: node.tone, ...(node.title ? { title: node.title } : {}), spans: validateSpans(node.spans, budget) };
    case 'svg':
      // Accepted as a string only. The core sanitizer is still the thing that decides
      // what reaches the DOM; this check only bounds it and keeps the contract honest.
      if (!exactKeys(node, ['kind', 'svg', 'title', 'alt']) || typeof node.svg !== 'string'
        || !node.svg.trim().startsWith('<svg') || node.svg.length > LIMITS.viewSvgChars
        || !plainText(node.title, 200) || !plainText(node.alt, 1_000)) throw new Error('Invalid view svg.');
      return { kind: 'svg', svg: node.svg, title: node.title, alt: node.alt };
    case 'table': {
      if (!exactKeys(node, ['kind', 'caption', 'columns', 'rows']) && !exactKeys(node, ['kind', 'columns', 'rows'])) throw new Error('Invalid view table.');
      if (!Array.isArray(node.columns) || !node.columns.length || node.columns.length > LIMITS.viewTableColumns
        || !Array.isArray(node.rows) || node.rows.length > LIMITS.viewTableRows
        || (node.caption !== undefined && !plainText(node.caption, 300))) throw new Error('Invalid view table.');
      for (const column of node.columns) {
        if (!column || !exactKeys(column, ['label', 'align']) && !exactKeys(column, ['label'])
          || !plainText(column.label, 120) || (column.align !== undefined && !['start', 'end'].includes(column.align))) throw new Error('Invalid view table column.');
      }
      for (const row of node.rows) {
        if (!Array.isArray(row) || row.length !== node.columns.length
          || row.some(cell => cell !== null && typeof cell !== 'number' && (typeof cell !== 'string' || cell.length > 2_000))) throw new Error('Invalid view table row.');
      }
      budget.nodes += node.rows.length;
      if (budget.nodes > LIMITS.viewNodes + LIMITS.viewTableRows) throw new Error('View document is too large.');
      return structuredClone(node);
    }
    case 'code':
      if (!exactKeys(node, ['kind', 'language', 'text']) && !exactKeys(node, ['kind', 'text'])) throw new Error('Invalid view code block.');
      if (typeof node.text !== 'string' || !node.text.length || node.text.length > LIMITS.viewTextChars
        || (node.language !== undefined && !SLUG.test(node.language))) throw new Error('Invalid view code block.');
      return structuredClone(node);
    case 'links':
      if (!exactKeys(node, ['kind', 'items']) || !Array.isArray(node.items) || !node.items.length || node.items.length > 200) throw new Error('Invalid view links.');
      return { kind: 'links', items: node.items.map(item => {
        if (!item || !exactKeys(item, ['href', 'label', 'description']) && !exactKeys(item, ['href', 'label'])) throw new Error('Invalid view link.');
        assertHttps(item.href);
        if (!plainText(item.label, 300) || (item.description !== undefined && !plainText(item.description, 500))) throw new Error('Invalid view link.');
        return structuredClone(item);
      }) };
    case 'details':
      if (!exactKeys(node, ['kind', 'summary', 'children']) || !plainText(node.summary, 300)
        || !Array.isArray(node.children) || !node.children.length) throw new Error('Invalid view details block.');
      return { kind: 'details', summary: node.summary, children: node.children.map(child => validateNode(child, budget, depth + 1)) };
    case 'download':
      // Bytes are never inline: the worker stored an attachment first and refers to it.
      if (!exactKeys(node, ['kind', 'attachmentId', 'label', 'name', 'mimeType', 'bytes'])
        || !/^[a-z0-9][a-z0-9-]{7,63}$/.test(String(node.attachmentId)) || !plainText(node.label, 200)
        || !plainText(node.name, 200) || node.name.includes('/') || node.name.includes('\\')
        || !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(String(node.mimeType))
        || !Number.isInteger(node.bytes) || node.bytes < 0) throw new Error('Invalid view download.');
      return structuredClone(node);
    case 'status':
      if (!exactKeys(node, ['kind', 'state', 'label', 'description']) && !exactKeys(node, ['kind', 'state', 'label'])) throw new Error('Invalid view status.');
      if (!['ok', 'pending', 'failed'].includes(node.state) || !plainText(node.label, 200)
        || (node.description !== undefined && !plainText(node.description, 500))) throw new Error('Invalid view status.');
      return structuredClone(node);
    default:
      throw new Error('Unsupported view node.');
  }
}

export function validateViewDocument(input: unknown): ViewDocumentV1 {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !exactKeys(input, ['schemaVersion', 'title', 'summary', 'nodes']) && !exactKeys(input, ['schemaVersion', 'summary', 'nodes'])) throw new Error('Invalid view document.');
  const value = input as ViewDocumentV1;
  if (value.schemaVersion !== 1 || !plainText(value.summary, 1_000)
    || (value.title !== undefined && !plainText(value.title, 300))
    || !Array.isArray(value.nodes) || !value.nodes.length) throw new Error('Invalid view document.');
  const budget = { nodes: 0 };
  return {
    schemaVersion: 1,
    ...(value.title ? { title: value.title } : {}),
    summary: value.summary,
    nodes: value.nodes.map(node => validateNode(node, budget, 0)),
  };
}

/** Plain-text reading of a view, used for accessibility fallbacks and for the projection
 *  a capability may hand back to the model. Drawings contribute their alt text, not markup. */
export function viewToText(document: ViewDocumentV1): string {
  const spans = (items: ViewSpan[]) => items.map(span => span.text).join('');
  const walk = (nodes: ViewNode[]): string[] => nodes.flatMap(node => {
    switch (node.kind) {
      case 'heading': return [`${'#'.repeat(node.level)} ${node.text}`];
      case 'paragraph': return [spans(node.spans)];
      case 'list': return node.items.map((item, index) => `${node.ordered ? `${index + 1}.` : '-'} ${spans(item)}`);
      case 'badges': return [node.items.map(item => item.label).join(' · ')];
      case 'notice': return [[node.title, spans(node.spans)].filter(Boolean).join(': ')];
      case 'svg': return [`[${node.title}] ${node.alt}`];
      case 'table': return [node.columns.map(column => column.label).join(' | '), ...node.rows.map(row => row.map(cell => cell ?? '').join(' | '))];
      case 'code': return [node.text];
      case 'links': return node.items.map(item => `${item.label}: ${item.href}`);
      case 'details': return [node.summary, ...walk(node.children)];
      case 'download': return [`${node.label} (${node.name}, ${node.bytes} bytes)`];
      case 'status': return [[node.label, node.description].filter(Boolean).join(' — ')];
    }
  });
  return [document.title, ...walk(document.nodes)].filter(Boolean).join('\n');
}
