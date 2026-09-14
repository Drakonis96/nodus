import { memo, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { normalizeLatexDelimiters } from '@shared/latexDelimiters';
import { remarkHardBreaks } from '../markdownHardBreaks';

/**
 * Markdown + LaTeX rendering for questions, options, answers and flashcards.
 *
 * The canonical `Markdown` component also carries citation verification, document
 * figures and deep-link handlers, none of which belong in an exam prompt — the
 * verification alone fires one IPC round-trip per cited string. This renderer keeps
 * the same parser plugins and safety posture (react-markdown never emits raw HTML,
 * URLs pass the default transform) so study content typesets exactly like the rest
 * of the app without paying for the citation machinery.
 *
 * `\(…\)` and `\[…\]` are normalized to `$…$`/`$$…$$` before parsing, because both
 * teachers and language models write LaTeX that way.
 */
const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkHardBreaks];
const REHYPE_PLUGINS = [rehypeKatex];

const safeUrlTransform = (value: string) => {
  if (value.startsWith('nodus://')) return value;
  return defaultUrlTransform(value);
};

function ExternalLink({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(event) => {
        if (!href || href.startsWith('#')) return;
        event.preventDefault();
        void window.nodus.openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

export const StudyMarkdown = memo(function StudyMarkdown({ content, className = '' }: { content: string; className?: string }) {
  return (
    <div className={`md study-markdown ${className}`}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        urlTransform={safeUrlTransform}
        components={{ a: ExternalLink }}
      >
        {normalizeLatexDelimiters(content)}
      </ReactMarkdown>
    </div>
  );
});

/** Compact variant for options, list rows and table cells: paragraphs are unwrapped
 *  so inline formatting and formulas flow with the surrounding line. */
export const StudyMarkdownInline = memo(function StudyMarkdownInline({ content, className = '' }: { content: string; className?: string }) {
  return (
    <span className={`md study-markdown study-markdown-inline ${className}`}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        urlTransform={safeUrlTransform}
        components={{
          a: ExternalLink,
          p: ({ children }) => <>{children}</>,
        }}
      >
        {normalizeLatexDelimiters(content)}
      </ReactMarkdown>
    </span>
  );
});
