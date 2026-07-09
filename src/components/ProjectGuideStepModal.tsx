import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import type { ProjectDetail, ProjectSectionRole, ProjectSectionStatus } from '@shared/types';
import type { ProjectGuideStep, ProjectGuideAction } from '@shared/projectGuide';
import { Icon } from './ui';
import { t } from '../i18n';

const STATUS_OPTIONS: ProjectSectionStatus[] = ['empty', 'in_progress', 'review', 'ready', 'discarded'];

const STATUS_LABELS: Record<ProjectSectionStatus, string> = {
  empty: 'Pendiente',
  in_progress: 'En curso',
  review: 'En revisión',
  ready: 'Listo',
  discarded: 'Descartada',
};

interface ProjectGuideStepModalProps {
  step: ProjectGuideStep;
  detail: ProjectDetail;
  busy: string | null;
  onClose: () => void;
  onSaveBrief: (brief: string) => void;
  onUpdateSections: (updates: { role: ProjectSectionRole; status: ProjectSectionStatus }[]) => void;
  onRunAction: (action: ProjectGuideAction) => void;
}

export function ProjectGuideStepModal({
  step,
  detail,
  busy,
  onClose,
  onSaveBrief,
  onUpdateSections,
  onRunAction,
}: ProjectGuideStepModalProps) {
  const [briefDraft, setBriefDraft] = useState(detail.project.brief);
  const [statuses, setStatuses] = useState<Record<ProjectSectionRole, ProjectSectionStatus>>(() => {
    const initial: Partial<Record<ProjectSectionRole, ProjectSectionStatus>> = {};
    for (const role of step.sectionRoles) {
      const section = detail.sections.find((s) => s.role === role);
      initial[role] = section?.status ?? 'empty';
    }
    return initial as Record<ProjectSectionRole, ProjectSectionStatus>;
  });

  const isBusy = Boolean(busy);
  const busyLabel = useMemo(() => {
    if (busy === 'save-brief') return t('Guardando brief...');
    if (busy?.startsWith('section-')) return t('Actualizando sección...');
    if (busy === 'import') return t('Importando capítulo...');
    if (busy === 'suggest') return t('Generando sugerencias...');
    return t('Procesando...');
  }, [busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = () => {
    if (step.id === 'brief') {
      onSaveBrief(briefDraft.trim());
      return;
    }
    const updates = step.sectionRoles
      .map((role) => {
        const section = detail.sections.find((s) => s.role === role);
        if (!section || section.status === statuses[role]) return null;
        return { role, status: statuses[role] };
      })
      .filter((item): item is { role: ProjectSectionRole; status: ProjectSectionStatus } => item !== null);
    if (updates.length > 0) {
      onUpdateSections(updates);
    }
  };

  const handleRunAction = (action: ProjectGuideAction) => {
    onRunAction(action);
    onClose();
  };

  const hasChanges = useMemo(() => {
    if (step.id === 'brief') return briefDraft.trim() !== detail.project.brief.trim();
    return step.sectionRoles.some((role) => {
      const section = detail.sections.find((s) => s.role === role);
      return (section?.status ?? 'empty') !== statuses[role];
    });
  }, [briefDraft, detail.project.brief, detail.sections, statuses, step.id, step.sectionRoles]);

  const canSave = step.id === 'brief' ? briefDraft.trim() !== detail.project.brief.trim() : hasChanges;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card w-full max-w-lg max-h-[85vh] overflow-y-auto p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <div className="mt-0.5 shrink-0">
            <Icon name={stepIcon(step.id)} size={18} className="text-indigo-500 dark:text-indigo-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{t(step.title)}</h2>
            <p className="mt-1 text-xs text-neutral-500">{t(step.summary)}</p>
          </div>
          <button
            className="btn btn-ghost shrink-0 p-1"
            onClick={onClose}
            disabled={isBusy}
            title={t('Cerrar')}
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-800 dark:border-indigo-800/40 dark:bg-indigo-900/20 dark:text-indigo-100">
            {t(step.description)}
          </div>

          {step.id === 'brief' && (
            <div>
              <label className="text-xs uppercase tracking-wide text-neutral-500">{t('Brief del proyecto')}</label>
              <textarea
                className="input mt-1.5 min-h-32 w-full resize-y text-sm"
                value={briefDraft}
                onChange={(e) => setBriefDraft(e.target.value)}
                placeholder={t('Objetivo, alcance, pregunta principal y criterio de selección')}
                disabled={isBusy}
              />
            </div>
          )}

          {(step.id === 'coverage' || step.id === 'materials') && (
            <div>
              <label className="text-xs uppercase tracking-wide text-neutral-500">
                {step.id === 'coverage' ? t('Estado de la cobertura') : t('Estado de los materiales')}
              </label>
              <select
                className="input mt-1.5 w-full text-sm"
                value={statuses[step.sectionRoles[0]]}
                onChange={(e) =>
                  setStatuses((prev) => ({ ...prev, [step.sectionRoles[0]]: e.target.value as ProjectSectionStatus }))
                }
                disabled={isBusy}
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {t(STATUS_LABELS[status])}
                  </option>
                ))}
              </select>
            </div>
          )}

          {step.id === 'outline' && (
            <div className="space-y-3">
              {step.sectionRoles.map((role) => {
                const section = detail.sections.find((s) => s.role === role);
                return (
                  <div key={role}>
                    <label className="text-xs uppercase tracking-wide text-neutral-500">
                      {section?.title ?? t(role)}
                    </label>
                    <select
                      className="input mt-1.5 w-full text-sm"
                      value={statuses[role]}
                      onChange={(e) =>
                        setStatuses((prev) => ({ ...prev, [role]: e.target.value as ProjectSectionStatus }))
                      }
                      disabled={isBusy}
                    >
                      {STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {t(STATUS_LABELS[status])}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          )}

          {step.id === 'manuscript' && (
            <div className="rounded-md border border-dashed border-neutral-300 bg-white p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
              {t('Sube un capítulo o artículo para convertirlo en texto editable. Se guardará como nota vinculada y versionada.')}
            </div>
          )}

          {step.id === 'review' && (
            <div className="rounded-md border border-dashed border-neutral-300 bg-white p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
              {t('Genera sugerencias de inserción con citas verificables y revisa las citas del capítulo antes de exportar.')}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          {isBusy && (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-neutral-500">
              <Icon name="sync" size={13} className="animate-spin" />
              {busyLabel}
            </span>
          )}
          <button className="btn btn-ghost text-xs" onClick={onClose} disabled={isBusy}>
            {t('Cancelar')}
          </button>
          {step.id === 'manuscript' && (
            <button
              className="btn btn-primary text-xs gap-1.5"
              onClick={() => handleRunAction('import_chapter')}
              disabled={isBusy}
            >
              <Icon name={busy === 'import' ? 'sync' : 'upload'} size={13} className={busy === 'import' ? 'animate-spin' : ''} />
              {t('Subir capítulo')}
            </button>
          )}
          {step.id === 'review' && (
            <button
              className="btn btn-primary text-xs gap-1.5"
              onClick={() => handleRunAction('review_chapter')}
              disabled={isBusy}
            >
              <Icon name={busy === 'suggest' ? 'sync' : 'wand'} size={13} className={busy === 'suggest' ? 'animate-spin' : ''} />
              {t('Revisar capítulo')}
            </button>
          )}
          {step.id !== 'manuscript' && step.id !== 'review' && (
            <button className="btn btn-primary text-xs gap-1.5" onClick={handleSave} disabled={isBusy || !canSave}>
              <Icon name={busy ? 'sync' : 'check'} size={13} className={busy ? 'animate-spin' : ''} />
              {t('Guardar')}
            </button>
          )}
        </footer>
      </motion.div>
    </div>,
    document.body
  );
}

function stepIcon(id: ProjectGuideStep['id']): string {
  switch (id) {
    case 'brief':
      return 'edit';
    case 'coverage':
      return 'map';
    case 'materials':
      return 'book';
    case 'outline':
      return 'layers';
    case 'manuscript':
      return 'upload';
    case 'review':
      return 'wand';
    default:
      return 'info';
  }
}
