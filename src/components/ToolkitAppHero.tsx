import { Icon } from './ui';

type ToolkitAppHeroProps = {
  badge: string;
  title: string;
  description: string;
  icon: string;
  actionLabel: string;
  actionIcon: string;
  onAction: () => void;
  onBack: () => void;
  heroTestId: string;
  actionTestId: string;
  backTestId: string;
  actionDisabled?: boolean;
  actionBusy?: boolean;
};

/** Shared first-screen header for every app in Nodus Toolkit. */
export function ToolkitAppHero({
  badge,
  title,
  description,
  icon,
  actionLabel,
  actionIcon,
  onAction,
  onBack,
  heroTestId,
  actionTestId,
  backTestId,
  actionDisabled = false,
  actionBusy = false,
}: ToolkitAppHeroProps) {
  return (
    <div className="space-y-4">
      <div>
        <button
          data-testid={backTestId}
          type="button"
          onClick={onBack}
          className="btn btn-ghost h-9 px-3 text-neutral-600 dark:text-neutral-300"
        >
          <Icon name="arrowLeft" size={14} />
          Nodus Toolkit
        </button>
      </div>
      <header
        data-testid={heroTestId}
        className="relative overflow-hidden rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-indigo-50 p-6 dark:border-amber-900/50 dark:from-amber-950/30 dark:via-neutral-950 dark:to-indigo-950/20 sm:p-8"
      >
        <div className="absolute -right-12 -top-24 h-64 w-64 rounded-full bg-indigo-300/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <Icon name={icon} size={11} />
              {badge}
            </span>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-neutral-950 dark:text-white">{title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">{description}</p>
          </div>
          <button
            data-testid={actionTestId}
            type="button"
            className="btn btn-primary h-11 shrink-0 px-5"
            onClick={onAction}
            disabled={actionDisabled}
          >
            <Icon name={actionBusy ? 'refresh' : actionIcon} size={15} className={actionBusy ? 'animate-spin' : ''} />
            {actionLabel}
          </button>
        </div>
      </header>
    </div>
  );
}
