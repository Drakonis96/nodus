import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders AI-authored Markdown (tutor narration, chat answers). Links never navigate
 * the renderer: they open in the user's browser via the safe `openExternal` bridge.
 * react-markdown does not render raw HTML by default, so this is XSS-safe.
 */
export function Markdown({ content, className = '' }: { content: string; className?: string }) {
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href) void window.nodus.openExternal(href);
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
