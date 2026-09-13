import { useState, type ReactNode } from 'react';
import { StudyMarkdown } from './StudyMarkdown';
import { t } from '../i18n';

/**
 * Compact Markdown+LaTeX field with an Edit/Preview toggle, for study and teaching
 * authoring surfaces that used to be plain textareas. The preview runs the same
 * renderer as the student-facing views, so what a teacher sees here is exactly what
 * the question shows when it is studied or reviewed.
 */
export function MarkdownField({
  value,
  onChange,
  onBlur,
  placeholder,
  ariaLabel,
  rows = 4,
  autoFocus = false,
  disabled = false,
  testId,
  className = '',
  textareaClassName = '',
  preview,
}: {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  testId?: string;
  ariaLabel?: string;
  className?: string;
  textareaClassName?: string;
  /** Override how the value is previewed (e.g. an option list); defaults to block Markdown. */
  preview?: (value: string) => ReactNode;
}) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-1 text-[11px]">
        <button
          type="button"
          className={`rounded px-2 py-0.5 ${mode === 'edit' ? 'bg-indigo-600 text-white' : 'text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800'}`}
          onClick={() => setMode('edit')}
        >
          {t('Editar')}
        </button>
        <button
          type="button"
          className={`rounded px-2 py-0.5 ${mode === 'preview' ? 'bg-indigo-600 text-white' : 'text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800'}`}
          onClick={() => setMode('preview')}
        >
          {t('Vista previa')}
        </button>
        <span className="ml-auto hidden text-[10px] text-neutral-400 sm:inline">{t('Markdown y LaTeX · fórmulas entre $...$')}</span>
      </div>
      {mode === 'edit' ? (
        <textarea
          {...(testId ? { 'data-testid': testId } : {})}
          {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
          autoFocus={autoFocus}
          disabled={disabled}
          className={`input w-full resize-y ${textareaClassName}`}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
        />
      ) : value.trim() ? (
        <div className="min-h-10 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-800 dark:bg-neutral-900/40">
          {preview ? preview(value) : <StudyMarkdown content={value} />}
        </div>
      ) : (
        <p className="min-h-10 rounded-md border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-800">
          {placeholder ?? t('Sin contenido')}
        </p>
      )}
    </div>
  );
}
