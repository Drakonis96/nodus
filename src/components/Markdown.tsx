import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const nodusUrlTransform = (value: string) => {
  if (value.startsWith('nodus://')) return value;
  return defaultUrlTransform(value);
};

/**
 * Renders AI-authored Markdown (tutor narration, chat answers). Links never navigate
 * the renderer: external links open in the user's browser via the safe `openExternal`
 * bridge, and `nodus://idea/<id>` / `nodus://work/<id>` citations fire `onCitation`
 * so the caller can open a source modal (NotebookLM-style).
 * react-markdown does not render raw HTML by default, so this is XSS-safe.
 */
export interface MarkdownCitation {
  kind: 'idea' | 'work';
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
                  title={`Abrir fuente: ${citation.kind === 'idea' ? 'idea' : 'documento'}`}
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
  return null;
}
