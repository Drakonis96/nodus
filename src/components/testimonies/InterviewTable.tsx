import type { TestimonyInterviewRow, TestimonyInterviewSort } from '@shared/types';
import { formatDuration } from '@shared/testimonies';
import { AccessBadge, AgreementBadge, TranscriptionBadge, WorkflowBadge } from './AccessBadge';
import { Icon } from '../ui';
import { t } from '../../i18n';

/**
 * La tabla de entrevistas.
 *
 * ESQUEMA FIJO, A PROPÓSITO. Reutiliza el aspecto de Bases de datos —celdas, chips,
 * filtros, ordenación— pero no su modelo editable: un investigador no debe poder eliminar
 * la columna de acceso ni convertir el estado en texto libre. Esas columnas son el
 * contrato del vault con el narrador, no una preferencia de vista.
 *
 * La ordenación por columna se hace con botones de cabecera reales, con `aria-sort`, para
 * que la tabla sea operable entera con el teclado (17 del plan).
 */

const SORT_BY_COLUMN: Partial<Record<string, TestimonyInterviewSort>> = {
  title: 'title',
  date: 'recent',
  duration: 'duration',
  updated: 'updated',
};

export function InterviewTable({
  rows,
  sort,
  onSort,
  onOpen,
  emptyLabel,
}: {
  rows: TestimonyInterviewRow[];
  sort: TestimonyInterviewSort;
  onSort: (next: TestimonyInterviewSort) => void;
  onOpen: (interviewId: string) => void;
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-800">
        {emptyLabel}
      </div>
    );
  }

  const header = (id: string, label: string, className = '') => {
    const target = SORT_BY_COLUMN[id];
    const active = target && sort === target;
    return (
      <th scope="col" className={`px-3 py-2 text-left font-medium ${className}`} aria-sort={active ? 'descending' : 'none'}>
        {target ? (
          <button
            type="button"
            className={`inline-flex items-center gap-1 ${active ? 'text-indigo-400' : 'hover:text-neutral-800 dark:hover:text-neutral-200'}`}
            onClick={() => onSort(target)}
          >
            {t(label)}
            {active && <Icon name="arrowDown" size={11} />}
          </button>
        ) : (
          t(label)
        )}
      </th>
    );
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800">
      <table className="w-full min-w-[1080px] border-collapse text-sm" data-testid="testimony-interview-table">
        <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900/60">
          <tr>
            {header('title', 'Título', 'min-w-[240px]')}
            {header('narrators', 'Narrador')}
            {header('date', 'Fecha')}
            {header('workflow', 'Flujo')}
            {header('transcription', 'Transcripción')}
            {header('agreement', 'Acuerdo')}
            {header('access', 'Acceso')}
            {header('duration', 'Duración')}
            {header('language', 'Idioma')}
            {header('collection', 'Colección')}
            {header('updated', 'Última modificación')}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              data-testid={`testimony-row-${row.shortId}`}
              tabIndex={0}
              role="button"
              onClick={() => onOpen(row.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpen(row.id);
                }
              }}
              className="cursor-pointer border-t border-neutral-200 hover:bg-neutral-50 focus:bg-neutral-50 focus:outline-none dark:border-neutral-800 dark:hover:bg-neutral-900/60 dark:focus:bg-neutral-900/60"
            >
              <td className="px-3 py-2">
                <span className="flex flex-col">
                  <span className="font-medium text-neutral-800 dark:text-neutral-100">{row.title}</span>
                  <span className="text-[11px] text-neutral-500">{row.shortId}</span>
                </span>
              </td>
              <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">
                {row.narratorNames.length > 0 ? row.narratorNames.join(', ') : <span className="text-neutral-500">—</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-neutral-600 dark:text-neutral-300">
                {(row.conductedAt ?? row.scheduledAt)?.slice(0, 10) ?? '—'}
              </td>
              <td className="px-3 py-2"><WorkflowBadge status={row.workflowStatus} /></td>
              <td className="px-3 py-2"><TranscriptionBadge state={row.transcriptionState} /></td>
              <td className="px-3 py-2"><AgreementBadge status={row.agreement?.status ?? 'pending'} /></td>
              <td className="px-3 py-2">
                <AccessBadge level={row.agreement?.accessLevel ?? 'private'} embargoUntil={row.agreement?.embargoUntil} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-neutral-600 dark:text-neutral-300">{formatDuration(row.durationSeconds)}</td>
              <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{row.language ?? '—'}</td>
              <td className="px-3 py-2 text-neutral-600 dark:text-neutral-300">{row.collectionLabel ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-2 text-neutral-500">{row.updatedAt.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
