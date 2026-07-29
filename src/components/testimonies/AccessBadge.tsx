import type {
  TestimonyAccessLevel,
  TestimonyAgreementStatus,
  InterviewWorkflowStatus,
  TestimonyTranscriptionState,
} from '@shared/types';
import {
  ACCESS_LEVEL_HINT,
  ACCESS_LEVEL_LABEL,
  AGREEMENT_STATUS_LABEL,
  WORKFLOW_STATUS_LABEL,
} from '@shared/testimonyLabels';
import { Icon } from '../ui';
import { t } from '../../i18n';

/**
 * Las tres etiquetas que un investigador de historia oral mira antes que nada, y que este
 * vault se niega a mezclar: EL FLUJO (dónde está el trabajo), EL ACUERDO (qué consta) y
 * EL ACCESO (qué puede hacerse). Son ejes independientes, y por eso son tres píldoras
 * distintas y no un semáforo único.
 *
 * NINGUNA DEPENDE SOLO DEL COLOR. Cada una lleva icono y texto, porque una restricción
 * que solo se ve si distingues el ámbar del rojo no es una restricción: es una
 * decoración, y en una pantalla de acceso eso es exactamente lo que no puede ser.
 */

const PILL = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap';

const ACCESS_STYLE: Record<TestimonyAccessLevel, { className: string; icon: string }> = {
  private: {
    className: 'border border-neutral-300 bg-neutral-100 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
    icon: 'lock',
  },
  restricted: {
    className: 'border border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300',
    icon: 'shield',
  },
  embargoed: {
    className: 'border border-rose-400 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300',
    icon: 'clock',
  },
  open: {
    className: 'border border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300',
    icon: 'unlock',
  },
};

export function AccessBadge({ level, embargoUntil, compact = false }: { level: TestimonyAccessLevel; embargoUntil?: string | null; compact?: boolean }) {
  const style = ACCESS_STYLE[level];
  const until = level === 'embargoed' && embargoUntil ? embargoUntil.slice(0, 10) : null;
  return (
    <span
      className={`${PILL} ${style.className}`}
      data-testid={`testimony-access-${level}`}
      title={`${t(ACCESS_LEVEL_LABEL[level])} · ${t(ACCESS_LEVEL_HINT[level])}`}
    >
      <Icon name={style.icon} size={11} />
      {!compact && <span>{t(ACCESS_LEVEL_LABEL[level])}</span>}
      {until && <span className="opacity-80">{until}</span>}
    </span>
  );
}

const AGREEMENT_STYLE: Record<TestimonyAgreementStatus, { className: string; icon: string }> = {
  pending: {
    className: 'border border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300',
    icon: 'alert',
  },
  documented: {
    className: 'border border-neutral-300 bg-neutral-100 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
    icon: 'check',
  },
  update_required: {
    className: 'border border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300',
    icon: 'refresh',
  },
  withdrawn: {
    className: 'border border-rose-400 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300',
    icon: 'x',
  },
};

export function AgreementBadge({ status }: { status: TestimonyAgreementStatus }) {
  const style = AGREEMENT_STYLE[status];
  return (
    <span className={`${PILL} ${style.className}`} data-testid={`testimony-agreement-${status}`} title={t('Acuerdo')}>
      <Icon name={style.icon} size={11} />
      <span>{t(AGREEMENT_STATUS_LABEL[status])}</span>
    </span>
  );
}

const WORKFLOW_ICON: Record<InterviewWorkflowStatus, string> = {
  preparation: 'edit',
  scheduled: 'calendar',
  recorded: 'microphone',
  transcribing: 'sync',
  reviewing: 'eye',
  narrator_review: 'users',
  completed: 'check',
  archived: 'archive',
  cancelled: 'x',
};

export function WorkflowBadge({ status }: { status: InterviewWorkflowStatus }) {
  const muted = status === 'archived' || status === 'cancelled';
  return (
    <span
      className={`${PILL} ${
        muted
          ? 'border border-neutral-300 bg-neutral-100 text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-500'
          : 'border border-indigo-400 bg-indigo-50 text-indigo-800 dark:border-indigo-700/60 dark:bg-indigo-950/40 dark:text-indigo-300'
      }`}
      data-testid={`testimony-workflow-${status}`}
    >
      <Icon name={WORKFLOW_ICON[status]} size={11} />
      <span>{t(WORKFLOW_STATUS_LABEL[status])}</span>
    </span>
  );
}

const TRANSCRIPTION_LABEL: Record<TestimonyTranscriptionState, string> = {
  none: 'Sin transcripción',
  pending: 'En cola',
  processing: 'Transcribiendo',
  ready: 'Lista para revisar',
  reviewed: 'Revisada',
  error: 'Error',
};

export function TranscriptionBadge({ state }: { state: TestimonyTranscriptionState }) {
  const style =
    state === 'error'
      ? 'border border-rose-400 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/40 dark:text-rose-300'
      : state === 'ready'
        ? 'border border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300'
        : state === 'reviewed'
          ? 'border border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'border border-neutral-300 bg-neutral-100 text-neutral-600 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400';
  const icon = state === 'error' ? 'alert' : state === 'processing' ? 'sync' : state === 'none' ? 'minus' : 'file';
  return (
    <span className={`${PILL} ${style}`} data-testid={`testimony-transcription-${state}`}>
      <Icon name={icon} size={11} className={state === 'processing' ? 'animate-spin' : ''} />
      <span>{t(TRANSCRIPTION_LABEL[state])}</span>
    </span>
  );
}
