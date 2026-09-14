/**
 * remark-math only understands `$…$` and `$$…$$`, but both authors and language
 * models commonly write LaTeX with the `\(…\)` (inline) and `\[…\]` (display)
 * delimiters. Every renderer in Nodus — the desktop Markdown component, the Server
 * Web reader and the printable exam document — funnels content through this helper
 * so the same question typesets identically everywhere.
 *
 * The rewrite never touches fenced code blocks or inline code spans: a literal
 * `\(x\)` inside a code block must stay literal.
 */
export function normalizeLatexDelimiters(source: string): string {
  if (!source || (!source.includes('\\(') && !source.includes('\\['))) return source;
  const preserved: string[] = [];
  const placeholder = (index: number) => `\uE000${index}\uE000`;

  // Fenced code first (it may contain inline backticks), then inline spans. The
  // fence opener allows up to three leading spaces, as CommonMark does; the closer
  // only has to repeat the fence character.
  let masked = source.replace(
    /(^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\2[ \t]*$)/gm,
    (block) => placeholder(preserved.push(block) - 1)
  );
  masked = masked.replace(/(`+)([\s\S]*?)\1/g, (span) => placeholder(preserved.push(span) - 1));

  masked = masked.replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, (_match, body: string) => `$$${body}$$`);
  masked = masked.replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, (_match, body: string) => `$${body}$`);

  return masked.replace(/\uE000(\d+)\uE000/g, (_match, index: string) => preserved[Number(index)] ?? '');
}
