import { useMemo } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type ReaderProps = { value?: string; className?: string; onSelection?: (quote: string) => void; assetBaseUrl?: string; onNodusLink?: (href: string) => boolean | void };

function serverHrefForNodus(href: string): string | null {
  const encodedId = (raw: string): string | null => {
    try {
      const decoded = decodeURIComponent(raw);
      return decoded ? encodeURIComponent(decoded) : null;
    } catch {
      return null;
    }
  };
  const match = /^nodus:\/\/world\/(article|character|place|group|scene|rule|conflict|map)\/(.+)$/.exec(href);
  if (match) {
    const id = encodedId(match[2]);
    return id ? `/detail/encyclopedia/world-entries/${encodeURIComponent(`${match[1]}:${decodeURIComponent(id)}`)}` : null;
  }

  // Study documents and materials have dedicated published dossiers. Recordings
  // are a catalogue surface in Server (the media itself is never published), so
  // their durable link opens that surface without pretending a private recording
  // asset exists on the server.
  const study = /^nodus:\/\/study\/(doc|material|recording)\/([^?#]+)(?:\?([^#]*))?$/.exec(href);
  if (study) {
    const id = encodedId(study[2]);
    if (!id) return null;
    if (study[1] === 'doc') return `/detail/studyLibrary/study-docs/${id}`;
    if (study[1] === 'material') return `/detail/studyLibrary/study-materials/${id}`;
    const query = new URLSearchParams(study[3] || '');
    query.set('recording', decodeURIComponent(id));
    return `/view/studyRecordings?${query.toString()}`;
  }

  // Testimony identities remain private, but published interviews and contrasts
  // are navigable. Keep the original time/transcript query so a compatible reader
  // can restore the precise citation without weakening the publication boundary.
  const testimony = /^nodus:\/\/testimonios\/(interview|contrast|participant)\/([^?#]+)(?:\?([^#]*))?$/.exec(href);
  if (testimony) {
    if (testimony[1] === 'participant') return null;
    const id = encodedId(testimony[2]);
    if (!id) return null;
    const route = testimony[1] === 'interview'
      ? `/detail/testimonyInterviews/testimony-interviews/${id}`
      : `/detail/testimonyContrasts/testimony-contrasts/${id}`;
    return testimony[3] ? `${route}?${testimony[3]}` : route;
  }

  const primarySource = /^nodus:\/\/primary-source\/([^/?#]+)(?:\/excerpt\/([^/?#]+))?$/.exec(href);
  if (primarySource) {
    const itemId = encodedId(primarySource[1]);
    if (!itemId) return null;
    const excerptId = primarySource[2] ? encodedId(primarySource[2]) : null;
    return `/detail/archive/archive-items/${itemId}${excerptId ? `?excerpt=${excerptId}` : ''}`;
  }

  // Deep Research citations are ordinary Markdown links in the published report.
  // The desktop renderer resolves these through IPC; the server reader must keep
  // them actionable too instead of silently reducing them to plain text.
  const academic = /^nodus:\/\/(idea|work|gap|passage|theme|author)\/(.+)$/.exec(href);
  if (!academic) return null;
  const [, kind, rawId] = academic;
  const id = encodedId(rawId);
  if (!id) return null;
  const targets: Record<string, string> = {
    idea: `/detail/ideas/ideas/${id}`,
    work: `/detail/ideas/works/${id}`,
    author: `/detail/authors/authors/${id}`,
    gap: `/detail/research/gaps/${id}`,
    passage: `/detail/research/passages/${id}`,
    theme: `/detail/research/themes/${id}`,
  };
  return targets[kind] || null;
}

/** Markdown is rendered through ReactMarkdown and never assigned to innerHTML. */
export function MarkdownReader({ value, className = '', onSelection, assetBaseUrl, onNodusLink }: ReaderProps) {
  const captureSelection = () => {
    if (!onSelection) return;
    const selected = window.getSelection()?.toString().trim();
    if (selected) onSelection(selected.slice(0, 4000));
  };
  return (
    <div className={`markdown-reader ${className}`} onMouseUp={captureSelection} onKeyUp={captureSelection} data-testid="markdown-reader">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => url.startsWith('nodus://') ? url : defaultUrlTransform(url)}
        skipHtml
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith('nodus://')) {
              const internalHref = serverHrefForNodus(href);
              if (onNodusLink) return <button type="button" className="inline border-0 bg-transparent p-0 font-inherit text-indigo-600 underline decoration-indigo-400/60 underline-offset-2 hover:text-indigo-500 dark:text-indigo-300" onClick={() => { if (onNodusLink(href) === false && internalHref) window.location.assign(internalHref); }}>{children}</button>;
              return internalHref ? <a href={internalHref} className="text-indigo-600 underline decoration-indigo-400/60 underline-offset-2 hover:text-indigo-500 dark:text-indigo-300">{children}</a> : <span>{children}</span>;
            }
            return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
          },
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
