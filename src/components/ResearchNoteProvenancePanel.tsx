import { useState } from 'react';
import type { Note, NoteResearchChatSource, NoteResearchReference } from '@shared/types';
import { parsePrimarySourceExcerptDeepLink } from '@shared/primarySourceDeepLink';
import { Icon, modelLabel } from './ui';
import { SourceCitationModal, type CitationTarget } from './SourceCitationModal';
import { t } from '../i18n';

interface Props {
  note: Note;
  onOpenConversation?: (source: NoteResearchChatSource) => void;
  onOpenStudyDocument?: (id: string) => void;
  onOpenStudyMaterial?: (id: string) => void;
  onOpenStudyRecording?: (id: string, timestamp?: number | null) => void;
  onOpenWorldEntry?: (kind: string, id: string) => void;
}

const SURFACE_LABEL: Record<NoteResearchChatSource['surface'], string> = {
  research: 'Research chat',
  database: 'Research chat de bases de datos',
  study: 'Research chat de estudio',
  world: 'Research chat del mundo',
};

function academicCitation(href: string): CitationTarget {
  for (const kind of ['idea', 'work', 'gap', 'contradiction', 'passage'] as const) {
    const match = href.match(new RegExp(`^nodus://${kind}/(.+)$`));
    if (match) return { kind, id: decodeURIComponent(match[1]) };
  }
  return null;
}

/** Read-only metadata: editing the note body never erases where the capture came from. */
export function ResearchNoteProvenancePanel({
  note,
  onOpenConversation,
  onOpenStudyDocument,
  onOpenStudyMaterial,
  onOpenStudyRecording,
  onOpenWorldEntry,
}: Props) {
  const [citation, setCitation] = useState<CitationTarget>(null);
  const source = note.source?.researchChat;
  if (!source) return null;
  const references = source.references ?? [];

  const openReference = (reference: NoteResearchReference): boolean => {
    const href = reference.href;
    if (!href) return false;
    if (/^https?:\/\//i.test(href)) {
      void window.nodus.openExternal(href);
      return true;
    }
    const document = href.match(/^nodus:\/\/study\/doc\/(.+)$/);
    if (document && onOpenStudyDocument) { onOpenStudyDocument(decodeURIComponent(document[1])); return true; }
    const material = href.match(/^nodus:\/\/study\/material\/([^?]+)/);
    if (material && onOpenStudyMaterial) { onOpenStudyMaterial(decodeURIComponent(material[1])); return true; }
    const recording = href.match(/^nodus:\/\/study\/recording\/([^?]+)(?:\?(.*))?$/);
    if (recording && onOpenStudyRecording) {
      const timestamp = new URLSearchParams(recording[2] ?? '').get('t');
      onOpenStudyRecording(decodeURIComponent(recording[1]), timestamp == null ? null : Number(timestamp));
      return true;
    }
    const world = href.match(/^nodus:\/\/world\/([a-z]+)\/(.+)$/);
    if (world && onOpenWorldEntry) { onOpenWorldEntry(world[1], decodeURIComponent(world[2])); return true; }
    const primarySource = parsePrimarySourceExcerptDeepLink(href);
    if (primarySource) {
      window.dispatchEvent(new CustomEvent('nodus:navigate-primary-source', { detail: primarySource }));
      return true;
    }
    const academic = academicCitation(href);
    if (academic) { setCitation(academic); return true; }
    return false;
  };

  return (
    <section data-testid="research-note-provenance" className="border-t border-neutral-800 px-3 py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
        <Icon name="info" size={12} />
        {t('Procedencia')}
      </div>
      <dl className="mt-2 space-y-1.5 text-[11px]">
        <div><dt className="text-neutral-600">{t('Origen')}</dt><dd className="text-neutral-300">{t(SURFACE_LABEL[source.surface])}</dd></div>
        <div><dt className="text-neutral-600">{t('Conversación')}</dt><dd className="break-words text-neutral-300">{source.conversationTitle}</dd></div>
        <div><dt className="text-neutral-600">{t('Guardada')}</dt><dd className="text-neutral-300">{new Date(note.createdAt).toLocaleString()}</dd></div>
        {note.source?.model && <div><dt className="text-neutral-600">{t('Modelo')}</dt><dd className="break-words text-neutral-300">{modelLabel(note.source.model)}</dd></div>}
      </dl>
      {onOpenConversation && (
        <button data-testid="research-note-open-conversation" className="btn btn-ghost mt-3 w-full text-xs" onClick={() => onOpenConversation(source)}>
          <Icon name="chat" size={13} /> {t('Volver a la conversación')}
        </button>
      )}
      {references.length > 0 && (
        <div className="mt-3 space-y-2">
          <b className="text-[10px] uppercase tracking-wider text-neutral-500">{t('Fuentes citadas')}</b>
          {references.map((reference, index) => {
            const interactive = Boolean(reference.href);
            return (
              <article key={`${reference.citationId ?? reference.href ?? reference.label}:${index}`} className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-2">
                <button
                  type="button"
                  className={`w-full text-left text-[11px] font-medium ${interactive ? 'hover:text-indigo-300' : 'cursor-default text-neutral-300'}`}
                  onClick={() => openReference(reference)}
                  disabled={!interactive}
                >
                  {reference.citationId ? `${reference.citationId} · ` : ''}{reference.label}
                </button>
                {reference.subtitle && <p className="mt-1 text-[9px] leading-4 text-neutral-500">{reference.subtitle}</p>}
                {reference.quote && <p className="mt-2 line-clamp-4 border-l-2 border-indigo-700 pl-2 text-[10px] leading-4 text-neutral-400">“{reference.quote}”</p>}
              </article>
            );
          })}
        </div>
      )}
      {citation && <SourceCitationModal target={citation} onClose={() => setCitation(null)} />}
    </section>
  );
}
