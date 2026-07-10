import { useState } from 'react';
import type { DecorativeImageStyle, WritingWorkshopBrief, WritingWorkshopDraft, WritingWorkshopSavedDraft } from '@shared/types';
import { Badge, Icon } from '../components/ui';
import { Markdown, type MarkdownCitation } from '../components/Markdown';
import type { CitationTarget } from '../components/SourceCitationModal';
import { useDismissableLayer } from '../hooks';
import { t, tx } from '../i18n';
import { DecorativeImageCard } from '../components/DecorativeImageCard';

/** Human labels for every workshop/report kind (deep reports use `deep_research`). */
export const KIND_LABELS: Record<WritingWorkshopBrief['kind'], string> = {
  literature_review: 'Estado de la cuestión',
  theoretical_framework: 'Marco teórico',
  debate: 'Debate entre autores',
  gap_justification: 'Justificación de hueco',
  chapter_section: 'Apartado de capítulo',
  research_question: 'Pregunta / hipótesis',
  deep_research: 'Deep Research',
};

/** The copy/save/export action row. Reusable so the Deep Research reader can host
 *  it in its header instead of above the text. */
export function DraftActionBar({
  exporting,
  savingDraft,
  draftSaved = false,
  onCopy,
  onSaveDraft,
  onSaveToNotes,
  onExport,
}: {
  exporting: boolean;
  savingDraft: boolean;
  draftSaved?: boolean;
  onCopy: () => void;
  onSaveDraft: () => void;
  onSaveToNotes: () => void;
  onExport: (format: 'markdown' | 'pdf') => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={onCopy}>
        <Icon name="check" /> {t('Copiar')}
      </button>
      <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={onSaveDraft} disabled={savingDraft || draftSaved}>
        <Icon name={savingDraft ? 'sync' : draftSaved ? 'check' : 'save'} className={savingDraft ? 'animate-spin' : ''} />{' '}
        {savingDraft ? t('Guardando…') : draftSaved ? t('Guardado') : t('Guardar borrador')}
      </button>
      <button className="btn btn-ghost border border-neutral-700 gap-1.5" onClick={onSaveToNotes}>
        <Icon name="notebook" /> {t('Guardar en notas')}
      </button>
      <ExportMenu exporting={exporting} onExport={onExport} />
    </div>
  );
}

