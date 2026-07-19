import { useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { CitationPreview } from '@shared/types';
import { t } from '../i18n';
import { VERIFY_DEBOUNCE_MS, planCitationVerification } from '../citationVerification';

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
  onStudyDocument,
  onStudyMaterial,
  onStudyRecording,
  onStudyEvidence,
  verify = true,
}: {
  content: string;
  className?: string;
  onCitation?: (citation: MarkdownCitation) => void;
  onStudyDocument?: (documentId: string) => void;
  onStudyMaterial?: (materialId: string) => void;
  onStudyRecording?: (recordingId: string, timestamp?: number | null) => void;
  onStudyEvidence?: (citationId: string) => void;
  /** Resolve each `nodus://` citation against the corpus and flag unresolved ones. */
  verify?: boolean;
}) {
  // Validity of each citation, keyed by `${kind}:${id}`. A key absent from the map
  // is still being checked (treated as neutral); `false` means it did not resolve.
  const [validity, setValidity] = useState<Record<string, boolean>>({});

  // Verification is deliberately deferred rather than run per render.
  //
  // While an answer streams, `content` grows by one delta at a time — dozens of
  // changes a second. Verifying on each of them fired an IPC round-trip whose
  // main-process handler runs a synchronous SQLite lookup *per citation*, and
  // since the citation list grows as the answer does, the total cost was
  // quadratic in the length of the answer. That starved the main process for
  // the whole duration of every cited response.
  //
  // Waiting for the content to settle collapses a whole stream into one call,
  // and skipping unchanged reference lists means edits that do not touch
  // citations cost nothing at all.
  const lastVerifiedRef = useRef<string>('');
  useEffect(() => {
    if (!verify) return;
    const plan = planCitationVerification(content, lastVerifiedRef.current);
    if (plan.action === 'skip') return;
    if (plan.action === 'clear') {
      lastVerifiedRef.current = '';
      setValidity((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }

    let on = true;
    const timer = setTimeout(() => {
      lastVerifiedRef.current = plan.key;
      void window.nodus.verifyCitations(plan.refs).then((map) => {
        if (on) setValidity(map);
      });
    }, VERIFY_DEBOUNCE_MS);
    return () => {
      on = false;
      clearTimeout(timer);
    };
  }, [content, verify]);

  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={nodusUrlTransform}
        components={{
          a: ({ href, children }) => {
            const studyMaterial = href?.match(/^nodus:\/\/study\/material\/([^?]+)(?:\?.*)?$/);
            if (studyMaterial && onStudyMaterial) {
              return <button className="text-teal-400 underline decoration-teal-700 underline-offset-2 hover:text-teal-300" onClick={() => onStudyMaterial(decodeURIComponent(studyMaterial[1]))}>{children}</button>;
            }
            const studyEvidence = href?.match(/^nodus:\/\/study\/evidence\/(.+)$/);
            if (studyEvidence && onStudyEvidence) {
              return <button className="mx-0.5 inline-flex rounded-full border border-teal-800 bg-teal-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-teal-300 hover:border-teal-500" onClick={() => onStudyEvidence(decodeURIComponent(studyEvidence[1]))}>{children}</button>;
            }
            const studyDocument = href?.match(/^nodus:\/\/study\/doc\/(.+)$/);
            if (studyDocument && onStudyDocument) {
              return <button className="text-indigo-400 underline decoration-indigo-700 underline-offset-2 hover:text-indigo-300" onClick={() => onStudyDocument(decodeURIComponent(studyDocument[1]))}>{children}</button>;
            }
            const studyRecording = href?.match(/^nodus:\/\/study\/recording\/([^?]+)(?:\?(.*))?$/);
            if (studyRecording && onStudyRecording) {
              const params = new URLSearchParams(studyRecording[2] ?? '');
              const timestamp = params.get('t');
              return <button className="text-teal-400 underline decoration-teal-700 underline-offset-2 hover:text-teal-300" onClick={() => onStudyRecording(decodeURIComponent(studyRecording[1]), timestamp == null ? null : Number(timestamp))}>{children}</button>;
            }
            const citation = parseCitation(href);
            if (citation && onCitation) {
              const key = `${citation.kind}:${citation.id}`;
              const unverified = verify && validity[key] === false;
              return (
                <CitationLink citation={citation} unverified={unverified} onCitation={onCitation}>
                  {children}
                </CitationLink>
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

/**
 * Inline citation pill with a hover-card. Hovering (after a short delay, so a
 * cursor merely passing over the text does not flash cards) lazily fetches a
 * lightweight preview — title, source and a snippet — positioned above or below
 * the pill. The card is `position: fixed` so it escapes the chat's scroll
 * clipping, and `pointer-events: none` so it never steals the hover. Clicking
 * still opens the full source modal via `onCitation`.
 */
function CitationLink({
  citation,
  unverified,
  onCitation,
  children,
}: {
  citation: MarkdownCitation;
  unverified: boolean;
  onCitation: (citation: MarkdownCitation) => void;
  children: ReactNode;
}) {
  const [preview, setPreview] = useState<CitationPreview | 'loading' | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'top' | 'bottom' } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<number | null>(null);
  const fetchedRef = useRef(false);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    []
  );

  const reveal = () => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const placement: 'top' | 'bottom' = rect.top > 240 ? 'top' : 'bottom';
    setPos({
      top: placement === 'top' ? rect.top - 8 : rect.bottom + 8,
      left: Math.min(Math.max(rect.left, 12), Math.max(12, window.innerWidth - 340)),
      placement,
    });
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      setPreview('loading');
      void window.nodus
        .getCitationPreview({ kind: citation.kind, id: citation.id })
        .then((value) => setPreview(value))
        .catch(() => setPreview(null));
    }
  };

  const onEnter = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(reveal, 320);
  };
  const onLeave = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setPos(null);
  };

  return (
    <span className="citation-wrap" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button
        ref={btnRef}
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
        {unverified && (
          <span aria-hidden className="citation-warn">
            ⚠
          </span>
        )}
      </button>
      {pos && preview !== null && (
        <span
          className="citation-card"
          data-placement={pos.placement}
          style={{ top: pos.top, left: pos.left }}
        >
          {preview === 'loading' ? (
            <span className="citation-card-loading">{t('Cargando…')}</span>
          ) : (
            <>
              <span className="citation-card-kind">{citationLabel(preview.kind)}</span>
              <span className="citation-card-title">{preview.title}</span>
              {preview.subtitle && <span className="citation-card-sub">{preview.subtitle}</span>}
              {preview.snippet && <span className="citation-card-snippet">{preview.snippet}</span>}
            </>
          )}
        </span>
      )}
    </span>
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
