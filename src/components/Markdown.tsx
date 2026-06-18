import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const nodusUrlTransform = (value: string) => {
  if (value.startsWith('nodus://')) return value;
  return defaultUrlTransform(value);
};

/**
 * Renders AI-authored Markdown (tutor narration, chat answers). Links never navigate
 * the renderer: external links open in the user's browser via the safe `openExternal`
 * bridge, and `nodus://...` citations fire `onCitation` so the caller can open
 * source details or route to the graph (NotebookLM-style).
 * react-markdown does not render raw HTML by default, so this is XSS-safe.
 */
export interface MarkdownCitation {
  kind: 'idea' | 'work' | 'gap' | 'contradiction';
  id: string;
}

export function Markdown({
  content,
  className = '',
  onCitation,
}: {
  content: string;
  className?: string;
  onCitation?: (citation: MarkdownCitation) => void;
}) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={nodusUrlTransform}
        components={{
          a: ({ href, children }) => {
            const citation = parseCitation(href);
            if (citation && onCitation) {
              return (
                <button
                  type="button"
                  className="citation-link"
                  data-citation-kind={citation.kind}
                  title={`Abrir fuente: ${citationLabel(citation.kind)}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onCitation(citation);
                  }}
                >
                  {children}
                </button>
              );
            }
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  if (href) void window.nodus.openExternal(href);
                }}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function parseCitation(href: string | undefined): MarkdownCitation | null {
  if (!href) return null;
  const idea = href.match(/^nodus:\/\/idea\/(.+)$/);
  if (idea) return { kind: 'idea', id: decodeURIComponent(idea[1]) };
  const work = href.match(/^nodus:\/\/work\/(.+)$/);
  if (work) return { kind: 'work', id: decodeURIComponent(work[1]) };
  const gap = href.match(/^nodus:\/\/gap\/(.+)$/);
  if (gap) return { kind: 'gap', id: decodeURIComponent(gap[1]) };
  const contradiction = href.match(/^nodus:\/\/contradiction\/(.+)$/);
  if (contradiction) return { kind: 'contradiction', id: decodeURIComponent(contradiction[1]) };
  return null;
}

function citationLabel(kind: MarkdownCitation['kind']): string {
  switch (kind) {
    case 'idea':
      return 'idea';
    case 'work':
      return 'documento';
    case 'gap':
      return 'hueco de investigación';
    case 'contradiction':
      return 'contradicción';
  }
}
