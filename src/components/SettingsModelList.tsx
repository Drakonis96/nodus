import type { HTMLAttributes, ReactNode } from 'react';

export function SettingsModelList({
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950/20 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function settingsModelRowClass(selected: boolean, interactive = false, className = ''): string {
  return [
    'border-b border-neutral-200 bg-white px-3 py-3 text-neutral-700 last:border-b-0 dark:border-neutral-800 dark:bg-transparent dark:text-neutral-300',
    selected
      ? 'bg-indigo-50 shadow-[inset_3px_0_0_0_rgb(99_102_241)] dark:bg-indigo-950/25'
      : interactive
        ? 'transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900/60'
        : '',
    className,
  ].filter(Boolean).join(' ');
}

export function SettingsModelDot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full border ${
        selected
          ? 'border-indigo-500 bg-indigo-500 ring-2 ring-indigo-100 dark:border-indigo-400 dark:bg-indigo-400 dark:ring-indigo-950'
          : 'border-neutral-300 bg-white dark:border-neutral-600 dark:bg-neutral-900'
      }`}
    />
  );
}
