/**
 * LaTeX in a complete study guide must render in the reader, the PDF and Word. Every
 * formula is parsed with KaTeX (plus mhchem for chemistry) before the guide is saved;
 * the ones that fail are repaired or shown as code, never printed as broken math.
 */
import katex from 'katex';
import 'katex/contrib/mhchem';

export interface MathSpan { start: number; end: number; tex: string; display: boolean }

/** `$$…$$` and `$…$` spans outside code, ignoring escaped dollars and prices. */
export function findMath(markdown: string): MathSpan[] {
  const spans: MathSpan[] = [];
  const code = [...markdown.matchAll(/```[\s\S]*?```|`[^`\n]*`/g)].map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length]);
  const inCode = (index: number) => code.some(([from, to]) => index >= from && index < to);
  const pattern = /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$|(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<![\s\\])\$(?![\d$])/g;
  for (const match of markdown.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (inCode(start)) continue;
    const display = match[1] !== undefined;
    spans.push({ start, end: start + match[0].length, tex: (display ? match[1] : match[2]).trim(), display });
  }
  return spans;
}

/** A `$` outside every formula: a cut or half-written formula that would print raw. */
export function strayDollar(markdown: string): boolean {
  let rest = markdown.replace(/```[\s\S]*?```|`[^`\n]*`/g, ' ');
  for (const span of findMath(rest).reverse()) rest = `${rest.slice(0, span.start)} ${rest.slice(span.end)}`;
  return /(?<!\\)\$/.test(rest);
}

/** Cut text to at most `max` characters (plus an ellipsis) without splitting a formula. */
export function truncateOutsideMath(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = max;
  for (const span of findMath(text)) if (span.start < cut && span.end > cut) cut = span.start;
  return `${text.slice(0, cut).trimEnd()}…`;
}

export function latexError(tex: string, display = false): string | null {
  try {
    katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore', trust: false, output: 'mathml' });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 200) : String(error);
  }
}

export function invalidMath(markdown: string): Array<MathSpan & { error: string }> {
  return findMath(markdown).flatMap((span) => {
    const error = latexError(span.tex, span.display);
    return error ? [{ ...span, error }] : [];
  });
}

/** Replace formulas that still fail with inline code, so nothing prints as garbage. */
export function neutralizeInvalidMath(markdown: string): { markdown: string; neutralized: number } {
  const invalid = invalidMath(markdown);
  let result = markdown;
  for (const span of [...invalid].reverse()) {
    const code = span.tex.replace(/`/g, "'");
    result = `${result.slice(0, span.start)}${span.display ? `\n\`\`\`latex\n${code}\n\`\`\`\n` : `\`${code}\``}${result.slice(span.end)}`;
  }
  return { markdown: result, neutralized: invalid.length };
}
