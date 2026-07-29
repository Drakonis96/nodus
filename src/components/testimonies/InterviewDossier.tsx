import { useCallback, useEffect, useState } from 'react';
import type { TestimonyInterviewRow, TestimonyParticipantRow } from '@shared/types';
import { formatDuration } from '@shared/testimonies';
import { Icon } from '../ui';
import { confirm } from '../feedback';
import { AccessBadge, AgreementBadge, TranscriptionBadge, WorkflowBadge } from './AccessBadge';
import { InterviewOverview } from './InterviewOverview';
import { InterviewAgreement } from './InterviewAgreement';
import { InterviewSessions } from './InterviewSessions';
import { InterviewAnalysis } from './InterviewAnalysis';
import { InterviewNotes } from './InterviewNotes';
import { t, tx } from '../../i18n';

export type DossierTab = 'overview' | 'sessions' | 'analysis' | 'notes' | 'agreement';

const TABS: { id: DossierTab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Resumen', icon: 'file' },
  { id: 'sessions', label: 'Sesiones y transcripción', icon: 'microphone' },
  { id: 'analysis', label: 'Análisis', icon: 'highlighter' },
  { id: 'notes', label: 'Notas', icon: 'notebook' },
  { id: 'agreement', label: 'Acuerdo y acceso', icon: 'shield' },
];

/**
 * El dossier: UNA VISTA AMPLIA dentro de Entrevistas, no un modal.
 *
 * La diferencia importa. El trabajo con audio y transcripción dura horas, necesita ancho
 * y tiene que sobrevivir a aperturas prolongadas; un modal de registro genérico obliga a
 * cerrar para consultar cualquier otra cosa y pierde el punto de reproducción cada vez.
 *
 * Las cinco pestañas son el conjunto documental de la entrevista, en el orden en que se
 * trabaja: qué es → qué se grabó → qué dice → qué pienso → qué puedo hacer con ello.
 */
export function InterviewDossier({
  interviewId,
  initialTab = 'overview',
  onClose,
  onDeleted,
}: {
  interviewId: string;
  initialTab?: DossierTab;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [row, setRow] = useState<TestimonyInterviewRow | null>(null);
  const [people, setPeople] = useState<TestimonyParticipantRow[]>([]);
  const [tab, setTab] = useState<DossierTab>(initialTab);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [next, roster] = await Promise.all([
      window.nodus.getTestimonyInterview(interviewId),
      window.nodus.listTestimonyParticipants(''),
    ]);
    setRow(next);
    setPeople(roster);
    setLoading(false);
  }, [interviewId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab, interviewId]);

  const remove = async (): Promise<void> => {
    const impact = await window.nodus.testimonyDeletionImpact(interviewId);
    if (!impact) return;
    // Se enseña QUÉ desaparece antes de preguntar. «¿Seguro?» sin cifras no es una
    // pregunta: es un trámite que el usuario aprende a despachar sin leer.
    const ok = await confirm({
      title: tx('Eliminar «{title}»', { title: impact.title }),
      message: (
        <span className="block space-y-2 text-sm">
          <span className="block">{t('Se eliminarán de forma definitiva:')}</span>
          <span className="block text-xs leading-6 text-neutral-500">
            {tx('{sessions} sesiones · {media} archivos ({masters} originales) · {transcripts} transcripciones · {segments} tramos · {annotations} fragmentos · {agreements} versiones del acuerdo', {
              sessions: impact.sessions,
              media: impact.media,
              masters: impact.masterMedia,
              transcripts: impact.transcripts,
              segments: impact.segments,
              annotations: impact.annotations,
              agreements: impact.agreements,
            })}
          </span>
          {impact.contrastItems > 0 && (
            <span className="block text-xs text-amber-500">
              {tx('{n} fragmentos fijados en contrastes dejarán de existir.', { n: impact.contrastItems })}
            </span>
          )}
          {impact.noteLinks > 0 && (
            <span className="block text-xs text-neutral-500">
              {tx('{n} enlaces de notas quedarán rotos. Las notas conservan su texto.', { n: impact.noteLinks })}
            </span>
          )}
          {impact.masterMedia > 0 && (
            <span className="block text-xs font-medium text-rose-500">
              {t('Los originales no se pueden recuperar. Expórtalos antes si vas a necesitarlos.')}
            </span>
          )}
        </span>
      ),
      confirmLabel: t('Eliminar definitivamente'),
      danger: true,
    });
    if (!ok) return;
    await window.nodus.purgeTestimonyInterview(interviewId);
    onDeleted();
  };

  if (loading) {
    return (
      <div className="grid h-full place-items-center text-sm text-neutral-500">
        <span className="flex items-center gap-2"><Icon name="sync" className="animate-spin" /> {t('Cargando...')}</span>
      </div>
    );
  }
  if (!row) {
    return (
      <div className="grid h-full place-items-center text-sm text-neutral-500">
        {t('Esta entrevista ya no existe.')}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="testimony-dossier">
      <header className="border-b border-neutral-200 px-6 pb-3 pt-4 dark:border-neutral-800">
        <div className="flex flex-wrap items-start gap-3">
          <button className="btn btn-ghost shrink-0" onClick={onClose} data-testid="testimony-dossier-back">
            <Icon name="arrowLeft" /> {t('Entrevistas')}
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold text-neutral-800 dark:text-neutral-100">{row.title}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
              <span>{row.shortId}</span>
              {row.narratorNames.length > 0 && <span>{row.narratorNames.join(', ')}</span>}
              {(row.conductedAt ?? row.scheduledAt) && <span>{(row.conductedAt ?? row.scheduledAt)!.slice(0, 10)}</span>}
              {row.durationSeconds > 0 && <span>{formatDuration(row.durationSeconds)}</span>}
              {row.collectionLabel && <span>{row.collectionLabel}</span>}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <WorkflowBadge status={row.workflowStatus} />
            <TranscriptionBadge state={row.transcriptionState} />
            <AgreementBadge status={row.agreement?.status ?? 'pending'} />
            <AccessBadge level={row.agreement?.accessLevel ?? 'private'} embargoUntil={row.agreement?.embargoUntil} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              className="btn btn-ghost"
              title={row.archivedAt ? t('Desarchivar') : t('Archivar')}
              onClick={() => void window.nodus.archiveTestimonyInterview(row.id, !row.archivedAt).then(reload)}
            >
              <Icon name="archive" />
            </button>
            <button className="btn btn-ghost text-rose-500" title={t('Eliminar')} onClick={() => void remove()}>
              <Icon name="trash" />
            </button>
          </div>
        </div>

        <nav className="mt-3 flex flex-wrap gap-1" role="tablist">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={tab === entry.id}
              data-testid={`testimony-tab-${entry.id}`}
              onClick={() => setTab(entry.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === entry.id
                  ? 'bg-indigo-600 text-white'
                  : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900'
              }`}
            >
              <Icon name={entry.icon} size={13} />
              {t(entry.label)}
              {entry.id === 'analysis' && row.needsReviewCount > 0 && (
                <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-500">{row.needsReviewCount}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {tab === 'overview' && <InterviewOverview row={row} people={people} onChanged={reload} />}
        {tab === 'sessions' && <InterviewSessions row={row} people={people} onChanged={reload} />}
        {tab === 'analysis' && <InterviewAnalysis row={row} onChanged={reload} />}
        {tab === 'notes' && <InterviewNotes row={row} />}
        {tab === 'agreement' && <InterviewAgreement row={row} onChanged={reload} />}
      </div>
    </div>
  );
}
