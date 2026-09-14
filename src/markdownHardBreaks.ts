/**
 * CommonMark treats a single newline as a soft break and renders it as a space.
 * Study content predates Markdown rendering: an answer or explanation typed over
 * several lines used to keep those lines because the surface applied
 * `whitespace-pre-wrap`. This remark plugin preserves that behavior — every soft
 * break inside a flow node becomes a real `<br />` — while still allowing blank
 * lines, lists, tables and the rest of Markdown.
 *
 * Only `text` nodes are touched, so `inlineMath`, code and every other literal
 * value stay exactly as written.
 */
interface MarkdownNode {
  type?: string;
  value?: string;
  children?: MarkdownNode[];
}

export function remarkHardBreaks() {
  return (tree: MarkdownNode) => {
    convertSoftBreaks(tree);
  };
}

function convertSoftBreaks(node: MarkdownNode): void {
  if (!Array.isArray(node.children)) return;
  const next: MarkdownNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string' && child.value.includes('\n')) {
      const lines = child.value.split('\n');
      lines.forEach((line, index) => {
        if (index > 0) next.push({ type: 'break' });
        if (line) next.push({ type: 'text', value: line });
      });
      continue;
    }
    convertSoftBreaks(child);
    next.push(child);
  }
  node.children = next;
}