/** Main draft/report display: title, actions (copy/save/export) and rendered markdown. */
export function DraftResultMain({
  draft,
  exporting,
  savingDraft,
  draftSaved = false,
  hideActions = false,
  justify = false,
  onCopy,
  onSaveDraft,
  onSaveToNotes,
  onExport,
  onCitation,
}: {
  draft: WritingWorkshopDraft;
  exporting: boolean;
  savingDraft: boolean;
  /** Deep Research auto-saves completed background reports. */
  draftSaved?: boolean;
  /** The reader hosts the action bar in its header, so it hides the inline one. */
  hideActions?: boolean;
  /** Justify the rendered report body. */
  justify?: boolean;
  onCopy: () => void;
  onSaveDraft: () => void;
  onSaveToNotes: () => void;
  onExport: (format: 'markdown' | 'pdf') => void;
  onCitation: (citation: MarkdownCitation) => void;
}) {
  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="space-y-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold break-words">{draft.title}</h2>
          {draft.abstract && <p className={`text-sm text-neutral-400 mt-1 ${justify ? 'text-justify' : ''}`}>{draft.abstract}</p>}
        </div>
        {!hideActions && (
          <DraftActionBar
            exporting={exporting}
            savingDraft={savingDraft}
            draftSaved={draftSaved}
            onCopy={onCopy}
            onSaveDraft={onSaveDraft}
            onSaveToNotes={onSaveToNotes}
            onExport={onExport}
          />
        )}
      </div>
      <section className="card p-4">
        <h3 className="font-semibold mb-3">{t('Esquema')}</h3>
        <div className="space-y-3">
          {draft.outline.map((section, index) => (
            <div key={section.id} className="border-l-2 border-indigo-700 pl-3">
              <div className="font-medium text-sm">
                {index + 1}. {section.title}
              </div>
              <p className="text-xs text-neutral-400 mt-1">{section.purpose}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {section.sources.slice(0, 6).map((source, i) => (
                  <Badge key={`${section.id}-${i}`}>{source.replace(/\[|\]|\(.+\)/g, '')}</Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className={`card p-4 ${justify ? 'text-justify hyphens-auto' : ''}`}>
        <Markdown content={draft.draftMarkdown} onCitation={onCitation} />
      </section>
    </div>
  );
}

function ExportMenu({ exporting, onExport }: { exporting: boolean; onExport: (format: 'markdown' | 'pdf') => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useDismissableLayer<HTMLDivElement>({ open, onDismiss: () => setOpen(false) });
  const choose = (format: 'markdown' | 'pdf') => {
    setOpen(false);
    onExport(format);
  };
  return (
    <div className="relative" ref={menuRef}>
      <button className="btn btn-primary gap-1.5" onClick={() => setOpen((value) => !value)} disabled={exporting}>
        <Icon name={exporting ? 'sync' : 'download'} className={exporting ? 'animate-spin' : ''} /> {t('Exportar')}
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-neutral-700 bg-neutral-900 shadow-xl py-1">
          <button className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-800 flex items-center gap-2" onClick={() => choose('markdown')}>
            <Icon name="code" size={14} /> {t('Markdown (.md)')}
          </button>
          <button className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-800 flex items-center gap-2" onClick={() => choose('pdf')}>
            <Icon name="download" size={14} /> {t('PDF (.pdf)')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Right-hand support matrix for a generated draft/report. */
export function SupportMatrix({
  draft,
  onCitation,
}: {
  draft: WritingWorkshopDraft | null;
  onCitation: (target: CitationTarget) => void;
}) {
  return (
    <>
      <h2 className="font-semibold text-sm mb-3">{t('Matriz de apoyo')}</h2>
      {!draft && <div className="text-sm text-neutral-500">{t('Sin matriz todavía.')}</div>}
      {draft && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <Metric label={t('Ideas')} value={draft.stats.selectedIdeas} />
            <Metric label={t('Huecos')} value={draft.stats.selectedGaps} />
            <Metric label={t('Obras')} value={draft.stats.selectedWorks} />
            <Metric label={t('Pasajes')} value={draft.stats.selectedPassages} />
            <Metric label={t('Contexto')} value={formatChars(draft.stats.contextChars)} />
          </div>
          {draft.matrix.map((row, index) => (
            <div key={index} className="card p-3">
              <div className="flex items-center gap-2 mb-1">
                <Badge color={matrixColor(row.role)}>{row.role}</Badge>
                <span className="text-xs text-neutral-500 truncate">{row.sourceLabel}</span>
              </div>
              <p className="text-sm text-neutral-200">{row.claim}</p>
              {row.evidence && <p className="text-xs text-neutral-500 mt-1">{row.evidence}</p>}
              <div className="flex items-center gap-2 mt-2">
                {row.citation && (
                  <button className="text-xs text-indigo-300 hover:underline" onClick={() => openMatrixCitation(row.citation, onCitation)}>
                    {t('abrir fuente')}
                  </button>
                )}
                {row.notes && <span className="text-xs text-neutral-600">{row.notes}</span>}
              </div>
            </div>
          ))}
          <PanelList title={t('Siguientes pasos')} items={draft.nextSteps} />
          <PanelList title={t('Limitaciones')} items={draft.limitations} />
          <PanelList title={t('Bibliografía')} items={draft.bibliography} />
        </div>
      )}
    </>
  );
}

export function SavedDraftsPanel({
  drafts,
  loading,
  reusingDraftId,
  onOpen,
  onReuse,
  onDelete,
  onRefresh,
  imageStyle = 'antique_book',
}: {
  drafts: WritingWorkshopSavedDraft[];
  loading: boolean;
  reusingDraftId: string | null;
  onOpen: (draft: WritingWorkshopSavedDraft) => void;
  onReuse: (draft: WritingWorkshopSavedDraft) => void;
  onDelete: (draft: WritingWorkshopSavedDraft) => void;
  onRefresh: () => void;
  imageStyle?: DecorativeImageStyle;
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="font-semibold text-sm">{t('Borradores guardados')}</h2>
          <p className="text-xs text-neutral-500 mt-0.5">{tx('{n} guardado(s) en este dispositivo', { n: drafts.length })}</p>
        </div>
        <button className="btn btn-ghost px-2 py-1 gap-1" onClick={onRefresh} disabled={loading} title={t('Actualizar borradores')}>
          <Icon name="refresh" size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-neutral-500">{t('Cargando borradores…')}</div>
      ) : drafts.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-800 px-3 py-4 text-sm leading-5 text-neutral-500">
          {t('Aún no hay borradores guardados. Genera uno y guárdalo para volver a abrirlo o reutilizar su prompt más adelante.')}
        </div>
      ) : (
        <div className="space-y-2">
          {drafts.map((saved) => {
            const isReusing = reusingDraftId === saved.id;
            return (
              <div key={saved.id} className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                {saved.brief.kind === 'deep_research' && (
                  <DecorativeImageCard
                    entityKind="deep_research"
                    entityId={saved.id}
                    image={saved.image}
                    defaultStyle={imageStyle}
                    thumbnail
                    className="mb-3"
                  />
                )}
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium leading-5 line-clamp-2">{saved.title}</div>
                    <div className="mt-1 text-[11px] text-neutral-500">
                      {t(KIND_LABELS[saved.brief.kind])} · {formatSavedDraftDate(saved.updatedAt)}
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost px-1.5 py-1 text-red-400 hover:text-red-300"
                    onClick={() => onDelete(saved)}
                    title={t('Eliminar borrador guardado')}
                    aria-label={`${t('Eliminar borrador guardado')}: ${saved.title}`}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
                {saved.brief.objective && <p className="mt-2 text-xs leading-5 text-neutral-500 line-clamp-3">{saved.brief.objective}</p>}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="btn btn-ghost border border-neutral-700 px-2 py-1.5 text-xs gap-1" onClick={() => onOpen(saved)}>
                    <Icon name="edit" size={13} /> {t('Abrir')}
                  </button>
                  <button
                    className="btn btn-primary px-2 py-1.5 text-xs gap-1"
                    onClick={() => onReuse(saved)}
                    disabled={reusingDraftId !== null}
                  >
                    <Icon name={isReusing ? 'sync' : 'refresh'} size={13} className={isReusing ? 'animate-spin' : ''} />
                    {isReusing ? t('Preparando…') : t('Reutilizar prompt')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-neutral-800 px-2 py-1.5">
      <div className="text-[11px] text-neutral-500">{label}</div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  );
}

export function PanelList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="pt-3 border-t border-neutral-800">
      <h3 className="font-semibold text-sm mb-2">{title}</h3>
      <ul className="space-y-1 text-xs text-neutral-400">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function matrixColor(role: WritingWorkshopDraft['matrix'][number]['role']): 'neutral' | 'indigo' | 'green' | 'amber' | 'red' | 'cyan' {
  switch (role) {
    case 'contrast':
      return 'red';
    case 'gap':
      return 'amber';
    case 'method':
      return 'cyan';
    case 'definition':
      return 'indigo';
    case 'context':
      return 'neutral';
    case 'support':
      return 'green';
  }
}

export function openMatrixCitation(value: string, setCitation: (target: CitationTarget) => void) {
  const citation = parseNodusCitation(value);
  if (citation) setCitation(citation);
}

export function parseNodusCitation(value: string): Exclude<CitationTarget, null> | null {
  const idea = value.match(/^nodus:\/\/idea\/(.+)$/);
  if (idea) return { kind: 'idea', id: decodeURIComponent(idea[1]) };
  const work = value.match(/^nodus:\/\/work\/(.+)$/);
  if (work) return { kind: 'work', id: decodeURIComponent(work[1]) };
  const gap = value.match(/^nodus:\/\/gap\/(.+)$/);
  if (gap) return { kind: 'gap', id: decodeURIComponent(gap[1]) };
  const contradiction = value.match(/^nodus:\/\/contradiction\/(.+)$/);
  if (contradiction) return { kind: 'contradiction', id: decodeURIComponent(contradiction[1]) };
  const passage = value.match(/^nodus:\/\/passage\/(.+)$/);
  if (passage) return { kind: 'passage', id: decodeURIComponent(passage[1]) };
  return null;
}

export function formatChars(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

export function formatSavedDraftDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
