/**
 * Remark plugin for the Obsidian-style callouts a complete study guide writes:
 *
 *   > [!definition] Definición · Presión
 *   > Fuerza por unidad de superficie.
 *
 * The blockquote becomes `<aside class="guide-callout guide-callout-definition">`
 * with its first line as a title. Only the callout kinds the guide renderer emits are
 * recognized, so an ordinary quotation that happens to start with brackets is left
 * alone. The label text itself was written by code, never by the model.
 */
export const GUIDE_CALLOUT_KINDS = new Set([
  'definition', 'formula', 'rule', 'procedure', 'example', 'ai-example', 'ai-analogy',
  'mistake', 'ai-mistake', 'memorize', 'selfcheck', 'web',
]);

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

const MARKER = /^\[!([a-z][a-z-]*)\][ \t]*([^\n]*)(?:\n|$)/;

function transform(node: MdNode): void {
  for (const child of node.children ?? []) transform(child);
  if (node.type !== 'blockquote') return;
  const paragraph = node.children?.[0];
  const text = paragraph?.type === 'paragraph' ? paragraph.children?.[0] : undefined;
  if (!paragraph || text?.type !== 'text' || !text.value) return;
  const match = text.value.match(MARKER);
  if (!match || !GUIDE_CALLOUT_KINDS.has(match[1])) return;
  const kind = match[1];
  text.value = text.value.slice(match[0].length);
  if (!text.value) paragraph.children = paragraph.children!.slice(1);
  if (paragraph.children?.[0]?.type === 'break') paragraph.children = paragraph.children.slice(1);
  const rest = paragraph.children?.length ? node.children! : node.children!.slice(1);
  node.children = [
    { type: 'paragraph', children: [{ type: 'text', value: match[2].trim() }], data: { hName: 'div', hProperties: { className: ['guide-callout-title'] } } },
    ...rest,
  ];
  node.data = { ...(node.data ?? {}), hName: 'aside', hProperties: { className: ['guide-callout', `guide-callout-${kind}`], 'data-callout': kind } };
}

export function remarkGuideCallouts() {
  return (tree: MdNode) => transform(tree);
}
