export interface MarkdownHastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: MarkdownHastNode[];
}

const NODUS_CITATION_HREF = /^nodus:\/\/(?:idea|work|gap|contradiction|passage|reader)\//;
const OPENING_CITATION_PARENTHESIS = /\(\s*$/u;
const CLOSING_CITATION_PARENTHESIS = /^\s*\)/u;

/**
 * Keep a parenthesized citation's punctuation and pill in the same inline box.
 * Markdown parses `([Author](nodus://idea/id))` as three siblings, which lets the
 * browser leave either parenthesis behind when a line wraps.
 */
export function groupParenthesizedCitations(tree: MarkdownHastNode): void {
  const children = tree.children;
  if (!children) return;

  // Visit the existing descendants first. A group created below must not be
  // visited again, or its deliberately adjacent parentheses would be rewrapped.
  for (const child of children) groupParenthesizedCitations(child);

  for (let index = 1; index < children.length - 1; index += 1) {
    const previous = children[index - 1];
    const citation = children[index];
    const next = children[index + 1];
    const href = citation.type === 'element' && citation.tagName === 'a'
      ? citation.properties?.href
      : undefined;
    if (
      previous.type !== 'text'
      || next.type !== 'text'
      || typeof previous.value !== 'string'
      || typeof next.value !== 'string'
      || typeof href !== 'string'
      || !NODUS_CITATION_HREF.test(href)
    ) continue;

    const opening = previous.value.match(OPENING_CITATION_PARENTHESIS)?.[0];
    const closing = next.value.match(CLOSING_CITATION_PARENTHESIS)?.[0];
    if (!opening || !closing) continue;

    previous.value = previous.value.slice(0, -opening.length);
    next.value = next.value.slice(closing.length);
    children[index] = {
      type: 'element',
      tagName: 'span',
      properties: { className: ['citation-group'] },
      children: [
        { type: 'text', value: opening },
        citation,
        { type: 'text', value: closing },
      ],
    };
  }
}

export const rehypeGroupParenthesizedCitations = () => groupParenthesizedCitations;
