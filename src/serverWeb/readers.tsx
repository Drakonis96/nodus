import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type ReaderProps = { value?: string; className?: string; onSelection?: (quote: string) => void; assetBaseUrl?: string };

/** Markdown is rendered through ReactMarkdown and never assigned to innerHTML. */
export function MarkdownReader({ value, className = '', onSelection, assetBaseUrl }: ReaderProps) {
  const captureSelection = () => {
    if (!onSelection) return;
    const selected = window.getSelection()?.toString().trim();
    if (selected) onSelection(selected.slice(0, 4000));
  };
  return (
    <div className={`markdown-reader ${className}`} onMouseUp={captureSelection} onKeyUp={captureSelection} data-testid="markdown-reader">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          img: ({ src, alt }) => {
            const safe = typeof src === 'string' && src.startsWith('assets/') && assetBaseUrl
              ? `${assetBaseUrl}${src.slice('assets/'.length).split('/').map(encodeURIComponent).join('/')}`
              : src;
            return <img src={safe} alt={alt || ''} loading="lazy" />;
          },
        }}
      >{value || 'No readable text was published for this document.'}</ReactMarkdown>
    </div>
  );
}

/** EPUB exports occasionally arrive as XHTML or as plain extracted text. Keep only text. */
export function normalizeEpubText(source: string): string {
  return source
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>|<\/h[1-6]\s*>|<\/li\s*>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}

export function SafeDocumentReader({ value, mime, sourceUrl, onSelection, assetBaseUrl }: { value?: string; mime?: string; sourceUrl?: string; onSelection?: (quote: string) => void; assetBaseUrl?: string }) {
  const normalized = useMemo(() => mime?.includes('epub') ? normalizeEpubText(value || '') : value || '', [mime, value]);
  if (mime?.includes('pdf') && sourceUrl) {
    return <iframe className="document-frame" title="PDF document" src={sourceUrl} sandbox="allow-same-origin" data-testid="pdf-reader" />;
  }
  if (mime?.startsWith('image/') && sourceUrl) {
    return <div className="image-reader"><img src={sourceUrl} alt="Published document" data-testid="image-reader" /></div>;
  }
  if (mime?.includes('markdown') || mime?.includes('text/markdown') || !mime) return <MarkdownReader value={normalized} onSelection={onSelection} assetBaseUrl={assetBaseUrl} />;
  return <pre className="text-reader" data-testid="text-reader">{normalized || 'This format has no inline readable text.'}</pre>;
}
