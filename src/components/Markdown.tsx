import { useEffect, useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { CitationRef } from '@shared/types';
import { t } from '../i18n';

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
  kind: 'idea' | 'work' | 'gap' | 'contradiction' | 'passage';
  id: string;
}

export function Markdown({
  content,
  className = '',
  onCitation,
  verify = true,
}: {
  content: string;
  className?: string;
  onCitation?: (citation: MarkdownCitation) => void;
  /** Resolve each `nodus://` citation against the corpus and flag unresolved ones. */
  verify?: boolean;
}) {
  // Validity of each citation, keyed by `${kind}:${id}`. A key absent from the map
  // is still being checked (treated as neutral); `false` means it did not resolve.
  const [validity, setValidity] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!verify) return;
    const refs = collectCitations(content);
    if (refs.length === 0) {
      setValidity({});
      return;
    }
    let on = true;
    void window.nodus.verifyCitations(refs).then((map) => {
      if (on) setValidity(map);
    });
    return () => {
      on = false;
    };
  }, [content, verify]);

  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={nodusUrlTransform}
        components={{
          a: ({ href, children }) => {
            const citation = parseCitation(href);
            if (citation && onCitation) {
              const key = `${citation.kind}:${citation.id}`;
              const unverified = verify && validity[key] === false;
              return (
                <button
                  type="button"
                  className="citation-link"
                  data-citation-kind={citation.kind}
                  data-verified={unverified ? 'false' : undefined}
                  title={
                    unverified
                      ? t('Fuente no encontrada: esta cita no se pudo verificar en el corpus.')
                      : `${t('Abrir fuente:')} ${citationLabel(citation.kind)}`
                  }
                  onClick={(e) => {
                    e.preventDefault();
                    onCitation(citation);
                  }}
                >
                  {children}
                  {unverified && <span aria-hidden className="citation-warn">⚠</span>}
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

/** Find every distinct `nodus://kind/id` citation referenced in the markdown. */
function collectCitations(content: string): CitationRef[] {
  const refs: CitationRef[] = [];
  const seen = new Set<string>();
  const re = /nodus:\/\/(idea|work|gap|contradiction|passage)\/([^\s)"'<>]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const kind = m[1] as CitationRef['kind'];
    const id = decodeURIComponent(m[2]);
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ kind, id });
  }
  return refs;
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
  const passage = href.match(/^nodus:\/\/passage\/(.+)$/);
  if (passage) return { kind: 'passage', id: decodeURIComponent(passage[1]) };
  return null;
}

function citationLabel(kind: MarkdownCitation['kind']): string {
  switch (kind) {
    case 'idea':
      return t('idea');
    case 'work':
      return t('documento');
    case 'gap':
      return t('hueco de investigación');
    case 'contradiction':
      return t('contradicción');
    case 'passage':
      return t('pasaje');
  }
}
